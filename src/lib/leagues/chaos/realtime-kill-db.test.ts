/**
 * realtime-kill-db.test.ts — M7 L.F2.3 DRILL 1: "kill realtime mid-draft
 * (clients fall back to REST, draft completes)" (tasks-M7 §6 L.F2.3;
 * delivery plan :98; spec §24.3 "realtime degradation (fall back to 10s
 * REST polling — clients already REST-first)", §9.3 fetch-then-subscribe,
 * §22.6 "zero duplicate picks"; PROGRESS F758 / D690 — the fallback poll —
 * and D761).
 *
 * A real 8-team snake draft on the local stack, every seat a signed-in bot
 * holding a REAL `draft:<id>` private channel through realtime-js — with the
 * one twist that every client's WebSocket comes from `realtimeKillSwitch()`.
 * Nothing on the shared stack is stopped: the Realtime service stays up for
 * every other suite; for THIS draft's clients it is dead.
 *
 *   R1  LIVE (picks 1–8): every room SUBSCRIBED, broadcasts arriving, the
 *       fallback poll idle.
 *   R2  KILL: every socket dropped and every reconnect refused. Every room
 *       sees its channel fail (CHANNEL_ERROR / TIMED_OUT / CLOSED), goes
 *       degraded and starts the fallback poll.
 *   R3  DARK (picks 9–16): zero broadcasts reach any room; the bots learn
 *       whose turn it is ONLY from the REST poll and keep picking. Each bot
 *       double-taps its first dark pick (it saw no confirmation): the same
 *       action id replays, a fresh one is refused — zero duplicates.
 *   R4  RESTORE (picks 17–24): every room rejoins, its poll stops the moment
 *       it is SUBSCRIBED, broadcasts resume.
 *   R5  COMPLETE: the draft is complete, every room's REST view equals the
 *       stored board, zero duplicate picks, and reconcile exits 0.
 *
 * THE CLIENT MODEL. A room here is the draft room's own doctrine, built from
 * the app's real pieces — `channelDegradedAfter` + `createFallbackPoller`
 * (F758's poller, shared by every polling screen) and `use-draft.ts`'s read
 * (the drafts row + its picks, as the signed-in member) — with the room's
 * subscribe rule (a failed status ⇒ refetch first, go degraded, reopen with
 * the room's backoff; SUBSCRIBED ⇒ clear degraded, refetch). The source pin
 * (`room-model-pin.test.ts`, the fast lane) fails if `use-draft.ts` stops
 * doing what this model mirrors.
 * The poll cadence is COMPRESSED to 500 ms (production: 10 s,
 * `REALTIME_FALLBACK_POLL_MS`) so the drill runs in under a minute; the
 * 60-second pick clock leaves a REST-only room ≥ 50 s of its turn at the
 * real cadence (asserted as literals below).
 *
 * Requires the local stack (D59(5)). Fixtures `chaos-f23 rt …`, season
 * 2072, `chaos_f23_rt_*` users, players `chaos-f23-dp-*` — swept before and
 * after.
 */
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { REALTIME_FALLBACK_POLL_MS, channelDegradedAfter, createFallbackPoller, type FallbackPoller } from '@/hooks/use-realtime-fallback-poll-ops'

import { claimInvite, createInvite } from '../api/invites-service'
import { createDraft, leagueScope, makePick, startDraft } from '../api/draft-service'
import { createLeague, patchLeague } from '../api/leagues-service'
import { defaultsForTeamCount, type LeagueSettings } from '../settings/league-settings'
import { rosterForRounds } from '../sim/runner'
import { seedSyntheticSeason } from '../sim/synthetic-season'
import { systemTime } from '../time/time-provider'
import { duplicatePicks } from '../../../../load/k6/lib/checks'
import {
  CHAOS_PREFIX,
  CHAOS_SEASON,
  LOCAL_ANON_KEY,
  LOCAL_URL,
  census,
  createChaosUser,
  must,
  mustRow,
  runReconcileCli,
  serviceClient,
  sleep,
  sweep,
  waitFor,
  type ChaosUser,
  type Supabase,
} from './chaos-world'
import { realtimeKillSwitch, type RealtimeKillSwitch } from './faults'
import { modelWatchdogWantsRefetch, ROOM_WATCHDOG_MS } from './room-watchdog'

