/**
 * L.A1.6 — schema + defaults tests (§4.3 falsifiability floor):
 *  - defaults validate clean; `parse({})` ≡ LEAGUE_SETTINGS_DEFAULTS
 *  - GOLDEN PIN: the full default object's serialization vs a STORED literal
 *  - the roster portion ≡ the SAME JSON literal pgTAP 005 pins for 040's
 *    `roster_settings` DEFAULT (extracted from the checked-in pgTAP file —
 *    the D30(2) parse-the-artifact pattern — so drift in EITHER home fails)
 *  - every range boundary at the edge and one past it (schema level)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROSTER_SETTINGS,
  defaultsForTeamCount,
  deriveDefaultVetoVotes,
  DL_PRESET,
  LEAGUE_SETTINGS_DEFAULTS,
  leagueSettingsSchema,
  validateLeagueSettings,
} from './league-settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone the defaults and set one dot-path (arrays indexed numerically). */
function withPatch(path: string, value: unknown): unknown {
  const clone = structuredClone(LEAGUE_SETTINGS_DEFAULTS) as Record<string, unknown>
  const segments = path.split('.')
  let node: Record<string, unknown> = clone
  for (const seg of segments.slice(0, -1)) {
    node = node[seg] as Record<string, unknown>
  }
  node[segments[segments.length - 1]] = value
  return clone
}

