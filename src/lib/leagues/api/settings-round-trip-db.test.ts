/**
 * settings-round-trip-db.test.ts — L.A1.13 items 2+3: the full §7.3
 * round-trip (M1 GATE ITEM 3) + the reach-`scheduled` integration, against
 * the LOCAL Supabase stack end-to-end through PostgREST.
 *
 * WHAT'S UNDER TEST (D70): the SERVICE layer (`leagues-service.ts`
 * `patchLeague`/`getLeagueDetail`) driven with real signed-in clients — the
 * same composition the PATCH Route Handler wraps (Zod parse →
 * validateLeagueSettings → splitSettings → `update_league_settings` RPC on
 * the settings path; validateLeagueSettings over the CURRENT stored
 * settings → `set_league_status` RPC on the lifecycle path). The Next
 * routes add only cookie/auth plumbing (CLAUDE.md: routes carry minimal
 * logic).
 *
 * GATE ITEM 3 (tasks-M1 L.A1.13 item 2): the round-trip drives the
 * EXPORTED L.A1.6 enumeration fixture (`round-trip-fixture.ts`, D60(10) —
 * re-enumerating locally is the named anti-pattern). The fixture's design
 * rule (every leaf differs from the defaults except the single-option
 * fields, pinned in split-merge.test.ts) means one wholesale PATCH + the
 * per-field assertion sweep below proves EVERY §7.3 field round-trips a
 * non-default in-range value — a field silently dropped anywhere in
 * split → RPC → DB → merge falls back to its default and fails EXACTLY its
 * own per-field test (the DoD probe demonstrates this live).
 *
 * Also here (task text, verbatim obligations):
 *   - scoring_system_id: PATCH to a different template id → GET back equal;
 *     the rejected non-template-id case (§7.3.3 v1 templates-only).
 *   - after the team_count PATCH, a DIRECT DB read asserts
 *     `max_teams = team_count` (the GET path doesn't expose max_teams on
 *     the settings side; §12.1 NOTE — this RPC is the sync's second writer).
 *   - boundary values for every ranged field (two cross-field-consistent
 *     composites at the low/high edges + the exact playoff-week-18
 *     arithmetic edge) and a rejected out-of-range case per §7.3 field
 *     group.
 *   - reach-`scheduled`: valid settings + draft_scheduled_at → `scheduled`;
 *     missing either → clear 400; back to `setup` works; THIS route is the
 *     enforcement point for settings validity on the scheduled transition
 *     (proven with a privileged-corruption fixture the validator refuses
 *     BEFORE the RPC ever runs).
 *   - the L.A1.6 hand-off (tasks-M1 L.A1.6 item 3): a freshly-defaulted
 *     leagues row's `roster_settings` (040's column DEFAULT) deep-equals
 *     the TS `DEFAULT_ROSTER_SETTINGS` literal.
 *   - D71 (R79, batch-13 remediation): partial settings bodies deep-merge
 *     over the CURRENT stored settings — the catastrophic-reset probe from
 *     the review is section C2's regression trap (one-key body must change
 *     exactly one field), with the merged-whole cross-field pin, nested
 *     merge, unknown-key rejects, and the full-object identity.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * same precondition as `npm run test:db` (D59(5)). FAILS loudly when the
 * stack is down; never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (no
 * wall-clock/random uniqueness — the D3/D17 lint bans cover leagues tests).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  DEFAULT_ROSTER_SETTINGS,
  defaultsForTeamCount,
  validateLeagueSettings,
  type LeagueSettings,
} from '../settings/league-settings'
import { ROUND_TRIP_SETTINGS } from '../settings/round-trip-fixture'
import { createLeague, getLeagueDetail, patchLeague } from './leagues-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-rt-league'

const CREATOR = {
  email: 'leagues-rt-creator@fieldscout.test',
  password: 'pgtap-leagues-pass-3',
  username: 'rt_commish_one',
}
const OUTSIDER = {
  email: 'leagues-rt-outsider@fieldscout.test',
  password: 'pgtap-leagues-pass-4',
  username: 'rt_outsider_two',
}

// Fixed action_ids — one per logical create in this suite (D68 idempotency).
const ACTION = {
  roundTrip: 'ad200000-0000-4000-8000-000000000001',
  lifecycle: 'ad200000-0000-4000-8000-000000000002',
  locked: 'ad200000-0000-4000-8000-000000000003',
  partial: 'ad200000-0000-4000-8000-000000000004',
  /** Batch-14 R84: the F28 shrink-floor mapping fixture (seats real
   *  franchises, so the floor is reachable). */
  floor: 'ad200000-0000-4000-8000-000000000005',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let creatorClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let creatorId: string
let outsiderId: string
let espnStandardId: string
let yahooStandardId: string
let personalScoringId: string
let rtLeagueId: string
let lifeLeagueId: string
let lockLeagueId: string