const service = serviceClient()
const TEAMS = 8
const ROUNDS = 3
const TOTAL = TEAMS * ROUNDS
const PICK_TIMER_SECONDS = 60
/** The compressed fallback cadence (production: REALTIME_FALLBACK_POLL_MS = 10 s). */
const DRILL_POLL_MS = 500
/** Mirrors `use-draft.ts`'s read (pinned by `room-model-pin.test.ts`). */
const PICKS_SELECT = 'id, pick_number, round, team_id, player_id, is_auto, is_undone, price, made_via, created_at'


/**
 * 15 RBs and 15 WRs with NO ADP. The bots choose from this pool by name, so
 * the drill needs no autopick to land on them — and an ADP below every real
 * player's (F60's trick) would hand them to ANY other live draft's clock
 * autopick on the shared database, whose picks would then pin our players
 * against the sweep (measured 2026-10-27: exactly that, mid-suite).
 */
const POOL = Array.from({ length: 30 }, (_, i) => ({
  id: `${CHAOS_PREFIX}-dp-${i % 2 === 0 ? 'rb' : 'wr'}${String(Math.floor(i / 2) + 1).padStart(2, '0')}`,
  full_name: `Chaos Draft ${i % 2 === 0 ? 'RB' : 'WR'} ${Math.floor(i / 2) + 1}`,
  position: i % 2 === 0 ? 'RB' : 'WR',
  team: 'CXA',
  status: 'Active',
}))

interface PickView {
  pick_number: number
  team_id: string
  player_id: string
  is_undone: boolean | null
  is_auto: boolean | null
}

interface DraftView {
  status: string | null
  current_pick_number: number | null
  on_clock_team_id: string | null
  picks: PickView[]
}

/** One manager's draft room (see the banner's CLIENT MODEL). */
class Room {
  view: DraftView = { status: null, current_pick_number: null, on_clock_team_id: null, picks: [] }
  statuses: string[] = []
  broadcasts = 0
  restReads = 0
  degraded = false
  everSubscribed = false
  private channel: RealtimeChannel | null = null
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private lastBeatAtMs: number | null = null
  private readonly watchdog: ReturnType<typeof setInterval>
  readonly poller: FallbackPoller

  constructor(
    readonly user: ChaosUser,
    readonly client: Supabase,
    readonly teamId: string,
    readonly draftId: string,
  ) {
    this.poller = createFallbackPoller({ poll: () => void this.refetch(), isVisible: () => true, intervalMs: DRILL_POLL_MS })
    // The room WATCHDOG (`use-draft.ts`, `roomWatchdogWantsRefetch` — pinned by
    // room-model-pin.test.ts): a SCHEDULED room asks every 5 s (a lost start
    // broadcast must not park it); a LIVE room asks after 45 s with no beat.
    this.watchdog = setInterval(() => {
      const now = systemTime.now().getTime()
      if (!modelWatchdogWantsRefetch({ status: this.view.status, lastBeatAtMs: this.lastBeatAtMs, nowMs: now })) return
      this.lastBeatAtMs = now
      void this.refetch()
    }, ROOM_WATCHDOG_MS)
  }

