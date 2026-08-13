/**
 * Draft order math — the DISPLAY-ONLY TS mirror of migration 066's
 * `draft_team_for_pick` (M2 task L.B3.2; spec §8.3; tasks-M2 D90).
 *
 * D90 is the rule this file lives under: **engine authority is SQL only.**
 * The one order implementation that decides anything is
 * `draft_team_for_pick` (066) — every made pick renders from its actual
 * `draft_picks` row, never from this module. These helpers exist for exactly
 * one job: labeling EMPTY FUTURE cells on the board grid (which team a pick
 * that hasn't happened yet will belong to). Drift between this mirror and
 * the SQL is a suite failure, not a rendering quirk:
 *
 *  - `draft-order.test.ts` pins the pgTAP 020 §C stored-literal pick→team
 *    tables (8-team no-reversal / 12-team 3RR / linear) against this module
 *    — the same golden literals both implementations answer to.
 *  - `draft-order-parity-db.test.ts` (stack-backed) sweeps TS ≡ SQL for
 *    every team_count 8..16 × {snake, 3RR, linear} via the real
 *    `draft_team_for_pick` RPC; pgTAP 020 separately pins that SQL helper ≡
 *    a driven draft's actual rows, closing the chain display ≡ truth.
 *
 * Semantics mirrored from 066 (same guards, same formula):
 *  - non-array / empty order, or pick < 1 ⇒ null (render nothing, never
 *    guess);
 *  - `linear` repeats the round-1 order every round (§8.3);
 *  - plain snake: odd rounds forward, even rounds reversed;
 *  - 3RR (`snake_reversal`): parity inverts for rounds ≥ 3 — r1 fwd, r2 rev,
 *    r3 REV (the flip), r4 fwd, … (§8.3).
 *
 * Kept/renamed per `mock-draft.ts`'s own header instruction ("keep the
 * exported types, delete the MOCK_* constants"): `roundForPick` moved here
 * verbatim; `managerForPick` (names-array, no reversal/linear arms) is
 * superseded by `teamForPick` over the stored `draft_order` team ids.
 */

/** Round number (1-based) for an overall pick. Pick < 1 or teamCount < 1 ⇒ 0
 *  (no such round — callers guard like the SQL's NULL). */
export function roundForPick(pick: number, teamCount: number): number {
  if (pick < 1 || teamCount < 1) return 0
  return Math.floor((pick - 1) / teamCount) + 1
}

/** The draft modes the order math branches on (§7.3.8 `draft_type`).
 *  `auction` has no board order — callers never ask. */
export type OrderedDraftType = 'snake' | 'linear'

/**
 * Which round-1 slot (0-based index into `draft_order`) owns an overall
 * pick. Mirrors 066's CASE arm for `forward` exactly; null on the same
 * inputs the SQL answers NULL for.
 */
export function slotIndexForPick(
  pick: number,
  teamCount: number,
  draftType: OrderedDraftType,
  snakeReversal: boolean,
): number | null {
  if (teamCount < 1 || pick < 1) return null
  const pos = ((pick - 1) % teamCount) + 1
  const round = Math.floor((pick - 1) / teamCount) + 1
  const forward =
    draftType === 'linear'
      ? true // §8.3: linear repeats
      : snakeReversal && round >= 3
        ? round % 2 === 0 // 3RR: parity inverts from round 3
        : round % 2 === 1 // plain snake
  return (forward ? pos : teamCount - pos + 1) - 1
}

/**
 * Team id owning an overall pick, from the stored `draft_order` (round-1
 * team ids). The TS twin of `draft_team_for_pick(order, type, reversal,
 * pick)` — display-only (D90), parity-pinned.
 */
export function teamForPick(
  pick: number,
  order: readonly string[],
  draftType: OrderedDraftType,
  snakeReversal: boolean,
): string | null {
  const index = slotIndexForPick(pick, order.length, draftType, snakeReversal)
  return index === null ? null : (order[index] ?? null)
}
