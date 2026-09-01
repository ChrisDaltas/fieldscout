/**
 * SE.2 — the format-2 envelope, the resolver, the normal form, the fork.
 *
 * THE headline pin is **the identity property**, and it is written as a
 * property rather than an example on purpose: §7.3.3.1's promise is *"no
 * existing template league's scored outcome changes by even a cent"*, and an
 * example proves that for one document at one position. The sweep below runs
 * every shipped template at every position the resolver can be handed — the
 * six, positions outside the six, the empty string, and the two prototype
 * names — and compares whole `ScoreBreakdown`s (total AND perKey AND
 * pending), plus a seeded sweep over random flat documents.
 *
 * Its twin is **fork-equivalence** (SE.2(5)): a template and its fork score
 * identically for all 8 templates × 6 positions × the five parity lines, under
 * BOTH tier readings — `derive-stats.ts`'s literal tables and the fork's own
 * `tier_cuts` — which is §7.3.3.1(a)'s "the two readings agree by
 * construction" made falsifiable.
 *
 * D146(1): the boundaries the normal form introduces each carry a fixture one
 * unit the other side — an override equal to base (strip) vs one cent away
 * (keep); an override of a key present in base at 0 (strip) vs absent from
 * base at 0 (KEEP, because absent and zero are different scored outcomes).
 *
 * The five canonical player-weeks are TRANSCRIBED from `template-parity.test.ts`
 * (L.A1.10), not imported: that suite is inside §4 rule 5's byte-identity floor
 * and importing a test module would re-register its 30 pins here. The
 * transcription is safe by construction — fork-equivalence is a property that
 * holds for ANY stat line, so a drifted copy could only narrow this suite's
 * coverage, never manufacture a passing pin.
 */

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '../stats/stat-keys'
import { mulberry32 } from '../stats/synthetic/prng'
import { scorePlayerWeek } from './calculator'
import { deriveTierIndicators } from './derive-stats'
import { SCORING_TEMPLATES } from './templates'
import { ESPN_PA_CUTS, SHARED_PA_CUTS, YA_CUTS } from './tier-cuts'
import {
  SCORING_DOC_FORMAT_2,
  SCORING_POSITIONS,
  detectTierCuts,
  forkTemplateDoc,
  isFormat1Doc,
  normalizeScoringDoc,
  resolveRules,
  type FlatScoringRules,
  type ScoringRulesDocV2,
} from './rules-doc'

/* ────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────── */

/** Every position string the resolver can meet: the six, two positions
 *  outside the six (`players.position` is free text), the empty string, and
 *  the two prototype names an own-property lookup must not fall through to. */
const ALL_POSITION_INPUTS: readonly string[] = [
  ...SCORING_POSITIONS,
  'FB',
  'DL',
  '',
  '__proto__',
  'constructor',
]

/** L.A1.10's five canonical player-weeks, transcribed (see the docblock). */
const QB_WEEK: Record<string, number> = {
  pass_yards: 287,
  pass_tds: 2,
  interceptions: 1,
  pass_2pt: 1,
  qb_sack_taken: 3,
  rush_yards: 14,
  rush_tds: 0,
  receptions: 0,
}
const RB_WEEK: Record<string, number> = {
  rush_yards: 112,
  rush_attempts: 24,
  rush_tds: 1,
  rush_2pt: 1,
  fumbles_lost: 1,
  receptions: 3,
  receiving_yards: 24,
  receiving_tds: 0,
}
const WR_TE_WEEK: Record<string, number> = {
  receptions: 8,
  targets: 11,
  receiving_yards: 94,
  receiving_tds: 1,
  rec_2pt: 1,
  rush_yards: 7,
  fumbles_lost: 0,
}
const K_WEEK: Record<string, number> = {
  fg_0_39: 1,
  fg_40_49: 1,
  fg_50_plus: 1,
  fg_missed: 1,
  pat_made: 3,
  pat_missed: 1,
  fg_made: 3,
  fg_attempted: 4,
}
const DST_WEEK: Record<string, number> = {
  def_points_allowed: 19,
  def_yards_allowed: 249,
  def_sack: 3,
  def_int: 1,
  def_fumble_rec: 1,
  def_td: 1,
  def_safety: 0,
  def_block: 0,
  def_return_td: 0,
}
const PARITY_LINES: ReadonlyArray<[string, Record<string, number>]> = [
  ['qb', QB_WEEK],
  ['rb', RB_WEEK],
  ['wr_te', WR_TE_WEEK],
  ['k', K_WEEK],
  ['dst', DST_WEEK],
]