  /** `useDraft`'s queryFn: the drafts row + its picks, through the member's own RLS read. */
  async refetch(): Promise<void> {
    const [draftRes, picksRes] = await Promise.all([
      this.client.from('drafts').select('*').eq('id', this.draftId).maybeSingle(),
      this.client.from('draft_picks').select(PICKS_SELECT).eq('draft_id', this.draftId).order('pick_number', { ascending: true }),
    ])
    if (draftRes.error || picksRes.error) return // a failed poll keeps the last-good view (F758's loud-failure rule is the banner's)
    this.restReads += 1
    const d = draftRes.data
    const picks = (picksRes.data ?? []) as PickView[]
    // The room's version rule (F560's sink — `incoming < known` ⇒ ignore): a
    // read that resolves AFTER a newer broadcast never rolls the room back.
    if (picks.length < this.view.picks.length) return
    this.view = {
      status: d?.status ?? null,
      current_pick_number: d?.current_pick_number ?? null,
      on_clock_team_id: d?.on_clock_team_id ?? null,
      picks,
    }
  }

  async open(): Promise<void> {
    if (this.disposed) return
    for (const stale of this.client.getChannels()) {
      if (stale.topic === `realtime:draft:${this.draftId}`) await this.client.removeChannel(stale)
    }
    const { data } = await this.client.auth.getSession()
    await this.client.realtime.setAuth(data.session?.access_token ?? null)
    if (this.disposed) return
    const ch = this.client.channel(`draft:${this.draftId}`, { config: { private: true, presence: { key: this.teamId } } })
    this.channel = ch
    ch.on('broadcast', { event: 'tick' }, () => {
      this.lastBeatAtMs = systemTime.now().getTime() // the heartbeat the watchdog reads
    })
    ch.on('broadcast', { event: 'drafts' }, ({ payload }) => {
      this.broadcasts += 1
      const r = ((payload ?? {}) as { record?: Partial<DraftView> }).record ?? {}
      if (typeof r.current_pick_number === 'number' && typeof this.view.current_pick_number === 'number' && r.current_pick_number < this.view.current_pick_number) return
      this.view = {
        ...this.view,
        status: r.status ?? this.view.status,
        current_pick_number: r.current_pick_number ?? this.view.current_pick_number,
        on_clock_team_id: r.on_clock_team_id === undefined ? this.view.on_clock_team_id : r.on_clock_team_id,
      }
    })
    ch.on('broadcast', { event: 'draft_picks' }, ({ payload }) => {
      this.broadcasts += 1
      const r = ((payload ?? {}) as { record?: PickView }).record
      if (r && !this.view.picks.some((p) => p.pick_number === r.pick_number && p.player_id === r.player_id)) {
        this.view = { ...this.view, picks: [...this.view.picks, r].sort((a, b) => a.pick_number - b.pick_number) }
      }
    })
    ch.subscribe((status) => {
      if (this.disposed || ch !== this.channel) return
      this.statuses.push(status)
      const next = channelDegradedAfter(status, this.degraded)
      this.degraded = next
      this.poller.setDegraded(next)
      if (status === 'SUBSCRIBED') {
        this.attempt = 0
        this.everSubscribed = true
        void this.refetch() // §9.3: reconcile on every confirmed join
        return
      }
      if (next) {
        void this.refetch() // the reconnect doctrine: refetch FIRST
        this.scheduleReopen()
      }
    })
  }

  /** The room's own backoff (`use-draft.ts` scheduleReopen). */
  private scheduleReopen(): void {
    if (this.disposed || this.retry) return
    const delay = Math.min(1_000 * 2 ** this.attempt, 15_000)
    this.attempt += 1
    this.retry = setTimeout(() => {
      this.retry = null
      this.channel = null
      void this.open()
    }, delay)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.watchdog)
    this.poller.dispose()
    if (this.retry) clearTimeout(this.retry)
    await this.client.removeAllChannels()
  }

  standing(): PickView[] {
    return this.view.picks.filter((p) => p.is_undone !== true)
  }
}

let kill: RealtimeKillSwitch
const users: ChaosUser[] = []
let rooms: Room[] = []
let leagueId = ''
let draftId = ''
/** Picks the bots may make up to (the controller opens the gate phase by phase). */
let gate = 8
const tally = { botPicks: 0, darkBotPicks: 0, replays: 0, refusedDoubleTaps: 0, staleRefusals: 0 }
const broadcastsAt: Record<string, number[]> = {}