// ---------------------------------------------------------------------------
// Boundary composites — every RANGED field at its legal edges, kept
// cross-field-consistent (the seam, playoff arithmetic, ≤-team_count caps and
// the auction solvency floor all hold, sanity-pinned below so a broken
// composite fails HERE, not confusingly downstream).
// ---------------------------------------------------------------------------

/** Low edges: team_count 8, 12-week season → start 13, everything-at-min. */
function boundaryMin(): LeagueSettings {
  const s = defaultsForTeamCount(8)
  return {
    ...s,
    divisions: 1,
    regular_season_weeks: 12,
    playoff_start_week: 13, // = 12 + 1 (Q10 seam) — the 13 low edge
    playoff_teams: 8, // == team_count: the ≤-cap equality edge; 3 rounds × 1 wk → ends wk 15
    playoff_weeks_per_round: 1,
    roster_settings: {
      starting_slots: [{ key: 'qb', label: 'QB', eligible: ['QB'], count: 1 }], // sum 1 (min)
      bench: 0,
      ir_slots: [],
      swap_spots: 0,
    },
    waiver_type: 'faab',
    faab_budget: 0,
    faab_min_bid: 0,
    waiver_process_time: '00:00',
    waiver_period_hours: 0,
    acquisitions_per_week: 0,
    acquisitions_per_season: 0,
    fa_hold_hours: 0,
    trade_review: 'league_vote',
    trade_veto_votes: 1,
    trade_review_period_hours: 0,
    trade_deadline_week: 1,
    stat_correction_window: 0,
    draft: {
      ...s.draft,
      draft_type: 'auction', // solvency active: 50 ≥ 1-player roster × 0
      pick_timer_seconds: 0,
      auction_budget: 50,
      auction_min_bid: 0,
      auction_nomination_seconds: 10,
      auction_bid_seconds: 10,
      auction_anti_snipe_seconds: 0,
      disconnect_grace_seconds: 0,
    },
  }
}

