import {
  isFormat1Doc,
  normalizeScoringDoc,
  SCORING_POSITIONS,
  type FlatScoringRules,
  type ScoringPosition,
  type ScoringRulesDoc,
  type ScoringRulesDocV2,
} from '@/lib/leagues/scoring/rules-doc'
import { POSITION_SCORABLE_KEYS } from '@/lib/leagues/scoring/validate-rules-doc'
import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import { LeaguePatchError } from '@/hooks/use-league'

/**
 * Custom scoring editor — the pure ops layer (SE.7; spec §7.3.3.1, §16.2's
 * `scoring-editor-ops.ts` row; D167).
 *
 * D167's placement rule, honored: format, resolver, and cut-list math live in
 * `src/lib/leagues/scoring/` — this file COMPOSES them for the editor and owns
 * only the editor's rendering law: the section catalog (sections, labels,
 * ordering, D173's `gated` flag), the All-Positions switch derivation, edit
 * application, input clamping, and the save/refusal plumbing. No React, no
 * fetch, no engine math re-implemented.
 *
 * F136, discharged here: the catalog never re-transcribes §7.3.3.1's key
 * lists into a second source of truth the validator can drift from. Every
 * ungated catalog key is checked against the engine's
 * `POSITION_SCORABLE_KEYS` at module init (`composeCatalog` throws on a
 * mismatch, so a drifted catalog cannot even load), labels come from the
 * `STAT_KEYS` registry, and the colocated test additionally proves the
 * per-position set equalities F136's discharge shape names. The one key with
 * no registry entry is `return_yards` (Q13/D173): the gated catalog entry is
 * deliberately the ONLY place it exists, so it is exempt from the membership
 * check until the data task lands — at which point flipping `gated` off makes
 * the init check demand its `POSITION_SCORABLE_KEYS` membership, which is
 * exactly F71's one-place change.
 */

// ---------------------------------------------------------------------------
// 1. The stepper and the section catalog
// ---------------------------------------------------------------------------

/**
 * The position stepper, in §7.3.3.1's literal order: QB → RB → WR → TE → K →
 * D/ST. Re-exported from the engine's `SCORING_POSITIONS` rather than spelled
 * again — one source of order; the colocated golden pins the literal.
 */
export const STEPPER_POSITIONS: readonly ScoringPosition[] = SCORING_POSITIONS

/** Display name for a stepper position — the engine spells `DST`, the spec
 *  prints "D/ST" (§7.3.3.1's stepper bullet). */
export function positionLabel(position: ScoringPosition): string {
  return position === 'DST' ? 'D/ST' : position
}

export type ScoringEditorSectionId =
  | 'rushing'
  | 'passing'
  | 'receiving'
  | 'special_teams'
  | 'turnovers'
  | 'kicking'
  | 'dst_events'

export interface ScoringFieldDef {
  /** Canonical registry key (§23.5 one-namespace). */
  key: string
  /** Display label — from the `STAT_KEYS` registry for every ungated key;
   *  a gated key has no registry entry yet, so the catalog carries its own. */
  label: string
  /**
   * D173: a gated field renders NOTHING (not a disabled row — §16.5.5's
   * don't-build-deferred-UI posture) until its data task flips this off.
   * The flag is what `renderableFields` filters on.
   */
  gated?: true
}

export interface ScoringSectionDef {
  id: ScoringEditorSectionId
  title: string
  /** The positions whose stepper page renders this section. */
  positions: readonly ScoringPosition[]
  fields: readonly ScoringFieldDef[]
}

const registryLabel = (key: string): string => {
  const def = STAT_KEYS.find((d) => d.key === key)
  if (!def) {
    throw new Error(
      `scoring-editor catalog references '${key}', which has no STAT_KEYS entry — an ungated catalog key must exist in the registry (§23.5)`,
    )
  }
  return def.label
}

const OFFENSE_POSITIONS: readonly ScoringPosition[] = ['QB', 'RB', 'WR', 'TE']

/**
 * Init-time composition guard (F136): every UNGATED catalog key must be legal
 * for every position whose page renders it, per the engine's
 * `POSITION_SCORABLE_KEYS` — the map guardrail 3 enforces on every write.
 * A catalog that offers a key the validator refuses (or the reverse — the
 * completeness half — is the colocated test's set equality) cannot load.
 *
 * Hedge (D276): this guard runs at module init because the exported catalog
 * is its return value — it cannot be skipped without the import itself
 * failing. What it does NOT guarantee is that a component renders only
 * catalog fields; that seam is pinned separately (the component-source sweep
 * in `scoring-editor.test.ts`).
 */