function signedIn(transport: typeof WebSocket): Supabase {
  return createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport } }) as unknown as Supabase
}

async function storedPicks(): Promise<PickView[]> {
  return ((await must(service.from('draft_picks').select(PICKS_SELECT).eq('draft_id', draftId).order('pick_number'), 'stored picks')) ?? []) as PickView[]
}

/** One bot: picks only from what ITS ROOM shows (broadcast or REST poll — whatever is alive). */
async function runBot(room: Room, stop: { done: boolean }): Promise<void> {
  let acted = -1
  while (!stop.done) {
    const v = room.view
    const n = v.current_pick_number ?? -1
    if (v.status === 'live' && v.on_clock_team_id === room.teamId && n !== acted && n <= gate) {
      acted = n
      const taken = new Set(room.standing().map((p) => p.player_id))
      const mine = room.standing().filter((p) => p.team_id === room.teamId)
      const rbs = mine.filter((p) => p.player_id.includes('-dp-rb')).length
      const wrs = mine.length - rbs
      const choice = POOL.find((p) => !taken.has(p.id) && !((p.position === 'RB' && rbs >= 2) || (p.position === 'WR' && wrs >= 2)))
      if (choice !== undefined) {
        const actionId = crypto.randomUUID()
        const res = await makePick(room.client, leagueScope(leagueId), { draft_id: draftId, player_id: choice.id, action_id: actionId })
        if (res.status === 200) {
          tally.botPicks += 1
          if (kill.dead) {
            tally.darkBotPicks += 1
            if (tally.darkBotPicks <= TEAMS) {
              // No confirmation seen (the room is dark): the manager taps again.
              const replay = await makePick(room.client, leagueScope(leagueId), { draft_id: draftId, player_id: choice.id, action_id: actionId })
              if (replay.status === 200) tally.replays += 1
              const again = await makePick(room.client, leagueScope(leagueId), { draft_id: draftId, player_id: choice.id, action_id: crypto.randomUUID() })
              if (again.status !== 200) tally.refusedDoubleTaps += 1
            }
          }
        } else {
          tally.staleRefusals += 1 // the room's view was behind; it refetches (the app's onError path) and tries again
          await room.refetch()
          acted = -1
        }
      }
    }
    await sleep(50)
  }
}

