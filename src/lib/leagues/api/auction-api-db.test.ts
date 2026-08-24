/**
 * auction-api-db.test.ts — L.C2.1 at the WIRE layer: the §15.2 nominate/bid
 * routes (`nominatePlayer` / `placeBid` in draft-service.ts — the exact
 * composition the Route Handlers run, the D68 wire-suite convention) driven
 * over the LOCAL stack through PostgREST by real signed-in users, plus the
 * §4.7 TS ≡ SQL budget-parity sweep.
 *
 * What this suite owns (pgTAP 034/038 own the RPC-side matrices; the
 * auction-core / mock-auction wire suites own the bare-RPC transport and the
 * held-lock bound):
 *   - F64 DISCHARGED: the bid body REQUIRES the nomination identity
 *     (`nomination_seq` + `player_id` — a body without them is a 400 before
 *     any RPC, nothing written) and the service passes both through on
 *     EVERY call — pinned END-TO-END: a stale identity (the player arm AND
 *     the seq-with-matching-player arm — R337) is refused through the route
 *     with §16.3's "just went off the board" product copy as a friendly 400;
 *   - F65 DISCHARGED, in TWO ARMS. The ARGUMENT arm: a nomination's id sent
 *     through the bid route (and a bid's id through the nominate route) with
 *     arguments that disagree with the replayed row is a 409. The IDENTITY
 *     arm (R420) is the one that closes the hole: `draft_bids` is readable by
 *     every league member (083:132–133), so the arguments are guessable —
 *     the discriminator is the caller's ACTING SEAT, and the pin is the
 *     reviewer's live forgery (a non-nominator during BIDDING replaying
 *     another manager's raise, arguments read straight off the table).
 *     Both arms: 409, NOTHING written, the high bid AND its holder untouched,
 *     never a 200 carrying a row the caller never placed. The hooks' per-verb
 *     mint is source-pinned in use-draft-auction-ops.test.ts, and the 409's
 *     product copy is pinned here (R421);
 *   - D68 idempotency over the wire: the same body twice (nominate AND bid)
 *     answers the same 200 with the same row, one row total;
 *   - R338 at the route: a consumed bid action_id replayed AFTER the
 *     nomination moved on (a real award through the real tick) returns its
 *     ORIGINAL row as a 200 — E2 outranks the identity guard, and F64 makes
 *     that ordering load-bearing because every real retry carries identity;
 *   - the 063 mapping per refusal class as the room will see it: P0001
 *     product copy → 400 (wrong turn, outbid, E5, went-off-the-board),
 *     P0002 → 404 with the RPC's own message (an unknown player is not
 *     "League not found"), the outsider no-leak 404 (the R155 class);
 *   - the ONE-UNIT max-bid pair through the route: a bid AT max_bid lands,
 *     max_bid + 1 is refused with the E5 copy — and after a REAL award the
 *     derivation moves (a $186 buy leaves a $1 max; $2 refused);
 *   - the mock path (089/D138): the launcher nominates and bids FOR the
 *     human seat through these same routes; the seat's REAL manager (a
 *     member of the mock's league) gets the §8.8/D103 refusal as a 400;
 *   - the §4.7 parity sweep: `teamBudget` (components/draft/auction-budget
 *     .ts — the display mirror) ≡ the REAL `draft_team_budget` for every
 *     franchise over real award rows + a planted undone row + planted ±
 *     adjustments + a planted complete roster (E27).
 *
 * LIVE-CRON SAFETY (the 022/068 concurrent-actor rule; D100): the nomination
 * clock is the catalog max (120s) and the bid clock the max (60s) so the 5s
 * tick cannot reach an expiry between two steps; the ONE award this suite
 * needs is produced by a service-role rewind of the SERVER-written deadline
 * + a direct `draft_tick()` (the mock-auction-db harness); the mock is
 * `fast` and DELETED at the end of its block so it does not run in the
 * background. `draft_scheduled_at` is FAR FUTURE (F49); the commissioner
 * starts the draft through the route service.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 * Determinism: fixed emails/usernames/action-ids (prefix af3 — af0/af1/af2
 * belong to the sibling auction suites), fixed player fixtures with
 * FRACTIONAL ADP below every real player (the R286/F60 lesson — a mock CPU
 * nomination can reach no real player), cleanup first and last.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  auctionKnobsOf,
  teamBudget,
  type BudgetPickRow,
  type TeamBudget,
} from '@/components/draft/auction-budget'
import { budgetEditPreview } from '@/components/draft/commish-auction-ops'
import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  ACTION_ID_REUSED_MESSAGE,
  deleteMockDraft,
  launchMockDraft,
  leagueScope,
  nominatePlayer,
  placeBid,
  startDraft,
} from './draft-service'
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

const LEAGUE_NAME = 'vitest-auction-api-league'
/** F49: far future — the live cron starts COMMITTED scheduled leagues whose
 *  stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8

const AUCTION_BUDGET = 200
/** 092/AP.1: the DERIVED §8.6.1 per-slot reserve / §8.6.2 nomination floor
 *  — `draft_auction_reserve(config)` answers 1 with
 *  `auction_zero_dollar_nominations` false. It is NOT the bid increment,
 *  which is a fixed $1 (§8.6.3) and is written literally where it is used. */
const AUCTION_RESERVE = 1
/** Catalog maxima — the live cron must not reach an expiry between steps. */
const NOMINATION_SECONDS = 120
const BID_SECONDS = 60
const ANTI_SNIPE_SECONDS = 10
const GRACE_SECONDS = 120
/** D91 draftable slots for the default roster (9 starters + 6 bench, IR
 *  excluded) — the auction's per-team capacity (D126). */
const OPEN_SLOTS = 15
/** §8.6.1: max_bid = remaining − (open_slots − 1) × reserve. */
const MAX_BID = AUCTION_BUDGET - (OPEN_SLOTS - 1) * AUCTION_RESERVE // 186

