/**
 * correction-replay-db.test.ts — M6 L.E2.6, THE REPLAY PROOF (tasks-M6 §6
 * L.E2.6, §9 criterion 3; spec §23.4 / §12.21 / §16.4, TD2 as amended by
 * F511 — the 6-hour settle grace; Q81: after the window "we have to forget
 * it"; PROGRESS D453 / D454 / D458 and D468 — Chris 2026-10-02, "yeah lets
 * not hold for it").
 *
 * A recorded PAIR of snapshots of one NFL week (snapshot 1 = every game
 * final, snapshot 2 = the same week carrying a stat correction) is replayed
 * through the REAL `ingestWeek` → ingest door → REAL score-week worker →
 * scoring door (172) → league_week_advance / finalize_matchups, on BOTH
 * sides of the lock, around a league built so the correction decides a
 * matchup (`correction-replay.ts` says what is constructed and what is not).
 *
 * THE PAIRS.
 *   - SYNTHETIC — always: `__fixtures__/correction-replay-synthetic.ts`, a
 *     MADE-UP -6 receiving-yards correction (100 → 94), in the fixture format,
 *     its provider named `synthetic:correction-replay`.
 *   - REAL — when L.E2.5's capture holds one: `scripts/correction-replay-
 *     source.ts` scans `fixtures/nfl/2026/` for a committed pair whose diff
 *     names a scorable correction OUTSIDE the settle grace and replays it the
 *     same way. Today there is none: the scan says so in plain words (R0) and
 *     the proof passes on the synthetic pair — the real leg is NON-BLOCKING
 *     by Chris's ruling; F540 stays open until a real one is captured.
 *
 * THE ARMS (each on its own test season — 2080–2085, measured unused).
 *   IN THE WINDOW  (2080 synthetic / 2083 real) — snapshot 1 scored; the week
 *     advanced to its correction window; snapshot 2 polled 7 h+ after the week
 *     was seen final: ONE event (open, applied), the score re-scored, the
 *     result CHANGED, ONE league post naming the player and both scores, a
 *     notification to each manager whose result changed (the one now losing
 *     included) and to no one else, the corrections view's row; then the real
 *     finalize at the window's end stores the record's result and the rebuild
 *     finds no drift.
 *   SETTLE GRACE   (2081 synthetic) — snapshot 2 polled 1 h after the week was
 *     seen final: re-scored, the result moves, and it is SILENT — no event, no
 *     record, no post, no notification (F511).
 *   AFTER THE LOCK (2082 synthetic / 2085 real) — snapshot 1 scored, the week
 *     FINAL at its window's end, then snapshot 2: the event is NFL data
 *     (`week_state` final), `player_stats` holds the new value (research), the
 *     worker consumes it as `week_final`, and every league cell, stored point
 *     row, record, post and notification is byte-identical (Q81).
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-crp` prefix on test players / games / leagues,
 * the 2080–2085 seasons for stats / queue / events / calendar (cleaned by
 * season), `crp_` users; cleanup first and after. A REAL corrected player
 * absent from `players` (a fresh CI database) is inserted from the capture's
 * sidecar and removed afterwards; one already present is never touched.
 * Action-id prefix `3f1` (measured free 2026-10-02).
 */
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readStatCorrections, type StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'
import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import { ingestWeek, SETTLE_GRACE_MS, type IngestReport } from '@/lib/sync/ingest-week'
import type { SyncClient } from '@/lib/sync/types'
import type { Database, Json } from '@/types/database'

import { scanCapturedCorrections } from '../../../../scripts/correction-replay-source'
import { buildSyntheticCorrectionPair } from './__fixtures__/correction-replay-synthetic'
import {
  constructOpponentLine,
  lineOf,
  readReplaySnapshot,
  replayCalendar,
  ReplayPairProvider,
  slotForPosition,
  type ReplayPair,
} from './correction-replay'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-crp'
const SEASONS = [2080, 2081, 2082, 2083, 2084, 2085] as const
const SYN_PLAYER = `${PREFIX}-syn-wr`
const HOUR = 3_600_000

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as SyncClient

