/**
 * SE.3 — the §7.3.3.1 guardrail validator, TS side (F21's validator half).
 *
 * The suite is organised the way the law is: **one describe per guardrail
 * family**, each carrying (a) its NAMED rejection — the message says which
 * guardrail refused and why (the E75 shape) — and (b) the D146(1) one-unit
 * pins, a fixture on each side of every ≥/≤/count/boundary the family owns.
 *
 * Two things are pinned here that are easy to write as prose and hard to
 * write as a test, so they are written as tests:
 *
 *  - **The F21 defect is REAL, not assumed.** Before pinning that
 *    `def_pa_14_20` + `def_pa_18_27` is refused, the suite runs a PA-19 week
 *    through the shipped derivation and the shipped calculator and shows the
 *    document paying BOTH tiers for the same week. The guardrail's premise is
 *    measured, so the rejection pin cannot be decoration.
 *  - **The transcribed position catalog is proved against the registry.**
 *    Guardrail 3 needs a position→keys map that no registry field carries, so
 *    it is transcribed from §7.3.3.1's section-catalog sentence — and then
 *    proved: the six sets are pairwise disjoint and their union IS the
 *    registry's `scoring_surface: 'scorable'` set. A drift on either side reds.
 *
 * Acceptance floor (SE.3(3)): all six templates pass the format-1 arm, all six
 * forks pass the format-2 arm, and a legal hand-built override document passes.
 * Every rejection fixture below is one edit away from a document in that floor.
 */

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '../stats/stat-keys'
import { scorePlayerWeek } from './calculator'
import { deriveTierIndicators } from './derive-stats'
// The fixture builders and `ONE_FAMILY_EACH` live in `parity-fixture.ts` from
// SE.4 on — one definition, run through BOTH validators (D168(1)).
import {
  ONE_FAMILY_EACH,
  espnFork,
  template,
  withBase,
  withCuts,
  withOverride,
  yahooFork,
} from './parity-fixture'
import {
  SCORING_POSITIONS,
  forkTemplateDoc,
  normalizeScoringDoc,
  resolveRules,
  type ScoringPosition,
  type ScoringRulesDocV2,
} from './rules-doc'
import { SCORING_TEMPLATES } from './templates'
import {
  DEF_PA_PREFIX,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  YA_CUTS,
  tierKeysFromCuts,
} from './tier-cuts'
import {
  MAX_ABS_COEFFICIENT,
  MAX_REPORTED_VIOLATIONS,
  POSITION_SCORABLE_KEYS,
  SCORABLE_KEYS,
  scoringRulesDocSchema,
  validateScoringRulesDoc,
  type ScoringGuardrail,
  type ScoringValidationResult,
} from './validate-rules-doc'

/* ────────────────────────────────────────────────────────────────────────
 * Fixtures and helpers
 * ──────────────────────────────────────────────────────────────────────── */

// The builders and the one-family-each corpus MOVED to `parity-fixture.ts`
// at SE.4 and are imported back here (see the import block above). They are
// the TS half of the TS≡SQL parity fixture D168(1) requires, and "shared"
// there means ONE definition — a copy in each suite would recreate, one level
// up, exactly the drift the fixture exists to prevent (D269(7): "that array is
// the TS half of SE.4(4)'s parity fixture, ready to lift"). Nothing about
// their contents changed in the lift.

const codes = (result: ScoringValidationResult): ScoringGuardrail[] =>
  result.violations.map((v) => v.code)
const paths = (result: ScoringValidationResult): string[] =>
  result.violations.map((v) => v.path)

/** Assert a document is accepted, and say what was rejected when it is not —
 *  a bare `toBe(true)` on a 40-key document is unreadable when it reds. */
const expectAccepted = (doc: unknown): void => {
  const result = validateScoringRulesDoc(doc)
  expect(result.violations).toEqual([])
  expect(result.valid).toBe(true)
}

/** Assert exactly one violation, of `code`, at `path`, whose message names its
 *  own guardrail family (E75) — the "named rejection" of SE.3(2). */
const expectRejection = (
  doc: unknown,
  code: ScoringGuardrail,
  path: string,
  messagePattern: RegExp,
): ScoringValidationResult => {
  const result = validateScoringRulesDoc(doc)
  expect(codes(result)).toEqual([code])
  expect(paths(result)).toEqual([path])
  expect(result.violations[0].message).toMatch(messagePattern)
  expect(result.valid).toBe(false)
  return result
}

/** The seven family names as they must appear in a message — stored literals,
 *  so a message that stops naming its family reds.
 *
 *  **`document_shape`'s entry was `/§7\.3\.3\.1/` in the first cut, which all
 *  42 messages this module can emit satisfy — including 28 belonging to other
 *  families (R596). For that family the property proved only "cites the
 *  section", and renaming the front-door refusal to claim guardrail 2, or
 *  replacing it with the bare "invalid scoring rules" its own docblock swears
 *  off, left the suite green.** Every entry is now a prefix no other family's
 *  message can match, and the mutual exclusivity is itself pinned below. */
