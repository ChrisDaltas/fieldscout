/**
 * auction-core-db.test.ts — L.C1.3 item 5 at the WIRE layer: migration
 * 085's auction core (`draft_nominate` / `draft_place_bid`) against the
 * LOCAL Supabase stack through PostgREST, driven by three REAL signed-in
 * managers — nomination, three raises, the instant-loser refusal, the E5
 * max-bid ceiling, the R330 nomination-identity pair (both arms) and the
 * E2 replay, all as the room will call them.
 *
 * pgTAP 034 owns the exhaustive matrix (every refusal, every boundary,
 * the anti-snipe arithmetic to the second). This suite exists for the two
 * things pgTAP cannot show: that the SECURITY DEFINER + `auth.uid()` path
 * behaves identically when the caller is a real JWT over HTTP rather than
 * a `set_config`'d role, and the §4.6 HELD-LOCK BOUND for the bid family.
 *
 * HELD-LOCK ASSERTION (tasks-M3 §4 rule 6 / plan §8.3 "held-lock < 50ms"):
 * the client-observed round trip UPPER-BOUNDS the in-RPC lock window (RTT
 * = network + parse + plan + execute, and the drafts-row lock is held for
 * a subset of execute). We assert the FASTEST of the three real raises
 * lands under 50ms — a systematically long hold inflates EVERY sample and
 * fails the bound, while a one-off load spike cannot flake the suite (the
 * draft-core-db.test.ts form, verbatim). THE BID FAMILY IS THE HOTTEST
 * LOCK IN THE APP: §22.1's load model puts up to 5 bids/s on one draft
 * row, and D136 deliberately declines a route-layer limiter for M3 — the
 * row lock IS the answer, so its hold time is load-bearing.
 *
 * Timing uses process.hrtime.bigint() — monotonic, and outside the D3/D17
 * wall-clock ban (harness measurement, not league logic reading time).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids/player-fixture ids +
 * cleanup first and last; the draft instant is FAR FUTURE (F49 — the live
 * 5s cron auto-starts committed scheduled leagues whose instant has
 * passed) and the draft is started explicitly by the commissioner.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
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

const LEAGUE_NAME = 'vitest-auction-core-league'
/** F49: far future — the live cron starts COMMITTED scheduled leagues whose
 *  stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8

/** §7.3.8 auction block — every value differs from a default that could
 *  mask a bug (bid clock 30 vs default 20, nomination 45 vs 30). */
const AUCTION_BUDGET = 200
const AUCTION_MIN_BID = 1
const BID_SECONDS = 30
const ANTI_SNIPE_SECONDS = 10
/** D91 draftable slots for the default roster (9 starters + 6 bench, IR
 *  excluded) — the auction's per-team roster capacity (D126). */
const OPEN_SLOTS = 15
/** §8.6.1: max_bid = remaining − (open_slots − 1) × min_bid. */
const MAX_BID = AUCTION_BUDGET - (OPEN_SLOTS - 1) * AUCTION_MIN_BID // 186

const COMMISH = {
  email: 'auction-core-commish@fieldscout.test',
  password: 'pgtap-auction-core-1',
  username: 'ac_wire_commish',
}
const MGR2 = {
  email: 'auction-core-mgr2@fieldscout.test',
  password: 'pgtap-auction-core-2',
  username: 'ac_wire_mgr_two',
}
const MGR3 = {
  email: 'auction-core-mgr3@fieldscout.test',
  password: 'pgtap-auction-core-3',
  username: 'ac_wire_mgr_three',
}

/** Harness player fixtures (players is app-read-only; service-role inserts
 *  are the pgTAP-privileged-fixture move at the wire layer). */
const PLAYERS = [
  { id: 'vitest-ac-p1', full_name: 'Vitest AC Player One', position: 'RB' },
  { id: 'vitest-ac-p2', full_name: 'Vitest AC Player Two', position: 'WR' },
] as const

