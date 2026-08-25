/**
 * SE.1 — the cut-list pins.
 *
 * THE headline pin is "regenerates today's three families byte-exactly".
 * §7.3.3.1(a)'s own words: *"pin this equivalence by test — it is the whole
 * backward-compatibility argument."* Everything the format-2 envelope
 * reserves (`tier_cuts`) rests on it: if generated names drift from the
 * literal families by one character, every forked league scores its defense
 * against keys its rules document does not name — silently, as pending, for
 * the whole D/ST table.
 *
 * D146(1) — every ≥/≤ boundary here carries a fixture false by exactly one
 * unit. Cut lists are made of boundaries, so that rule does most of the work
 * in this file: each cut is pinned at the cut AND at cut−1.
 */

import { describe, expect, it } from 'vitest'

import {
  DEF_PA_BUCKETS,
  DEF_PA_SOURCE_KEY,
  DEF_YA_BUCKETS,
  DEF_YA_SOURCE_KEY,
  deriveTierIndicators,
} from './derive-stats'
import { SCORING_TEMPLATES } from './templates'
import {
  DEF_PA_FIRST_TIER,
  DEF_PA_PREFIX,
  DEF_YA_FIRST_TIER,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  YA_CUTS,
  tierBucketsFromCuts,
  tierKeysFromCuts,
} from './tier-cuts'

// ── Stored literals: today's three families, spelled out ───────────────────
// Deliberately NOT computed from DEF_PA_BUCKETS/DEF_YA_BUCKETS — that would
// prove the generator agrees with whatever the table happens to say. These
// are the key names the six shipped templates and migration 058's seeded
// rows actually carry (D62: golden pins are stored literals).

const SHARED_PA_KEYS = [
  'def_pa_0',
  'def_pa_1_6',
  'def_pa_7_13',
  'def_pa_14_20',
  'def_pa_21_27',
  'def_pa_28_34',
  'def_pa_35_plus',
]

const ESPN_PA_KEYS = [
  'def_pa_0',
  'def_pa_1_6',
  'def_pa_7_13',
  'def_pa_14_17',
  'def_pa_18_27',
  'def_pa_28_34',
  'def_pa_35_45',
  'def_pa_46_plus',
]

