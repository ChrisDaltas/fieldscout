/**
 * templates.test.ts — L.A1.9 falsifiability floor (tasks-M1 §4.3).
 *
 * - Registry cross-check: every rules key exists in STAT_KEYS (§7.3.3 one
 *   namespace, mechanically enforced), is core_box, and is not a placeholder.
 * - Golden pins (R23 ordered-literal pattern): the COMPLETE contents of all
 *   six templates — names, descriptions, verification flags, and every
 *   coefficient — as stored flat literals. Any change to templates.ts (or a
 *   drifted spread) fails here visibly.
 * - Counter-pins that encode the specific wrong implementations:
 *   dst_model membership (ESPN split vs shared single), ESPN-vs-shared PA
 *   bucket families, PPR variants differing in exactly `receptions`,
 *   cross-platform INT delta, no 60+/PAT-micro keys (the Q9 exceptions are
 *   documented, never half-implemented), and the Q9 user-visibility
 *   condition on the ESPN descriptions.
 */
import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '../stats/stat-keys'
import {
  ESPN_PARITY_EXCEPTION_NOTE,
  SCORING_TEMPLATES,
} from './templates'

const byName = (name: string) => {
  const t = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!t) throw new Error(`template not found: ${name}`)
  return t
}

describe('registry cross-check (§7.3.3 one namespace)', () => {
  const registry = new Map(STAT_KEYS.map((d) => [d.key, d]))

  it('every rules key of every template exists in STAT_KEYS', () => {
    for (const t of SCORING_TEMPLATES) {
      for (const key of Object.keys(t.rules)) {
        expect(registry.has(key), `${t.name}: unknown key ${key}`).toBe(true)
      }
    }
  })

  it('every rules key is core_box and never a placeholder', () => {
    for (const t of SCORING_TEMPLATES) {
      for (const key of Object.keys(t.rules)) {
        const def = registry.get(key)!
        expect(def.tier, `${t.name}: ${key} tier`).toBe('core_box')
        expect(def.placeholder, `${t.name}: ${key} placeholder`).toBeUndefined()
      }
    }
  })

  it('every coefficient is a finite number (D58(2): corrupt config throws downstream)', () => {
    for (const t of SCORING_TEMPLATES) {
      for (const [key, v] of Object.entries(t.rules)) {
        expect(Number.isFinite(v), `${t.name}: ${key} = ${v}`).toBe(true)
      }
    }
  })
})