export const composeCatalog = (
  sections: readonly ScoringSectionDef[],
): readonly ScoringSectionDef[] => {
  const seen = new Set<string>()
  for (const section of sections) {
    for (const field of section.fields) {
      if (seen.has(field.key)) {
        throw new Error(
          `scoring-editor catalog lists '${field.key}' in two sections — one key, one section`,
        )
      }
      seen.add(field.key)
      if (field.gated) continue
      for (const position of section.positions) {
        if (!POSITION_SCORABLE_KEYS[position].includes(field.key)) {
          throw new Error(
            `scoring-editor catalog offers '${field.key}' on the ${position} page but POSITION_SCORABLE_KEYS[${position}] refuses it — the editor may never offer a key the validator rejects (F136)`,
          )
        }
      }
    }
  }
  return sections
}

/**
 * §7.3.3.1's pinned section catalog, verbatim — the ops layer renders this,
 * never invents. Section ORDER is the product-shape bullet's literal listing
 * (Rushing · Passing · Receiving · Special Teams · Turnovers), identical on
 * every offense page; K and D/ST are one single-section page each (Q12).
 *
 * D/ST's tier-indicator keys (`def_pa_*` / `def_ya_*`) are deliberately NOT
 * grid fields here — they render as the D/ST tier tables (payout editable,
 * boundaries read-only), which SE.8 builds. The catalog-completeness pin in
 * the colocated test states that subtraction exactly.
 */
export const SCORING_EDITOR_SECTIONS: readonly ScoringSectionDef[] = composeCatalog([
  {
    id: 'rushing',
    title: 'Rushing',
    positions: OFFENSE_POSITIONS,
    fields: [
      { key: 'rush_yards', label: registryLabel('rush_yards') },
      { key: 'rush_tds', label: registryLabel('rush_tds') },
      { key: 'rush_2pt', label: registryLabel('rush_2pt') },
    ],
  },
  {
    id: 'passing',
    title: 'Passing',
    positions: OFFENSE_POSITIONS,
    fields: [
      { key: 'pass_yards', label: registryLabel('pass_yards') },
      { key: 'pass_tds', label: registryLabel('pass_tds') },
      { key: 'pass_2pt', label: registryLabel('pass_2pt') },
      { key: 'qb_sack_taken', label: registryLabel('qb_sack_taken') },
    ],
  },
  {
    id: 'receiving',
    title: 'Receiving',
    positions: OFFENSE_POSITIONS,
    fields: [
      { key: 'receptions', label: registryLabel('receptions') },
      { key: 'receiving_yards', label: registryLabel('receiving_yards') },
      { key: 'receiving_tds', label: registryLabel('receiving_tds') },
      { key: 'rec_2pt', label: registryLabel('rec_2pt') },
    ],
  },
  {
    id: 'special_teams',
    title: 'Special Teams',
    positions: OFFENSE_POSITIONS,
    fields: [
      { key: 'return_td', label: registryLabel('return_td') },
      // Q13 ruled: return YARDS ship when a data source is found. D173: the
      // flag ships OFF, this catalog entry is the ONLY place the field
      // exists (no registry entry until the data task lands — F71), and a
      // gated field renders nothing. Flipping this flag is Q13's step (3).
      { key: 'return_yards', label: 'Kick/Punt Return Yards', gated: true },
    ],
  },
  {
    id: 'turnovers',
    title: 'Turnovers',
    positions: OFFENSE_POSITIONS,
    fields: [
      { key: 'interceptions', label: registryLabel('interceptions') },
      { key: 'fumbles_lost', label: registryLabel('fumbles_lost') },
      { key: 'fumble_recovery_td', label: registryLabel('fumble_recovery_td') },
    ],
  },
  {
    id: 'kicking',
    title: 'Kicking',
    positions: ['K'],
    fields: [
      { key: 'fg_0_39', label: registryLabel('fg_0_39') },
      { key: 'fg_40_49', label: registryLabel('fg_40_49') },
      { key: 'fg_50_plus', label: registryLabel('fg_50_plus') },
      { key: 'pat_made', label: registryLabel('pat_made') },
      { key: 'fg_missed', label: registryLabel('fg_missed') },
      { key: 'pat_missed', label: registryLabel('pat_missed') },
    ],
  },
  {
    id: 'dst_events',
    title: 'D/ST',
    positions: ['DST'],
    fields: [
      { key: 'def_sack', label: registryLabel('def_sack') },
      { key: 'def_int', label: registryLabel('def_int') },
      { key: 'def_fumble_rec', label: registryLabel('def_fumble_rec') },
      { key: 'def_td', label: registryLabel('def_td') },
      { key: 'def_safety', label: registryLabel('def_safety') },
      { key: 'def_block', label: registryLabel('def_block') },
      { key: 'def_return_td', label: registryLabel('def_return_td') },
    ],
  },
])

