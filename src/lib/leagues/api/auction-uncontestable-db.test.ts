/**
 * auction-uncontestable-db.test.ts — AP.2 item 6 at the WIRE layer: §8.6.9's
 * instant award, driven end to end against the LOCAL Supabase stack through
 * the real service-role `draft_tick()`, the real commissioner budget verb and
 * real PostgREST round trips (never a `set_config`'d role inside one
 * transaction, which is pgTAP 041's layer).
 *
 * CHRIS'S ORDER, which this suite exists to show holding over the wire
 * (2026-08-20): *"It awards the player immediately and then displays that
 * message for 3 seconds until the next nomination."* The server half of that
 * is the only half a database test can see, and it is the half that matters:
 * **the award is already on the board when the nomination call returns.** The
 * 3 seconds is the room's, and `auction-block-ops.test.ts` owns it.
 *
 * THE BOARD IS DELIBERATELY IN TWO HALVES, because AP.2 item 6 asks for a run
 * whose TAIL is uncontestable and §8.6.9 insists the rule is not an endgame
 * rule:
 *   * **Nominations 1–8 are CONTESTED** ($200 purses, every rival able to
 *     raise), so each one costs TWO tick passes — one to open the clock, one
 *     for ARM 2.6(b) to close it — and the sweep's `auction_awarded` counter
 *     climbs to 8. This is the control: it is what the board did before 093.
 *   * The commissioner then takes every seat down to $1 through the REAL
 *     `draft_adjust_budget` verb (§8.7/E28 — the sanctioned way to change a
 *     live draft, and Chris's own framing of it: *"a commish can pause a draft
 *     and change anything"*). Every seat now reads `max_bid 1`, so no rival
 *     can reach the $2 a $1 opening would need.
 *   * **Nominations 9–16 are UNCONTESTABLE** and each costs ONE tick pass:
 *     the system nomination and its award land in the same transaction, the
 *     bid clock is never armed, and `auction_awarded` **never moves again**
 *     — the sweep is not involved in those eight awards, which is exactly the
 *     claim item 6 names.
 * The board then completes to `in_season` with priced rosters, and the two
 * halves are compared: same 16 picks, same $1 prices, half the tick passes.
 *
 * WHAT THIS LAYER ADDS over pgTAP 041, which owns the exhaustive predicate
 * matrix (Chris's $8-vs-$7 fixture, both toggle columns, the one-dollar pairs,
 * all three nomination paths, the wire payloads): composition over the real
 * transport, and the tick-pass ARITHMETIC — the thing a single-transaction
 * test cannot show, because it is about how many round trips the board costs.
 *
 * SIZING NOTE (the adaptation `auction-tick-db.test.ts` documents for the same
 * reason): `team_count ∈ {8,10,12,14,16}` (§7.3.8; 040's CHECK), so the
 * scenario ships at the v1 minimum — 8 teams × 2 draftable slots (roster
 * override: 1 RB starter + 1 bench, D91) = 16 nominations, 8 per half.
 *
 * HARNESS (D100): timeout scenarios are produced by service-role
 * `current_deadline` rewinds between direct `draft_tick()` calls — production
 * RPCs never accept a caller clock. Rewinds SUBTRACT from the SERVER-written
 * deadline, so no wall clock is read anywhere (the D3/D17 ESLint guard covers
 * this file). The pg_cron 5s job is a LEGAL concurrent actor: it runs the same
 * deterministic arm, so every assertion is on converged DB state. The ONE
 * assertion that could be disturbed by it — the tick-pass count — is written
 * as a MONOTONIC bound (`auction_awarded` never increases in the second half)
 * rather than an exact call count, because the cron can legitimately perform a
 * pass this suite did not ask for. AND (F264 / D325, 2026-09-08) every
 * per-pass state read is a bounded WAIT for the converged row, because the
 * direct `draft_tick()` claims `FOR UPDATE SKIP LOCKED` and can therefore
 * SKIP a draft the cron already holds and return before the cron's pass
 * commits — see `waitForDraft`; the contested half's exact tally counts a
 * cron-won close explicitly (`cronClosed`) rather than losing it.
 *
 * Seats: 1 real commissioner (STALE — never heartbeats) + 7 placeholder seats
 * (NO user — E48's autopilot, no grace).
 *
 * FIXTURE ADP IS FRACTIONAL (the R286 lesson / ledger F60): every fixture
 * player sits below every real ADP by value, so no projections refresh can
 * hand a system nomination to a real player.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-auction-uncontestable-league'
/** F49: far future — the live cron auto-starts COMMITTED scheduled leagues
 *  whose stored instant has passed. This suite starts the draft itself. */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const TEAM_COUNT = 8