const byName = (name: string): FlatScoringRules => {
  const t = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!t) throw new Error(`template not found: ${name}`)
  return t.rules
}

/** A minimal well-formed envelope, built by hand so the shape under test is
 *  visible rather than produced by the code under test. */
const envelope = (
  base: FlatScoringRules,
  positions: ScoringRulesDocV2['positions'],
): ScoringRulesDocV2 => ({
  format: 2,
  base,
  positions,
  tier_cuts: { def_pa: SHARED_PA_CUTS, def_ya: YA_CUTS },
})

/* ────────────────────────────────────────────────────────────────────────
 * 1. The discriminator
 * ──────────────────────────────────────────────────────────────────────── */

describe('the format discriminator — a flat map has no `format` member', () => {
  it('`format` IS NOT A REGISTRY KEY, which is what makes the discriminator unambiguous', () => {
    // §7.3.3.1: "no `format` member — `format` is not a registry key, so the
    // discriminator is unambiguous". If a stat key named `format` were ever
    // added, a template paying it would be misread as an envelope.
    expect(STAT_KEYS.map((k) => k.key)).not.toContain('format')
  })

  it('every shipped template is format 1, and an envelope is not', () => {
    for (const t of SCORING_TEMPLATES) {
      expect(isFormat1Doc(t.rules), `${t.name} must stay format 1`).toBe(true)
      expect(isFormat1Doc(forkTemplateDoc(t.rules))).toBe(false)
    }
  })

  it('an empty map is format 1; a non-object is neither', () => {
    expect(isFormat1Doc({})).toBe(true)
    expect(isFormat1Doc(null)).toBe(false)
    expect(isFormat1Doc(undefined)).toBe(false)
    expect(isFormat1Doc([])).toBe(false)
    expect(isFormat1Doc('ppr')).toBe(false)
    expect(isFormat1Doc(2)).toBe(false)
  })

  it('reads `format` as an OWN member — an inherited one does not make an envelope', () => {
    const inherited = Object.create({ format: 2 }) as Record<string, number>
    inherited.receptions = 1
    expect(isFormat1Doc(inherited)).toBe(true)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 2. THE IDENTITY PROPERTY
 * ──────────────────────────────────────────────────────────────────────── */

describe('resolveRules — THE IDENTITY PROPERTY (format 1 ≡ resolved, every position)', () => {
  it('returns THE DOCUMENT ITSELF for every template at every position input', () => {
    let comparisons = 0
    for (const t of SCORING_TEMPLATES) {
      for (const position of ALL_POSITION_INPUTS) {
        // Reference-exact: there is no copy in which a value could drift.
        expect(
          resolveRules(t.rules, position),
          `${t.name} @ "${position}"`,
        ).toBe(t.rules)
        comparisons++
      }
    }
    expect(comparisons).toBe(SCORING_TEMPLATES.length * ALL_POSITION_INPUTS.length)
    expect(comparisons).toBe(88) // 8 templates × 11 position inputs (SC.4)
  })

  it('SCORES IDENTICALLY resolved-or-not: 8 templates × 11 position inputs × 5 parity lines, whole breakdowns', () => {
    let comparisons = 0
    for (const t of SCORING_TEMPLATES) {
      for (const [lineName, raw] of PARITY_LINES) {
        const stats = deriveTierIndicators(raw)
        const direct = scorePlayerWeek(t.rules, stats)
        for (const position of ALL_POSITION_INPUTS) {
          const viaResolver = scorePlayerWeek(resolveRules(t.rules, position), stats)
          expect(
            viaResolver,
            `${t.name} @ "${position}" on ${lineName}`,
          ).toStrictEqual(direct)
          comparisons++
        }
      }
    }
    expect(comparisons).toBe(440) // 8 templates × 11 inputs × 5 lines (SC.4)
  })

  it('holds for 200 seeded random flat documents at a random position', () => {
    const rng = mulberry32(0x5e_02_01)
    const keys = STAT_KEYS.filter((k) => k.scoring_surface === 'scorable').map((k) => k.key)
    expect(keys.length).toBe(48)

    for (let run = 0; run < 200; run++) {
      const doc: FlatScoringRules = {}
      const size = 1 + Math.floor(rng() * 12)
      for (let i = 0; i < size; i++) {
        doc[keys[Math.floor(rng() * keys.length)]] =
          Math.round((rng() * 200 - 100) * 100) / 100
      }
      const position = ALL_POSITION_INPUTS[Math.floor(rng() * ALL_POSITION_INPUTS.length)]
      expect(resolveRules(doc, position), `run ${run} @ "${position}"`).toBe(doc)
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 3. resolveRules — the format-2 arm
 * ──────────────────────────────────────────────────────────────────────── */

describe('resolveRules — format 2 is `{...base, ...positions[P]}`', () => {
  const base: FlatScoringRules = { receptions: 0.5, receiving_tds: 6, pass_tds: 4 }

  it('the OVERRIDE WINS for its own position and touches no other', () => {
    const doc = envelope(base, { TE: { receptions: 1.5 }, K: { pass_tds: 0 } })
    expect(resolveRules(doc, 'TE')).toStrictEqual({
      receptions: 1.5,
      receiving_tds: 6,
      pass_tds: 4,
    })
    expect(resolveRules(doc, 'WR')).toStrictEqual(base)
    expect(resolveRules(doc, 'K')).toStrictEqual({
      receptions: 0.5,
      receiving_tds: 6,
      pass_tds: 0,
    })
  })

  it('an explicit 0 override switches the category OFF for that position — and that is NOT the same as dropping the key (D59(4))', () => {
    const doc = envelope(base, { TE: { receptions: 0 } })
    const resolved = resolveRules(doc, 'TE')
    expect(resolved.receptions).toBe(0)

    // Delivered → a real perKey 0, never pending (F20/§23.5).
    const delivered = scorePlayerWeek(resolved, { receptions: 9, receiving_tds: 1 })
    expect(delivered.perKey.receptions).toBe(0)
    expect(delivered.pending).not.toContain('receptions')
    expect(delivered.total).toBe(6)

    // Undelivered → pending, NOT a silent zero — the observable difference
    // between "scored, worth nothing" and "not scored at all".
    const undelivered = scorePlayerWeek(resolved, { receiving_tds: 1 })
    expect(undelivered.pending).toContain('receptions')
  })

  it('a position ABSENT from `positions` resolves to base alone — including positions outside the six', () => {
    const doc = envelope(base, { TE: { receptions: 1.5 } })
    for (const position of ['QB', 'RB', 'WR', 'K', 'DST', 'FB', 'DL', '']) {
      expect(resolveRules(doc, position), `@ "${position}"`).toStrictEqual(base)
    }
  })

  it('`__proto__` and `constructor` resolve to base alone — own-property lookup, not the prototype chain', () => {
    const doc = envelope(base, {})
    expect(resolveRules(doc, '__proto__')).toStrictEqual(base)
    expect(resolveRules(doc, 'constructor')).toStrictEqual(base)
  })

  it('is PURE — the returned map is a copy, and the document is never mutated', () => {
    const doc = envelope({ ...base }, { TE: { receptions: 1.5 } })
    const snapshot = JSON.stringify(doc)

    // The two casts below are the test deliberately doing what the return
    // type now FORBIDS (R586 — `Readonly<FlatScoringRules>`): without them
    // these lines are compile errors, which is the point. The runtime pin
    // stays because the document also arrives from JSON at runtime, where no
    // type protects it.
    const resolved = resolveRules(doc, 'WR')
    expect(resolved).not.toBe(doc.base)
    ;(resolved as FlatScoringRules).receptions = 99
    expect(doc.base.receptions).toBe(0.5)

    const overridden = resolveRules(doc, 'TE')
    ;(overridden as FlatScoringRules).receptions = 99
    expect(doc.positions.TE).toStrictEqual({ receptions: 1.5 })

    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('REFUSES AN UNKNOWN FORMAT LOUDLY — a format-3 document must never be read as flat or as base-only', () => {
    // The one silently-plausible outcome is the dangerous one: a future
    // format read under today's rules scores a whole league wrong with no
    // error anywhere (CLAUDE.md — never let "nothing happened" mean "it
    // worked").
    expect(() => resolveRules({ format: 3, base: {} } as never, 'WR')).toThrow(/format 3/)
    expect(() => resolveRules({ format: '2' } as never, 'WR')).toThrow(/format "2"/)
    expect(() => resolveRules({ format: 1 } as never, 'WR')).toThrow(/format 1/)
  })

  it('refuses a malformed envelope LOUDLY, naming the member', () => {
    expect(() => resolveRules({ format: 2 } as never, 'WR')).toThrow(/"base"/)
    expect(() => resolveRules({ format: 2, base: [] } as never, 'WR')).toThrow(/"base"/)
    expect(() => resolveRules({ format: 2, base: {} } as never, 'WR')).toThrow(/"positions"/)
    expect(() =>
      resolveRules({ format: 2, base: {}, positions: [] } as never, 'WR'),
    ).toThrow(/"positions"/)
    expect(() =>
      resolveRules({ format: 2, base: {}, positions: { WR: 3 } } as never, 'WR'),
    ).toThrow(/positions\.WR/)
    expect(() => resolveRules(null as never, 'WR')).toThrow(/not an object/)
  })

  it('leaves coefficient corruption to the calculator — one owner per check (R59/D58)', () => {
    // The resolver SELECTS keys; a non-finite coefficient is `scorePlayerWeek`'s
    // trust boundary, and duplicating it here would be a second mirror.
    const doc = envelope({ receptions: Number.NaN }, {})
    expect(() => resolveRules(doc, 'WR')).not.toThrow()
    expect(() => scorePlayerWeek(resolveRules(doc, 'WR'), {})).toThrow(/corrupt/)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 4. normalizeScoringDoc
 * ──────────────────────────────────────────────────────────────────────── */

describe('normalizeScoringDoc — the normal form the All-Positions switch rides on', () => {
  const base: FlatScoringRules = { receptions: 0.5, receiving_tds: 6 }

  it('strips an override EQUAL to base, and keeps one a single cent away (D146)', () => {
    const stripped = normalizeScoringDoc(
      envelope(base, { TE: { receptions: 0.5 } }),
    ) as ScoringRulesDocV2
    expect(stripped.positions).toStrictEqual({})

    const kept = normalizeScoringDoc(
      envelope(base, { TE: { receptions: 0.51 } }),
    ) as ScoringRulesDocV2
    expect(kept.positions).toStrictEqual({ TE: { receptions: 0.51 } })
  })

  it('strips an EMPTY override object, and a partially-stripped one that empties', () => {
    const doc = envelope(base, {
      TE: {},
      WR: { receptions: 0.5, receiving_tds: 6 },
      RB: { receptions: 0.5, receiving_tds: 7 },
    })
    const out = normalizeScoringDoc(doc) as ScoringRulesDocV2
    expect(out.positions).toStrictEqual({ RB: { receiving_tds: 7 } })
  })

  it('strips a `-0` override over a `0` base — score-identical, and `JSON.stringify(-0)` is "0"', () => {
    const out = normalizeScoringDoc(
      envelope({ receptions: 0 }, { TE: { receptions: -0 } }),
    ) as ScoringRulesDocV2
    expect(out.positions).toStrictEqual({})
  })

  it('KEEPS an override of a key the base does NOT carry, even at 0 — absent and zero are different scored outcomes', () => {
    // The one-unit case that matters most here: `0` against a base value of
    // `0` is a no-op, but `0` against an ABSENT base key is not — it adds the
    // key, and an undelivered stat then lands in `pending` instead of being
    // ignored (§23.5/E61).
    const doc = envelope({ receiving_tds: 6 }, { TE: { receptions: 0 } })
    const out = normalizeScoringDoc(doc) as ScoringRulesDocV2
    expect(out.positions).toStrictEqual({ TE: { receptions: 0 } })

    expect(scorePlayerWeek(resolveRules(out, 'TE'), { receiving_tds: 1 }).pending).toContain(
      'receptions',
    )
    expect(scorePlayerWeek(resolveRules(out, 'WR'), { receiving_tds: 1 }).pending).not.toContain(
      'receptions',
    )
  })

  it('PRESERVES a position key outside the six — normal form is a strip, not a validator', () => {
    // Dropping it would let an invalid document launder itself into validity
    // by being normalized first; guardrail 3 (SE.3/SE.4) is what rejects it.
    const out = normalizeScoringDoc(
      envelope(base, { FB: { receptions: 1 } } as never),
    ) as ScoringRulesDocV2
    expect(out.positions).toStrictEqual({ FB: { receptions: 1 } })
  })

  it('PRESERVES a `__proto__` position key as an OWN key, and never installs it as a prototype (R582)', () => {
    // `__proto__` is the one key name where "copy the entries into a fresh
    // object" is not a copy: plain-object assignment invokes the inherited
    // setter, which DELETES the entry and silently re-parents the result.
    // A document from the database is `JSON.parse`d, which does create an own
    // `__proto__` data property — so this shape is reachable, and the two
    // claims it would falsify are this file's own: the preserve rule above,
    // and the never-changes-a-scored-outcome property below.
    const doc = JSON.parse(
      '{"format":2,"base":{"receptions":0.5,"receiving_tds":6},' +
        '"positions":{"FB":{"receptions":2},"__proto__":{"receptions":1}},' +
        '"tier_cuts":{"def_pa":[0,1,7,14,21,28,35],"def_ya":[0,100,200,300,350,400,450,500,550]}}',
    ) as ScoringRulesDocV2

    expect(Object.keys(doc.positions)).toStrictEqual(['FB', '__proto__'])

    const out = normalizeScoringDoc(doc) as ScoringRulesDocV2
    expect(Object.keys(out.positions)).toStrictEqual(['FB', '__proto__'])
    expect(Object.getPrototypeOf(out.positions)).toBe(Object.prototype)
    expect(JSON.parse(JSON.stringify(out.positions)).__proto__).toStrictEqual({
      receptions: 1,
    })
  })

  it('the same key name inside an OVERRIDE survives normalization too (R582, second accumulator)', () => {
    const doc = JSON.parse(
      '{"format":2,"base":{"receptions":0.5},' +
        '"positions":{"TE":{"receptions":1,"__proto__":3}},' +
        '"tier_cuts":{"def_pa":[0,1,7,14,21,28,35],"def_ya":[0,100,200,300,350,400,450,500,550]}}',
    ) as ScoringRulesDocV2

    const out = normalizeScoringDoc(doc) as ScoringRulesDocV2
    expect(Object.keys(out.positions.TE ?? {})).toStrictEqual(['receptions', '__proto__'])
    expect(Object.getPrototypeOf(out.positions.TE)).toBe(Object.prototype)
  })

  it('is IDEMPOTENT — normalize ∘ normalize ≡ normalize', () => {
    const docs: ScoringRulesDocV2[] = [
      envelope(base, {}),
      envelope(base, { TE: {}, WR: { receptions: 0.5 } }),
      envelope(base, { TE: { receptions: 1.5 }, RB: { receiving_tds: 6, receptions: 0 } }),
      forkTemplateDoc(byName('ESPN Full PPR')),
    ]
    for (const [i, doc] of docs.entries()) {
      const once = normalizeScoringDoc(doc)
      expect(normalizeScoringDoc(once), `doc ${i}`).toStrictEqual(once)
    }
  })

  it('NEVER CHANGES A SCORED OUTCOME — resolveRules(normalize(d), P) ≡ resolveRules(d, P) at every position', () => {
    // The `positions` map is JSON-parsed so it can carry an OWN `__proto__`
    // key (R582) — `ALL_POSITION_INPUTS` resolves at `__proto__`, so an
    // accumulator that dropped or re-parented that entry would move a scored
    // outcome and this property is what has to see it.
    const doc: ScoringRulesDocV2 = {
      ...envelope(base, {}),
      positions: JSON.parse(
        '{"TE":{"receptions":0.5},"WR":{"receptions":1},"RB":{},' +
          '"K":{"receiving_tds":6,"receptions":0.25},"__proto__":{"receptions":0.75}}',
      ),
    }
    const normalized = normalizeScoringDoc(doc)
    for (const position of ALL_POSITION_INPUTS) {
      expect(
        resolveRules(normalized, position),
        `@ "${position}"`,
      ).toStrictEqual(resolveRules(doc, position))
    }
  })

  it('makes the ALL-POSITIONS SWITCH STATE round-trip from the document alone', () => {
    // §7.3.3.1: a section shows All-Positions ON iff none of its keys carry a
    // position override. SE.7 composes its section catalog over this; the
    // property that makes it possible is that in a NORMALIZED document every
    // surviving override is OBSERVABLE.
    const overriddenKeys = (doc: ScoringRulesDocV2): string[] =>
      [...new Set(Object.values(doc.positions).flatMap((o) => Object.keys(o ?? {})))].sort()

    const withNoOp = envelope(base, { TE: { receptions: 0.5 }, WR: { receptions: 1 } })

    // Un-normalized, the derivation is WRONG about `receptions`' section for
    // TE: the key looks overridden while the value is the base value.
    expect(overriddenKeys(withNoOp)).toStrictEqual(['receptions'])
    expect(resolveRules(withNoOp, 'TE').receptions).toBe(base.receptions)

    const normalized = normalizeScoringDoc(withNoOp) as ScoringRulesDocV2
    for (const [position, override] of Object.entries(normalized.positions)) {
      for (const key of Object.keys(override ?? {})) {
        expect(
          resolveRules(normalized, position)[key],
          `${position}.${key} survived normalization and must be observable`,
        ).not.toBe(normalized.base[key])
      }
    }
    expect(normalized.positions).toStrictEqual({ WR: { receptions: 1 } })
  })

  it('a format-1 document is already in normal form — the same object back', () => {
    for (const t of SCORING_TEMPLATES) {
      expect(normalizeScoringDoc(t.rules)).toBe(t.rules)
    }
  })

  it('refuses a malformed envelope LOUDLY, like the resolver', () => {
    expect(() => normalizeScoringDoc({ format: 3 } as never)).toThrow(/format 3/)
    expect(() =>
      normalizeScoringDoc({ format: 2, base: {}, positions: { WR: 3 } } as never),
    ).toThrow(/positions\.WR/)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 5. forkTemplateDoc + detectTierCuts
 * ──────────────────────────────────────────────────────────────────────── */

describe('forkTemplateDoc — a template becomes the league’s own format-2 document', () => {
  it('carries the template’s flat map VERBATIM as `base` — as a copy, so a fork can never edit its template', () => {
    for (const t of SCORING_TEMPLATES) {
      const fork = forkTemplateDoc(t.rules)
      expect(fork.format).toBe(SCORING_DOC_FORMAT_2)
      expect(fork.base, t.name).toStrictEqual(t.rules)
      expect(fork.base).not.toBe(t.rules)
      expect(fork.positions).toStrictEqual({})

      fork.base.receptions = 42
      expect(t.rules.receptions, `${t.name} must be untouched`).not.toBe(42)
    }
  })

  it('INHERITS the starting family’s cut lists — ESPN + Scout rows ESPN, Yahoo/Sleeper shared, and the YA slot is ALWAYS written', () => {
    // Stored literals (D62), not re-derived from the constants under test.
    const espn = [0, 1, 7, 14, 18, 28, 35, 46]
    const shared = [0, 1, 7, 14, 21, 28, 35]
    const ya = [0, 100, 200, 300, 350, 400, 450, 500, 550]

    const expected: Record<string, number[]> = {
      // The Scout pair rides the ESPN split families (App B.5 markup
      // ruling, SC.1; one shared body one value apart — B.5.1, SC.4).
      'Scout Standard': espn,
      'Scout PPR': espn,
      'ESPN Standard': espn,
      'ESPN Full PPR': espn,
      'Yahoo Standard': shared,
      'Yahoo Half PPR': shared,
      'Sleeper Standard': shared,
      'Sleeper Full PPR': shared,
    }

    for (const t of SCORING_TEMPLATES) {
      const fork = forkTemplateDoc(t.rules)
      expect([...fork.tier_cuts.def_pa], t.name).toStrictEqual(expected[t.name])
      // §7.3.3.1's printed shape writes both tables unconditionally: a
      // single-model document simply pays no def_ya_* keys (asserted next).
      expect([...fork.tier_cuts.def_ya], t.name).toStrictEqual(ya)
    }

    const yahoo = byName('Yahoo Standard')
    expect(Object.keys(yahoo).filter((k) => k.startsWith('def_ya_'))).toStrictEqual([])
    expect([...forkTemplateDoc(yahoo).tier_cuts.def_ya]).toStrictEqual(ya)
  })

  it('agrees with SE.1’s named cut lists (the fork writes the constants, not a second copy)', () => {
    expect(forkTemplateDoc(byName('ESPN Standard')).tier_cuts.def_pa).toBe(ESPN_PA_CUTS)
    expect(forkTemplateDoc(byName('Yahoo Standard')).tier_cuts.def_pa).toBe(SHARED_PA_CUTS)
    expect(forkTemplateDoc(byName('Sleeper Full PPR')).tier_cuts.def_ya).toBe(YA_CUTS)
  })

  it('DETECTS THE FAMILY FROM THE KEY SET, never from a name — swapping only the divergent keys flips it', () => {
    const espnRules = byName('ESPN Standard')
    expect(detectTierCuts(espnRules).def_pa).toBe(ESPN_PA_CUTS)

    // Same document, same everything else: replace ESPN's four divergent PA
    // rows with the shared family's three. Nothing about the name changed —
    // only the keys — and the detection follows the keys.
    const swapped: FlatScoringRules = { ...espnRules }
    for (const key of ['def_pa_14_17', 'def_pa_18_27', 'def_pa_35_45', 'def_pa_46_plus']) {
      delete swapped[key]
    }
    Object.assign(swapped, { def_pa_14_20: 1, def_pa_21_27: 0, def_pa_35_plus: -4 })
    expect(detectTierCuts(swapped).def_pa).toBe(SHARED_PA_CUTS)
  })

  it('REFUSES an AMBIGUOUS points-allowed key set rather than guessing a family', () => {
    // The two families share exactly four names; a document naming only those
    // belongs to both, and picking one would silently re-cut the defense.
    const ambiguous: FlatScoringRules = {
      def_pa_0: 10,
      def_pa_1_6: 7,
      def_pa_7_13: 4,
      def_pa_28_34: -1,
    }
    expect(() => detectTierCuts(ambiguous)).toThrow(/match 2 published families/)

    // One divergent key each way disambiguates — the one-unit case (D146).
    expect(detectTierCuts({ ...ambiguous, def_pa_35_plus: -4 }).def_pa).toBe(SHARED_PA_CUTS)
    expect(detectTierCuts({ ...ambiguous, def_pa_46_plus: -5 }).def_pa).toBe(ESPN_PA_CUTS)
  })

  it('refuses a document with NO points-allowed keys, and one whose YA keys are cut elsewhere', () => {
    expect(() => detectTierCuts({ receptions: 1 })).toThrow(/no def_pa_\* keys/)
    expect(() => detectTierCuts({ def_pa_9_99: 1 })).toThrow(/match 0 published families/)
    expect(() =>
      detectTierCuts({ ...byName('Yahoo Standard'), def_ya_0_49: 5 }),
    ).toThrow(/def_ya_0_49/)
  })

  it('refuses to fork a document that is already an envelope', () => {
    const fork = forkTemplateDoc(byName('ESPN Standard'))
    expect(() => forkTemplateDoc(fork as never)).toThrow(/format-1 template/)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 6. THE FORK-EQUIVALENCE PROPERTY (SE.2(5) / §7.3.3.1's QA bullet)
 * ──────────────────────────────────────────────────────────────────────── */

describe('fork-equivalence — a fork scores EXACTLY like its template, everywhere', () => {
  it('8 templates × 6 positions × 5 parity lines × 2 tier readings: totals AND perKey AND pending', () => {
    let comparisons = 0

    for (const t of SCORING_TEMPLATES) {
      const fork = forkTemplateDoc(t.rules)

      for (const [lineName, raw] of PARITY_LINES) {
        // Reading (a): today's literal tables — the production composition.
        const literalStats = deriveTierIndicators(raw)
        // Reading (b): the fork's OWN tier_cuts. §7.3.3.1(a) — "a doc carrying
        // tier_cuts scores the same whether the engine derives from cuts or
        // from derive-stats.ts's literals". `EnvelopeTierCuts` is a legal
        // derive parameter (SE.1/R577); this is that assignability at a call
        // site, not in a type test.
        const cutsStats = deriveTierIndicators(raw, fork.tier_cuts)

        const direct = scorePlayerWeek(t.rules, literalStats)

        for (const position of SCORING_POSITIONS) {
          const resolved = resolveRules(fork, position)
          expect(
            scorePlayerWeek(resolved, literalStats),
            `${t.name} @ ${position} on ${lineName} (literal tables)`,
          ).toStrictEqual(direct)
          expect(
            scorePlayerWeek(resolved, cutsStats),
            `${t.name} @ ${position} on ${lineName} (the fork's own tier_cuts)`,
          ).toStrictEqual(direct)
          comparisons += 2
        }
      }
    }

    // 8 templates × 6 positions × 5 lines × 2 tier readings (SC.4).
    expect(comparisons).toBe(480)
  })

  it('survives normalization — normalize(fork(T)) still scores like T', () => {
    for (const t of SCORING_TEMPLATES) {
      const normalized = normalizeScoringDoc(forkTemplateDoc(t.rules))
      for (const [lineName, raw] of PARITY_LINES) {
        const stats = deriveTierIndicators(raw)
        for (const position of SCORING_POSITIONS) {
          expect(
            scorePlayerWeek(resolveRules(normalized, position), stats),
            `${t.name} @ ${position} on ${lineName}`,
          ).toStrictEqual(scorePlayerWeek(t.rules, stats))
        }
      }
    }
  })

  it('the D/ST line is the one that could break silently — pin what it actually pays, per family', () => {
    // PA 19 / YA 249 (the L.A1.10 line) sits where the families diverge:
    // ESPN pays def_pa_18_27 (0) plus def_ya_200_299 (+2); the shared family
    // pays def_pa_14_20 (+1) and no YA table at all. If a fork inherited the
    // WRONG cut list, the template's own tier keys would stop being generated
    // and would fall to `pending` instead of scoring — which is exactly the
    // failure this property has to be able to see.
    const espnFork = forkTemplateDoc(byName('ESPN Standard'))
    const espn = scorePlayerWeek(
      resolveRules(espnFork, 'DST'),
      deriveTierIndicators(DST_WEEK, espnFork.tier_cuts),
    )
    expect(espn.perKey.def_pa_18_27).toBe(0)
    expect(espn.perKey.def_ya_200_299).toBe(2)
    // No DEFENSIVE key is pending — the offensive/kicking keys are, because
    // this line delivers no offense (that is L.A1.10's fixture, unchanged).
    expect(espn.pending.filter((k) => k.startsWith('def_'))).toStrictEqual([])
    expect(espn.total).toBe(15)

    const yahooFork = forkTemplateDoc(byName('Yahoo Standard'))
    const yahoo = scorePlayerWeek(
      resolveRules(yahooFork, 'DST'),
      deriveTierIndicators(DST_WEEK, yahooFork.tier_cuts),
    )
    expect(yahoo.perKey.def_pa_14_20).toBe(1)
    expect(yahoo.pending.filter((k) => k.startsWith('def_'))).toStrictEqual([])
    expect(yahoo.total).toBe(14)
  })
})