const SCAN = scanCapturedCorrections(resolve(process.cwd(), 'fixtures/nfl/2026'))
const SYNTHETIC = buildSyntheticCorrectionPair(SYN_PLAYER)
/** Real players this file inserted (absent before) — the only real rows it removes. */
const insertedRealPlayers: string[] = []

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  for (const season of SEASONS) {
    for (const table of ['stat_correction_events', 'score_fanout', 'player_stats'] as const) {
      await must(service.from(table).delete().eq('season', season), `cleanup ${table} ${season}`)
    }
  }
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['league_stat_corrections', 'transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().in('season', [...SEASONS]), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  if (insertedRealPlayers.length > 0) await must(service.from('players').delete().in('id', insertedRealPlayers), 'cleanup inserted real players')
  const { data: users } = await service.from('profiles').select('id, username').like('username', 'crp\\_%')
  for (const row of users ?? []) await service.auth.admin.deleteUser(row.id)
}

beforeAll(cleanup, 90_000)
afterAll(cleanup, 90_000)

/** Wednesday 00:00 ET (04:00Z) on or before `d` — the 039 `starts_at` shape. */
function wednesdayBefore(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4))
  if (day.getTime() > d.getTime()) day.setUTCDate(day.getUTCDate() - 1)
  while (day.getUTCDay() !== 3) day.setUTCDate(day.getUTCDate() - 1)
  return day
}

type Arm = 'in_window' | 'settle_grace' | 'after_window'

/**
 * One arm's whole world: the calendar, the league built around the corrected
 * player, the replay provider, and the reads the cells assert on.
 */
