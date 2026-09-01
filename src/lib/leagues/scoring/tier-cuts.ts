/**
 * Tier-family CUT LISTS and key generation (SE.1; spec §23.5's v2.11 registry
 * bullet (b) + §7.3.3.1's D/ST-tiers bullet (a); D167's engine-home rule).
 *
 * A defense's points-allowed and yards-allowed tiers are two INDEPENDENT,
 * additively-scored tables (§7.3.3.1's D/ST bullet — never alternatives).
 * Each table is defined by ONE ascending list of integer cut points; the
 * tiers are `[cut, next_cut)` with the last open-ended, and the tier KEY
 * NAMES are generated from that list:
 *
 *     `<prefix>_<lo>_<hi>` with `hi = next_cut - 1`
 *     single-value tier    → `<prefix>_<lo>`      (e.g. `def_pa_0`)
 *     final open tier      → `<prefix>_<lo>_plus` (e.g. `def_pa_35_plus`)
 *
 * *(The spec names the single-value case as "single-value FIRST tier →
 * `def_pa_0`", which is the only one the three shipped families contain.
 * `tierKeysFromCuts` applies the same rule to a single-value tier wherever
 * it occurs — a strict generalization that is unobservable today, pinned as
 * such in `tier-cuts.test.ts`; F59's boundary editor is the first caller
 * that could construct one elsewhere.)*
 *
 * **Why the cut lists exist at all (the backward-compatibility argument).**
 * §7.3.3.1(a) reserves per-league `tier_cuts` in the format-2 envelope NOW
 * because cut points can only live in the league's own scoring document —
 * bolting them on later would force a third format version plus a migration
 * of every stored doc and a re-proof of every frozen snapshot. The whole
 * argument rests on one measurable claim: **these three cut lists regenerate
 * today's three families byte-exactly**, so a doc carrying `tier_cuts`
 * scores identically whether the engine reads cuts or `derive-stats.ts`'s
 * literals. The spec's own words: "pin this equivalence by test — it is the
 * whole backward-compatibility argument." That pin is
 * `tier-cuts.test.ts` → "regenerates today's three families byte-exactly",
 * cross-checked against BOTH `DEF_PA_BUCKETS`/`DEF_YA_BUCKETS` and the keys
 * the seven shipped `SCORING_TEMPLATES` rules objects actually reference
 * (six incumbents + Scout Scoring, SC.1/migration 106 — R684).
 *
 * This module is NAMES + BOUNDS only. It decides nothing about what a tier
 * PAYS (the rules document does) and nothing about editing boundaries (F59).
 */

/**
 * A generated (or literal) tier row: the key plus its INCLUSIVE integer
 * bounds; ±Infinity for the open ends.
 *
 * *(Declared here rather than in `derive-stats.ts` — where it lived until
 * SE.1 — so this module has no import edge back into its own consumer.
 * `derive-stats.ts` re-exports the name, so every existing importer of
 * `TierBucket` from there is unaffected.)*
 */
export interface TierBucket {
  key: string
  /** Inclusive bounds; -Infinity/Infinity for the open ends. */
  lo: number
  hi: number
}

/** Key prefix of the points-allowed tier family. */
export const DEF_PA_PREFIX = 'def_pa'
/** Key prefix of the yards-allowed tier family. */
export const DEF_YA_PREFIX = 'def_ya'

/**
 * The shared (Yahoo/Sleeper single-model) points-allowed family — §23.5(b).
 * Generates the 7 keys `def_pa_0 … def_pa_35_plus`.
 */
export const SHARED_PA_CUTS: readonly number[] = [0, 1, 7, 14, 21, 28, 35]

/**
 * ESPN's published points-allowed family (spec v2.8.3 erratum / D56) —
 * §23.5(b). Generates the 8 keys including ESPN's divergent 14–17 / 18–27 /
 * 35–45 / 46+ rows.
 */
export const ESPN_PA_CUTS: readonly number[] = [0, 1, 7, 14, 18, 28, 35, 46]

/**
 * The yards-allowed family (Q3 ruling, ESPN's published buckets) — §23.5(b).
 * One table only: no platform family cuts YA differently today.
 */
export const YA_CUTS: readonly number[] = [
  0, 100, 200, 300, 350, 400, 450, 500, 550,
]

/**
 * How a family's FIRST tier treats values below its first cut — the D174
 * reconciliation, which is a per-family fact, not a global one:
 *
 * - `'floor'` (points allowed): the first tier starts AT the first cut.
 *   `def_pa_0` is pinned to exactly 0 — a scoreless opponent — and R58/D58
 *   rules a negative PA UNMAPPABLE (family withheld, keys land on the
 *   calculator's pending path), because negative points allowed is corrupt
 *   data, not a real game.
 * - `'open_below'` (yards allowed): the first tier is genuinely open below —
 *   a negative total-yards game is rare but real, and belongs in `<100`.
 *
 * §7.3.3.1(a) says "the first open-below"; D174 resolves the tension with
 * the same bullet's controlling agreement clause ("no behavior change" — the
 * cuts reading must agree with today's literals), so PA keeps its floor.
 */
export type FirstTierBound = 'floor' | 'open_below'