/** The sections a position's stepper page renders, in catalog order —
 *  QB/RB/WR/TE get the five offense sections, K and DST one each (Q12). */
export function sectionsForPosition(
  position: ScoringPosition,
): readonly ScoringSectionDef[] {
  return SCORING_EDITOR_SECTIONS.filter((s) => s.positions.includes(position))
}

/** D173's render filter: a gated field renders nothing, anywhere. */
export function renderableFields(
  section: ScoringSectionDef,
): readonly ScoringFieldDef[] {
  return section.fields.filter((field) => field.gated !== true)
}

const sectionById = (id: ScoringEditorSectionId): ScoringSectionDef => {
  const section = SCORING_EDITOR_SECTIONS.find((s) => s.id === id)
  if (!section) throw new Error(`unknown scoring-editor section '${id}'`)
  return section
}

// ---------------------------------------------------------------------------
// 2. Document plumbing shared by the derivations below
// ---------------------------------------------------------------------------

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key)

/** Narrow to the format-2 envelope; the editor only ever EDITS format 2
 *  (SE.5's fork always writes it — a format-1 doc renders read-only). */
export function isEditableScoringDoc(doc: ScoringRulesDoc): doc is ScoringRulesDocV2 {
  return !isFormat1Doc(doc)
}

const assertEditable = (doc: ScoringRulesDoc): ScoringRulesDocV2 => {
  if (!isEditableScoringDoc(doc)) {
    throw new Error(
      'scoring-editor ops require a format-2 document — a format-1 doc renders read-only (§7.3.3.1)',
    )
  }
  return doc
}

/** normalizeScoringDoc, narrowed: a format-2 input normalizes to format 2
 *  (the strip never removes the envelope). */
const normalizeV2 = (doc: ScoringRulesDocV2): ScoringRulesDocV2 => {
  const normalized = normalizeScoringDoc(doc)
  return assertEditable(normalized)
}

/** What the grid needs to read values: `base` + `positions`. A full V2 doc
 *  satisfies it; a format-1 doc displays through `{ base: doc, positions: {} }`
 *  without fabricating `tier_cuts` it does not have. */
export interface ScoringDocView {
  base: FlatScoringRules
  positions: Partial<Record<ScoringPosition, FlatScoringRules>>
}

/** A format-1 document as a read-only view: every value is an
 *  all-positions value, there are no overrides. Display only — never
 *  saved (the editor refuses to edit format 1). */
export function format1View(doc: FlatScoringRules): ScoringDocView {
  return { base: doc, positions: {} }
}

// ---------------------------------------------------------------------------
// 3. The All-Positions switch — derived state (§7.3.3.1, verbatim)
// ---------------------------------------------------------------------------

/**
 * §7.3.3.1: "A section shows All-Positions ON iff none of its keys carry a
 * position override (its values live entirely in `base`)."
 *
 * Derivation runs over the section's RENDERABLE keys — a gated key renders
 * nothing, so it cannot flip a switch (and a doc carrying one would already
 * be refused by guardrail 1, the gated key having no registry entry).
 * The truth table — including the mixed case, where ONE of a section's keys
 * is overridden for ONE position — is pinned in the colocated goldens.
 */