/** D91 draftable slots after the roster override below (1 starter + 1 bench)
 *  — the auction's per-team roster CAPACITY (D126), not a rounds count. */
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

const COMMISH = {
  email: 'auction-unc-commish@fieldscout.test',
  password: 'pgtap-auction-unc-1',
  username: 'au_wire_commish',
}

/**
 * 20 RBs with **NULL adp**, and the null is the point (R464 review round).
 *
 * MEASURED, not assumed: with `seed.sql` seeding ZERO players
 * (`grep -c players supabase/seed.sql` -> 0), every stack suite's fixtures ARE
 * the shared pool while the lane runs, and `draft_mock_cpu_bid_value` derives
 * a player's RANK with `count(*) + 1 ... WHERE pl.adp IS NOT NULL AND pl.adp <
 * v_adp` — a count over the WHOLE table. An earlier draft of this file
 * inserted 30 players with fractional ADPs; a full `npm run test` then failed
 * `auction-api-db.test.ts` (a CPU, not the launcher, ended up holding the high
 * bid) while two full runs with this file REMOVED failed only the F94 suite.
 * Adding ADP'd rows shifts other suites' CPU seeds — i.e. this file was
 * WIDENING F94's blast radius.
 *
 * A NULL adp is invisible to every `adp IS NOT NULL` rank computation, so it
 * perturbs nothing, and `draft_autopick_resolve`'s ADP arm orders
 * `adp NULLS LAST, id` — these sit dead last, behind every real player and
 * every other fixture, which costs this suite nothing: it asserts COUNTS,
 * PRICES and TICK-PASS ARITHMETIC, never a player's identity.
 */
const PLAYERS = Array.from({ length: 20 }, (_, i) => ({
  id: `au-wire-rb${String(i + 1).padStart(2, '0')}`,
  full_name: `AU Wire RB ${String(i + 1).padStart(2, '0')}`,
  position: 'RB',
  adp: null,
}))

const ACTION = { create: 'af100000-0000-4000-8000-000000000001' } as const

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
    // 110/L.D1.2: completion now writes matchups + league_weeks (the schedule) — both reference teams/leagues, so the league graph releases them FIRST (a fixture change forced by 110, not a drive-by).
    await service.from('matchups').delete().in('league_id', ids)
    await service.from('league_weeks').delete().in('league_id', ids)
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