describe('golden pins — complete template contents as ordered literals', () => {
  it('templates are exactly the six §7.3.3 rows, in table order', () => {
    expect(SCORING_TEMPLATES.map((t) => t.name)).toEqual([
      'ESPN Standard',
      'ESPN Full PPR',
      'Yahoo Standard',
      'Yahoo Half PPR',
      'Sleeper Standard',
      'Sleeper Full PPR',
    ])
  })

  it('verification flags: ESPN/Yahoo source-verified; Sleeper best-known (F24)', () => {
    expect(SCORING_TEMPLATES.map((t) => [t.name, t.valuesVerified])).toEqual([
      ['ESPN Standard', true],
      ['ESPN Full PPR', true],
      ['Yahoo Standard', true],
      ['Yahoo Half PPR', true],
      ['Sleeper Standard', false],
      ['Sleeper Full PPR', false],
    ])
  })

  it('ESPN Standard rules — full literal (Q9 evidence, 2026-07-21)', () => {
    expect(byName('ESPN Standard').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -2,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 0,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      fg_missed: -1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 5,
      def_pa_1_6: 4,
      def_pa_7_13: 3,
      def_pa_14_17: 1,
      def_pa_18_27: 0,
      def_pa_28_34: -1,
      def_pa_35_45: -3,
      def_pa_46_plus: -5,
      def_ya_0_99: 5,
      def_ya_100_199: 3,
      def_ya_200_299: 2,
      def_ya_300_349: 0,
      def_ya_350_399: -1,
      def_ya_400_449: -3,
      def_ya_450_499: -5,
      def_ya_500_549: -6,
      def_ya_550_plus: -7,
    })
  })

  it('ESPN Full PPR rules — full literal', () => {
    expect(byName('ESPN Full PPR').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -2,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 1,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      fg_missed: -1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 5,
      def_pa_1_6: 4,
      def_pa_7_13: 3,
      def_pa_14_17: 1,
      def_pa_18_27: 0,
      def_pa_28_34: -1,
      def_pa_35_45: -3,
      def_pa_46_plus: -5,
      def_ya_0_99: 5,
      def_ya_100_199: 3,
      def_ya_200_299: 2,
      def_ya_300_349: 0,
      def_ya_350_399: -1,
      def_ya_400_449: -3,
      def_ya_450_499: -5,
      def_ya_500_549: -6,
      def_ya_550_plus: -7,
    })
  })

  it('Yahoo Standard rules — full literal (SLN6489, 2026-07-21)', () => {
    expect(byName('Yahoo Standard').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -1,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 0,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 10,
      def_pa_1_6: 7,
      def_pa_7_13: 4,
      def_pa_14_20: 1,
      def_pa_21_27: 0,
      def_pa_28_34: -1,
      def_pa_35_plus: -4,
    })
  })

  it('Yahoo Half PPR rules — full literal', () => {
    expect(byName('Yahoo Half PPR').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -1,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 0.5,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 10,
      def_pa_1_6: 7,
      def_pa_7_13: 4,
      def_pa_14_20: 1,
      def_pa_21_27: 0,
      def_pa_28_34: -1,
      def_pa_35_plus: -4,
    })
  })

  it('Sleeper Standard rules — full literal (App B best-known; F24 flagged)', () => {
    expect(byName('Sleeper Standard').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -1,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 0,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      fg_missed: -1,
      pat_missed: -1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 10,
      def_pa_1_6: 7,
      def_pa_7_13: 4,
      def_pa_14_20: 1,
      def_pa_21_27: 0,
      def_pa_28_34: -1,
      def_pa_35_plus: -4,
    })
  })

  it('Sleeper Full PPR rules — full literal', () => {
    expect(byName('Sleeper Full PPR').rules).toEqual({
      pass_yards: 0.04,
      pass_tds: 4,
      interceptions: -1,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 1,
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 4,
      fg_50_plus: 5,
      pat_made: 1,
      fg_missed: -1,
      pat_missed: -1,
      def_sack: 1,
      def_int: 2,
      def_fumble_rec: 2,
      def_td: 6,
      def_safety: 2,
      def_block: 2,
      def_return_td: 6,
      def_pa_0: 10,
      def_pa_1_6: 7,
      def_pa_7_13: 4,
      def_pa_14_20: 1,
      def_pa_21_27: 0,
      def_pa_28_34: -1,
      def_pa_35_plus: -4,
    })
  })
})