const ACTION = {
  create: 'af000000-0000-4000-8000-000000000001',
  nominate: 'af000000-0000-4000-8000-000000000011',
  bid1: 'af000000-0000-4000-8000-000000000012',
  bid2: 'af000000-0000-4000-8000-000000000013',
  bid3: 'af000000-0000-4000-8000-000000000014',
  loser: 'af000000-0000-4000-8000-000000000021',
  overMax: 'af000000-0000-4000-8000-000000000022',
  wrongTurn: 'af000000-0000-4000-8000-000000000023',
  staleTarget: 'af000000-0000-4000-8000-000000000024',
  identityOk: 'af000000-0000-4000-8000-000000000025',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
type BidRow = Database['public']['Tables']['draft_bids']['Row']
interface DraftStateResponse {
  draft: DraftRow
  started?: boolean
}
interface BidResponse {
  draft: DraftRow
  bid: BidRow
}
interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let mgr3Client: SupabaseClient<Database>
let leagueId: string
let draftId: string
/** Manual nomination order: [commish, mgr2, mgr3, 5 placeholders]. */
let orderedTeamIds: string[]
/** The bid deadline as written by the nomination — the anti-snipe baseline. */
let nominationDeadline: string

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
    // drafts first: draft_bids/draft_picks cascade off drafts and FK-pin
    // teams/players.
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
  for (const u of [COMMISH, MGR2, MGR3]) {
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
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Round-trip a draft_place_bid and report the RTT in ms (monotonic clock). */
async function timedBid(
  client: SupabaseClient<Database>,
  amount: number,
  actionId: string,
): Promise<{ response: BidResponse; ms: number }> {
  const startNs = process.hrtime.bigint()
  const { data, error } = await client.rpc('draft_place_bid', {
    p_draft_id: draftId,
    p_amount: amount,
    p_action_id: actionId,
  })
  const ms = Number(process.hrtime.bigint() - startNs) / 1e6
  if (error) throw new Error(`draft_place_bid($${amount}) failed: ${error.message}`)
  return { response: data as unknown as BidResponse, ms }
}

beforeAll(async () => {
  await cleanup()
  await createUser(COMMISH)
  await createUser(MGR2)
  await createUser(MGR3)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  mgr3Client = await signIn(MGR3)

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
    p_team_name: 'Auction Core Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Seat mgr2 + mgr3 on real franchises (placeholder seat → username invite
  // → claim — the L.A1.14/15 path), then fill to capacity.
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
    if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
    const claim = await claimInvite(client, { token: (invite.body as { token: string }).token })
    if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
    return teamId
  }
  const mgr2TeamId = await seatFor(MGR2.username, mgr2Client)
  const mgr3TeamId = await seatFor(MGR3.username, mgr3Client)

  const placeholderIds: string[] = []
  for (let i = 0; i < TEAM_COUNT - 3; i++) {
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
  orderedTeamIds = [commishMember.team_id, mgr2TeamId, mgr3TeamId, ...placeholderIds]

  // The whole §7.3.8 auction block through the REAL settings surface (its
  // solvency floor — 16 × $1 ≤ $200 — passes; 084's engine backstop is
  // pgTAP 033's).
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_type: 'auction',
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
        nomination_order_mode: 'same_as_draft_order',
        auction_budget: AUCTION_BUDGET,
        auction_min_bid: AUCTION_MIN_BID,
        auction_nomination_seconds: 45,
        auction_bid_seconds: BID_SECONDS,
        auction_anti_snipe_seconds: ANTI_SNIPE_SECONDS,
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

  const { data: startData, error: startError } = await commishClient.rpc('draft_start', {
    p_league_id: leagueId,
  })
  if (startError) throw new Error(`draft_start failed: ${startError.message}`)
  const started = startData as unknown as DraftStateResponse
  draftId = started.draft.id
  if (started.draft.status !== 'live') {
    throw new Error(`auction did not start live: ${JSON.stringify(started.draft)}`)
  }
}, 180_000)

afterAll(async () => {
  await cleanup()
})

describe('the auction core over PostgREST (migration 085)', () => {
  it('the on-clock manager nominates: the phase flips to bidding and the opening bid is a draft_bids row', async () => {
    // Wrong turn first (mgr2 is not the nominator) — the same refusal shape
    // draft_make_pick has, at the auction's own verb.
    const { error: wrongTurn } = await mgr2Client.rpc('draft_nominate', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[0].id,
      p_opening_bid: 1,
      p_action_id: ACTION.wrongTurn,
    })
    expect(wrongTurn?.code).toBe('P0001')
    expect(wrongTurn?.message).toContain('it is not your turn to nominate')

    const { data, error } = await commishClient.rpc('draft_nominate', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[0].id,
      p_opening_bid: 1,
      p_action_id: ACTION.nominate,
    })
    expect(error).toBeNull()
    const opened = data as unknown as BidResponse

    // D126: the phase is now BIDDING and the nominator holds the high bid.
    const nomination = opened.draft.current_nomination as unknown as LiveNomination
    expect(nomination).toEqual({
      player_id: PLAYERS[0].id,
      high_bid: 1,
      high_bidder_team_id: orderedTeamIds[0],
    })
    // The sequence number is NOT consumed by the nomination (086 advances
    // it at the award) and on_clock stays the nominator.
    expect(opened.draft.current_pick_number).toBe(1)
    expect(opened.draft.on_clock_team_id).toBe(orderedTeamIds[0])
    expect(opened.draft.current_deadline).not.toBeNull()
    nominationDeadline = opened.draft.current_deadline as string

    // The opening is a real bid row (§12.5 uniform history — and the E2
    // replay key).
    expect(opened.bid.nomination_seq).toBe(1)
    expect(opened.bid.team_id).toBe(orderedTeamIds[0])
    expect(opened.bid.amount).toBe(1)
    expect(opened.bid.action_id).toBe(ACTION.nominate)
  }, 60_000)

  it('three real users raise; the loser and the over-max bid are refused; held-lock < 50ms (§4.6)', async () => {
    const bid1 = await timedBid(mgr2Client, 2, ACTION.bid1)
    expect((bid1.response.draft.current_nomination as unknown as LiveNomination).high_bid).toBe(2)
    expect(
      (bid1.response.draft.current_nomination as unknown as LiveNomination).high_bidder_team_id,
    ).toBe(orderedTeamIds[1])

    // The instant loser over the wire (§16.3/D136): a friendly P0001 naming
    // the standing number and the next legal bid — never a 429.
    const { error: loser } = await mgr3Client.rpc('draft_place_bid', {
      p_draft_id: draftId,
      p_amount: 2,
      p_action_id: ACTION.loser,
    })
    expect(loser?.code).toBe('P0001')
    expect(loser?.message).toContain('outbid at $2')
    expect(loser?.message).toContain('bid $3 or more')

    const bid2 = await timedBid(mgr3Client, 3, ACTION.bid2)
    expect((bid2.response.draft.current_nomination as unknown as LiveNomination).high_bid).toBe(3)

    // E5 over the wire: one dollar over the max bid, with the formula's own
    // number in the message.
    const { error: overMax } = await commishClient.rpc('draft_place_bid', {
      p_draft_id: draftId,
      p_amount: MAX_BID + 1,
      p_action_id: ACTION.overMax,
    })
    expect(overMax?.code).toBe('P0001')
    expect(overMax?.message).toContain(`over your max bid of $${MAX_BID}`)
    expect(overMax?.message).toContain(`$${AUCTION_BUDGET} for ${OPEN_SLOTS} open roster spots`)

    const bid3 = await timedBid(commishClient, 4, ACTION.bid3)
    expect((bid3.response.draft.current_nomination as unknown as LiveNomination).high_bid).toBe(4)
    expect(
      (bid3.response.draft.current_nomination as unknown as LiveNomination).high_bidder_team_id,
    ).toBe(orderedTeamIds[0])

    // D128 at the wire layer: these raises all landed with far more than
    // ANTI_SNIPE_SECONDS left on a 30s window, so the fixed window did NOT
    // move — the countdown continues through bids above the threshold.
    // (pgTAP 034 owns the inside/outside/at-the-instant matrix.)
    expect(bid3.response.draft.current_deadline).toBe(nominationDeadline)

    // NOMINATION IDENTITY OVER THE WIRE (R330). pgTAP 034 owns the full
    // matrix; what only this layer can show is that PostgREST TRANSPORTS
    // the two optional trailing arguments by name — a mismatch can only be
    // detected if the value actually arrived. L.C2.1's route must always
    // send them (F64).
    const { error: staleTarget } = await mgr2Client.rpc('draft_place_bid', {
      p_draft_id: draftId,
      p_amount: 5,
      p_action_id: ACTION.staleTarget,
      p_nomination_seq: 1,
      p_player_id: PLAYERS[1].id,
    })
    expect(staleTarget?.code).toBe('P0001')
    expect(staleTarget?.message).toContain('just went off the board')

    const { data: identityOk, error: identityErr } = await mgr2Client.rpc('draft_place_bid', {
      p_draft_id: draftId,
      p_amount: 5,
      p_action_id: ACTION.identityOk,
      p_nomination_seq: 1,
      p_player_id: PLAYERS[0].id,
    })
    expect(identityErr).toBeNull()
    expect(
      ((identityOk as unknown as BidResponse).draft.current_nomination as unknown as LiveNomination)
        .high_bid,
    ).toBe(5)

    // Exactly five rows: the opening + three raises + the identity-checked
    // raise. The refused attempts wrote nothing.
    const { data: bids, error: bidsError } = await service
      .from('draft_bids')
      .select('amount, team_id, nomination_seq')
      .eq('draft_id', draftId)
      .order('amount', { ascending: true })
    if (bidsError) throw new Error(`draft_bids read failed: ${bidsError.message}`)
    expect(bids?.map((b) => b.amount)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(bids?.map((b) => b.nomination_seq))).toEqual(new Set([1]))

    // §4.6 held-lock bound for the BID family — see the file header for why
    // min() is the honest de-flaked form.
    const rtts = [bid1.ms, bid2.ms, bid3.ms]
    expect(
      Math.min(...rtts),
      `held-lock bound: every bid RTT exceeded 50ms — [${rtts.map((n) => n.toFixed(1)).join(', ')}]ms`,
    ).toBeLessThan(50)
  }, 60_000)

  it('E2 over the wire: a replayed bid is a no-op with the identical response, and no money has moved', async () => {
    const { data: replayData, error: replayError } = await mgr2Client.rpc('draft_place_bid', {
      p_draft_id: draftId,
      p_amount: 99,
      p_action_id: ACTION.bid1,
    })
    expect(replayError).toBeNull()
    const replay = replayData as unknown as BidResponse
    // The ORIGINAL row comes back (amount 2), not a $99 raise…
    expect(replay.bid.amount).toBe(2)
    expect(replay.bid.action_id).toBe(ACTION.bid1)
    // …and the authoritative state is untouched.
    expect((replay.draft.current_nomination as unknown as LiveNomination).high_bid).toBe(5)

    const { count, error: countError } = await service
      .from('draft_bids')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
    if (countError) throw new Error(`draft_bids count failed: ${countError.message}`)
    expect(count).toBe(5)

    // D131(2): bids hold no budget — only a won pick spends. Every seat,
    // including the standing high bidder, still reads its fresh-start
    // numbers over the wire.
    for (const teamId of orderedTeamIds.slice(0, 3)) {
      const { data, error } = await service.rpc('draft_team_budget', {
        p_draft_id: draftId,
        p_team_id: teamId,
      })
      if (error) throw new Error(`draft_team_budget(${teamId}) failed: ${error.message}`)
      const rows = data as unknown as {
        remaining: number
        open_slots: number
        max_bid: number
        committed: number
      }[]
      expect(rows[0]).toMatchObject({
        remaining: AUCTION_BUDGET,
        open_slots: OPEN_SLOTS,
        max_bid: MAX_BID,
        committed: 0,
      })
    }

    const { data: solvent, error: solventError } = await service.rpc('draft_auction_solvent', {
      p_draft_id: draftId,
    })
    if (solventError) throw new Error(`draft_auction_solvent failed: ${solventError.message}`)
    expect(solvent).toBe(true)
  }, 60_000)
})