/** D174: points-allowed floors at its first cut (R58 semantics preserved). */
export const DEF_PA_FIRST_TIER: FirstTierBound = 'floor'
/** D174: yards-allowed's first bucket is open below (`derive-stats.ts:87`). */
export const DEF_YA_FIRST_TIER: FirstTierBound = 'open_below'

/**
 * **The DERIVE-PATH parameter shape — both tables optional, and that is a
 * property of the PARAMETER, not of the document.** `deriveTierIndicators`
 * accepts cuts for either table independently and falls back to today's
 * literals for the other, so a caller may override one family alone. A
 * stored format-2 document may NOT.
 *
 * ⚠ **SE.2 must NOT reuse this type for the envelope — use
 * `EnvelopeTierCuts`.** The printed format-2 shape in §7.3.3.1 writes both
 * `def_pa` and `def_ya` unconditionally, and tasks-SE SE.2(4) is explicit
 * that *"the YA slot is ALWAYS written… a single-model doc simply pays no
 * `def_ya_*` keys"* — a doc that pays no YA keys still carries the YA cut
 * list. Typing the envelope with optional members would let a document omit
 * a table, which is a format defect inherited from a parameter's convenience
 * (R577).
 */
export interface TierCuts {
  def_pa?: readonly number[]
  def_ya?: readonly number[]
}

/**
 * **The `tier_cuts` member of a format-2 rules envelope (§7.3.3.1) — BOTH
 * tables required, always written.** This is the shape SE.2's envelope type
 * references; it is assignable to `TierCuts`, so an envelope's cuts can be
 * handed straight to `deriveTierIndicators` (pinned in `tier-cuts.test.ts`).
 *
 * PA and YA are independent, additively-scored tables (§7.3.3.1's D/ST
 * bullet), never alternatives — which is exactly why neither slot is
 * omissible: "this league pays no yards-allowed table" is expressed by
 * paying no `def_ya_*` keys, never by dropping its cut list. Dropping it
 * would make the doc's own tier-exclusivity guardrail (F21 guardrail 2,
 * "`def_ya_*` keys ⊆ the set generated by `tier_cuts.def_ya`") unevaluable.
 */
export interface EnvelopeTierCuts {
  def_pa: readonly number[]
  def_ya: readonly number[]
}

/**
 * Preconditions on a cut list, enforced LOUDLY (CLAUDE.md: never let a bad
 * input produce a plausible-looking result). A malformed list would
 * otherwise generate plausible key names — `def_pa_14_12`, or a duplicate —
 * that no test and no validator would ever look at again.
 *
 * This is the FUNCTION's own precondition, not the §7.3.3.1(5) document
 * validator (SE.3/SE.4 own that) and not F59's boundary-editor UI
 * validation; §7.3.3.1(c) names the same three conditions — ascending,
 * integers, ≥ 2 cuts — as what stays to be checked once boundaries are
 * editable, and they are checked here because this is where a bad list
 * would first do damage.
 */
function assertCutList(prefix: string, cuts: readonly number[]): void {
  if (cuts.length < 2) {
    throw new TypeError(
      `tier cut list for "${prefix}" needs at least 2 cuts, got ${cuts.length} (§7.3.3.1(c) — one cut cannot define a tier boundary)`,
    )
  }
  for (let i = 0; i < cuts.length; i++) {
    if (!Number.isInteger(cuts[i])) {
      throw new TypeError(
        `tier cut list for "${prefix}" must be integers, got ${String(cuts[i])} at index ${i} (§7.3.3.1(c); R58/D58 — the published tables' domain is the integers)`,
      )
    }
    if (i > 0 && cuts[i] <= cuts[i - 1]) {
      throw new TypeError(
        `tier cut list for "${prefix}" must ascend strictly, got ${cuts[i - 1]} then ${cuts[i]} at index ${i} (§7.3.3.1(c) — overlaps and gaps are meant to be unconstructible)`,
      )
    }
  }
}

/**
 * The §7.3.3.1(a) generation rule: cut list → tier KEY NAMES, in ascending
 * order. Names only — bounds are `tierBucketsFromCuts`, which derives its
 * names from this function so the two can never disagree.
 */
export function tierKeysFromCuts(
  prefix: string,
  cuts: readonly number[],
): string[] {
  assertCutList(prefix, cuts)

  const last = cuts.length - 1
  return cuts.map((lo, i) => {
    if (i === last) return `${prefix}_${lo}_plus`
    const hi = cuts[i + 1] - 1
    return hi === lo ? `${prefix}_${lo}` : `${prefix}_${lo}_${hi}`
  })
}

/**
 * The same tiers as `TierBucket[]` — the shape `deriveTierIndicators` maps a
 * raw source value through. Keys come from `tierKeysFromCuts`; bounds are
 * `[cut, next_cut - 1]` with the last tier open above and the first tier's
 * lower bound per `firstTier` (D174).
 */
export function tierBucketsFromCuts(
  prefix: string,
  cuts: readonly number[],
  firstTier: FirstTierBound,
): TierBucket[] {
  const keys = tierKeysFromCuts(prefix, cuts)
  const last = keys.length - 1
  return keys.map((key, i) => ({
    key,
    lo: i === 0 && firstTier === 'open_below' ? -Infinity : cuts[i],
    hi: i === last ? Infinity : cuts[i + 1] - 1,
  }))
}
