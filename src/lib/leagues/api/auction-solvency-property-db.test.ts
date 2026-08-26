/**
 * auction-solvency-property-db.test.ts — L.C4.1 item 3(b): THE solvency
 * property test's DB layer (delivery plan §3 M3 row, verbatim: "no
 * reachable sequence of bids/undos/commish budget edits violates solvency —
 * including bot-driven mock auctions"; spec §8.6.8/E62; tasks-M3 §6).
 *
 * THE PROPERTY, EXACTLY: for every prefix of every generated command
 * sequence, after the command settles (200 or refusal), EVERY active
 * franchise of the driven auction satisfies
 *     remaining ≥ open_slots × reserve
 * under the draft's OWN reserve column (092's $0-nomination toggle), the
 * oracle being `draft_auction_solvent` (service-role — the fn is REVOKEd
 * from authenticated, §4.7); AND a REFUSED command changed nothing (drafts
 * row phase fields, adjustments, pick/bid counts — strict in the league
 * worlds); AND the board always COMPLETES from any reachable state (each
 * run drives its world to `complete`, full legal rosters, exact TS ≡ SQL
 * budget parity at the end).
 *
 * FOUR WORLDS — the head-of-tree matrix the task charter demands (AP/MP/MS
 * folded, D197(4)):
 *   A. real league, reserve $1 — commissioner traffic in the universe:
 *      budget edits (legal, DELIBERATELY insolvent → E28 refusal, and the
 *      E69 idempotent replay), reverse-won-bid undos, pause-gated clock
 *      edits, exact-max bids (the D146 one-unit boundary) and over-max /
 *      stale-identity illegals;
 *   B. real league, `auction_zero_dollar_nominations` ON — the machinery
 *      "stays correct and stops binding" (§8.6.8): $0 openings, reserve 0;
 *   C. league-attached MOCK, `fast` CPU bidders (089/091): the launcher
 *      drives the human seat through the SAME verbs while reactive CPU
 *      ladders and CPU nominations land — E62's property half;
 *   D. STANDALONE mock (095), slot-PINNED at launch (102/MS.8), $0
 *      nominations ON — the MP/MS world with bot opponents it mints itself.
 *
 * §8.6.9 instant awards are IN the universe by construction, not by a
 * dedicated command: endgame nominations (complete/broke rivals) award in
 * the nominate transaction on every path, and each run's completion drive
 * crosses that region. `auction-uncontestable-db.test.ts` owns E67's exact
 * pins; here the property must simply HOLD across them.
 *
 * F113 (the live-cron read-then-act race, a MECHANISM not a file): in the
 * mock worlds the strict changed-nothing comparison is NOT asserted for
 * deliberate illegals — a reactive CPU ladder or a cron pass is a legal
 * concurrent actor there, so "nothing changed" is not a property of the
 * world. The refusal status + solvency still are. In the league worlds no
 * other bidder exists (placeholders never bid, the cron only expires
 * clocks, and every clock is at its catalog max), so the strict comparison
 * is honest and asserted. Human bids in the mock worlds read the market
 * inside an `updated_at` freeze (the D254(3) pattern) so the amount aimed
 * is never stale.
 *
 * SEED & REPLAY: fc seed = FC_SEED env or the fixed literal; fast-check
 * prints seed + path + counterexample (the command list) on any failure —
 * replay with FC_SEED. `endOnFailure` is set: a shrink would re-provision
 * worlds per attempt, and the seed replay is the debugging tool. The
 * committed suite runs SOLVENCY_RUNS per world (default 2 — the CI
 * budget); the WIDE SWEEP is on demand:
 *     SOLVENCY_RUNS=10 npx vitest run src/lib/leagues/api/auction-solvency-property-db.test.ts
 * A found counterexample is a FINDING — file it with the seed, never
 * massage the generator around it.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 * Fixture prefix `sp_prop` / `vitest-solvprop` (unique in the repo);
 * cleanup first and last, F118-aware (fixture-scoped assertions only; the
 * orphan-standalone-teams counter runs in afterAll — the D262 sweep
 * pattern).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { auctionKnobsOf, readLiveNomination, teamBudget } from '@/components/draft/auction-budget'
import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount } from '../settings/league-settings'
import {
  adjustBudget,
  createDraft,
  launchMockDraft,
  launchStandaloneMockDraft,
  leagueScope,
  nominatePlayer,
  pauseOrResumeDraft,
  placeBid,
  reverseWonBid,
  setClock,
  standaloneMockScope,
  startDraft,
} from './draft-service'
import { claimInvite, createInvite } from './invites-service'
import { createLeague, patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

type Supabase = SupabaseClient<Database>

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const SEED = process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : 20260825
const RUNS = process.env.SOLVENCY_RUNS !== undefined ? Number(process.env.SOLVENCY_RUNS) : 5
const FC = { seed: SEED, numRuns: RUNS, endOnFailure: true, verbose: true } as const

const LEAGUE_PREFIX = 'vitest-solvprop'
/** THE NOMINATABLE POOL, SEEDED BY THIS FIXTURE (F94; D235(5)'s sibling
 *  half — a fixture whose premise is a PRESENCE must make that presence
 *  true within its own fixture).
 *
 *  This suite's premise is "a pool large enough to draft from": four worlds
 *  x 8 seats x 2 slots, plus the `pool.length > 64` floor below. It read
 *  that pool out of `players` and never put one there — a premise nothing
 *  satisfies on a fresh database, because `supabase/seed.sql` inserts ZERO
 *  players and CI replays the migrations into an empty table. The measured
 *  CI failure is `expected 0 to be greater than 64`, every run.
 *
 *  BAND — 9200+, ABOVE the real pool (measured 2026-08-26 on the dev stack:
 *  1074 players, 549 with ADP, min 1.6, MAX 700.9) and disjoint from
 *  `draft-board-autopick-db`'s 9100 decoys. The direction is what F94's own
 *  measured extension demands: `draft_mock_cpu_bid_value` ranks a player as
 *  `count(*) WHERE adp IS NOT NULL AND adp < v_adp`, so a row BELOW the
 *  real pool shifts every other suite's CPU seed while a row ABOVE it
 *  shifts none. NULL adp — that extension's other suggestion — is wrong
 *  HERE: 091 maps NULL adp to rank N + 1 => value 0 => "nobody raises on an
 *  unranked player", which would silently empty the CPU ladders worlds C
 *  and D exist to exercise.
 *
 *  Consequence, stated plainly: LOCALLY nothing changes — the `.limit(200)`
 *  read below still returns the real top-200 (549 real ADP'd rows sit in
 *  front of this band), so M3-gate behavior is exactly what it was. In CI,
 *  where no real pool exists, THIS is the pool, with the same shape (ranks
 *  1..N against `k.n = slots x teams = 16`, so the same top slice carries
 *  CPU value). No K/DEF: the roster is 1 RB + 1 bench, the pool filter
 *  drops them, and auction K/DST eligibility never engages. */
