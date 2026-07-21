import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from './stat-keys'

// Every core_box key Appendix B.1 names (the "fumble_recovery_td /
// return_td" row is two keys).
const APPENDIX_B1_KEYS = [
  'pass_yards',
  'pass_tds',
  'interceptions',
  'pass_2pt',
  'rush_yards',
  'rush_tds',
  'rush_2pt',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'rec_2pt',
  'fumbles_lost',
  'fumble_recovery_td',
  'return_td',
]

// Every core_box key Appendix B.4 names. The spec names the def_pa endpoint
// keys; the middle tiers follow the same def_pa_<lo>_<hi> shape on the
// standard boundaries (see the registry comment).
const APPENDIX_B4_KEYS = [
  'fg_0_39',
  'fg_40_49',
  'fg_50_plus',
  'pat_made',
  'fg_missed',
  'pat_missed',
  'def_sack',
  'def_int',
  'def_fumble_rec',
  'def_td',
  'def_safety',
  'def_block',
  'def_return_td',
  'def_pa_0',
  'def_pa_35_plus',
  'pass_300_bonus',
  'rush_100_bonus',
]

const DEF_PA_TIERS = [
  'def_pa_0',
  'def_pa_1_6',
  'def_pa_7_13',
  'def_pa_14_20',
  'def_pa_21_27',
  'def_pa_28_34',
  'def_pa_35_plus',
  // ESPN's published buckets (L.A1.7 verification finding, D56): the shared
  // family above cannot express ESPN's standard table.
  'def_pa_14_17',
  'def_pa_18_27',
  'def_pa_35_45',
  'def_pa_46_plus',
]

// The Q3 def_ya_<lo>_<hi> family, on ESPN's published yards-allowed buckets
// (support.espn.com Scoring-Formats article, retrieved 2026-07-20): <100 /
// 100–199 / 200–299 / 300–349 / 350–399 / 400–449 / 450–499 / 500–549 / 550+.
const DEF_YA_TIERS = [
  'def_ya_0_99',
  'def_ya_100_199',
  'def_ya_200_299',
  'def_ya_300_349',
  'def_ya_350_399',
  'def_ya_400_449',
  'def_ya_450_499',
  'def_ya_500_549',
  'def_ya_550_plus',
]

// R23-pattern golden pin: the COMPLETE registry key list as literals, in
// registry order. The seeded registry contents ARE the behavior (§7.3.3 one
// namespace — templates and the calculator both key off these), so a dropped,
// renamed, or reordered key must fail a literal comparison, not a recompute.
const GOLDEN_KEY_LIST = [
  // B.1 core offense
  'pass_yards',
  'pass_tds',
  'interceptions',
  'pass_2pt',
  'rush_yards',
  'rush_tds',
  'rush_2pt',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'rec_2pt',
  'fumbles_lost',
  'fumble_recovery_td',
  'return_td',
  // B.4 kicking
  'fg_0_39',
  'fg_40_49',
  'fg_50_plus',
  'pat_made',
  'fg_missed',
  'pat_missed',
  // B.4 D/ST
  'def_sack',
  'def_int',
  'def_fumble_rec',
  'def_td',
  'def_safety',
  'def_block',
  'def_return_td',
  'def_pa_0',
  'def_pa_1_6',
  'def_pa_7_13',
  'def_pa_14_20',
  'def_pa_21_27',
  'def_pa_28_34',
  'def_pa_35_plus',
  'def_pa_14_17',
  'def_pa_18_27',
  'def_pa_35_45',
  'def_pa_46_plus',
  'def_ya_0_99',
  'def_ya_100_199',
  'def_ya_200_299',
  'def_ya_300_349',
  'def_ya_350_399',
  'def_ya_400_449',
  'def_ya_450_499',
  'def_ya_500_549',
  'def_ya_550_plus',
  // B.4 bonuses
  'pass_300_bonus',
  'rush_100_bonus',
  // ingestion-continuity (D24)
  'pass_attempts',
  'pass_completions',
  'qb_sack_taken',
  'rush_attempts',
  'targets',
  'fg_made',
  'fg_attempted',
  'pat_attempted',
  'def_points_allowed',
  'def_yards_allowed',
  // D15 placeholders
  'example_tracking_yards',
  'example_charted_yards',
]

// R9: the `keyof Row` typing on `column` only rejects NON-EXISTENT columns —
// a wrong-but-existing column (e.g. fg_40_49 → fg_made_50_plus, pat_made →
// xp_attempted) passes type-check. This literal pins every key→column pair,
// so a swapped mapping fails a test before L.A0.2b wires consumers. The two
// divergence-documented mappings (fg_40_49, pat_made) are exactly the
// swap-prone ones — see the registry comments (D20).
const EXPECTED_COLUMN_MAPPINGS: Record<string, string> = {
  pass_yards: 'pass_yards',
  pass_tds: 'pass_tds',
  interceptions: 'interceptions',
  rush_yards: 'rush_yards',
  rush_tds: 'rush_tds',
  receptions: 'receptions',
  receiving_yards: 'receiving_yards',
  receiving_tds: 'receiving_tds',
  fumbles_lost: 'fumbles_lost',
  fg_40_49: 'fg_made_40_plus',
  fg_50_plus: 'fg_made_50_plus',
  pat_made: 'xp_made',
  // Migration-057 columns (L.A1.7/D41) — named identically to their keys by
  // design (the fg_made_40_plus lesson), so same-named pairs here.
  pass_2pt: 'pass_2pt',
  rush_2pt: 'rush_2pt',
  rec_2pt: 'rec_2pt',
  fg_0_39: 'fg_0_39',
  fg_missed: 'fg_missed',
  pat_missed: 'pat_missed',
  def_block: 'def_block',
  def_return_td: 'def_return_td',
  fumble_recovery_td: 'fumble_recovery_td',
  return_td: 'return_td',
  def_yards_allowed: 'def_yards_allowed',
  def_sack: 'def_sacks',
  def_int: 'def_interceptions',
  def_fumble_rec: 'def_fumble_recoveries',
  def_td: 'def_tds',
  def_safety: 'def_safeties',
  // D24 ingestion-continuity keys (L.A0.2b) — pat_attempted → xp_attempted
  // and qb_sack_taken → sacks_taken are the divergently-named, swap-prone
  // pairs here.
  pass_attempts: 'pass_attempts',
  pass_completions: 'pass_completions',
  qb_sack_taken: 'sacks_taken',
  rush_attempts: 'rush_attempts',
  targets: 'targets',
  fg_made: 'fg_made',
  fg_attempted: 'fg_attempted',
  pat_attempted: 'xp_attempted',
  def_points_allowed: 'def_points_allowed',
}

