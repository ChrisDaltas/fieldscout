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
]

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

  it('carries the full points-allowed tier family', () => {
    for (const key of DEF_PA_TIERS) {
      expect(byKey.get(key), `missing def_pa tier: ${key}`).toBeDefined()
    }
  })

  it('keeps tier and storage consistent', () => {
    for (const def of STAT_KEYS) {
      // core_box lives in typed columns (or is deferred to M1) — never in
      // the §23.5 advanced JSONB, which is the tracking/charted home.
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