const COMMISH = {
  email: 'auction-api-commish@fieldscout.test',
  password: 'pgtap-auction-api-1',
  username: 'aa_wire_commish',
}
const MGR2 = {
  email: 'auction-api-mgr2@fieldscout.test',
  password: 'pgtap-auction-api-2',
  username: 'aa_wire_mgr_two',
}
const MGR3 = {
  email: 'auction-api-mgr3@fieldscout.test',
  password: 'pgtap-auction-api-3',
  username: 'aa_wire_mgr_three',
}
const OUTSIDER = {
  email: 'auction-api-outsider@fieldscout.test',
  password: 'pgtap-auction-api-9',
  username: 'aa_wire_outsider',
}

/** Flow fixtures (p1 = nomination 1, p2 = nomination 2, p3 = the planted
 *  undone row, p4 = the mock's nomination) + fifteen for the planted
 *  complete roster. Fractional ADP below every real player (F60). */
const FLOW_PLAYERS = [
  { id: 'vitest-aa-p1', full_name: 'Vitest AA Player One', position: 'RB', adp: 0.001 },
  { id: 'vitest-aa-p2', full_name: 'Vitest AA Player Two', position: 'WR', adp: 0.002 },
  { id: 'vitest-aa-p3', full_name: 'Vitest AA Player Three', position: 'QB', adp: 0.003 },
  { id: 'vitest-aa-p4', full_name: 'Vitest AA Player Four', position: 'TE', adp: 0.004 },
] as const
const ROSTER_PLAYERS = Array.from({ length: OPEN_SLOTS }, (_, i) => ({
  id: `vitest-aa-rp${String(i + 1).padStart(2, '0')}`,
  full_name: `Vitest AA Roster ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 11) / 1000,
}))
const PLAYERS = [...FLOW_PLAYERS, ...ROSTER_PLAYERS]
const P1 = FLOW_PLAYERS[0].id
const P2 = FLOW_PLAYERS[1].id
const P3 = FLOW_PLAYERS[2].id
const P4 = FLOW_PLAYERS[3].id

const ACTION = {
  create: 'af300000-0000-4000-8000-000000000001',
  mockLaunch: 'af300000-0000-4000-8000-000000000002',
  mockIntruderNominate: 'af300000-0000-4000-8000-000000000003',
  mockNominate: 'af300000-0000-4000-8000-000000000004',
  mockIntruderBid: 'af300000-0000-4000-8000-000000000005',
  mockBid: 'af300000-0000-4000-8000-000000000006',
  nominateUnknown: 'af300000-0000-4000-8000-000000000010',
  nominateWrongTurn: 'af300000-0000-4000-8000-000000000011',
  nominateOutsider: 'af300000-0000-4000-8000-000000000012',
  nominate1: 'af300000-0000-4000-8000-000000000013',
  bidOutsider: 'af300000-0000-4000-8000-000000000020',
  bidStalePlayer: 'af300000-0000-4000-8000-000000000021',
  bidStaleSeq: 'af300000-0000-4000-8000-000000000022',
  bid1: 'af300000-0000-4000-8000-000000000023',
  bidLoser: 'af300000-0000-4000-8000-000000000024',
  bid185: 'af300000-0000-4000-8000-000000000025',
  bidAtMax: 'af300000-0000-4000-8000-000000000026',
  bidOverMax: 'af300000-0000-4000-8000-000000000027',
  nominate2: 'af300000-0000-4000-8000-000000000030',
  bidOverOneDollar: 'af300000-0000-4000-8000-000000000031',
  bid2: 'af300000-0000-4000-8000-000000000032',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
type BidRow = Database['public']['Tables']['draft_bids']['Row']
interface AuctionBody {
  draft: DraftRow
  bid: BidRow
}
interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}
interface FieldErrorBody {
  error: { fieldErrors: Record<string, string[]>; formErrors: string[] }
}
interface TickSummary {
  auction_awarded: number
  auction_failures: unknown[]
  auction_cpu_failures: unknown[]
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let mgr3Client: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
let mockId: string
/** Manual nomination order: [commish, mgr2, mgr3, 5 placeholders]. */
let orderedTeamIds: string[]
let commishTeamId: string
let mgr2TeamId: string
let mgr3TeamId: string
/** R420: the service now compares the returned row's seat to the CALLER's,
 *  so every route call carries the caller's user id — exactly as the Route
 *  Handler passes `user.id` from `supabase.auth.getUser()`. */
let commishId: string
let mgr2Id: string
let mgr3Id: string
let outsiderId: string

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
  for (const u of [COMMISH, MGR2, MGR3, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error || !data.user) {
    throw new Error(`createUser failed for ${user.email}: ${error?.message}`)
  }
  return data.user.id
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

async function readDraft(id: string): Promise<DraftRow> {
  const { data, error } = await service.from('drafts').select('*').eq('id', id).single()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data as DraftRow
}

async function bidCount(id: string): Promise<number> {
  const { count, error } = await service
    .from('draft_bids')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', id)
  if (error) throw new Error(`draft_bids count failed: ${error.message}`)
  return count ?? 0
}

async function tick(): Promise<TickSummary> {
  const { data, error } = await service.rpc('draft_tick')
  if (error) throw new Error(`draft_tick failed: ${error.message}`)
  return data as unknown as TickSummary
}

/** Shift a server timestamp by `ms` (negative = rewind) — the D100 harness. */
function shifted(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

const errorText = (body: unknown): string => JSON.stringify(body)

beforeAll(async () => {
  await cleanup()
  commishId = await createUser(COMMISH)
  mgr2Id = await createUser(MGR2)
  mgr3Id = await createUser(MGR3)
  outsiderId = await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  mgr3Client = await signIn(MGR3)
  outsiderClient = await signIn(OUTSIDER)

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
    p_team_name: 'Auction API Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  const seatFor = async (username: string, client: SupabaseClient<Database>): Promise<string> => {
    const seat = await addPlaceholderSeat(commishClient, leagueId, {
      team_name: `Seat for ${username}`,
    })
    if (seat.status !== 201) {
      throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
    }
    const teamId = (seat.body as { team_id: string }).team_id
    const invite = await createInvite(commishClient, leagueId, {
      target_team_id: teamId,
      invited_username: username,
    })
    if (invite.status !== 201)
      throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
    const claim = await claimInvite(client, { token: (invite.body as { token: string }).token })
    if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
    return teamId
  }
  mgr2TeamId = await seatFor(MGR2.username, mgr2Client)
  mgr3TeamId = await seatFor(MGR3.username, mgr3Client)

  const placeholderIds: string[] = []
  for (let i = 0; i < TEAM_COUNT - 3; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201)
      throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
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
  orderedTeamIds = [commishTeamId, mgr2TeamId, mgr3TeamId, ...placeholderIds]

  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: AUCTION_BUDGET,
        auction_zero_dollar_nominations: false, // 092/AP.1: the retired min-bid field's replacement; false ⇒ the $1 reserve/floor below
        auction_nomination_seconds: NOMINATION_SECONDS,
        auction_bid_seconds: BID_SECONDS,
        auction_anti_snipe_seconds: ANTI_SNIPE_SECONDS,
        disconnect_grace_seconds: GRACE_SECONDS,
        pick_timer_seconds: 90,
        draft_scheduled_at: DRAFT_INSTANT,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`auction configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }
}, 180_000)