const FAMILY_NAME_IN_MESSAGE: Record<ScoringGuardrail, RegExp> = {
  document_shape: /Document shape \(§7\.3\.3\.1/,
  scorable_allowlist: /Scorable allowlist \(§7\.3\.3\.1 guardrail 1\)/,
  tier_exclusivity: /Tier exclusivity \(§7\.3\.3\.1 guardrail 2\)/,
  position_scope: /Position scope \(§7\.3\.3\.1 guardrail 3\)/,
  normal_form: /Normal form \(§7\.3\.3\.1 guardrail 4\)/,
  bounds: /Bounds \(§7\.3\.3\.1 guardrail 5\)/,
  tier_cuts: /Tier cuts \(§7\.3\.3\.1/,
}

/* ────────────────────────────────────────────────────────────────────────
 * The acceptance floor (SE.3(3)) — every rejection below is one edit from here
 * ──────────────────────────────────────────────────────────────────────── */

describe('the acceptance floor (SE.3(3))', () => {
  it.each(SCORING_TEMPLATES.map((t) => t.name))(
    'the shipped template %s passes the format-1 arm',
    (name) => {
      expectAccepted(template(name))
    },
  )

  it.each(SCORING_TEMPLATES.map((t) => t.name))(
    'forkTemplateDoc(%s) passes the format-2 arm',
    (name) => {
      expectAccepted(forkTemplateDoc(template(name)))
    },
  )

  it('a hand-built TE-premium document passes (§7.3.3.1s own worked example)', () => {
    // The editor's headline use case: receptions worth more to a TE than to
    // everyone else. Legal in every family — a scorable key, generated tiers
    // untouched, a real position, a real override (0.5 ≠ the base 1), 2dp.
    expectAccepted(withOverride(espnFork(), 'TE', { receptions: 1.5 }))
  })

  it('an explicit 0 override is a real override, not a no-op (D59(4))', () => {
    // "Scored and worth nothing" is a different scored outcome from "not
    // scored at all" — a delivered stat yields a real perKey: 0 rather than
    // landing in `pending`. The base pays fg_missed −1; switching the miss
    // penalty off for kickers is a legal edit, not a normal-form violation.
    const doc = withOverride(espnFork(), 'K', { fg_missed: 0 })
    expect(doc.base.fg_missed).toBe(-1)
    expectAccepted(doc)
  })

  it('every accepted format-2 document is a FIXED POINT of normalizeScoringDoc', () => {
    // Guardrail 4 composes `normalizeScoringDoc` rather than re-implementing
    // the strip, and this is that composition stated as a property: if the
    // validator accepts a document, normalising it changes nothing. (The
    // converse — a normal-form violation for every non-fixed-point — is the
    // guardrail-4 describe below.)
    const accepted: ScoringRulesDocV2[] = [
      ...SCORING_TEMPLATES.map((t) => forkTemplateDoc(t.rules)),
      withOverride(espnFork(), 'TE', { receptions: 1.5 }),
      withOverride(yahooFork(), 'DST', { def_sack: 2 }),
      withOverride(espnFork(), 'K', { fg_missed: 0 }),
    ]
    for (const doc of accepted) {
      expectAccepted(doc)
      expect(normalizeScoringDoc(doc)).toEqual(doc)
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Guardrail 1 — the scorable allowlist
 * ──────────────────────────────────────────────────────────────────────── */

describe('guardrail 1 — the scorable allowlist (§7.3.3.1(1) / §23.5 scoring_surface)', () => {
  it('NAMED REJECTION: a raw source in base — the original F21 double-count', () => {
    const result = expectRejection(
      withBase(espnFork(), { def_points_allowed: 1 }),
      'scorable_allowlist',
      'base.def_points_allowed',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
    // The refusal says WHY, not just "invalid": paying the raw source beside
    // the tiers derived FROM it is the double-count, and the message says so.
    expect(result.violations[0].message).toMatch(/context key/)
    expect(result.violations[0].message).toMatch(/double-count/)
  })

  it('NAMED REJECTION: an aggregate in an override (fg_made beside its split tiers)', () => {
    const result = expectRejection(
      withOverride(espnFork(), 'K', { fg_made: 3 }),
      'scorable_allowlist',
      'positions.K.fg_made',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
    expect(result.violations[0].message).toMatch(/context key/)
  })

  it('NAMED REJECTION: a reserved key (a deferred bonus) says "reserved"', () => {
    const result = expectRejection(
      withBase(espnFork(), { pass_300_bonus: 3 }),
      'scorable_allowlist',
      'base.pass_300_bonus',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
    expect(result.violations[0].message).toMatch(/reserved key/)
  })

  it('NAMED REJECTION: a key that is not in the registry at all', () => {
    const result = expectRejection(
      withBase(espnFork(), { pass_yardz: 0.04 }),
      'scorable_allowlist',
      'base.pass_yardz',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
    expect(result.violations[0].message).toMatch(/not a canonical stat key/)
  })

  it('the allowlist applies to the FORMAT-1 arm too (D175s wall sees flat docs)', () => {
    // A flat league document is validated by the same law: D175's trigger
    // validates `is_template = TRUE` rows and any live-league-referenced row,
    // and F21's raw-source ban would be hollow if a flat map could still pay
    // `def_points_allowed` next to its own derived buckets.
    // The path is the KEY, with no `base.` prefix: a flat document has no
    // `base` member, and SE.6's route surfaces these paths as fields.
    expectRejection(
      { ...template('ESPN Standard'), def_points_allowed: 1 },
      'scorable_allowlist',
      'def_points_allowed',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
  })

  it('D146 ONE UNIT: return_td is scorable, return_yards is one key away and is not (Q13/F71)', () => {
    // The Special Teams section ships with return_td alone; `return_yards` has
    // no registry entry until the F71 data task lands, and a rules key whose
    // stat is never delivered is the standing-E61 pending badge. The two keys
    // differ by the one thing that decides: presence in the registry.
    expectAccepted(withOverride(espnFork(), 'WR', { return_td: 7 }))
    expect(STAT_KEYS.some((def) => def.key === 'return_yards')).toBe(false)
    expectRejection(
      withOverride(espnFork(), 'WR', { return_yards: 0.05 }),
      'scorable_allowlist',
      'positions.WR.return_yards',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
  })

  it('the allowlist IS the registry: every scorable key is payable in base', () => {
    // Not a self-comparison — the left side is a document built from the
    // registry's own classification, the right side is the validator's verdict
    // on that document. If the validator ever disagreed with the field that
    // defines the editor's scope, a commissioner could be refused a key the
    // editor renders.
    const everyScorableKey: Record<string, number> = {}
    for (const key of SCORABLE_KEYS) everyScorableKey[key] = 1
    const doc = { ...espnFork(), base: everyScorableKey }
    // 48 keys — the whole scorable surface in one document. It breaks tier
    // exclusivity (it names BOTH PA families at once), which is the point of
    // the next describe; the allowlist must contribute nothing.
    expect(Object.keys(everyScorableKey).length).toBe(48)
    const result = validateScoringRulesDoc(doc)
    expect(codes(result)).toEqual([
      'tier_exclusivity',
      'tier_exclusivity',
      'tier_exclusivity',
    ])
    // Named: exactly the three shared-family tiers ESPN's cuts do not cut.
    expect(paths(result)).toEqual([
      'base.def_pa_14_20',
      'base.def_pa_21_27',
      'base.def_pa_35_plus',
    ])
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Guardrail 2 — tier exclusivity (THE F21 double-pay)
 * ──────────────────────────────────────────────────────────────────────── */

describe('guardrail 2 — tier exclusivity, the F21 double-pay (§7.3.3.1(2))', () => {
  it('THE DEFECT IS REAL: def_pa_14_20 + def_pa_18_27 pays a PA-19 week TWICE', () => {
    // F21's own words, made measurable through the SHIPPED derivation and the
    // SHIPPED calculator — not asserted in prose. Both families one-hot
    // independently, so a document naming a tier from each pays both.
    const stats = deriveTierIndicators({ def_points_allowed: 19 })
    expect(stats.def_pa_14_20).toBe(1)
    expect(stats.def_pa_18_27).toBe(1)

    const doublePayer = { def_pa_14_20: 4, def_pa_18_27: 3 }
    expect(scorePlayerWeek(doublePayer, stats).total).toBe(7)
    // Either family ALONE pays once, which is what "double" means here.
    expect(scorePlayerWeek({ def_pa_14_20: 4 }, stats).total).toBe(4)
    expect(scorePlayerWeek({ def_pa_18_27: 3 }, stats).total).toBe(3)
  })

  it('NAMED REJECTION + D146 ONE UNIT: the F21 literal is refused; its own-family twin is accepted', () => {
    // THE pin this task exists for. The rejected pair mixes families; the
    // accepted pair is the same document with the ESPN tier swapped for the
    // shared family's own adjacent tier — one tier over, and legal.
    const result = expectRejection(
      { def_pa_14_20: 4, def_pa_18_27: 3 },
      'tier_exclusivity',
      '',
      FAMILY_NAME_IN_MESSAGE.tier_exclusivity,
    )
    expect(result.violations[0].message).toMatch(/double-pay/)
    expect(result.violations[0].message).toMatch(/F21/)

    expectAccepted({ def_pa_14_20: 4, def_pa_21_27: 3 })
  })

  it('the format-1 arm: each shipped template names exactly one PA family', () => {
    const shared = new Set(tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS))
    const espn = new Set(tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS))
    for (const t of SCORING_TEMPLATES) {
      const paKeys = Object.keys(t.rules).filter((k) => k.startsWith(`${DEF_PA_PREFIX}_`))
      const homes = [shared, espn].filter((family) => paKeys.every((k) => family.has(k)))
      // Exactly one — which is why the "at least one" reading pinned below
      // and the literal "exactly one" reading agree on every shipped document.
      expect(homes.length).toBe(1)
      expectAccepted(t.rules)
    }
  })

  it('THE READING: a document naming only the four SHARED key names is accepted', () => {
    // §7.3.3.1(2)'s format-1 parenthetical says "⊆ exactly one named platform
    // family … the families sharing 4 key names". Read as "a subset of exactly
    // one of the two sets", this document would be refused for being a subset
    // of BOTH — though it cannot double-pay anything, because within one
    // family the tiers are non-overlapping by construction. The controlling
    // clause is the guardrail's stated purpose (MIXING is what must be
    // inexpressible), so the check is "some published family contains every
    // def_pa_* key this document names". Recorded here so a ruling the other
    // way is a one-line change plus this pin.
    const fourShared = ['def_pa_0', 'def_pa_1_6', 'def_pa_7_13', 'def_pa_28_34']
    const shared = new Set(tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS))
    const espn = new Set(tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS))
    // The premise of the reading, measured: these four ARE in both families.
    for (const key of fourShared) {
      expect(shared.has(key)).toBe(true)
      expect(espn.has(key)).toBe(true)
    }
    // And it cannot double-pay: at every PA 0–60 at most one of them is hot.
    for (let pa = 0; pa <= 60; pa++) {
      const stats = deriveTierIndicators({ def_points_allowed: pa })
      const hot = fourShared.filter((key) => stats[key] === 1)
      expect(hot.length).toBeLessThanOrEqual(1)
    }
    expectAccepted(Object.fromEntries(fourShared.map((key) => [key, 1])))
  })

  it('NAMED REJECTION (format 2): a key the documents OWN cuts do not generate', () => {
    // An ESPN fork cannot name the shared family's 14–20 tier: its own cut
    // list cuts at 14/18, so `def_pa_14_20` is a tier that does not exist in
    // this document. This is the version §7.3.3.1 calls *inexpressible*.
    const result = expectRejection(
      withBase(espnFork(), { def_pa_14_20: 4 }),
      'tier_exclusivity',
      'base.def_pa_14_20',
      FAMILY_NAME_IN_MESSAGE.tier_exclusivity,
    )
    expect(result.violations[0].message).toMatch(/points-allowed cut list \[0, 1, 7, 14, 18, 28, 35, 46\]/)
  })

  it('the format-2 check is DOC-WIDE: an override carries the same refusal', () => {
    expectRejection(
      withOverride(espnFork(), 'DST', { def_pa_14_20: 4 }),
      'tier_exclusivity',
      'positions.DST.def_pa_14_20',
      FAMILY_NAME_IN_MESSAGE.tier_exclusivity,
    )
    // …and the mirror case: a shared-family fork cannot name ESPN's 14–17.
    expectRejection(
      withOverride(yahooFork(), 'DST', { def_pa_14_17: 4 }),
      'tier_exclusivity',
      'positions.DST.def_pa_14_17',
      FAMILY_NAME_IN_MESSAGE.tier_exclusivity,
    )
  })

  it('D146 ONE UNIT: moving one ESPN cut by 1 invalidates exactly the two keys it re-cuts', () => {
    // The tier-exclusivity guardrail is a function of the document's own cut
    // list, so the one-unit fixture moves a CUT, not a key: 18 → 19 renames
    // def_pa_14_17 → def_pa_14_18 and def_pa_18_27 → def_pa_19_27, and the
    // document's untouched keys stop being generated. Two violations, named.
    const moved = [0, 1, 7, 14, 19, 28, 35, 46]
    expect(moved.length).toBe(ESPN_PA_CUTS.length)
    const result = validateScoringRulesDoc(withCuts(espnFork(), { def_pa: moved }))
    expect(codes(result)).toEqual(['tier_exclusivity', 'tier_exclusivity'])
    expect(paths(result)).toEqual(['base.def_pa_14_17', 'base.def_pa_18_27'])
    // …and with the cut back where it was, the same document is accepted.
    expectAccepted(withCuts(espnFork(), { def_pa: [...ESPN_PA_CUTS] }))
  })

  it('NAMED REJECTION: a yards-allowed key outside the published YA cut list — TWO refusals, and that is a fact about the registry', () => {
    // `def_ya_0_100` is one unit off the published `def_ya_0_99`. It draws
    // BOTH guardrail 1 and guardrail 2, and the reason is worth stating: the
    // registry's def_ya keys ARE exactly the keys YA_CUTS generates (SE.1's
    // set-equality pin), so a yards-allowed name outside the family is
    // necessarily outside the registry too. There is no fixture that isolates
    // guardrail 2 on a YA key in a FORMAT-1 document — the isolated case lives
    // in the cut-move pin below, where the key is real and the cuts moved.
    const generated = new Set(tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS))
    expect(generated.has('def_ya_0_99')).toBe(true)
    expect(generated.has('def_ya_0_100')).toBe(false)
    expect(SCORABLE_KEYS.has('def_ya_0_100')).toBe(false)
    expectAccepted({ ...template('ESPN Standard') })

    const result = validateScoringRulesDoc({
      ...template('ESPN Standard'),
      def_ya_0_100: 5,
    })
    expect(codes(result)).toEqual(['scorable_allowlist', 'tier_exclusivity'])
    expect(paths(result)).toEqual(['def_ya_0_100', ''])
    expect(result.violations[1].message).toMatch(
      /yards-allowed keys \[def_ya_0_100\] are not generated/,
    )
  })

  it('D146 ONE UNIT (YA): moving the last YA cut by 1 invalidates exactly the two tiers it re-cuts', () => {
    // The YA twin of the ESPN cut-move pin, and the fixture that isolates
    // guardrail 2 on the yards-allowed table: both keys below are real
    // registry keys, so the allowlist has nothing to say — only the document's
    // own cut list does. 550 → 551 renames def_ya_500_549 → def_ya_500_550 and
    // def_ya_550_plus → def_ya_551_plus.
    expect(SCORABLE_KEYS.has('def_ya_500_549')).toBe(true)
    expect(SCORABLE_KEYS.has('def_ya_550_plus')).toBe(true)
    const moved = [0, 100, 200, 300, 350, 400, 450, 500, 551]
    expect(moved.length).toBe(YA_CUTS.length)
    const result = validateScoringRulesDoc(withCuts(espnFork(), { def_ya: moved }))
    expect(codes(result)).toEqual(['tier_exclusivity', 'tier_exclusivity'])
    expect(paths(result)).toEqual(['base.def_ya_500_549', 'base.def_ya_550_plus'])
    // …and with the cut back where it was, the same document is accepted.
    expectAccepted(withCuts(espnFork(), { def_ya: [...YA_CUTS] }))
  })

  it('the two tables are INDEPENDENT: a YA cut list problem does not silence the PA check', () => {
    const doc = withCuts(withBase(espnFork(), { def_pa_14_20: 4 }), { def_ya: [0, 100, 100] })
    const result = validateScoringRulesDoc(doc)
    expect(codes(result)).toEqual(['tier_exclusivity', 'tier_cuts'])
    expect(paths(result)).toEqual(['base.def_pa_14_20', 'tier_cuts.def_ya'])
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Guardrail 3 — position scope
 * ──────────────────────────────────────────────────────────────────────── */

describe('guardrail 3 — position scope (§7.3.3.1(3))', () => {
  it('the transcribed catalog IS the registry: six disjoint sets whose union is the scorable 48', () => {
    // Guardrail 3 needs a position→keys map that no registry field carries, so
    // the catalog is transcribed from §7.3.3.1's own sentence. This is the
    // proof that the transcription did not drift from the field that defines
    // the editor's scope (§23.5's scoring_surface, SE.1).
    const union = new Set<string>()
    for (const position of SCORING_POSITIONS) {
      for (const key of POSITION_SCORABLE_KEYS[position]) union.add(key)
    }
    expect([...union].sort()).toEqual([...SCORABLE_KEYS].sort())
    expect(union.size).toBe(48)

    // Pairwise disjoint EXCEPT the four offense positions, which share one
    // set by design (§7.3.3.1: "every position except K and D/ST carries five
    // sections") — pinned as an identity, so a future TE-premium key that is
    // legal for TE alone has to be a deliberate edit here.
    for (const position of ['RB', 'WR', 'TE'] as const) {
      expect(POSITION_SCORABLE_KEYS[position]).toBe(POSITION_SCORABLE_KEYS.QB)
    }
    const offense = new Set(POSITION_SCORABLE_KEYS.QB)
    const kicking = new Set(POSITION_SCORABLE_KEYS.K)
    const defense = new Set(POSITION_SCORABLE_KEYS.DST)
    expect(offense.size).toBe(15)
    expect(kicking.size).toBe(6)
    expect(defense.size).toBe(27) // 7 events + the 20 generated tier keys
    for (const [a, b] of [
      [offense, kicking],
      [offense, defense],
      [kicking, defense],
    ] as const) {
      expect([...a].filter((key) => b.has(key))).toEqual([])
    }
  })

  it('NAMED REJECTION + D146 ONE UNIT: a single K key under QB (§4 rule 6s own example)', () => {
    // The one-unit fixture for a scope rule is one key in the wrong place.
    const result = expectRejection(
      withOverride(espnFork(), 'QB', { fg_0_39: 4 }),
      'position_scope',
      'positions.QB.fg_0_39',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
    expect(result.violations[0].message).toMatch(/belongs to K/)
    // The same single key under K — accepted (base pays 3, so 4 is a real
    // override, not a normal-form no-op).
    expect(espnFork().base.fg_0_39).toBe(3)
    expectAccepted(withOverride(espnFork(), 'K', { fg_0_39: 4 }))
    // …and a single legal QB key under QB — accepted.
    expectAccepted(withOverride(espnFork(), 'QB', { pass_tds: 6 }))
  })

  it('NAMED REJECTION: an offense key under DST, and a D/ST key under an offense position', () => {
    expectRejection(
      withOverride(espnFork(), 'DST', { receptions: 2 }),
      'position_scope',
      'positions.DST.receptions',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
    expectRejection(
      withOverride(espnFork(), 'WR', { def_sack: 2 }),
      'position_scope',
      'positions.WR.def_sack',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
    // A tier key IS a D/ST key, so it is legal under DST (and only there).
    expectAccepted(withOverride(espnFork(), 'DST', { def_pa_0: 6 }))
    expectRejection(
      withOverride(espnFork(), 'TE', { def_pa_0: 6 }),
      'position_scope',
      'positions.TE.def_pa_0',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
  })

  it('NAMED REJECTION: a position outside the six', () => {
    const result = expectRejection(
      withOverride(espnFork(), 'FB', { rush_yards: 0.2 }),
      'position_scope',
      'positions.FB',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
    expect(result.violations[0].message).toMatch(/QB, RB, WR, TE, K, DST/)
  })

  it('an illegal position spelled __proto__ is REJECTED, not laundered (R582)', () => {
    // A document read back from the database is JSON.parse'd, which creates an
    // OWN `__proto__` data property — the shape R582 found silently dropped by
    // a plain-object accumulator. `normalizeScoringDoc` now preserves it
    // precisely so this guardrail can refuse it; the two halves are pinned
    // together here.
    const doc = JSON.parse(
      JSON.stringify({ ...espnFork(), positions: {} }).replace(
        '"positions":{}',
        '"positions":{"__proto__":{"receptions":2}}',
      ),
    )
    expect(Object.keys(doc.positions)).toEqual(['__proto__'])
    expect(Object.keys(normalizeScoringDoc(doc).positions as object)).toEqual(['__proto__'])
    expectRejection(
      doc,
      'position_scope',
      'positions.__proto__',
      FAMILY_NAME_IN_MESSAGE.position_scope,
    )
  })

  it('a key that is not scorable at all is guardrail 1s rejection, said ONCE', () => {
    // The families are ordered so SE.4's SQL — which RAISEs on the first
    // violation — names the same family. A non-scorable key under a legal
    // position must therefore not also produce a scope violation.
    const result = validateScoringRulesDoc(
      withOverride(espnFork(), 'QB', { pass_attempts: 0.1 }),
    )
    expect(codes(result)).toEqual(['scorable_allowlist'])
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Guardrail 4 — normal form
 * ──────────────────────────────────────────────────────────────────────── */

describe('guardrail 4 — normal form (§7.3.3.1(4))', () => {
  it('NAMED REJECTION + D146 ONE UNIT: an override equal to base vs one cent away', () => {
    // The All-Positions switch is DERIVED state: a section reads ON iff none
    // of its keys carry an override. A no-op override would make it read OFF
    // for a section whose values are in fact uniform — which is why the
    // document must not carry one.
    const base = espnFork().base
    expect(base.receptions).toBe(1)
    const result = expectRejection(
      withOverride(espnFork(), 'TE', { receptions: 1 }),
      'normal_form',
      'positions.TE.receptions',
      FAMILY_NAME_IN_MESSAGE.normal_form,
    )
    expect(result.violations[0].message).toMatch(/repeats the base value \(1\)/)
    // One cent away — a real override.
    expectAccepted(withOverride(espnFork(), 'TE', { receptions: 1.01 }))
  })

  it('NAMED REJECTION: an empty override object says "empty", not "no-op"', () => {
    const result = expectRejection(
      withOverride(espnFork(), 'RB', {}),
      'normal_form',
      'positions.RB',
      FAMILY_NAME_IN_MESSAGE.normal_form,
    )
    expect(result.violations[0].message).toMatch(/empty override object/)
  })

  it('NAMED REJECTION: an override object whose every key is a no-op names EVERY key', () => {
    // The whole object is stripped by the normal form, but the refusal is
    // per-key: "positions.WR is wrong" is not something a commissioner can act
    // on, and SE.6's route surfaces these paths at fields.
    const base = espnFork().base
    const result = validateScoringRulesDoc(
      withOverride(espnFork(), 'WR', {
        receptions: base.receptions,
        receiving_tds: base.receiving_tds,
      }),
    )
    expect(codes(result)).toEqual(['normal_form', 'normal_form'])
    expect(paths(result)).toEqual([
      'positions.WR.receptions',
      'positions.WR.receiving_tds',
    ])
    expect(result.violations[0].message).toMatch(/repeats the base value \(1\)/)
    expect(result.violations[1].message).toMatch(/repeats the base value \(6\)/)
  })

  it('D146 ONE UNIT (D268(5)a): 0 over a base of 0 is a no-op; 0 over an ABSENT base is not', () => {
    // "Absent" and "zero" are different scored outcomes (§23.5/E61): an
    // undelivered stat against an absent key is silent, against a 0 key it is
    // a real perKey: 0. So the strip requires the key to EXIST in base.
    const zeroBase = withBase(espnFork(), { pat_missed: 0 })
    expect(zeroBase.base.pat_missed).toBe(0)
    expectRejection(
      withOverride(zeroBase, 'K', { pat_missed: 0 }),
      'normal_form',
      'positions.K.pat_missed',
      FAMILY_NAME_IN_MESSAGE.normal_form,
    )
    // The same override on the ESPN fork, whose base carries no pat_missed at
    // all — accepted, because it is a real edit.
    expect('pat_missed' in espnFork().base).toBe(false)
    expectAccepted(withOverride(espnFork(), 'K', { pat_missed: 0 }))
  })

  it('the verdict TRACKS normalizeScoringDoc — the composition, in both directions', () => {
    // Not "the strip is implemented twice and agrees": there is one strip, and
    // this asserts the validator's family-4 verdict is exactly "normalising
    // changes something", over documents that differ in nothing else.
    const cases: Array<{ doc: ScoringRulesDocV2; normalFormViolations: number }> = [
      { doc: espnFork(), normalFormViolations: 0 },
      { doc: withOverride(espnFork(), 'TE', { receptions: 1.5 }), normalFormViolations: 0 },
      { doc: withOverride(espnFork(), 'TE', { receptions: 1 }), normalFormViolations: 1 },
      { doc: withOverride(espnFork(), 'TE', {}), normalFormViolations: 1 },
      {
        doc: withOverride(espnFork(), 'TE', { receptions: 1, receiving_tds: 7 }),
        normalFormViolations: 1,
      },
    ]
    for (const { doc, normalFormViolations } of cases) {
      expect(codes(validateScoringRulesDoc(doc)).filter((c) => c === 'normal_form').length).toBe(
        normalFormViolations,
      )
      // Deep equality, not a stringify comparison: `normalizeScoringDoc`
      // rebuilds its objects, so key ORDER is not part of the claim.
      if (normalFormViolations === 0) expect(normalizeScoringDoc(doc)).toEqual(doc)
      else expect(normalizeScoringDoc(doc)).not.toEqual(doc)
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Guardrail 5 — bounds
 * ──────────────────────────────────────────────────────────────────────── */

describe('guardrail 5 — bounds (§7.3.3.1s per-field bounds bullet)', () => {
  it('D146 ONE UNIT: |coef| = 100.00 accepts, 100.01 rejects — both signs', () => {
    expect(MAX_ABS_COEFFICIENT).toBe(100)
    expectAccepted(withOverride(espnFork(), 'QB', { pass_tds: 100 }))
    expectAccepted(withOverride(espnFork(), 'QB', { pass_tds: -100 }))
    const high = expectRejection(
      withOverride(espnFork(), 'QB', { pass_tds: 100.01 }),
      'bounds',
      'positions.QB.pass_tds',
      FAMILY_NAME_IN_MESSAGE.bounds,
    )
    expect(high.violations[0].message).toMatch(/\|coef\| ≤ 100/)
    expectRejection(
      withOverride(espnFork(), 'QB', { pass_tds: -100.01 }),
      'bounds',
      'positions.QB.pass_tds',
      /\|coef\| ≤ 100/,
    )
  })

  it('D146 ONE UNIT: 0.01 accepts, 0.001 rejects (and 0.005 does not round its way in)', () => {
    expectAccepted(withOverride(espnFork(), 'QB', { pass_yards: 0.01 }))
    const result = expectRejection(
      withOverride(espnFork(), 'QB', { pass_yards: 0.001 }),
      'bounds',
      'positions.QB.pass_yards',
      FAMILY_NAME_IN_MESSAGE.bounds,
    )
    expect(result.violations[0].message).toMatch(/at most 2 decimal places/)
    expectRejection(
      withOverride(espnFork(), 'QB', { pass_yards: 0.005 }),
      'bounds',
      'positions.QB.pass_yards',
      /at most 2 decimal places/,
    )
  })

  it('the 2dp check survives binary floating point — every shipped template value passes', () => {
    // `0.07 * 100` is 7.000000000000001, so a naive `(v * 100) % 1 === 0`
    // rejects ordinary coefficients. These are the values that would red it.
    // Patched into `base` rather than an override: 0.04 IS the base value, so
    // an override of it would be a normal-form no-op and this pin would be
    // measuring guardrail 4 instead of guardrail 5.
    for (const value of [0.04, 0.07, 0.1, 0.5, 1.15, 4.35, 99.99, -0.07, -4.35]) {
      expectAccepted(withBase(espnFork(), { pass_yards: value }))
    }
    // …and the templates themselves, which is where it actually matters.
    for (const t of SCORING_TEMPLATES) expectAccepted(t.rules)
  })

  it('NAMED REJECTION: non-finite and non-numeric coefficients (R59s trust boundary)', () => {
    // The calculator THROWS on a non-finite coefficient (R59/D58 — a corrupt
    // snapshot is a programming error there). This is the layer that stops one
    // being written in the first place, and it answers rather than throws.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectRejection(
        withOverride(espnFork(), 'QB', { pass_tds: value }),
        'bounds',
        'positions.QB.pass_tds',
        /must be a finite number/,
      )
    }
    // A string-numeric coefficient silently coerces inside the calculator
    // (R59: `"0.5"` scores) — here it is refused by name.
    const result = expectRejection(
      withOverride(espnFork(), 'QB', { pass_tds: '4' }),
      'bounds',
      'positions.QB.pass_tds',
      FAMILY_NAME_IN_MESSAGE.bounds,
    )
    expect(result.violations[0].message).toMatch(/got "4"/)
    expectRejection(
      withBase(espnFork(), { pass_tds: null }),
      'bounds',
      'base.pass_tds',
      /must be a finite number/,
    )
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * §7.3.3.1(c) — the tier_cuts residuals
 * ──────────────────────────────────────────────────────────────────────── */

describe('tier_cuts residuals (§7.3.3.1(c) — ascending, integers, ≥ 2 cuts, per table)', () => {
  it('D146 ONE UNIT: 2 cuts accept, 1 cut rejects', () => {
    expectAccepted(withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 1] }))
    const result = expectRejection(
      withCuts({ ...espnFork(), base: {} }, { def_pa: [0] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      FAMILY_NAME_IN_MESSAGE.tier_cuts,
    )
    expect(result.violations[0].message).toMatch(/at least 2 cut points/)
  })

  it('D146 ONE UNIT: [0, 7, 8] ascends, [0, 7, 7] does not', () => {
    expectAccepted(withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 7, 8] }))
    const result = expectRejection(
      withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 7, 7] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      FAMILY_NAME_IN_MESSAGE.tier_cuts,
    )
    expect(result.violations[0].message).toMatch(/ascend strictly/)
    // Descending is the same refusal, at the same index.
    expectRejection(
      withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 7, 6] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      /ascend strictly/,
    )
  })

  it('D146 ONE UNIT: 14 is an integer cut, 14.5 is not', () => {
    expectAccepted(withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 14] }))
    const result = expectRejection(
      withCuts({ ...espnFork(), base: {} }, { def_pa: [0, 14.5] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      FAMILY_NAME_IN_MESSAGE.tier_cuts,
    )
    expect(result.violations[0].message).toMatch(/must be integers; index 1 is 14\.5/)
  })

  it('NAMED REJECTION: both tables are always written (EnvelopeTierCuts, R577)', () => {
    const noYa = { ...espnFork(), tier_cuts: { def_pa: [...ESPN_PA_CUTS] } }
    const result = expectRejection(
      noYa,
      'tier_cuts',
      'tier_cuts.def_ya',
      FAMILY_NAME_IN_MESSAGE.tier_cuts,
    )
    expect(result.violations[0].message).toMatch(/pays no yards-allowed table/)
    // A Yahoo fork pays no def_ya_* key at all and still carries the list —
    // that is the shape the message describes, and it is accepted.
    const yahoo = yahooFork()
    expect(Object.keys(yahoo.base).filter((k) => k.startsWith('def_ya_'))).toEqual([])
    expect(yahoo.tier_cuts.def_ya).toEqual([...YA_CUTS])
    expectAccepted(yahoo)
  })

  it('NAMED REJECTION: tier_cuts missing entirely, or not an object', () => {
    const noCuts: Record<string, unknown> = { ...espnFork() }
    delete noCuts.tier_cuts
    expect('tier_cuts' in noCuts).toBe(false)
    expectRejection(noCuts, 'tier_cuts', 'tier_cuts', FAMILY_NAME_IN_MESSAGE.tier_cuts)
    expectRejection(
      { ...espnFork(), tier_cuts: [ESPN_PA_CUTS, YA_CUTS] },
      'tier_cuts',
      'tier_cuts',
      /got an array/,
    )
  })

  it('a cut list that would THROW in tierKeysFromCuts is answered, never thrown', () => {
    // `tierKeysFromCuts` asserts its precondition loudly (SE.1/D267(5)) — this
    // module's job is to make sure a user-shaped document never reaches it.
    expect(() => tierKeysFromCuts(DEF_PA_PREFIX, [0, 7, 7])).toThrow(TypeError)
    expect(() =>
      validateScoringRulesDoc(withCuts(espnFork(), { def_pa: [0, 7, 7] })),
    ).not.toThrow()
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * The front door — document shape, and the never-throws property
 * ──────────────────────────────────────────────────────────────────────── */

describe('the document front door', () => {
  it('NAMED REJECTION: a future format is refused loudly, never read as a plausible doc', () => {
    // CLAUDE.md's never-let-"nothing happened"-mean-"it worked" rule at its
    // most expensive: a format-3 document read as flat, or as base-only,
    // scores an entire league wrong with no error anywhere.
    const result = expectRejection(
      { ...espnFork(), format: 3 },
      'document_shape',
      'format',
      /format 3/,
    )
    expect(result.violations[0].message).toMatch(/never a silent pass/)
    expectRejection({ ...espnFork(), format: '2' }, 'document_shape', 'format', /format "2"/)
  })

  it('NAMED REJECTION: base / positions / an override that is not an object', () => {
    expectRejection({ ...espnFork(), base: null }, 'document_shape', 'base', /"base" object/)
    expectRejection(
      { ...espnFork(), positions: [] },
      'document_shape',
      'positions',
      /"positions" object/,
    )
    expectRejection(
      withOverride(espnFork(), 'QB', 4 as unknown as Record<string, unknown>),
      'document_shape',
      'positions.QB',
      /must be an object of coefficients/,
    )
  })

  it('NEVER THROWS — the input is a JSONB blob, so nonsense is an answer', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      'a scoring system',
      [],
      [1, 2, 3],
      {},
      { format: 2 },
      { format: 2, base: {}, positions: {} },
      { format: 2, base: {}, positions: { QB: null }, tier_cuts: { def_pa: [], def_ya: 'x' } },
      { format: null },
      { format: 2, base: { receptions: {} }, positions: {}, tier_cuts: {} },
      withCuts(espnFork(), { def_pa: ['0', '7'] }),
      JSON.parse('{"__proto__": {"receptions": 1}}'),
    ]
    for (const input of hostile) {
      expect(() => validateScoringRulesDoc(input)).not.toThrow()
      // …and every one of them gets an answer with at least one named reason
      // (the empty flat map `{}` is the one legal member of this list: it
      // scores nothing, which no guardrail forbids).
      const result = validateScoringRulesDoc(input)
      if (JSON.stringify(input) === '{}') {
        expect(result.valid).toBe(true)
      } else {
        expect(result.valid).toBe(false)
        for (const violation of result.violations) {
          expect(violation.message).toMatch(FAMILY_NAME_IN_MESSAGE[violation.code])
        }
      }
    }
  })

  it('EVERY violation names its own guardrail family (E75) and carries a code + path', () => {
    // The corpus below is every rejection fixture in this file, gathered so
    // the "named rejection" claim is a property of the module rather than a
    // habit of whoever wrote the last test.
    for (const doc of REJECTION_CORPUS) {
      const result = validateScoringRulesDoc(doc)
      expect(result.valid).toBe(false)
      for (const violation of result.violations) {
        expect(violation.message).toMatch(FAMILY_NAME_IN_MESSAGE[violation.code])
        expect(typeof violation.path).toBe('string')
        // A path is dot-delimited, and the Zod delegation splits it on '.' to
        // build its issue path. **The only segment that may be empty is the
        // LAST one, and when it is, it denotes the empty key `''`** — the
        // format-2 document `{base: {'': 1}}` yields `base.`, and the empty
        // segment is the information, not a truncation.
        //
        // An earlier form of this assertion claimed NO segment is ever empty
        // (ledger F138). That was false and green at the same time: the
        // corpus contained no empty key. Restated to what the module does,
        // with a fixture that reds the old claim.
        if (violation.path !== '') {
          const segments = violation.path.split('.')
          expect(segments.slice(0, -1).every((segment) => segment.length > 0)).toBe(true)
        }
      }
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * The corpus + the Zod delegation (SE.3(4)) and the SE.4 ordering contract
 * ──────────────────────────────────────────────────────────────────────── */

/** One document per named rejection above — the shared corpus. */
const REJECTION_CORPUS: unknown[] = [
  withBase(espnFork(), { def_points_allowed: 1 }),
  withOverride(espnFork(), 'K', { fg_made: 3 }),
  withBase(espnFork(), { pass_300_bonus: 3 }),
  withBase(espnFork(), { pass_yardz: 0.04 }),
  { ...template('ESPN Standard'), def_points_allowed: 1 },
  { def_pa_14_20: 4, def_pa_18_27: 3 },
  withBase(espnFork(), { def_pa_14_20: 4 }),
  withOverride(yahooFork(), 'DST', { def_pa_14_17: 4 }),
  withCuts(espnFork(), { def_pa: [0, 1, 7, 14, 19, 28, 35, 46] }),
  { ...template('ESPN Standard'), def_ya_0_100: 5 },
  withOverride(espnFork(), 'QB', { fg_0_39: 4 }),
  withOverride(espnFork(), 'DST', { receptions: 2 }),
  withOverride(espnFork(), 'FB', { rush_yards: 0.2 }),
  withOverride(espnFork(), 'TE', { receptions: 1 }),
  withOverride(espnFork(), 'RB', {}),
  withOverride(espnFork(), 'QB', { pass_tds: 100.01 }),
  withOverride(espnFork(), 'QB', { pass_yards: 0.001 }),
  withOverride(espnFork(), 'QB', { pass_tds: Number.NaN }),
  withOverride(espnFork(), 'QB', { pass_tds: '4' }),
  withCuts(espnFork(), { def_pa: [0] }),
  withCuts(espnFork(), { def_pa: [0, 7, 7] }),
  withCuts(espnFork(), { def_ya: [0, 14.5] }),
  { ...espnFork(), tier_cuts: { def_pa: [...ESPN_PA_CUTS] } },
  { ...espnFork(), format: 3 },
  { ...espnFork(), base: null },
  null,
  [],
  // Review round R588–R597 — one document per newly-pinned gap, so the E75
  // property and the mutual-exclusivity pin above cover them too.
  { ...espnFork(), postions: { QB: { receptions: 99 } } },
  { ...espnFork(), def_points_allowed: 1 },
  withCuts(espnFork(), { def_xx: [0, 1] } as { def_pa?: unknown }),
  withBase(espnFork(), { receptions: 0.30000000000000004 }),
  withBase(espnFork(), { pass_tds: 100.01 }),
  { ...template('ESPN Standard'), pass_tds: 100.01 },
  withCuts({ ...espnFork(), base: {} }, { def_pa: [7, 14, 21, 28, 35] }),
  withOverride(espnFork(), 'DST', { def_points_allowed: -0.5 }),
  withOverride(espnFork(), 'DST', { fg_0_39: 4 }),
  withOverride(espnFork(), 'qb', { pass_tds: 5 }),
  { ...espnFork(), format: 1 },
  // SE.6 / ledger F138 — THE EMPTY KEY. `''` is a legal JSON key and is not
  // scorable, so it is an ordinary allowlist rejection; what made it worth a
  // ledger row is the PATH it produces (`base.`, whose last segment is empty).
  // The corpus carried no empty key, so the path-shape property below
  // asserted something it could not see. It can see it now.
  withBase(espnFork(), { '': 1 }),
]

/*
 * `ONE_FAMILY_EACH` — the documents that break EXACTLY one family — MOVED to
 * `parity-fixture.ts` at SE.4, where `scoring-parity-db.test.ts` runs the same
 * array through `scoring_rules_validate` in SQL. Its docblock (the "checklist
 * of NAMES, not of behaviours" argument that widened it from one document per
 * family to one per ARM) moved with it. The contract it exists to serve is
 * still asserted HERE, because "exactly one violation, and it is first" is a
 * fact about the TS validator:
 */

describe('the SE.4 contract: one family per parity document, first violation stable', () => {
  it.each(ONE_FAMILY_EACH)('$code — reported alone, and first', ({ code, doc }) => {
    const result = validateScoringRulesDoc(doc)
    expect(codes(result)).toEqual([code])
    expect(result.violations[0].code).toBe(code)
  })

  it('covers all seven families — the parity fixture has no hole', () => {
    expect([...new Set(ONE_FAMILY_EACH.map((c) => c.code))].sort()).toEqual(
      (Object.keys(FAMILY_NAME_IN_MESSAGE) as ScoringGuardrail[]).sort(),
    )
    // …and both DOCUMENT FORMATS, because SE.4(1) mirrors the format-1 arm and
    // an all-format-2 fixture cannot see it (review §5).
    const formats = ONE_FAMILY_EACH.map(({ doc }) =>
      typeof doc === 'object' && doc !== null && 'format' in doc ? 2 : 1,
    )
    expect(formats).toContain(1)
    expect(formats).toContain(2)
  })
})

describe('the route layer’s Zod envelope (SE.3(4)) — a delegation, not a mirror', () => {
  it('accepts exactly what the validator accepts, over the whole corpus', () => {
    const corpus: unknown[] = [
      ...SCORING_TEMPLATES.map((t) => t.rules),
      ...SCORING_TEMPLATES.map((t) => forkTemplateDoc(t.rules)),
      withOverride(espnFork(), 'TE', { receptions: 1.5 }),
      ...REJECTION_CORPUS,
    ]
    for (const doc of corpus) {
      const validator = validateScoringRulesDoc(doc)
      const parsed = scoringRulesDocSchema.safeParse(doc)
      expect(parsed.success).toBe(validator.valid)
      if (!parsed.success) {
        // Same count, same paths, same messages, and the guardrail family
        // travels with the issue — no second implementation anywhere.
        expect(parsed.error.issues.length).toBe(validator.violations.length)
        expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(
          validator.violations.map((v) => v.path),
        )
        expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
          validator.violations.map((v) => v.message),
        )
        expect(
          parsed.error.issues.map(
            (issue) => (issue as { params?: { guardrail?: string } }).params?.guardrail,
          ),
        ).toEqual(validator.violations.map((v) => v.code))
      }
    }
  })

  it('hands back the parsed document unchanged on success', () => {
    const doc = withOverride(espnFork(), 'TE', { receptions: 1.5 })
    const parsed = scoringRulesDocSchema.safeParse(doc)
    expect(parsed.success).toBe(true)
    // Compared against a stored literal, not against another call: the schema
    // must not transform, strip, or reorder a document on its way to the RPC.
    expect(parsed.success && (parsed.data as ScoringRulesDocV2).positions).toEqual({
      TE: { receptions: 1.5 },
    })
    expect(parsed.success && (parsed.data as ScoringRulesDocV2).tier_cuts).toEqual({
      def_pa: [0, 1, 7, 14, 18, 28, 35, 46],
      def_ya: [0, 100, 200, 300, 350, 400, 450, 500, 550],
    })
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * The position map is engine law, and SE.7 composes it (F136)
 * ──────────────────────────────────────────────────────────────────────── */

describe('POSITION_SCORABLE_KEYS — the map SE.4 mirrors and SE.7 composes (F136)', () => {
  it('is the §7.3.3.1 section catalog, position by position, as stored literals', () => {
    const expected: Record<ScoringPosition, string[]> = {
      QB: [
        'pass_yards',
        'pass_tds',
        'pass_2pt',
        'qb_sack_taken',
        'rush_yards',
        'rush_tds',
        'rush_2pt',
        'receptions',
        'receiving_yards',
        'receiving_tds',
        'rec_2pt',
        'return_td',
        'interceptions',
        'fumbles_lost',
        'fumble_recovery_td',
      ],
      RB: [],
      WR: [],
      TE: [],
      K: ['fg_0_39', 'fg_40_49', 'fg_50_plus', 'pat_made', 'fg_missed', 'pat_missed'],
      DST: [
        'def_sack',
        'def_int',
        'def_fumble_rec',
        'def_td',
        'def_safety',
        'def_block',
        'def_return_td',
        // The 20 generated tier keys, in generation order: shared PA, then
        // ESPN's four divergent names, then YA.
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
      ],
    }
    expected.RB = expected.QB
    expected.WR = expected.QB
    expected.TE = expected.QB
    for (const position of SCORING_POSITIONS) {
      expect(POSITION_SCORABLE_KEYS[position]).toEqual(expected[position])
    }
  })

  it('carries no gated key: return_yards is absent until F71 lands', () => {
    for (const position of SCORING_POSITIONS) {
      expect(POSITION_SCORABLE_KEYS[position]).not.toContain('return_yards')
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Review round R588–R598 — the arms the first cut of this suite left with
 * no RED, and the two code defects those gaps were hiding
 * ──────────────────────────────────────────────────────────────────────── */

describe('R588 — the envelope\'s own MEMBER SET (a stray member is not invisible)', () => {
  it('THE DEFECT IS REAL: an unenumerated member means the commissioner’s overrides are silently discarded', () => {
    // One transposed letter. Every guardrail reads `base` and `positions`, so
    // before this fix nothing in the document was looked at except the four
    // members the validator names — and `resolveRules` reads `positions`, not
    // `postions`, so the whole override map evaporates while the save reports
    // success. Measured here rather than argued, because it is the reason the
    // member-set check exists (CLAUDE.md's never-let-"nothing happened"-mean-
    // "it worked"; §7.3.3.1(5)'s "never a silently-ignored key").
    const typo = {
      ...espnFork(),
      postions: { QB: { receptions: 99 }, TE: { receptions: 2.5 } },
    }
    expect(resolveRules(typo as unknown as ScoringRulesDocV2, 'QB').receptions).toBe(1)
    const spelledRight = withOverride(espnFork(), 'QB', { receptions: 99 })
    expect(resolveRules(spelledRight, 'QB').receptions).toBe(99)

    expectRejection(typo, 'document_shape', 'postions', /not a member of a format-2/)
  })

  it('NAMED REJECTION: a case-shadowed member', () => {
    expectRejection(
      { ...espnFork(), Positions: { QB: { pass_tds: 99 } } },
      'document_shape',
      'Positions',
      FAMILY_NAME_IN_MESSAGE.document_shape,
    )
  })

  it('NAMED REJECTION: a coefficient stranded at the top level is refused there too', () => {
    // Each of these is already refused INSIDE `base` by its own family; the
    // point of the member-set check is that the same key alongside a correct
    // member is not a place a document may hide something.
    for (const stray of [
      { def_points_allowed: 1 }, // guardrail 1's named raw source
      { pass_yards: 5000 }, // 50× the magnitude bound
      { def_pa_14_20: 4 }, // half of the F21 literal
    ]) {
      const key = Object.keys(stray)[0]
      expectRejection(
        { ...espnFork(), ...stray },
        'document_shape',
        key,
        FAMILY_NAME_IN_MESSAGE.document_shape,
      )
      // …and the same key inside `base` is refused by its own family, so the
      // two arms disagree about nothing.
      expect(validateScoringRulesDoc(withBase(espnFork(), stray)).valid).toBe(false)
    }
  })

  it('NAMED REJECTION: a stray table inside tier_cuts — the case a normalize-based fix would MISS', () => {
    // `normalizeScoringDoc` passes `tier_cuts` through by reference, so a
    // stray table there is a FIXED POINT: "refuse un-normalised documents"
    // would never see it. It needs its own member-set check.
    const doc = withCuts(espnFork(), { def_xx: [0, 1] } as { def_pa?: unknown })
    expect(normalizeScoringDoc(doc)).toEqual(doc)
    expectRejection(doc, 'tier_cuts', 'tier_cuts.def_xx', FAMILY_NAME_IN_MESSAGE.tier_cuts)
  })

  it('D269(5) RESTATED CORRECTLY: the accepted set is closed under normalizeScoringDoc, INCLUDING the stray case', () => {
    // The property as first recorded was refuted by a one-member document
    // (R588): `{...fork, def_points_allowed: 5}` was accepted and was NOT a
    // fixed point. Both halves are pinned now — it rejects, and every document
    // that IS accepted survives normalisation unchanged.
    expect(validateScoringRulesDoc({ ...espnFork(), def_points_allowed: 5 }).valid).toBe(false)
    const accepted: unknown[] = [
      ...SCORING_TEMPLATES.map((t) => forkTemplateDoc(t.rules)),
      withOverride(espnFork(), 'TE', { receptions: 1.5 }),
      withOverride(espnFork(), 'K', { fg_missed: 0 }),
    ]
    for (const doc of accepted) {
      expectAccepted(doc)
      expect(normalizeScoringDoc(doc as ScoringRulesDocV2)).toEqual(doc)
    }
  })
})

describe('R589 — "multiples of 0.01" is the DECIMAL rule, not a float tolerance', () => {
  it('NAMED REJECTION: values that are not 2dp decimals, at every layer', () => {
    // 0.1 + 0.2 — the canonical float artefact, and a value a stepper UI
    // produces on its own — plus a hand-typeable 4dp value and an 11dp one.
    for (const value of [0.30000000000000004, 2.5001, 99.99999999999, 0.0000001]) {
      expectRejection(
        withBase(espnFork(), { receptions: value }),
        'bounds',
        'base.receptions',
        /at most 2 decimal places/,
      )
      expectRejection(
        withOverride(espnFork(), 'TE', { receptions: value }),
        'bounds',
        'positions.TE.receptions',
        /at most 2 decimal places/,
      )
      expectRejection(
        { ...template('ESPN Standard'), receptions: value },
        'bounds',
        'receptions',
        /at most 2 decimal places/,
      )
    }
  })

  it('MONOTONE in decimal places — the property the snap did not have', () => {
    // The snap accepted 99.99999999999 (11 dp) while refusing 99.9999999999
    // (10 dp): non-monotonic, so "how precise is too precise" had no answer.
    for (const value of [
      99.9, 99.99, 99.999, 99.9999, 99.99999, 99.999999, 99.9999999, 99.99999999,
      99.999999999, 99.9999999999, 99.99999999999,
    ]) {
      const decimals = String(value).split('.')[1]?.length ?? 0
      const result = validateScoringRulesDoc(withBase(espnFork(), { receptions: value }))
      expect([value, decimals, result.valid]).toEqual([value, decimals, decimals <= 2])
    }
  })

  it('closes guardrail 4’s no-op band: a 1e-12 "override" of the base value is refused', () => {
    // Under the snap this was ACCEPTED: it scores identically (Gronk's sample
    // line: 23.9 either way) but survives `normalizeScoringDoc`'s exact `===`
    // strip, so the All-Positions switch reads OFF for a section whose values
    // are in fact uniform — verbatim the harm guardrail 4's own message names.
    const doc = withOverride(espnFork(), 'TE', { receptions: 1.000000000001 })
    expect(normalizeScoringDoc(doc)).toEqual(doc) // the strip cannot see it
    expectRejection(doc, 'bounds', 'positions.TE.receptions', /at most 2 decimal places/)
  })

  it('ZERO false rejections: every legal 2dp coefficient in [-100, 100] is accepted (20,001 values)', () => {
    // The sweep that makes "adopt the exact decimal rule" safe rather than
    // merely strict. A flat one-key document keeps it cheap; `receptions` is
    // scorable and pulls in no other family.
    let rejected = 0
    for (let cents = -10000; cents <= 10000; cents++) {
      const value = cents / 100
      if (!validateScoringRulesDoc({ receptions: value }).valid) rejected++
    }
    expect(rejected).toBe(0)
  })

  it('ZERO false rejections on the shipped templates: all 218 coefficients pass', () => {
    const total = SCORING_TEMPLATES.reduce((n, t) => n + Object.keys(t.rules).length, 0)
    expect(total).toBe(218)
    for (const t of SCORING_TEMPLATES) expectAccepted(t.rules)
  })

  it('IS THE SQL RULE: acceptance ≡ Postgres `scale(p) <= 2` on the same literal', () => {
    // The mirror is exact by construction, so SE.4's parity fixture measures
    // agreement rather than documenting a divergence. `scale()` is the number
    // of digits after the decimal point in the jsonb literal, which is what
    // these strings are.
    const cases: Array<[number, number]> = [
      [4, 0],
      [0.5, 1],
      [0.04, 2],
      [-4.35, 2],
      [100, 0],
      [0.001, 3],
      [2.5001, 4],
      [0.30000000000000004, 17],
      [99.99999999999, 11],
    ]
    for (const [value, scale] of cases) {
      expect([value, String(value).split('.')[1]?.length ?? 0]).toEqual([value, scale])
      expect([value, validateScoringRulesDoc({ receptions: value }).valid]).toEqual([
        value,
        scale <= 2,
      ])
    }
  })
})

describe('R592 — the points-allowed table must start at 0 (D174 / R58 / D58)', () => {
  it('THE DEFECT IS REAL: a shifted PA cut list moves the E61 pending badge, in both directions', () => {
    // §7.3.3.1(a)'s controlling clause is that the cuts reading AGREES with
    // today's literals. A first cut below 0 pays a tier for corrupt data that
    // R58/D58 rules unmappable; a first cut above 0 withholds the family on an
    // ordinary low-scoring week. Neither moves a TOTAL — both move the badge,
    // which is the only signal E61 gives that a week is incomplete.
    const shiftedUp = { def_pa: [7, 14, 21, 28, 35], def_ya: [...YA_CUTS] }
    const paKeys = tierKeysFromCuts(DEF_PA_PREFIX, shiftedUp.def_pa)
    const rules = Object.fromEntries(paKeys.map((k) => [k, 1]))
    for (const pa of [0, 3, 6]) {
      const literal = scorePlayerWeek(rules, deriveTierIndicators({ def_points_allowed: pa }))
      const ownCuts = scorePlayerWeek(
        rules,
        deriveTierIndicators({ def_points_allowed: pa }, shiftedUp),
      )
      expect(literal.pending).toEqual([])
      expect(ownCuts.pending.length).toBe(paKeys.length) // a FALSE badge
      expect(ownCuts.total).toBe(literal.total)
    }
  })

  it('NAMED REJECTION + D146 ONE UNIT: first cut 0 accepts, −1 and 7 reject', () => {
    const bare = { ...espnFork(), base: {} }
    expectAccepted(withCuts(bare, { def_pa: [0, 7, 14, 21, 28, 35] }))
    const below = expectRejection(
      withCuts(bare, { def_pa: [-1, 0, 1, 7, 14, 21, 28, 35] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      FAMILY_NAME_IN_MESSAGE.tier_cuts,
    )
    expect(below.violations[0].message).toMatch(/must start at 0/)
    expectRejection(
      withCuts(bare, { def_pa: [7, 14, 21, 28, 35] }),
      'tier_cuts',
      'tier_cuts.def_pa',
      /must start at 0/,
    )
    // YA is untouched: its first tier is genuinely open below (D174), so a
    // negative-total-yards game belongs to it.
    expectAccepted(withCuts(bare, { def_ya: [-50, 0, 100] }))
  })
})

describe('R595 — a document cannot make the validator generate unbounded output', () => {
  it('the violation list is capped, and says so', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i < 500; i++) many[`bogus_key_${i}`] = 1
    const result = validateScoringRulesDoc(many)
    expect(result.valid).toBe(false)
    expect(result.violations.length).toBe(MAX_REPORTED_VIOLATIONS + 1)
    const last = result.violations[result.violations.length - 1]
    expect(last.message).toMatch(/500 problems/)
    // The cap NEVER changes the verdict — only how much of it is printed.
    expect(validateScoringRulesDoc({ ...many, receptions: 1 }).valid).toBe(false)
  })

  it('a long cut list does not become a long message', () => {
    const long: number[] = []
    for (let i = 0; i < 2000; i++) long.push(i)
    const doc = withCuts(withBase({ ...espnFork(), base: {} }, { def_pa_14_20: 1 }), {
      def_pa: long,
    })
    const result = validateScoringRulesDoc(doc)
    expect(codes(result)).toEqual(['tier_exclusivity'])
    expect(result.violations[0].message.length).toBeLessThan(600)
  })
})

describe('R596/R597 — the front door names ITS family, and format 1 is pinned', () => {
  it('NAMED REJECTION: the non-object refusal names the family and what it got', () => {
    for (const [input, got] of [
      [null, /got null/],
      [[], /got an array/],
      ['a scoring system', /got a string/],
      [42, /got a number/],
    ] as const) {
      const result = expectRejection(input, 'document_shape', '', got)
      expect(result.violations[0].message).toMatch(FAMILY_NAME_IN_MESSAGE.document_shape)
    }
  })

  it('D146 ONE UNIT: `format: 1` — one below the accepted value — is refused, and the message is not self-contradictory', () => {
    // SE.2 pins this exact fixture on the same discriminator
    // (`rules-doc.test.ts`), and this module claims to mirror it. The message
    // has to say the true thing: format 1 IS the flat map with no `format`
    // member, so a document that NAMES version 1 is not one.
    const result = expectRejection(
      { ...espnFork(), format: 1 },
      'document_shape',
      'format',
      /format 1 IS the flat map/,
    )
    expect(result.violations[0].message).not.toMatch(/this build validates format 1/)
    expectAccepted(espnFork()) // format 2, one unit up — the accepted value
  })

  it('NAMED REJECTION: an envelope whose `format` member was DELETED is diagnosed, not buried', () => {
    // Read as a flat map, its three members are simply unknown keys — six
    // nonsense allowlist violations that name nothing a commissioner can act
    // on. The document says what it is; the refusal should too.
    const noFormat: Record<string, unknown> = { ...espnFork() }
    delete noFormat.format
    expect('format' in noFormat).toBe(false)
    const result = validateScoringRulesDoc(noFormat)
    expect(result.valid).toBe(false)
    expect(result.violations[0].code).toBe('document_shape')
    expect(result.violations[0].path).toBe('')
    expect(result.violations[0].message).toMatch(/no "format" member/)
    expect(result.violations[0].message).toMatch(/base, positions, tier_cuts/)
  })
})

describe('R590 — guardrail 5 on the layer that actually holds the coefficients', () => {
  it('NAMED REJECTION: the magnitude arm on `base` (the layer a fork writes the whole template into)', () => {
    // Every magnitude and precision fixture in the first cut of this suite sat
    // at `positions.QB.*`, so `if (!path.startsWith('positions.')) continue`
    // in `checkBounds` left the whole suite green while `base.pass_tds = 1e9`
    // became `valid: true`. `base` is where a fork writes the template and
    // where the All-Positions switch writes every edit.
    expectRejection(
      withBase(espnFork(), { pass_tds: 100.01 }),
      'bounds',
      'base.pass_tds',
      /\|coef\| ≤ 100/,
    )
    expectAccepted(withBase(espnFork(), { pass_tds: 100 }))
  })

  it('NAMED REJECTION: the precision arm on `base`', () => {
    expectRejection(
      withBase(espnFork(), { pass_yards: 0.001 }),
      'bounds',
      'base.pass_yards',
      /at most 2 decimal places/,
    )
  })

  it('NAMED REJECTION: bounds on a FORMAT-1 document (the arm SE.4 must mirror)', () => {
    // Commenting out `checkBounds` in the flat arm left the suite green: a flat
    // league document got no bounds checking at all — not magnitude, not 2dp,
    // not even finite. D175's wall validates exactly those rows.
    expectRejection(
      { ...template('ESPN Standard'), pass_tds: 100.01 },
      'bounds',
      'pass_tds',
      /\|coef\| ≤ 100/,
    )
    expectRejection(
      { ...template('ESPN Standard'), pass_yards: 0.001 },
      'bounds',
      'pass_yards',
      /at most 2 decimal places/,
    )
    expectRejection(
      { ...template('ESPN Standard'), pass_tds: Number.NaN },
      'bounds',
      'pass_tds',
      /must be a finite number/,
    )
  })
})

describe('R593 — guardrail 1 on the D/ST override layer (the only layer with its own key set)', () => {
  it('NAMED REJECTION: the raw source under positions.DST — F21 verbatim, one layer down', () => {
    // `if (path.startsWith('positions.DST.')) continue` in `checkAllowlist`
    // left the suite green — and then ACCEPTED a fork paying
    // `positions.DST.def_points_allowed` beside its own eight `def_pa_*` tier
    // keys, which is the F21 double-count itself. QB/RB/WR/TE share one key
    // set by object identity, so QB's fixture covers them; D/ST's 27-key set
    // had no guardrail-1 fixture at all.
    expectRejection(
      withOverride(espnFork(), 'DST', { def_points_allowed: -0.5 }),
      'scorable_allowlist',
      'positions.DST.def_points_allowed',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
    expectRejection(
      withOverride(espnFork(), 'DST', { def_yards_allowed: -0.01 }),
      'scorable_allowlist',
      'positions.DST.def_yards_allowed',
      FAMILY_NAME_IN_MESSAGE.scorable_allowlist,
    )
  })
})

describe('R594 — guardrail 3’s K↔DST clause and its position VOCABULARY', () => {
  it('NAMED REJECTION: K keys under DST and D/ST keys under K (the clause with no fixture)', () => {
    // §7.3.3.1's sentence has three clauses — "K keys only under K, D/ST keys
    // only under DST, offense keys never under K/DST". The first cut pinned
    // only the third: widening `POSITION_KEY_SETS.K`/`.DST` to each other's
    // keys (leaving the exported catalog correct, so the disjointness and
    // union pins still saw a correct catalog) left the suite green.
    expectRejection(
      withOverride(espnFork(), 'DST', { fg_0_39: 4 }),
      'position_scope',
      'positions.DST.fg_0_39',
      /belongs to K/,
    )
    expectRejection(
      withOverride(espnFork(), 'DST', { pat_made: 2 }),
      'position_scope',
      'positions.DST.pat_made',
      /belongs to K/,
    )
    expectRejection(
      withOverride(espnFork(), 'K', { def_sack: 2 }),
      'position_scope',
      'positions.K.def_sack',
      /belongs to DST/,
    )
    expectRejection(
      withOverride(espnFork(), 'K', { def_pa_14_17: 2 }),
      'position_scope',
      'positions.K.def_pa_14_17',
      /belongs to DST/,
    )
  })

  it('NAMED REJECTION: the position vocabulary is EXACT — case and whitespace are not spellings', () => {
    // The near-boundary a forgiving SQL mirror (`upper(trim(p))`) invites, and
    // the reason it must not: `resolveRules` looks positions up by exact own
    // property, so a document accepted under `positions.dst` would pay NOTHING
    // while the wall said yes — a silently-ignored override map again.
    for (const spelling of ['qb', 'Qb', 'dst', 'DST ', ' K', 'D/ST', 'DEF']) {
      expect(resolveRules(withOverride(espnFork(), spelling, { def_sack: 9 }), 'DST').def_sack).toBe(
        1,
      )
      expectRejection(
        withOverride(espnFork(), spelling, { def_sack: 9 }),
        'position_scope',
        `positions.${spelling}`,
        FAMILY_NAME_IN_MESSAGE.position_scope,
      )
    }
    // …and the six exact spellings are accepted, so this is a boundary and not
    // a blanket refusal.
    for (const position of SCORING_POSITIONS) {
      // Each position's own first catalog key, one point off its base value —
      // legal everywhere the spelling is exact.
      const key = POSITION_SCORABLE_KEYS[position][0]
      const base = espnFork().base[key] ?? 0
      expectAccepted(withOverride(espnFork(), position, { [key]: base + 1 }))
    }
  })
})

describe('the family names are MUTUALLY EXCLUSIVE (R596 — a message names ITS family, not just the section)', () => {
  it('no message matches a foreign family’s discriminator, across every rejection fixture', () => {
    const families = Object.keys(FAMILY_NAME_IN_MESSAGE) as ScoringGuardrail[]
    let checked = 0
    for (const doc of REJECTION_CORPUS) {
      for (const violation of validateScoringRulesDoc(doc).violations) {
        expect(violation.message).toMatch(FAMILY_NAME_IN_MESSAGE[violation.code])
        for (const other of families) {
          if (other === violation.code) continue
          expect([violation.code, other, FAMILY_NAME_IN_MESSAGE[other].test(violation.message)]).toEqual(
            [violation.code, other, false],
          )
        }
        checked++
      }
    }
    // The corpus must actually exercise every family, or "mutually exclusive"
    // is a claim about an empty set.
    expect(checked).toBeGreaterThan(REJECTION_CORPUS.length)
    const seen = new Set(
      REJECTION_CORPUS.flatMap((doc) => codes(validateScoringRulesDoc(doc))),
    )
    expect([...seen].sort()).toEqual([...families].sort())
  })
})