const byKey = new Map(STAT_KEYS.map((def) => [def.key, def]))

describe('STAT_KEYS registry', () => {
  it('has globally unique keys', () => {
    const keys = STAT_KEYS.map((def) => def.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains every Appendix B.1/B.4 core_box key, tiered core_box', () => {
    for (const key of [...APPENDIX_B1_KEYS, ...APPENDIX_B4_KEYS]) {
      const def = byKey.get(key)
      expect(def, `missing canonical key: ${key}`).toBeDefined()
      expect(def?.tier, key).toBe('core_box')
    }
  })

  it('pins the complete key list as literals, in registry order (R23 pattern — the seeded contents ARE the behavior)', () => {
    expect(STAT_KEYS.map((def) => def.key)).toEqual(GOLDEN_KEY_LIST)
  })

  it('carries the full points-allowed tier family (shared + ESPN buckets), all derived (D44)', () => {
    for (const key of DEF_PA_TIERS) {
      const def = byKey.get(key)
      expect(def, `missing def_pa tier: ${key}`).toBeDefined()
      expect(def?.storage, key).toBe('derived')
    }
  })

  it('carries the full Q3 def_ya family on ESPN’s published buckets, all derived (D44)', () => {
    for (const key of DEF_YA_TIERS) {
      const def = byKey.get(key)
      expect(def, `missing def_ya tier: ${key}`).toBeDefined()
      expect(def?.tier, key).toBe('core_box')
      expect(def?.storage, key).toBe('derived')
    }
    // Counter-pin: the family is exactly these nine — a stray tenth bucket
    // (or a def_ya key seeded with storage that would persist it) fails here.
    const actual = STAT_KEYS.filter((def) => def.key.startsWith('def_ya_')).map(
      (def) => def.key,
    )
    expect(actual).toEqual(DEF_YA_TIERS)
  })

  it('derives tier indicators only — every derived key is a def_pa_*/def_ya_* one-hot (D44)', () => {
    for (const def of STAT_KEYS) {
      if (def.storage === 'derived') {
        expect(
          def.key.startsWith('def_pa_') || def.key.startsWith('def_ya_'),
          def.key,
        ).toBe(true)
      }
    }
  })

  it('keeps tier and storage consistent', () => {
    for (const def of STAT_KEYS) {
      // core_box lives in typed columns, is derived at scoring time, or is
      // genuinely deferred — never in the §23.5 advanced JSONB, which is the
      // tracking/charted home.
      if (def.tier === 'core_box') {
        expect(def.storage, def.key).not.toBe('advanced')
      } else {
        expect(def.storage, def.key).toBe('advanced')
      }
    }
  })

  it('names a player_stats column iff storage is "column"', () => {
    for (const def of STAT_KEYS) {
      if (def.storage === 'column') {
        // Column-name validity itself is compile-time checked: the field is
        // typed keyof the generated player_stats Row.
        expect(def.column, def.key).toBeDefined()
      } else {
        expect(def.column, def.key).toBeUndefined()
      }
    }
  })

  it('pins every key→column mapping exactly (R9 — type-check cannot catch a swapped-but-existing column)', () => {
    const columnMapped = Object.fromEntries(
      STAT_KEYS.filter((def) => def.storage === 'column').map((def) => [def.key, def.column]),
    )
    expect(columnMapped).toEqual(EXPECTED_COLUMN_MAPPINGS)
  })

  it('carries exactly the two D15 placeholder keys (R14 — L.A0.3 scenarios depend on their presence)', () => {
    const placeholders = STAT_KEYS.filter((def) => def.placeholder)
      .map((def) => def.key)
      .sort()
    expect(placeholders).toEqual(['example_charted_yards', 'example_tracking_yards'])
  })

  it('marks every tracking/charted key as a D15 placeholder (Q2 punt — no real advanced product keys in M0)', () => {
    for (const def of STAT_KEYS) {
      if (def.tier === 'core_box') {
        expect(def.placeholder, def.key).toBeUndefined()
      } else {
        expect(def.placeholder, def.key).toBe(true)
      }
    }
  })

  it('never gives a placeholder key column storage', () => {
    for (const def of STAT_KEYS) {
      if (def.placeholder) {
        expect(def.storage, def.key).not.toBe('column')
      }
    }
  })

  it('labels every key', () => {
    for (const def of STAT_KEYS) {
      expect(def.label.trim().length, def.key).toBeGreaterThan(0)
    }
  })
})