const POOL_PREFIX = 'vitest-solvpool'
const POOL_POSITIONS = [
  ...Array.from({ length: 40 }, () => 'RB'),
  ...Array.from({ length: 32 }, () => 'WR'),
  ...Array.from({ length: 12 }, () => 'TE'),
  ...Array.from({ length: 12 }, () => 'QB'),
]
const POOL_PLAYERS = POOL_POSITIONS.map((position, i) => ({
  id: `${POOL_PREFIX}-${String(i + 1).padStart(3, '0')}`,
  full_name: `Solvency Pool ${position} ${String(i + 1).padStart(3, '0')}`,
  position,
  adp: 9200 + i + 1,
}))
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00' // F49: far future
const TEAM_COUNT = 8
const SLOTS_PER_TEAM = 2 // 1 starter + 1 bench — 16 nominations per board
/** Catalog maxima — the live 5s cron must not expire a clock between a
 *  command and its oracle read (the wire suites' clock discipline). */
const NOMINATION_SECONDS = 120
const BID_SECONDS = 60

const USERS = [
  { email: 'sp-prop-commish@fieldscout.test', password: 'sp-prop-pass-1', username: 'sp_prop_commish' },
  { email: 'sp-prop-mgr2@fieldscout.test', password: 'sp-prop-pass-2', username: 'sp_prop_mgr2' },
  { email: 'sp-prop-mgr3@fieldscout.test', password: 'sp-prop-pass-3', username: 'sp_prop_mgr3' },
] as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let clients: Supabase[] = []
let userIds: string[] = []
let scoringSystemId = ''
let pool: string[] = [] // nominatable real players, ADP ascending (no K/DEF)
let worldCounter = 0
let actionCounter = 0

/** Deterministic per-run action ids (uuid-shaped, fixture-prefixed like the
 *  sibling suites; unique per process run via the counter). */
function mintActionId(): string {
  actionCounter += 1
  const tail = String(actionCounter).padStart(12, '0')
  const mid = String(process.pid % 10_000).padStart(4, '0')
  return `af500000-${mid}-4000-8000-${tail}`
}

function errorText(body: unknown): string {
  return JSON.stringify(body ?? '')
}

function shifted(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id as string)
}