beforeAll(async () => {
  await cleanup()
  // F215 / migration 110: draft completion maps the league onto the NFL
  // calendar at the call instant — this suite creates its league on a
  // SYNTHETIC season so the mapping never depends on the wall clock.
  await seedSyntheticSeason(service)
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
    p_season: SYNTHETIC_SEASON, // F215: the fixture owns its calendar (migration 110 maps completion onto nfl_weeks)
    p_scoring_system_id: template?.id,
    p_team_name: 'Auction Uncontestable Commish',
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

/** Every seat's live budget, through the ONE server authority (084/D127) —
 *  never a TS mirror, because this suite is asserting what the ENGINE sees. */
async function maxBidOf(teamId: string): Promise<number> {
  const { data, error } = await service.rpc('draft_team_budget', {
    p_draft_id: draftId,
    p_team_id: teamId,
  })
  if (error) throw new Error(`draft_team_budget failed: ${error.message}`)
  return (data as unknown as { max_bid: number }[])[0].max_bid
}

async function pickCount(): Promise<number> {
  const { count, error } = await service
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', draftId)
    .eq('is_undone', false)
  if (error) throw new Error(`pick count failed: ${error.message}`)
  return count ?? 0
}

const POLL_MS = 200
/** The convergence budget: generous against a cron pass in flight (a pass
 *  commits in well under a second even on a 2-vCPU runner), and DELIBERATELY
 *  below the 30 s bid clock, so a clock the engine wrongly armed can never
 *  be closed by the cron inside the wait — a pass that did not happen still
 *  reds the same assertion; it never passes. */
const CONVERGE_MS = 10_000

/**
 * Bounded wait for the draft row to reach a state — attempt-counted, no wall
 * clock (budget ≈ attempts × POLL_MS). F264 / D325: `rewindAndTickReport`'s
 * direct `draft_tick()` claims `FOR UPDATE SKIP LOCKED` (091:1677 / 1842 /
 * 1954), so when the live 5 s cron has ALREADY claimed this draft the direct
 * call SKIPS it and returns before the cron's transaction commits; a read
 * taken at that instant sees the PRE-pass row (READ COMMITTED) and the
 * assertion reds one pass behind — "nomination 1 should be live: expected
 * null not to be null" (CI run 34188213182, PR #269) and "picks after tail
 * nomination 7: expected 14 to be 15" (F139, local). The cron is a LEGAL
 * actor (harness note) running the same deterministic arm, so the fix is to
 * wait for the CONVERGED state; the assertion after the wait is unchanged.
 */
async function waitForDraft(ok: (row: DraftRow) => boolean, budgetMs: number): Promise<DraftRow> {
  const attempts = Math.ceil(budgetMs / POLL_MS)
  let row = await readDraft()
  for (let i = 1; i < attempts && !ok(row); i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    row = await readDraft()
  }
  return row
}

/** The same bounded wait over the live pick count (the tail half's arithmetic). */
async function waitForPickCount(expected: number, budgetMs: number): Promise<number> {
  const attempts = Math.ceil(budgetMs / POLL_MS)
  let count = await pickCount()
  for (let i = 1; i < attempts && count !== expected; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    count = await pickCount()
  }
  return count
}

/** Rewind + tick, returning the sweep's own report so the counters can be
 *  read rather than inferred (§4 rule 9). */
async function rewindAndTickReport(): Promise<{ nominated: number; awarded: number }> {
  const draft = await readDraft()
  if (draft.status !== 'live') return { nominated: 0, awarded: 0 }
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
  const { data, error } = await service.rpc('draft_tick')
  expect(error).toBeNull()
  const report = data as unknown as { auction_nominated?: number; auction_awarded?: number }
  return { nominated: report.auction_nominated ?? 0, awarded: report.auction_awarded ?? 0 }
}

describe('§8.6.9 over the wire: the contested half costs two passes, the uncontestable half costs one', () => {
  it('drives 16 nominations to `in_season` and shows the sweep awarding EIGHT of them and none of the other eight', async () => {
    // ---- HALF ONE: CONTESTED (the pre-093 control) ------------------------
    // $200 purses over two slots ⇒ every seat reads max_bid 199, so a $1
    // opening is answerable by seven rivals and the clock has to run.
    expect(await maxBidOf(nominationOrder[0])).toBe(AUCTION_BUDGET - AUCTION_RESERVE)

    let awardedBySweep = 0
    let cronClosed = 0
    for (let n = 0; n < TEAM_COUNT; n++) {
      const opened = await rewindAndTickReport()
      awardedBySweep += opened.awarded
      const live = await waitForDraft((d) => d.current_nomination !== null, CONVERGE_MS)
      // The nomination OPENED and is waiting on a bid clock — §8.6.9 did not
      // fire, because it should not have.
      expect(live.current_nomination, `nomination ${n + 1} should be live`).not.toBeNull()
      const nomination = live.current_nomination as unknown as LiveNomination
      expect(nomination.high_bid).toBe(AUCTION_RESERVE)
      expect(live.current_deadline).not.toBeNull()

      const closed = await rewindAndTickReport()
      awardedBySweep += closed.awarded
      const after = await waitForDraft((d) => d.current_nomination === null, CONVERGE_MS)
      expect(after.current_nomination, `nomination ${n + 1} should be closed`).toBeNull()
      // A close our own call did not report, yet the board converged on: the
      // cron's pass — the only other actor, running the same ARM 2.6(b) —
      // counted explicitly so the exact tally below stays exact (F264/D325).
      if (closed.awarded === 0) cronClosed += 1
    }
    expect(await pickCount()).toBe(TEAM_COUNT)
    // The counter is the point: ARM 2.6(b) closed all eight — through our
    // direct passes or the cron's, never through anything else.
    expect(awardedBySweep + cronClosed, `sweep closes (${awardedBySweep} ours + ${cronClosed} cron)`).toBe(TEAM_COUNT)

    // ---- THE COMMISSIONER TAKES THE ROOM DOWN TO ITS CEILING --------------
    // Through the REAL §8.7 verb, which re-validates E28 on every seat. Each
    // team has spent $1 of $200; −$198 leaves $1 against ONE open slot, i.e.
    // max_bid $1 — §8.6.7(d)'s team, eight times over.
    for (const teamId of nominationOrder) {
      const { error } = await commishClient.rpc('draft_adjust_budget', {
        p_draft_id: draftId,
        p_team_id: teamId,
        p_delta: -(AUCTION_BUDGET - AUCTION_RESERVE - 1),
        p_reason: 'AP.2 wire test: drive every seat to its $1 ceiling',
      })
      expect(error, `budget edit on ${teamId}`).toBeNull()
    }
    for (const teamId of nominationOrder) {
      expect(await maxBidOf(teamId), `max bid after the edit on ${teamId}`).toBe(1)
    }

    // ---- HALF TWO: UNCONTESTABLE ------------------------------------------
    // Nothing about the board changed except the money, and nothing about the
    // ENGINE changed at all: the same system nomination at the same $1 floor
    // now finds no rival able to reach $2, so the award lands in the same
    // transaction and the clock is never armed.
    const awardedBefore = awardedBySweep
    for (let n = 0; n < TEAM_COUNT; n++) {
      const pass = await rewindAndTickReport()
      awardedBySweep += pass.awarded
      // ONE pass per nomination — the pick is on the board and there is no
      // live nomination to come back for. (Converged read — waitForDraft's
      // note; the budget is far below the bid clock a wrongly-armed
      // nomination would need, so a second pass cannot hide behind it.)
      const picks = await waitForPickCount(TEAM_COUNT + n + 1, CONVERGE_MS)
      const after = await readDraft()
      expect(picks, `picks after tail nomination ${n + 1}`).toBe(TEAM_COUNT + n + 1)
      if (after.status === 'live') {
        expect(after.current_nomination, `tail nomination ${n + 1} left a live clock`).toBeNull()
      }
    }
    // THE CLAIM OF AP.2 ITEM 6, MEASURED: the sweep awarded nothing in the
    // second half. Written as "did not increase" rather than "was called
    // exactly N times" because the live 5s cron is a legal concurrent actor
    // (harness note) — but no actor can make ARM 2.6(b) close a clock that was
    // never armed, so this bound is exact in substance.
    expect(awardedBySweep).toBe(awardedBefore)

    // ---- THE BOARD COMPLETES ----------------------------------------------
    const final = await readDraft()
    expect(final.status).toBe('complete')
    expect(await pickCount()).toBe(TEAM_COUNT * SLOTS_PER_TEAM)

    const { data: prices, error: priceError } = await service
      .from('draft_picks')
      .select('price, round, is_auto, made_via')
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    expect(priceError).toBeNull()
    // Both halves produced the IDENTICAL kind of row — §12.4's auction shape,
    // priced at the opening bid, attributed to the clock (D130). "No second
    // kind of award" is not a comment in the migration; it is this assertion.
    for (const row of prices ?? []) {
      expect(row.price).toBe(AUCTION_RESERVE)
      expect(row.round).toBeNull()
      expect(row.is_auto).toBe(true)
      expect(row.made_via).toBe('autopick')
    }

    const { data: league, error: leagueError } = await service
      .from('leagues')
      .select('status')
      .eq('id', leagueId)
      .single()
    expect(leagueError).toBeNull()
    expect(league?.status).toBe('in_season')

    const { count: rosterCount, error: rosterError } = await service
      .from('league_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
    expect(rosterError).toBeNull()
    expect(rosterCount).toBe(TEAM_COUNT * SLOTS_PER_TEAM)
  }, 240_000)
})