afterAll(async () => {
  await cleanup()
})

// ===========================================================================
// 0. The mock path — FIRST, while the league is still pre-draft (§8.8:
//    mocks launch from setup/scheduled; E60: they coexist with the real
//    draft that starts below).
// ===========================================================================

describe('the mock path through the SAME verbs (089/D138 — the launcher drives the human seat; D110(1): no commissioner affordance)', () => {
  it('launcher nominates FOR the human seat through the nominate route; the seat’s REAL manager — the commissioner — gets the §8.8/D103 refusal as a 400', async () => {
    // MGR2 launches on the COMMISSIONER's franchise (D103's "any seat
    // selectable"; order[0] — so the human seat is the first nominator).
    // The discriminator is doubled: the commissioner both manages the human
    // seat AND holds the league role, and is STILL refused — nobody drives
    // another member's solo practice, and there is no commissioner
    // affordance on a mock (D110(1)).
    const launched = await launchMockDraft(
      mgr2Client,
      leagueId,
      { human_team_id: commishTeamId, cpu_speed: 'fast' },
      { mintActionId: () => ACTION.mockLaunch },
    )
    expect(launched.status).toBe(201)
    const mock = (launched.body as unknown as { draft: DraftRow }).draft
    mockId = mock.id
    expect(mock.is_mock).toBe(true)
    expect(mock.draft_type).toBe('auction')
    expect(mock.on_clock_team_id).toBe(commishTeamId)

    const intruder = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, {
      draft_id: mockId,
      player_id: P4,
      opening_bid: 1,
      action_id: ACTION.mockIntruderNominate,
    })
    expect(intruder.status).toBe(400)
    expect(errorText(intruder.body)).toContain("another member's solo practice")

    const opened = await nominatePlayer(mgr2Client, leagueScope(leagueId), mgr2Id, {
      draft_id: mockId,
      player_id: P4,
      opening_bid: 1,
      action_id: ACTION.mockNominate,
    })
    expect(opened.status).toBe(200)
    const body = opened.body as unknown as AuctionBody
    // The launcher nominated FOR the human seat (the commissioner's
    // franchise), not for their own.
    expect(body.bid.team_id).toBe(commishTeamId)
    expect(body.bid.amount).toBe(1)
    expect((body.draft.current_nomination as unknown as LiveNomination).player_id).toBe(P4)
  }, 60_000)

  // R426: the fix closed a SECOND hole nobody had recorded — pin it so a
  // later refactor cannot silently reopen it. 089 runs the E2 replay
  // (1122-1134 nominate / 1363-1372 bid) BEFORE the D103(2) launcher gate
  // (1135 / 1373), so the RPC hands a consumed mock action_id's row back to
  // ANY caller with matching arguments. Pre-R420 the auction verbs had no
  // seat check at all, so a non-launcher league member replaying the
  // launcher's consumed id received a 200 carrying the launcher's row.
  // `resolveActingSeat`'s mock arm (config.mock.human_team_id, D103(2)) is
  // what refuses it now — measured 403, not the RPC's 400.
  it('R426: a non-launcher replaying a CONSUMED mock action_id is refused by the seat check, not handed the launcher’s row', async () => {
    const replay = await nominatePlayer(mgr3Client, leagueScope(leagueId), mgr3Id, {
      draft_id: mockId,
      player_id: P4,
      opening_bid: 1,
      action_id: ACTION.mockNominate, // the launcher's, already consumed
    })
    expect(replay.status).toBe(403)
    expect(errorText(replay.body)).toContain("another member's solo practice")
    // The launcher's row is NOT in the response.
    expect(JSON.stringify(replay.body)).not.toContain(commishTeamId)
  }, 60_000)

  it('launcher bids FOR the human seat through the bid route (after a real CPU raise); the seat’s real manager’s bid is refused', async () => {
    // The intruder's bid — the D138 extension of D103(2) to bids.
    const intruder = await placeBid(commishClient, leagueScope(leagueId), commishId, {
      draft_id: mockId,
      nomination_seq: 1,
      player_id: P4,
      amount: 2,
      action_id: ACTION.mockIntruderBid,
    })
    expect(intruder.status).toBe(400)
    expect(errorText(intruder.body)).toContain("another member's solo practice")

    // A CPU must raise first (the human seat holds the opening — a launcher
    // bid now would be the self-raise refusal): `fast` ⇒ the raise think is
    // 2s after the open; rewind updated_at 3s and tick (the cron may have
    // done the same — every assertion is on converged state).
    const before = await readDraft(mockId)
    await service
      .from('drafts')
      .update({ updated_at: shifted(before.updated_at as string, -3_000) })
      .eq('id', mockId)
      .eq('status', 'live')
    const summary = await tick()
    expect(summary.auction_cpu_failures).toEqual([])
    const raised = await readDraft(mockId)
    const nomination = raised.current_nomination as unknown as LiveNomination
    expect(nomination.high_bidder_team_id).not.toBe(commishTeamId)
    expect(nomination.high_bid).toBeGreaterThanOrEqual(2)

    // The launcher bids through the route FOR the human seat. +3 over the
    // observed high bid: a CPU raises by exactly $1 per pass and at most one
    // cron pass can land between the read and this call.
    const amount = nomination.high_bid + 3
    const bid = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      draft_id: mockId,
      nomination_seq: 1,
      player_id: P4,
      amount,
      action_id: ACTION.mockBid,
    })
    expect(bid.status).toBe(200)
    const body = bid.body as unknown as AuctionBody
    expect(body.bid.team_id).toBe(commishTeamId)
    expect(body.bid.amount).toBe(amount)
    expect((body.draft.current_nomination as unknown as LiveNomination).high_bidder_team_id).toBe(
      commishTeamId,
    )

    // The mock is the launcher's to end (§8.8) — and ending it here keeps
    // the `fast` CPUs from running in the background for the rest of the
    // suite. The real league is untouched by any of this (E60 — pinned
    // below by the real draft starting clean).
    const deleted = await deleteMockDraft(mgr2Client, leagueId, mockId)
    expect(deleted.status).toBe(200)
  }, 60_000)
})

