/**
 * My-queue derivation — pure ops for `my-queue.tsx` (M2 task L.B3.2; spec
 * §8.4 "players already drafted are auto-removed", §15.6 optimistic
 * reorder, E17).
 *
 * The stored queue is the caller's own `draft_queues` rows (§12.6 — never
 * broadcast); drafted-ness is derived CLIENT-side from the live picks the
 * room already holds (E17: the picks channel moves, the queue greys). The
 * server never deletes queue rows on a pick — 068's autopick simply skips
 * drafted entries — so "auto-removed" is a display truth plus the fact
 * that every reorder POST carries only the ids the user still holds:
 * `orderedIdsForSave` drops drafted rows, so the next whole-queue replace
 * (D113(3) semantics) physically removes them without a dedicated delete.
 */

export interface QueueViewRow {
  player_id: string
  /** 1-based stored rank (display keeps the stored order). */
  rank: number
  /** E17: drafted by someone (or me) — greyed, excluded from saves. */
  drafted: boolean
}

export function deriveQueueView(
  rows: ReadonlyArray<{ player_id: string; rank: number }>,
  draftedIds: ReadonlySet<string>,
): QueueViewRow[] {
  return rows.map((row) => ({
    player_id: row.player_id,
    rank: row.rank,
    drafted: draftedIds.has(row.player_id),
  }))
}

/** The ids a save should carry: stored order, drafted rows dropped (E17's
 *  auto-remove made real by the whole-queue replace). */
export function orderedIdsForSave(view: readonly QueueViewRow[]): string[] {
  return view.filter((row) => !row.drafted).map((row) => row.player_id)
}

/** Drag reorder (dnd-kit end event → new id order); unknown ids no-op. */
export function reorderIds(
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Append for the pool's "Queue" action (already-queued ids no-op). */
export function appendId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id]
}

/** Remove for the row's ✕ (unknown ids no-op). */
export function removeId(ids: readonly string[], id: string): string[] {
  return ids.filter((existing) => existing !== id)
}
