/**
 * Commissioner-panel view derivations (M2 task L.B3.3; spec §8.7 — the undo
 * confirm dialog "showing what will be undone", E4 cascade semantics, §17
 * role gate). Pure — colocated ops split (the D82(4)/L.A2.x precedent).
 *
 * The wire semantics these views sit on (D114(9)/R160): `to_pick_number` is
 * the highest pick KEPT — the RPC undoes every live pick strictly greater.
 * The panel's input is friendlier ("first pick to revert", T): the two meet
 * at `toPickNumber = T − 1`, and T = 1 is the legal FULL rewind (wire 0).
 */

import type { DraftPickSummary } from '@/hooks/use-draft'

// ---------------------------------------------------------------------------
// Role gate (§17: commissioner + co-commissioner hold the §8.7 surface)
// ---------------------------------------------------------------------------

/** True when `my_role` holds the §8.7 panel (the routes/RPCs re-check —
 *  this only decides whether the panel RENDERS; D110(1): never on a mock,
 *  the caller composes that check from `drafts.is_mock`). */
export function canUseCommishPanel(myRole: string | null | undefined): boolean {
  return myRole === 'commissioner' || myRole === 'co_commissioner'
}

// ---------------------------------------------------------------------------
// Undo preview — "exactly what reverts" (§8.7's confirm-dialog requirement)
// ---------------------------------------------------------------------------

export interface UndoPreview {
  /** Live picks that WILL revert, ascending by pick number — the confirm
   *  dialog lists exactly these (§8.7: "Clear confirm dialog showing what
   *  will be undone"). */
  reverts: DraftPickSummary[]
  /** The wire `to_pick_number` (highest pick kept; 0 = full rewind, R160);
   *  null for the single-undo form (body omits the field). */
  toPickNumber: number | null
}

/** The single-undo preview: the most recent LIVE pick (undone rows are
 *  audit history — never "the last pick"). Empty when no live pick exists. */
export function undoLastPreview(picks: readonly DraftPickSummary[]): UndoPreview {
  const live = picks.filter((p) => !p.is_undone)
  if (live.length === 0) return { reverts: [], toPickNumber: null }
  const latest = live.reduce((a, b) => (b.pick_number > a.pick_number ? b : a))
  return { reverts: [latest], toPickNumber: null }
}

/**
 * The cascade preview for "revert picks T and after" (E4): every LIVE pick
 * with `pick_number >= T` reverts, ascending; wire `to_pick_number = T − 1`
 * (T = 1 ⇒ 0, the R160 full rewind). A `T` past the board reverts nothing —
 * the caller disables confirm on an empty preview rather than sending a
 * no-op cascade.
 */
export function undoCascadePreview(
  picks: readonly DraftPickSummary[],
  firstPickToRevert: number,
): UndoPreview {
  const reverts = picks
    .filter((p) => !p.is_undone && p.pick_number >= firstPickToRevert)
    .sort((a, b) => a.pick_number - b.pick_number)
  return { reverts, toPickNumber: firstPickToRevert - 1 }
}

/** Valid cascade targets: 1 (full rewind, R160) … the highest live pick. */
export function cascadeTargetBounds(
  picks: readonly DraftPickSummary[],
): { min: number; max: number } | null {
  const live = picks.filter((p) => !p.is_undone)
  if (live.length === 0) return null
  return { min: 1, max: Math.max(...live.map((p) => p.pick_number)) }
}

// ---------------------------------------------------------------------------
// Clock-edit labels (E15 — the §7.3.8 PICK_TIMER_SECONDS catalog)
// ---------------------------------------------------------------------------

/** Human label for a catalog timer value (0 = §8.2's untimed soft timer). */
export function pickTimerLabel(seconds: number): string {
  if (seconds === 0) return 'No clock (untimed)'
  if (seconds < 60) return `${seconds} seconds`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')} min`
  }
  const h = Math.floor(seconds / 3600)
  return h === 1 ? '1 hour' : `${h} hours`
}

// ---------------------------------------------------------------------------
// Reorder helper (the panel's up/down order editor — E31's explicit order)
// ---------------------------------------------------------------------------

/** Move `index` one step toward `direction`; same reference back when the
 *  move falls off either end (callers can disable the arrow). */
export function moveOrderEntry(
  order: readonly string[],
  index: number,
  direction: 'up' | 'down',
): readonly string[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) {
    return order
  }
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
