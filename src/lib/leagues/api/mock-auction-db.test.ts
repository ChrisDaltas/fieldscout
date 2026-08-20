/**
 * mock-auction-db.test.ts — L.C1.7 at the WIRE layer: migration 089's mock
 * auctions against the LOCAL Supabase stack — a real member launches a
 * practice auction through the mock-launch service (`create_mock_draft`'s
 * auction arm), the D103(2) launcher gate refuses the human seat's REAL
 * manager and admits the launcher over PostgREST, the real service-role
 * tick's CPU sub-arm nominates and raises (ARM 2.6(c), D132), a CPU raise
 * inside the anti-snipe window floors the clock (D128), and the whole
 * practice is driven to completion with the §8.8 zero-side-effect contract
 * re-measured over the wire: the leagues row byte-identical, no
 * `league_rosters`, no status transition, every `draft_bids` row under the
 * mock's own draft_id. The auction edition of `draft-commish-api-db.test.ts`'s
 * mock lifecycle and `auction-tick-db.test.ts`'s all-engine board.
 *
 * WHAT THIS LAYER ADDS over pgTAP 038, which owns the exhaustive matrix
 * (the launch goldens to the second, F61 from both sides, CPU think-time at
 * one unit, the anti-snipe floor to the second, E62 at the budget edge, the
 * R383 composite, the D138 sweep): pgTAP runs in ONE transaction with a
 * frozen `now()`; only this layer can show that the chain — launch over
 * HTTP → the launcher's RPCs as a signed-in user → the COMMITTED service-role
 * tick's CPU sub-arm → award → completion — converges across separate
 * transactions, with the live 5s pg_cron tick as a LEGAL concurrent actor
 * (D100: it runs the same deterministic arms, so every assertion below is
 * on converged DB state and never on which caller ticked — and `fast`
 * cpu_speed means the cron itself keeps the CPUs bidding while this suite
 * runs, which is why the counts are bounds, not equalities).
 *
 * HARNESS (D100): think-times and timeouts are produced by service-role
 * rewinds of the SERVER-written `current_deadline` / `updated_at` between
 * direct `draft_tick()` calls — production RPCs never accept a caller
 * clock. Rewinds SUBTRACT from server timestamps, so no wall clock is read
 * anywhere (the D3/D17 ESLint guard covers this file).
 *
 * Seats: the COMMISSIONER launches (any member may — §8.8) on MGR2's
 * franchise (D103's "any seat selectable" — the launcher-gate
 * discriminator: MGR2 manages the human seat and is still refused); six
 * placeholder seats are the CPUs. Roster override 1 RB + 1 bench ⇒ 2 slots
 * × 8 = 16 nominations; the catalog-minimum $50 budget keeps the $1-raise
 * ladders short.
 *
 * FIXTURE ADP IS FRACTIONAL (the R286 lesson / ledger F60): every fixture
 * player sits below every real ADP by value, so the restored pool can hand
 * no CPU nomination to a real player.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { launchMockDraft } from './draft-service'
import { claimInvite, createInvite } from './invites-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-mock-auction-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This league never schedules a real
 *  draft at all (it stays in `setup` — the §8.8 pre-draft window). */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
const SLOTS_PER_TEAM = 2
const TOTAL_NOMINATIONS = TEAM_COUNT * SLOTS_PER_TEAM

const AUCTION_BUDGET = 50
const AUCTION_MIN_BID = 1
const NOMINATION_SECONDS = 30
const BID_SECONDS = 20
const ANTI_SNIPE_SECONDS = 10

const COMMISH = {
  email: 'mock-auction-commish@fieldscout.test',
  password: 'pgtap-mock-auction-1',
  username: 'ma_wire_commish',
}
const MGR2 = {
  email: 'mock-auction-mgr2@fieldscout.test',
  password: 'pgtap-mock-auction-2',
  username: 'ma_wire_mgr2',
}

/**
 * 30 RBs at adp 0.001…0.030 — below every real ADP (see the header) — plus
 * ONE KICKER at 0.031. The kicker exists because of 091/AP.3: a nomination
 * now provokes the CPUs in its own transaction, so on an ordinary player the
 * launcher would not be the standing high bidder a moment later, and the F61
 * self-raise discriminator below would be unreachable. `draft_mock_cpu_need`
 * prices K/DST at 0 for every seat (D163/R406), so a kicker is a market no
 * CPU will ever answer — the gate assertions keep their exact shape, and the
 * contrast documents the new behaviour instead of hiding from it.
 */
