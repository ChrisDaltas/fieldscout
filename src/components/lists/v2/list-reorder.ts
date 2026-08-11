import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import type { ListTier } from '@/types/database'

import type { Bucket } from './list-buckets'

/**
 * Lists v2 — what a drop *means*, decided away from the DOM.
 *
 * The gap model (design LAW §"Drag and drop", plan **D5**) is about pixels; this
 * module is about the two writes a release actually implies, and it is the piece
 * worth testing: given the rendered buckets and where the pointer let go, which
 * players change order, and does the dragged player change bucket.
 *
 * ## Why the whole list is rewritten, not just the moved player
 *
 * Design LAW, "Store rules that matter": *"Order is the array order… Moving an
 * entry into a bucket assigns `tier` / `round` / `cost`, then **keeps bucket
 * members contiguous in the array**."* So the new order is the buckets flattened
 * in the order they render — which is exactly what makes members contiguous, and
 * can reorder players the user never touched when the stored array had tiers
 * interleaved. That is the design's rule, not a side effect: after a drop, the
 * stored order matches the order on screen.
 *
 * `reorder_list_players` (migration 004) only updates the rows named in the
 * payload, and the legacy view already sends the complete list, so a full-order
 * payload is the established shape rather than a new one.
 *
 * ## A no-op is reported as a no-op
 *
 * Dropping a player back where it started produces `null`, so nothing is sent.
 * CLAUDE.md's rule cuts the other way too: a request that would change no rows
 * must not be issued and then read as success.
 */

/** Where the pointer let go. */
export type DropTarget =
  /** Between two players — `index` is the slot, so `entries.length` is "last". */
  | { kind: 'slot'; bucketKey: string; index: number }
  /** A bucket header, or the empty space in a bucket: append to that bucket. */
  | { kind: 'bucket'; bucketKey: string }
  /** The dashed "start tier N" zone below the last section. */
  | { kind: 'new'; tier: ListTier }

export interface DropPlan {
  /** Player ids in their new order (1-based positions), or `null` if unchanged. */
  order: string[] | null
  /** The bucket write this move implies, or `null` when the bucket is unchanged. */
  tier: { playerId: string; tier: ListTier | null } | null
}

export function dropTargetKey(target: DropTarget | null): string {
  if (!target) return ''
  if (target.kind === 'slot') return `s:${target.bucketKey}:${target.index}`
  if (target.kind === 'bucket') return `b:${target.bucketKey}`
  return `n:${target.tier}`
}

interface PlanArgs {
  buckets: Bucket[]
  /** `list_players.id` of the row being dragged. */
  entryId: string
  target: DropTarget
  /**
   * The stored bucket value a drop on `target` writes.
   *
   * `undefined` means "this grouping does not own the stored bucket, leave
   * `tier` alone" (ranked lists, and the single unlabelled section a tier list
   * shows before anything is bucketed). `null` clears it — that is the
   * Ungrouped section, and the tier route accepts `null` today.
   */
  tier: ListTier | null | undefined
}

export function planDrop({ buckets, entryId, target, tier }: PlanArgs): DropPlan | null {
  const groups = buckets.map((bucket) => ({ key: bucket.key, entries: [...bucket.entries] }))

  let fromGroup = -1
  let fromIndex = -1
  groups.forEach((group, groupIndex) => {
    const index = group.entries.findIndex((entry) => entry.id === entryId)
    if (index >= 0) {
      fromGroup = groupIndex
      fromIndex = index
    }
  })
  if (fromGroup < 0) return null

  const moved = groups[fromGroup].entries[fromIndex]

  // The "start tier N" zone has no rendered bucket to splice into: the player
  // takes the new stored value and the array is left alone, because
  // `buildBuckets` re-derives the sections from the data and will render the
  // new one in its own place. Writing an order here would be guessing at one.
  if (target.kind === 'new') {
    return { order: null, tier: { playerId: moved.player_id, tier: target.tier } }
  }

  const toGroup = groups.findIndex((group) => group.key === target.bucketKey)
  if (toGroup < 0) return null

  groups[fromGroup].entries.splice(fromIndex, 1)

  let index = target.kind === 'bucket' ? groups[toGroup].entries.length : target.index
  // Removing the dragged row first shifts every slot after it up by one.
  if (target.kind === 'slot' && fromGroup === toGroup && fromIndex < index) index -= 1
  index = Math.max(0, Math.min(index, groups[toGroup].entries.length))
  groups[toGroup].entries.splice(index, 0, moved)

  const nextOrder = flatten(groups)
  const prevOrder = flatten(buckets)
  const orderChanged = !sameOrder(prevOrder, nextOrder)

  // A bucket write only happens when the bucket actually changed AND this
  // grouping owns the stored value.
  const bucketChanged = fromGroup !== toGroup
  const tierWrite =
    bucketChanged && tier !== undefined ? { playerId: moved.player_id, tier } : null

  if (!orderChanged && !tierWrite) return null
  return { order: orderChanged ? nextOrder : null, tier: tierWrite }
}

function flatten(groups: { entries: ListPlayerWithPlayer[] }[]): string[] {
  return groups.flatMap((group) => group.entries.map((entry) => entry.player_id))
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/** The reorder route's wire shape: 1-based, every player named. */
export function positionsFor(order: string[]): { playerId: string; position: number }[] {
  return order.map((playerId, index) => ({ playerId, position: index + 1 }))
}
