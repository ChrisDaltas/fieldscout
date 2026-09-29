/**
 * Which leagues KEEP a waiver order between runs — M5 task L.D2.18 (F484,
 * migration 163; spec §13.2 Q72, §7.3.4 `faab_tiebreaker`).
 *
 * The order persists (is stored on each seat as `league_members.
 * waiver_priority`, from the draft's end — reverse draft order — and rolled
 * by every waiver run) exactly when the processor's `v_persists` is true:
 * waiver type `rolling_priority`, or `faab` with the `rolling_priority`
 * tiebreaker. A missing type reads `faab` and a missing tiebreaker reads
 * `rolling_priority` (160's fallback, the settings default). Every other
 * league decides each run by the standings (or has no waivers) and stores no
 * order.
 *
 * This is a DISPLAY twin: it only chooses the words around the number the
 * server stored. The number itself is never computed here. The rule is pinned
 * to the newest SQL definers (`waiver-order.test.ts` parses them), so the
 * two cannot drift.
 */

export type WaiverOrderBasis =
  /** A rolling order: the stored priority is the answer (FAAB: for ties). */
  | 'rolling'
  /** Decided by the standings each run (FAAB: ties by the standings). */
  | 'reverse_standings'
  /** No waivers — nothing to say. */
  | 'none'

export function waiverOrderPersists(waiverType: string | null | undefined, faabTiebreaker: string | null | undefined): boolean {
  const type = waiverType ?? 'faab'
  const tb = faabTiebreaker ?? 'rolling_priority'
  return type === 'rolling_priority' || (type === 'faab' && tb === 'rolling_priority')
}

export function waiverOrderBasis(waiverType: string | null | undefined, faabTiebreaker: string | null | undefined): WaiverOrderBasis {
  if ((waiverType ?? 'faab') === 'none_fcfs') return 'none'
  return waiverOrderPersists(waiverType, faabTiebreaker) ? 'rolling' : 'reverse_standings'
}
