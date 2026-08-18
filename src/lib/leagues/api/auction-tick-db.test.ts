/**
 * auction-tick-db.test.ts — L.C1.4 item 5 at the WIRE layer: migration 086's
 * ARM 2.6 and the priced completion writer against the LOCAL Supabase stack
 * — an auction in which EVERY seat times out, from the first nomination
 * clock to `in_season`, with ZERO manual actions. The auction edition of
 * `draft-tick-db.test.ts`'s all-timeout board (spec §8.2/§8.6.2/§8.6.4/§14:
 * "the draft is correct even if every client disconnects"), and E48's
 * autopilot in auction form.
 *
 * SIZING NOTE (the documented adaptation `draft-tick-db.test.ts` already
 * makes, for the same reason): the task text says "a 4-team auction", but
 * `team_count ∈ {8,10,12,14,16}` (§7.3.8; 040's CHECK) makes a 4-team league
 * unconstructible through ANY sanctioned path. The scenario ships at the v1
 * minimum — 8 teams × 2 draftable slots (roster override: 1 RB starter +
 * 1 bench, D91) = **16 all-timeout nominations**, which is what the scenario
 * proves: every nomination system-opened, every award going back to its
 * nominator at the opening bid (E26/§8.6.7(b)), the rotation walking the
 * nomination order twice, and the board completing with priced rosters.
 *
 * WHAT THIS LAYER ADDS over pgTAP 035, which owns the exhaustive matrix
 * (every seat class, both grace branches, the 45s constant, the award's
 * solvency guard to the dollar): the clock arithmetic here is only asserted
 * as MONOTONIC — a pgTAP transaction has a frozen `now()` and can pin the
 * deadline to the second, an HTTP round trip cannot, and pretending
 * otherwise is how a suite becomes flaky. What only this layer can show is
 * that the whole chain — start → system nomination → award → rotation →
 * completion → `league_rosters` → `in_season` — holds when every write goes
 * through PostgREST and the real service-role tick rather than a
 * `set_config`'d role inside one transaction.
 *
 * HARNESS (D100): timeout scenarios are produced by service-role
 * `current_deadline` rewinds between direct `draft_tick()` calls —
 * production RPCs never accept a caller clock. Rewinds SUBTRACT from the
 * SERVER-written deadline (a server timestamp), so no wall clock is read
 * anywhere (the D3/D17 ESLint guard covers this file). The pg_cron 5s job is
 * a LEGAL concurrent actor on the committed fixture: it runs the same
 * deterministic arm, so every assertion is on converged DB state and never
 * on which caller ticked.
 *
 * Seats: 1 real commissioner (STALE — never heartbeats; the 90s rewind
 * clears deadline + `disconnect_grace_seconds`, the D102/D129(3) stale
 * branch) + 7 placeholder seats (NO user — E48's autopilot, no grace).
 *
 * FIXTURE ADP IS FRACTIONAL (the R286 lesson / ledger F60): `npm run test`
 * runs against the RESTORED real player pool, and 068's ADP arm orders
 * `pl.adp NULLS LAST, pl.id` over the WHOLE table. Every fixture here sits
 * below every real ADP by value, so no projections refresh can hand a
 * system nomination to a real player and turn these assertions red.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-auction-tick-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
/** D91 draftable slots after the roster override below (1 starter + 1 bench)
 *  — the auction's per-team roster CAPACITY (D126), not a rounds count. */
const SLOTS_PER_TEAM = 2
const TOTAL_NOMINATIONS = TEAM_COUNT * SLOTS_PER_TEAM

const AUCTION_BUDGET = 200
const AUCTION_MIN_BID = 1
const NOMINATION_SECONDS = 45
const BID_SECONDS = 30
const GRACE_SECONDS = 30

const COMMISH = {
  email: 'auction-tick-commish@fieldscout.test',
  password: 'pgtap-auction-tick-1',
  username: 'at_wire_commish',
}

/** 30 RBs at adp 0.001…0.030 — below every real ADP (see the header). */
const PLAYERS = Array.from({ length: 30 }, (_, i) => ({
  id: `at-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `AT Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 1000,
}))