describe('counter-pins', () => {
  const ESPN_PA_KEYS = ['def_pa_14_17', 'def_pa_18_27', 'def_pa_35_45', 'def_pa_46_plus']
  const SHARED_ONLY_PA_KEYS = ['def_pa_14_20', 'def_pa_21_27', 'def_pa_35_plus']

  it('dst_model: ESPN templates carry def_ya_* (split); Yahoo/Sleeper carry none (single)', () => {
    for (const t of SCORING_TEMPLATES) {
      const yaKeys = Object.keys(t.rules).filter((k) => k.startsWith('def_ya_'))
      if (t.name.startsWith('ESPN')) {
        expect(yaKeys, t.name).toHaveLength(9)
      } else {
        expect(yaKeys, t.name).toHaveLength(0)
      }
    }
  })

  it('PA bucket families: ESPN uses ESPN buckets, never the shared-only ones — and vice versa', () => {
    for (const t of SCORING_TEMPLATES) {
      const keys = new Set(Object.keys(t.rules))
      if (t.name.startsWith('ESPN')) {
        for (const k of ESPN_PA_KEYS) expect(keys.has(k), `${t.name} missing ${k}`).toBe(true)
        for (const k of SHARED_ONLY_PA_KEYS) expect(keys.has(k), `${t.name} has ${k}`).toBe(false)
      } else {
        for (const k of SHARED_ONLY_PA_KEYS) expect(keys.has(k), `${t.name} missing ${k}`).toBe(true)
        for (const k of ESPN_PA_KEYS) expect(keys.has(k), `${t.name} has ${k}`).toBe(false)
      }
    }
  })

  it('PPR variants differ from their Standard sibling in exactly `receptions`', () => {
    const pairs: Array<[string, string, number]> = [
      ['ESPN Standard', 'ESPN Full PPR', 1],
      ['Yahoo Standard', 'Yahoo Half PPR', 0.5],
      ['Sleeper Standard', 'Sleeper Full PPR', 1],
    ]
    for (const [stdName, pprName, coeff] of pairs) {
      const std = byName(stdName).rules
      const ppr = byName(pprName).rules
      expect(Object.keys(ppr).sort()).toEqual(Object.keys(std).sort())
      for (const key of Object.keys(std)) {
        if (key === 'receptions') {
          expect(std[key], `${stdName}.receptions`).toBe(0)
          expect(ppr[key], `${pprName}.receptions`).toBe(coeff)
        } else {
          expect(ppr[key], `${pprName}.${key}`).toBe(std[key])
        }
      }
    }
  })

  it('cross-platform INT delta: ESPN −2 vs Yahoo/Sleeper −1 (§7.3.3 parity example)', () => {
    for (const t of SCORING_TEMPLATES) {
      expect(t.rules.interceptions, t.name).toBe(t.name.startsWith('ESPN') ? -2 : -1)
    }
  })

  it('miss penalties per platform table: ESPN fg only; Yahoo none; Sleeper both', () => {
    for (const t of SCORING_TEMPLATES) {
      const keys = new Set(Object.keys(t.rules))
      if (t.name.startsWith('ESPN')) {
        expect(keys.has('fg_missed'), t.name).toBe(true)
        expect(keys.has('pat_missed'), t.name).toBe(false)
      } else if (t.name.startsWith('Yahoo')) {
        expect(keys.has('fg_missed'), t.name).toBe(false)
        expect(keys.has('pat_missed'), t.name).toBe(false)
      } else {
        expect(keys.has('fg_missed'), t.name).toBe(true)
        expect(keys.has('pat_missed'), t.name).toBe(true)
      }
    }
  })

  it('Q9 exceptions are documented, never half-implemented: no 60+/PAT-micro keys anywhere', () => {
    for (const t of SCORING_TEMPLATES) {
      for (const key of Object.keys(t.rules)) {
        expect(key.includes('60'), `${t.name}: ${key}`).toBe(false)
        expect(/fg_50_59/.test(key), `${t.name}: ${key}`).toBe(false)
        expect(/pat_(safety|return)/.test(key), `${t.name}: ${key}`).toBe(false)
      }
      expect(t.rules.fg_50_plus, `${t.name}.fg_50_plus`).toBe(5)
    }
  })

  it('Q9 visibility condition: both ESPN descriptions carry the exception line verbatim', () => {
    for (const name of ['ESPN Standard', 'ESPN Full PPR']) {
      const t = byName(name)
      expect(t.description, name).toContain(ESPN_PARITY_EXCEPTION_NOTE)
      expect(t.description, name).toContain('60+ yard field goal')
      expect(t.description, name).toContain('PAT')
    }
  })

  it('every template has a non-empty commissioner-readable description', () => {
    for (const t of SCORING_TEMPLATES) {
      expect(t.description.length, t.name).toBeGreaterThan(40)
    }
  })
})
