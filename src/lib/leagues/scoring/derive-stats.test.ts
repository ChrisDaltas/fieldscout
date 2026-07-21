/**
 * L.A1.8 — tier-indicator derivation tests (D44) + the F20 discharge.
 *
 * F20 (PROGRESS ledger §6, R56): cold buckets are DELIVERED-ZERO. The named
 * counter-pin tests below encode the specific wrong implementation — a
 * derive that emits only the hot bucket — and fail against it: the
 * present-and-zero assertions see `undefined`, and the badge-semantics test
 * sees cold rules keys in `pending`. Bucket-edge tests alone cannot catch
 * that, which is why these exist separately (R56).
 */

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '../stats/stat-keys'
import { scorePlayerWeek } from './calculator'
import {
  DEF_PA_BUCKETS,
  DEF_PA_SOURCE_KEY,
  DEF_YA_BUCKETS,
  DEF_YA_SOURCE_KEY,
  deriveTierIndicators,
} from './derive-stats'

const PA_KEYS = DEF_PA_BUCKETS.map((b) => b.key)
const YA_KEYS = DEF_YA_BUCKETS.map((b) => b.key)

/** The two platform-facing PA bucket sets (families overlap by design). */
const SHARED_PA_SET = ['def_pa_0', 'def_pa_1_6', 'def_pa_7_13', 'def_pa_14_20', 'def_pa_21_27', 'def_pa_28_34', 'def_pa_35_plus']
const ESPN_PA_SET = ['def_pa_0', 'def_pa_1_6', 'def_pa_7_13', 'def_pa_14_17', 'def_pa_18_27', 'def_pa_28_34', 'def_pa_35_45', 'def_pa_46_plus']

describe('bucket tables ⇄ STAT_KEYS registry (one namespace, mechanically enforced)', () => {
  it('table keys ≡ the registry’s derived-storage keys, both directions, no duplicates', () => {
    const tableKeys = [...PA_KEYS, ...YA_KEYS]
    expect(new Set(tableKeys).size).toBe(tableKeys.length)
    const registryDerived = STAT_KEYS.filter((k) => k.storage === 'derived').map((k) => k.key)
    expect([...tableKeys].sort()).toEqual([...registryDerived].sort())
  })

  it('the raw source keys are registry column-stored keys', () => {
    for (const source of [DEF_PA_SOURCE_KEY, DEF_YA_SOURCE_KEY]) {
      const def = STAT_KEYS.find((k) => k.key === source)
      expect(def, source).toBeDefined()
      expect(def?.storage).toBe('column')
    }
  })

  it('golden pin: family sizes (11 PA — 7 shared + 4 ESPN — and 9 YA)', () => {
    expect(PA_KEYS).toHaveLength(11)
    expect(YA_KEYS).toHaveLength(9)
  })
})

describe('bucket boundary instants (every edge and one past it)', () => {
  const paCases: Array<[number, string[]]> = [
    [0, ['def_pa_0']],
    [1, ['def_pa_1_6']],
    [6, ['def_pa_1_6']],
    [7, ['def_pa_7_13']],
    [13, ['def_pa_7_13']],
    [14, ['def_pa_14_20', 'def_pa_14_17']],
    [17, ['def_pa_14_20', 'def_pa_14_17']],
    [18, ['def_pa_14_20', 'def_pa_18_27']],
    [20, ['def_pa_14_20', 'def_pa_18_27']],
    [21, ['def_pa_21_27', 'def_pa_18_27']],
    [27, ['def_pa_21_27', 'def_pa_18_27']],
    [28, ['def_pa_28_34']],
    [34, ['def_pa_28_34']],
    [35, ['def_pa_35_plus', 'def_pa_35_45']],
    [45, ['def_pa_35_plus', 'def_pa_35_45']],
    [46, ['def_pa_35_plus', 'def_pa_46_plus']],
    [73, ['def_pa_35_plus', 'def_pa_46_plus']],
  ]
  it.each(paCases)('PA=%d hots exactly %j (all 11 keys emitted)', (pa, hot) => {
    const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: pa })
    for (const key of PA_KEYS) {
      expect(derived[key], key).toBe(hot.includes(key) ? 1 : 0)
    }
  })

  const yaCases: Array<[number, string]> = [
    [-12, 'def_ya_0_99'], // negative total yards is a legal (rare) game
    [0, 'def_ya_0_99'],
    [99, 'def_ya_0_99'],
    [100, 'def_ya_100_199'],
    [199, 'def_ya_100_199'],
    [200, 'def_ya_200_299'],
    [299, 'def_ya_200_299'],
    [300, 'def_ya_300_349'],
    [349, 'def_ya_300_349'],
    [350, 'def_ya_350_399'],
    [399, 'def_ya_350_399'],
    [400, 'def_ya_400_449'],
    [449, 'def_ya_400_449'],
    [450, 'def_ya_450_499'],
    [499, 'def_ya_450_499'],
    [500, 'def_ya_500_549'],
    [549, 'def_ya_500_549'],
    [550, 'def_ya_550_plus'],
    [608, 'def_ya_550_plus'],
  ]
  it.each(yaCases)('YA=%d hots exactly %s (all 9 keys emitted)', (ya, hot) => {
    const derived = deriveTierIndicators({ [DEF_YA_SOURCE_KEY]: ya })
    for (const key of YA_KEYS) {
      expect(derived[key], key).toBe(key === hot ? 1 : 0)
    }
  })

  it('property: each platform bucket set is one-hot for every integer PA/YA', () => {
    for (let pa = 0; pa <= 80; pa++) {
      const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: pa })
      expect(SHARED_PA_SET.reduce((n, k) => n + derived[k], 0), `shared @ PA=${pa}`).toBe(1)
      expect(ESPN_PA_SET.reduce((n, k) => n + derived[k], 0), `espn @ PA=${pa}`).toBe(1)
    }
    for (let ya = -30; ya <= 650; ya++) {
      const derived = deriveTierIndicators({ [DEF_YA_SOURCE_KEY]: ya })
      expect(YA_KEYS.reduce((n, k) => n + derived[k], 0), `ya @ YA=${ya}`).toBe(1)
    }
  })
})

