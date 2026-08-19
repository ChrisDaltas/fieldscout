/**
 * Draft Options group list (spec §16.2 `draft-options-menu`, §8.7's v2.12
 * note; tasks-DR DR.3, D153) — the pure, enumerated section catalog for
 * `draft-options-menu.tsx`, pinned by a golden table in
 * `draft-options-menu.test.ts`. Plain `.ts` on purpose: vitest runs under
 * `jsx: "preserve"` and cannot import the `.tsx` component (the
 * `command-bar-ops.ts` precedent).
 *
 * The v1 list maps 1:1 onto the shipped `commish-draft-panel.tsx` sections,
 * in the panel's own render order. It is ENUMERATED rather than hard-coded
 * in the menu's JSX so it can receive the M3 auction entries without
 * restructuring: **L.C3.2** appends its sections (Manual Edit Mode, the
 * budget editor, cancel-current-nomination, auction clock edits, End Draft)
 * when the engine work behind them lands. They are deliberately ABSENT until
 * then — no disabled placeholders for unbuilt features (tasks-DR DR.3
 * item 3).
 */

/** Section ids — shared with `commish-draft-panel.tsx`'s scroll anchors. */
export type DraftOptionsSectionId =
  | 'clock'
  | 'undo'
  | 'fix-pick'
  | 'force-pick'
  | 'order'
  | 'autopick'
  | 'seats'
  | 'reset'

export interface DraftOptionsEntry {
  id: DraftOptionsSectionId
  label: string
  /** Reset gets the destructive treatment (§8.7's hard-confirm class). */
  destructive?: true
}

export const DRAFT_OPTIONS_ENTRIES: readonly DraftOptionsEntry[] = [
  { id: 'clock', label: 'Clock & timers' },
  { id: 'undo', label: 'Undo picks' },
  { id: 'fix-pick', label: 'Fix a pick' },
  { id: 'force-pick', label: 'Pick for a manager' },
  { id: 'order', label: 'Draft order' },
  { id: 'autopick', label: 'Autopick' },
  { id: 'seats', label: 'Reassign a seat' },
  { id: 'reset', label: 'Reset draft', destructive: true },
]

/** DOM id for a section's scroll anchor inside the commissioner panel. */
export function sectionDomId(id: DraftOptionsSectionId): string {
  return `draft-options-${id}`
}