const YA_KEYS = [
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

/** Which cut list each shipped template's D/ST tables are drawn from (D44's
 *  `dst_model` distinction, as the picker's six cards actually ship it).
 *  ESPN pays a YA table on top; the single-model platforms pay PA only.
 *  Cut LISTS, not key lists, so the assertion below runs the generator
 *  against real rules documents rather than against another literal. */
const TEMPLATE_FAMILIES: Record<
  string,
  { pa: readonly number[]; ya: readonly number[] | null }
> = {
  'ESPN Standard': { pa: ESPN_PA_CUTS, ya: YA_CUTS },
  'ESPN Full PPR': { pa: ESPN_PA_CUTS, ya: YA_CUTS },
  'Yahoo Standard': { pa: SHARED_PA_CUTS, ya: null },
  'Yahoo Half PPR': { pa: SHARED_PA_CUTS, ya: null },
  'Sleeper Standard': { pa: SHARED_PA_CUTS, ya: null },
  'Sleeper Full PPR': { pa: SHARED_PA_CUTS, ya: null },
}

const keysWithPrefix = (obj: Record<string, unknown>, prefix: string) =>
  Object.keys(obj)
    .filter((key) => key.startsWith(`${prefix}_`))
    .sort()

const hotKeys = (derived: Record<string, number>, prefix: string) =>
  keysWithPrefix(derived, prefix).filter((key) => derived[key] === 1)

const derivePa = (pa: number, cuts?: readonly number[]) =>
  deriveTierIndicators(
    { [DEF_PA_SOURCE_KEY]: pa },
    cuts ? { def_pa: cuts } : undefined,
  )

const deriveYa = (ya: number, cuts?: readonly number[]) =>
  deriveTierIndicators(
    { [DEF_YA_SOURCE_KEY]: ya },
    cuts ? { def_ya: cuts } : undefined,
  )

describe('tierKeysFromCuts — the §7.3.3.1(a) generation rule', () => {
  it('REGENERATES TODAY’S THREE FAMILIES BYTE-EXACTLY (the whole backward-compatibility argument)', () => {
    expect(tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS)).toEqual(SHARED_PA_KEYS)
    expect(tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS)).toEqual(ESPN_PA_KEYS)
    expect(tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS)).toEqual(YA_KEYS)
  })

  it('cross-checks the GENERATED names against derive-stats.ts’s literal tables (both directions)', () => {
    // The PA literal table is the UNION of the two families (they share 4
    // key names: 0 / 1–6 / 7–13 / 28–34) — 7 + 8 − 4 = 11 rows.
    const generatedPa = [
      ...new Set([
        ...tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS),
        ...tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS),
      ]),
    ].sort()
    expect(generatedPa.length).toBe(11)
    expect(DEF_PA_BUCKETS.map((b) => b.key).sort()).toEqual(generatedPa)
    // The same union spelled out as stored literals, so a drift in BOTH the
    // generator and the table (or a table row silently renamed to match a
    // broken generator) still fails something.
    expect(generatedPa).toEqual([...new Set([...SHARED_PA_KEYS, ...ESPN_PA_KEYS])].sort())
    // YA has one family, so this one is exact and ordered.
    expect(DEF_YA_BUCKETS.map((b) => b.key)).toEqual(YA_KEYS)
    expect(tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS)).toEqual(
      DEF_YA_BUCKETS.map((b) => b.key),
    )
  })

  it('generates exactly the def_pa_*/def_ya_* keys the SIX SHIPPED TEMPLATES actually reference', () => {
    // The pin that matters commercially: the generator must name the keys
    // real rules documents pay. A fork writes its template's cut lists, so a
    // family that is not exactly its cut list's output would score the
    // forked league's D/ST as pending forever — silently, every week.
    expect(SCORING_TEMPLATES.map((t) => t.name).sort()).toEqual(
      Object.keys(TEMPLATE_FAMILIES).sort(),
    )
    for (const template of SCORING_TEMPLATES) {
      const expected = TEMPLATE_FAMILIES[template.name]
      expect(
        keysWithPrefix(template.rules, DEF_PA_PREFIX),
        `${template.name} def_pa keys`,
      ).toEqual(tierKeysFromCuts(DEF_PA_PREFIX, expected.pa).sort())
      expect(
        keysWithPrefix(template.rules, DEF_YA_PREFIX),
        `${template.name} def_ya keys`,
      ).toEqual(expected.ya ? tierKeysFromCuts(DEF_YA_PREFIX, expected.ya).sort() : [])
    }
  })

  it('names a single-value tier `<prefix>_<lo>` wherever it occurs, not only first (a documented generalization of the spec’s `def_pa_0` case)', () => {
    // §7.3.3.1(a) names only the single-value FIRST tier. All three shipped
    // families contain exactly one single-value tier and it is the first, so
    // this reading is unobservable today; F59's boundary editor is the first
    // caller that could construct another. Pinned so the choice is visible
    // rather than incidental.
    expect(tierKeysFromCuts('def_pa', [0, 5, 6, 10])).toEqual([
      'def_pa_0_4',
      'def_pa_5',
      'def_pa_6_9',
      'def_pa_10_plus',
    ])
  })

  it('refuses a malformed cut list LOUDLY — with the one-unit case on every guard (D146)', () => {
    // ≥ 2 cuts: two accepts, one rejects.
    expect(tierKeysFromCuts('def_pa', [0, 1])).toEqual(['def_pa_0', 'def_pa_1_plus'])
    expect(() => tierKeysFromCuts('def_pa', [0])).toThrow(/at least 2 cuts, got 1/)
    expect(() => tierKeysFromCuts('def_pa', [])).toThrow(/at least 2 cuts, got 0/)

    // Strictly ascending: +1 accepts, equal (one unit short of ascending)
    // rejects, descending rejects.
    expect(() => tierKeysFromCuts('def_pa', [0, 7, 7])).toThrow(/ascend strictly, got 7 then 7/)
    expect(() => tierKeysFromCuts('def_pa', [0, 7, 6])).toThrow(/ascend strictly, got 7 then 6/)

    // Integers: 14 accepts, 14.5 rejects — the same R58/D58 domain argument
    // that makes a fractional SOURCE value unmappable.
    expect(() => tierKeysFromCuts('def_pa', [0, 14.5])).toThrow(/must be integers, got 14.5/)
    expect(() => tierKeysFromCuts('def_ya', [0, Infinity])).toThrow(/must be integers/)
  })
})