beforeAll(async () => {
  await sweep(service)
  await seedSyntheticSeason(service, CHAOS_SEASON)
  await must(service.from('players').upsert(POOL), 'pool players')
  kill = realtimeKillSwitch()
  for (let i = 1; i <= TEAMS; i++) users.push(await createChaosUser(service, `rt_m${i}`))
  const clients = users.map(() => signedIn(kill.transport))
  for (const [i, c] of clients.entries()) {
    const { error } = await c.auth.signInWithPassword({ email: users[i].email, password: users[i].password })
    if (error) throw new Error(`sign-in ${users[i].username}: ${error.message}`)
  }
  const template = await mustRow(clients[0].from('scoring_systems').select('id').eq('is_template', true).eq('name', 'ESPN Standard').single(), 'template')
  const base = defaultsForTeamCount(TEAMS)
  const settings: LeagueSettings = {
    ...base,
    roster_settings: rosterForRounds(ROUNDS),
    draft: { ...base.draft, draft_type: 'snake', draft_order_mode: 'random', pick_timer_seconds: PICK_TIMER_SECONDS, draft_scheduled_at: '2071-09-01T17:00:00+00:00' },
  }
  const created = await createLeague(clients[0], { name: `${CHAOS_PREFIX} rt league`, season: CHAOS_SEASON, scoring_system_id: template.id, team_name: 'Chaos 1', action_id: crypto.randomUUID(), settings })
  if (created.status !== 201) throw new Error(`createLeague: ${created.status} ${JSON.stringify(created.body)}`)
  leagueId = (created.body as { league_id: string }).league_id
  const teamOf = new Map<number, string>()
  teamOf.set(0, (await mustRow(clients[0].from('league_members').select('team_id').eq('league_id', leagueId).eq('user_id', users[0].userId).single(), 'seat')).team_id as string)
  for (let i = 1; i < TEAMS; i++) {
    const invite = await createInvite(clients[0], leagueId, {})
    if (invite.status !== 201 && invite.status !== 200) throw new Error(`createInvite: ${invite.status}`)
    const claim = await claimInvite(clients[i], { token: (invite.body as { token: string }).token })
    if (claim.status !== 200) throw new Error(`claimInvite: ${claim.status} ${JSON.stringify(claim.body)}`)
    teamOf.set(i, (claim.body as { team_id: string }).team_id)
  }
  const scheduled = await patchLeague(clients[0], leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) throw new Error(`schedule: ${scheduled.status} ${JSON.stringify(scheduled.body)}`)
  const draft = await createDraft(clients[0], leagueId)
  if (draft.status !== 201 && draft.status !== 200) throw new Error(`createDraft: ${draft.status} ${JSON.stringify(draft.body)}`)
  draftId = (await mustRow(service.from('drafts').select('id').eq('league_id', leagueId).eq('is_mock', false).single(), 'draft')).id
  rooms = clients.map((c, i) => new Room(users[i], c, teamOf.get(i)!, draftId))
  // §9.3 fetch → render → subscribe.
  for (const r of rooms) await r.refetch()
  for (const r of rooms) await r.open()
  await waitFor(() => (rooms.every((r) => r.statuses.includes('SUBSCRIBED')) ? true : undefined), 20_000, 'every room SUBSCRIBED')
}, 180_000)

afterAll(async () => {
  for (const r of rooms) await r.dispose()
  await sweep(service)
  expect(Object.values(await census(service)).every((n) => n === 0)).toBe(true)
}, 180_000)