function story(pair: ReplayPair, arm: Arm, season: number) {
  const gamePrefix = `${PREFIX}-${season}-`
  const s1 = readReplaySnapshot(pair.first, { season, gamePrefix })
  const s2 = readReplaySnapshot(pair.second, { season, gamePrefix })
  const cal = replayCalendar(s1)
  const c = pair.change
  const opponentId = `${PREFIX}-opp-${season}`
  const constructed = constructOpponentLine(lineOf(s1, c.playerId), lineOf(s2, c.playerId), c.statKey, opponentId)
  const provider = new ReplayPairProvider({ 1: s1, 2: s2 }, [constructed.line], pair.origin, pair.first.header.provider)
  const startsAt = wednesdayBefore(cal.firstKickoff)
  // The instants (derived; each asserted in order below).
  const tFinal = new Date(cal.lastKickoff.getTime() + 4 * HOUR) // snapshot 1: every game final
  const tSettle = new Date(tFinal.getTime() + 1 * HOUR) // inside the 6 h grace
  const releaseFloorish = new Date(Math.max(tFinal.getTime(), startsAt.getTime() + 6 * 24 * HOUR + 3 * HOUR)) // ≥ Tue 00:00 PT
  const tAdvance = new Date(releaseFloorish.getTime() + 2 * HOUR)
  const tInWindow = new Date(Math.max(tFinal.getTime() + SETTLE_GRACE_MS + HOUR, tAdvance.getTime() + HOUR))
  const tLock = cal.nextKickoff
  const tLate = new Date(tLock.getTime() + 12 * HOUR)
  const clock = new VirtualClock(tFinal)
  const state = { leagueId: '', teamA: '', teamB: '', userA: '', userB: '', memberClient: null as SupabaseClient<Database> | null }
  const users = [
    { email: `crp-${season}-a@fieldscout.test`, password: `pgtap-crp-${season}-a`, username: `crp_${season}_a` },
    { email: `crp-${season}-b@fieldscout.test`, password: `pgtap-crp-${season}-b`, username: `crp_${season}_b` },
  ]
  const slotC = slotForPosition(c.position)

  async function setup(): Promise<void> {
    expect(tFinal.getTime() < tSettle.getTime() && tSettle.getTime() < tFinal.getTime() + SETTLE_GRACE_MS).toBe(true)
    expect(tInWindow.getTime() - tFinal.getTime()).toBeGreaterThanOrEqual(SETTLE_GRACE_MS)
    expect(tInWindow.getTime()).toBeLessThan(tLock.getTime())
    await must(
      service.from('nfl_weeks').insert([
        { season, week: 1, starts_at: startsAt.toISOString(), first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: tLock.toISOString() },
        { season, week: 2, starts_at: new Date(startsAt.getTime() + 7 * 24 * HOUR).toISOString(), first_kickoff_at: tLock.toISOString(), last_game_ends_at: null, correction_window_ends_at: new Date(tLock.getTime() + 7 * 24 * HOUR).toISOString() },
      ]),
      'nfl_weeks',
    )
    // The corrected player: a test row (synthetic) or the real id (inserted only when absent).
    const { data: present } = await service.from('players').select('id').eq('id', c.playerId).maybeSingle()
    if (present === null) {
      await must(service.from('players').insert({ id: c.playerId, full_name: c.name, position: c.position, team: c.nflTeam, status: 'Active' }).select('id'), 'corrected player')
      if (pair.origin === 'real' && !insertedRealPlayers.includes(c.playerId)) insertedRealPlayers.push(c.playerId)
    }
    await must(service.from('players').insert({ id: opponentId, full_name: `Constructed Opponent ${season}`, position: c.position, team: 'CRP', status: 'Active' }).select('id'), 'opponent player')
    for (const u of users) {
      const { data, error } = await service.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true, user_metadata: { username: u.username } })
      if (error) throw new Error(`createUser ${u.username}: ${error.message}`)
      if (u === users[0]) state.userA = data.user.id
      else state.userB = data.user.id
    }
    const commish = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
    const { error: signInError } = await commish.auth.signInWithPassword({ email: users[0].email, password: users[0].password })
    if (signInError) throw new Error(`sign-in: ${signInError.message}`)
    state.memberClient = commish
    const { columns, blob } = splitSettings(defaultsForTeamCount(8))
    const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
    // The template that pays the corrected key (ESPN Standard pays receiving yards).
    const { data: templates } = await commish.from('scoring_systems').select('id, name, rules').eq('is_template', true).order('name')
    const tpl = (templates ?? []).find((t) => t.name === 'ESPN Standard' && Number((t.rules as Record<string, unknown>)[c.statKey] ?? 0) !== 0) ??
      (templates ?? []).find((t) => Number((t.rules as Record<string, unknown>)[c.statKey] ?? 0) !== 0)
    if (tpl === undefined) throw new Error(`no scoring template pays ${c.statKey} directly — this correction cannot move a league score`)
    const { data: league, error } = await commish.rpc('create_league', {
      p_name: `${PREFIX}-${arm}-${season}`,
      p_season: season,
      p_scoring_system_id: tpl.id,
      p_team_name: 'Team A',
      p_action_id: `3f100000-0000-4000-8000-00000000${season}`,
      p_settings: blob,
      ...columnArgs,
    } as unknown as Database['public']['Functions']['create_league']['Args'])
    if (error) throw new Error(`create_league: ${error.message}`)
    state.leagueId = (league as { league_id: string }).league_id
    state.teamA = (await must(service.from('teams').select('id').eq('league_id', state.leagueId).single(), 'team A'))!.id
    state.teamB = (await must(service.from('teams').insert({ owner_id: state.userB, name: 'Team B', league_id: state.leagueId }).select('id').single(), 'team B'))!.id
    await must(service.from('league_members').insert({ league_id: state.leagueId, user_id: state.userB, team_id: state.teamB, role: 'manager' }), 'member B')
    await must(
      service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: tpl.rules as Json, playoff_teams: 0 }).eq('id', state.leagueId),
      'league → in_season',
    )
    await must(service.from('league_weeks').insert([{ league_id: state.leagueId, season, week: 1, status: 'live' }, { league_id: state.leagueId, season, week: 2, status: 'upcoming' }]), 'league weeks')
    await must(
      service.from('matchups').insert({ league_id: state.leagueId, season, week: 1, round_type: 'regular', home_team_id: state.teamA, away_team_id: state.teamB, status: 'live' }).select('id'),
      'matchup',
    )
    await must(service.from('league_rosters').insert([
      { league_id: state.leagueId, team_id: state.teamA, player_id: c.playerId },
      { league_id: state.leagueId, team_id: state.teamB, player_id: opponentId },
    ]), 'rosters')
    await must(service.from('team_lineups').insert([
      { team_id: state.teamA, season, week: 1, starters: [], bench: [], slot_map: { [slotC]: c.playerId } },
      { team_id: state.teamB, season, week: 1, starters: [], bench: [], slot_map: { [slotC]: opponentId } },
    ]), 'lineups')
  }

  async function poll(phase: 1 | 2, at: Date): Promise<IngestReport> {
    provider.phase = phase
    clock.advanceTo(at)
    const report = await ingestWeek(provider, clock, { db, degradation: new DegradationTracker(), season, week: 1 })
    if (!report.ok) throw new Error(`ingestWeek failed at ${at.toISOString()}: ${report.error}`)
    return report
  }

  const drain = () => runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [state.leagueId] })

  async function matchup(): Promise<{ a: number; b: number; status: string; result: string | null }> {
    const m = await must(service.from('matchups').select('home_score, away_score, status, result').eq('league_id', state.leagueId).eq('week', 1).single(), 'matchup')
    return { a: Number(m!.home_score), b: Number(m!.away_score), status: m!.status, result: m!.result }
  }

  async function records() {
    return (await must(
      service.from('league_stat_corrections').select('team_id, player_id, slot, player_points_before, player_points_after, team_score_before, team_score_after, result_before, result_after, result_changed, stat_changes').eq('league_id', state.leagueId).order('recorded_at'),
      'records',
    ))!
  }

  async function posts(): Promise<string[]> {
    const rows = await must(service.from('league_chat').select('message').eq('league_id', state.leagueId).eq('is_system', true).order('created_at'), 'posts')
    return (rows ?? []).map((r) => r.message)
  }

  async function notes(): Promise<Array<{ user: 'A' | 'B'; body: string }>> {
    const rows = await must(service.from('notifications').select('user_id, body').eq('type', 'stat_correction_result').in('user_id', [state.userA, state.userB]).order('body'), 'notifications')
    return (rows ?? []).map((n) => ({ user: n.user_id === state.userA ? ('A' as const) : ('B' as const), body: n.body ?? '' }))
  }

  async function events() {
    return (await must(service.from('stat_correction_events').select('stat_key, old_value, new_value, week_state, applied_at, source').eq('season', season).eq('player_id', c.playerId).order('detected_at'), 'events'))!
  }

  async function storedValue(): Promise<number | null> {
    const row = await must(service.from('player_stats').select('*').eq('season', season).eq('week', 1).eq('player_id', c.playerId).single(), 'player_stats')
    const v = (row as unknown as Record<string, unknown>)[c.statKey]
    return v === null || v === undefined ? null : Number(v)
  }

  async function leagueCells(): Promise<string> {
    const m = await must(service.from('matchups').select('*').eq('league_id', state.leagueId).order('id'), 'matchups')
    const results = await must(service.from('team_week_results').select('*').eq('league_id', state.leagueId).order('team_id').order('week'), 'results')
    const points = await must(service.from('league_week_player_points').select('*').eq('league_id', state.leagueId).order('team_id').order('slot'), 'points')
    const weeks = await must(service.from('league_weeks').select('*').eq('league_id', state.leagueId).order('week'), 'weeks')
    return JSON.stringify({ m, results, points, weeks, records: await records(), posts: await posts(), notes: await notes() })
  }

  async function view(): Promise<StatCorrectionsPage> {
    const r = await readStatCorrections(state.memberClient!, state.leagueId, { week: '1' })
    if (r.status !== 200) throw new Error(`corrections view: ${r.status} ${JSON.stringify(r.body)}`)
    return r.body as unknown as StatCorrectionsPage
  }

  async function advance(at: Date): Promise<string> {
    clock.advanceTo(at)
    const { error } = await service.rpc('league_week_advance', { p_now: at.toISOString(), p_league_id: state.leagueId })
    if (error) throw new Error(`league_week_advance: ${error.message}`)
    return (await must(service.from('league_weeks').select('status').eq('league_id', state.leagueId).eq('week', 1).single(), 'week'))!.status
  }

  async function finalize(): Promise<string> {
    clock.advanceTo(tLock)
    const { error } = await service.rpc('finalize_matchups', { p_now: tLock.toISOString(), p_league_id: state.leagueId })
    if (error) throw new Error(`finalize_matchups: ${error.message}`)
    return (await must(service.from('league_weeks').select('status').eq('league_id', state.leagueId).eq('week', 1).single(), 'week'))!.status
  }

  return { pair, c, season, constructed, state, setup, poll, drain, matchup, records, posts, notes, events, storedValue, leagueCells, view, advance, finalize, t: { tFinal, tSettle, tAdvance, tInWindow, tLock, tLate } }
}