export function allPositionsOn(
  view: ScoringDocView,
  sectionId: ScoringEditorSectionId,
): boolean {
  const section = sectionById(sectionId)
  for (const field of renderableFields(section)) {
    for (const position of SCORING_POSITIONS) {
      const override = view.positions[position]
      if (override !== undefined && hasOwn(override, field.key)) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// 4. Edit application
// ---------------------------------------------------------------------------

export type ScoringEditScope = 'all' | ScoringPosition

export interface ScoringEdit {
  section: ScoringEditorSectionId
  key: string
  /** `'all'` writes `base` (the switch-ON arm); a position writes
   *  `positions[P]` (§7.3.3.1's switch bullet). */
  scope: ScoringEditScope
  /**
   * The committed coefficient, or `null` to remove:
   *  - scope `'all'`, null → the key leaves `base` — the league stops
   *    scoring the category (absent ≠ 0: absent is "not scored at all",
   *    `0` is "scored, worth nothing" — the D59(4) distinction
   *    `normalizeScoringDoc`'s docblock pins).
   *  - scope P, null → the override leaves `positions[P]` — the position
   *    reverts to the all-positions value. Turning a category OFF for one
   *    position is an explicit `0` override, never a removal.
   */
  value: number | null
}

/**
 * Apply one grid edit and return the NORMALIZED result (§7.3.3.1's normal
 * form rides on every edit, so the derived switch state is always readable
 * from the document in hand — editing an override back to the base value
 * strips it, and the switch flips back ON by derivation, not by bookkeeping).
 *
 * Throws on edits the grid can never produce (unknown section, gated or
 * out-of-section key, a position the section does not render): those are
 * programmer errors, not user states, and a silent drop here would be the
 * "nothing happened" class.
 */
export function applyEdit(doc: ScoringRulesDocV2, edit: ScoringEdit): ScoringRulesDocV2 {
  assertEditable(doc)
  const section = sectionById(edit.section)
  const field = section.fields.find((f) => f.key === edit.key)
  if (!field || field.gated) {
    throw new Error(
      `applyEdit: '${edit.key}' is not an editable field of section '${edit.section}'`,
    )
  }
  if (edit.scope !== 'all' && !section.positions.includes(edit.scope)) {
    throw new Error(
      `applyEdit: section '${edit.section}' does not render on the ${edit.scope} page`,
    )
  }

  const next: ScoringRulesDocV2 = {
    ...doc,
    base: { ...doc.base },
    positions: { ...doc.positions },
  }

  if (edit.scope === 'all') {
    if (edit.value === null) delete next.base[edit.key]
    else next.base[edit.key] = edit.value
  } else {
    const override = { ...(next.positions[edit.scope] ?? {}) }
    if (edit.value === null) delete override[edit.key]
    else override[edit.key] = edit.value
    next.positions[edit.scope] = override
  }

  return normalizeV2(next)
}

/**
 * Flip a section's All-Positions switch ON (spec: "applies that section's
 * values to every position").
 *
 * WHICH values become the shared ones is a judgment call the spec leaves
 * open, decided screen-stable and flagged on SE.7's PR: the values the
 * commissioner is LOOKING AT — the viewing position's effective values —
 * are adopted into `base`, and the section's keys are stripped from every
 * position override. Nothing on the visible page jumps; other positions'
 * diverging values for this section are the thing the commissioner just
 * asked to collapse.
 *
 * A key the viewing position does not score (absent from base AND from its
 * override) ends absent everywhere — "these values, for everyone" includes
 * the absences.
 */
export function applyAllPositionsOn(
  doc: ScoringRulesDocV2,
  sectionId: ScoringEditorSectionId,
  viewPosition: ScoringPosition,
): ScoringRulesDocV2 {
  assertEditable(doc)
  const section = sectionById(sectionId)
  if (!section.positions.includes(viewPosition)) {
    throw new Error(
      `applyAllPositionsOn: section '${sectionId}' does not render on the ${viewPosition} page`,
    )
  }

  const next: ScoringRulesDocV2 = {
    ...doc,
    base: { ...doc.base },
    positions: Object.fromEntries(
      Object.entries(doc.positions).map(([position, override]) => [
        position,
        { ...override },
      ]),
    ) as ScoringRulesDocV2['positions'],
  }

  const viewOverride = doc.positions[viewPosition]
  for (const field of renderableFields(section)) {
    const effective =
      viewOverride !== undefined && hasOwn(viewOverride, field.key)
        ? viewOverride[field.key]
        : hasOwn(doc.base, field.key)
          ? doc.base[field.key]
          : undefined
    if (effective === undefined) delete next.base[field.key]
    else next.base[field.key] = effective
    for (const position of SCORING_POSITIONS) {
      const override = next.positions[position]
      if (override !== undefined) delete override[field.key]
    }
  }

  return normalizeV2(next)
}

// ---------------------------------------------------------------------------
// 5. Per-field input rules (§7.3.3.1 bounds — client mirror, server law)
// ---------------------------------------------------------------------------

/** Guardrail 5's bounds, mirrored for the input (the validator is law;
 *  these exist so the commissioner meets the bound at the field, not at
 *  the save). */
export const COEFFICIENT_INPUT_STEP = 0.01
export const COEFFICIENT_INPUT_MAX = 100

export type CoefficientInputResult =
  /** Empty input — the field is being cleared (see `ScoringEdit.value`). */
  | { kind: 'cleared' }
  /** Not a number — nothing commits (the cell keeps the last good value). */
  | { kind: 'invalid' }
  | {
      kind: 'value'
      value: number
      /** Non-null when the committed value differs from what was typed:
       *  guardrail 5's clamp-with-error contract — the field takes the
       *  adjusted value AND says so, never silently. Clamping wins the
       *  label when both applied. */
      adjusted: 'clamped' | 'rounded' | null
    }

/**
 * Parse a raw input string under §7.3.3.1's per-field bounds: round to the
 * 0.01 step (multiples of 0.01 — every template value fits), then clamp to
 * |coef| ≤ 100. Boundary pins in the colocated test: 100 passes untouched,
 * 100.01 clamps, -100.01 clamps, 3.456 rounds.
 */
export function parseCoefficientInput(raw: string): CoefficientInputResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'cleared' }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { kind: 'invalid' }

  const rounded = Math.round(parsed * 100) / 100
  const clamped = Math.min(
    COEFFICIENT_INPUT_MAX,
    Math.max(-COEFFICIENT_INPUT_MAX, rounded),
  )
  const adjusted =
    clamped !== rounded ? 'clamped' : rounded !== parsed ? 'rounded' : null
  return { kind: 'value', value: clamped, adjusted }
}

// ---------------------------------------------------------------------------
// 6. Grid read model
// ---------------------------------------------------------------------------

export interface ScoringFieldState {
  key: string
  label: string
  /** The value the grid shows for this position: the position override when
   *  one exists, else the base value, else undefined ("not scored"). */
  value: number | undefined
  /** The all-positions value, for the "All positions: X" reference the
   *  cell shows under an override. */
  baseValue: number | undefined
  /** True iff `positions[position]` carries this key — the cell's
   *  "custom" marker. */
  overridden: boolean
}

export function sectionFieldStates(
  view: ScoringDocView,
  sectionId: ScoringEditorSectionId,
  position: ScoringPosition,
): ScoringFieldState[] {
  const section = sectionById(sectionId)
  const override = view.positions[position]
  return renderableFields(section).map((field) => {
    const overridden = override !== undefined && hasOwn(override, field.key)
    const baseValue = hasOwn(view.base, field.key) ? view.base[field.key] : undefined
    return {
      key: field.key,
      label: field.label,
      value: overridden ? override[field.key] : baseValue,
      baseValue,
      overridden,
    }
  })
}

// ---------------------------------------------------------------------------
// 7. Dirty tracking
// ---------------------------------------------------------------------------

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** Key-order-insensitive JSON of a document — jsonb equality's client twin,
 *  used for the dirty flag and the remount baseline key. */
export function canonicalDocJson(doc: ScoringRulesDoc): string {
  return JSON.stringify(canonicalize(doc))
}

export function canonicalDocEqual(a: ScoringRulesDoc, b: ScoringRulesDoc): boolean {
  return canonicalDocJson(a) === canonicalDocJson(b)
}

// ---------------------------------------------------------------------------
// 8. Save — normalization is the CLIENT's save-time duty (tasks-SE §5 SE.5(2))
// ---------------------------------------------------------------------------

/**
 * The wire payload for PUT …/scoring/rules: the WHOLE document, normalized.
 * `scoring_update_rules` REFUSES an un-normalized document rather than
 * rewriting it (SE.5/D272 — a server that silently rewrites what it was
 * sent is the "nothing happened" class), so the strip happens here, on the
 * client, at save time. Every `applyEdit` already normalizes, so this is
 * belt-and-braces over the one payload that reaches the wire — the
 * colocated test feeds an un-normalized doc straight through to prove the
 * duty lives HERE, not only in the edit path.
 */
export function buildSavePayload(working: ScoringRulesDocV2): ScoringRulesDocV2 {
  return normalizeV2(working)
}

/**
 * A save refusal, classified by WHICH layer refused — the SE.6 rung: where
 * several layers produce the same observable, the rendering (and the tests
 * behind it) must discriminate, or a refusal is just "an error":
 *
 *  - `validation` — HTTP 400: the route's Zod/TS validator or the RPC's SQL
 *    guardrail mirror (both answer 400 with per-field `fieldErrors`; SE.6's
 *    mapper keys them by document path either way). Rendered per field.
 *  - `refused` — HTTP 403/404/409: the RPC's own refusal sentence (not the
 *    commissioner; league not found; outside the `setup`/`scheduled`
 *    window; template not forked). The message is the server's — it is the
 *    sentence only that layer can produce, so it passes through verbatim.
 *  - `failed` — any other HTTP status (5xx): the request arrived and the
 *    server errored.
 *  - `network` — the request never produced a response. Deliberately NOT
 *    claiming "nothing was saved": a response lost in transit is
 *    indistinguishable from a request lost in transit (D276's hedge rule).
 */
export type SaveRefusal =
  | { kind: 'validation'; message: string; fieldErrors: Record<string, string[]> }
  | { kind: 'refused'; status: number; message: string }
  | { kind: 'failed'; status: number; message: string }
  | { kind: 'network'; message: string }

export function describeSaveRefusal(error: unknown): SaveRefusal {
  if (error instanceof LeaguePatchError) {
    if (error.status === 400) {
      return {
        kind: 'validation',
        message: error.message,
        fieldErrors: error.fieldErrors ?? {},
      }
    }
    if (error.status === 403 || error.status === 404 || error.status === 409) {
      return { kind: 'refused', status: error.status, message: error.message }
    }
    return { kind: 'failed', status: error.status, message: error.message }
  }
  return {
    kind: 'network',
    message: error instanceof Error ? error.message : 'The request could not be sent.',
  }
}

export type SaveScoringOutcome =
  | { ok: true; scoringSystemId: string }
  | { ok: false; refusal: SaveRefusal }

/**
 * The editor's ONE save door: normalize, send, classify. On refusal the
 * working document is not this function's to touch — it takes the doc by
 * value and returns only a classification, so the component KEEPS the
 * commissioner's edits and renders the refusal beside them (spec/tasks-SE:
 * "server-refusal rendering — never a silent revert"). The component-source
 * pin asserts the component saves through here and nowhere else (a member
 * pin on the call, per D276 — it cannot prove no other door exists).
 */
export async function saveScoringDoc(args: {
  working: ScoringRulesDocV2
  mutateAsync: (rules: ScoringRulesDoc) => Promise<{ scoring_system_id: string }>
}): Promise<SaveScoringOutcome> {
  try {
    const result = await args.mutateAsync(buildSavePayload(args.working))
    return { ok: true, scoringSystemId: result.scoring_system_id }
  } catch (error) {
    return { ok: false, refusal: describeSaveRefusal(error) }
  }
}

// ---------------------------------------------------------------------------
// 9. Access + reachability
// ---------------------------------------------------------------------------

export interface ScoringEditorAccess {
  isCommissioner: boolean
  /** §7.3 header: scoring edits live in `setup`/`scheduled` only. The RPC
   *  enforces; the UI states it (tasks-SE SE.7(2)). */
  inEditWindow: boolean
  canEdit: boolean
}

/** Mirror of the settings panel's gate, kept pure so the window enumeration
 *  is pinnable: both in-window statuses edit, all four out-of-window
 *  statuses lock (the D272(20) posture, at the UI mirror). */
export function scoringEditorAccess(
  myRole: string | null,
  leagueStatus: string,
): ScoringEditorAccess {
  const isCommissioner = myRole === 'commissioner' || myRole === 'co_commissioner'
  const inEditWindow = leagueStatus === 'setup' || leagueStatus === 'scheduled'
  return { isCommissioner, inEditWindow, canEdit: isCommissioner && inEditWindow }
}

/**
 * Is the league's referenced scoring row its own custom fork? D169 closed
 * the world: a league references a template OR its own §7.3.3.1 fork,
 * nothing else — so "not one of the seeded templates" IS "customized", and
 * no second document reader is needed to know it (D275(1): the one reader
 * stays the one reader).
 */
export function isCustomScoringReference(
  scoringSystemId: string | null,
  templateIds: readonly string[],
): boolean {
  return scoringSystemId !== null && !templateIds.includes(scoringSystemId)
}