// ===========================================================================
// 1. Nominate over the route (§15.2 → draft_nominate)
// ===========================================================================

describe('POST …/draft/nominate (§8.6.2; action_id REQUIRED wire-side — D68(1))', () => {
  it('the commissioner starts the auction through the route service; the nomination clock is live', async () => {
    const started = await startDraft(commishClient, leagueId)
    expect(started.status).toBe(200)
    const draft = (started.body as unknown as { draft: DraftRow }).draft
    draftId = draft.id
    expect(draft.status).toBe('live')
    expect(draft.draft_type).toBe('auction')
    expect(draft.is_mock).toBe(false)
    expect(draft.current_nomination).toBeNull()
    expect(draft.on_clock_team_id).toBe(commishTeamId)
    expect(draft.current_pick_number).toBe(1)
    expect(await bidCount(draftId)).toBe(0)
  }, 60_000)

  it('wire-side contract: a body without action_id is a 400 on that field BEFORE any RPC (probe B’s target); a non-integer opening bid likewise', async () => {
    const missing = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, { player_id: P1, opening_bid: 1 })
    expect(missing.status).toBe(400)
    expect((missing.body as unknown as FieldErrorBody).error.fieldErrors.action_id).toBeDefined()

    const fractional = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, {
      player_id: P1,
      opening_bid: 1.5,
      action_id: ACTION.nominate1,
    })
    expect(fractional.status).toBe(400)
    expect(
      (fractional.body as unknown as FieldErrorBody).error.fieldErrors.opening_bid,
    ).toBeDefined()
    expect(await bidCount(draftId)).toBe(0)
  })

  it('063 mapping: an unknown player is a 404 carrying the RPC’s OWN message (never "League not found"); wrong turn is the friendly 400; the outsider gets the no-leak 404', async () => {
    const unknown = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, {
      player_id: 'vitest-aa-no-such-player',
      opening_bid: 1,
      action_id: ACTION.nominateUnknown,
    })
    expect(unknown.status).toBe(404)
    expect(errorText(unknown.body)).toContain('player vitest-aa-no-such-player not found')
    expect(errorText(unknown.body)).not.toContain('League not found')

    const wrongTurn = await nominatePlayer(mgr2Client, leagueScope(leagueId), mgr2Id, {
      player_id: P1,
      opening_bid: 1,
      action_id: ACTION.nominateWrongTurn,
    })
    expect(wrongTurn.status).toBe(400)
    expect(errorText(wrongTurn.body)).toContain('it is not your turn to nominate')

    // The R155 class: an explicit draft_id changes nothing — the RLS probe
    // sees no row, the answer is the draftless 404.
    const outsider = await nominatePlayer(outsiderClient, leagueScope(leagueId), outsiderId, {
      draft_id: draftId,
      player_id: P1,
      opening_bid: 1,
      action_id: ACTION.nominateOutsider,
    })
    expect(outsider.status).toBe(404)
    expect(await bidCount(draftId)).toBe(0)
  })

  it('the on-clock commissioner nominates: 200 with the authoritative state; the SAME body again is the D68 no-op (same row, one row)', async () => {
    const opened = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, {
      player_id: P1,
      opening_bid: 1,
      action_id: ACTION.nominate1,
    })
    expect(opened.status).toBe(200)
    const body = opened.body as unknown as AuctionBody
    expect(body.draft.current_nomination).toEqual({
      player_id: P1,
      high_bid: 1,
      high_bidder_team_id: commishTeamId,
    })
    expect(body.draft.current_pick_number).toBe(1)
    expect(body.bid).toMatchObject({
      nomination_seq: 1,
      player_id: P1,
      team_id: commishTeamId,
      amount: 1,
      action_id: ACTION.nominate1,
    })

    const replay = await nominatePlayer(commishClient, leagueScope(leagueId), commishId, {
      player_id: P1,
      opening_bid: 1,
      action_id: ACTION.nominate1,
    })
    expect(replay.status).toBe(200)
    expect((replay.body as unknown as AuctionBody).bid.id).toBe(body.bid.id)
    expect(await bidCount(draftId)).toBe(1)
  })
})

// ===========================================================================
// 2. Bid over the route (§15.2 → draft_place_bid) — F64 / F65 / D68 / 063
// ===========================================================================