/** High edges: team_count 16, 15-week season → start 16, everything-at-max. */
function boundaryMax(): LeagueSettings {
  const s = defaultsForTeamCount(16)
  return {
    ...s,
    divisions: 2,
    regular_season_weeks: 15,
    playoff_start_week: 16, // = 15 + 1 — the 16 high edge
    playoff_teams: 0, // points-only: the 0 literal edge (arithmetic bullet skipped, D60(5))
    playoff_weeks_per_round: 2,
    roster_settings: {
      starting_slots: [
        { key: 'qb', label: 'QB', eligible: ['QB'], count: 10 }, // per-slot max
        { key: 'flex', label: 'FLEX', eligible: ['WR', 'RB', 'TE'], count: 10 },
      ], // sum 20 (max)
      bench: 20,
      ir_slots: [
        { key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR', 'Doubtful', 'PUP', 'NFI', 'Suspended'] },
        { key: 'ir2', type: 'unrestricted', eligible_designations: ['OUT'] },
        { key: 'ir3', type: 'unrestricted', eligible_designations: ['IR'] },
        { key: 'ir4', type: 'unrestricted', eligible_designations: ['PUP'] },
        { key: 'r1', type: 'restricted', eligible_designations: ['OUT', 'IR'], min_weeks: 1 }, // min_weeks low edge
        { key: 'r17', type: 'restricted', eligible_designations: ['OUT', 'IR'], min_weeks: 17 }, // min_weeks high edge
      ], // 6 spots (max)
      swap_spots: 1,
    },
    waiver_type: 'faab',
    faab_budget: 1000,
    faab_min_bid: 10,
    waiver_process_time: '23:59',
    waiver_period_hours: 168,
    acquisitions_per_week: 50,
    acquisitions_per_season: 500,
    fa_hold_hours: 48,
    trade_review: 'league_vote',
    trade_veto_votes: 16, // == team_count: the ≤-cap equality edge
    trade_review_period_hours: 96,
    trade_deadline_week: 15, // == regular_season_weeks: the ≤-cap edge
    stat_correction_window: 168,
    draft: {
      ...s.draft,
      draft_type: 'auction', // solvency: 1000 ≥ 46-player roster × 5 = 230
      pick_timer_seconds: 86400,
      auction_budget: 1000,
      auction_min_bid: 5,
      auction_nomination_seconds: 120,
      auction_bid_seconds: 60,
      auction_anti_snipe_seconds: 15,
      disconnect_grace_seconds: 120,
    },
  }
}

/**
 * The §7.3.8 playoff-arithmetic EXACT edge: 12 playoff teams (the literal
 * max) → 4 rounds × 1 week from week 15 ends EXACTLY week 18 — accepted.
 */
function arithmeticEdge(): LeagueSettings {
  return {
    ...defaultsForTeamCount(12),
    regular_season_weeks: 14,
    playoff_start_week: 15,
    playoff_teams: 12,
    playoff_weeks_per_round: 1,
  }
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service
    .from('leagues')
    .select('id')
    .like('name', `${LEAGUE_NAME_PREFIX}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await deleteUserByUsername(CREATOR.username)
  await deleteUserByUsername(OUTSIDER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Read the settings the GET path serves (asserting 200). */
async function getSettings(leagueId: string): Promise<LeagueSettings> {
  const result = await getLeagueDetail(creatorClient, creatorId, leagueId)
  expect(result.status).toBe(200)
  return (result.body as { settings: LeagueSettings }).settings
}

/** Direct DB read of the §12.1 sync pair (the GET path doesn't expose it). */
async function readSyncPair(leagueId: string): Promise<{ team_count: number; max_teams: number }> {
  const { data } = await service
    .from('leagues')
    .select('team_count, max_teams')
    .eq('id', leagueId)
    .single()
  if (!data) throw new Error('league row missing')
  return data
}

async function createFixtureLeague(actionId: string, suffix: string): Promise<string> {
  const result = await createLeague(creatorClient, {
    name: `${LEAGUE_NAME_PREFIX}-${suffix}`,
    season: 2026,
    scoring_system_id: espnStandardId,
    team_name: `RT ${suffix}`,
    action_id: actionId,
    settings: defaultsForTeamCount(12),
  })
  if (result.status !== 201) {
    throw new Error(`fixture create failed (${result.status}): ${JSON.stringify(result.body)}`)
  }
  return (result.body as { league_id: string }).league_id
}

describe('settings PATCH round-trip + lifecycle (061 — local stack, PostgREST wire path)', () => {
  beforeAll(async () => {
    await cleanup()

    for (const user of [CREATOR, OUTSIDER]) {
      const { error } = await service.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { username: user.username },
      })
      if (error) throw new Error(`createUser(${user.email}) failed: ${error.message}`)
    }

    const { data: creatorProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', CREATOR.username)
      .single()
    if (!creatorProfile) throw new Error('creator profile missing')
    creatorId = creatorProfile.id

    const { data: templates } = await service
      .from('scoring_systems')
      .select('id, name')
      .eq('is_template', true)
      .in('name', ['ESPN Standard', 'Yahoo Standard'])
    espnStandardId = templates?.find((t) => t.name === 'ESPN Standard')?.id ?? ''
    yahooStandardId = templates?.find((t) => t.name === 'Yahoo Standard')?.id ?? ''
    if (!espnStandardId || !yahooStandardId) {
      throw new Error('scoring templates missing (is 058 applied?)')
    }

    const { data: outsiderProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', OUTSIDER.username)
      .single()
    if (!outsiderProfile) throw new Error('outsider profile missing')
    outsiderId = outsiderProfile.id

    // A PERSONAL (owner-scoped, non-template) scoring system — the §7.3.3
    // templates-only negative at the PATCH surface.
    const { data: personal, error: personalError } = await service
      .from('scoring_systems')
      .insert({
        owner_id: outsiderProfile.id,
        name: 'vitest-rt-personal-system',
        rules: { passing_yards: 0.05 },
      })
      .select('id')
      .single()
    if (personalError || !personal) {
      throw new Error(`personal scoring seed failed: ${personalError?.message}`)
    }
    personalScoringId = personal.id

    creatorClient = await signIn(CREATOR)
    outsiderClient = await signIn(OUTSIDER)

    rtLeagueId = await createFixtureLeague(ACTION.roundTrip, 'roundtrip')
    lifeLeagueId = await createFixtureLeague(ACTION.lifecycle, 'lifecycle')
    lockLeagueId = await createFixtureLeague(ACTION.locked, 'locked')
  }, 60_000)

  afterAll(async () => {
    await cleanup()
  })

  // -------------------------------------------------------------------------
  // A. Gate item 3 — the full §7.3 round-trip over the EXPORTED fixture
  // -------------------------------------------------------------------------

  describe('gate item 3: PATCH the exported §7.3 enumeration fixture, GET it back (golden, per field)', () => {
    let returned: LeagueSettings

    beforeAll(async () => {
      // ONE atomic PATCH: the full fixture + a DIFFERENT template than the
      // create used (ESPN → Yahoo — the §7.3.3 template-change round-trip).
      const patch = await patchLeague(creatorClient, rtLeagueId, {
        settings: ROUND_TRIP_SETTINGS,
        scoring_system_id: yahooStandardId,
      })
      expect(patch.status).toBe(200)
      returned = await getSettings(rtLeagueId)
    }, 30_000)

    // Per-field sweep over the fixture's own keys: every §7.3 field carries a
    // non-default in-range value (the fixture's pinned design rule), so a
    // field dropped anywhere in split → RPC → DB → merge falls back to its
    // default and fails EXACTLY its own test here (the DoD probe shows this).
    it.each(Object.keys(ROUND_TRIP_SETTINGS) as (keyof LeagueSettings)[])(
      'round-trips %s (golden vs the exported fixture)',
      (field) => {
        expect(returned[field]).toStrictEqual(ROUND_TRIP_SETTINGS[field])
      },
    )

    it('round-trips the WHOLE object (no extra/missing keys either)', () => {
      expect(returned).toStrictEqual(ROUND_TRIP_SETTINGS)
    })

    it('scoring_system_id round-trips the template change: GET returns the NEW template (§7.3.3)', async () => {
      const detail = await getLeagueDetail(creatorClient, creatorId, rtLeagueId)
      expect(detail.status).toBe(200)
      expect((detail.body as { league: { scoring_system_id: string } }).league.scoring_system_id).toBe(
        yahooStandardId,
      )
    })

    it('after the team_count PATCH a DIRECT DB read shows max_teams = team_count (§12.1 NOTE, second writer)', async () => {
      // Fixture team_count is 10; the league was created at 12 — this PATCH
      // CHANGED team_count, so the sync rule is what's under test.
      expect(await readSyncPair(rtLeagueId)).toStrictEqual({ team_count: 10, max_teams: 10 })
    })
  })

  // -------------------------------------------------------------------------
  // B. Boundary values for every ranged field (cross-field-consistent
  //    composites at both edges + the exact week-18 arithmetic edge)
  // -------------------------------------------------------------------------

  describe('ranged-field boundaries through the real PATCH path', () => {
    it('the boundary composites are cross-field-valid by construction (sanity — a broken composite fails HERE)', () => {
      expect(validateLeagueSettings(boundaryMin()).errors).toStrictEqual([])
      expect(validateLeagueSettings(boundaryMax()).errors).toStrictEqual([])
      expect(validateLeagueSettings(arithmeticEdge()).errors).toStrictEqual([])
    })

    it('LOW edges round-trip: team_count 8, 12-week season, start wk 13, all mins (incl. sum-1 roster, 0 bench/IR, faab 0)', async () => {
      const composite = boundaryMin()
      const patch = await patchLeague(creatorClient, rtLeagueId, { settings: composite })
      expect(patch.status).toBe(200)
      expect(await getSettings(rtLeagueId)).toStrictEqual(composite)
      expect(await readSyncPair(rtLeagueId)).toStrictEqual({ team_count: 8, max_teams: 8 })
    })

    it('HIGH edges round-trip: team_count 16, 15-week season, start wk 16, all maxes (incl. sum-20 roster, 6 IR, min_weeks 1+17)', async () => {
      const composite = boundaryMax()
      const patch = await patchLeague(creatorClient, rtLeagueId, { settings: composite })
      expect(patch.status).toBe(200)
      expect(await getSettings(rtLeagueId)).toStrictEqual(composite)
      expect(await readSyncPair(rtLeagueId)).toStrictEqual({ team_count: 16, max_teams: 16 })
    })

    it('playoff arithmetic EXACT edge: 12 playoff teams × 1-week rounds from wk 15 ends exactly wk 18 — accepted', async () => {
      const composite = arithmeticEdge()
      const patch = await patchLeague(creatorClient, rtLeagueId, { settings: composite })
      expect(patch.status).toBe(200)
      expect(await getSettings(rtLeagueId)).toStrictEqual(composite)
    })
  })

  // -------------------------------------------------------------------------
  // C. A rejected out-of-range case per §7.3 field group (+ no-write pins)
  // -------------------------------------------------------------------------

  describe('rejected out-of-range case per field group', () => {
    /** PATCH an (invalid) settings object; expect a 400 and NO write. */
    async function expectRejected(mutate: (s: LeagueSettings) => void): Promise<{ error: unknown }> {
      const before = await getSettings(rtLeagueId)
      const settings = arithmeticEdge()
      mutate(settings)
      const result = await patchLeague(
        creatorClient,
        rtLeagueId,
        // Cast: the mutations below deliberately produce out-of-range shapes.
        { settings: settings as unknown },
      )
      expect(result.status).toBe(400)
      expect(await getSettings(rtLeagueId)).toStrictEqual(before) // no-write pin
      return result.body as { error: unknown }
    }

    it('§7.3.1 structure — the Q10 seam pair (15+14) rejects per-field at the PATCH surface (the create-path regression trap, second exposure)', async () => {
      const body = (await expectRejected((s) => {
        s.regular_season_weeks = 15
        s.playoff_start_week = 14
      })) as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.playoff_start_week).toStrictEqual([
        'Playoffs must start the week after the regular season ends — week 16 for a 15-week regular season (currently week 14).',
      ])
    })

    it('§7.3.1 structure — one past the arithmetic edge: 12 playoff teams × 2-week rounds ends wk 22 > 18, rejected per-field', async () => {
      const body = (await expectRejected((s) => {
        s.playoff_weeks_per_round = 2
      })) as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.playoff_start_week?.[0]).toContain("past the NFL's week 18")
    })

    it('§7.3.2 roster — bench 21 (one past the max) rejects at the Zod layer', async () => {
      await expectRejected((s) => {
        s.roster_settings.bench = 21
      })
    })

    it('§7.3.4 waivers — faab_budget 1001 (one past the max) rejects at the Zod layer', async () => {
      await expectRejected((s) => {
        s.faab_budget = 1001
      })
    })

    it('§7.3.5 trades — trade_deadline_week past the regular season rejects per-field (cross-field cap)', async () => {
      const body = (await expectRejected((s) => {
        s.trade_deadline_week = 15 // schema-legal, but > the composite's 14-week season
      })) as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.trade_deadline_week?.[0]).toContain('inside the regular season')
    })

    it('§7.3.6 lineups — stat_correction_window 169 (one past 7 days) rejects at the Zod layer', async () => {
      await expectRejected((s) => {
        s.stat_correction_window = 169
      })
    })

    it('§7.3.7 tiebreakers — a duplicated chain entry rejects at the Zod layer', async () => {
      await expectRejected((s) => {
        s.tiebreakers = ['win_pct', 'win_pct', 'points_for']
      })
    })

    it('§7.3.8 draft — auction budget below the solvency floor rejects per-field', async () => {
      const body = (await expectRejected((s) => {
        s.draft.draft_type = 'auction'
        s.draft.auction_budget = 50
        s.draft.auction_min_bid = 5 // 16-player default roster × 5 = 80 > 50
      })) as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors['draft.auction_budget']?.[0]).toContain("can't fill")
    })
  })

  // -------------------------------------------------------------------------
  // C1b. F28 shrink floor — the SERVICE-LEVEL mapping (batch-14 R84).
  //      061's banner and F28's ledger row both attested a `team_count`
  //      marker in PATCH_FIELD_ERRORS that had never been added, so the
  //      floor's refusal fell through to the flat `{error: <raw message>}`
  //      fallback, shipping the RPC name and a spec-section citation to the
  //      client and giving L.A2.4 nothing to render per-field. Nothing pinned
  //      the mapping in either direction, which is why the suite was green.
  //      Drop the marker and the first test below fails on the body shape.
  // -------------------------------------------------------------------------

  describe('F28 shrink floor maps to a per-field 400 (R84)', () => {
    let floorLeagueId: string

    beforeAll(async () => {
      floorLeagueId = await createFixtureLeague(ACTION.floor, 'floor')
      // Seat 9 more franchises (creation seats 1) → 10 seated, team_count 12.
      // Privileged fixture: L.A1.15's placeholder-seat RPC doesn't exist yet.
      const rows = Array.from({ length: 9 }, (_, i) => ({
        owner_id: creatorId,
        name: `vitest-rt-floor-filler-${i}`,
        league_id: floorLeagueId,
        list_id: null,
      }))
      const { error } = await service.from('teams').insert(rows)
      if (error) throw new Error(`floor fillers failed: ${error.message}`)
    }, 30_000)

    it('shrinking team_count BELOW the seated count → 400 with fieldErrors.team_count (never a flat error string), no write', async () => {
      const before = await getSettings(floorLeagueId)
      const result = await patchLeague(creatorClient, floorLeagueId, {
        settings: { ...defaultsForTeamCount(8), regular_season_weeks: 14, playoff_start_week: 15 },
      })
      expect(result.status).toBe(400)
      const body = result.body as { error: { fieldErrors?: Record<string, string[]> } }
      expect(body.error.fieldErrors?.team_count?.[0]).toContain(
        'is below the 10 franchises already seated',
      )
      expect(await getSettings(floorLeagueId)).toStrictEqual(before) // no-write pin
      expect(await readSyncPair(floorLeagueId)).toStrictEqual({ team_count: 12, max_teams: 12 })
    })

    it('shrinking to EXACTLY the seated count succeeds through the same path — the marker cannot be a blanket team_count refusal', async () => {
      const result = await patchLeague(creatorClient, floorLeagueId, {
        settings: { ...defaultsForTeamCount(10), regular_season_weeks: 14, playoff_start_week: 15 },
      })
      expect(result.status).toBe(200)
      expect(await readSyncPair(floorLeagueId)).toStrictEqual({ team_count: 10, max_teams: 10 })
    })
  })

  // -------------------------------------------------------------------------
  // C2. R79 regression trap — PARTIAL settings bodies merge over CURRENT
  //     (D71). Before D71, every leagueSettingsSchema field default-filled,
  //     so the one-key body below silently reset the whole surface to
  //     catalog defaults (team_count 14→12, faab_budget 777→100 re-seeded to
  //     every seat, draft_scheduled_at NULLED while status stayed
  //     'scheduled'). This block IS the trap: revert the merge and the first
  //     test fails on exactly those casualties.
  // -------------------------------------------------------------------------

  describe('R79 regression trap: a partial settings body merges over CURRENT — never default-resets (D71)', () => {
    let partialLeagueId: string
    let before: LeagueSettings

    beforeAll(async () => {
      // The exact R79 probe state: a SCHEDULED league at non-default
      // team_count 14 / faab_budget 777 with a draft instant set.
      const s = defaultsForTeamCount(14)
      s.faab_budget = 777
      s.draft.draft_scheduled_at = '2026-09-03T00:00:00.000Z'
      const result = await createLeague(creatorClient, {
        name: `${LEAGUE_NAME_PREFIX}-partial`,
        season: 2026,
        scoring_system_id: espnStandardId,
        action_id: ACTION.partial,
        settings: s,
      })
      if (result.status !== 201) {
        throw new Error(`partial fixture create failed (${result.status}): ${JSON.stringify(result.body)}`)
      }
      partialLeagueId = (result.body as { league_id: string }).league_id
      const schedule = await patchLeague(creatorClient, partialLeagueId, { status: 'scheduled' })
      if (schedule.status !== 200) {
        throw new Error(`partial fixture schedule failed (${schedule.status}): ${JSON.stringify(schedule.body)}`)
      }
      before = await getSettings(partialLeagueId)
    }, 30_000)

    it('the exact R79 probe — {settings:{median_game:true}} — changes ONLY median_game; team_count/faab/draft instant survive', async () => {
      const result = await patchLeague(creatorClient, partialLeagueId, {
        settings: { median_game: true },
      })
      expect(result.status).toBe(200)
      const after = await getSettings(partialLeagueId)
      expect(after).toStrictEqual({ ...before, median_game: true }) // the WHOLE surface, exactly one delta
      // The three R79 casualties, pinned by name:
      expect(after.team_count).toBe(14)
      expect(after.faab_budget).toBe(777)
      expect(after.draft.draft_scheduled_at).toBe('2026-09-03T00:00:00.000Z')
      expect(await readSyncPair(partialLeagueId)).toStrictEqual({ team_count: 14, max_teams: 14 })
      const { data: league } = await service
        .from('leagues')
        .select('status')
        .eq('id', partialLeagueId)
        .single()
      expect(league?.status).toBe('scheduled')
      // Budget unchanged ⇒ the §12.2 re-seed must NOT ripple: the seat keeps 777.
      const { data: members } = await service
        .from('league_members')
        .select('faab_balance')
        .eq('league_id', partialLeagueId)
      expect(members?.map((m) => m.faab_balance)).toStrictEqual([777])
      before = after
    })

    it('a nested one-key body merges INSIDE the draft block — draft_scheduled_at and the rest survive', async () => {
      const result = await patchLeague(creatorClient, partialLeagueId, {
        settings: { draft: { pick_timer_seconds: 60 } },
      })
      expect(result.status).toBe(200)
      const after = await getSettings(partialLeagueId)
      expect(after).toStrictEqual({ ...before, draft: { ...before.draft, pick_timer_seconds: 60 } })
      before = after
    })

    it('cross-field rules run against the MERGED WHOLE: a one-key body breaking the Q10 seam rejects per-field, no write', async () => {
      // current: 14-week season, start 15. regular_season_weeks alone → 15+15
      // violates the seam AFTER the merge — only whole-object validation sees it.
      const result = await patchLeague(creatorClient, partialLeagueId, {
        settings: { regular_season_weeks: 15 },
      })
      expect(result.status).toBe(400)
      const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.playoff_start_week?.[0]).toContain(
        'Playoffs must start the week after the regular season ends',
      )
      expect(await getSettings(partialLeagueId)).toStrictEqual(before)
    })

    it('unknown keys in a partial body reject at the post-merge strict parse — top-level and nested, no write', async () => {
      expect(
        (await patchLeague(creatorClient, partialLeagueId, { settings: { not_a_setting: 1 } })).status,
      ).toBe(400)
      expect(
        (await patchLeague(creatorClient, partialLeagueId, { settings: { draft: { bogus: 1 } } })).status,
      ).toBe(400)
      expect(await getSettings(partialLeagueId)).toStrictEqual(before)
    })

    it('a FULL object still merges to itself — the sanctioned full-object round-trip is unchanged', async () => {
      const composite = arithmeticEdge()
      composite.draft.draft_scheduled_at = '2026-09-03T00:00:00.000Z'
      const result = await patchLeague(creatorClient, partialLeagueId, { settings: composite })
      expect(result.status).toBe(200)
      expect(await getSettings(partialLeagueId)).toStrictEqual(composite)
    })
  })

  // -------------------------------------------------------------------------
  // D. §7.3.3 templates-only at the PATCH surface + the scoring-only path
  // -------------------------------------------------------------------------

  describe('scoring_system_id PATCH path', () => {
    it('REJECTS a personal (owner-scoped, non-template) scoring system — per-field 400, scoring reference unchanged', async () => {
      const result = await patchLeague(creatorClient, rtLeagueId, {
        scoring_system_id: personalScoringId,
      })
      expect(result.status).toBe(400)
      const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.scoring_system_id?.[0]).toContain(
        'personal scoring systems cannot be attached to a league in v1',
      )
      const { data } = await service
        .from('leagues')
        .select('scoring_system_id')
        .eq('id', rtLeagueId)
        .single()
      expect(data?.scoring_system_id).toBe(yahooStandardId) // no-write pin
    })

    it('a scoring-ONLY PATCH succeeds (full surface re-written from the CURRENT stored settings) and leaves settings untouched', async () => {
      const before = await getSettings(rtLeagueId)
      const result = await patchLeague(creatorClient, rtLeagueId, {
        scoring_system_id: espnStandardId,
      })
      expect(result.status).toBe(200)
      const { data } = await service
        .from('leagues')
        .select('scoring_system_id')
        .eq('id', rtLeagueId)
        .single()
      expect(data?.scoring_system_id).toBe(espnStandardId)
      expect(await getSettings(rtLeagueId)).toStrictEqual(before)
    })
  })

  // -------------------------------------------------------------------------
  // E. Reach-`scheduled` integration (task item 3 — this route is the
  //    enforcement point for settings validity on the scheduled transition)
  // -------------------------------------------------------------------------

  describe('lifecycle: setup → scheduled → setup', () => {
    it('scheduling WITHOUT draft_scheduled_at → clear per-field 400; status stays setup', async () => {
      const result = await patchLeague(creatorClient, lifeLeagueId, { status: 'scheduled' })
      expect(result.status).toBe(400)
      const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors['draft.draft_scheduled_at']?.[0]).toContain(
        'settings.draft.draft_scheduled_at is not set',
      )
      const { data } = await service.from('leagues').select('status').eq('id', lifeLeagueId).single()
      expect(data?.status).toBe('setup')
    })

    it('scheduling with INVALID stored settings → the ROUTE-level validator refuses per-field BEFORE the RPC (the enforcement point)', async () => {
      // Privileged corruption: break the Q10 seam directly (bypassing the
      // RPC path — exactly what the enforcement point must catch, since every
      // sanctioned writer validates on the way in).
      await service.from('leagues').update({ regular_season_weeks: 15 }).eq('id', lifeLeagueId)

      const result = await patchLeague(creatorClient, lifeLeagueId, { status: 'scheduled' })
      expect(result.status).toBe(400)
      const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
      expect(body.error.fieldErrors.playoff_start_week?.[0]).toContain(
        'Playoffs must start the week after the regular season ends',
      )
      const { data } = await service.from('leagues').select('status').eq('id', lifeLeagueId).single()
      expect(data?.status).toBe('setup')

      await service.from('leagues').update({ regular_season_weeks: 14 }).eq('id', lifeLeagueId) // restore
    })

    it('valid settings + draft_scheduled_at → scheduled works; back to setup works; settings stay editable while scheduled', async () => {
      // 1. Set the draft instant through the sanctioned PATCH path.
      const settings = defaultsForTeamCount(12)
      settings.draft.draft_scheduled_at = '2026-09-01T00:00:00.000Z'
      const settle = await patchLeague(creatorClient, lifeLeagueId, { settings })
      expect(settle.status).toBe(200)

      // 2. setup → scheduled.
      const schedule = await patchLeague(creatorClient, lifeLeagueId, { status: 'scheduled' })
      expect(schedule.status).toBe(200)
      expect(schedule.body).toStrictEqual({ ok: true, status: 'scheduled' })
      let { data } = await service.from('leagues').select('status').eq('id', lifeLeagueId).single()
      expect(data?.status).toBe('scheduled')

      // 3. Settings remain editable in scheduled (§7.3 header names BOTH
      //    states) — and the §12.2 re-seed follows a budget change here too.
      const edited = defaultsForTeamCount(12)
      edited.draft.draft_scheduled_at = '2026-09-01T00:00:00.000Z'
      edited.faab_budget = 300
      const edit = await patchLeague(creatorClient, lifeLeagueId, { settings: edited })
      expect(edit.status).toBe(200)
      const { data: member } = await service
        .from('league_members')
        .select('faab_balance')
        .eq('league_id', lifeLeagueId)
      expect(member?.map((m) => m.faab_balance)).toStrictEqual([300]) // §12.2 re-seed (D70)

      // 4. scheduled → setup (backward within M1's two states is legal).
      const unschedule = await patchLeague(creatorClient, lifeLeagueId, { status: 'setup' })
      expect(unschedule.status).toBe(200)
      ;({ data } = await service.from('leagues').select('status').eq('id', lifeLeagueId).single())
      expect(data?.status).toBe('setup')
    }, 30_000)

    it('the wire shape is strict: empty body, combined status+settings, non-M1 statuses, and top-level unknown keys all 400 at the Zod layer', async () => {
      expect((await patchLeague(creatorClient, lifeLeagueId, {})).status).toBe(400)
      expect(
        (
          await patchLeague(creatorClient, lifeLeagueId, {
            status: 'scheduled',
            settings: defaultsForTeamCount(12),
          })
        ).status,
      ).toBe(400)
      expect((await patchLeague(creatorClient, lifeLeagueId, { status: 'drafting' })).status).toBe(400)
      // R82 — the R77 class at the PATCH surface: a top-level unknown key
      // REJECTS even alongside a valid key (a plain z.object would strip it
      // and this call would 200 — the pin discriminates strictObject).
      expect(
        (
          await patchLeague(creatorClient, lifeLeagueId, {
            settings: { median_game: false },
            bogus_top_level: true,
          })
        ).status,
      ).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // F. The §7.3-header lock: post-setup/scheduled states refuse with 409
  // -------------------------------------------------------------------------

  describe('status-locked league (drafting)', () => {
    beforeAll(async () => {
      // Privileged forcing (the pgTAP 015 pattern): satisfy the D43 snapshot
      // guard, then move the league into M2 territory.
      const { error } = await service
        .from('leagues')
        .update({ scoring_rules_snapshot: { receptions: 1 }, status: 'drafting' })
        .eq('id', lockLeagueId)
      if (error) throw new Error(`forcing drafting failed: ${error.message}`)
    })

    it('a settings PATCH on a drafting league → clear 409 (settings locked once the draft starts; M6 owns overrides)', async () => {
      const result = await patchLeague(creatorClient, lockLeagueId, {
        settings: defaultsForTeamCount(12),
      })
      expect(result.status).toBe(409)
      expect((result.body as { error: string }).error).toContain(
        'settings are locked once the draft starts',
      )
    })

    it('a status PATCH on a drafting league → clear 409 (draft/season transitions belong to the M2 engine)', async () => {
      const result = await patchLeague(creatorClient, lockLeagueId, { status: 'setup' })
      expect(result.status).toBe(409)
      expect((result.body as { error: string }).error).toContain(
        'transitions from draft/season states',
      )
    })
  })

  // -------------------------------------------------------------------------
  // G. AuthZ at the service surface
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    // D71 note: the settings path now reads the CURRENT settings first (the
    // merge base), so an RLS-INVISIBLE league uniformly 404s — matching the
    // status path and GET detail, and fixing the pre-D71 inconsistency where
    // a scoring-only PATCH already 404'd while a settings PATCH 403'd. A
    // MEMBER who is not commissioner still gets the RPC's 42501 → 403.
    it('a NON-MEMBER settings PATCH → 404 (RLS-invisible, D71 read-first), no write', async () => {
      const before = await getSettings(rtLeagueId)
      const result = await patchLeague(outsiderClient, rtLeagueId, {
        settings: defaultsForTeamCount(12),
      })
      expect(result.status).toBe(404)
      expect(await getSettings(rtLeagueId)).toStrictEqual(before)
    })

    it('a MEMBER who is not commissioner → 403 (RPC 42501), no write', async () => {
      // Privileged seat: real-user membership is RPC-only until L.A1.14 —
      // the service role seats the outsider directly (the pgTAP forcing
      // pattern), removed again in the finally.
      const { error } = await service
        .from('league_members')
        .insert({ league_id: rtLeagueId, user_id: outsiderId, role: 'manager' })
      if (error) throw new Error(`privileged seat failed: ${error.message}`)
      try {
        const before = await getSettings(rtLeagueId)
        const result = await patchLeague(outsiderClient, rtLeagueId, {
          settings: { median_game: true },
        })
        expect(result.status).toBe(403)
        expect(await getSettings(rtLeagueId)).toStrictEqual(before)
      } finally {
        await service
          .from('league_members')
          .delete()
          .eq('league_id', rtLeagueId)
          .eq('user_id', outsiderId)
      }
    })

    it('a settings PATCH on a NONEXISTENT league → the same 404 (non-member and nonexistent stay indistinguishable — no existence leak)', async () => {
      const result = await patchLeague(creatorClient, 'ea200000-0000-4000-8000-00000000dead', {
        settings: defaultsForTeamCount(12),
      })
      expect(result.status).toBe(404)
    })

    it('a status PATCH on a NONEXISTENT league → 404 (RLS-invisible, indistinguishable from non-membership)', async () => {
      const result = await patchLeague(creatorClient, 'ea200000-0000-4000-8000-00000000dead', {
        status: 'scheduled',
      })
      expect(result.status).toBe(404)
    })
  })

  // -------------------------------------------------------------------------
  // H. The L.A1.6 hand-off: 040's roster_settings column DEFAULT ≡ the TS
  //    DEFAULT_ROSTER_SETTINGS literal (tasks-M1 L.A1.6 item 3, named for
  //    "L.A1.13's integration suite")
  // -------------------------------------------------------------------------

  it('a freshly-defaulted leagues row carries roster_settings deep-equal to DEFAULT_ROSTER_SETTINGS (040 DEFAULT ≡ TS)', async () => {
    const { data, error } = await service
      .from('leagues')
      .insert({ name: `${LEAGUE_NAME_PREFIX}-default-row`, season: 2026, owner_id: creatorId })
      .select('roster_settings')
      .single()
    if (error || !data) throw new Error(`defaulted insert failed: ${error?.message}`)
    expect(data.roster_settings).toStrictEqual(DEFAULT_ROSTER_SETTINGS)
  })
})
