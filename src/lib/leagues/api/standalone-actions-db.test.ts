/**
 * standalone-actions-db.test.ts — MP task **MP.6b** at the WIRE layer: the
 * room's verbs driven against a **league-less practice draft**, and the same
 * verbs' **league arm** driven beside them to prove the widening cost a real
 * league nothing (spec v2.16 §8.8; D243(5); tasks-MP §5 MP.6b items 1–7).
 *
 * WHAT WAS BROKEN (live-probed at the MP.6 halt — Q25): every one of the 17
 * service verbs funnels through ONE `resolveDraftForAction`, whose only
 * draft lookup was `.eq('league_id', leagueId)`. `league_id = <uuid>` can
 * never match NULL, so on a standalone mock (095) pick / nominate / bid /
 * pause / resume / queue / queue-from-list all answered 404 — 0 rows against
 * every league in the schema, 1 row by draft id alone.
 *
 * WHAT THIS FILE PINS, in four sections:
 *   §A  the STANDALONE arm: seven verbs, driven by the launcher over the
 *       real PostgREST wire path, on a real snake mock and a real auction
 *       mock, with the ENGINE's bots answering (MP.3/091).
 *       **AMENDED at F121's fix (migration 096).** The nominate and bid
 *       tests were written against an engine on which a standalone auction
 *       had NO bidding — `draft_nomination_uncontestable` scanned
 *       `t.league_id = v_league_id`, so with a NULL league every nomination
 *       was declared uncontestable and awarded instantly at its opening
 *       bid. The bid test named itself as the assertion that would move
 *       (D245(7)) and it has: it is now a real 200 raise over a bot's
 *       standing high bid, with the D128 anti-snipe floor measured on it.
 *   §B  a STRANGER gets the one no-leak 404 on every verb — the same answer
 *       an unknown id gets, so "not yours" and "never existed" are
 *       indistinguishable from the wire.
 *   §C  a mock that HAS a league, and a real league draft, are BOTH
 *       unreachable through the standalone door — the `league_id IS NULL`
 *       conjunct, which is the task's named review question. **THIS IS THE
 *       BREAK-PROBE TARGET** (§4.3): delete that conjunct and this section
 *       goes RED at an exact count while §A and §D stay green.
 *   §D  the LEAGUE arm, unchanged, driven as a MEMBER, a NON-MEMBER and an
 *       EX-MEMBER against a real league's draft — the "provably no more
 *       permissive for a row that HAS a league" half, measured on both
 *       sides of the change (the before-run is the same drive against
 *       `main`'s string-signature; see the PR body).
 *
 * HARNESS (D100, the `mock-auction-db.test.ts` precedent): think-time and
 * timeouts are produced by service-role REWINDS of server-written
 * timestamps between direct `draft_tick()` calls — no wall clock is read
 * anywhere (the D3/D17 ESLint guard covers this file), and the live 5s
 * pg_cron tick is a legal concurrent actor, so assertions are on converged
 * state and never on which caller ticked. The launcher's heartbeat is kept
 * fresh through the real `draft_touch` RPC (a live mock auto-pauses when its
 * launcher goes stale — E59/ARM 1.6).
 *
 * FIXTURE ADP IS FRACTIONAL (R286/F60): every fixture player sits below
 * every real ADP by value, so no CPU can reach a real player.
 *
 * F118: every row this suite mints is removed in `afterAll` and the removal
 * is COUNTED — `032_draft_bids.sql`'s baselines are whole-table.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  LIST_NOT_YOURS_MESSAGE,
  MOCK_NOT_FOUND_STANDALONE_MESSAGE,
  NO_ACTIVE_DRAFT_MESSAGE,
  createDraft,
  launchMockDraft,
  launchStandaloneMockDraft,
  leagueScope,
  makePick,
  nominatePlayer,
  pauseOrResumeDraft,
  placeBid,
  queueFromList,
  standaloneMockScope,
  upsertQueue,
} from './draft-service'
import { claimInvite, createInvite } from './invites-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat, removeMember } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-standalone-actions-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This league's real draft stays
 *  `scheduled` (the §8.8 pre-draft window a league mock launches from). */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8

const LAUNCHER = {
  email: 'sa-launcher@fieldscout.test',
  password: 'pgtap-standalone-1',
  username: 'sa_wire_launcher',
}
const MEMBER = {
  email: 'sa-member@fieldscout.test',
  password: 'pgtap-standalone-2',
  username: 'sa_wire_member',
}
const EX = {
  email: 'sa-ex@fieldscout.test',
  password: 'pgtap-standalone-3',
  username: 'sa_wire_ex',
}
const STRANGER = {
  email: 'sa-stranger@fieldscout.test',
  password: 'pgtap-standalone-4',
  username: 'sa_wire_stranger',
}
const USERS = [LAUNCHER, MEMBER, EX, STRANGER]

/** 60 RBs at adp 0.001…0.060 — below every real ADP (see the header). The
 *  pool is deliberately DEEPER than the board (32 slots): a CPU whose roster
 *  need has run out stops bidding, and a genuinely uncontested nomination is
 *  still awarded instantly (§8.6.9/093 — 096 restored the predicate's team
 *  set, it did not soften the rule), which would leave the bid verb below
 *  nothing to raise on. Depth is what keeps the market contested. */
const PLAYERS = Array.from({ length: 60 }, (_, i) => ({
  id: `sa-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `SA Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 1000,
}))
const PLAYER_IDS = PLAYERS.map((p) => p.id)

const LAUNCHER_LIST_SLUG = 'sa-wire-launcher-list'
const STRANGER_LIST_SLUG = 'sa-wire-stranger-list'