describe('POST …/draft/bid (§8.6.3) — the nomination identity is REQUIRED (F64) and action ids are per verb (F65)', () => {
  it('F64 wire-side: a body without nomination_seq + player_id is a 400 on BOTH fields before any RPC; a missing action_id likewise (probe B); nothing written', async () => {
    const noIdentity = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, { amount: 2, action_id: ACTION.bid1 })
    expect(noIdentity.status).toBe(400)
    const fields = (noIdentity.body as unknown as FieldErrorBody).error.fieldErrors
    expect(fields.nomination_seq).toBeDefined()
    expect(fields.player_id).toBeDefined()

    const noAction = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
    })
    expect(noAction.status).toBe(400)
    expect((noAction.body as unknown as FieldErrorBody).error.fieldErrors.action_id).toBeDefined()

    const outsider = await placeBid(outsiderClient, leagueScope(leagueId), outsiderId, {
      draft_id: draftId,
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bidOutsider,
    })
    expect(outsider.status).toBe(404)
    expect(await bidCount(draftId)).toBe(1)
  })

  it('F64 END-TO-END (probe A’s target): a stale identity is refused through the route with the §16.3 copy as a 400 — the player arm AND the seq arm with a MATCHING player (R337)', async () => {
    // The room was looking at p2 (it was not — p1 is live): the player arm.
    const stalePlayer = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 1,
      player_id: P2,
      amount: 2,
      action_id: ACTION.bidStalePlayer,
    })
    expect(stalePlayer.status).toBe(400)
    expect(errorText(stalePlayer.body)).toContain('Vitest AA Player Two just went off the board')
    expect(errorText(stalePlayer.body)).toContain('Vitest AA Player One is up for bid now at $1')

    // The room was looking at the RIGHT player under the WRONG nomination
    // number (D143's renominate / an undone award both produce this): the
    // seq arm — only reachable when the route actually transports the seq
    // (R337: neither arm subsumes the other).
    const staleSeq = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 2,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bidStaleSeq,
    })
    expect(staleSeq.status).toBe(400)
    expect(errorText(staleSeq.body)).toContain('that nomination just went off the board')
    expect(errorText(staleSeq.body)).toContain('Vitest AA Player One is up for bid now at $1')

    // Nothing written by either refusal; the high bid stands.
    expect(await bidCount(draftId)).toBe(1)
    expect(
      ((await readDraft(draftId)).current_nomination as unknown as LiveNomination).high_bid,
    ).toBe(1)
  })

  it('a raise lands (200, the room’s identity echoed); the instant loser is the friendly "outbid" 400 (D136: never a 429); the D68 replay is the same row', async () => {
    const raise = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bid1,
    })
    expect(raise.status).toBe(200)
    const body = raise.body as unknown as AuctionBody
    expect(body.bid).toMatchObject({
      nomination_seq: 1,
      player_id: P1,
      team_id: mgr2TeamId,
      amount: 2,
      action_id: ACTION.bid1,
    })
    expect(body.draft.current_nomination).toEqual({
      player_id: P1,
      high_bid: 2,
      high_bidder_team_id: mgr2TeamId,
    })

    const loser = await placeBid(mgr3Client, leagueScope(leagueId), mgr3Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bidLoser,
    })
    expect(loser.status).toBe(400)
    expect(errorText(loser.body)).toContain('outbid at $2')
    expect(errorText(loser.body)).toContain('bid $3 or more')

    // D68: the SAME body (the variables a React Query retry re-sends) is the
    // same 200 with the same row — one row total for this submit.
    const replay = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bid1,
    })
    expect(replay.status).toBe(200)
    expect((replay.body as unknown as AuctionBody).bid.id).toBe(body.bid.id)
    expect(await bidCount(draftId)).toBe(2)
  })

  it('F65 — the ARGUMENT arm: a NOMINATION’s action_id sent through the bid route is a 409 — not a 200 carrying a "bid" the caller never placed; nothing written, the high bid untouched; the converse likewise', async () => {
    // The commissioner's nomination id (consumed by draft_nominate) re-sent
    // as a bid: the RPC's verb-blind replay returns the OPENING row (R331 —
    // the false-success shape); the service sees a row that is not this
    // bid and refuses.
    const crossVerb = await placeBid(commishClient, leagueScope(leagueId), commishId, {
      nomination_seq: 1,
      player_id: P1,
      amount: 3,
      action_id: ACTION.nominate1,
    })
    expect(crossVerb.status).toBe(409)
    expect(errorText(crossVerb.body)).toContain(ACTION_ID_REUSED_MESSAGE)

    // The converse — a RAISE's id (mgr2's) through the nominate route, by a
    // member who is not the nominator while bidding is open: without the
    // check this is F65's live-proven false success (a 200 carrying
    // ANOTHER manager's raise row); with it, a 409.
    const converse = await nominatePlayer(mgr3Client, leagueScope(leagueId), mgr3Id, {
      player_id: P1,
      opening_bid: 1,
      action_id: ACTION.bid1,
    })
    expect(converse.status).toBe(409)
    expect(errorText(converse.body)).toContain(ACTION_ID_REUSED_MESSAGE)

    expect(await bidCount(draftId)).toBe(2)
    expect(
      ((await readDraft(draftId)).current_nomination as unknown as LiveNomination).high_bid,
    ).toBe(2)
  })

  it('F65 — the IDENTITY arm (R420): every member can READ `draft_bids`, so the arguments are guessable and the SEAT is the discriminator — mgr3, a non-nominator during BIDDING, reads mgr2’s raise row and replays it through the nominate route with its own (player, amount): 409, never a 200 carrying mgr2’s row; the converse under the same policy likewise', async () => {
    // (1) THE PREMISE, MEASURED. `draft_bids` RLS is
    // `FOR SELECT USING (is_league_member(league_id))` with no column
    // restriction (083:132–133), so mgr3 — who placed no such bid — reads
    // every field of mgr2's raise, `action_id` included.
    const { data: raise, error: readError } = await mgr3Client
      .from('draft_bids')
      .select('action_id, player_id, amount, nomination_seq, team_id')
      .eq('draft_id', draftId)
      .eq('action_id', ACTION.bid1)
      .single()
    expect(readError).toBeNull()
    expect(raise).toMatchObject({
      action_id: ACTION.bid1,
      player_id: P1,
      amount: 2,
      nomination_seq: 1,
      team_id: mgr2TeamId,
    })
    if (!raise?.action_id) throw new Error('mgr3 could not read the raise row')

    // (2) THE FORGERY, built ONLY from what that read returned — the exact
    // shape an ARGUMENT-ONLY check answers 200 to, because every argument
    // agrees with the row the verb-blind replay hands back (R331). The one
    // fact mgr3 cannot supply is the acting seat.
    const forgedNomination = await nominatePlayer(mgr3Client, leagueScope(leagueId), mgr3Id, {
      player_id: raise.player_id,
      opening_bid: raise.amount,
      action_id: raise.action_id,
    })
    expect(forgedNomination.status).toBe(409)
    expect(errorText(forgedNomination.body)).toContain(ACTION_ID_REUSED_MESSAGE)
    // No 200 shape at all: mgr2's seat never appears in mgr3's response.
    expect(errorText(forgedNomination.body)).not.toContain(mgr2TeamId)

    // (3) THE CONVERSE, symmetric because `nomination_seq` sits under the
    // same policy: the commissioner's OPENING row replayed through the BID
    // route with all four arguments matching.
    const { data: opening } = await mgr3Client
      .from('draft_bids')
      .select('action_id, player_id, amount, nomination_seq, team_id')
      .eq('draft_id', draftId)
      .eq('action_id', ACTION.nominate1)
      .single()
    expect(opening).toMatchObject({ team_id: commishTeamId, nomination_seq: 1, amount: 1 })
    if (!opening?.action_id) throw new Error('mgr3 could not read the opening row')
    const forgedBid = await placeBid(mgr3Client, leagueScope(leagueId), mgr3Id, {
      nomination_seq: opening.nomination_seq,
      player_id: opening.player_id,
      amount: opening.amount,
      action_id: opening.action_id,
    })
    expect(forgedBid.status).toBe(409)
    expect(errorText(forgedBid.body)).toContain(ACTION_ID_REUSED_MESSAGE)
    expect(errorText(forgedBid.body)).not.toContain(commishTeamId)

    // Nothing written by either forgery; the high bid AND its holder stand.
    expect(await bidCount(draftId)).toBe(2)
    expect((await readDraft(draftId)).current_nomination).toEqual({
      player_id: P1,
      high_bid: 2,
      high_bidder_team_id: mgr2TeamId,
    })
  })

  it('R421: the 409 carries PRODUCT copy — it names no internal identifier and asks for a fresh submit, never a retry of the consumed one', () => {
    // This string reaches a manager verbatim (`client-fetch.ts` surfaces a
    // string `error` body as `LeagueActionError.message`; `use-draft-auction
    // .ts` tells callers to show it as-is), so §16.3 / tasks-M3 §4 rule 8
    // govern it. "Please try again" was false: an action_id is consumed
    // forever (R125), so re-submitting THIS one repeats the 409.
    expect(ACTION_ID_REUSED_MESSAGE).not.toMatch(/action[ _]?id/i)
    expect(ACTION_ID_REUSED_MESSAGE).not.toMatch(/nomination_seq|player_id|409|uuid|replay/i)
    expect(ACTION_ID_REUSED_MESSAGE).not.toMatch(/try again/i)
    expect(ACTION_ID_REUSED_MESSAGE).toMatch(/place it again/)
  })

  it('ONE UNIT at the ceiling: a bid AT max_bid ($186) lands; max_bid + 1 ($187) is refused with the E5 copy naming the formula’s numbers', async () => {
    // The commissioner (the nominator — bidding has no turn, §8.6.3) raises
    // to one under its own ceiling; mgr2 holds the standing high bid, so
    // the raise comes from a seat that is NOT the high bidder.
    const under = await placeBid(commishClient, leagueScope(leagueId), commishId, {
      nomination_seq: 1,
      player_id: P1,
      amount: MAX_BID - 1,
      action_id: ACTION.bid185,
    })
    expect(under.status).toBe(200)

    const atMax = await placeBid(mgr3Client, leagueScope(leagueId), mgr3Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: MAX_BID,
      action_id: ACTION.bidAtMax,
    })
    expect(atMax.status).toBe(200)
    expect(
      (atMax.body as unknown as AuctionBody).draft.current_nomination as unknown as LiveNomination,
    ).toEqual({
      player_id: P1,
      high_bid: MAX_BID,
      high_bidder_team_id: mgr3TeamId,
    })

    const overMax = await placeBid(commishClient, leagueScope(leagueId), commishId, {
      nomination_seq: 1,
      player_id: P1,
      amount: MAX_BID + 1,
      action_id: ACTION.bidOverMax,
    })
    expect(overMax.status).toBe(400)
    expect(errorText(overMax.body)).toContain(`$${MAX_BID + 1} is over your max bid of $${MAX_BID}`)
    expect(errorText(overMax.body)).toContain(
      `you have $${AUCTION_BUDGET} for ${OPEN_SLOTS} open roster spots at a $${AUCTION_RESERVE} per-slot reserve`,
    )
    expect(await bidCount(draftId)).toBe(4)
  })
})

