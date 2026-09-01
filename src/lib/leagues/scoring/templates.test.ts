/**
 * templates.test.ts — L.A1.9 falsifiability floor (tasks-M1 §4.3).
 *
 * - Registry cross-check: every rules key exists in STAT_KEYS (§7.3.3 one
 *   namespace, mechanically enforced), is core_box, and is not a placeholder.
 * - Golden pins (R23 ordered-literal pattern): the COMPLETE contents of all
 *   eight templates — names, descriptions, verification flags, and every
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
  it('templates are exactly the eight §7.3.3 rows, in table order (v2.16.11: the Scout pair first)', () => {
    expect(SCORING_TEMPLATES.map((t) => t.name)).toEqual([
      'Scout Standard',
      'Scout PPR',
      'ESPN Standard',
      'ESPN Full PPR',
      'Yahoo Standard',
      'Yahoo Half PPR',
      'Sleeper Standard',
      'Sleeper Full PPR',
    ])
  })

  it('verification flags: the Scout pair definitional (D278(7)); ESPN/Yahoo source-verified; Sleeper best-known (F24)', () => {
    expect(SCORING_TEMPLATES.map((t) => [t.name, t.valuesVerified])).toEqual([
      // The Scout pair's values are DEFINITIONAL — the source is the App
      // B.5/B.5.1 rulings themselves (marked up 2026-08-31 and 2026-09-01),
      // so verified-true by construction of the ruling, not by a platform
      // help page (D278(7), resolved by SC.1; the same ruling source covers
      // Scout PPR's one divergent value — SC.4).
      ['Scout Standard', true],
      ['Scout PPR', true],
      ['ESPN Standard', true],
      ['ESPN Full PPR', true],
      ['Yahoo Standard', true],
      ['Yahoo Half PPR', true],
      ['Sleeper Standard', false],
      ['Sleeper Full PPR', false],
    ])
  })

  it('Scout Standard rules — full literal (App B.5 as marked up 2026-08-31; SC.1 — renamed from "Scout Scoring" at SC.4, values byte-identical)', () => {
    expect(byName('Scout Standard').rules).toEqual({
      pass_yards: 0.05,
      pass_tds: 6,
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
      fg_40_49: 3,
      fg_50_plus: 3,
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

  it('Scout PPR rules — full literal (App B.5.1 as marked up 2026-09-01; SC.4). The pair is a one-key spread in templates.ts; this literal is stored independently anyway (D284(4))', () => {
    expect(byName('Scout PPR').rules).toEqual({
      pass_yards: 0.05,
      pass_tds: 6,
      interceptions: -2,
      pass_2pt: 2,
      rush_yards: 0.1,
      rush_tds: 6,
      rush_2pt: 2,
      receptions: 0.2, // the pair's ONE divergence (B.5.1; 2dp, guardrail 5)
      receiving_yards: 0.1,
      receiving_tds: 6,
      rec_2pt: 2,
      fumbles_lost: -2,
      fumble_recovery_td: 6,
      return_td: 6,
      fg_0_39: 3,
      fg_40_49: 3,
      fg_50_plus: 3,
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

  // The Scout pair, enumerated BY MEMBER (D272(20)) — shared by the INT /
  // miss-penalty / flat-FG branches below (B.5.1: one body, one value
  // apart, so every non-receptions branch treats the two identically).
  const SCOUT_PAIR_NAMES = new Set(['Scout Standard', 'Scout PPR'])

  // The four split-model rows, enumerated BY MEMBER (D272(20)): the two ESPN
  // rows plus the Scout pair, whose split D/ST is B.5's markup ruling
  // (SC.1; the pair shares one body one value apart — B.5.1, SC.4).
  const SPLIT_MODEL_NAMES = new Set([
    'ESPN Standard',
    'ESPN Full PPR',
    'Scout Standard',
    'Scout PPR',
  ])

  it('dst_model: ESPN + the Scout pair carry def_ya_* (split); Yahoo/Sleeper carry none (single)', () => {
    for (const t of SCORING_TEMPLATES) {
      const yaKeys = Object.keys(t.rules).filter((k) => k.startsWith('def_ya_'))
      if (SPLIT_MODEL_NAMES.has(t.name)) {
        expect(yaKeys, t.name).toHaveLength(9)
      } else {
        expect(yaKeys, t.name).toHaveLength(0)
      }
    }
  })

  it('PA bucket families: ESPN + the Scout pair use ESPN buckets, never the shared-only ones — and vice versa', () => {
    for (const t of SCORING_TEMPLATES) {
      const keys = new Set(Object.keys(t.rules))
      if (SPLIT_MODEL_NAMES.has(t.name)) {
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
      // The Scout pair (B.5.1, SC.4): one value apart at 0.2 — structural
      // in templates.ts (a one-key spread), re-proven here from the
      // objects.
      ['Scout Standard', 'Scout PPR', 0.2],
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

  it('INT delta: ESPN and the Scout pair −2 vs Yahoo/Sleeper −1 (§7.3.3 parity example + B.5 "−2 for all turnovers")', () => {
    for (const t of SCORING_TEMPLATES) {
      const expected =
        t.name.startsWith('ESPN') || SCOUT_PAIR_NAMES.has(t.name) ? -2 : -1
      expect(t.rules.interceptions, t.name).toBe(expected)
    }
  })

  it('miss penalties per table: ESPN + the Scout pair fg only (B.5: the −1 ruling was FG-specific, never a pair); Yahoo none; Sleeper both', () => {
    for (const t of SCORING_TEMPLATES) {
      const keys = new Set(Object.keys(t.rules))
      if (t.name.startsWith('ESPN') || SCOUT_PAIR_NAMES.has(t.name)) {
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
      // Platform rows carry 5 (the 50–59 value — the Q9 exception encoding);
      // the Scout pair's flat-FG 3 is RULED in B.5 (shared body, B.5.1) and
      // has no exception to encode.
      expect(t.rules.fg_50_plus, `${t.name}.fg_50_plus`).toBe(
        SCOUT_PAIR_NAMES.has(t.name) ? 3 : 5,
      )
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