function parses(candidate: unknown): boolean {
  return leagueSettingsSchema.safeParse(candidate).success
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('LEAGUE_SETTINGS_DEFAULTS (§7.3 "D" columns)', () => {
  it('validates clean — zero errors, zero warnings', () => {
    const result = validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS)
    expect(result.errors).toStrictEqual([])
    expect(result.warnings).toStrictEqual([])
    expect(result.valid).toBe(true)
  })

  it('parse({}) fills every default — creation from an empty object ≡ the defaults', () => {
    expect(leagueSettingsSchema.parse({})).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('parse(defaults) is identity (no default rewrites a present field)', () => {
    expect(leagueSettingsSchema.parse(structuredClone(LEAGUE_SETTINGS_DEFAULTS))).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  // GOLDEN PIN (§4.3a): the serialization of the full default object against
  // a STORED literal — not recomputed. Flipping ANY §7.3 default fails here.
  it('golden pin: full default object serialization matches the stored literal', () => {
    const pinned =
      '{"format":"redraft","team_count":12,"divisions":1,"regular_season_weeks":14,"playoff_teams":6,"playoff_start_week":15,"playoff_weeks_per_round":1,"playoff_byes":"auto","playoff_reseed":true,"consolation_bracket":false,"third_place_game":false,"schedule_mode":"h2h","median_game":false,"second_opponent":false,"roster_settings":{"starting_slots":[{"key":"qb","label":"QB","eligible":["QB"],"count":1},{"key":"rb","label":"RB","eligible":["RB"],"count":2},{"key":"wr","label":"WR","eligible":["WR"],"count":2},{"key":"te","label":"TE","eligible":["TE"],"count":1},{"key":"flex","label":"FLEX (W/R/T)","eligible":["WR","RB","TE"],"count":1},{"key":"k","label":"K","eligible":["K"],"count":1},{"key":"dst","label":"D/ST","eligible":["DST"],"count":1}],"bench":6,"ir_slots":[{"key":"ir1","type":"unrestricted","eligible_designations":["OUT","IR"]}],"swap_spots":0},"waiver_type":"faab","faab_budget":100,"faab_min_bid":0,"faab_tiebreaker":"reverse_standings","waiver_process_day":"wed","waiver_process_time":"03:00","waiver_period_hours":48,"free_agency":"immediate_after_waivers","acquisitions_per_week":"unlimited","acquisitions_per_season":"unlimited","player_game_lock":true,"bench_lock":true,"fa_hold_hours":0,"trade_review":"commissioner","trade_veto_votes":6,"trade_review_period_hours":24,"trade_deadline_week":11,"allow_faab_in_trades":false,"allow_future_considerations":false,"trade_lock_behavior":"defer","lineup_lock":"per_player_kickoff","allow_illegal_lineups":true,"auto_sub_inactives":false,"stat_correction_window":"thu_06_00_et","tiebreakers":["win_pct","points_for","head_to_head","points_against","division_record","coin_flip"],"draft":{"draft_type":"snake","snake_reversal":false,"draft_order_mode":"random","draft_order":null,"pick_timer_seconds":90,"auction_budget":200,"auction_zero_dollar_nominations":false,"auction_nomination_seconds":30,"auction_bid_seconds":20,"auction_anti_snipe_seconds":10,"nomination_order_mode":"same_as_draft_order","nomination_order":null,"autopick_default":"queue_then_board_then_adp","disconnect_grace_seconds":30,"draft_scheduled_at":null,"time_zone":null}}'
    expect(JSON.stringify(LEAGUE_SETTINGS_DEFAULTS)).toBe(pinned)
  })

  it('the roster portion ≡ the JSON literal pgTAP 005 pins for 040’s DEFAULT (C9)', () => {
    const pgtapSql = readFileSync(join(process.cwd(), 'supabase/tests/005_leagues_settings_columns.sql'), 'utf8')
    // The pin is the single-quoted JSON literal cast to ::jsonb in the
    // roster_settings golden-pin assertion.
    const match = pgtapSql.match(/'(\{"starting_slots"[\s\S]*?\})'::jsonb/)
    expect(match, 'pgTAP 005 must contain the roster_settings ::jsonb golden-pin literal').not.toBeNull()
    const pgtapLiteral: unknown = JSON.parse((match as RegExpMatchArray)[1])
    expect(LEAGUE_SETTINGS_DEFAULTS.roster_settings).toStrictEqual(pgtapLiteral)
    expect(DEFAULT_ROSTER_SETTINGS).toStrictEqual(pgtapLiteral)
  })

  it('DL preset (§7.3.2): restricted, OUT/IR/Doubtful, min_weeks 4, label "DL"', () => {
    expect(DL_PRESET).toStrictEqual({
      label: 'DL',
      type: 'restricted',
      eligible_designations: ['OUT', 'IR', 'Doubtful'],
      min_weeks: 4,
    })
  })

  it('tiebreaker chain default is the §7.3.7 ruled order', () => {
    expect(LEAGUE_SETTINGS_DEFAULTS.tiebreakers).toStrictEqual([
      'win_pct',
      'points_for',
      'head_to_head',
      'points_against',
      'division_record',
      'coin_flip',
    ])
  })

  it('trade_veto_votes default = ⌈team_count/2⌉ at the default 12', () => {
    expect(LEAGUE_SETTINGS_DEFAULTS.trade_veto_votes).toBe(Math.ceil(LEAGUE_SETTINGS_DEFAULTS.team_count / 2))
    // …and the schema default IS the derivation, not a coincidentally-equal constant (R63)
    expect(LEAGUE_SETTINGS_DEFAULTS.trade_veto_votes).toBe(deriveDefaultVetoVotes(LEAGUE_SETTINGS_DEFAULTS.team_count))
  })
})

// ---------------------------------------------------------------------------
// §7.3.5 derived default — trade_veto_votes = ⌈team_count/2⌉ (R63)
// ---------------------------------------------------------------------------

describe('deriveDefaultVetoVotes / defaultsForTeamCount (§7.3.5 D column, R63)', () => {
  it('golden pins (stored literals): every v1 team_count, incl. the 8 and 16 edges', () => {
    expect(deriveDefaultVetoVotes(8)).toBe(4)
    expect(deriveDefaultVetoVotes(10)).toBe(5)
    expect(deriveDefaultVetoVotes(12)).toBe(6)
    expect(deriveDefaultVetoVotes(14)).toBe(7)
    expect(deriveDefaultVetoVotes(16)).toBe(8)
  })

  it('the formula is the CEILING, not floor/half — odd counts pin it (v1 counts are all even; §7.3.5 prints ⌈/2⌉)', () => {
    expect(deriveDefaultVetoVotes(9)).toBe(5)
    expect(deriveDefaultVetoVotes(13)).toBe(7)
  })

  it('defaultsForTeamCount(12) ≡ LEAGUE_SETTINGS_DEFAULTS (identity at the default count)', () => {
    expect(defaultsForTeamCount(12)).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('golden pin: defaultsForTeamCount(8) → veto 4; nothing else differs from the defaults', () => {
    const d8 = defaultsForTeamCount(8)
    expect(d8.team_count).toBe(8)
    expect(d8.trade_veto_votes).toBe(4)
    expect({ ...d8, team_count: 12, trade_veto_votes: 6 }).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('golden pin: defaultsForTeamCount(16) → veto 8', () => {
    const d16 = defaultsForTeamCount(16)
    expect(d16.team_count).toBe(16)
    expect(d16.trade_veto_votes).toBe(8)
  })

  it('every v1 count validates clean through defaultsForTeamCount — the R63 drift (static 6 at non-12 counts) is unconstructible via the sanctioned path', () => {
    for (const count of [8, 10, 12, 14, 16] as const) {
      const derived = defaultsForTeamCount(count)
      expect(derived.trade_veto_votes).toBe(deriveDefaultVetoVotes(count))
      const result = validateLeagueSettings(derived)
      expect(result.errors).toStrictEqual([])
      expect(result.valid).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Range boundaries — edge accepted, one past rejected (§4.3b)
// ---------------------------------------------------------------------------

interface RangeCase {
  path: string
  ok: unknown[]
  bad: unknown[]
}

const RANGE_CASES: RangeCase[] = [
  // §7.3.1
  { path: 'team_count', ok: [8, 16], bad: [7, 9, 18, 6] },
  { path: 'divisions', ok: [1, 2], bad: [0, 3] },
  { path: 'regular_season_weeks', ok: [12, 15], bad: [11, 16] },
  { path: 'playoff_teams', ok: [0, 2, 12], bad: [1, 3, 14, -2] },
  { path: 'playoff_start_week', ok: [13, 16], bad: [12, 17] }, // R 13–16 (v2.8.6/Q10 erratum); 17 rejected at parse = the old gap pair 12+17 is schema-unrepresentable
  { path: 'playoff_weeks_per_round', ok: [1, 2], bad: [0, 3] },
  { path: 'playoff_byes', ok: ['auto'], bad: ['manual', 0] },
  { path: 'format', ok: ['redraft'], bad: ['keeper', 'dynasty', 'best_ball'] },
  { path: 'schedule_mode', ok: ['h2h', 'total_points'], bad: ['points'] },
  // §7.3.2 (via roster_settings)
  { path: 'roster_settings.bench', ok: [0, 20], bad: [-1, 21, 6.5] },
  { path: 'roster_settings.swap_spots', ok: [0, 1], bad: [2, -1, true] },
  { path: 'roster_settings.starting_slots.0.count', ok: [0, 10], bad: [-1, 11, 0.5] },
  // §7.3.4
  { path: 'waiver_type', ok: ['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs'], bad: ['waivers'] },
  { path: 'faab_budget', ok: [0, 1000], bad: [-1, 1001] },
  { path: 'faab_min_bid', ok: [0, 10], bad: [-1, 11] },
  { path: 'faab_tiebreaker', ok: ['reverse_standings', 'rolling_priority'], bad: ['coin_flip'] },
  { path: 'waiver_process_day', ok: ['tue', 'wed', 'thu'], bad: ['fri', 'mon'] },
  { path: 'waiver_process_time', ok: ['00:00', '23:59', '03:00'], bad: ['24:00', '3:00', '03:60', ''] },
  { path: 'waiver_period_hours', ok: [0, 168], bad: [-1, 169] },
  { path: 'free_agency', ok: ['immediate_after_waivers', 'continuous'], bad: ['immediate'] },
  { path: 'acquisitions_per_week', ok: ['unlimited', 0, 50], bad: [-1, 51, 'none'] },
  { path: 'acquisitions_per_season', ok: ['unlimited', 0, 500], bad: [-1, 501] },
  { path: 'fa_hold_hours', ok: [0, 48], bad: [-1, 49] },
  // §7.3.5
  { path: 'trade_review', ok: ['none', 'commissioner', 'league_vote'], bad: ['vote'] },
  { path: 'trade_veto_votes', ok: [1, 16], bad: [0, 17] },
  { path: 'trade_review_period_hours', ok: [0, 96], bad: [-1, 97] },
  { path: 'trade_deadline_week', ok: [null, 1, 15], bad: [0, 16, 'none'] },
  // §7.3.6
  { path: 'lineup_lock', ok: ['per_player_kickoff', 'first_game_of_week'], bad: ['kickoff'] },
  { path: 'stat_correction_window', ok: ['thu_06_00_et', 0, 168], bad: [-1, 169, 'friday'] },
  // §7.3.8 draft block
  { path: 'draft.draft_type', ok: ['snake', 'auction', 'linear'], bad: ['serpentine'] },
  { path: 'draft.draft_order_mode', ok: ['random', 'manual', 'custom'], bad: ['fixed'] },
  { path: 'draft.pick_timer_seconds', ok: [0, 30, 86400], bad: [15, 100000, -30, 91] },
  { path: 'draft.auction_budget', ok: [50, 1000], bad: [49, 1001] },
  // 092/AP.1 (§7.3.8 v2.13): `auction_min_bid` is RETIRED. The toggle that
  // replaced it is a boolean, so its whole domain is the two `ok` values and
  // everything else is `bad` — including the numbers the old field accepted,
  // which is what stops a stale client silently re-sending one.
  { path: 'draft.auction_zero_dollar_nominations', ok: [true, false], bad: [0, 1, 'true', null] },
  { path: 'draft.auction_nomination_seconds', ok: [10, 120], bad: [9, 121] },
  { path: 'draft.auction_bid_seconds', ok: [10, 60], bad: [9, 61] },
  { path: 'draft.auction_anti_snipe_seconds', ok: [0, 15], bad: [-1, 16] },
  { path: 'draft.nomination_order_mode', ok: ['same_as_draft_order', 'random', 'manual'], bad: ['snake'] },
  { path: 'draft.autopick_default', ok: ['queue_then_board_then_adp'], bad: ['adp_only'] },
  { path: 'draft.disconnect_grace_seconds', ok: [0, 120], bad: [-1, 121] },
  {
    path: 'draft.draft_scheduled_at',
    ok: [null, '2026-08-30T23:00:00.000Z', '2026-08-30T19:00:00-04:00'],
    bad: ['2026-08-30', 'tonight', 1756594800000],
  },
  {
    // D98 (v2.9.2): IANA zone name or null — validity probed through Intl
    // itself (`isIanaTimeZone`), so junk names and non-strings refuse.
    // R276 (M2 batch 15): Intl also accepts ECMA-402 offset strings
    // ('+05:00') and legacy no-slash names ('EST'), which are not "a valid
    // IANA zone name" per §7.3.8 — the strict arm requires a '/' with
    // UTC/GMT allowlisted, so those refuse too (D120(11)).
    path: 'draft.time_zone',
    ok: [null, 'America/New_York', 'America/Los_Angeles', 'UTC', 'GMT'],
    bad: ['Not/AZone', 'Eastern', 'EST', '+05:00', '-08:00', '', 240],
  },
]

describe('range boundaries: edge accepted, one past rejected (schema)', () => {
  for (const { path, ok, bad } of RANGE_CASES) {
    it(`${path}: accepts ${JSON.stringify(ok)}, rejects ${JSON.stringify(bad)}`, () => {
      for (const value of ok) {
        expect(parses(withPatch(path, value)), `${path} = ${JSON.stringify(value)} should parse`).toBe(true)
      }
      for (const value of bad) {
        expect(parses(withPatch(path, value)), `${path} = ${JSON.stringify(value)} should NOT parse`).toBe(false)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Structural strictness
// ---------------------------------------------------------------------------

describe('structural strictness', () => {
  it('unknown top-level keys are rejected (strict catalog — typos fail loudly)', () => {
    expect(parses({ ...structuredClone(LEAGUE_SETTINGS_DEFAULTS), keeper_rounds: 3 })).toBe(false)
  })

  it('unknown roster keys are rejected', () => {
    expect(parses(withPatch('roster_settings.taxi_squad', 2))).toBe(false)
  })

  it('min_weeks on an UNRESTRICTED IR spot is rejected (restricted-only field)', () => {
    expect(
      parses(
        withPatch('roster_settings.ir_slots', [
          { key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'], min_weeks: 4 },
        ]),
      ),
    ).toBe(false)
  })

  it('restricted min_weeks: 1 and 17 accepted, 0 and 18 rejected; omitted → defaults to 4', () => {
    const restricted = (weeks?: number) => [
      { key: 'dl1', type: 'restricted', eligible_designations: ['OUT'], ...(weeks === undefined ? {} : { min_weeks: weeks }) },
    ]
    expect(parses(withPatch('roster_settings.ir_slots', restricted(1)))).toBe(true)
    expect(parses(withPatch('roster_settings.ir_slots', restricted(17)))).toBe(true)
    expect(parses(withPatch('roster_settings.ir_slots', restricted(0)))).toBe(false)
    expect(parses(withPatch('roster_settings.ir_slots', restricted(18)))).toBe(false)
    const parsed = leagueSettingsSchema.parse(withPatch('roster_settings.ir_slots', restricted()))
    expect(parsed.roster_settings.ir_slots[0]).toStrictEqual({
      key: 'dl1',
      type: 'restricted',
      eligible_designations: ['OUT'],
      min_weeks: 4,
    })
  })

  it('7 IR spots are rejected at the schema (0–6 range), 6 accepted', () => {
    const spot = (i: number) => ({ key: `ir${i}`, type: 'unrestricted', eligible_designations: ['OUT'] })
    expect(parses(withPatch('roster_settings.ir_slots', [1, 2, 3, 4, 5, 6].map(spot)))).toBe(true)
    expect(parses(withPatch('roster_settings.ir_slots', [1, 2, 3, 4, 5, 6, 7].map(spot)))).toBe(false)
  })

  it('empty eligible set and unknown positions are rejected', () => {
    expect(parses(withPatch('roster_settings.starting_slots.0.eligible', []))).toBe(false)
    expect(parses(withPatch('roster_settings.starting_slots.0.eligible', ['QB', 'PUNTER']))).toBe(false)
  })

  it('unknown IR designations are rejected; all six §7.3.2 designations accepted', () => {
    expect(
      parses(
        withPatch('roster_settings.ir_slots', [
          { key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR', 'Doubtful', 'PUP', 'NFI', 'Suspended'] },
        ]),
      ),
    ).toBe(true)
    expect(
      parses(withPatch('roster_settings.ir_slots', [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['Questionable'] }])),
    ).toBe(false)
  })

  it('duplicate tiebreaker entries are rejected', () => {
    expect(parses(withPatch('tiebreakers', ['win_pct', 'win_pct', 'points_for']))).toBe(false)
    expect(parses(withPatch('tiebreakers', ['points_for', 'win_pct']))).toBe(true)
  })

  it('draft_order accepts null or an array of uuids, rejects junk ids', () => {
    expect(parses(withPatch('draft.draft_order', null))).toBe(true)
    expect(parses(withPatch('draft.draft_order', ['00000000-0000-4000-8000-000000000101']))).toBe(true)
    expect(parses(withPatch('draft.draft_order', ['team-1']))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Deep-frozen exports (R64) — nested structures are immutable too
// ---------------------------------------------------------------------------

describe('deep-frozen exported constants (R64)', () => {
  it('LEAGUE_SETTINGS_DEFAULTS: nested object/array mutation throws (not just the top level)', () => {
    expect(() => {
      ;(LEAGUE_SETTINGS_DEFAULTS.roster_settings.starting_slots[0] as { count: number }).count = 9
    }).toThrow(TypeError)
    expect(() => {
      ;(LEAGUE_SETTINGS_DEFAULTS.tiebreakers as string[]).push('coin_flip')
    }).toThrow(TypeError)
    expect(() => {
      ;(LEAGUE_SETTINGS_DEFAULTS.draft as { auction_budget: number }).auction_budget = 500
    }).toThrow(TypeError)
    // and the values are unchanged
    expect(LEAGUE_SETTINGS_DEFAULTS.roster_settings.starting_slots[0].count).toBe(1)
    expect(LEAGUE_SETTINGS_DEFAULTS.tiebreakers).toHaveLength(6)
    expect(LEAGUE_SETTINGS_DEFAULTS.draft.auction_budget).toBe(200)
  })

  it('DEFAULT_ROSTER_SETTINGS and DL_PRESET: nested arrays are frozen', () => {
    expect(() => {
      ;(DEFAULT_ROSTER_SETTINGS.ir_slots[0].eligible_designations as string[]).push('PUP')
    }).toThrow(TypeError)
    expect(() => {
      ;(DEFAULT_ROSTER_SETTINGS.starting_slots as unknown[]).pop()
    }).toThrow(TypeError)
    expect(() => {
      ;(DL_PRESET.eligible_designations as string[]).pop()
    }).toThrow(TypeError)
    expect(DEFAULT_ROSTER_SETTINGS.ir_slots[0].eligible_designations).toStrictEqual(['OUT', 'IR'])
    expect(DL_PRESET.eligible_designations).toStrictEqual(['OUT', 'IR', 'Doubtful'])
  })

  it('defaultsForTeamCount returns a FRESH mutable object — frozen constants are never handed out', () => {
    const derived = defaultsForTeamCount(12)
    expect(Object.isFrozen(derived)).toBe(false)
    derived.trade_veto_votes = 7 // must not throw…
    expect(derived.trade_veto_votes).toBe(7)
    expect(LEAGUE_SETTINGS_DEFAULTS.trade_veto_votes).toBe(6) // …and never aliases the constant
  })
})