describe('L.F2.3 drill 1 — realtime dies mid-draft', () => {
  it('the compressed cadence is only a compression: at the real 10 s poll a REST-only room still sees its turn with ≥ 50 s of a 60 s clock left', () => {
    expect(REALTIME_FALLBACK_POLL_MS).toBe(10_000)
    expect(PICK_TIMER_SECONDS * 1000 - REALTIME_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(50_000)
  })

  it('R1–R5: live → killed → dark picks over REST → restored → complete, zero duplicates', async () => {
    const stop = { done: false }
    const started = await startDraft(rooms[0].client, leagueId)
    expect(started.status).toBe(200)
    const bots = rooms.map((r) => runBot(r, stop))
    try {
      // R1 LIVE — picks 1–8 with realtime up.
      await waitFor(async () => ((await storedPicks()).length >= 8 ? true : undefined), 150_000, 'picks 1–8')
      await waitFor(() => (rooms.every((r) => r.standing().length >= 8) ? true : undefined), 10_000, 'every room shows 8 picks')
      expect(rooms.every((r) => r.broadcasts > 0)).toBe(true)
      expect(rooms.every((r) => !r.degraded && !r.poller.running())).toBe(true)
      const readsBeforeKill = rooms.map((r) => r.restReads)

      // R2 KILL — every socket dropped, every reconnect refused.
      kill.kill()
      expect(kill.dropped).toBeGreaterThanOrEqual(TEAMS)
      await waitFor(() => (rooms.every((r) => r.degraded && r.poller.running()) ? true : undefined), 20_000, 'every room degraded with its poll running')
      const failures = rooms.map((r) => r.statuses.filter((s) => s !== 'SUBSCRIBED'))
      expect(failures.every((f) => f.length > 0 && f.every((s) => ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)))).toBe(true)
      broadcastsAt.killed = rooms.map((r) => r.broadcasts)

      // R3 DARK — picks 9–16 learned only from the REST poll.
      gate = 16
      await waitFor(async () => ((await storedPicks()).length >= 16 ? true : undefined), 120_000, 'picks 9–16 in the dark')
      await waitFor(() => (rooms.every((r) => r.standing().length >= 16) ? true : undefined), 10_000, 'every room shows 16 picks (via REST)')
      broadcastsAt.dark = rooms.map((r) => r.broadcasts)
      expect(broadcastsAt.dark).toEqual(broadcastsAt.killed) // not ONE broadcast reached a dark room
      expect(rooms.every((r, i) => r.restReads > readsBeforeKill[i])).toBe(true)
      expect(kill.refused).toBeGreaterThan(0) // reconnects were really attempted and refused
      expect(tally.darkBotPicks).toBe(8) // R1719: picks 9–16 — every one a bot's, learned from the REST poll

      // R4 RESTORE — rooms rejoin; each poll stops at SUBSCRIBED.
      kill.restore()
      await waitFor(
        () => (rooms.every((r) => r.statuses.lastIndexOf('SUBSCRIBED') > r.statuses.findIndex((s) => s !== 'SUBSCRIBED') && !r.degraded && !r.poller.running()) ? true : undefined),
        60_000,
        'every room rejoined with its poll stopped',
      )
      gate = TOTAL
      await waitFor(async () => ((await mustRow(service.from('drafts').select('status').eq('id', draftId).single(), 'status')).status === 'complete' ? true : undefined), 120_000, 'draft complete')
      await waitFor(() => (rooms.every((r) => r.standing().length === TOTAL) ? true : undefined), 15_000, 'every room shows the full board')
      expect(rooms.every((r, i) => r.broadcasts > broadcastsAt.dark[i])).toBe(true) // live updates resumed
    } finally {
      stop.done = true
      await Promise.all(bots)
    }

    // R5 COMPLETE — the stored board, every room's view, zero duplicates.
    const stored = await storedPicks()
    expect(stored).toHaveLength(TOTAL)
    expect(stored.filter((p) => p.is_auto === true)).toEqual([]) // R1719: not one pick left to the clock
    const dup = duplicatePicks(stored)
    expect([dup.duplicatePlayers, dup.duplicatePickNumbers]).toEqual([[], []])
    const board = JSON.stringify(stored.map((p) => [p.pick_number, p.team_id, p.player_id]))
    for (const r of rooms) {
      await r.refetch()
      expect(JSON.stringify(r.standing().map((p) => [p.pick_number, p.team_id, p.player_id]))).toBe(board)
    }
    // Each bot's first dark pick was double-tapped: the replay is the same pick, the fresh tap refused.
    expect(tally.replays).toBe(TEAMS)
    expect(tally.refusedDoubleTaps).toBe(TEAMS)
    console.log(
      `[L.F2.3 drill 1] picks ${stored.length} (bots ${tally.botPicks}, in the dark ${tally.darkBotPicks}, clock autopicks ${stored.filter((p) => p.is_auto).length}); ` +
        `double-taps: ${tally.replays} replayed, ${tally.refusedDoubleTaps} refused; stale-view refusals ${tally.staleRefusals}; ` +
        `sockets opened ${kill.opened}, dropped ${kill.dropped}, refused while dead ${kill.refused}; ` +
        `room statuses: ${JSON.stringify(rooms.map((r) => r.statuses))}`,
    )
  }, 400_000)

  it('END reconcile exits 0 (the league has no scored week yet: 0 cells — said, not hidden)', () => {
    const cli = runReconcileCli([leagueId])
    console.log(`[L.F2.3 drill 1] reconcile CLI exit ${cli.status}: ${JSON.stringify(cli.summary)}`)
    expect(cli.status, cli.stdout + cli.stderr).toBe(0)
    expect(cli.summary).toMatchObject({ alerts: 0, cells: 0 })
  }, 150_000)

})