const ACTION = { create: 'ae100000-0000-4000-8000-000000000001' } as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let leagueId: string
let draftId: string
/** The stored nomination order — the rotation every assertion below reads. */
let nominationOrder: string[]
/** The bid deadline the first system nomination wrote (monotonicity input). */
let firstBidDeadline: string

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
    // teams/players. league_rosters FK-pins players too.
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
  await deleteUserByUsername(COMMISH.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function readDraft(): Promise<DraftRow> {
  const { data, error } = await service.from('drafts').select('*').eq('id', draftId).single()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data as DraftRow
}

/**
 * Rewind the SERVER-written deadline 90s (past deadline + 30s grace on both
 * auction clocks) and tick once. `status='live'`-conditional, the F52(a)
 * discharge: under contention the live 5s cron can complete the final award
 * between the read and the write, and an unconditional rewind would stamp a
 * deadline onto a COMPLETE draft.
 */
async function rewindAndTick(): Promise<void> {
  const draft = await readDraft()
  if (draft.status !== 'live') return
  if (draft.current_deadline === null) {
    throw new Error('a live auction with a NULL deadline — the clock cannot be advanced')
  }
  const rewound = new Date(Date.parse(draft.current_deadline) - 90_000).toISOString()
  const { error: rewindError } = await service
    .from('drafts')
    .update({ current_deadline: rewound })
    .eq('id', draftId)
    .eq('status', 'live')
  expect(rewindError).toBeNull()
  const { error: tickError } = await service.rpc('draft_tick')
  expect(tickError).toBeNull()
}

beforeAll(async () => {
  await cleanup()
  const { error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  commishClient = await signIn(COMMISH)

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
    p_team_name: 'Auction Tick Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Seven PLACEHOLDER seats (no user — E48's autopilot: they system-nominate
  // at the deadline with no grace hold).
  for (let i = 0; i < TEAM_COUNT - 1; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
  }

  const { data: teams, error: teamsError } = await service
    .from('teams')
    .select('id, created_at')
    .eq('league_id', leagueId)
    .order('created_at')
  if (teamsError) throw new Error(`teams read failed: ${teamsError.message}`)
  const orderedTeamIds = (teams ?? []).map((t) => t.id)
  if (orderedTeamIds.length !== TEAM_COUNT) {
    throw new Error(`expected ${TEAM_COUNT} seats, found ${orderedTeamIds.length}`)
  }

  // The whole §7.3.8 auction block plus a two-slot roster, through the REAL
  // settings surface (its own solvency floor — 3 × $1 ≤ $200 counting IR —
  // passes; 084's engine backstop is pgTAP 033's). A MANUAL order makes the
  // rotation assertable: `same_as_draft_order` then copies it verbatim.
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
        auction_anti_snipe_seconds: 10,
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

  const { data: startData, error: startError } = await commishClient.rpc('draft_start', {
    p_league_id: leagueId,
  })
  if (startError) throw new Error(`draft_start failed: ${startError.message}`)
  const draft = (startData as unknown as { draft: DraftRow }).draft
  if (draft.status !== 'live') {
    throw new Error(`auction did not start live: ${JSON.stringify(draft)}`)
  }
  draftId = draft.id
  nominationOrder = draft.nomination_order as string[]
  if (nominationOrder.length !== TEAM_COUNT) {
    throw new Error(`nomination_order has ${nominationOrder.length} seats`)
  }
}, 240_000)

afterAll(async () => {
  await cleanup()
})

describe('the auction clock over PostgREST (migration 086, ARM 2.6)', () => {
  it('the nomination clock times out: the system nominates through the resolve chain, not through ARM 2', async () => {
    const before = await readDraft()
    expect(before.current_nomination).toBeNull()
    expect(before.current_pick_number).toBe(1)
    expect(before.on_clock_team_id).toBe(nominationOrder[0])

    await rewindAndTick()
    const after = await readDraft()

    // The AUCTION arm ran, not the snake one. Before 086, ARM 2 claimed this
    // exact state (a due auction past deadline + grace) and wrote a
    // snake-shaped pick — see the 086 banner's measured probe.
    const { count: pickCount, error: pickErr } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
    if (pickErr) throw new Error(`draft_picks count failed: ${pickErr.message}`)
    expect(pickCount).toBe(0)
    expect(after.current_pick_number).toBe(1)

    // D126: the phase flipped to BIDDING with the NOMINATOR holding the
    // opening bid at the league minimum, and on_clock still the nominator.
    const nomination = after.current_nomination as unknown as LiveNomination
    expect(nomination.high_bid).toBe(AUCTION_MIN_BID)
    expect(nomination.high_bidder_team_id).toBe(nominationOrder[0])
    expect(after.on_clock_team_id).toBe(nominationOrder[0])
    // The resolve chain's own answer: the lowest-ADP available player.
    expect(nomination.player_id).toBe(PLAYERS[0].id)

    // F62 — the system half of "every nomination opens with a draft_bids
    // row", with the NULL action_id C39 made the column nullable for.
    const { data: bids, error: bidErr } = await service
      .from('draft_bids')
      .select('nomination_seq, player_id, team_id, amount, action_id')
      .eq('draft_id', draftId)
    if (bidErr) throw new Error(`draft_bids read failed: ${bidErr.message}`)
    expect(bids).toHaveLength(1)
    expect(bids?.[0]).toMatchObject({
      nomination_seq: 1,
      player_id: PLAYERS[0].id,
      team_id: nominationOrder[0],
      amount: AUCTION_MIN_BID,
      action_id: null,
    })

    // The clock advanced onto a fresh (bid) deadline. pgTAP 035 owns the
    // arithmetic — see the header.
    expect(after.current_deadline).not.toBeNull()
    firstBidDeadline = after.current_deadline as string
    expect(Date.parse(firstBidDeadline)).toBeGreaterThan(
      Date.parse(before.current_deadline as string) - 90_000,
    )
  }, 120_000)

  it('the bid clock closes with no raises: the nominator wins at the opening bid (E26/§8.6.7(b))', async () => {
    await rewindAndTick()
    const after = await readDraft()

    const { data: picks, error } = await service
      .from('draft_picks')
      .select('pick_number, round, team_id, player_id, price, is_auto, made_via, picked_by, action_id')
      .eq('draft_id', draftId)
    if (error) throw new Error(`draft_picks read failed: ${error.message}`)
    expect(picks).toHaveLength(1)
    expect(picks?.[0]).toMatchObject({
      pick_number: 1,
      round: null, // D126: an auction has no rounds
      team_id: nominationOrder[0], // E26: back to the nominator
      player_id: PLAYERS[0].id,
      price: AUCTION_MIN_BID,
      is_auto: true, // the opening row carried action_id NULL (D130)
      made_via: 'autopick',
      picked_by: null, // the clock wrote it, not a user
      action_id: null,
    })

    // The rotation advanced to the next seat, back in the NOMINATING phase,
    // on a fresh clock — and the money moved through the ONE family.
    expect(after.current_nomination).toBeNull()
    expect(after.current_pick_number).toBe(2)
    expect(after.on_clock_team_id).toBe(nominationOrder[1])
    expect(after.current_deadline).not.toBeNull()
    expect(Date.parse(after.current_deadline as string)).toBeGreaterThan(
      Date.parse(firstBidDeadline) - 90_000,
    )

    const { data: budget, error: budgetErr } = await service.rpc('draft_team_budget', {
      p_draft_id: draftId,
      p_team_id: nominationOrder[0],
    })
    if (budgetErr) throw new Error(`draft_team_budget failed: ${budgetErr.message}`)
    expect((budget as unknown as Record<string, number>[])[0]).toMatchObject({
      remaining: AUCTION_BUDGET - AUCTION_MIN_BID,
      open_slots: SLOTS_PER_TEAM - 1,
      committed: AUCTION_MIN_BID,
    })
  }, 120_000)

  it('every seat times out end to end: the board completes, rosters carry the prices, solvency holds', async () => {
    for (let i = 0; i < TOTAL_NOMINATIONS * 2 + 8; i++) {
      const draft = await readDraft()
      if (draft.status === 'complete') break
      await rewindAndTick()
    }

    const done = await readDraft()
    expect(done.status).toBe('complete')
    expect(done.completed_at).not.toBeNull()
    expect(done.on_clock_team_id).toBeNull()
    expect(done.current_deadline).toBeNull()
    expect(done.current_nomination).toBeNull()

    // Every nomination system-opened, every award back to its nominator.
    const { data: picks, error: pickErr } = await service
      .from('draft_picks')
      .select('pick_number, round, team_id, player_id, price, is_auto, made_via, picked_by, action_id')
      .eq('draft_id', draftId)
      .eq('is_undone', false)
      .order('pick_number')
    if (pickErr) throw new Error(`draft_picks read failed: ${pickErr.message}`)
    expect(picks).toHaveLength(TOTAL_NOMINATIONS)
    expect(picks?.map((p) => p.pick_number)).toEqual(
      Array.from({ length: TOTAL_NOMINATIONS }, (_, i) => i + 1),
    )
    for (const [i, p] of (picks ?? []).entries()) {
      expect(p.round).toBeNull()
      expect(p.price).toBe(AUCTION_MIN_BID)
      expect(p.is_auto).toBe(true)
      expect(p.made_via).toBe('autopick') // ZERO manual actions
      expect(p.picked_by).toBeNull()
      expect(p.action_id).toBeNull()
      // The rotation walked the stored nomination order twice, and each
      // award went to the seat that nominated (E26 at board scale).
      expect(p.team_id).toBe(nominationOrder[i % TEAM_COUNT])
    }
    // No player was bought twice.
    expect(new Set((picks ?? []).map((p) => p.player_id)).size).toBe(TOTAL_NOMINATIONS)

    // F62 at board scale: one opening bid row per nomination, every one a
    // system row, sequences 1..16 with no gaps and no duplicates.
    const { data: bids, error: bidErr } = await service
      .from('draft_bids')
      .select('nomination_seq, team_id, player_id, amount, action_id')
      .eq('draft_id', draftId)
      .order('nomination_seq')
    if (bidErr) throw new Error(`draft_bids read failed: ${bidErr.message}`)
    expect(bids).toHaveLength(TOTAL_NOMINATIONS)
    expect(bids?.map((b) => b.nomination_seq)).toEqual(
      Array.from({ length: TOTAL_NOMINATIONS }, (_, i) => i + 1),
    )
    for (const [i, b] of (bids ?? []).entries()) {
      expect(b.action_id).toBeNull()
      expect(b.amount).toBe(AUCTION_MIN_BID)
      expect(b.team_id).toBe(picks?.[i].team_id)
      expect(b.player_id).toBe(picks?.[i].player_id)
    }

    // The completion writer: priced rosters + the league transition.
    const { data: league, error: leagueErr } = await service
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    if (leagueErr) throw new Error(`league read failed: ${leagueErr.message}`)
    expect(league?.status).toBe('in_season')

    const { data: rosters, error: rosterErr } = await service
      .from('league_rosters')
      .select('team_id, player_id, acquisition_type, acquisition_cost')
      .eq('league_id', leagueId)
    if (rosterErr) throw new Error(`league_rosters read failed: ${rosterErr.message}`)
    expect(rosters).toHaveLength(TOTAL_NOMINATIONS)
    const priceByPlayer = new Map((picks ?? []).map((p) => [p.player_id, p.price]))
    for (const r of rosters ?? []) {
      expect(r.acquisition_type).toBe('draft')
      // D111(3)/§12.7: acquisition_cost IS the pick's price — never NULL on
      // an auction board, never the column default 0.
      expect(r.acquisition_cost).toBe(priceByPlayer.get(r.player_id))
    }

    // §8.6.8 on the finished board, plus the per-seat numbers behind it.
    const { data: solvent, error: solventErr } = await service.rpc('draft_auction_solvent', {
      p_draft_id: draftId,
    })
    if (solventErr) throw new Error(`draft_auction_solvent failed: ${solventErr.message}`)
    expect(solvent).toBe(true)

    for (const teamId of nominationOrder) {
      const { data, error } = await service.rpc('draft_team_budget', {
        p_draft_id: draftId,
        p_team_id: teamId,
      })
      if (error) throw new Error(`draft_team_budget(${teamId}) failed: ${error.message}`)
      expect((data as unknown as Record<string, number>[])[0]).toMatchObject({
        remaining: AUCTION_BUDGET - SLOTS_PER_TEAM * AUCTION_MIN_BID,
        open_slots: 0,
        max_bid: 0, // E27: a complete roster bids nothing
        committed: SLOTS_PER_TEAM * AUCTION_MIN_BID,
      })
    }
  }, 300_000)
})
