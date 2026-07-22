/**
 * L.A1.6 — splitSettings/mergeSettings tests:
 *  - the §12.1 column/blob split is exact (typed keys pinned; no overlap, no loss)
 *  - `mergeSettings(splitSettings(x)) ≡ x` — defaults, the enumeration
 *    fixture, and a 250-run seeded property sweep (in-repo mulberry32; no
 *    Math.random — D3 spirit)
 *  - the round-trip ENUMERATION fixture covers every §7.3 field: its field
 *    paths ≡ the schema's, every leaf differs from the default except the
 *    documented single-option fields, and `scoring_system_id` is carried
 *    ALONGSIDE the split, never inside it
 *  - mergeSettings fails LOUDLY on corrupt rows (D58 doctrine)
 */
import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../stats/synthetic/prng'
import type { LeagueRow, LeagueSettings } from './league-settings'
import {
  LEAGUE_SETTINGS_DEFAULTS,
  PICK_TIMER_SECONDS,
  TIEBREAKERS,
  leagueSettingsSchema,
  mergeSettings,
  splitSettings,
  validateLeagueSettings,
} from './league-settings'
import { ROUND_TRIP_SCORING_SYSTEM_ID, ROUND_TRIP_SETTINGS, SINGLE_OPTION_FIELD_PATHS } from './round-trip-fixture'

/** The §12.1 typed columns the split owns (order-insensitive pin). */
const EXPECTED_TYPED_KEYS = [
  'faab_budget',
  'format',
  'lineup_lock',
  'playoff_start_week',
  'playoff_teams',
  'regular_season_weeks',
  'roster_settings',
  'team_count',
  'trade_deadline_week',
  'trade_review',
  'waiver_type',
]

/** Rebuild the leagues-row shape a split writes (what mergeSettings reads). */
function rowFrom(x: LeagueSettings): LeagueRow {
  const { columns, blob } = splitSettings(x)
  return { ...columns, settings: blob } as LeagueRow
}

/**
 * Field paths of the settings tree: objects recurse, arrays and primitives
 * are leaves (array CONTENTS vary by config; the FIELD set must not).
 */
function fieldPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    fieldPaths(value, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('splitSettings — the §12.1 column/blob split', () => {
  it('columns carry exactly the §12.1 typed settings columns', () => {
    const { columns } = splitSettings(LEAGUE_SETTINGS_DEFAULTS)
    expect(Object.keys(columns).sort()).toStrictEqual(EXPECTED_TYPED_KEYS)
  })

  it('no overlap, no loss: columns ∪ blob ≡ the full field set, columns ∩ blob = ∅', () => {
    const { columns, blob } = splitSettings(LEAGUE_SETTINGS_DEFAULTS)
    const columnKeys = Object.keys(columns)
    const blobKeys = Object.keys(blob as Record<string, unknown>)
    expect(columnKeys.filter((k) => blobKeys.includes(k))).toStrictEqual([])
    expect([...columnKeys, ...blobKeys].sort()).toStrictEqual(Object.keys(LEAGUE_SETTINGS_DEFAULTS).sort())
  })

  it('scoring_system_id is NOT part of the split (carried alongside by the RPC layer, §7.3.3)', () => {
    const { columns, blob } = splitSettings(ROUND_TRIP_SETTINGS)
    expect(Object.keys(columns)).not.toContain('scoring_system_id')
    expect(Object.keys(blob as Record<string, unknown>)).not.toContain('scoring_system_id')
    // …and the id the fixture carries alongside is a well-formed uuid
    expect(ROUND_TRIP_SCORING_SYSTEM_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('mergeSettings(splitSettings(x)) ≡ x', () => {
  it('round-trips the defaults', () => {
    expect(mergeSettings(rowFrom(LEAGUE_SETTINGS_DEFAULTS))).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('round-trips the enumeration fixture exactly (strict deep equality)', () => {
    expect(mergeSettings(rowFrom(ROUND_TRIP_SETTINGS))).toStrictEqual(ROUND_TRIP_SETTINGS)
  })

  it('mergeSettings tolerates a full leagues row (extra row fields never leak into the strict parse)', () => {
    const fullRow = {
      ...rowFrom(ROUND_TRIP_SETTINGS),
      id: '00000000-0000-4000-8000-00000000beef',
      name: 'Round Trip League',
      owner_id: '00000000-0000-4000-8000-00000000cafe',
      season: 2026,
      status: 'setup',
      max_teams: 10,
      scoring_system_id: ROUND_TRIP_SCORING_SYSTEM_ID,
      invite_code: null,
      created_at: '2026-07-22T00:00:00Z',
    } as unknown as LeagueRow
    expect(mergeSettings(fullRow)).toStrictEqual(ROUND_TRIP_SETTINGS)
  })

  it('a legacy row with an empty blob merges to the §7.3 defaults for blob fields', () => {
    const { columns } = splitSettings(LEAGUE_SETTINGS_DEFAULTS)
    const merged = mergeSettings({ ...columns, settings: {} } as LeagueRow)
    expect(merged).toStrictEqual(LEAGUE_SETTINGS_DEFAULTS)
  })
})

describe('the round-trip enumeration fixture (gate item 3’s "every §7.3 field")', () => {
  it('is schema-valid and parse-stable (no default kicks in — every field is present)', () => {
    expect(leagueSettingsSchema.parse(structuredClone(ROUND_TRIP_SETTINGS))).toStrictEqual(ROUND_TRIP_SETTINGS)
  })

  it('validates clean under the §7.3.8 rules (L.A1.13 drives it through the real API path)', () => {
    const result = validateLeagueSettings(ROUND_TRIP_SETTINGS)
    expect(result.errors).toStrictEqual([])
    expect(result.valid).toBe(true)
  })

  it('its field paths ≡ the schema’s field paths (a new catalog field breaks this fixture loudly)', () => {
    expect(fieldPaths(ROUND_TRIP_SETTINGS).sort()).toStrictEqual(fieldPaths(LEAGUE_SETTINGS_DEFAULTS).sort())
  })

  it('every leaf differs from the default except the documented single-option fields', () => {
    const defaults = new Map(fieldPaths(LEAGUE_SETTINGS_DEFAULTS).map((p) => [p, getPath(LEAGUE_SETTINGS_DEFAULTS, p)]))
    const sameAsDefault = fieldPaths(ROUND_TRIP_SETTINGS).filter(
      (p) => JSON.stringify(getPath(ROUND_TRIP_SETTINGS, p)) === JSON.stringify(defaults.get(p)),
    )
    expect(sameAsDefault.sort()).toStrictEqual([...SINGLE_OPTION_FIELD_PATHS].sort())
  })
})

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, seg) => (node as Record<string, unknown>)[seg], obj)
}

describe('mergeSettings fails loudly on corrupt rows (D58 doctrine)', () => {
  const goodRow = () => rowFrom(LEAGUE_SETTINGS_DEFAULTS)

  it('non-object settings blob → TypeError', () => {
    expect(() => mergeSettings({ ...goodRow(), settings: null })).toThrow(TypeError)
    expect(() => mergeSettings({ ...goodRow(), settings: [1, 2] })).toThrow(TypeError)
    expect(() => mergeSettings({ ...goodRow(), settings: 'corrupt' })).toThrow(TypeError)
  })

  it('corrupt typed column (team_count 9) → ZodError, never a silently-wrong object', () => {
    expect(() => mergeSettings({ ...goodRow(), team_count: 9 })).toThrow()
  })

  it('corrupt blob field (duplicate tiebreakers) → ZodError', () => {
    const row = goodRow()
    const blob = { ...(row.settings as Record<string, unknown>), tiebreakers: ['win_pct', 'win_pct'] }
    expect(() => mergeSettings({ ...row, settings: blob })).toThrow()
  })

  it('unknown blob key (schema strictness) → ZodError', () => {
    const row = goodRow()
    const blob = { ...(row.settings as Record<string, unknown>), keeper_rounds: 3 }
    expect(() => mergeSettings({ ...row, settings: blob })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Property sweep — 250 seeded random schema-valid settings round-trip exactly
// ---------------------------------------------------------------------------

const TEAM_IDS = Array.from({ length: 16 }, (_, i) => `00000000-0000-4000-8000-0000000002${i.toString(16).padStart(2, '0')}`)

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]
}

function int(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

function bool(rng: () => number): boolean {
  return rng() < 0.5
}

function shuffled<T>(rng: () => number, source: readonly T[]): T[] {
  const arr = [...source]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Random SCHEMA-valid settings (cross-field §7.3.8 validity not required — the round-trip is a storage property). */
function randomSettings(rng: () => number): LeagueSettings {
  const slotPool = [
    { key: 'qb', label: 'QB', eligible: ['QB'] },
    { key: 'rb', label: 'RB', eligible: ['RB'] },
    { key: 'wr', label: 'WR', eligible: ['WR'] },
    { key: 'te', label: 'TE', eligible: ['TE'] },
    { key: 'flex1', label: 'W/R/T', eligible: ['WR', 'RB', 'TE'] },
    { key: 'superflex', label: 'SUPERFLEX', eligible: ['QB', 'WR', 'RB', 'TE'] },
    { key: 'idp_flex', label: 'IDP', eligible: ['DL', 'LB', 'DB'] },
    { key: 'k', label: 'K', eligible: ['K'] },
    { key: 'dst', label: 'D/ST', eligible: ['DST'] },
  ] as const
  const slotCount = int(rng, 1, slotPool.length)
  const candidate = {
    format: 'redraft',
    team_count: pick(rng, [8, 10, 12, 14, 16] as const),
    divisions: int(rng, 1, 2),
    regular_season_weeks: int(rng, 12, 15),
    playoff_teams: pick(rng, [0, 2, 4, 6, 8, 10, 12] as const),
    playoff_start_week: int(rng, 14, 17),
    playoff_weeks_per_round: pick(rng, [1, 2] as const),
    playoff_byes: 'auto',
    playoff_reseed: bool(rng),
    consolation_bracket: bool(rng),
    third_place_game: bool(rng),
    schedule_mode: pick(rng, ['h2h', 'total_points'] as const),
    median_game: bool(rng),
    second_opponent: bool(rng),
    roster_settings: {
      starting_slots: slotPool.slice(0, slotCount).map((s) => ({ ...s, eligible: [...s.eligible], count: int(rng, 0, 10) })),
      bench: int(rng, 0, 20),
      ir_slots: Array.from({ length: int(rng, 0, 6) }, (_, i) =>
        bool(rng)
          ? { key: `ir${i + 1}`, type: 'unrestricted' as const, eligible_designations: ['OUT' as const, 'IR' as const] }
          : {
              key: `ir${i + 1}`,
              label: 'DL',
              type: 'restricted' as const,
              eligible_designations: ['OUT' as const, 'IR' as const, 'Doubtful' as const],
              min_weeks: int(rng, 1, 17),
            },
      ),
      swap_spots: pick(rng, [0, 1] as const),
    },
    waiver_type: pick(rng, ['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs'] as const),
    faab_budget: int(rng, 0, 1000),
    faab_min_bid: int(rng, 0, 10),
    faab_tiebreaker: pick(rng, ['reverse_standings', 'rolling_priority'] as const),
    waiver_process_day: pick(rng, ['tue', 'wed', 'thu'] as const),
    waiver_process_time: `${int(rng, 0, 23).toString().padStart(2, '0')}:${int(rng, 0, 59).toString().padStart(2, '0')}`,
    waiver_period_hours: int(rng, 0, 168),
    free_agency: pick(rng, ['immediate_after_waivers', 'continuous'] as const),
    acquisitions_per_week: bool(rng) ? ('unlimited' as const) : int(rng, 0, 50),
    acquisitions_per_season: bool(rng) ? ('unlimited' as const) : int(rng, 0, 500),
    player_game_lock: bool(rng),
    bench_lock: bool(rng),
    fa_hold_hours: int(rng, 0, 48),
    trade_review: pick(rng, ['none', 'commissioner', 'league_vote'] as const),
    trade_veto_votes: int(rng, 1, 16),
    trade_review_period_hours: int(rng, 0, 96),
    trade_deadline_week: bool(rng) ? null : int(rng, 1, 15),
    allow_faab_in_trades: bool(rng),
    allow_future_considerations: bool(rng),
    trade_lock_behavior: pick(rng, ['defer', 'reject'] as const),
    lineup_lock: pick(rng, ['per_player_kickoff', 'first_game_of_week'] as const),
    allow_illegal_lineups: bool(rng),
    auto_sub_inactives: bool(rng),
    stat_correction_window: bool(rng) ? ('thu_06_00_et' as const) : int(rng, 0, 168),
    tiebreakers: shuffled(rng, TIEBREAKERS),
    draft: {
      draft_type: pick(rng, ['snake', 'auction', 'linear'] as const),
      snake_reversal: bool(rng),
      draft_order_mode: pick(rng, ['random', 'manual', 'custom'] as const),
      draft_order: bool(rng) ? null : TEAM_IDS.slice(0, int(rng, 1, 16)),
      pick_timer_seconds: pick(rng, PICK_TIMER_SECONDS),
      auction_budget: int(rng, 50, 1000),
      auction_min_bid: int(rng, 0, 5),
      auction_nomination_seconds: int(rng, 10, 120),
      auction_bid_seconds: int(rng, 10, 60),
      auction_anti_snipe_seconds: int(rng, 0, 15),
      nomination_order_mode: pick(rng, ['same_as_draft_order', 'random', 'manual'] as const),
      autopick_default: 'queue_then_board_then_adp',
      disconnect_grace_seconds: int(rng, 0, 120),
      draft_scheduled_at: bool(rng) ? null : `2026-0${int(rng, 8, 9)}-${int(rng, 10, 28)}T${int(rng, 10, 23)}:00:00.000Z`,
    },
  }
  return leagueSettingsSchema.parse(candidate)
}

describe('property: 250 seeded random settings round-trip exactly', () => {
  it('mergeSettings(splitSettings(x)) ≡ x for every generated x', () => {
    const rng = mulberry32(0xa1_60_00)
    for (let run = 0; run < 250; run++) {
      const x = randomSettings(rng)
      const roundTripped = mergeSettings(rowFrom(x))
      expect(roundTripped, `run ${run} must round-trip exactly`).toStrictEqual(x)
    }
  })
})