describe('tierBucketsFromCuts — bounds, and the D174 first-tier reconciliation', () => {
  it('reproduces every literal bucket’s bounds exactly, family by family', () => {
    const literal = new Map(
      [...DEF_PA_BUCKETS, ...DEF_YA_BUCKETS].map((b) => [b.key, b]),
    )
    const generated = [
      ...tierBucketsFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS, DEF_PA_FIRST_TIER),
      ...tierBucketsFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS, DEF_PA_FIRST_TIER),
      ...tierBucketsFromCuts(DEF_YA_PREFIX, YA_CUTS, DEF_YA_FIRST_TIER),
    ]
    for (const bucket of generated) {
      expect(literal.get(bucket.key), bucket.key).toEqual(bucket)
    }
    // …and nothing in the literal tables is missing from the generated set.
    expect(new Set(generated.map((b) => b.key)).size).toBe(literal.size)
  })

  it('floors points-allowed at its first cut and opens yards-allowed below (D174)', () => {
    const pa = tierBucketsFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS, DEF_PA_FIRST_TIER)
    expect(pa[0]).toEqual({ key: 'def_pa_0', lo: 0, hi: 0 })
    expect(pa[pa.length - 1]).toEqual({ key: 'def_pa_35_plus', lo: 35, hi: Infinity })

    const ya = tierBucketsFromCuts(DEF_YA_PREFIX, YA_CUTS, DEF_YA_FIRST_TIER)
    expect(ya[0]).toEqual({ key: 'def_ya_0_99', lo: -Infinity, hi: 99 })
    expect(ya[ya.length - 1]).toEqual({ key: 'def_ya_550_plus', lo: 550, hi: Infinity })
  })
})

