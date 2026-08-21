/**
 * auction-commish-db.test.ts — L.C1.5 at the WIRE layer: migration 087's
 * auction commissioner surface against the LOCAL Supabase stack, driven by a
 * real signed-in commissioner over PostgREST rather than by a `set_config`'d
 * role inside one transaction.
 *
 * WHAT THIS LAYER ADDS over pgTAP 036, which owns the exhaustive matrix (all
 * six D141 verbs, E28's three arms to the dollar, D162's attribution decoy,
 * the mock sweep):
 *
 *   1. **THE STUCK-CLOCK RECOVERY D160(8) SAYS DOES NOT EXIST.** L.C1.4
 *      measured that a refused insolvent award leaves the nomination
 *      standing, that pause → resume does not clear it, that the next tick
 *      reproduces the identical failure, and that the only exit was
 *      `draft_reset` — which wipes the board. This case drives the whole
 *      loop across real HTTP round trips and separate transactions, which is
 *      the one thing a single-transaction pgTAP file cannot show: the
 *      commissioner's pause, cancel and resume each COMMIT, and the
 *      service-role tick that follows reads committed state. If the remedy
 *      only worked inside one transaction it would pass 036 and fail here.
 *   2. **The D141 gate as a caller experiences it** — the refusal arrives as
 *      a PostgREST error carrying the ruling's own copy, which is what
 *      L.C2.2's routes and L.C3.2's disabled-with-the-same-copy UI will
 *      surface (§8.7 v2.10).
 *   3. **C41's end-as-is producing real `league_rosters` rows** with prices,
 *      over the wire, including the league's flip to `in_season`.
 *
 * The clock arithmetic here is asserted only as ORDERING and STATE, never to
 * the second: a pgTAP transaction has a frozen `now()` and an HTTP round trip
 * does not, and pretending otherwise is how a suite becomes flaky (the
 * `auction-tick-db.test.ts` note, carried).
 *
 * HARNESS (D100): the insolvent state is FORGED with the service role,
 * exactly as pgTAP 036 §E and 035 §H forge it — 085's max-bid clause refuses
 * to create it through any sanctioned path, which is precisely why the
 * award's own guard is the thing under test. Deadline rewinds SUBTRACT from
 * the SERVER-written deadline, so no wall clock is read anywhere (the D3/D17
 * ESLint guard covers this file).
 *
 * The pg_cron 5s job is a LEGAL concurrent actor on the committed fixture: it
 * runs the same deterministic arms, so every assertion below is on converged
 * DB state and never on which caller ticked.
 *
 * FIXTURE ADP IS FRACTIONAL (the R286 lesson / ledger F60): `npm run test`
 * runs against the RESTORED real player pool and the ADP arm orders over the
 * whole table, so every fixture here sits below every real ADP by value.
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

const LEAGUE_NAME = 'vitest-auction-commish-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
/** D91 draftable slots after the roster override below (1 starter + 1 bench)
 *  — the auction's per-team roster CAPACITY (D126). */
const SLOTS_PER_TEAM = 2
const AUCTION_BUDGET = 200
/** 092/AP.1: the DERIVED §8.6.1 per-slot reserve / §8.6.2 nomination floor
 *  — `draft_auction_reserve(config)` answers 1 with
 *  `auction_zero_dollar_nominations` false. It is NOT the bid increment,
 *  which is a fixed $1 (§8.6.3) and is written literally where it is used. */
const AUCTION_RESERVE = 1
const NOMINATION_SECONDS = 45
const BID_SECONDS = 30
const GRACE_SECONDS = 30
/** §8.6.1: max_bid = remaining − (open_slots − 1) × reserve. At full budget
 *  with 2 open slots that is 200 − 1 = 199, so $200 is over by exactly one
 *  dollar — the D146 shape, used here to forge the insolvent award. */
const MAX_BID_AT_START = AUCTION_BUDGET - (SLOTS_PER_TEAM - 1) * AUCTION_RESERVE
const OVER_MAX_BID = MAX_BID_AT_START + 1

const COMMISH = {
  email: 'auction-commish@fieldscout.test',
  password: 'pgtap-auction-commish-1',
  username: 'ac_wire_commish',
}

/** 30 RBs at adp 0.001…0.030 — below every real ADP (see the header). */
const PLAYERS = Array.from({ length: 30 }, (_, i) => ({
  id: `ac-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `AC Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: (i + 1) / 1000,
}))

const ACTION = { create: 'ac100000-0000-4000-8000-000000000001' } as const

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
let nominationOrder: string[]

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

async function livePickCount(): Promise<number> {
  const { count, error } = await service
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', draftId)
    .eq('is_undone', false)
  if (error) throw new Error(`pick count failed: ${error.message}`)
  return count ?? 0
}