/** "win" / "loss" / "tie" for Team A from the two scores. */
function aResult(a: number, b: number): string {
  return a > b ? 'win' : a < b ? 'loss' : 'tie'
}


// ── R0: the real-capture leg says what it found, in plain words ─────────────
describe('L.E2.6 R0 — the real-capture leg (non-blocking, D468)', () => {
  it('R0 scans fixtures/nfl/2026 and says plainly whether a real correction is replayed', () => {
    console.log(`[L.E2.6 replay] ${SCAN.sentence}`)
    for (const w of SCAN.weeks) console.log(`[L.E2.6 replay]   ${w.sentence}`)
    // The scan READ the capture root (population > 0: week 3's "final" snapshot is committed).
    expect(SCAN.weeks.length).toBeGreaterThan(0)
    expect(SCAN.sentence).toMatch(SCAN.pick === null ? /^NO REAL 2026 CORRECTION CAPTURED YET/ : /^REAL 2026 CORRECTION REPLAYED/)
    // Never a synthetic pair under the real-capture root.
    if (SCAN.pick !== null) expect(SCAN.pick.origin).toBe('real')
  })
})

// ── The arms, for each pair ─────────────────────────────────────────────────
const PAIRS: Array<{ pair: ReplayPair; seasons: { in_window: number; settle_grace?: number; after_window: number } }> = [
  { pair: SYNTHETIC, seasons: { in_window: 2080, settle_grace: 2081, after_window: 2082 } },
  ...(SCAN.pick === null ? [] : [{ pair: SCAN.pick, seasons: { in_window: 2083, after_window: 2085 } }]),
]