describe('deriveTierIndicators with cuts — the derive-agreement invariant (§7.3.3.1(a) “no behavior change”)', () => {
  it('is byte-identical to today’s behavior when no cuts are passed', () => {
    for (const pa of [0, 17, 46]) {
      const line = { [DEF_PA_SOURCE_KEY]: pa, [DEF_YA_SOURCE_KEY]: 289, def_sack: 3 }
      expect(deriveTierIndicators(line, undefined)).toEqual(deriveTierIndicators(line))
      // An envelope whose tier_cuts is absent per family falls back per
      // family — {} must not mean "no families".
      expect(deriveTierIndicators(line, {})).toEqual(deriveTierIndicators(line))
    }
  })

  it('AGREES WITH THE LITERAL TABLE for every integer PA 0–60, both families', () => {
    for (const [label, cuts, keys] of [
      ['shared', SHARED_PA_CUTS, SHARED_PA_KEYS],
      ['ESPN', ESPN_PA_CUTS, ESPN_PA_KEYS],
    ] as const) {
      for (let pa = 0; pa <= 60; pa++) {
        const fromCuts = derivePa(pa, cuts)
        const fromLiterals = derivePa(pa)
        // The cuts reading emits exactly its own family…
        expect(keysWithPrefix(fromCuts, DEF_PA_PREFIX), `${label} PA=${pa}`).toEqual(
          [...keys].sort(),
        )
        // …and every one of those keys carries the literal table's value.
        for (const key of keys) {
          expect(fromCuts[key], `${label} PA=${pa} ${key}`).toBe(fromLiterals[key])
        }
        // One-hot, per R58/D58's "absent or one-hot" invariant.
        expect(hotKeys(fromCuts, DEF_PA_PREFIX), `${label} PA=${pa}`).toHaveLength(1)
      }
    }
  })

  it('AGREES WITH THE LITERAL TABLE for every integer YA −20–620', () => {
    for (let ya = -20; ya <= 620; ya++) {
      const fromCuts = deriveYa(ya, YA_CUTS)
      const fromLiterals = deriveYa(ya)
      // YA has one family, so agreement here is whole-object equality.
      expect(fromCuts, `YA=${ya}`).toEqual(fromLiterals)
      expect(hotKeys(fromCuts, DEF_YA_PREFIX), `YA=${ya}`).toHaveLength(1)
    }
  })

  it('withholds the PA family for a negative or fractional source under BOTH readings (D174 / R58/D58)', () => {
    // D174 pins this exact case: §7.3.3.1(a) says "first open-below" while
    // the shipped table floors def_pa_0 at 0. The agreement clause decides
    // it — and the two readings are indistinguishable here because a floored
    // PA family withholds the negative value either way.
    for (const pa of [-1, -2, 13.5, 14.5]) {
      expect(keysWithPrefix(derivePa(pa), DEF_PA_PREFIX), `literal PA=${pa}`).toEqual([])
      expect(
        keysWithPrefix(derivePa(pa, SHARED_PA_CUTS), DEF_PA_PREFIX),
        `shared-cuts PA=${pa}`,
      ).toEqual([])
      expect(
        keysWithPrefix(derivePa(pa, ESPN_PA_CUTS), DEF_PA_PREFIX),
        `ESPN-cuts PA=${pa}`,
      ).toEqual([])
    }
    // One unit the other way: PA = 0 IS mappable and hots def_pa_0 under
    // both readings — the floor is a floor, not a hole.
    expect(hotKeys(derivePa(0), DEF_PA_PREFIX)).toEqual(['def_pa_0'])
    expect(hotKeys(derivePa(0, SHARED_PA_CUTS), DEF_PA_PREFIX)).toEqual(['def_pa_0'])
  })

  it('keeps yards-allowed open below zero, and withholds a fractional YA, under BOTH readings', () => {
    // A negative total-yards game is rare but real (derive-stats.ts:87).
    expect(hotKeys(deriveYa(-20), DEF_YA_PREFIX)).toEqual(['def_ya_0_99'])
    expect(hotKeys(deriveYa(-20, YA_CUTS), DEF_YA_PREFIX)).toEqual(['def_ya_0_99'])
    expect(hotKeys(deriveYa(-1, YA_CUTS), DEF_YA_PREFIX)).toEqual(['def_ya_0_99'])
    for (const ya of [99.5, -0.5]) {
      expect(keysWithPrefix(deriveYa(ya), DEF_YA_PREFIX), `literal YA=${ya}`).toEqual([])
      expect(keysWithPrefix(deriveYa(ya, YA_CUTS), DEF_YA_PREFIX), `cuts YA=${ya}`).toEqual([])
    }
  })

  it('hots the RIGHT tier at every cut, and the PREVIOUS one at cut − 1 (D146 — one unit from each boundary)', () => {
    for (const [label, cuts, keys] of [
      ['shared PA', SHARED_PA_CUTS, SHARED_PA_KEYS],
      ['ESPN PA', ESPN_PA_CUTS, ESPN_PA_KEYS],
    ] as const) {
      for (let i = 1; i < cuts.length; i++) {
        const cut = cuts[i]
        expect(hotKeys(derivePa(cut, cuts), DEF_PA_PREFIX), `${label} @${cut}`).toEqual([
          keys[i],
        ])
        expect(
          hotKeys(derivePa(cut - 1, cuts), DEF_PA_PREFIX),
          `${label} @${cut - 1}`,
        ).toEqual([keys[i - 1]])
      }
      // The floor itself: one unit below the first cut is UNMAPPABLE for PA.
      expect(
        keysWithPrefix(derivePa(cuts[0] - 1, cuts), DEF_PA_PREFIX),
        `${label} @${cuts[0] - 1}`,
      ).toEqual([])
    }

    for (let i = 1; i < YA_CUTS.length; i++) {
      const cut = YA_CUTS[i]
      expect(hotKeys(deriveYa(cut, YA_CUTS), DEF_YA_PREFIX), `YA @${cut}`).toEqual([
        YA_KEYS[i],
      ])
      expect(
        hotKeys(deriveYa(cut - 1, YA_CUTS), DEF_YA_PREFIX),
        `YA @${cut - 1}`,
      ).toEqual([YA_KEYS[i - 1]])
    }
    // YA's own first-cut case is the mirror image of PA's: one unit below
    // stays INSIDE the open-below first tier.
    expect(hotKeys(deriveYa(YA_CUTS[0] - 1, YA_CUTS), DEF_YA_PREFIX)).toEqual([
      'def_ya_0_99',
    ])
  })

  it('strips an inbound indicator the ACTIVE cut list generates but the literal tables do not name (D44 — an indicator is never stored, so an inbound value is by definition bogus)', () => {
    const derived = deriveTierIndicators(
      { [DEF_PA_SOURCE_KEY]: 20, def_pa_5_9: 1, def_pa_46_plus: 1 },
      { def_pa: [0, 5, 10] },
    )
    // def_pa_46_plus is swept by the literal-table pass; def_pa_5_9 is swept
    // ONLY by the active-table pass — the inbound 1 comes back as the
    // derivation's own 0, not as the caller's assertion.
    expect(keysWithPrefix(derived, DEF_PA_PREFIX)).toEqual([
      'def_pa_0_4',
      'def_pa_10_plus',
      'def_pa_5_9',
    ])
    expect(derived.def_pa_5_9).toBe(0)
    expect(hotKeys(derived, DEF_PA_PREFIX)).toEqual(['def_pa_10_plus'])
  })

  it('leaves a def_pa_* key that NEITHER table names alone — unchanged behavior, not a new sweep', () => {
    // Today's helper strips exactly the families it knows about; SE.1 widens
    // that to the active family and no further. Pinned so a later "just
    // strip everything def_pa_*" tidy-up is a visible behavior change.
    const derived = deriveTierIndicators({ [DEF_PA_SOURCE_KEY]: 20, def_pa_99: 1 })
    expect(derived.def_pa_99).toBe(1)
  })
})
