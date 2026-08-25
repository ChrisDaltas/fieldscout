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
// Pause-first gating (D141; F72's disabled-states half) — ONE predicate for
// BOTH draft types, mirroring migration 090's type-neutral gate
// ---------------------------------------------------------------------------

/**
 * The clause each refusal carries, per draft type — the SAME sentence the
 * engine raises, minus the `verb: ` prefix and the § tag (087 §2 for the
 * auction arm, 090 for the type-neutral one). `commish-auction-ops.test.ts`
 * reads the migration chain and asserts both clauses appear verbatim in the
 * head body of `draft_auction_pause_gate_internal`, so the disabled control
 * and the server refusal can never say different things.
 */
export const PAUSE_FIRST_CLAUSE = {
  auction: 'auction commissioner controls run on a paused board',
  other: 'commissioner controls run on a paused board',
} as const

/** Whether a control group is offered right now, and why not when it isn't.
 *  `reason` is rendered as the section's hint AND as the disabled control's
 *  title — the D141 "disables with the same copy" requirement. */
export interface ControlGate {
  /** True ⇒ the control renders DISABLED (the RPC would refuse it). */
  blocked: boolean
  reason: string | null
}

const OPEN_GATE: ControlGate = { blocked: false, reason: null }

/**
 * D141's pause-first gate, as the UI sees it (F72's remaining half).
 *
 * Migration 090 made the ONE in-body gate draft-type-neutral when Chris
 * ruled F57 ALIGN (spec §8.7 v2.12.5): `draft_undo` (both arms), the pick
 * edits (`draft_reassign_pick` / `draft_move_player`), `draft_set_clock`,
 * plus the auction's `draft_reverse_won_bid` and `draft_cancel_nomination`
 * all refuse while `status = 'live'` and succeed while paused. Before this,
 * the shipped panel offered every one of them on a live SNAKE draft and let
 * the server say no — a dead end per click.
 *
 * The predicate is exactly the SQL's: `status = 'live'`. A `scheduled` or
 * `complete` draft is NOT blocked here — those refusals are the RPCs' own,
 * with their own sentences, and re-implementing them in the UI would be the
 * second spelling that drifts (D188(3)).
 *
 * MOCKS (migration 101 / MS.3 — spec §8.7's v2.15 carve-out, D219, E76):
 * on a mock the gate is OPEN. In the SQL the carve-out is one verb wide
 * (`is_mock AND draft_set_clock`); here it is a blanket `is_mock` arm, and
 * that is not a drift: the CLOCK is the only pause-first section a mock
 * room ever renders — the still-shut groups must not render at all in a
 * mock (D221(4)), and for them pause-first is not even the true reason
 * (their RPCs refuse a mock at the E75 arms, pause or no pause), so
 * disabling them with pause-first copy would be the wrong sentence. The
 * RPC stays the authority (§4.7) — this only stops the panel inviting a
 * click the server would refuse, or refusing one it would take.
 */
export function pauseFirstGate(draft: {
  status: string
  draft_type: string
  is_mock: boolean
}): ControlGate {
  if (draft.is_mock) return OPEN_GATE
  if (draft.status !== 'live') return OPEN_GATE
  const clause =
    draft.draft_type === 'auction' ? PAUSE_FIRST_CLAUSE.auction : PAUSE_FIRST_CLAUSE.other
  return {
    blocked: true,
    reason: `Pause the draft first — ${clause}.`,
  }
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

/**
 * What the undo confirm dialog is ABOUT — the commissioner's stored intent,
 * not a snapshot of its consequences (R273, M2 batch 14): the dialog keeps
 * the TARGET and re-derives the preview from the live pick cache at every
 * render (and once more at confirm), so a pick landing — or another
 * commissioner's undo — while the dialog sits open updates what it lists
 * instead of diverging from what would actually revert. Sharpest on
 * 'single': the RPC undoes the most-recent LIVE pick at EXECUTION time,
 * which may not be the pick the dialog named at open.
 */
export type UndoTarget = { kind: 'single' } | { kind: 'cascade'; from: number }

/** Preview for a stored target against the CURRENT picks — the R273 live
 *  derivation both the dialog render and the confirm re-verification use. */
export function deriveUndoPreview(
  picks: readonly DraftPickSummary[],
  target: UndoTarget,
): UndoPreview {
  return target.kind === 'single'
    ? undoLastPreview(picks)
    : undoCascadePreview(picks, target.from)
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