const PLAYERS = [
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `ma-wire-rb${String(i + 1).padStart(2, '0')}`,
    full_name: `MA Wire RB ${String(i + 1).padStart(2, '0')}`,
    position: 'RB',
    adp: (i + 1) / 1000,
  })),
  { id: 'ma-wire-k01', full_name: 'MA Wire K 01', position: 'K', adp: 0.031 },
]
/** The uncontestable market of the F61 gate assertions (see above). */
const KICKER = PLAYERS[PLAYERS.length - 1]

const ACTION = {
  create: 'ae700000-0000-4000-8000-000000000001',
  launch: 'ae700000-0000-4000-8000-000000000002',
  intruderNominate: 'ae700000-0000-4000-8000-000000000003',
  launcherNominate: 'ae700000-0000-4000-8000-000000000004',
  intruderBid: 'ae700000-0000-4000-8000-000000000005',
  launcherBid: 'ae700000-0000-4000-8000-000000000006',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
type LeagueRow = Database['public']['Tables']['leagues']['Row']
interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}
interface TickSummary {
  auction_cpu_claimed: number
  auction_cpu_nominated: number
  auction_cpu_raised: number
  auction_cpu_folded: number
  auction_cpu_failures: unknown[]
  auction_awarded: number
  auction_completed: number
  auction_failures: unknown[]
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let leagueId: string
let mockId: string
let commishTeamId: string
let mgr2TeamId: string
/** The leagues row as launched — the §8.8 composite's BEFORE (whole row). */
let leagueBefore: LeagueRow

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    await service.from('league_rosters').delete().in('league_id', ids)
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  for (const u of [COMMISH, MGR2]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<void> {
  const { error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function readMock(): Promise<DraftRow> {
  const { data, error } = await service.from('drafts').select('*').eq('id', mockId).single()
  if (error) throw new Error(`mock read failed: ${error.message}`)
  return data as DraftRow
}

async function tick(): Promise<TickSummary> {
  const { data, error } = await service.rpc('draft_tick')
  if (error) throw new Error(`draft_tick failed: ${error.message}`)
  return data as unknown as TickSummary
}

/**
 * Keep the LAUNCHER's heartbeat fresh, through the real `draft_touch` RPC
 * (SECURITY DEFINER, server clock — no wall clock is read here either).
 *
 * A live mock auto-pauses when its launcher goes stale past
 * `disconnect_grace_seconds` + one tick (E59 / ARM 1.6), and this suite drives
 * a whole 16-nomination board across many separate transactions. Before
 * 091/AP.3 the suite happened to fit inside the grace window; a driver that
 * only *happens* to be fast enough is a wall-clock race against its own
 * fixture, so the beat is now explicit — which is also what a real driver is:
 * a human sitting in the room.
 */
async function beat(): Promise<void> {
  const { error } = await commishClient.rpc('draft_touch', { p_draft_id: mockId })
  expect(error).toBeNull()
}

async function bidCount(): Promise<number> {
  const { count, error } = await service
    .from('draft_bids')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', mockId)
  if (error) throw new Error(`draft_bids count failed: ${error.message}`)
  return count ?? 0
}

/** Shift a server timestamp by `ms` (negative = rewind). */
function shifted(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

beforeAll(async () => {
  await cleanup()
  await createUser(COMMISH)
  await createUser(MGR2)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)

  await service.from('players').upsert([...PLAYERS])

  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'Mock Auction Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // MGR2 on a real franchise (placeholder seat → username invite → claim —
  // the L.A1.14/15 path); six more placeholders = the CPU seats.
  const seat = await addPlaceholderSeat(commishClient, leagueId, { team_name: 'Seat for mgr2' })
  if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
  mgr2TeamId = (seat.body as { team_id: string }).team_id
  const invite = await createInvite(commishClient, leagueId, {
    target_team_id: mgr2TeamId,
    invited_username: MGR2.username,
  })
  if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
  const claim = await claimInvite(mgr2Client, { token: (invite.body as { token: string }).token })
  if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)

  const placeholderIds: string[] = []
  for (let i = 0; i < TEAM_COUNT - 2; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
    placeholderIds.push((fill.body as { team_id: string }).team_id)
  }
  const { data: commishMember, error: memberError } = await service
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('role', 'commissioner')
    .single()
  if (memberError || !commishMember?.team_id) {
    throw new Error(`commissioner team lookup failed: ${memberError?.message}`)
  }
  commishTeamId = commishMember.team_id

  // MGR2's seat FIRST (the human seat opens the mock — the launcher-gate
  // discriminator), the launcher's own franchise second, then the CPUs.
  const orderedTeamIds = [mgr2TeamId, commishTeamId, ...placeholderIds]
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      roster_settings: {
        starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
        bench: 1,
        ir_slots: [],
        swap_spots: 0,
      },
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: AUCTION_BUDGET,
        auction_min_bid: AUCTION_MIN_BID,
        auction_nomination_seconds: NOMINATION_SECONDS,
        auction_bid_seconds: BID_SECONDS,
        auction_anti_snipe_seconds: ANTI_SNIPE_SECONDS,
        disconnect_grace_seconds: 30,
        pick_timer_seconds: 90,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`auction configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }

  const { data: league, error: leagueError } = await service
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single()
  if (leagueError) throw new Error(`league read failed: ${leagueError.message}`)
  leagueBefore = league as LeagueRow
}, 240_000)

afterAll(async () => {
  await cleanup()
})

describe('mock auctions over PostgREST (migration 089)', () => {
  it('the launch arm: a practice AUCTION launches through the mock-launch service on another member’s seat', async () => {
    const launched = await launchMockDraft(
      commishClient,
      leagueId,
      { human_team_id: mgr2TeamId, cpu_speed: 'fast' },
      { mintActionId: () => ACTION.launch },
    )
    expect(launched.status).toBe(201)
    const body = launched.body as unknown as { draft: DraftRow; created: boolean }
    expect(body.created).toBe(true)
    mockId = body.draft.id

    // The exact call 071 refused ("mock auctions land with the auction
    // engine in M3") launches as an AUCTION in the NOMINATING phase with
    // the human seat on the clock and the nomination clock running.
    expect(body.draft.is_mock).toBe(true)
    expect(body.draft.draft_type).toBe('auction')
    expect(body.draft.status).toBe('live')
    expect(body.draft.current_nomination).toBeNull()
    expect(body.draft.on_clock_team_id).toBe(mgr2TeamId)
    expect(body.draft.current_pick_number).toBe(1)
    expect(body.draft.total_rounds).toBe(SLOTS_PER_TEAM)
    expect((body.draft.nomination_order as string[]).length).toBe(TEAM_COUNT)
    expect((body.draft.nomination_order as string[])[0]).toBe(mgr2TeamId)
    expect(body.draft.current_deadline).not.toBeNull()
    expect(body.draft.budget_adjustments).toEqual({})
    const config = body.draft.config as Record<string, unknown>
    expect(config.auction_budget).toBe(AUCTION_BUDGET)
    expect(config.auction_anti_snipe_seconds).toBe(ANTI_SNIPE_SECONDS)
    expect((config.mock as Record<string, unknown>).human_team_id).toBe(mgr2TeamId)
    expect((config.mock as Record<string, unknown>).cpu_speed).toBe('fast')

    // E60 shape at launch: the league row is untouched (still `setup`), no
    // real draft row was created.
    const { data: league } = await service.from('leagues').select('*').eq('id', leagueId).single()
    expect(league).toEqual(leagueBefore)
    const { count: realDrafts } = await service
      .from('drafts')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('is_mock', false)
    expect(realDrafts).toBe(0)
  }, 60_000)

  it('F61 over the wire: the human seat’s REAL manager is refused; the launcher nominates and bids FOR that seat', async () => {
    // MGR2 manages the on-clock franchise — the ordinary turn check would
    // admit this; only the D103(2) launcher gate refuses it.
    const { error: intruder } = await mgr2Client.rpc('draft_nominate', {
      p_draft_id: mockId,
      p_player_id: KICKER.id,
      p_opening_bid: 1,
      p_action_id: ACTION.intruderNominate,
    })
    expect(intruder?.code).toBe('P0001')
    expect(intruder?.message).toContain("another member's solo practice")

    const { data, error } = await commishClient.rpc('draft_nominate', {
      p_draft_id: mockId,
      p_player_id: KICKER.id,
      p_opening_bid: 1,
      p_action_id: ACTION.launcherNominate,
    })
    expect(error).toBeNull()
    const opened = data as unknown as { draft: DraftRow; bid: { team_id: string; amount: number } }
    // The launcher nominated FOR the human seat (MGR2's franchise), not for
    // their own.
    expect(opened.bid.team_id).toBe(mgr2TeamId)
    expect(opened.bid.amount).toBe(1)
    const nomination = opened.draft.current_nomination as unknown as LiveNomination
    // 091/AP.3: the RPC returns the POST-responder state. On this kicker the
    // responder found no candidate (every CPU values a K at $0), so the
    // human seat is still the standing high bidder — which is the only state
    // in which the self-raise discriminator below is reachable.
    expect(nomination.high_bidder_team_id).toBe(mgr2TeamId)
    expect(nomination.player_id).toBe(KICKER.id)
    expect(nomination.high_bid).toBe(1)

    // Bids: MGR2 refused; the launcher's own bid resolves to the human seat
    // (the standing high bidder ⇒ the self-raise refusal, reachable only
    // if the mock bidder-team resolution is the human seat).
    const { error: intruderBid } = await mgr2Client.rpc('draft_place_bid', {
      p_draft_id: mockId,
      p_amount: 2,
      p_action_id: ACTION.intruderBid,
    })
    expect(intruderBid?.code).toBe('P0001')
    expect(intruderBid?.message).toContain("another member's solo practice")

    const { error: selfRaise } = await commishClient.rpc('draft_place_bid', {
      p_draft_id: mockId,
      p_amount: 2,
      p_action_id: ACTION.launcherBid,
    })
    expect(selfRaise?.code).toBe('P0001')
    expect(selfRaise?.message).toContain('you are already the high bidder at $1')
  }, 60_000)

  it('the CPU ladder is provoked by the nomination, not the sweep; a raise inside the anti-snipe window still floors the clock (D128)', async () => {
    // Close out the uncontestable kicker market from the previous test so the
    // rotation reaches a CPU seat, which will nominate on its `fast`
    // think-time — and, since 091/AP.3, will be answered inside that same
    // transaction.
    await beat()
    const kickerMarket = await readMock()
    await service
      .from('drafts')
      .update({ current_deadline: shifted(kickerMarket.current_deadline as string, -40_000) })
      .eq('id', mockId)
      .eq('status', 'live')
    await tick()

    let opened = await readMock()
    let guard = 0
    while (opened.status === 'live' && opened.current_nomination === null && guard < 10) {
      guard += 1
      await service
        .from('drafts')
        .update({ current_deadline: shifted(opened.current_deadline as string, -28_500) })
        .eq('id', mockId)
        .eq('status', 'live')
      const s = await tick()
      expect(s.auction_cpu_failures).toEqual([])
      expect(s.auction_failures).toEqual([])
      opened = await readMock()
    }
    expect(opened.status).toBe('live')
    expect(opened.current_nomination).not.toBeNull()

    // PROVOKED, NOT SWEPT (§8.8/D200(1)): the market a CPU seat opened is
    // ALREADY contested — the ladder ran inside draft_system_nominate_internal
    // in the same tick pass that opened it, not one 5-second sweep later.
    const live = opened.current_nomination as unknown as LiveNomination
    const seq = opened.current_pick_number as number
    const { data: bids } = await service
      .from('draft_bids')
      .select('team_id, amount, action_id')
      .eq('draft_id', mockId)
      .eq('nomination_seq', seq)
      .order('amount')
    const rows = bids ?? []
    expect(rows.length).toBeGreaterThan(1)
    expect(live.high_bid).toBeGreaterThan(1)
    // Every raise above the opening is a SYSTEM row (D130: action_id NULL ⇒ a
    // CPU's win is an autopick) and none of them is the human seat's.
    const raises = rows.filter((b) => b.amount > 1)
    expect(raises.length).toBeGreaterThan(0)
    expect(raises.every((b) => b.action_id === null)).toBe(true)
    expect(raises.every((b) => b.team_id !== mgr2TeamId)).toBe(true)
    // The ladder is strictly increasing and NEVER above a bidder's ceiling —
    // the amounts are no longer a $1 staircase (091 jump-bids), so what is
    // asserted is the shape the engine guarantees, not the old arithmetic.
    for (let i = 1; i < rows.length; i++) expect(rows[i].amount).toBeGreaterThan(rows[i - 1].amount)
    for (const raise of raises) {
      const { data: budget } = await service.rpc('draft_team_budget', {
        p_draft_id: mockId,
        p_team_id: raise.team_id,
      })
      const maxBid = (budget as unknown as { max_bid: number }[])[0].max_bid
      expect(raise.amount).toBeLessThanOrEqual(maxBid)
    }
    // …and the ladder TERMINATED: a sweep over the settled market folds.
    await service
      .from('drafts')
      .update({ updated_at: shifted(opened.updated_at as string, -3_000) })
      .eq('id', mockId)
      .eq('status', 'live')
    const settled = await tick()
    expect(settled.auction_cpu_raised).toBe(0)
    expect(settled.auction_cpu_failures).toEqual([])

    // ANTI-SNIPE OBEDIENCE IS UNCHANGED BY AP.3 (D128). Re-open the settled
    // market at its OPENING price with ~5s left on the SERVER-written clock
    // (inside the 10s window, with margin — the live 5s cron is a legal
    // concurrent actor and a 3s target can slip past the buzzer between two
    // round trips). The next responder raise must floor the deadline to
    // ≈ server-now + 10s: later than the windowed value, and by no more than
    // the threshold — a reset-to-full would be +20s.
    const priced = await readMock()
    expect(priced.current_nomination).not.toBeNull()
    const pricedNom = priced.current_nomination as unknown as LiveNomination
    const windowed = shifted(priced.current_deadline as string, -(BID_SECONDS - 5) * 1_000)
    const { error: windowError } = await service
      .from('drafts')
      .update({
        current_nomination: { ...pricedNom, high_bid: 1, high_bidder_team_id: rows[0].team_id },
        current_deadline: windowed,
        updated_at: shifted(priced.updated_at as string, -3_000),
      })
      .eq('id', mockId)
      .eq('status', 'live')
    expect(windowError).toBeNull()
    const snipeSummary = await tick()
    expect(snipeSummary.auction_cpu_failures).toEqual([])
    const floored = await readMock()
    expect(floored.status).toBe('live')
    expect(floored.current_nomination).not.toBeNull()
    const flooredMs = Date.parse(floored.current_deadline as string)
    expect(flooredMs).toBeGreaterThan(Date.parse(windowed))
    // The floor is now() + 10s at the raise; `updated_at` IS that instant
    // (the bid write stamps both) — the window is exactly the threshold.
    expect(flooredMs - Date.parse(floored.updated_at as string)).toBeLessThanOrEqual(
      ANTI_SNIPE_SECONDS * 1_000 + 50,
    )
    expect(flooredMs - Date.parse(floored.updated_at as string)).toBeGreaterThanOrEqual(
      ANTI_SNIPE_SECONDS * 1_000 - 1_000,
    )
  }, 60_000)

  it('drives the whole practice to completion: CPU nominations + raises, awards, zero league side effects', async () => {
    let guard = 0
    let resumes = 0
    for (;;) {
      guard += 1
      if (guard > 1500) throw new Error('the mock auction did not complete within the step budget')
      await beat()
      const row = await readMock()
      if (row.status === 'complete') break
      if (row.status === 'paused') {
        // E59, and it is CORRECT: a live mock auto-pauses when its launcher's
        // heartbeat goes stale past disconnect_grace + one tick. Under a
        // parallel suite run this file can be starved for longer than that
        // between iterations, and a human whose tab was throttled comes back
        // and hits Resume — the launcher's own action, never the tick's. It is
        // BOUNDED so a genuine pause defect still surfaces as a failure rather
        // than as an infinite resume loop.
        resumes += 1
        if (resumes > 5) throw new Error('the mock auction kept auto-pausing (E59) — more than five resumes')
        const { error } = await commishClient.rpc('draft_resume', { p_draft_id: mockId })
        expect(error).toBeNull()
        continue
      }
      if (row.status !== 'live') throw new Error(`unexpected status ${row.status}`)
      if (row.current_nomination === null) {
        // NOMINATING. The human seat's clock: expire it past the grace hold
        // (the launcher's launch-time beat is not fresh AS OF a deadline
        // 120s in the past ⇒ the hold ran and expired ⇒ the timeout path
        // system-nominates through the same internal). A CPU seat: make its
        // `fast` think-time due while the clock still runs (deadline − 28.5s
        // leaves 1.5s on the clock and puts the 2s think 26.5s in the past).
        const human = (row.config as { mock: { human_team_id: string } }).mock.human_team_id
        const shift = row.on_clock_team_id === human ? -120_000 : -28_500
        await service
          .from('drafts')
          .update({ current_deadline: shifted(row.current_deadline as string, shift) })
          .eq('id', mockId)
          .eq('status', 'live')
        await tick()
      } else {
        // BIDDING: make the raise think-time due; if no CPU raised (every
        // CPU folded — or the cron already did the work), expire the clock
        // so the award lands.
        const bidsBefore = await bidCount()
        await service
          .from('drafts')
          .update({ updated_at: shifted(row.updated_at as string, -3_000) })
          .eq('id', mockId)
          .eq('status', 'live')
        const s = await tick()
        expect(s.auction_cpu_failures).toEqual([])
        expect(s.auction_failures).toEqual([])
        if ((await bidCount()) === bidsBefore) {
          const fresh = await readMock()
          if (fresh.status === 'live' && fresh.current_nomination !== null) {
            await service
              .from('drafts')
              .update({ current_deadline: shifted(fresh.current_deadline as string, -40_000) })
              .eq('id', mockId)
              .eq('status', 'live')
            await tick()
          }
        }
      }
    }

    const done = await readMock()
    expect(done.status).toBe('complete')
    expect(done.completed_at).not.toBeNull()
    expect(done.current_nomination).toBeNull()

    const { data: picks } = await service
      .from('draft_picks')
      .select('team_id, price, round, is_auto, made_via')
      .eq('draft_id', mockId)
      .eq('is_undone', false)
    expect(picks?.length).toBe(TOTAL_NOMINATIONS)
    const perTeam = new Map<string, number>()
    for (const p of picks ?? []) {
      perTeam.set(p.team_id, (perTeam.get(p.team_id) ?? 0) + (p.price ?? 0))
      expect(p.round).toBeNull()
      expect(p.price).toBeGreaterThanOrEqual(AUCTION_MIN_BID)
    }
    expect(perTeam.size).toBe(TEAM_COUNT)
    for (const spent of perTeam.values()) expect(spent).toBeLessThanOrEqual(AUCTION_BUDGET)
    const { data: solvent, error: solventError } = await service.rpc('draft_auction_solvent', {
      p_draft_id: mockId,
    })
    expect(solventError).toBeNull()
    expect(solvent).toBe(true)

    // The CPUs really bid: system raises above the opening exist.
    const { count: cpuRaises } = await service
      .from('draft_bids')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', mockId)
      .is('action_id', null)
      .gt('amount', AUCTION_MIN_BID)
    expect(cpuRaises ?? 0).toBeGreaterThan(0)

    // ZERO SIDE EFFECTS (§8.8): the leagues row byte-identical to the
    // launch-time capture (no status transition, no settings write, no
    // updated_at bump), NO league_rosters, every draft_bids row in this
    // league under the MOCK's draft_id.
    const { data: leagueAfter } = await service.from('leagues').select('*').eq('id', leagueId).single()
    expect(leagueAfter).toEqual(leagueBefore)
    expect((leagueAfter as LeagueRow).status).toBe('setup')
    const { count: rosters } = await service
      .from('league_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
    expect(rosters).toBe(0)
    const { count: strayBids } = await service
      .from('draft_bids')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .neq('draft_id', mockId)
    expect(strayBids).toBe(0)
    const { count: realDrafts } = await service
      .from('drafts')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('is_mock', false)
    expect(realDrafts).toBe(0)
  }, 240_000)
})
