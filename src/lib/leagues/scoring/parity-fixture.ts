/**
 * The TS≡SQL parity fixture (SE.4(4); D168(1)'s anti-drift mechanism).
 *
 * ## Why this is a module and not two arrays
 *
 * D168 puts one validator in each language — `validateScoringRulesDoc` (TS,
 * SE.3) and `scoring_rules_validate` (SQL, migration 103) — and ties them with
 * "one shared table of accept/reject docs run through both, so the mirrors
 * cannot drift silently". **Shared means one definition.** `ONE_FAMILY_EACH`
 * was born in `validate-rules-doc.test.ts`; D269(7) called it "the TS half of
 * SE.4(4)'s parity fixture, ready to lift", and this is the lift — the array
 * moved here and the SE.3 suite imports it back. Copying it would have
 * recreated, one level up, exactly the drift the fixture exists to prevent.
 *
 * ## What the fixture is FOR, and the shape that follows from it
 *
 * SQL RAISEs on the FIRST violation; TS returns all of them, ordered by
 * §7.3.3.1's own family numbering. So a parity document must break **exactly
 * one** family — then "the family SQL names" and "the family TS reports" are
 * the same question, and `scoring-parity-db.test.ts` can assert them equal
 * along with the dot path. Every entry below is asserted to produce exactly
 * one TS violation (`validate-rules-doc.test.ts` → "the SE.4 contract"), so
 * that property is machine-checked on both sides of the lift.
 *
 * ## And the shape D269(12) says it must have
 *
 * > *A parity fixture built as "one document per family" is a checklist of
 * > NAMES, not of behaviours — and the mirror it certifies is only as good as
 * > the arms it exercises.*
 *
 * The first cut was one `espnFork()`-derived document per family — seven
 * entries — and six of SE.3's eleven review findings would have propagated
 * into SE.4 straight through it: the format-1 arm SE.4(1) must also mirror had
 * no document at all; the bounds entry short-circuited on magnitude and never
 * reached the precision arm (exactly where TS and SQL could differ); stray
 * envelope members, the D/ST allowlist layer, the K↔DST scope clause, the
 * position vocabulary and the PA floor had none either. It now carries a
 * document per **ARM**, in **both formats**. Add to it when you add an arm.
 */

import {
  forkTemplateDoc,
  type FlatScoringRules,
  type ScoringRulesDocV2,
} from './rules-doc'
import { SCORING_TEMPLATES } from './templates'
import type { ScoringGuardrail } from './validate-rules-doc'

// ---------------------------------------------------------------------------
// Fixture builders — every rejection document below is ONE EDIT from a
// document in the acceptance floor, which is what makes the pins readable.
// ---------------------------------------------------------------------------

export const template = (name: string): FlatScoringRules => {
  const found = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!found) throw new Error(`no template named ${name}`)
  return found.rules
}

/** The canonical valid format-2 document: a fresh fork of ESPN Full PPR
 *  (ESPN cuts, a YA table, and a `receptions` coefficient to override). */
export const espnFork = (): ScoringRulesDocV2 => forkTemplateDoc(template('ESPN Full PPR'))
/** A shared-family fork: Yahoo Half PPR (shared PA cuts, no YA keys paid). */
export const yahooFork = (): ScoringRulesDocV2 => forkTemplateDoc(template('Yahoo Half PPR'))

export const withBase = (
  doc: ScoringRulesDocV2,
  patch: Record<string, unknown>,
): ScoringRulesDocV2 =>
  ({ ...doc, base: { ...doc.base, ...patch } }) as ScoringRulesDocV2

export const withOverride = (
  doc: ScoringRulesDocV2,
  position: string,
  map: Record<string, unknown>,
): ScoringRulesDocV2 =>
  ({ ...doc, positions: { ...doc.positions, [position]: map } }) as ScoringRulesDocV2

/** A fresh `tier_cuts` — never a mutation: `forkTemplateDoc` writes the module
 *  constants BY REFERENCE (R587), so an in-place edit here would re-cut every
 *  league in the process. */
export const withCuts = (
  doc: ScoringRulesDocV2,
  patch: { def_pa?: unknown; def_ya?: unknown },
): ScoringRulesDocV2 =>
  ({ ...doc, tier_cuts: { ...doc.tier_cuts, ...patch } }) as ScoringRulesDocV2

// ---------------------------------------------------------------------------
// The rejection half — one document per guardrail ARM, both formats
// ---------------------------------------------------------------------------