for (const { pair, seasons } of PAIRS) {
  const tag = `${pair.origin.toUpperCase()} ${pair.change.name} ${pair.change.statKey} ${pair.change.old} → ${pair.change.new}`

  describe(`L.E2.6 IN THE WINDOW — ${tag}`, () => {
    const s = story(pair, 'in_window', seasons.in_window)
    let before: { a: number; b: number; result: string }
    beforeAll(s.setup, 90_000)

    it('IW1 snapshot 1 (every game final): ordinary scoring — no event, no record, no post; the week advances to its correction window', async () => {
      const r = await s.poll(1, s.t.tFinal)
      expect([r.corrections.detected, r.corrections.settled]).toEqual([0, 0])
      await s.drain()
      const m = await s.matchup()
      before = { a: m.a, b: m.b, result: aResult(m.a, m.b) }
      expect(s.constructed.outcome === 'flip' ? before.result !== 'tie' : before.result === 'tie').toBe(true)
      expect([await s.events(), await s.records(), await s.posts()]).toEqual([[], [], []])
      expect(await s.advance(s.t.tAdvance)).toBe('correction_window')
    })

    it('IW2 snapshot 2, past the settle grace and inside the window: ONE event (open), re-scored — Team A\'s score moves and the result CHANGES', async () => {
      const r = await s.poll(2, s.t.tInWindow)
      expect(r.corrections).toMatchObject({ weekState: 'open', settled: 0 })
      const batch = await s.drain()
      expect(batch.leagues[0].outcome).toBe('written')
      const m = await s.matchup()
      expect(m.a).not.toBe(before.a)
      expect(m.b).toBe(before.b)
      const after = aResult(m.a, m.b)
      expect(after).not.toBe(before.result)
      // The construction (correction-replay.ts item 3): a 2+ unit change FLIPS the matchup; a 1-unit change turns a tie into a result.
      expect(`${before.result}→${after}`).toBe(s.constructed.outcome === 'flip' ? `${before.result}→${before.result === 'win' ? 'loss' : 'win'}` : `tie→${after}`)
      const ev = await s.events()
      expect(ev.filter((e) => e.stat_key === s.c.statKey).map((e) => `${Number(e.old_value)}→${Number(e.new_value)} ${e.week_state} applied=${e.applied_at === null ? 'null' : new Date(e.applied_at).toISOString()}`)).toEqual([
        `${s.c.old}→${s.c.new} open applied=${s.t.tInWindow.toISOString()}`,
      ])
    })

    it('IW3 the league\'s record: ONE row for Team A (the team that started him), points and score before → after, result changed', async () => {
      const m = await s.matchup()
      const rec = await s.records()
      expect(rec).toHaveLength(1)
      const r = rec[0]
      expect([r.team_id, r.player_id, r.result_changed]).toEqual([s.state.teamA, s.c.playerId, true])
      expect([Number(r.team_score_before), Number(r.team_score_after)]).toEqual([before.a, m.a])
      expect((r.stat_changes as Array<{ stat_key: string; old: number; new: number }>).find((x) => x.stat_key === s.c.statKey)).toMatchObject({ old: s.c.old, new: s.c.new })
    })

    it('IW4 ONE league post naming the player and both scores; a notification to each manager whose result changed — the one now losing included — and no one else', async () => {
      const m = await s.matchup()
      const p = await s.posts()
      expect(p).toHaveLength(1)
      expect(p[0]).toContain('Stat correction (Week 1): ')
      expect(p[0]).toContain(`${s.c.name}'s`)
      expect(p[0]).toContain(`Team A ${before.a.toFixed(2)} → ${m.a.toFixed(2)}`)
      expect(p[0]).toContain('Result changed')
      const n = await s.notes()
      // Both managers' h2h result changed (a two-team matchup) — each told once, the post's sentence first.
      expect(n.map((x) => x.user).sort()).toEqual(['A', 'B'])
      for (const x of n) expect(x.body.startsWith('Stat correction (Week 1): ')).toBe(true)
      const nowLosing = aResult(m.a, m.b) === 'loss' ? 'A' : aResult(m.a, m.b) === 'win' ? 'B' : null
      if (nowLosing !== null) expect(n.find((x) => x.user === nowLosing)!.body).toMatch(/now beats you/)
    })

    it('IW5 the corrections view (a member\'s read): the row, in words', async () => {
      const page = await s.view()
      expect(page.items).toHaveLength(1)
      const item = page.items[0]
      expect([item.player.id, item.team.name, item.result.changed]).toEqual([s.c.playerId, 'Team A', true])
      expect(item.stat_changes.find((x) => x.stat_key === s.c.statKey)).toMatchObject({ old: s.c.old, new: s.c.new, words: expect.stringContaining(`${s.c.old} → ${s.c.new}`) })
    })

    it('IW6 the REAL finalize at the window\'s end: final, the stored result is the corrected one, and the REAL rebuild finds no drift', async () => {
      expect(await s.finalize()).toBe('final')
      const m = await s.matchup()
      expect(m.status).toBe('final')
      expect(m.result).toBe(m.a > m.b ? 'home' : m.a < m.b ? 'away' : 'tie')
      const rebuild = await service.rpc('rebuild_team_week_results', { p_league_id: s.state.leagueId, p_week: 1 })
      expect(rebuild.error).toBeNull()
      expect((rebuild.data as { reason: string }).reason).toBe('already_consistent')
    })
  })

  if (seasons.settle_grace !== undefined) {
    const season = seasons.settle_grace
    describe(`L.E2.6 SETTLE GRACE — ${tag}`, () => {
      const s = story(pair, 'settle_grace', season)
      let before: { a: number; result: string }
      beforeAll(s.setup, 90_000)

      it('SG1 snapshot 1 (every game final): ordinary scoring', async () => {
        await s.poll(1, s.t.tFinal)
        await s.drain()
        const m = await s.matchup()
        before = { a: m.a, result: aResult(m.a, m.b) }
        expect(m.a).toBeGreaterThan(0)
      })

      it('SG2 snapshot 2 one hour after the week was seen final: re-scored SILENTLY — the score and result move, but no event, no record, no post, no notification (F511)', async () => {
        const r = await s.poll(2, s.t.tSettle)
        expect([r.corrections.detected, r.corrections.settled]).toEqual([0, 1])
        await s.drain()
        const m = await s.matchup()
        expect(m.a).not.toBe(before.a)
        expect(aResult(m.a, m.b)).not.toBe(before.result)
        expect(await s.storedValue()).toBe(s.c.new)
        expect([await s.events(), await s.records(), await s.posts(), await s.notes()]).toEqual([[], [], [], []])
      })
    })
  }

  describe(`L.E2.6 AFTER THE LOCK — ${tag}`, () => {
    const s = story(pair, 'after_window', seasons.after_window)
    let cells: string
    beforeAll(s.setup, 90_000)

    it('AW1 snapshot 1 scored; the week advances and is FINAL at its window\'s end (the next week\'s first kickoff)', async () => {
      await s.poll(1, s.t.tFinal)
      await s.drain()
      expect(await s.advance(s.t.tAdvance)).toBe('correction_window')
      expect(await s.finalize()).toBe('final')
      cells = await s.leagueCells()
      expect(JSON.parse(cells).m[0].status).toBe('final')
    })

    it('AW2 snapshot 2 after the lock: the event is NFL data (week final), player_stats holds the new value (research), the worker refuses the week (week_final), and every league cell, stored point, record, post and notification is byte-identical', async () => {
      const r = await s.poll(2, s.t.tLate)
      expect(r.corrections).toMatchObject({ weekState: 'final' })
      expect(await s.storedValue()).toBe(s.c.new)
      const batch = await s.drain()
      // The claim first: nothing in the league moved (the probes that disable the lock red HERE).
      expect(await s.leagueCells()).toBe(cells)
      expect(batch.problems).toContain(`[${s.state.leagueId} wk 1] league ${s.state.leagueId} week 1 skipped: week_final`)
      const ev = (await s.events()).filter((e) => e.stat_key === s.c.statKey)
      expect(ev.map((e) => `${Number(e.old_value)}→${Number(e.new_value)} ${e.week_state}`)).toEqual([`${s.c.old}→${s.c.new} final`])
      expect([await s.records(), (await s.posts()).filter((p) => p.startsWith('Stat correction')), await s.notes()]).toEqual([[], [], []])
      expect((await s.view()).items).toEqual([])
    })
  })
}