describe('R58/D58 — unmappable source values are unreported, never an all-zero family', () => {
  // The exact gap values the batch-5 review probed live: pre-fix these
  // emitted the full family as delivered-zero — nothing hot, nothing
  // pending, a silent wrong total (E61). The bucket tables are
  // integer-gapped (ESPN prints 1–6 / 7–13 / 14–17…), so the domain is the
  // integers and an unmappable value is unreported, not clampable.
  const unmappable: Array<[string, number]> = [
    ['PA=13.5 (the real-valued gap between def_pa_7_13 and def_pa_14_*)', 13.5],
    ['PA=-3 (below def_pa_0’s pinned floor)', -3],
    ['PA=14.5 (fractional INSIDE an interval — still outside the integer domain)', 14.5],
  ]
  it.each(unmappable)('%s: PA family absent → rules keys pending', (_label, pa) => {
    const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: pa, def_sack: 2 })
    for (const key of PA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(false)
    }
    const breakdown = scorePlayerWeek({ def_pa_7_13: 3, def_pa_46_plus: -5 }, derived)
    expect([...breakdown.pending].sort()).toEqual(['def_pa_46_plus', 'def_pa_7_13'])
    expect(breakdown.total).toBe(0)
  })

  it('YA=99.5 (the review’s gap between def_ya_0_99 and def_ya_100_199): family absent → pending', () => {
    const derived = deriveTierIndicators({ [DEF_YA_SOURCE_KEY]: 99.5 })
    for (const key of YA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(false)
    }
    const breakdown = scorePlayerWeek({ def_ya_0_99: 5 }, derived)
    expect(breakdown.pending).toEqual(['def_ya_0_99'])
  })

  it('a mappable source still delivers alongside an unmappable one — families stay independent', () => {
    const derived = deriveTierIndicators({
      [DEF_PA_SOURCE_KEY]: 13.5,
      [DEF_YA_SOURCE_KEY]: 320,
    })
    expect(derived.def_ya_300_349).toBe(1)
    expect(Object.prototype.hasOwnProperty.call(derived, 'def_pa_7_13')).toBe(false)
  })

  it('counter-pin: an all-zero (or partial) delivered family is UNCONSTRUCTIBLE — over integers, fractionals, negatives, and non-finites, a family is either fully absent or one-hot per platform set', () => {
    const probes: number[] = [NaN, Infinity, -Infinity, -0.5, 0.0001, 13.5, 14.5, 99.5, 199.5, 549.5]
    for (let v = -30; v <= 80; v++) probes.push(v)
    for (let v = -30.5; v <= 660; v += 7.25) probes.push(v) // fractional sweep (R58: the integer-only scan missed this class)
    for (let v = 81; v <= 660; v += 3) probes.push(v)

    const families = [
      { source: DEF_PA_SOURCE_KEY, keys: PA_KEYS, buckets: DEF_PA_BUCKETS, sets: [SHARED_PA_SET, ESPN_PA_SET] },
      { source: DEF_YA_SOURCE_KEY, keys: YA_KEYS, buckets: DEF_YA_BUCKETS, sets: [YA_KEYS] },
    ]
    for (const v of probes) {
      for (const { source, keys, buckets, sets } of families) {
        const derived = deriveTierIndicators({ [source]: v })
        const present = keys.filter((k) => Object.prototype.hasOwnProperty.call(derived, k))
        const shouldDeliver =
          Number.isInteger(v) && buckets.some(({ lo, hi }) => v >= lo && v <= hi)
        expect(present.length > 0, `${source}=${v} delivered?`).toBe(shouldDeliver)
        if (!shouldDeliver) continue
        expect(present, `partial family @ ${source}=${v}`).toEqual([...keys])
        for (const set of sets) {
          expect(set.reduce((n, k) => n + derived[k], 0), `one-hot @ ${source}=${v}`).toBe(1)
        }
      }
    }
  })
})