// ===========================================================================
// 3. The nomination moves on (a REAL award through the real tick) — R338 at
//    the route, and the derivation after a buy.
// ===========================================================================

describe('after the award: E2 outranks the identity guard at the route (R338); the derivation moves with a real buy', () => {
  it('the real tick awards p1 to mgr3 at $186 and the rotation advances to mgr2', async () => {
    const before = await readDraft(draftId)
    await service
      .from('drafts')
      .update({
        current_deadline: shifted(before.current_deadline as string, -(BID_SECONDS + 10) * 1_000),
      })
      .eq('id', draftId)
      .eq('status', 'live')
    const summary = await tick()
    expect(summary.auction_failures).toEqual([])

    const after = await readDraft(draftId)
    expect(after.status).toBe('live')
    expect(after.current_nomination).toBeNull()
    expect(after.current_pick_number).toBe(2)
    expect(after.on_clock_team_id).toBe(mgr2TeamId)
    const { data: picks } = await service
      .from('draft_picks')
      .select('team_id, player_id, price, is_undone')
      .eq('draft_id', draftId)
    expect(picks).toEqual([
      { team_id: mgr3TeamId, player_id: P1, price: MAX_BID, is_undone: false },
    ])
  }, 60_000)

  it('R338: mgr2’s CONSUMED bid id, replayed with its ORIGINAL identity after nomination 1 is gone, returns its original row as a 200 — never the went-off-the-board refusal', async () => {
    // The reconnect case E2 exists for: the client re-sends exactly what it
    // sent (seq 1, p1, $2 — F64 means every real retry carries identity),
    // and the live phase is now NOMINATING on seq 2. The replay arm sits
    // above the identity guard in 085/089, so the original row comes back.
    const replay = await placeBid(mgr2Client, leagueScope(leagueId), mgr2Id, {
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bid1,
    })
    expect(replay.status).toBe(200)
    expect((replay.body as unknown as AuctionBody).bid).toMatchObject({
      nomination_seq: 1,
      player_id: P1,
      amount: 2,
      action_id: ACTION.bid1,
    })
    expect(await bidCount(draftId)).toBe(4)
  })

  it('mgr2 nominates p2; mgr3 (a $186 buy ⇒ $14 over 14 slots ⇒ max bid $1) is refused at $2 with the derivation’s numbers; the commissioner raises', async () => {
    const opened = await nominatePlayer(mgr2Client, leagueScope(leagueId), mgr2Id, {
      player_id: P2,
      opening_bid: 1,
      action_id: ACTION.nominate2,
    })
    expect(opened.status).toBe(200)
    expect((opened.body as unknown as AuctionBody).bid.nomination_seq).toBe(2)

    const overOne = await placeBid(mgr3Client, leagueScope(leagueId), mgr3Id, {
      nomination_seq: 2,
      player_id: P2,
      amount: 2,
      action_id: ACTION.bidOverOneDollar,
    })
    expect(overOne.status).toBe(400)
    expect(errorText(overOne.body)).toContain('$2 is over your max bid of $1')
    expect(errorText(overOne.body)).toContain('you have $14 for 14 open roster spots')

    const raise = await placeBid(commishClient, leagueScope(leagueId), commishId, {
      nomination_seq: 2,
      player_id: P2,
      amount: 2,
      action_id: ACTION.bid2,
    })
    expect(raise.status).toBe(200)
    expect(await bidCount(draftId)).toBe(6)
  })
})