/**
 * Documents that break EXACTLY one family — the shape SE.4's TS≡SQL parity
 * fixture is built from (SQL RAISEs on the FIRST violation, so a parity
 * document must have only one).
 *
 * **It began as literally one document per family, and that was too narrow to
 * do the job D168 gives it (SE.3 review §5).** See the module docblock: six of
 * the review's eleven findings would have propagated into SE.4 through this one
 * array. It now carries a document per ARM, and its coverage assertion is
 * "every family is exercised" **plus** "both formats appear", not "exactly one
 * document each".
 */
export const ONE_FAMILY_EACH: Array<{ code: ScoringGuardrail; doc: unknown }> = [
  { code: 'document_shape', doc: { ...espnFork(), format: 3 } },
  { code: 'document_shape', doc: { ...espnFork(), format: 1 } },
  { code: 'document_shape', doc: { ...espnFork(), postions: { QB: { receptions: 99 } } } },
  { code: 'scorable_allowlist', doc: withBase(espnFork(), { def_points_allowed: 1 }) },
  {
    code: 'scorable_allowlist',
    doc: withOverride(espnFork(), 'DST', { def_points_allowed: -0.5 }),
  },
  { code: 'scorable_allowlist', doc: { ...template('ESPN Standard'), targets: 0.5 } },
  { code: 'tier_exclusivity', doc: withBase(espnFork(), { def_pa_14_20: 4 }) },
  { code: 'tier_exclusivity', doc: { def_pa_14_20: 4, def_pa_18_27: 3 } },
  { code: 'position_scope', doc: withOverride(espnFork(), 'QB', { fg_0_39: 4 }) },
  { code: 'position_scope', doc: withOverride(espnFork(), 'DST', { fg_0_39: 4 }) },
  { code: 'position_scope', doc: withOverride(espnFork(), 'K', { def_sack: 2 }) },
  { code: 'position_scope', doc: withOverride(espnFork(), 'qb', { pass_tds: 5 }) },
  { code: 'normal_form', doc: withOverride(espnFork(), 'TE', { receptions: 1 }) },
  // Bounds, one document per ARM — magnitude, precision, finiteness — and on
  // BOTH layers plus the flat document, because SQL walks base and positions
  // as separate loops and mirrors the format-1 arm too.
  { code: 'bounds', doc: withOverride(espnFork(), 'QB', { pass_tds: 100.01 }) },
  { code: 'bounds', doc: withBase(espnFork(), { pass_tds: 100.01 }) },
  { code: 'bounds', doc: withBase(espnFork(), { receptions: 2.5001 }) },
  { code: 'bounds', doc: withBase(espnFork(), { receptions: 0.30000000000000004 }) },
  { code: 'bounds', doc: { ...template('ESPN Standard'), pass_tds: 100.01 } },
  { code: 'bounds', doc: { ...template('ESPN Standard'), pass_yards: 0.001 } },
  { code: 'tier_cuts', doc: withCuts(espnFork(), { def_pa: [0, 7, 7] }) },
  { code: 'tier_cuts', doc: withCuts(espnFork(), { def_xx: [0, 1] } as { def_pa?: unknown }) },
  {
    code: 'tier_cuts',
    doc: withCuts({ ...espnFork(), base: {} }, { def_pa: [7, 14, 21, 28, 35] }),
  },
]

// ---------------------------------------------------------------------------
// The acceptance half — "a parity fixture that only proves the accepts is half
// a fixture", and so is one that only proves the refusals
// ---------------------------------------------------------------------------

/**
 * SE.3(3)'s acceptance floor, as data: all six shipped templates (the format-1
 * arm — and the documents D175's wall will actually meet, since every league
 * reference today is a template row), all six of their forks (the format-2
 * arm), and the editor's headline legal edit.
 *
 * Built from `SCORING_TEMPLATES` and `forkTemplateDoc`, never re-authored, so
 * a template change moves the floor rather than leaving it stale beside one.
 */
export const ACCEPTANCE_FLOOR: Array<{ label: string; doc: unknown }> = [
  ...SCORING_TEMPLATES.map((t) => ({ label: `template: ${t.name}`, doc: t.rules })),
  ...SCORING_TEMPLATES.map((t) => ({
    label: `fork: ${t.name}`,
    doc: forkTemplateDoc(t.rules),
  })),
  {
    // The editor's headline use case: receptions worth more to a TE than to
    // everyone else — a real override, not a no-op, at a legal 2dp value.
    label: 'TE-premium override (§7.3.3.1s own worked example)',
    doc: withOverride(espnFork(), 'TE', { receptions: 1.5 }),
  },
]