async function cleanup(): Promise<void> {
  // Standalone mocks our users launched (league_id NULL) — through the RPC
  // graph delete (it removes the minted bot seats + chat), service-side.
  const { data: mocks } = await service
    .from('drafts')
    .select('id, config')
    .is('league_id', null)
    .eq('is_mock', true)
  for (const m of mocks ?? []) {
    const launchedBy = ((m.config as Record<string, unknown> | null)?.mock as Record<string, unknown> | undefined)
      ?.launched_by
    if (typeof launchedBy === 'string' && userIds.includes(launchedBy)) {
      await service.rpc('delete_mock_draft', { p_draft_id: m.id as string })
    }
  }
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_PREFIX}%`)
  const ids = (leagues ?? []).map((l) => l.id as string)
  if (ids.length > 0) {
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  // The seeded pool, released LAST — the league graph above owns the NO
  // ACTION player FKs on draft_picks. LOUD on failure: F127's lesson is
  // that a swallowed players delete is how `vitest-%` rows outlive their
  // suite and go on to decide somebody else's assertion.
  const { error: poolError } = await service.from('players').delete().like('id', `${POOL_PREFIX}-%`)
  if (poolError) throw new Error(`cleanup: seeded-pool delete failed: ${poolError.message}`)
}

async function tick(): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc('draft_tick')
  expect(error).toBeNull()
  return (data ?? {}) as Record<string, unknown>
}

interface DraftRow {
  id: string
  status: string
  current_pick_number: number | null
  on_clock_team_id: string | null
  current_deadline: string | null
  current_nomination: Json | null
  budget_adjustments: Json | null
  total_rounds: number | null
  config: Json | null
  updated_at: string
}

async function readDraft(draftId: string): Promise<DraftRow> {
  const { data, error } = await service
    .from('drafts')
    .select(
      'id, status, current_pick_number, on_clock_team_id, current_deadline, current_nomination, budget_adjustments, total_rounds, config, updated_at',
    )
    .eq('id', draftId)
    .single()
  expect(error).toBeNull()
  return data as unknown as DraftRow
}

/** THE ORACLE — after every settled command. */
async function assertSolvent(draftId: string, context: string): Promise<void> {
  const { data, error } = await service.rpc('draft_auction_solvent', { p_draft_id: draftId })
  expect(error, `draft_auction_solvent errored after ${context}: ${error?.message}`).toBeNull()
  expect(data, `SOLVENCY VIOLATED after ${context} (draft ${draftId})`).toBe(true)
}

interface WorldSnapshot {
  seq: number | null
  nomination: string
  adjustments: string
  pickCount: number
  bidCount: number
}

async function snapshot(draftId: string): Promise<WorldSnapshot> {
  const row = await readDraft(draftId)
  const { count: pickCount } = await service
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', draftId)
  const { count: bidCount } = await service
    .from('draft_bids')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', draftId)
  return {
    seq: row.current_pick_number,
    nomination: JSON.stringify(row.current_nomination),
    adjustments: JSON.stringify(row.budget_adjustments),
    pickCount: pickCount ?? -1,
    bidCount: bidCount ?? -1,
  }
}

/** Rewind the SERVER-written deadline past both clocks + grace and tick —
 *  the timeout-close/system-nomination command (the F52-safe shape). */
async function rewindAndTick(draftId: string): Promise<void> {
  const row = await readDraft(draftId)
  if (row.status !== 'live' || row.current_deadline === null) return
  await service
    .from('drafts')
    .update({ current_deadline: shifted(row.current_deadline, -(NOMINATION_SECONDS + BID_SECONDS + 200) * 1000) })
    .eq('id', draftId)
    .eq('status', 'live')
  await tick()
}

/** Provoke the mock CPUs: make their think-time due (updated_at rewind) and
 *  sweep — CPU nominations land; reactive raises ride the human's own bids. */
async function provokeCpus(draftId: string): Promise<void> {
  const row = await readDraft(draftId)
  if (row.status !== 'live') return
  await service
    .from('drafts')
    .update({ updated_at: shifted(row.updated_at, -5_000) })
    .eq('id', draftId)
    .eq('status', 'live')
  await tick()
}

/** F113/D254(3): freeze the CPU clocks across a read-then-bid pair. */
async function freezeCpus(draftId: string): Promise<void> {
  const row = await readDraft(draftId)
  if (row.status !== 'live') return
  await service
    .from('drafts')
    .update({ updated_at: shifted(row.updated_at, 90_000) })
    .eq('id', draftId)
    .eq('status', 'live')
}

interface TeamView {
  teamId: string
  remaining: number
  openSlots: number
  maxBid: number
}

/** The seat's budget view off the TS mirror (display-only; every aim is
 *  re-validated by the SQL — a mis-aim is a refusal, not a failure). */
async function viewTeam(draftId: string, teamId: string, row: DraftRow): Promise<TeamView> {
  const { data: picks } = await service
    .from('draft_picks')
    .select('team_id, price, is_undone')
    .eq('draft_id', draftId)
  const knobs = auctionKnobsOf(row.config)
  const b = teamBudget(
    {
      auctionBudget: knobs.auctionBudget,
      reserve: knobs.reserve,
      totalRounds: row.total_rounds,
      budgetAdjustments: row.budget_adjustments,
    },
    (picks ?? []) as never,
    teamId,
  )
  expect(b).not.toBeNull()
  return { teamId, remaining: b!.remaining, openSlots: b!.openSlots, maxBid: b!.maxBid }
}

/** Exact TS ≡ SQL parity for every active franchise (§4.7, at run end). */
async function assertBudgetParity(draftId: string, leagueTeamIds: readonly string[]): Promise<void> {
  const row = await readDraft(draftId)
  for (const teamId of leagueTeamIds) {
    const ts = await viewTeam(draftId, teamId, row)
    const { data, error } = await service.rpc('draft_team_budget', {
      p_draft_id: draftId,
      p_team_id: teamId,
    })
    expect(error).toBeNull()
    const sql = (data as Array<{ remaining: number; open_slots: number; max_bid: number; committed: number }>)[0]!
    expect(
      { remaining: sql.remaining, openSlots: sql.open_slots, maxBid: sql.max_bid },
      `TS ≡ SQL budget parity broke for team ${teamId}`,
    ).toEqual({ remaining: ts.remaining, openSlots: ts.openSlots, maxBid: ts.maxBid })
  }
}

// ---------------------------------------------------------------------------
// World provisioning
// ---------------------------------------------------------------------------

interface LeagueWorld {
  leagueId: string
  draftId: string
  teamIds: string[] // all 8 franchises
  humanTeams: Array<{ client: Supabase; userId: string; teamId: string }>
  reserve: 0 | 1
}

async function provisionLeagueWorld(zeroDollar: boolean, budget: number): Promise<LeagueWorld> {
  worldCounter += 1
  const name = `${LEAGUE_PREFIX}-${zeroDollar ? 'z' : 'r'}${worldCounter}-${process.pid.toString(36)}`
  const settings = defaultsForTeamCount(TEAM_COUNT)
  const configured = {
    ...settings,
    roster_settings: {
      starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
      bench: SLOTS_PER_TEAM - 1,
      ir_slots: [],
      swap_spots: 0,
    },
    draft: {
      ...settings.draft,
      draft_type: 'auction' as const,
      auction_budget: budget as 50,
      auction_zero_dollar_nominations: zeroDollar,
      auction_nomination_seconds: NOMINATION_SECONDS as 120,
      auction_bid_seconds: BID_SECONDS as 60,
      auction_anti_snipe_seconds: 10 as const,
      draft_scheduled_at: DRAFT_INSTANT,
    },
  }
  const [commish, mgr2, mgr3] = clients
  const created = await createLeague(commish!, {
    name,
    season: 2026,
    scoring_system_id: scoringSystemId,
    team_name: `${name} T1`,
    action_id: mintActionId(),
    settings: configured,
  })
  expect(created.status, errorText(created.body)).toBe(201)
  const leagueId = (created.body as { league_id: string }).league_id

  const humanTeams: LeagueWorld['humanTeams'] = []
  for (const [i, client] of [mgr2!, mgr3!].entries()) {
    const invite = await createInvite(commish!, leagueId, {})
    expect([200, 201]).toContain(invite.status)
    const claim = await claimInvite(client, { token: (invite.body as { token: string }).token })
    expect(claim.status, errorText(claim.body)).toBe(200)
    humanTeams.push({
      client,
      userId: userIds[i + 1]!,
      teamId: (claim.body as { team_id: string }).team_id,
    })
  }
  for (let i = 0; i < TEAM_COUNT - 3; i++) {
    const filled = await addPlaceholderSeat(commish!, leagueId, {})
    expect(filled.status, errorText(filled.body)).toBe(201)
  }
  const { data: commishMember } = await commish!
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('user_id', userIds[0]!)
    .single()
  humanTeams.unshift({ client: commish!, userId: userIds[0]!, teamId: commishMember!.team_id as string })

  const scheduled = await patchLeague(commish!, leagueId, { status: 'scheduled' })
  expect(scheduled.status, errorText(scheduled.body)).toBe(200)
  const draftCreated = await createDraft(commish!, leagueId)
  expect([200, 201]).toContain(draftCreated.status)
  const started = await startDraft(commish!, leagueId)
  expect(started.status, errorText(started.body)).toBe(200)
  const draftId = (started.body as { draft: { id: string } }).draft.id

  const { data: teams } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .neq('status', 'retired')
  return {
    leagueId,
    draftId,
    teamIds: (teams ?? []).map((t) => t.id as string),
    humanTeams,
    reserve: zeroDollar ? 0 : 1,
  }
}

async function teardownLeagueWorld(leagueId: string): Promise<void> {
  await service.from('drafts').delete().eq('league_id', leagueId)
  await service.from('teams').delete().eq('league_id', leagueId)
  await service.from('leagues').delete().eq('id', leagueId)
}

// ---------------------------------------------------------------------------
// The command interpreter (shared by all four worlds)
// ---------------------------------------------------------------------------

interface WorldHandle {
  label: string
  draftId: string
  /** Human actors able to nominate/bid, keyed to their seats. In the mock
   *  worlds this is the LAUNCHER driving the human seat (D103(2)). */
  actors: Array<{ client: Supabase; userId: string; teamId: string }>
  scope: (draftId: string) => Parameters<typeof nominatePlayer>[1]
  /** League worlds: commissioner traffic enabled + strict changed-nothing. */
  commish: { client: Supabase; leagueId: string } | null
  /** Mock worlds: reactive CPUs exist — provoke instead of pure closes,
   *  freeze before read-then-bid, skip strict changed-nothing (F113). */
  hasCpus: boolean
}

async function availablePlayer(draftId: string, offset: number): Promise<string | null> {
  const { data } = await service
    .from('draft_picks')
    .select('player_id')
    .eq('draft_id', draftId)
    .eq('is_undone', false)
  const taken = new Set((data ?? []).map((p) => p.player_id as string))
  const open = pool.filter((id) => !taken.has(id))
  return open[offset % Math.max(1, open.length)] ?? null
}

/** One command step. `c` is the raw seeded int; interpretation is
 *  state-adaptive (a bid during the nominating phase becomes a nominate,
 *  etc.) so sequences stay live while illegals arrive on purpose. */
/** Keep the LAUNCHER's heartbeat fresh in the mock worlds (the real
 *  `draft_touch` RPC — ARM 1.6 auto-pauses a mock whose launcher goes
 *  stale past grace, and this harness is the launcher). */
async function beat(w: WorldHandle): Promise<void> {
  if (!w.hasCpus) return
  const { error } = await w.actors[0]!.client.rpc('draft_touch', { p_draft_id: w.draftId })
  expect(error, `draft_touch failed: ${error?.message}`).toBeNull()
}

async function runCommand(w: WorldHandle, c: number, replayedEdit: { body: unknown | null }): Promise<void> {
  await beat(w)
  const row = await readDraft(w.draftId)
  if (row.status === 'complete') return
  if (row.status === 'paused') {
    const resumed = await pauseOrResumeDraft(
      w.commish?.client ?? w.actors[0]!.client,
      w.scope(w.draftId),
      { action: 'resume', draft_id: w.draftId },
    )
    expect([200, 400]).toContain(resumed.status)
    await assertSolvent(w.draftId, 'resume')
    return
  }
  expect(row.status).toBe('live')

  const nomination = readLiveNomination(row.current_nomination)
  const seq = row.current_pick_number ?? 0
  const kind = c % 10
  const actor = w.actors[c % w.actors.length]!

  if (nomination === null) {
    // ---- NOMINATING phase ------------------------------------------------
    if (kind >= 8 && w.commish !== null) {
      await commishCommand(w, c, row, replayedEdit)
      return
    }
    const onClock = row.on_clock_team_id
    const driver = w.actors.find((a) => a.teamId === onClock)
    if (driver === undefined) {
      // A placeholder/CPU seat is nominating — the §8.6.2 timeout system
      // nomination (or the CPU's own think-time in a mock world).
      if (w.hasCpus) await provokeCpus(w.draftId)
      else await rewindAndTick(w.draftId)
      await assertSolvent(w.draftId, 'system nomination')
      return
    }
    const view = await viewTeam(w.draftId, driver.teamId, row)
    const knobs = auctionKnobsOf(row.config)
    const floor = knobs.reserve
    const player = await availablePlayer(w.draftId, c)
    if (player === null || view.openSlots <= 0) {
      await rewindAndTick(w.draftId)
      await assertSolvent(w.draftId, 'close (no nominatable state)')
      return
    }
    if (kind === 7 && view.maxBid >= floor) {
      // DELIBERATE ILLEGAL: nominate ABOVE the nominator's own max bid
      // (§8.6.7(a)) — must refuse, and in a league world change nothing.
      const before = w.commish !== null ? await snapshot(w.draftId) : null
      const res = await nominatePlayer(driver.client, w.scope(w.draftId), driver.userId, {
        draft_id: w.draftId,
        player_id: player,
        opening_bid: view.maxBid + 1,
        action_id: mintActionId(),
      })
      expect([400, 409], `over-max nomination must refuse, got ${res.status}: ${errorText(res.body)}`).toContain(
        res.status,
      )
      if (before !== null) expect(await snapshot(w.draftId)).toEqual(before)
      await assertSolvent(w.draftId, 'refused over-max nomination')
      return
    }
    const opening = Math.min(Math.max(floor, c % 3 === 0 ? floor + (c % 5) : floor), Math.max(floor, view.maxBid))
    const res = await nominatePlayer(driver.client, w.scope(w.draftId), driver.userId, {
      draft_id: w.draftId,
      player_id: player,
      opening_bid: opening,
      action_id: mintActionId(),
    })
    // 400 = a legal race loss (e.g. the cron system-nominated first) —
    // tolerated traffic; anything else unexpected is a failure.
    expect([200, 400], errorText(res.body)).toContain(res.status)
    await assertSolvent(w.draftId, `nomination of ${player} at $${opening}`)
    return
  }

  // ---- BIDDING phase -----------------------------------------------------
  if (kind === 7) {
    await rewindAndTick(w.draftId) // bid-clock expiry → the award
    await assertSolvent(w.draftId, `award close of seq ${seq}`)
    return
  }
  if (kind >= 8 && w.commish !== null) {
    await commishCommand(w, c, row, replayedEdit)
    return
  }
  if (w.hasCpus) await freezeCpus(w.draftId) // F113: read-then-bid pair
  const fresh = await readDraft(w.draftId)
  const liveNom = readLiveNomination(fresh.current_nomination)
  if (liveNom === null || (fresh.current_pick_number ?? 0) !== seq) {
    await assertSolvent(w.draftId, 'market closed mid-command')
    return
  }
  const bidder =
    w.actors.find((a) => a.teamId !== liveNom.high_bidder_team_id) ?? actor
  const view = await viewTeam(w.draftId, bidder.teamId, fresh)

  if (kind === 6 && seq >= 2) {
    // DELIBERATE ILLEGAL: stale identity (F64 — "just went off the board").
    const { data: prior } = await service
      .from('draft_picks')
      .select('player_id')
      .eq('draft_id', w.draftId)
      .eq('is_undone', false)
      .order('pick_number')
      .limit(1)
    const stalePlayer = (prior?.[0]?.player_id as string | undefined) ?? liveNom.player_id
    const before = w.commish !== null ? await snapshot(w.draftId) : null
    const res = await placeBid(bidder.client, w.scope(w.draftId), bidder.userId, {
      draft_id: w.draftId,
      nomination_seq: seq - 1,
      player_id: stalePlayer,
      amount: liveNom.high_bid + 1,
      action_id: mintActionId(),
    })
    expect([400, 409], `stale-identity bid must refuse, got ${res.status}: ${errorText(res.body)}`).toContain(
      res.status,
    )
    if (before !== null) expect(await snapshot(w.draftId)).toEqual(before)
    await assertSolvent(w.draftId, 'refused stale-identity bid')
    return
  }
  if (kind === 5) {
    // DELIBERATE ILLEGAL: one dollar over the bidder's max (E5 — the D146
    // one-unit boundary from the illegal side).
    const amount = Math.max(view.maxBid + 1, liveNom.high_bid + 1)
    const before = w.commish !== null ? await snapshot(w.draftId) : null
    const res = await placeBid(bidder.client, w.scope(w.draftId), bidder.userId, {
      draft_id: w.draftId,
      nomination_seq: seq,
      player_id: liveNom.player_id,
      amount,
      action_id: mintActionId(),
    })
    expect([400, 409], `over-max bid must refuse, got ${res.status}: ${errorText(res.body)}`).toContain(res.status)
    if (before !== null) expect(await snapshot(w.draftId)).toEqual(before)
    await assertSolvent(w.draftId, 'refused over-max bid')
    return
  }
  // Legal raise: kind 4 aims EXACTLY at max bid (the D146 legal boundary);
  // others nibble high_bid + 1 (still capped by the SQL if the view lags).
  const amount =
    kind === 4 && view.maxBid >= liveNom.high_bid + 1 ? view.maxBid : liveNom.high_bid + 1
  if (amount > view.maxBid || view.openSlots <= 0 || liveNom.high_bidder_team_id === bidder.teamId) {
    // No legal raise from this seat — close instead (keeps sequences live).
    await rewindAndTick(w.draftId)
    await assertSolvent(w.draftId, 'close (no legal raise)')
    return
  }
  const res = await placeBid(bidder.client, w.scope(w.draftId), bidder.userId, {
    draft_id: w.draftId,
    nomination_seq: seq,
    player_id: liveNom.player_id,
    amount,
    action_id: mintActionId(),
  })
  // 400 = a legal race loss (a CPU out-raised inside the txn window, the
  // clock expired) — tolerated; the property is solvency, not victory.
  expect([200, 400], errorText(res.body)).toContain(res.status)
  await assertSolvent(w.draftId, `bid $${amount} on seq ${seq}`)
}

/** Commissioner traffic (league worlds): budget edits (legal + E69 replay +
 *  E28 deliberate insolvent), reverse-won-bid, pause-gated clock edit. */
async function commishCommand(
  w: WorldHandle,
  c: number,
  row: DraftRow,
  replayedEdit: { body: unknown | null },
): Promise<void> {
  const commish = w.commish!
  const pick = c % 4
  if (pick === 0) {
    // LEGAL budget edit (+$5..$25), immediately REPLAYED with the SAME
    // action_id — E69: one write, the replay answers the original.
    const target = w.actors[c % w.actors.length]!.teamId
    const body = {
      draft_id: w.draftId,
      team_id: target,
      delta: 5 + (c % 21),
      reason: 'property: legal budget edit',
      action_id: mintActionId(),
    }
    const first = await adjustBudget(commish.client, commish.leagueId, body)
    expect(first.status, errorText(first.body)).toBe(200)
    const between = await snapshot(w.draftId)
    const replay = await adjustBudget(commish.client, commish.leagueId, body)
    expect(replay.status, errorText(replay.body)).toBe(200)
    expect(await snapshot(w.draftId), 'E69: the replay must write NOTHING twice').toEqual(between)
    replayedEdit.body = body
    await assertSolvent(w.draftId, 'legal budget edit + E69 replay')
    return
  }
  if (pick === 1) {
    // DELIBERATE ILLEGAL: the edit that leaves a seat exactly $1 under its
    // floor (E28, one-unit) — refused, nothing changed.
    const target = w.actors[c % w.actors.length]!.teamId
    const view = await viewTeam(w.draftId, target, row)
    if (view.openSlots <= 0) return
    const knobs = auctionKnobsOf(row.config)
    const delta = -(view.remaining - view.openSlots * knobs.reserve) - 1
    const before = await snapshot(w.draftId)
    const res = await adjustBudget(commish.client, commish.leagueId, {
      draft_id: w.draftId,
      team_id: target,
      delta,
      reason: 'property: deliberately insolvent edit (E28 must refuse)',
      action_id: mintActionId(),
    })
    expect(res.status, `E28 must refuse (delta ${delta}): ${errorText(res.body)}`).toBe(400)
    expect(await snapshot(w.draftId), 'E28 refusal must change NOTHING').toEqual(before)
    await assertSolvent(w.draftId, 'refused insolvent budget edit')
    return
  }
  if (pick === 2) {
    // Reverse a won bid (pause-first per D141) — the undo in the sentence.
    const { data: live } = await service
      .from('draft_picks')
      .select('id')
      .eq('draft_id', w.draftId)
      .eq('is_undone', false)
      .order('pick_number')
      .limit(1)
    const victim = live?.[0]?.id as string | undefined
    if (victim === undefined) return
    const paused = await pauseOrResumeDraft(commish.client, w.scope(w.draftId), {
      action: 'pause',
      draft_id: w.draftId,
    })
    expect(paused.status, errorText(paused.body)).toBe(200)
    const rev = await reverseWonBid(commish.client, commish.leagueId, {
      draft_id: w.draftId,
      pick_id: victim,
      reason: 'property: reverse a won bid',
    })
    expect([200, 400], errorText(rev.body)).toContain(rev.status)
    await assertSolvent(w.draftId, 'reverse won bid (paused)')
    const resumed = await pauseOrResumeDraft(commish.client, w.scope(w.draftId), {
      action: 'resume',
      draft_id: w.draftId,
    })
    expect(resumed.status, errorText(resumed.body)).toBe(200)
    await assertSolvent(w.draftId, 'resume after reverse')
    return
  }
  // Pause-gated clock edit (D141): pause → set the nomination clock → resume.
  const paused = await pauseOrResumeDraft(commish.client, w.scope(w.draftId), {
    action: 'pause',
    draft_id: w.draftId,
  })
  expect(paused.status, errorText(paused.body)).toBe(200)
  const clockRes = await setClock(commish.client, commish.leagueId, {
    draft_id: w.draftId,
    nomination_seconds: 120,
    bid_seconds: 60,
  })
  expect([200, 400], errorText(clockRes.body)).toContain(clockRes.status)
  const resumed = await pauseOrResumeDraft(commish.client, w.scope(w.draftId), {
    action: 'resume',
    draft_id: w.draftId,
  })
  expect(resumed.status, errorText(resumed.body)).toBe(200)
  await assertSolvent(w.draftId, 'pause → clock edit → resume')
}

/** Drive the world to `complete` (bounded), asserting solvency at every
 *  observed award — the "board always completes" half of the property.
 *  §8.6.9's endgame instant awards happen INSIDE this region. */
async function driveToCompletion(w: WorldHandle): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await beat(w)
    const row = await readDraft(w.draftId)
    if (row.status === 'complete') return
    if (row.status === 'paused') {
      await pauseOrResumeDraft(w.commish?.client ?? w.actors[0]!.client, w.scope(w.draftId), {
        action: 'resume',
        draft_id: w.draftId,
      })
      continue
    }
    expect(row.status).toBe('live')
    if (w.hasCpus) {
      await provokeCpus(w.draftId)
      await rewindAndTick(w.draftId)
    } else {
      await rewindAndTick(w.draftId)
    }
    await assertSolvent(w.draftId, `completion drive step ${i}`)
  }
  const final = await readDraft(w.draftId)
  expect(final.status, 'the board must COMPLETE — a wedged rotation is a property failure').toBe('complete')
}

async function assertCompleteBoard(w: WorldHandle, teamIds: readonly string[]): Promise<void> {
  const row = await readDraft(w.draftId)
  expect(row.status).toBe('complete')
  const { data: picks } = await service
    .from('draft_picks')
    .select('team_id, player_id, price, is_undone')
    .eq('draft_id', w.draftId)
  const live = (picks ?? []).filter((p) => p.is_undone !== true)
  const byTeam = new Map<string, number>()
  const players = new Set<string>()
  for (const p of live) {
    byTeam.set(p.team_id as string, (byTeam.get(p.team_id as string) ?? 0) + 1)
    expect(players.has(p.player_id as string), `duplicate player ${p.player_id}`).toBe(false)
    players.add(p.player_id as string)
  }
  for (const teamId of teamIds) {
    expect(byTeam.get(teamId), `team ${teamId} must complete a full legal roster`).toBe(row.total_rounds)
  }
  await assertBudgetParity(w.draftId, teamIds)
  await assertSolvent(w.draftId, 'the completed board')
}

/** The bots-acted floor (CLAUDE.md: "nothing happened" must never mean "it
 *  worked"): a mock world's board is 8 seats × 2 slots with ONE human seat,
 *  so CPU franchises must have BOUGHT (≥ 14 of 16 awards) — every award's
 *  winning bid row belongs to its buyer, so CPU-seat `draft_bids` rows are
 *  structurally guaranteed IF the bots really ran. Zero here means the run
 *  was vacuous, whatever else passed. */
async function assertCpusActuallyBid(draftId: string, humanTeamId: string): Promise<void> {
  const { count } = await service
    .from('draft_bids')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', draftId)
    .neq('team_id', humanTeamId)
  expect(count ?? 0, 'no CPU-seat bid rows — the bots never acted (vacuous run)').toBeGreaterThan(0)
}

const commandsArb = fc.array(fc.nat({ max: 999 }), { minLength: 20, maxLength: 30 })

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('THE solvency property — DB layer (L.C4.1 item 3b; exit criterion 2)', () => {
  beforeAll(async () => {
    for (const u of USERS) await deleteUserByUsername(u.username)
    userIds = []
    clients = []
    for (const u of USERS) {
      const { data, error } = await service.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { username: u.username },
      })
      expect(error).toBeNull()
      userIds.push(data.user!.id)
      const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
        auth: { persistSession: false },
      })
      const { error: signInError } = await client.auth.signInWithPassword({
        email: u.email,
        password: u.password,
      })
      expect(signInError).toBeNull()
      clients.push(client)
    }
    await cleanup()
    // *** BREAK PROBE — the seeded pool removed; reverted in the next
    //     commit. The `> 64` premise below must go RED in CI. ***
    const { data: template, error: templateError } = await clients[0]!
      .from('scoring_systems')
      .select('id')
      .eq('is_template', true)
      .eq('name', 'ESPN Standard')
      .single()
    expect(templateError).toBeNull()
    scoringSystemId = template!.id
    const { data: players, error: poolError } = await clients[0]!
      .from('players')
      .select('id, position')
      .order('adp', { ascending: true, nullsFirst: false })
      .limit(200)
    expect(poolError).toBeNull()
    pool = (players ?? [])
      .filter((p) => p.position !== 'K' && p.position !== 'DEF')
      .map((p) => p.id as string)
    // Loud, not an empty walk — and after the seed above this is a premise
    // the fixture MAKES true rather than one it hopes the environment will
    // supply (F94: on `main` this read is 0 in CI, every run).
    expect(
      pool.length,
      `nominatable pool (top 200 by ADP, no K/DEF) — the seeded ${POOL_PLAYERS.length}-player ` +
        'fixture pool alone clears this floor, so a failure here means the seed did not land',
    ).toBeGreaterThan(64)
  }, 120_000)

  afterAll(async () => {
    await cleanup()
    // The F118/D262 sweep, fixture-scoped + the orphan-standalone counter:
    const { count: leagueCount } = await service
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .like('name', `${LEAGUE_PREFIX}%`)
    expect(leagueCount).toBe(0)
    const { count: orphanTeams } = await service
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .is('league_id', null)
    // Our standalone mocks are deleted through the RPC graph delete above —
    // any orphan standalone team left is pollution SOMEONE must see (D262's
    // corrected sweep). Logged loud; asserted zero because this suite's own
    // worlds are the only standalone mints in a test run.
    expect(orphanTeams, 'orphan standalone-mock teams (league_id IS NULL) left behind').toBe(0)
    // F127's sweep, extended to `players`: this suite seeds a pool, so it
    // owes the measurement that it left none of it behind.
    const { count: poolLeft } = await service
      .from('players')
      .select('id', { count: 'exact', head: true })
      .like('id', `${POOL_PREFIX}-%`)
    expect(poolLeft, 'seeded pool rows left in `players`').toBe(0)
    for (const u of USERS) await deleteUserByUsername(u.username)
  }, 120_000)

  it('WORLD A — real league, reserve $1: every prefix of every sequence is solvent; refusals change nothing; the board completes', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (cmds) => {
        const world = await provisionLeagueWorld(false, 50)
        try {
          const w: WorldHandle = {
            label: 'league-r1',
            draftId: world.draftId,
            actors: world.humanTeams,
            scope: () => leagueScope(world.leagueId),
            commish: { client: clients[0]!, leagueId: world.leagueId },
            hasCpus: false,
          }
          const replayed = { body: null as unknown }
          for (const c of cmds) await runCommand(w, c, replayed)
          await driveToCompletion(w)
          await assertCompleteBoard(w, world.teamIds)
        } finally {
          await teardownLeagueWorld(world.leagueId)
        }
      }),
      FC,
    )
  }, 600_000)

  it('WORLD B — real league, $0 nominations ON (reserve 0): the machinery stays correct and stops binding', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (cmds) => {
        const world = await provisionLeagueWorld(true, 50)
        try {
          const w: WorldHandle = {
            label: 'league-r0',
            draftId: world.draftId,
            actors: world.humanTeams,
            scope: () => leagueScope(world.leagueId),
            commish: { client: clients[0]!, leagueId: world.leagueId },
            hasCpus: false,
          }
          const replayed = { body: null as unknown }
          for (const c of cmds) await runCommand(w, c, replayed)
          await driveToCompletion(w)
          await assertCompleteBoard(w, world.teamIds)
        } finally {
          await teardownLeagueWorld(world.leagueId)
        }
      }),
      FC,
    )
  }, 600_000)

  it('WORLD C — league-attached MOCK with fast CPU bidders: bot-driven sequences hold the invariant (E62)', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (cmds) => {
        // A pre-draft league (setup) hosts the mock; the launcher is MGR2
        // driving the COMMISSIONER's seat (any seat selectable, D103) —
        // slot-pinning is WORLD D's axis.
        const world = await provisionMockHostLeague()
        try {
          const launched = await launchMockDraft(
            clients[1]!,
            world.leagueId,
            { human_team_id: world.commishTeamId, cpu_speed: 'fast' },
            { mintActionId },
          )
          expect(launched.status, errorText(launched.body)).toBe(201)
          const mock = (launched.body as { draft: { id: string } }).draft
          const w: WorldHandle = {
            label: 'league-mock',
            draftId: mock.id,
            actors: [{ client: clients[1]!, userId: userIds[1]!, teamId: world.commishTeamId }],
            scope: () => leagueScope(world.leagueId),
            commish: null,
            hasCpus: true,
          }
          const replayed = { body: null as unknown }
          for (const c of cmds) await runCommand(w, c, replayed)
          await driveToCompletion(w)
          const row = await readDraft(mock.id)
          expect(row.status).toBe('complete')
          await assertSolvent(mock.id, 'the completed mock board')
          await assertCpusActuallyBid(mock.id, world.commishTeamId)
          // §8.8 zero side effects, the cheap half: the host league moved
          // nowhere (the exhaustive measurement is mock-auction-db's).
          const { data: league } = await service
            .from('leagues')
            .select('status')
            .eq('id', world.leagueId)
            .single()
          expect(league!.status).toBe('setup')
          const del = await clients[1]!.rpc('delete_mock_draft', { p_draft_id: mock.id })
          expect(del.error).toBeNull()
        } finally {
          await teardownLeagueWorld(world.leagueId)
        }
      }),
      FC,
    )
  }, 600_000)

  it('WORLD E — a DETERMINISTIC §8.6.9 mid-board instant award: constructed uncontestable, awarded in the nominate txn, solvent', async () => {
    // The randomized runs CROSS the §8.6.9 region (endgame instants ride
    // the system-nomination tick), but a sweep counter cannot distinguish a
    // tick-path instant from a plain no-raise award after the fact — so the
    // mid-board instant is CONSTRUCTED here, once, deterministically:
    // legal budget edits pin every rival to the exact solvency floor
    // (remaining = open_slots × $1 ⇒ max_bid = $1 < opening + 1), then the
    // on-clock human nominates at $1 — no rival can reach $2, the award
    // commits in the nomination's own transaction (v2.13.4: the row is
    // ALREADY awarded in the 200; no bid window ever opens), and solvency
    // holds through it. E67's exact broadcast pins are
    // auction-uncontestable-db's; this is the PROPERTY crossing the rule.
    const world = await provisionLeagueWorld(false, 50)
    try {
      const draftId = world.draftId
      const row0 = await readDraft(draftId)
      expect(readLiveNomination(row0.current_nomination)).toBeNull()
      // Rotate to a HUMAN nominator if a placeholder opens the order.
      for (let i = 0; i < TEAM_COUNT; i++) {
        const r = await readDraft(draftId)
        if (world.humanTeams.some((h) => h.teamId === r.on_clock_team_id)) break
        await rewindAndTick(draftId)
        // A system nomination opened a market — close it (no raises).
        await rewindAndTick(draftId)
      }
      const row = await readDraft(draftId)
      const nominator = world.humanTeams.find((h) => h.teamId === row.on_clock_team_id)
      expect(nominator, 'a human seat must reach the nomination clock').toBeDefined()
      // Pin every RIVAL to the floor: delta = −(remaining − open_slots) is
      // E28-LEGAL (lands exactly ON the floor — the D146 boundary from the
      // legal side) and leaves max_bid = remaining − (open−1) = 1.
      for (const teamId of world.teamIds) {
        if (teamId === nominator!.teamId) continue
        const view = await viewTeam(draftId, teamId, row)
        const delta = -(view.remaining - view.openSlots * 1)
        if (delta === 0) continue
        const res = await adjustBudget(clients[0]!, world.leagueId, {
          draft_id: draftId,
          team_id: teamId,
          delta,
          reason: 'property: pin rival to the solvency floor (uncontestable construction)',
          action_id: mintActionId(),
        })
        expect(res.status, errorText(res.body)).toBe(200)
      }
      await assertSolvent(draftId, 'the floor-pinned board (every edit legal)')
      const seqBefore = row.current_pick_number ?? 0
      const player = await availablePlayer(draftId, 0)
      const res = await nominatePlayer(nominator!.client, leagueScope(world.leagueId), nominator!.userId, {
        draft_id: draftId,
        player_id: player!,
        opening_bid: 1,
        action_id: mintActionId(),
      })
      expect(res.status, errorText(res.body)).toBe(200)
      const after = (res.body as { draft: { current_nomination: Json | null; current_pick_number: number } }).draft
      // THE INSTANT AWARD, observed in the nomination's own response: no
      // market is live and the sequence has already advanced (v2.13.4 —
      // "there is no interval in which the award is pending").
      expect(readLiveNomination(after.current_nomination)).toBeNull()
      expect(after.current_pick_number).toBe(seqBefore + 1)
      const { data: awarded } = await service
        .from('draft_picks')
        .select('team_id, price, is_undone')
        .eq('draft_id', draftId)
        .eq('pick_number', seqBefore)
        .single()
      expect(awarded).toMatchObject({ team_id: nominator!.teamId, price: 1, is_undone: false })
      await assertSolvent(draftId, 'the §8.6.9 instant award')
    } finally {
      await teardownLeagueWorld(world.leagueId)
    }
  }, 300_000)

  it('WORLD D — STANDALONE mock, slot-pinned, $0 nominations: the MP/MS world holds the invariant end to end', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (cmds) => {
        const launched = await launchStandaloneMockDraft(
          clients[2]!,
          {
            cpu_speed: 'fast',
            slot: 3, // 102/MS.8: the launcher's pinned draft slot
            settings: {
              team_count: TEAM_COUNT,
              roster_settings: {
                starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
                bench: SLOTS_PER_TEAM - 1,
                ir_slots: [],
                swap_spots: 0,
              },
              draft: {
                draft_type: 'auction',
                snake_reversal: false,
                draft_order_mode: 'random',
                draft_order: null,
                pick_timer_seconds: 90,
                auction_budget: 50,
                auction_zero_dollar_nominations: true,
                auction_nomination_seconds: NOMINATION_SECONDS,
                auction_bid_seconds: BID_SECONDS,
                auction_anti_snipe_seconds: 10,
                nomination_order_mode: 'same_as_draft_order',
                nomination_order: null,
                autopick_default: 'queue_then_board_then_adp',
                disconnect_grace_seconds: 30,
                draft_scheduled_at: null,
                time_zone: null,
                scoring_system_id: scoringSystemId,
              },
            },
            action_id: mintActionId(),
          },
          { mintActionId },
        )
        expect(launched.status, errorText(launched.body)).toBe(201)
        const mock = (launched.body as { draft: { id: string; draft_order: string[]; config: Json } }).draft
        const humanTeamId = (
          (mock.config as Record<string, unknown>).mock as Record<string, unknown>
        ).human_team_id as string
        // The pin is real: the human seat sits at slot 3 of the drawn order.
        expect(mock.draft_order[2]).toBe(humanTeamId)
        try {
          const w: WorldHandle = {
            label: 'standalone-mock',
            draftId: mock.id,
            actors: [{ client: clients[2]!, userId: userIds[2]!, teamId: humanTeamId }],
            scope: () => standaloneMockScope(mock.id, userIds[2]!),
            commish: null,
            hasCpus: true,
          }
          const replayed = { body: null as unknown }
          for (const c of cmds) await runCommand(w, c, replayed)
          await driveToCompletion(w)
          await assertSolvent(mock.id, 'the completed standalone board')
          const row = await readDraft(mock.id)
          expect(row.status).toBe('complete')
          await assertCpusActuallyBid(mock.id, humanTeamId)
        } finally {
          const del = await clients[2]!.rpc('delete_mock_draft', { p_draft_id: mock.id })
          expect(del.error).toBeNull()
        }
      }),
      FC,
    )
  }, 600_000)
})

/** A pre-draft league in `setup` that hosts WORLD C's mock — same auction
 *  knobs, never scheduled, never started (mocks launch pre-draft, §8.8). */
async function provisionMockHostLeague(): Promise<{ leagueId: string; commishTeamId: string }> {
  worldCounter += 1
  const name = `${LEAGUE_PREFIX}-mock${worldCounter}-${process.pid.toString(36)}`
  const settings = defaultsForTeamCount(TEAM_COUNT)
  const created = await createLeague(clients[0]!, {
    name,
    season: 2026,
    scoring_system_id: scoringSystemId,
    team_name: `${name} T1`,
    action_id: mintActionId(),
    settings: {
      ...settings,
      roster_settings: {
        starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
        bench: SLOTS_PER_TEAM - 1,
        ir_slots: [],
        swap_spots: 0,
      },
      draft: {
        ...settings.draft,
        draft_type: 'auction' as const,
        auction_budget: 50,
        auction_nomination_seconds: NOMINATION_SECONDS as 120,
        auction_bid_seconds: BID_SECONDS as 60,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  expect(created.status, errorText(created.body)).toBe(201)
  const leagueId = (created.body as { league_id: string }).league_id
  // MGR2 (the launcher) joins as a member; the rest are placeholders.
  const invite = await createInvite(clients[0]!, leagueId, {})
  expect([200, 201]).toContain(invite.status)
  const claim = await claimInvite(clients[1]!, { token: (invite.body as { token: string }).token })
  expect(claim.status, errorText(claim.body)).toBe(200)
  for (let i = 0; i < TEAM_COUNT - 2; i++) {
    const filled = await addPlaceholderSeat(clients[0]!, leagueId, {})
    expect(filled.status, errorText(filled.body)).toBe(201)
  }
  const { data: commishMember } = await clients[0]!
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('user_id', userIds[0]!)
    .single()
  return { leagueId, commishTeamId: commishMember!.team_id as string }
}
