/**
 * Draft Options group list (spec §16.2 `draft-options-menu`, §8.7's v2.12
 * note; tasks-DR DR.3, D153) — the pure, enumerated section catalog for
 * `draft-options-menu.tsx`, pinned by a golden table in
 * `draft-options-menu.test.ts`. Plain `.ts` on purpose: vitest runs under
 * `jsx: "preserve"` and cannot import the `.tsx` component (the
 * `command-bar-ops.ts` precedent).
 *
 * **The catalog is per DRAFT TYPE since L.C3.2** (spec §8.7's auction rows;
 * tasks-M3 L.C3.2 item 1). DR.3 shipped one list of eight because only snake
 * existed in the room; the auction's controls are not additions to that list
 * so much as a different §8.7 surface:
 *
 *  - **added, auction only** — Manual Edit Mode (D142), Edit current
 *    nomination (D143), Team budgets (E28), End draft (C41's end-as-is);
 *  - **replaced, auction only** — `fix-pick` ("Fix a pick") becomes
 *    `manual-edit`: §8.7's v2.10 ruling says Manual Edit Mode *replaces* the
 *    drag/reassign articulation for auction, and offering both would put two
 *    doors on one pair of engine paths (`draft_reverse_won_bid` and the
 *    priced `draft_reassign_pick`/`draft_move_player`);
 *  - **relabelled, auction only** — `order` edits `nomination_order` on a
 *    running auction (087's `draft_set_order` auction arm), and `force-pick`
 *    is a force-NOMINATION there (087's auction arm, R301), so both say so.
 *
 * The UI must not offer what the engine forbids (D110(1)'s rule, applied to
 * draft type): every auction entry's RPC refuses a snake draft with a
 * type refusal, and `draft_end` refuses one outright — so a snake room never
 * lists them.
 */

/** Section ids — shared with `commish-draft-panel.tsx`'s scroll anchors. */
export type DraftOptionsSectionId =
  | 'clock'
  | 'undo'
  | 'fix-pick'
  | 'manual-edit'
  | 'cancel-nomination'
  | 'budget'
  | 'force-pick'
  | 'order'
  | 'autopick'
  | 'seats'
  | 'reset'
  | 'end'

export interface DraftOptionsEntry {
  id: DraftOptionsSectionId
  label: string
  /** Reset and End get the destructive treatment (§8.7's hard-confirm
   *  class — both type a word to confirm). */
  destructive?: true
}

/** The v1 (snake/linear) catalog — DR.3's eight, 1:1 with the shipped
 *  panel sections, in the panel's own render order. */
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

/** The AUCTION catalog (L.C3.2) — same render order as the panel. */
export const AUCTION_DRAFT_OPTIONS_ENTRIES: readonly DraftOptionsEntry[] = [
  { id: 'clock', label: 'Clock & timers' },
  { id: 'undo', label: 'Undo nominations' },
  { id: 'manual-edit', label: 'Manual Edit Mode' },
  { id: 'cancel-nomination', label: 'Edit current nomination' },
  { id: 'budget', label: 'Team budgets' },
  { id: 'force-pick', label: 'Nominate for a manager' },
  { id: 'order', label: 'Nomination order' },
  { id: 'autopick', label: 'Autopick' },
  { id: 'seats', label: 'Reassign a seat' },
  { id: 'reset', label: 'Reset draft', destructive: true },
  { id: 'end', label: 'End draft', destructive: true },
]

/** The groups this room's commissioner sees. */
export function draftOptionsEntries(isAuction: boolean): readonly DraftOptionsEntry[] {
  return isAuction ? AUCTION_DRAFT_OPTIONS_ENTRIES : DRAFT_OPTIONS_ENTRIES
}

// ---------------------------------------------------------------------------
// The D141 pause-first set (F72's remaining half) — ONE predicate, both types
// ---------------------------------------------------------------------------

/**
 * Which control groups the engine refuses on a RUNNING draft.
 *
 * This is the UI mirror of ONE SQL function — `draft_auction_pause_gate_internal`
 * (migration 087 §2, made draft-type-NEUTRAL by migration 090 when Chris ruled
 * F57 ALIGN; spec §8.7 v2.12.5). Its consumers, at the head of the migration
 * chain, are exactly `draft_set_clock`, `draft_undo`, `draft_reassign_pick`,
 * `draft_move_player`, `draft_reverse_won_bid` and `draft_cancel_nomination` —
 * and `PAUSE_FIRST_RPC_SECTIONS` below maps each onto the group that fires it,
 * so `commish-auction-ops.test.ts` can read the migrations and fail if the two
 * ever disagree. Nothing here DECIDES anything (the RPC's in-body refusal is
 * the authority, §4.7's posture applied to gating); it decides what renders
 * disabled, so a commissioner is not invited to click a control the server
 * will refuse (F72).
 */
export const PAUSE_FIRST_RPC_SECTIONS: Readonly<
  Record<string, readonly DraftOptionsSectionId[]>
> = {
  draft_set_clock: ['clock'],
  draft_undo: ['undo'],
  // The two priced/plain pick edits sit behind "Fix a pick" on a snake board
  // and behind Manual Edit Mode on an auction (D142) — one RPC, two doors,
  // one gate.
  draft_reassign_pick: ['fix-pick', 'manual-edit'],
  draft_move_player: ['fix-pick', 'manual-edit'],
  draft_reverse_won_bid: ['manual-edit'],
  draft_cancel_nomination: ['cancel-nomination'],
}

/** The group ids that render disabled while a draft is RUNNING. */
export const PAUSE_FIRST_SECTIONS: readonly DraftOptionsSectionId[] = [
  'clock',
  'undo',
  'fix-pick',
  'manual-edit',
  'cancel-nomination',
]

/** Groups the ruling deliberately leaves live-available (D141: "NOT gated
 *  (not named in the ruling): pause/resume itself, budget adjust,
 *  nomination-order edit, force-nominate, reset" — plus End, which is
 *  terminal and takes the Reset treatment). Force-pick is the one control
 *  with the OPPOSITE gate: 069 refuses it while paused. */
export const NOT_PAUSE_FIRST_SECTIONS: readonly DraftOptionsSectionId[] = [
  'budget',
  'force-pick',
  'order',
  'autopick',
  'seats',
  'reset',
  'end',
]

/** DOM id for a section's scroll anchor inside the commissioner panel. */
export function sectionDomId(id: DraftOptionsSectionId): string {
  return `draft-options-${id}`
}
