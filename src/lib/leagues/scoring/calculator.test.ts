/**
 * L.A1.8 — §7.3.3 generic dot-product calculator tests.
 *
 * Falsifiability floor (tasks-M1 §4.3): golden pins are stored literals, not
 * recomputes; rounding pinned at the half-up boundary (a bankers'-rounding
 * implementation fails the .005 pins — the task's named break probe);
 * property test recomputes totals independently; the no-legacy-namespace
 * assertion derives the banned key list mechanically from the legacy module.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { STANDARD_SCORING } from '@/lib/scoring/default'

import { mulberry32 } from '../stats/synthetic/prng'
import { STAT_KEYS } from '../stats/stat-keys'
import { roundHalfUp, scorePlayerWeek } from './calculator'

describe('roundHalfUp (§7.3.3 precision rule)', () => {
  it('pins the half-up boundary — bankers rounding fails these', () => {
    // .005 rounds UP, never to-even (golden literals, not recomputed)
    expect(roundHalfUp(1.005)).toBe(1.01)
    expect(roundHalfUp(2.675)).toBe(2.68) // classic float trap: 2.675*100 = 267.49999…
    expect(roundHalfUp(98.235)).toBe(98.24)
    expect(roundHalfUp(0.125)).toBe(0.13) // to-even would give 0.12
    expect(roundHalfUp(0.135)).toBe(0.14) // and 0.14 — both pinned so either flip fails
  })

  it('rounds true sub-half values down (the snap is noise-collapse, not a bias)', () => {
    expect(roundHalfUp(1.0049)).toBe(1.0)
    expect(roundHalfUp(0.004999)).toBe(0.0)
    expect(roundHalfUp(17.482)).toBe(17.48)
  })

  it('negative totals round half away from zero, matching NUMERIC(8,2)', () => {
    // all-miss K week territory; documented D57 reading of "half-up"
    expect(roundHalfUp(-0.005)).toBe(-0.01)
    expect(roundHalfUp(-1.2)).toBe(-1.2)
  })
})

describe('scorePlayerWeek — dot product + pending semantics', () => {
  it('golden pin: hand-computed QB line', () => {
    const rules = { pass_yards: 0.04, pass_tds: 4, interceptions: -2, pass_2pt: 2, rush_yards: 0.1 }
    const stats = { pass_yards: 287, pass_tds: 2, interceptions: 1, pass_2pt: 1, rush_yards: 12 }
    const breakdown = scorePlayerWeek(rules, stats)
    // 11.48 + 8 − 2 + 2 + 1.2 = 20.68 (hand-computed literal)
    expect(breakdown.total).toBe(20.68)
    expect(breakdown.pending).toEqual([])
    expect(breakdown.perKey.pass_yards).toBeCloseTo(11.48, 10)
    expect(breakdown.perKey.interceptions).toBe(-2)
  })

  it('golden pin: rounding applies to the full-precision sum (0.335 × 3 → 1.01)', () => {
    // float sum is 1.00499999…; the true decimal value 1.005 must round UP
    const breakdown = scorePlayerWeek({ receptions: 0.335 }, { receptions: 3 })
    expect(breakdown.total).toBe(1.01)
  })

  it('golden pin (R61): total = round(full-precision sum), NOT Σ of rounded perKey — two-key literal where the two implementations diverge', () => {
    // 0.111×3 + 0.111×3 = 0.666 → 0.67; a Σ-of-rounded impl gives 0.33 + 0.33 = 0.66
    const breakdown = scorePlayerWeek({ a: 0.111, b: 0.111 }, { a: 3, b: 3 })
    expect(breakdown.total).toBe(0.67)
    expect(breakdown.perKey.a).toBeCloseTo(0.333, 12) // perKey stays full-precision (D57(3))
  })

  it('E38: two different stat lines tie at exactly two decimals', () => {
    const rules = { receiving_yards: 0.1, receptions: 1, pass_yards: 0.04 }
    const lineA = { receiving_yards: 92, receptions: 6, pass_yards: 1 }
    const lineB = { receiving_yards: 122, receptions: 3, pass_yards: 1 }
    expect(lineA).not.toEqual(lineB)
    expect(scorePlayerWeek(rules, lineA).total).toBe(15.24)
    expect(scorePlayerWeek(rules, lineB).total).toBe(15.24)
    // no hidden extra precision: the 2-decimal totals are strictly identical
    expect(scorePlayerWeek(rules, lineA).total).toBe(scorePlayerWeek(rules, lineB).total)
  })

  it('undelivered rules keys are pending — never a 0 in the breakdown (§23.5/E61)', () => {
    const breakdown = scorePlayerWeek(
      { receptions: 1, def_pa_46_plus: -5 },
      { receptions: 4 },
    )
    expect(breakdown.pending).toEqual(['def_pa_46_plus'])
    expect(breakdown.total).toBe(4)
    expect(Object.prototype.hasOwnProperty.call(breakdown.perKey, 'def_pa_46_plus')).toBe(false)
  })

  it('a delivered 0 is the opposite of pending: real perKey entry, no badge', () => {
    const breakdown = scorePlayerWeek({ receptions: 1 }, { receptions: 0 })
    expect(breakdown.pending).toEqual([])
    expect(breakdown.perKey.receptions).toBe(0)
    expect(breakdown.total).toBe(0)
  })

  it('defensive: non-finite stat values resolve as pending, not poison', () => {
    const breakdown = scorePlayerWeek(
      { receptions: 1, rush_yards: 0.1 },
      { receptions: NaN, rush_yards: 10 },
    )
    expect(breakdown.pending).toEqual(['receptions'])
    expect(breakdown.total).toBe(1)
  })

  it('stat keys with no rules entry are ignored (§7.3.3)', () => {
    const rules = { receptions: 1 }
    const bare = scorePlayerWeek(rules, { receptions: 4 })
    const noisy = scorePlayerWeek(rules, { receptions: 4, targets: 9, def_sack: 3 })
    expect(noisy).toEqual(bare)
  })

  it('property: total ≡ independent recompute; an undelivered rules key never moves the total', () => {
    const rng = mulberry32(0xa1_8_2026)
    const keyPool = Array.from({ length: 20 }, (_, i) => `k${i}`)
    for (let run = 0; run < 250; run++) {
      const rules: Record<string, number> = {}
      const stats: Record<string, number> = {}
      for (const key of keyPool) {
        if (rng() < 0.6) rules[key] = Math.round((rng() * 10 - 5) * 100) / 100
        if (rng() < 0.6) stats[key] = Math.round(rng() * 300) / 10
      }
      const breakdown = scorePlayerWeek(rules, stats)

      // independent recompute, different iteration order (sorted keys)
      let sum = 0
      const expectPending: string[] = []
      for (const key of Object.keys(rules).sort()) {
        if (key in stats) sum += rules[key] * stats[key]
        else expectPending.push(key)
      }
      expect(breakdown.total).toBe(roundHalfUp(sum))
      expect(Number.isFinite(breakdown.total)).toBe(true) // R59 pin: NaN can never reach the return value
      expect([...breakdown.pending].sort()).toEqual(expectPending)
      expect(Object.keys(breakdown.perKey).sort()).toEqual(
        Object.keys(rules).filter((k) => k in stats).sort(),
      )

      // adding an undelivered rules key: same total, key surfaces as pending
      const withGhost = scorePlayerWeek({ ...rules, zz_never_delivered: 3 }, stats)
      expect(withGhost.total).toBe(breakdown.total)
      expect(withGhost.pending).toContain('zz_never_delivered')
    }
  })
})

describe('R59/D58 — corrupt rules coefficients fail LOUD, never NaN-poison the total (E61)', () => {
  // rules come from the scoring_rules_snapshot JSONB — same trust boundary
  // as stats, but corrupt config is not missing data: pending would
  // misbadge it as "waiting on stats," and NUMERIC(8,2) stores NaN
  // (live-verified in the batch-5 review), so nothing downstream throws.
  it('non-numeric coefficient throws a TypeError naming the key', () => {
    expect(() =>
      scorePlayerWeek({ receptions: 'abc' } as unknown as Record<string, number>, { receptions: 4 }),
    ).toThrowError(/receptions/)
  })

  it('string-numeric coefficient ("0.5") throws — silent coercion masks a corrupt snapshot', () => {
    expect(() =>
      scorePlayerWeek({ receptions: '0.5' } as unknown as Record<string, number>, { receptions: 4 }),
    ).toThrowError(TypeError)
  })

  it('NaN / ±Infinity coefficients throw; every offending key is named', () => {
    expect(() =>
      scorePlayerWeek({ pass_yards: NaN, receptions: 1, def_sack: Infinity }, { receptions: 4 }),
    ).toThrowError(/pass_yards, def_sack/)
  })

  it('it throws even when the corrupt key has no delivered stat — corrupt config is never quietly parked as pending', () => {
    expect(() =>
      scorePlayerWeek({ receptions: 1, ghost: NaN }, { receptions: 4 }),
    ).toThrowError(/ghost/)
  })

  it('pin: NaN can never reach the return value — every adversarial coefficient shape either throws TypeError or yields a finite total', () => {
    const shapes: unknown[] = ['abc', '0.5', NaN, Infinity, -Infinity, null, undefined, {}, [], true]
    for (const bad of shapes) {
      const rules = { receptions: 1, bad_key: bad } as unknown as Record<string, number>
      let total = 0
      try {
        total = scorePlayerWeek(rules, { receptions: 4, bad_key: 2 }).total
      } catch (error) {
        expect(error, String(bad)).toBeInstanceOf(TypeError)
        continue
      }
      expect(Number.isFinite(total), String(bad)).toBe(true)
    }
  })
})

describe('one namespace — no legacy literals in the engine modules (D33)', () => {
  const moduleSources = ['./calculator.ts', './derive-stats.ts', './templates.ts'].map((rel) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'),
  )
  const canonical = new Set(STAT_KEYS.map((k) => k.key))
  const legacyOnlyKeys = Object.keys(STANDARD_SCORING).filter((k) => !canonical.has(k))

  it('sanity: the legacy namespace really does diverge from the canonical one', () => {
    expect(legacyOnlyKeys).toContain('two_point_conversions')
    expect(legacyOnlyKeys).toContain('xp_made')
    expect(legacyOnlyKeys.length).toBeGreaterThanOrEqual(5)
  })

  it('calculator + derive-stats + templates contain no legacy-only key literals and never import the legacy module', () => {
    for (const source of moduleSources) {
      for (const legacyKey of legacyOnlyKeys) {
        expect(source).not.toContain(legacyKey)
      }
      // import specifiers only — prose comments may cite the path (D33)
      expect(source).not.toMatch(/(?:from|import|require)\s*\(?\s*['"][^'"]*scoring\/default/)
    }
  })
})
