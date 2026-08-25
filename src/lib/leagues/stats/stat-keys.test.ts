import { describe, expect, it } from 'vitest'

import {
  DEF_PA_PREFIX,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  YA_CUTS,
  tierKeysFromCuts,
} from '@/lib/leagues/scoring/tier-cuts'

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

// ── SE.1 · scoring_surface (§23.5 v2.11 / §7.3.3.1) ────────────────────────

// §7.3.3.1's "Section catalog (pinned — the ops layer renders this, never
// invents)", transcribed from the spec sentence. SE.7 builds the editor's
// real catalog (with D173's `gated` flag); this literal exists so the
// REGISTRY's scorable set can be proved equal to the editor's surface
// before any editor code exists.
//
// `return_yards` is deliberately absent: Q13/D173 ship the Special Teams
// section with `return_td` only, and the registry entry itself does not
// exist until the data task lands (the standing-E61 Q9 lesson — a rules key
// whose stat is never delivered is a permanent pending badge).
const SECTION_CATALOG_KEYS = [
  // Passing
  'pass_yards',
  'pass_tds',
  'pass_2pt',
  'qb_sack_taken',
  // Rushing
  'rush_yards',
  'rush_tds',
  'rush_2pt',
  // Receiving
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'rec_2pt',
  // Special Teams
  'return_td',
  // Turnovers
  'interceptions',
  'fumbles_lost',
  'fumble_recovery_td',
  // Kicking (the K page)
  'fg_0_39',
  'fg_40_49',
  'fg_50_plus',
  'pat_made',
  'fg_missed',
  'pat_missed',
  // D/ST events (the D/ST page, above its tier tables)
  'def_sack',
  'def_int',
  'def_fumble_rec',
  'def_td',
  'def_safety',
  'def_block',
  'def_return_td',
]

// §23.5's own enumeration of the context surface, transcribed verbatim from
// the v2.11 registry bullet: "raw sources def_points_allowed/
// def_yards_allowed + aggregates fg_made/fg_attempted/pat_attempted/
// pass_attempts/pass_completions/rush_attempts/targets".
const CONTEXT_KEYS = [
  'def_points_allowed',
  'def_yards_allowed',
  'fg_made',
  'fg_attempted',
  'pat_attempted',
  'pass_attempts',
  'pass_completions',
  'rush_attempts',
  'targets',
]

// §23.5's reserved surface: "deferred bonuses, placeholders, IDP" — the two
// Appendix B.4 bonuses and the two D15 placeholders today; no IDP key
// exists yet.
const RESERVED_KEYS = [
  'pass_300_bonus',
  'rush_100_bonus',
  'example_tracking_yards',
  'example_charted_yards',
]

const surfaceKeys = (surface: string) =>
  STAT_KEYS.filter((def) => def.scoring_surface === surface)
    .map((def) => def.key)
    .sort()

describe('STAT_KEYS scoring_surface (§23.5 v2.11 — the editor’s editable scope)', () => {
  it('classifies the WHOLE registry — the three surfaces partition it, 48/9/4 = 61', () => {
    const scorable = surfaceKeys('scorable')
    const context = surfaceKeys('context')
    const reserved = surfaceKeys('reserved')

    expect(scorable.length).toBe(48)
    expect(context.length).toBe(9)
    expect(reserved.length).toBe(4)
    // Partition, not just counts: every key classified exactly once, and no
    // entry left with an unrecognised (or absent) surface. A required field
    // with no default means the type-checker catches an omission at authoring
    // time; this catches a typo'd literal at test time.
    expect([...scorable, ...context, ...reserved].sort()).toEqual(
      STAT_KEYS.map((def) => def.key).sort(),
    )
    expect(STAT_KEYS.length).toBe(61)
  })

  it('THE SCORABLE SET ≡ the §7.3.3.1 section catalog ∪ the CUT-GENERATED tier keys (set equality, not a count)', () => {
    // The editor exposes exactly `scoring_surface: 'scorable'` (§7.3.3.1's
    // editable-scope bullet), and it renders the section catalog plus the
    // D/ST tier tables. If those two sets ever diverge, either the editor
    // silently drops a payable key or it offers one the registry does not
    // carry — both silent-wrong-total shapes. Note the tier half is the
    // GENERATED names (§23.5(b) cut lists), not a second literal list: this
    // is the registry proved against the generator, in one assertion.
    const generatedTierKeys = [
      ...tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS),
      ...tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS),
      ...tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS),
    ]
    // 7 shared PA + 8 ESPN PA (4 key names genuinely shared) + 9 YA = 20.
    const tierUnion = [...new Set(generatedTierKeys)]
    expect(tierUnion.length).toBe(20)
    // …and the catalog half is 28 (4 Passing + 3 Rushing + 4 Receiving +
    // 1 Special Teams + 3 Turnovers + 6 Kicking + 7 D/ST events), so the
    // 28 + 20 = 48 arithmetic is measured here, not asserted in prose.
    expect(SECTION_CATALOG_KEYS.length).toBe(28)

    const expected = [...new Set([...SECTION_CATALOG_KEYS, ...tierUnion])].sort()
    expect(expected.length).toBe(48)
    expect(surfaceKeys('scorable')).toEqual(expected)
  })

  it('pins the context surface as §23.5 enumerates it — raw sources + aggregates, never scorable', () => {
    expect(surfaceKeys('context')).toEqual([...CONTEXT_KEYS].sort())
    // The raw sources are the reason the surface exists: a doc that could
    // pay def_points_allowed AND its derived buckets would double-pay the
    // same week (F21). SE.3/SE.4's guardrail (1) rejects them; here we pin
    // that the registry hands that validator the right allowlist.
    for (const key of ['def_points_allowed', 'def_yards_allowed']) {
      expect(surfaceKeys('scorable')).not.toContain(key)
    }
  })

  it('pins the reserved surface — deferred bonuses + D15 placeholders (no IDP key exists yet)', () => {
    expect(surfaceKeys('reserved')).toEqual([...RESERVED_KEYS].sort())
  })

  it('keeps surface consistent with tier/storage: scorable ⊆ core_box, every derived key scorable, every placeholder and deferred key reserved', () => {
    for (const def of STAT_KEYS) {
      if (def.scoring_surface === 'scorable') {
        // The cohort editor never exposes a tracking/charted key — those are
        // placeholders today (Q2) and unfunded product stats tomorrow.
        expect(def.tier, def.key).toBe('core_box')
      }
      if (def.storage === 'derived') {
        // The def_pa_*/def_ya_* one-hots ARE the D/ST tier tables the editor
        // pays (D44).
        expect(def.scoring_surface, def.key).toBe('scorable')
      }
      if (def.placeholder || def.storage === 'deferred') {
        expect(def.scoring_surface, def.key).toBe('reserved')
      }
    }
  })
})