// ===========================================================================
// 4. §4.7 parity: the display mirror ≡ the ONE budget authority
// ===========================================================================

describe('TS ≡ SQL budget parity (§4.7/D127 — the D90 pattern, stack half): teamBudget ≡ draft_team_budget for every franchise', () => {
  it('over real award rows + a planted undone row + planted ± adjustments + a planted COMPLETE roster (E27)', async () => {
    const fullTeam = orderedTeamIds[TEAM_COUNT - 1]
    // Privileged plants (the pgTAP-fixture move at the wire layer): the
    // D127 storage half (+25 / −20), an undone $999 row (refunded by
    // derivation — must be IGNORED by both twins), and fifteen priced picks
    // that complete the last placeholder's roster (open_slots 0 ⇒ max_bid
    // 0, the ONE special case).
    const { error: adjustError } = await service
      .from('drafts')
      .update({ budget_adjustments: { [commishTeamId]: -20, [mgr2TeamId]: 25 } })
      .eq('id', draftId)
    expect(adjustError).toBeNull()
    const { error: plantError } = await service.from('draft_picks').insert([
      {
        draft_id: draftId,
        league_id: leagueId,
        team_id: mgr2TeamId,
        player_id: P3,
        pick_number: 90,
        round: null,
        price: 999,
        is_undone: true,
        made_via: 'manager',
      },
      ...ROSTER_PLAYERS.map((p, i) => ({
        draft_id: draftId,
        league_id: leagueId,
        team_id: fullTeam,
        player_id: p.id,
        pick_number: 100 + i,
        round: null,
        price: i + 1,
        is_undone: false,
        made_via: 'manager',
      })),
    ])
    expect(plantError).toBeNull()

    // The room's own read path: the drafts row + the pick list over the
    // member RLS SELECT (what `useDraft` caches), not a privileged view.
    const { data: draftRow, error: draftError } = await commishClient
      .from('drafts')
      .select('config, total_rounds, budget_adjustments')
      .eq('id', draftId)
      .single()
    expect(draftError).toBeNull()
    const { data: pickRows, error: picksError } = await commishClient
      .from('draft_picks')
      .select('team_id, price, is_undone')
      .eq('draft_id', draftId)
    expect(picksError).toBeNull()
    const picks = (pickRows ?? []) as BudgetPickRow[]
    expect(picks).toHaveLength(1 + 1 + OPEN_SLOTS)

    const inputs = {
      ...auctionKnobsOf(draftRow!.config),
      totalRounds: draftRow!.total_rounds,
      budgetAdjustments: draftRow!.budget_adjustments,
    }
    expect(inputs).toMatchObject({
      auctionBudget: AUCTION_BUDGET,
      reserve: AUCTION_RESERVE,
      totalRounds: OPEN_SLOTS,
    })

    const sql = new Map<string, TeamBudget>()
    for (const teamId of orderedTeamIds) {
      const { data, error } = await service.rpc('draft_team_budget', {
        p_draft_id: draftId,
        p_team_id: teamId,
      })
      if (error) throw new Error(`draft_team_budget(${teamId}) failed: ${error.message}`)
      const row = (
        data as unknown as {
          remaining: number
          open_slots: number
          max_bid: number
          committed: number
        }[]
      )[0]
      sql.set(teamId, {
        remaining: row.remaining,
        openSlots: row.open_slots,
        maxBid: row.max_bid,
        committed: row.committed,
      })
    }

    // TS ≡ SQL, franchise by franchise (the parity pin — probe C's target:
    // skewing the mirror's formula reddens this for every open roster).
    for (const teamId of orderedTeamIds) {
      expect(teamBudget(inputs, picks, teamId), `team ${teamId}`).toEqual(sql.get(teamId))
    }
    // …and the specific states the plants were for, stated so a both-sides-
    // wrong twin cannot pass by agreeing on nonsense.
    expect(sql.get(mgr3TeamId)).toEqual({
      remaining: 14,
      openSlots: 14,
      maxBid: 1,
      committed: MAX_BID,
    })
    expect(sql.get(commishTeamId)).toEqual({
      remaining: 180,
      openSlots: 15,
      maxBid: 166,
      committed: 0,
    })
    expect(sql.get(mgr2TeamId)).toEqual({
      remaining: 225,
      openSlots: 15,
      maxBid: 211,
      committed: 0,
    })
    expect(sql.get(fullTeam)).toEqual({ remaining: 80, openSlots: 0, maxBid: 0, committed: 120 })
    expect(sql.get(orderedTeamIds[3])).toEqual({
      remaining: 200,
      openSlots: 15,
      maxBid: 186,
      committed: 0,
    })

    // ======================================================================
    // R457 — THE SAME BOARD, THE OTHER COLUMN. Everything above is the
    // toggle-OFF half; D198(5) and AP.1 item 4 both require the D90 parity
    // fixture to cover BOTH states, and until this pass the ON column rested
    // on two hand-written literals (pgTAP 040 §B and auction-budget.test.ts)
    // — parallel goldens, not a differential. Flipping the flag on the SAME
    // planted board and re-running BOTH twins is what makes it one.
    // ======================================================================
    const { error: toggleError } = await service
      .from('drafts')
      .update({
        config: { ...(draftRow!.config as Record<string, unknown>), auction_zero_dollar_nominations: true },
      })
      .eq('id', draftId)
    expect(toggleError).toBeNull()

    const { data: onRow, error: onRowError } = await commishClient
      .from('drafts')
      .select('config, total_rounds, budget_adjustments')
      .eq('id', draftId)
      .single()
    expect(onRowError).toBeNull()

    const onInputs = {
      ...auctionKnobsOf(onRow!.config),
      totalRounds: onRow!.total_rounds,
      budgetAdjustments: onRow!.budget_adjustments,
    }
    // The mirror read the flag off the wire — not a value the test handed it.
    expect(onInputs).toMatchObject({ auctionBudget: AUCTION_BUDGET, reserve: 0 })

    const sqlOn = new Map<string, TeamBudget>()
    for (const teamId of orderedTeamIds) {
      const { data, error } = await service.rpc('draft_team_budget', {
        p_draft_id: draftId,
        p_team_id: teamId,
      })
      if (error) throw new Error(`draft_team_budget(${teamId}) ON failed: ${error.message}`)
      const row = (
        data as unknown as {
          remaining: number
          open_slots: number
          max_bid: number
          committed: number
        }[]
      )[0]
      sqlOn.set(teamId, {
        remaining: row.remaining,
        openSlots: row.open_slots,
        maxBid: row.max_bid,
        committed: row.committed,
      })
    }

    // (a) TS ≡ SQL again, franchise by franchise, at reserve 0.
    for (const teamId of orderedTeamIds) {
      expect(teamBudget(onInputs, picks, teamId), `team ${teamId} (ON)`).toEqual(sqlOn.get(teamId))
    }
    // (b) …and the two columns actually DIFFER, by exactly the reserve term
    //     `(open_slots − 1) × $1`, on every franchise with an open roster.
    //     This is the assertion that makes the pass a differential: a mirror
    //     (or an engine) that ignored the toggle would agree with itself here
    //     and be caught, which two parallel goldens cannot do.
    for (const teamId of orderedTeamIds) {
      const off = sql.get(teamId)!
      const on = sqlOn.get(teamId)!
      expect(on.remaining, `remaining moved on ${teamId}`).toBe(off.remaining)
      expect(on.openSlots, `open_slots moved on ${teamId}`).toBe(off.openSlots)
      expect(on.maxBid - off.maxBid, `reserve term on ${teamId}`).toBe(
        off.openSlots <= 0 ? 0 : (off.openSlots - 1) * AUCTION_RESERVE,
      )
      // E27's complete roster is the NEGATIVE control: max_bid is 0 in BOTH
      // columns, so it is the one seat the toggle cannot move.
      if (off.openSlots <= 0) expect(on.maxBid).toBe(0)
    }
    // (c) The named states, as stored literals at reserve 0 — `max_bid` IS
    //     `remaining`, flat (§8.6.1/E68).
    expect(sqlOn.get(mgr3TeamId)).toEqual({
      remaining: 14,
      openSlots: 14,
      maxBid: 14,
      committed: MAX_BID,
    })
    expect(sqlOn.get(commishTeamId)).toEqual({
      remaining: 180,
      openSlots: 15,
      maxBid: 180,
      committed: 0,
    })
    expect(sqlOn.get(mgr2TeamId)).toEqual({
      remaining: 225,
      openSlots: 15,
      maxBid: 225,
      committed: 0,
    })
    expect(sqlOn.get(fullTeam)).toEqual({ remaining: 80, openSlots: 0, maxBid: 0, committed: 120 })
    expect(sqlOn.get(orderedTeamIds[3])).toEqual({
      remaining: 200,
      openSlots: 15,
      maxBid: 200,
      committed: 0,
    })

    // (d) F95, DISCHARGED BY AP.2 — `budgetEditPreview`'s PROJECTION now runs
    //     through the SAME `maxBidFor` expression `teamBudget` uses, so this
    //     sweep extends to it: for every franchise, in BOTH columns, project a
    //     ±$0 edit and require the projection to equal the SQL's own answer.
    //     Before the collapse there were two copies of §8.6.1's formula and
    //     only `teamBudget`'s had an SQL differential; AP.2's §8.6.9 predicate
    //     consumes this family, which is why the drift was closed rather than
    //     re-recorded. A zero delta is the right probe here: it isolates the
    //     FORMULA from the delta arithmetic, and §8.7's own RPC refuses a $0
    //     adjustment so nothing is being claimed about a legal edit.
    for (const teamId of orderedTeamIds) {
      const offBudget = sql.get(teamId)!
      expect(
        budgetEditPreview({ budget: offBudget, delta: 0, reserve: AUCTION_RESERVE, highBidHeld: null })
          .after,
        `budgetEditPreview ≡ draft_team_budget (OFF) on ${teamId}`,
      ).toEqual(offBudget)
      const onBudget = sqlOn.get(teamId)!
      expect(
        budgetEditPreview({ budget: onBudget, delta: 0, reserve: 0, highBidHeld: null }).after,
        `budgetEditPreview ≡ draft_team_budget (ON) on ${teamId}`,
      ).toEqual(onBudget)
    }

    // Leave the board as it was found.
    const { error: restoreError } = await service
      .from('drafts')
      .update({ config: draftRow!.config })
      .eq('id', draftId)
    expect(restoreError).toBeNull()
  }, 60_000)
})