/**
 * Rewind the SERVER-written deadline 90s (past deadline + the 30s grace on
 * both auction clocks) and tick once, returning the tick's own summary.
 * `status='live'`-conditional — the F52(a) discharge: the live 5s cron can
 * move the board between the read and the write.
 */
async function rewindAndTick(): Promise<Record<string, unknown>> {
  const draft = await readDraft()
  if (draft.status === 'live') {
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
  }
  const { data, error } = await service.rpc('draft_tick')
  expect(error).toBeNull()
  return (data ?? {}) as Record<string, unknown>
}

/**
 * Failures for THIS draft only. F67's fix shape, applied at birth rather
 * than inherited: `auction_failures` is a whole-tick array and indexing `->0`
 * reports a neighbour's failure as your own — every other suite's fixtures
 * are live in the same database when `npm run test` runs.
 */
function failuresForThisDraft(tick: Record<string, unknown>): { error: string }[] {
  const all = (tick.auction_failures ?? []) as { draft_id?: string; error?: string }[]
  return all
    .filter((f) => f.draft_id === draftId)
    .map((f) => ({ error: String(f.error ?? '') }))
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
    p_team_name: 'Auction Commish',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

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
        auction_zero_dollar_nominations: false, // 092/AP.1: the retired min-bid field's replacement; false ⇒ the $1 reserve/floor below
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

describe('auction commissioner controls over PostgREST (migration 087)', () => {
  it('recovers a stuck clock: pause is not enough, draft_cancel_nomination is — and the board survives (D160(8)/R364 discharged)', async () => {
    // ---- FORGE (service role): a standing high bid one dollar over its
    // bidder's max bid, WITH its backing draft_bids row so F62 passes and the
    // §8.6.8 solvency clause is the only thing that can refuse.
    const started = await readDraft()
    expect(started.current_nomination).toBeNull()
    const nominator = started.on_clock_team_id as string
    expect(nominator).toBe(nominationOrder[0])

    const forgedPlayer = PLAYERS[0].id
    const { error: bidError } = await service.from('draft_bids').insert({
      draft_id: draftId,
      league_id: leagueId,
      nomination_seq: started.current_pick_number as number,
      player_id: forgedPlayer,
      team_id: nominator,
      amount: OVER_MAX_BID,
    })
    expect(bidError).toBeNull()
    const { error: forgeError } = await service
      .from('drafts')
      .update({
        current_nomination: {
          player_id: forgedPlayer,
          high_bid: OVER_MAX_BID,
          high_bidder_team_id: nominator,
        },
      })
      .eq('id', draftId)
    expect(forgeError).toBeNull()

    // ---- STEP 1: the tick refuses, loudly, and writes nothing.
    const tick1 = await rewindAndTick()
    const failed1 = failuresForThisDraft(tick1)
    expect(failed1.length).toBeGreaterThanOrEqual(1)
    expect(failed1[0].error).toContain('§8.6.8 solvency')
    expect(await livePickCount()).toBe(0)
    const afterTick1 = await readDraft()
    expect(afterTick1.current_nomination).not.toBeNull()

    // ---- STEP 2: pause → resume, each its OWN committed round trip. This is
    // the measurement D160(8) recorded, reproduced across transactions.
    const { error: pause1 } = await commishClient.rpc('draft_pause', { p_draft_id: draftId })
    expect(pause1).toBeNull()
    const { error: resume1 } = await commishClient.rpc('draft_resume', { p_draft_id: draftId })
    expect(resume1).toBeNull()
    const afterBounce = await readDraft()
    expect(afterBounce.status).toBe('live')
    expect(afterBounce.current_nomination).not.toBeNull()
    expect((afterBounce.current_nomination as unknown as LiveNomination).high_bid).toBe(OVER_MAX_BID)

    // ---- STEP 3: the next tick reproduces the IDENTICAL failure — a loop,
    // not a transient.
    const failed2 = failuresForThisDraft(await rewindAndTick())
    expect(failed2.length).toBeGreaterThanOrEqual(1)
    expect(failed2[0].error).toContain('§8.6.8 solvency')
    expect(await livePickCount()).toBe(0)

    // ---- STEP 4: THE REMEDY. Pause, cancel, resume — all through the real
    // commissioner client over HTTP.
    const { error: pause2 } = await commishClient.rpc('draft_pause', { p_draft_id: draftId })
    expect(pause2).toBeNull()
    const { data: cancelled, error: cancelError } = await commishClient.rpc(
      'draft_cancel_nomination',
      { p_draft_id: draftId },
    )
    expect(cancelError).toBeNull()
    const cancelResult = cancelled as unknown as {
      voided_bids: number
      nomination_seq: number
      cancelled_player_id: string
    }
    expect(cancelResult.cancelled_player_id).toBe(forgedPlayer)
    expect(cancelResult.voided_bids).toBe(1)

    const afterCancel = await readDraft()
    expect(afterCancel.current_nomination).toBeNull()
    // D143: the sequence number is NOT consumed.
    expect(afterCancel.current_pick_number).toBe(started.current_pick_number)
    // The seat that was nominating still is — cancel-and-renominate.
    expect(afterCancel.on_clock_team_id).toBe(nominator)
    // …AND THE BOARD SURVIVED. draft_reset — the only exit D160(8) had — would
    // have cleared picks AND flipped the league back to `scheduled`.
    expect(await livePickCount()).toBe(0)
    const { data: leagueAfterCancel } = await service
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    expect(leagueAfterCancel?.status).toBe('drafting')

    // D162: the bid row STANDS, stamped rather than deleted.
    const { data: bidsAfterCancel } = await service
      .from('draft_bids')
      .select('amount, voided_at')
      .eq('draft_id', draftId)
    expect(bidsAfterCancel).toHaveLength(1)
    expect(bidsAfterCancel?.[0].amount).toBe(OVER_MAX_BID)
    expect(bidsAfterCancel?.[0].voided_at).not.toBeNull()

    const { error: resume2 } = await commishClient.rpc('draft_resume', { p_draft_id: draftId })
    expect(resume2).toBeNull()

    // ---- STEP 5: the clock is unstuck. The next tick has nothing to fail on
    // and the nomination-expiry arm opens a fresh, affordable nomination.
    const tick4 = await rewindAndTick()
    expect(failuresForThisDraft(tick4)).toHaveLength(0)
    const recovered = await readDraft()
    expect(recovered.status).toBe('live')
    const live = recovered.current_nomination as unknown as LiveNomination | null
    expect(live).not.toBeNull()
    expect(live?.high_bid).toBe(AUCTION_RESERVE)
    // Still sequence 1 — the number D143 refused to consume.
    expect(recovered.current_pick_number).toBe(started.current_pick_number)

    // The new opening row is LIVE and the forged one is still VOIDED, both
    // under the same nomination_seq — the merge D162 exists to disambiguate.
    const { data: bidsNow } = await service
      .from('draft_bids')
      .select('amount, action_id, voided_at')
      .eq('draft_id', draftId)
      .eq('nomination_seq', started.current_pick_number as number)
    expect(bidsNow).toHaveLength(2)
    expect(bidsNow?.filter((b) => b.voided_at === null)).toHaveLength(1)
    // F62 + D130: the clock's opening row carries a NULL action_id.
    expect(bidsNow?.find((b) => b.voided_at === null)?.action_id).toBeNull()

    // D97: every one of those state changes posted IN THE SAME TRANSACTION as
    // the change, and the room can read them.
    const { data: posts } = await commishClient
      .from('league_chat')
      .select('message')
      .eq('context', `draft:${draftId}`)
      .eq('is_system', true)
    const messages = (posts ?? []).map((p) => p.message)
    expect(messages.some((m) => m.startsWith('Nomination cancelled by'))).toBe(true)
    expect(messages.some((m) => m.includes(`comes off the block at $${OVER_MAX_BID}`))).toBe(true)
  }, 240_000)

  it('the D141 pause-first gate reaches the caller as the ruling’s own copy, and lifts when paused', async () => {
    const live = await readDraft()
    expect(live.status).toBe('live')

    // The three gated verbs a commissioner can reach with no extra fixture.
    const undo = await commishClient.rpc('draft_undo', { p_draft_id: draftId })
    expect(undo.error?.message).toBe(
      'draft_undo: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
    )
    const clock = await commishClient.rpc('draft_set_clock', {
      p_draft_id: draftId,
      p_nomination_seconds: 60,
    })
    expect(clock.error?.message).toBe(
      'draft_set_clock: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
    )
    const cancel = await commishClient.rpc('draft_cancel_nomination', { p_draft_id: draftId })
    expect(cancel.error?.message).toBe(
      'draft_cancel_nomination: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
    )
    // Refused means refused: the board did not move.
    const stillLive = await readDraft()
    expect(stillLive.current_nomination).not.toBeNull()
    expect(stillLive.config).toMatchObject({ auction_nomination_seconds: NOMINATION_SECONDS })

    // Paused, the same edit lands and governs SUBSEQUENT clocks (E15 analog).
    const { error: pauseError } = await commishClient.rpc('draft_pause', { p_draft_id: draftId })
    expect(pauseError).toBeNull()
    const { error: clockError } = await commishClient.rpc('draft_set_clock', {
      p_draft_id: draftId,
      p_nomination_seconds: 60,
      p_bid_seconds: 25,
    })
    expect(clockError).toBeNull()
    const edited = await readDraft()
    expect(edited.config).toMatchObject({
      auction_nomination_seconds: 60,
      auction_bid_seconds: 25,
    })
    // An auction has no pick clock, and saying so is better than storing a
    // number nothing reads.
    const pickClock = await commishClient.rpc('draft_set_clock', {
      p_draft_id: draftId,
      p_pick_timer_seconds: 45,
    })
    expect(pickClock.error?.message).toContain('this is an auction — it has no pick clock')

    const { error: resumeError } = await commishClient.rpc('draft_resume', { p_draft_id: draftId })
    expect(resumeError).toBeNull()
  }, 120_000)

  it('draft_end freezes a partial board as-is: rosters at their winning prices, unfilled slots simply empty, league in_season (C41)', async () => {
    // Let the clock settle ONE award so the board is genuinely partial rather
    // than empty — end-as-is on an empty board would prove nothing about
    // prices riding into league_rosters.
    await rewindAndTick()
    const awarded = await livePickCount()
    expect(awarded).toBeGreaterThanOrEqual(1)

    const { data: ended, error: endError } = await commishClient.rpc('draft_end', {
      p_draft_id: draftId,
    })
    expect(endError).toBeNull()
    const result = ended as unknown as { unfilled_slots: number; rostered: number }

    // The count is the ONE family's, not arithmetic done twice.
    expect(result.rostered).toBe(awarded)
    expect(result.unfilled_slots).toBe(TEAM_COUNT * SLOTS_PER_TEAM - awarded)

    const after = await readDraft()
    expect(after.status).toBe('complete')
    expect(after.current_nomination).toBeNull()

    const { data: league } = await service
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    expect(league?.status).toBe('in_season')

    const { data: rosters } = await service
      .from('league_rosters')
      .select('player_id, acquisition_type, acquisition_cost')
      .eq('league_id', leagueId)
    expect(rosters).toHaveLength(awarded)
    // D111(3)/§12.7: acquisition_cost IS the winning bid — the whole point of
    // the priced completion writer, seen from the far end of the chain.
    const { data: picks } = await service
      .from('draft_picks')
      .select('player_id, price')
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    const priceByPlayer = new Map((picks ?? []).map((p) => [p.player_id, p.price]))
    for (const row of rosters ?? []) {
      expect(row.acquisition_type).toBe('draft')
      expect(row.acquisition_cost).toBe(priceByPlayer.get(row.player_id))
      expect(row.acquisition_cost).not.toBeNull()
    }

    // Unfilled slots are ABSENT, not present-and-empty (C41: free agency
    // fills them later).
    expect((rosters ?? []).length).toBeLessThan(TEAM_COUNT * SLOTS_PER_TEAM)

    // §4 rule 7: ending spends nothing, so §8.6.8 carries across untouched.
    const { data: solvent, error: solventError } = await service.rpc('draft_auction_solvent', {
      p_draft_id: draftId,
    })
    expect(solventError).toBeNull()
    expect(solvent).toBe(true)

    // The nomination that was live when End was pressed is voided, un-awarded.
    // Stated as the INVARIANT rather than against a sequence number read
    // earlier: the live 5s cron is a legal concurrent actor on this committed
    // fixture, so `before.current_pick_number` can be one award stale by the
    // time draft_end runs, and pinning that number would make this assertion
    // a race rather than a check. The cron-proof form: after end, a bid row is
    // un-voided if and only if its sequence produced a standing pick.
    const { data: allBids } = await service
      .from('draft_bids')
      .select('nomination_seq, voided_at')
      .eq('draft_id', draftId)
    const seqsWithLivePick = new Set(
      (
        await service
          .from('draft_picks')
          .select('pick_number')
          .eq('draft_id', draftId)
          .eq('is_undone', false)
      ).data?.map((p) => p.pick_number),
    )
    expect((allBids ?? []).length).toBeGreaterThan(0)
    // ONE DIRECTION ONLY, and the asymmetry is the whole of D162: a sequence
    // that produced no standing pick has ALL its bids voided. The converse is
    // deliberately false — sequence 1 here carries the cancelled $200 row
    // (voided) alongside the system row that went on to win it (live), which
    // is exactly the merged history `player_id` alone could not separate and
    // `voided_at` can.
    for (const bid of allBids ?? []) {
      if (!seqsWithLivePick.has(bid.nomination_seq)) {
        expect(bid.voided_at).not.toBeNull()
      }
    }
    expect((allBids ?? []).some((b) => b.voided_at === null)).toBe(true)
    expect((allBids ?? []).some((b) => b.voided_at !== null)).toBe(true)

    const { data: posts } = await commishClient
      .from('league_chat')
      .select('message')
      .eq('context', `draft:${draftId}`)
      .eq('is_system', true)
    expect(
      (posts ?? []).some((p) =>
        p.message.includes(
          `${TEAM_COUNT * SLOTS_PER_TEAM - awarded} roster spots stay empty for free agency`,
        ),
      ),
    ).toBe(true)
  }, 180_000)
})
