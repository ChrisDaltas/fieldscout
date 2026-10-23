/**
 * Pure helpers for the draft queue's write lane (M7 L.F2.6 review R1691;
 * PROGRESS D709). No React, no clock, no fetch.
 */

/** A queue change as the click made it: the order it saw, and the order it wants. */
export interface QueueIntent {
  base: readonly string[]
  next: readonly string[]
}

/** Two waiting changes in a row are one change: from the first's view to the last's wish. */
export function mergeQueueIntents(older: QueueIntent, newer: QueueIntent): QueueIntent {
  return { base: older.base, next: newer.next }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * The order to send for `intent` when the server's last known order is
 * `confirmed` — a click made before an earlier write in the lane (a list
 * load) landed must not undo that write. When nothing changed underneath,
 * the click's own order is sent. Otherwise the click's CHANGE is replayed on
 * the server's order: its removals removed, its additions appended (an Add is
 * an append); a pure reorder keeps its relative order for the players it
 * knew, and the rest of the server's order follows.
 */
export function rebaseQueueOrder(intent: QueueIntent, confirmed: readonly string[] | null): string[] {
  const { base, next } = intent
  if (confirmed === null || sameList(confirmed, base)) return [...next]
  const baseSet = new Set(base)
  const nextSet = new Set(next)
  const isReorder = base.length === next.length && base.every((id) => nextSet.has(id))
  if (isReorder) {
    const confirmedSet = new Set(confirmed)
    return [...next.filter((id) => confirmedSet.has(id)), ...confirmed.filter((id) => !nextSet.has(id))]
  }
  const removed = new Set(base.filter((id) => !nextSet.has(id)))
  const kept = confirmed.filter((id) => !removed.has(id))
  const keptSet = new Set(kept)
  return [...kept, ...next.filter((id) => !baseSet.has(id) && !keptSet.has(id))]
}
