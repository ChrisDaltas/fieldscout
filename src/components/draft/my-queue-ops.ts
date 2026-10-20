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

/** The slice of a DOM element the drag guard reads — structural, so the
 *  guard is testable without a DOM (R1635). */
export interface GuardNode {
  tagName?: string
  getAttribute?: (name: string) => string | null
  parentElement: GuardNode | null
}

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'])
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'menuitem', 'switch', 'textbox'])

/**
 * R1632: did a press start on an interactive control INSIDE the draggable
 * row (the name button that opens the player card, Remove)? Walks from the
 * event target up to — not including — the row root; the root itself is a
 * `role="button"` sortable and does not count. A press there belongs to the
 * control, so no sensor lifts the row. The guard lives in `my-queue.tsx`'s
 * own sensors; the shared `player-row.tsx` is untouched.
 */
export function startsOnInteractiveChild(target: GuardNode | null, root: GuardNode | null): boolean {
  let node = target
  while (node !== null && node !== root) {
    const tag = node.tagName?.toUpperCase()
    if (tag && INTERACTIVE_TAGS.has(tag)) return true
    const role = node.getAttribute?.('role')
    if (role && INTERACTIVE_ROLES.has(role)) return true
    node = node.parentElement
  }
  return false
}

/**
 * Screen-reader sentences for a Targets reorder (M7 L.F1.1, F73/F55; D621).
 * dnd-kit's default announcements name the DRAGGABLE ID — here a player id —
 * so a keyboard or screen-reader user heard "Picked up draggable item
 * 00-0036…". These name the player and the 1-based place in the list.
 * `position` is null when the pointer is over nothing.
 */
export function targetsDragSentence(
  event: 'start' | 'over' | 'end' | 'cancel',
  name: string,
  position: number | null,
  total: number,
): string {
  switch (event) {
    case 'start':
      return position === null
        ? `Picked up ${name}.`
        : `Picked up ${name}, Target ${position} of ${total}.`
    case 'over':
      return position === null
        ? `${name} is not over a Target.`
        : `${name} moved to Target ${position} of ${total}.`
    case 'end':
      return position === null
        ? `${name} dropped. Your Targets order is unchanged.`
        : `${name} dropped at Target ${position} of ${total}.`
    case 'cancel':
      return `Move cancelled. ${name} stays where it was.`
  }
}