const ACTION = {
  leagueCreate: 'ab600000-0000-4000-8000-000000000001',
  snake: 'ab600000-0000-4000-8000-000000000002',
  auction: 'ab600000-0000-4000-8000-000000000003',
  leagueMock: 'ab600000-0000-4000-8000-000000000004',
  pick: 'ab600000-0000-4000-8000-000000000005',
  nominate: 'ab600000-0000-4000-8000-000000000006',
  bid: 'ab600000-0000-4000-8000-000000000007',
  strangerPick: 'ab600000-0000-4000-8000-000000000008',
  strangerNominate: 'ab600000-0000-4000-8000-000000000009',
  strangerBid: 'ab600000-0000-4000-8000-00000000000a',
  crossPick: 'ab600000-0000-4000-8000-00000000000b',
  crossNominate: 'ab600000-0000-4000-8000-00000000000c',
  crossBid: 'ab600000-0000-4000-8000-00000000000d',
  leagueDraftPick: 'ab600000-0000-4000-8000-00000000000e',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let launcherClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let exClient: SupabaseClient<Database>
let strangerClient: SupabaseClient<Database>
let launcherId: string
let memberId: string
let exId: string
let strangerId: string

let leagueId: string
/** The league's REAL (non-mock) draft — §D's subject. */
let leagueDraftId: string
/** A mock that HAS a league, launched by the SAME user — §C's sharpest case:
 *  the launcher predicate matches it, and ONLY `league_id IS NULL` refuses. */
let leagueMockId: string
let snakeMockId: string
let snakeHumanTeamId: string
let auctionMockId: string
let auctionHumanTeamId: string
let launcherListId: string
let strangerListId: string

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<void> {
  const { error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
}

async function signIn(user: {
  email: string
  password: string
}): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function userIdFor(username: string): Promise<string> {
  const { data, error } = await service
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single()
  if (error) throw new Error(`profile lookup failed for ${username}: ${error.message}`)
  return data.id
}

/** F118: what this suite left behind, counted rather than assumed. */
async function residue(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const { count: drafts } = await service
    .from('drafts')
    .select('id', { count: 'exact', head: true })
    .in('id', [snakeMockId, auctionMockId, leagueMockId, leagueDraftId].filter(Boolean))
  counts.drafts = drafts ?? 0
  const { count: standaloneTeams } = await service
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .is('league_id', null)
    .in('owner_id', [launcherId, memberId, exId, strangerId].filter(Boolean))
  counts.standalone_teams = standaloneTeams ?? 0
  const { count: bids } = await service
    .from('draft_bids')
    .select('id', { count: 'exact', head: true })
  counts.draft_bids_whole_table = bids ?? 0
  const { count: leagues } = await service
    .from('leagues')
    .select('id', { count: 'exact', head: true })
    .eq('name', LEAGUE_NAME)
  counts.leagues = leagues ?? 0
  return counts
}

async function cleanup(): Promise<void> {
  const ids = [launcherId, memberId, exId, strangerId].filter(Boolean)
  // Chat first: a standalone mock's D97 system posts carry a NULL league_id
  // (095/F109(c)), so no league CASCADE can reach them.
  const contexts = [snakeMockId, auctionMockId, leagueMockId, leagueDraftId]
    .filter(Boolean)
    .map((id) => `draft:${id}`)
  if (contexts.length > 0) {
    await service.from('league_chat').delete().in('context', contexts)
  }
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const leagueIds = (stale ?? []).map((row) => row.id)
  if (leagueIds.length > 0) {
    await service.from('league_rosters').delete().in('league_id', leagueIds)
    await service.from('drafts').delete().in('league_id', leagueIds)
    await service.from('teams').delete().in('league_id', leagueIds)
    await service.from('leagues').delete().in('id', leagueIds)
  }
  if (ids.length > 0) {
    // Standalone mocks + the bot seats they minted (owner-scoped, league-less).
    const { data: mine } = await service
      .from('drafts')
      .select('id')
      .is('league_id', null)
      .eq('is_mock', true)
    const mineIds = (mine ?? []).map((row) => row.id)
    if (mineIds.length > 0) await service.from('drafts').delete().in('id', mineIds)
    await service.from('teams').delete().is('league_id', null).in('owner_id', ids)
    await service.from('lists').delete().in('owner_id', ids)
  }
  await service.from('players').delete().in('id', PLAYER_IDS)
  for (const u of USERS) {
    const { data } = await service.from('profiles').select('id').eq('username', u.username)
    for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
  }
}

async function readDraft(id: string): Promise<DraftRow> {
  const { data, error } = await service.from('drafts').select('*').eq('id', id).single()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data as DraftRow
}

/** `draft_tick`'s own report (093:1670-1685). The auction CPU counters are
 *  what F121 was measured WITH — `auction_cpu_raised: 0` over a 12-tick
 *  drive was the wire half of the finding — so the fixed suite reads them
 *  rather than inferring bidding from the board. */
type TickSummary = {
  auction_cpu_claimed: number
  auction_cpu_raised: number
  auction_cpu_folded: number
  auction_cpu_nominated: number
  auction_cpu_failures: unknown[]
  auction_failures: unknown[]
}

async function tick(): Promise<TickSummary> {
  const { data, error } = await service.rpc('draft_tick')
  if (error) throw new Error(`draft_tick failed: ${error.message}`)
  return data as unknown as TickSummary
}

/** The launcher's heartbeat, through the real RPC (server clock). */
async function beat(draftId: string): Promise<void> {
  const { error } = await launcherClient.rpc('draft_touch', { p_draft_id: draftId })
  expect(error).toBeNull()
}

/** Shift a SERVER timestamp by `ms` (negative = rewind). No wall clock. */
function shifted(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

/** Rewind the draft's own deadline past expiry so the next tick acts. */
async function expireClock(draftId: string, draft: DraftRow): Promise<void> {
  if (draft.current_deadline === null) return
  await service
    .from('drafts')
    .update({ current_deadline: shifted(draft.current_deadline, -600_000) })
    .eq('id', draftId)
    .eq('status', 'live')
}

/**
 * Drive the engine until the HUMAN seat is the one being asked to act, then
 * stop — the human's own clock is never rewound (that would hand their turn
 * to the autopick/system-nominate arm the suite is trying to reach).
 */
async function advanceToHumanTurn(draftId: string, humanTeamId: string): Promise<DraftRow> {
  let draft = await readDraft(draftId)
  for (let guard = 0; guard < 60; guard += 1) {
    if (draft.status !== 'live') throw new Error(`draft ${draftId} is ${draft.status}, not live`)
    if (draft.on_clock_team_id === humanTeamId && draft.current_nomination === null) return draft
    await beat(draftId)
    await expireClock(draftId, draft)
    await tick()
    draft = await readDraft(draftId)
  }
  throw new Error(`never reached the human's turn on ${draftId}`)
}

/** The four settings blocks a standalone launch sends (MP.4's object). */
function standaloneSettings(
  scoringSystemId: string,
  draftType: 'snake' | 'auction',
): Record<string, unknown> {
  const defaults = defaultsForTeamCount(TEAM_COUNT)
  return {
    team_count: TEAM_COUNT,
    roster_settings: {
      starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 2 }],
      bench: 2,
      ir_slots: [],
      swap_spots: 0,
    },
    draft: {
      ...defaults.draft,
      draft_type: draftType,
      draft_order_mode: 'random',
      draft_order: [],
      nomination_order_mode: 'same_as_draft_order',
      auction_budget: 50,
      auction_zero_dollar_nominations: false,
      auction_nomination_seconds: 30,
      auction_bid_seconds: 20,
      auction_anti_snipe_seconds: 10,
      pick_timer_seconds: 90,
      disconnect_grace_seconds: 30,
      draft_scheduled_at: null,
      scoring_system_id: scoringSystemId,
    },
  }
}

beforeAll(async () => {
  await cleanup()
  for (const u of USERS) await createUser(u)
  launcherClient = await signIn(LAUNCHER)
  memberClient = await signIn(MEMBER)
  exClient = await signIn(EX)
  strangerClient = await signIn(STRANGER)
  launcherId = await userIdFor(LAUNCHER.username)
  memberId = await userIdFor(MEMBER.username)
  exId = await userIdFor(EX.username)
  strangerId = await userIdFor(STRANGER.username)

  await service.from('players').upsert([...PLAYERS])

  const { data: template, error: templateError } = await launcherClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (templateError) throw new Error(`template lookup failed: ${templateError.message}`)
  const scoringSystemId = template.id

  // ---- the LEAGUE half (§C's cross-door rows and §D's three roles) -------
  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: created, error: createError } = await launcherClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: scoringSystemId,
    p_team_name: 'SA Commish',
    p_action_id: ACTION.leagueCreate,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  for (const [user, client, name] of [
    [MEMBER, () => memberClient, 'Seat for member'],
    [EX, () => exClient, 'Seat for ex'],
  ] as const) {
    const seat = await addPlaceholderSeat(launcherClient, leagueId, { team_name: name })
    if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
    const invite = await createInvite(launcherClient, leagueId, {
      target_team_id: (seat.body as { team_id: string }).team_id,
      invited_username: user.username,
    })
    if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
    const claim = await claimInvite(client(), { token: (invite.body as { token: string }).token })
    if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
  }
  for (let i = 0; i < TEAM_COUNT - 3; i += 1) {
    const fill = await addPlaceholderSeat(launcherClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
  }

  const configured = await patchLeague(launcherClient, leagueId, {
    settings: {
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'random',
        pick_timer_seconds: 300,
        disconnect_grace_seconds: 30,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(launcherClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }
  // A SCHEDULED real draft — never started, so the league stays in the §8.8
  // pre-draft window a league mock launches from, and §D still has a real
  // league-owned `drafts` row to drive the league arm against.
  const realDraft = await createDraft(launcherClient, leagueId)
  if (realDraft.status !== 201 && realDraft.status !== 200) {
    throw new Error(`draft_create failed: ${JSON.stringify(realDraft.body)}`)
  }
  leagueDraftId = (realDraft.body as unknown as { draft: DraftRow }).draft.id

  const leagueMock = await launchMockDraft(
    launcherClient,
    leagueId,
    { cpu_speed: 'fast' },
    { mintActionId: () => ACTION.leagueMock },
  )
  if (leagueMock.status !== 201) throw new Error(`league mock failed: ${JSON.stringify(leagueMock.body)}`)
  leagueMockId = (leagueMock.body as unknown as { draft: DraftRow }).draft.id

  // ---- the STANDALONE half (§A/§B) --------------------------------------
  const snake = await launchStandaloneMockDraft(
    launcherClient,
    { cpu_speed: 'fast', settings: standaloneSettings(scoringSystemId, 'snake') },
    { mintActionId: () => ACTION.snake },
  )
  if (snake.status !== 201) throw new Error(`standalone snake failed: ${JSON.stringify(snake.body)}`)
  const snakeDraft = (snake.body as unknown as { draft: DraftRow }).draft
  snakeMockId = snakeDraft.id
  snakeHumanTeamId = (snakeDraft.config as { mock: { human_team_id: string } }).mock.human_team_id

  const auction = await launchStandaloneMockDraft(
    launcherClient,
    { cpu_speed: 'fast', settings: standaloneSettings(scoringSystemId, 'auction') },
    { mintActionId: () => ACTION.auction },
  )
  if (auction.status !== 201) {
    throw new Error(`standalone auction failed: ${JSON.stringify(auction.body)}`)
  }
  const auctionDraft = (auction.body as unknown as { draft: DraftRow }).draft
  auctionMockId = auctionDraft.id
  auctionHumanTeamId = (auctionDraft.config as { mock: { human_team_id: string } }).mock
    .human_team_id

  // Two lists: the launcher's own (loadable) and the stranger's (not).
  const { data: myList, error: myListError } = await launcherClient
    .from('lists')
    .insert({
      owner_id: launcherId,
      title: 'SA launcher list',
      slug: LAUNCHER_LIST_SLUG,
      is_private: true,
    })
    .select('id')
    .single()
  if (myListError) throw new Error(`launcher list insert failed: ${myListError.message}`)
  launcherListId = myList.id
  const { error: myPlayersError } = await launcherClient.from('list_players').insert(
    PLAYER_IDS.slice(0, 3).map((player_id, i) => ({
      list_id: launcherListId,
      player_id,
      position: i + 1,
      overall_rank: i + 1,
    })),
  )
  if (myPlayersError) throw new Error(`launcher list players failed: ${myPlayersError.message}`)

  const { data: theirList, error: theirListError } = await strangerClient
    .from('lists')
    .insert({
      owner_id: strangerId,
      title: 'SA stranger list',
      slug: STRANGER_LIST_SLUG,
      is_private: false,
    })
    .select('id')
    .single()
  if (theirListError) throw new Error(`stranger list insert failed: ${theirListError.message}`)
  strangerListId = theirList.id
}, 240_000)

afterAll(async () => {
  await cleanup()
})

// ===========================================================================
// §A — the standalone arm: the seven verbs a practice room needs
// ===========================================================================
describe('§A a standalone practice draft can be DRIVEN (MP.6b)', () => {
  it('queue: the launcher writes their own queue on a league-less mock', async () => {
    const result = await upsertQueue(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      launcherId,
      { draft_id: snakeMockId, players: PLAYER_IDS.slice(0, 4) },
    )
    expect(result.status).toBe(200)
    const body = result.body as unknown as {
      draft_id: string
      team_id: string
      queue: { player_id: string; rank: number }[]
    }
    expect(body.draft_id).toBe(snakeMockId)
    // The acting seat is the LAUNCHER's human seat (D103(3)) — resolved by
    // `resolveActingSeat`'s shipped mock arm, with no league to read.
    expect(body.team_id).toBe(snakeHumanTeamId)
    expect(body.queue.map((row) => row.player_id)).toEqual(PLAYER_IDS.slice(0, 4))
  }, 60_000)

  it('queue-from-list: a list the caller OWNS loads; a list they do not own is refused', async () => {
    const loaded = await queueFromList(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      launcherId,
      launcherListId,
      { draft_id: snakeMockId, mode: 'replace' },
    )
    expect(loaded.status).toBe(200)
    const body = loaded.body as unknown as { added: number; queue: { player_id: string }[] }
    expect(body.added).toBe(3)
    expect(body.queue.map((row) => row.player_id)).toEqual(PLAYER_IDS.slice(0, 3))

    // §8.9's scoping mechanism is the league TAG and there is no league here,
    // so the standalone arm scopes by OWNERSHIP — and it is the narrow
    // reading: this list is PUBLIC and readable, and is still refused.
    const foreign = await queueFromList(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      launcherId,
      strangerListId,
      { draft_id: snakeMockId },
    )
    expect(foreign.status).toBe(404)
    expect((foreign.body as { error: string }).error).toBe(LIST_NOT_YOURS_MESSAGE)
  }, 60_000)

  it('pause + resume: the launcher holds their own mock’s lifecycle, and the D97 system posts land', async () => {
    const paused = await pauseOrResumeDraft(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      { draft_id: snakeMockId, action: 'pause', reason: 'MP.6b wire drive' },
    )
    expect(paused.status).toBe(200)
    expect((await readDraft(snakeMockId)).status).toBe('paused')

    const resumed = await pauseOrResumeDraft(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      { draft_id: snakeMockId, action: 'resume', reason: 'MP.6b wire drive' },
    )
    expect(resumed.status).toBe(200)
    expect((await readDraft(snakeMockId)).status).toBe('live')

    // The posts EXIST with a NULL league_id (095/F109(c)) — the server half
    // of F114. Whether the room's chat pane asks for them is MP.6c's.
    const { count } = await service
      .from('league_chat')
      .select('id', { count: 'exact', head: true })
      .eq('context', `draft:${snakeMockId}`)
      .is('league_id', null)
    expect(count ?? 0).toBeGreaterThan(0)
  }, 60_000)

  it('pick: the engine hands the human seat the clock and the launcher picks', async () => {
    const onClock = await advanceToHumanTurn(snakeMockId, snakeHumanTeamId)
    expect(onClock.on_clock_team_id).toBe(snakeHumanTeamId)
    // The bots got there first — the engine acted with no league in sight.
    const { count: before } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', snakeMockId)
      .eq('is_undone', false)
    expect(before ?? 0).toBe((onClock.current_pick_number as number) - 1)

    const { data: taken } = await service
      .from('draft_picks')
      .select('player_id')
      .eq('draft_id', snakeMockId)
      .eq('is_undone', false)
    const gone = new Set((taken ?? []).map((row) => row.player_id))
    const free = PLAYER_IDS.find((id) => !gone.has(id))
    expect(free).toBeDefined()

    const picked = await makePick(
      launcherClient,
      standaloneMockScope(snakeMockId, launcherId),
      { draft_id: snakeMockId, player_id: free, action_id: ACTION.pick },
    )
    expect(picked.status).toBe(200)
    const { data: mine } = await service
      .from('draft_picks')
      .select('player_id, team_id')
      .eq('draft_id', snakeMockId)
      .eq('player_id', free as string)
      .single()
    expect(mine?.team_id).toBe(snakeHumanTeamId)
  }, 180_000)

  it('nominate: the launcher opens a market on a league-less auction — and a bot ANSWERS it (F121)', async () => {
    const onClock = await advanceToHumanTurn(auctionMockId, auctionHumanTeamId)
    expect(onClock.on_clock_team_id).toBe(auctionHumanTeamId)

    const { data: won } = await service
      .from('draft_picks')
      .select('player_id')
      .eq('draft_id', auctionMockId)
      .eq('is_undone', false)
    const gone = new Set((won ?? []).map((row) => row.player_id))
    const free = PLAYER_IDS.find((id) => !gone.has(id))
    expect(free).toBeDefined()

    const nominated = await nominatePlayer(
      launcherClient,
      standaloneMockScope(auctionMockId, launcherId),
      launcherId,
      {
        draft_id: auctionMockId,
        player_id: free,
        opening_bid: 1,
        action_id: ACTION.nominate,
      },
    )
    expect(nominated.status).toBe(200)
    const opened = nominated.body as unknown as {
      draft: DraftRow
      bid: { team_id: string; amount: number }
    }
    // The opening bid was placed FOR the human seat (the mock arm of
    // `resolveActingSeat`, which the F65 integrity check discriminates on).
    expect(opened.bid.team_id).toBe(auctionHumanTeamId)
    expect(opened.bid.amount).toBe(1)

    // ---------------------------------------------------------------------
    // F121, FIXED BY MIGRATION 096 — and this is the assertion that MOVED.
    //
    // It used to read `expect(settled.current_nomination).toBeNull()` and
    // pin the instant award, because `draft_nomination_uncontestable`
    // (093:590-652) scanned `FROM public.teams t WHERE t.league_id =
    // v_league_id`: with a NULL league that matched NO seat, `NOT EXISTS`
    // was TRUE, and §8.6.9's instant award fired on EVERY nomination. 096
    // gave the predicate a `league_id IS NULL` arm over the mock's OWN
    // `drafts.draft_order` (095 banner item 4's idiom), so a $1 opening on
    // a board of $47-max-bid rivals is now what it always should have been:
    // an ordinary nomination with a live clock.
    // ---------------------------------------------------------------------
    const settled = await readDraft(auctionMockId)
    expect(settled.current_nomination).not.toBeNull()
    const market = settled.current_nomination as unknown as {
      player_id: string
      high_bid: number
      high_bidder_team_id: string
    }
    expect(market.player_id).toBe(free)
    // NOT awarded: no pick row exists for the nominated player.
    const { count: awarded } = await service
      .from('draft_picks')
      .select('player_id', { count: 'exact', head: true })
      .eq('draft_id', auctionMockId)
      .eq('player_id', free as string)
    expect(awarded).toBe(0)
  }, 180_000)

  it('bid: the launcher RAISES a bot on their own practice auction, and the raise floors the clock (D128)', async () => {
    // WHAT THIS TEST USED TO BE: a pin on the ENGINE's 400, with a comment
    // naming itself as the assertion that moves when F121 is fixed
    // (D245(7)). F121 is fixed by migration 096, so it moved — this is a
    // real 200 raise over a bot's standing high bid, driven end to end:
    // nominate -> the AP.3 responder answers -> the human raises -> the D128
    // anti-snipe floor extends the clock.
    //
    // HARNESS (D100, unchanged): no wall clock is read. CPU think-time is
    // made due by rewinding the SERVER-written `updated_at`.
    //
    // WHY THE WHOLE DRIVE IS A RETRY LOOP AND NOT A STRAIGHT LINE — measured,
    // not defensive: `draft_tick()` is GLOBAL, the live 5s pg_cron runs it,
    // and every other stack-backed suite in `npm run test` runs it too. A
    // market opened in one round trip is not guaranteed to still be live in
    // the next, and the first cut of this test passed alone and failed 400
    // ("just went off the board") in the full run, twice. The assertion is
    // therefore on CONVERGED state — that a human raise over a bot lands and
    // floors the clock — never on a particular market surviving.
    const freePlayer = async (): Promise<string> => {
      const { data: won } = await service
        .from('draft_picks')
        .select('player_id')
        .eq('draft_id', auctionMockId)
        .eq('is_undone', false)
      const gone = new Set((won ?? []).map((row) => row.player_id))
      const free = PLAYER_IDS.find((id) => !gone.has(id))
      if (free === undefined) throw new Error('the fixture pool is exhausted')
      return free
    }
    const provoke = async (draft: DraftRow): Promise<void> => {
      await beat(auctionMockId)
      await service
        .from('drafts')
        // -180s, not -30s: the base value may carry F113's +90s freeze from
        // a failed attempt, and the rewind must land in the past either way.
        .update({ updated_at: shifted(draft.updated_at as string, -180_000) })
        .eq('id', auctionMockId)
        .eq('status', 'live')
      const summary = await tick()
      expect(summary.auction_cpu_failures).toEqual([])
      expect(summary.auction_failures).toEqual([])
    }

    type LiveMarket = { player_id: string; high_bid: number; high_bidder_team_id: string }
    let landed: {
      before: LiveMarket
      windowed: string
      body: { bid: { team_id: string; amount: number; action_id: string | null } }
    } | null = null

    for (let attempt = 0; attempt < 12 && landed === null; attempt += 1) {
      let market = await readDraft(auctionMockId)
      expect(market.status).toBe('live')

      if (market.current_nomination === null) {
        await advanceToHumanTurn(auctionMockId, auctionHumanTeamId)
        const opened = await nominatePlayer(
          launcherClient,
          standaloneMockScope(auctionMockId, launcherId),
          launcherId,
          {
            draft_id: auctionMockId,
            player_id: await freePlayer(),
            opening_bid: 1,
            action_id: crypto.randomUUID(),
          },
        )
        expect(opened.status).toBe(200)
        market = await readDraft(auctionMockId)
        if (market.current_nomination === null) continue
      }

      // PROVOKED, NOT SWEPT (§8.8/D200(1)): 091/AP.3 calls the responder from
      // the ONE bid writer, so the ladder normally runs inside
      // `draft_nominate`'s own transaction and the market is already
      // contested. If a bot has not answered yet, the sweep is driven until
      // one has — the safety net doing the same job.
      const preFreeze = market.current_nomination as unknown as LiveMarket
      if (preFreeze.high_bidder_team_id === auctionHumanTeamId) {
        await provoke(market)
        continue
      }

      // F113 (MP.11): FREEZE the CPUs across the read-then-bid pair — the
      // same mechanism `auction-api-db.test.ts` carries, because this is the
      // same read-then-bid pair on the standalone door (R539 widened the row
      // to the mechanism). CPU think-time rides the SERVER-written
      // `updated_at` (that is what `provoke` rewinds), so pushing it 90s
      // into the future makes every bot undue for the whole pair; a
      // successful RPC writes `updated_at = now()`, unfreezing them, and a
      // failed attempt leaves the freeze in place for the next loop pass.
      // The freeze happens only on the branch that BIDS — the provoke branch
      // above needs the bots live. The market is re-read INSIDE the frozen
      // window so the amount below cannot be stale.
      await service
        .from('drafts')
        .update({ updated_at: shifted(market.updated_at as string, 90_000) })
        .eq('id', auctionMockId)
        .eq('status', 'live')
      market = await readDraft(auctionMockId)
      if (market.status !== 'live' || market.current_nomination === null) continue
      const nomination = market.current_nomination as unknown as LiveMarket
      if (nomination.high_bidder_team_id === auctionHumanTeamId) continue

      // ~9s on the SERVER-written clock: inside the 10s anti-snipe window,
      // with as much margin as the window allows.
      const windowed = shifted(market.current_deadline as string, -(20 - 9) * 1_000)
      const { error: windowError } = await service
        .from('drafts')
        .update({ current_deadline: windowed })
        .eq('id', auctionMockId)
        .eq('status', 'live')
      expect(windowError).toBeNull()

      const raise = await placeBid(
        launcherClient,
        standaloneMockScope(auctionMockId, launcherId),
        launcherId,
        {
          draft_id: auctionMockId,
          amount: nomination.high_bid + 1,
          nomination_seq: market.current_pick_number as number,
          player_id: nomination.player_id,
          action_id: ACTION.bid,
        },
      )
      if (raise.status !== 200) {
        // TWO tolerated losses, both terminal states of THIS market and not
        // defects (R545): (1) the market went off the board under a
        // concurrent tick; (2) the provoked bot ladder ratcheted `high_bid`
        // to (or past) the launcher's own §8.6.1 max, so `high_bid + 1` is
        // the budget refusal — observed reproducibly (2 of 6 isolated runs
        // RED at this line before this arm existed), and plausibly
        // accelerated by the -180s provoke rewind above, which makes more
        // bots overdue per tick and the ladder climb faster. Anything else
        // is a real refusal and fails here.
        const message = (raise.body as { error: string }).error
        expect(raise.status).toBe(400)
        expect(message).toMatch(/off the board|over your max bid/)
        if (/over your max bid/.test(message)) {
          // Close the ratcheted market and move on: the nomination clock is
          // deadline-keyed (not think-keyed), so rewinding the deadline and
          // ticking awards it to the standing high bot, and the next loop
          // pass nominates a fresh $1 player the ladder has not touched.
          const stuck = await readDraft(auctionMockId)
          if (stuck.status === 'live' && stuck.current_nomination !== null) {
            await service
              .from('drafts')
              .update({
                current_deadline: shifted(stuck.current_deadline as string, -600_000),
              })
              .eq('id', auctionMockId)
              .eq('status', 'live')
            await tick()
          }
        }
        continue
      }
      landed = {
        before: nomination,
        windowed,
        body: raise.body as unknown as {
          bid: { team_id: string; amount: number; action_id: string | null }
        },
      }
    }

    expect(landed).not.toBeNull()
    const won = landed as NonNullable<typeof landed>

    // THE 200 ITSELF — the assertion D245(7) said would move.
    expect(won.body.bid.team_id).toBe(auctionHumanTeamId)
    expect(won.body.bid.amount).toBe(won.before.high_bid + 1)
    // A HUMAN raise carries the caller's action_id; a CPU's is NULL (D130).
    expect(won.body.bid.action_id).toBe(ACTION.bid)
    // …and it is a ROW, exactly one, on the human's seat.
    const { data: mine } = await service
      .from('draft_bids')
      .select('team_id, amount, action_id')
      .eq('draft_id', auctionMockId)
      .eq('action_id', ACTION.bid)
    expect(mine?.length).toBe(1)
    expect(mine?.[0].team_id).toBe(auctionHumanTeamId)
    expect(mine?.[0].amount).toBe(won.before.high_bid + 1)

    // D128: the raise floors the deadline to server-now + 10s — later than
    // the windowed value, and NOT a reset to the full 20s bid clock. Read off
    // the RPC's OWN returned draft, so a concurrent tick cannot move it
    // between the write and the assertion.
    const floored = (won.body as unknown as { draft: DraftRow }).draft
    const flooredMs = Date.parse(floored.current_deadline as string)
    expect(flooredMs).toBeGreaterThan(Date.parse(won.windowed))
    expect(flooredMs - Date.parse(floored.updated_at as string)).toBeLessThanOrEqual(10 * 1_000 + 50)
    expect(flooredMs - Date.parse(floored.updated_at as string)).toBeGreaterThanOrEqual(
      10 * 1_000 - 1_000,
    )

    // ---------------------------------------------------------------------
    // THE INVERTED WIRE MEASUREMENT — AND IT IS NOT THE COUNTER THE F121 ROW
    // ASKED FOR, BECAUSE THE ENGINE MEASURABLY DOES NOT WORK THAT WAY.
    //
    // F121's evidence was a 12-tick drive reporting `auction_cpu_raised: 0`
    // with one bid and one pick per nomination. The obvious inversion is
    // "assert the tick counter goes positive" — and it does not, for a
    // reason that is 091/AP.3's design rather than a defect: the responder is
    // called from the ONE bid writer, so EVERY bid in a mock auction provokes
    // its answer INSIDE the same transaction (091:715-733, "not three call
    // sites remembered to"). The tick's ARM 2.6(c) is the no-actor SAFETY
    // NET, and on a market the in-transaction ladder has already settled it
    // correctly reports `raised: 0` / `folded: n`. MEASURED, not assumed: a
    // 60-pass sweep drive over this mock reported
    // `{ claimed: 0, raised: 0, nominated: 0 }` with the clock expired (the
    // arm re-verifies `current_deadline > now()` under the lock) and
    // `{ claimed: 3, raised: 0 }` with it live.
    //
    // So the counter is asserted the way `mock-auction-db.test.ts` asserts
    // the same thing on a LEAGUE mock — the FOLD, POSITIVELY: the arm claimed
    // the standalone row, priced the settled market and declined. A zero
    // payload from an arm that never claimed the row would read as agreement
    // (CLAUDE.md, "never let nothing happened mean it worked"), and that is
    // exactly the shape F121 hid behind.
    // ---------------------------------------------------------------------
    let swept: TickSummary | null = null
    for (let attempt = 0; attempt < 8 && swept === null; attempt += 1) {
      const live = await readDraft(auctionMockId)
      if (live.status !== 'live' || live.current_nomination === null) {
        await advanceToHumanTurn(auctionMockId, auctionHumanTeamId)
        await nominatePlayer(
          launcherClient,
          standaloneMockScope(auctionMockId, launcherId),
          launcherId,
          {
            draft_id: auctionMockId,
            player_id: await freePlayer(),
            opening_bid: 1,
            action_id: crypto.randomUUID(),
          },
        )
        continue
      }
      await beat(auctionMockId)
      await service
        .from('drafts')
        .update({ updated_at: shifted(live.updated_at as string, -30_000) })
        .eq('id', auctionMockId)
        .eq('status', 'live')
      const summary = await tick()
      expect(summary.auction_cpu_failures).toEqual([])
      if (summary.auction_cpu_claimed > 0) swept = summary
    }
    expect(swept).not.toBeNull()
    const sweep = swept as NonNullable<typeof swept>
    expect(sweep.auction_cpu_claimed).toBeGreaterThan(0)
    expect(sweep.auction_cpu_folded).toBeGreaterThan(0)
    expect(sweep.auction_cpu_raised).toBe(0)

    // AND THE HEADLINE, FROM THE ROWS RATHER THAN A COUNTER: a bot ANSWERED
    // a market on a league-less auction. Before 096 no bot ever could — every
    // nomination was declared uncontestable and awarded at its opening bid
    // before anyone had the chance.
    //
    // WHAT "A RAISE" HAS TO MEAN HERE, AND THE FIRST CUT GOT IT WRONG (R527).
    // It filtered `action_id === null && team_id !== human` and called the
    // result raises. That also matches the row `draft_system_nominate_internal`
    // writes for EVERY CPU NOMINATION — the $1 opening bid, on the on-clock
    // CPU seat, with a NULL action_id by design (093:2090-2094; the column is
    // NULLable precisely for the system path). So the pin could not fail for
    // the reason its comment gave: with F121 ACTIVE, a 30-tick drive produces
    // six such rows and not one of them is an answer to anything.
    //
    // A RAISE IS A SECOND BID ON THE SAME NOMINATION. `nomination_seq` groups
    // the market and the opening bid is its cheapest row, so a raise is any
    // bid strictly above its own nomination's minimum — the one shape a board
    // of instant awards can never produce, because an instantly-awarded
    // nomination has exactly one bid.
    const { data: allBids } = await service
      .from('draft_bids')
      .select('team_id, amount, action_id, nomination_seq')
      .eq('draft_id', auctionMockId)
      .is('voided_at', null)
    const opening = new Map<number, number>()
    for (const b of allBids ?? []) {
      const seq = b.nomination_seq as number
      const low = opening.get(seq)
      if (low === undefined || b.amount < low) opening.set(seq, b.amount)
    }
    const botRaisesOverall = (allBids ?? []).filter(
      (b) =>
        b.action_id === null &&
        b.team_id !== auctionHumanTeamId &&
        b.amount > (opening.get(b.nomination_seq as number) as number),
    )
    expect(botRaisesOverall.length).toBeGreaterThan(0)
    // …and the market it answered had more than one bid in it, stated
    // separately so the count above cannot be satisfied by a single row that
    // some later refactor reclassifies.
    const contestedMarkets = new Set(botRaisesOverall.map((b) => b.nomination_seq))
    expect(contestedMarkets.size).toBeGreaterThan(0)
  }, 180_000)
})

// ===========================================================================
// §B — a stranger gets ONE answer, on every verb
// ===========================================================================
describe('§B someone else’s practice is not another user’s to drive (D226(3))', () => {
  const notFound = (result: { status: number; body: unknown }) => {
    expect(result.status).toBe(404)
    expect((result.body as { error: string }).error).toBe(MOCK_NOT_FOUND_STANDALONE_MESSAGE)
  }

  it('all seven verbs answer the launcher-only no-leak 404 for a stranger', async () => {
    const scope = () => standaloneMockScope(snakeMockId, strangerId)
    notFound(
      await makePick(strangerClient, scope(), {
        draft_id: snakeMockId,
        player_id: PLAYER_IDS[9],
        action_id: ACTION.strangerPick,
      }),
    )
    notFound(
      await upsertQueue(strangerClient, scope(), strangerId, {
        draft_id: snakeMockId,
        players: [PLAYER_IDS[9]],
      }),
    )
    notFound(
      await queueFromList(strangerClient, scope(), strangerId, strangerListId, {
        draft_id: snakeMockId,
      }),
    )
    notFound(
      await pauseOrResumeDraft(strangerClient, scope(), {
        draft_id: snakeMockId,
        action: 'pause',
      }),
    )
    notFound(
      await pauseOrResumeDraft(strangerClient, scope(), {
        draft_id: snakeMockId,
        action: 'resume',
      }),
    )
    const auctionScope = standaloneMockScope(auctionMockId, strangerId)
    notFound(
      await nominatePlayer(strangerClient, auctionScope, strangerId, {
        draft_id: auctionMockId,
        player_id: PLAYER_IDS[9],
        opening_bid: 1,
        action_id: ACTION.strangerNominate,
      }),
    )
    notFound(
      await placeBid(strangerClient, auctionScope, strangerId, {
        draft_id: auctionMockId,
        amount: 2,
        nomination_seq: 1,
        player_id: PLAYER_IDS[9],
        action_id: ACTION.strangerBid,
      }),
    )

    // …and the mock is untouched by any of it.
    expect((await readDraft(snakeMockId)).status).toBe('live')
  }, 120_000)

  it('an unknown id and a malformed id answer the SAME 404 — nothing distinguishes them', async () => {
    notFound(
      await upsertQueue(
        launcherClient,
        standaloneMockScope('00000000-0000-4000-8000-0000000000ff', launcherId),
        launcherId,
        { players: [] },
      ),
    )
    notFound(
      await upsertQueue(launcherClient, standaloneMockScope('not-a-uuid', launcherId), launcherId, {
        players: [],
      }),
    )
  }, 60_000)
})

// ===========================================================================
// §C — THE REVIEW QUESTION: the standalone door cannot reach a row that has
//      a league. **This section is the break-probe target** (§4.3): remove
//      the `league_id IS NULL` conjunct from the standalone arm and every
//      assertion below fails while §A and §D stay green.
// ===========================================================================
describe('§C the standalone door is provably no more permissive for a row that HAS a league', () => {
  const notFound = (result: { status: number; body: unknown }) => {
    expect(result.status).toBe(404)
    expect((result.body as { error: string }).error).toBe(MOCK_NOT_FOUND_STANDALONE_MESSAGE)
  }

  it('a LEAGUE-ATTACHED mock the SAME user launched is unreachable through the standalone door', async () => {
    // The sharpest case in the file: the launcher predicate MATCHES this row
    // (same user launched it), and its own league-side routes serve it. Only
    // `league_id IS NULL` refuses it here.
    const scope = () => standaloneMockScope(leagueMockId, launcherId)
    notFound(
      await makePick(launcherClient, scope(), {
        draft_id: leagueMockId,
        player_id: PLAYER_IDS[10],
        action_id: ACTION.crossPick,
      }),
    )
    notFound(await upsertQueue(launcherClient, scope(), launcherId, { players: [] }))
    notFound(
      await queueFromList(launcherClient, scope(), launcherId, launcherListId, {
        draft_id: leagueMockId,
      }),
    )
    notFound(
      await pauseOrResumeDraft(launcherClient, scope(), {
        draft_id: leagueMockId,
        action: 'pause',
      }),
    )
    notFound(
      await nominatePlayer(launcherClient, scope(), launcherId, {
        draft_id: leagueMockId,
        player_id: PLAYER_IDS[10],
        opening_bid: 1,
        action_id: ACTION.crossNominate,
      }),
    )
    notFound(
      await placeBid(launcherClient, scope(), launcherId, {
        draft_id: leagueMockId,
        amount: 2,
        nomination_seq: 1,
        player_id: PLAYER_IDS[10],
        action_id: ACTION.crossBid,
      }),
    )
    // The league mock is untouched — same status, same clock.
    expect((await readDraft(leagueMockId)).is_mock).toBe(true)
  }, 120_000)

  it('the league’s REAL draft is unreachable through the standalone door', async () => {
    const scope = () => standaloneMockScope(leagueDraftId, launcherId)
    notFound(
      await makePick(launcherClient, scope(), {
        draft_id: leagueDraftId,
        player_id: PLAYER_IDS[11],
        action_id: ACTION.leagueDraftPick,
      }),
    )
    notFound(await upsertQueue(launcherClient, scope(), launcherId, { players: [] }))
    notFound(
      await pauseOrResumeDraft(launcherClient, scope(), {
        draft_id: leagueDraftId,
        action: 'pause',
      }),
    )
    expect((await readDraft(leagueDraftId)).status).toBe('scheduled')
  }, 120_000)

  it('the body cannot name a DIFFERENT draft than the URL does', async () => {
    // The mock id in the URL is the target; a `draft_id` that disagrees is
    // the same 404, never a second target.
    notFound(
      await upsertQueue(
        launcherClient,
        standaloneMockScope(snakeMockId, launcherId),
        launcherId,
        { draft_id: leagueMockId, players: [] },
      ),
    )
  }, 60_000)
})

// ===========================================================================
// §D — the LEAGUE arm, unchanged: member / non-member / ex-member
// ===========================================================================
describe('§D the league arm answers exactly what it answered before (§4 rule 11)', () => {
  it('a MEMBER with a seat still writes their queue on the league’s draft', async () => {
    const result = await upsertQueue(memberClient, leagueScope(leagueId), memberId, {
      draft_id: leagueDraftId,
      players: PLAYER_IDS.slice(0, 2),
    })
    expect(result.status).toBe(200)
    const body = result.body as unknown as { draft_id: string; queue: { player_id: string }[] }
    expect(body.draft_id).toBe(leagueDraftId)
    expect(body.queue.map((row) => row.player_id)).toEqual(PLAYER_IDS.slice(0, 2))
  }, 60_000)

  it('a NON-MEMBER gets the no-leak 404 — the same answer as no-draft', async () => {
    const queued = await upsertQueue(strangerClient, leagueScope(leagueId), strangerId, {
      draft_id: leagueDraftId,
      players: [],
    })
    expect(queued.status).toBe(404)
    expect((queued.body as { error: string }).error).toBe(NO_ACTIVE_DRAFT_MESSAGE)

    const picked = await makePick(strangerClient, leagueScope(leagueId), {
      draft_id: leagueDraftId,
      player_id: PLAYER_IDS[12],
      action_id: ACTION.strangerPick,
    })
    expect(picked.status).toBe(404)
  }, 60_000)

  it('an EX-MEMBER gets the same 404 the moment they leave', async () => {
    const { data: seat, error } = await service
      .from('league_members')
      .select('id')
      .eq('league_id', leagueId)
      .eq('user_id', exId)
      .single()
    if (error) throw new Error(`ex member lookup failed: ${error.message}`)

    // Before: a seated member resolves the draft.
    const before = await upsertQueue(exClient, leagueScope(leagueId), exId, {
      draft_id: leagueDraftId,
      players: [],
    })
    expect(before.status).toBe(200)

    const left = await removeMember(exClient, leagueId, seat.id, exId, {})
    expect(left.status).toBe(200)

    const after = await upsertQueue(exClient, leagueScope(leagueId), exId, {
      draft_id: leagueDraftId,
      players: [],
    })
    expect(after.status).toBe(404)
    expect((after.body as { error: string }).error).toBe(NO_ACTIVE_DRAFT_MESSAGE)
  }, 60_000)

  it('F118: the suite’s own residue is measured, not assumed', async () => {
    // Runs last and reports what is still standing BEFORE afterAll sweeps —
    // the counts the PR quotes come from the sweep itself (see the session
    // log). This assertion is about the fixture existing, so the cleanup has
    // something to prove it removed.
    const counts = await residue()
    expect(counts.leagues).toBe(1)
    expect(counts.drafts).toBeGreaterThan(0)
  }, 60_000)
})

// ===========================================================================
// §E — the auto-pause post (ledger F120; migration 097; MP.6c)
// ===========================================================================
describe('§E the auto-pause post says where YOUR practice resumes (F120)', () => {
  /**
   * Drive `draft_tick`'s ARM 1.5 (the mock stale-pause loop) on one mock and
   * return the system post it wrote.
   *
   * Looking like someone who left is TWO facts, both the arm's own: no
   * heartbeat row for the launcher, and a `started_at` older than
   * `disconnect_grace_seconds + 5s` (the arm COALESCEs liveness →
   * `started_at` → `created_at`). The timestamp is a fixed literal rather
   * than a wall-clock offset — this suite reads server time, never
   * `Date.now()`.
   */
  async function autoPausePost(draftId: string): Promise<{
    message: string
    leagueId: string | null
  }> {
    await service.from('draft_liveness').delete().eq('draft_id', draftId)
    const { error: rewound } = await service
      .from('drafts')
      .update({ status: 'live', started_at: '2020-01-01T00:00:00+00:00' })
      .eq('id', draftId)
    expect(rewound).toBeNull()

    await tick()

    const after = await readDraft(draftId)
    expect(after.status, 'the arm actually fired').toBe('paused')

    const { data, error } = await service
      .from('league_chat')
      .select('message, league_id, is_system, user_id')
      .eq('context', `draft:${draftId}`)
      .eq('is_system', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (error) throw new Error(`system post read failed: ${error.message}`)
    // D97's shape, re-asserted here because the copy claim is only
    // interesting on a post that is actually the tick's.
    expect(data.user_id).toBeNull()
    return { message: data.message, leagueId: data.league_id }
  }

  it('a STANDALONE practice draft is sent to Mock drafts, never to a league page', async () => {
    const post = await autoPausePost(snakeMockId)
    // F120: this row used to read "…from the league page." on a draft that
    // has no league page — written with a NULL league_id, and invisible
    // until F114 re-keyed the room's chat read on the draft's context.
    expect(post.leagueId).toBeNull()
    expect(post.message).toBe(
      'Mock draft auto-paused — you left the room. Resume your practice from Mock drafts.',
    )
    expect(post.message).not.toContain('league page')
  }, 60_000)

  it('a LEAGUE-attached mock keeps 068’s sentence, byte for byte (§4 rule 11)', async () => {
    const post = await autoPausePost(leagueMockId)
    expect(post.leagueId).toBe(leagueId)
    expect(post.message).toBe(
      'Mock draft auto-paused — you left the room. Resume your practice from the league page.',
    )
  }, 60_000)
})