describe('F20 — cold buckets are DELIVERED-ZERO (PROGRESS ledger §6, R56)', () => {
  it('normal-week derivation delivers the FULL family, cold buckets present-and-zero — an only-hot-bucket derive fails here', () => {
    const derived = deriveTierIndicators({
      [DEF_PA_SOURCE_KEY]: 20,
      [DEF_YA_SOURCE_KEY]: 350,
      def_sack: 3,
    })
    // every family key exists — absence anywhere means pending under §23.5
    for (const key of [...PA_KEYS, ...YA_KEYS]) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(true)
    }
    // the F20 canonical example: def_pa_46_plus on a normal week is a KNOWN zero
    expect(derived.def_pa_46_plus).toBe(0)
    expect(derived.def_ya_550_plus).toBe(0)
    expect(derived.def_pa_14_20).toBe(1)
    expect(derived.def_pa_18_27).toBe(1)
    expect(derived.def_ya_350_399).toBe(1)
    // raw line passes through untouched
    expect(derived.def_sack).toBe(3)
    expect(derived[DEF_PA_SOURCE_KEY]).toBe(20)
  })

  it('badge semantics: cold-bucket rules score as delivered-zero, never pending', () => {
    const rules = { def_pa_18_27: 0, def_pa_46_plus: -5, def_ya_300_349: 1 }
    const breakdown = scorePlayerWeek(
      rules,
      deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: 20, [DEF_YA_SOURCE_KEY]: 320 }),
    )
    expect(breakdown.pending).toEqual([])
    expect(breakdown.perKey.def_pa_46_plus).toBeCloseTo(0, 12)
    expect(breakdown.total).toBe(1)
  })

  it('pending stays reachable ONLY for genuinely unreported data: no raw source → whole family pending', () => {
    const derived = deriveTierIndicators({ def_sack: 3 })
    for (const key of [...PA_KEYS, ...YA_KEYS]) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(false)
    }
    const breakdown = scorePlayerWeek(
      { def_sack: 1, def_pa_46_plus: -5, def_ya_0_99: 5 },
      derived,
    )
    expect([...breakdown.pending].sort()).toEqual(['def_pa_46_plus', 'def_ya_0_99'])
    expect(breakdown.total).toBe(3)
  })

  it('families deliver independently: PA reported without YA leaves only YA pending', () => {
    const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: 0 })
    expect(derived.def_pa_0).toBe(1)
    expect(derived.def_pa_46_plus).toBe(0)
    for (const key of YA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(false)
    }
  })

  it('defensive: a non-finite raw source is unreported, not delivered', () => {
    const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: NaN })
    for (const key of PA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(derived, key), key).toBe(false)
    }
  })
})

describe('derivation hygiene', () => {
  it('is pure — the input object is not mutated', () => {
    const raw = { [DEF_PA_SOURCE_KEY]: 20, def_sack: 3 }
    const snapshot = { ...raw }
    deriveTierIndicators(raw)
    expect(raw).toEqual(snapshot)
  })

  it('derived families are authoritative: bogus inbound indicators are overwritten or stripped', () => {
    // with the source delivered: recomputed, not trusted
    const withSource = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: 20, def_pa_46_plus: 1 })
    expect(withSource.def_pa_46_plus).toBe(0)
    // without the source: stripped — an indicator can never outlive its source
    const withoutSource = deriveTierIndicators({ def_pa_46_plus: 1 })
    expect(Object.prototype.hasOwnProperty.call(withoutSource, 'def_pa_46_plus')).toBe(false)
  })
})
