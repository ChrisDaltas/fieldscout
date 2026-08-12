'use client'

import * as React from 'react'

import { useToast } from '@/hooks/use-toast'
import { useReorderPlayers, useSetPlayerTier } from '@/hooks/use-lists'
import type { ListOrg } from '@/stores/list-display-store'

import { bucketDrop, type Bucket } from './list-buckets'
import { planDrop, positionsFor, type DropTarget } from './list-reorder'

/**
 * Lists v2 — **what a landed drop writes**, shared by every surface that lets
 * a list be reordered.
 *
 * This is `list-detail-panel.tsx`'s `handleDrop` moved rather than rewritten
 * (LV.16). The pop-out window is the second surface with drag-reorder, and the
 * two halves of a drop are already shared — `use-list-drag.tsx` runs the gesture
 * and `list-reorder.ts` decides what it *means*. The commit was the one part
 * still living in one screen's component, and it carries two rules that a second
 * copy would drift on within a task or two. It is the same move LV.13 made when
 * a Side by side column needed `bucketHeading` / `rankMap`: one rule, one place,
 * so the panel and the window cannot disagree about what a drop does.
 *
 * ## The two rules, unchanged from the panel
 *
 * 1. **A refused drop says so.** `bucketDrop` is the only thing that knows
 *    whether a section can be written; a cost/budget band never can, because
 *    membership is computed from the player's auction value. It surfaces the
 *    reason instead of no-oping (CLAUDE.md: never let "nothing happened" mean
 *    "it worked").
 * 2. **The two writes are sequenced, not fired together.** They patch the same
 *    React Query cache in `onMutate`; issued in the same tick, whichever reads
 *    the cache first can be overwritten by the other's snapshot. The bucket
 *    write goes first because it is the one the server can refuse, and the order
 *    write follows on its success.
 *
 * Both writes go through routes that already exist — `PATCH …/players/reorder`
 * and `PATCH …/players/[playerId]/tier` — and both of those hooks are already
 * optimistic with a rollback in `onError`, which is what CLAUDE.md asks for on
 * list reordering. **No new route, no schema** (`ACTIVE-BUILD.md`: the budget is
 * closed at three).
 */
export interface ListDropArgs {
  listId: string
  org: ListOrg
  buckets: Bucket[]
  /**
   * Owner, and not mid-AI-build. A viewer who cannot edit never gets a drag in
   * the first place; this is the second gate, so a stale gesture cannot write.
   */
  canEdit: boolean
}

export function useListDropCommit({
  listId,
  org,
  buckets,
  canEdit,
}: ListDropArgs): (entryId: string, target: DropTarget) => void {
  const { toast } = useToast()
  const reorderPlayers = useReorderPlayers(listId)
  const setPlayerTier = useSetPlayerTier(listId)

  return React.useCallback(
    (entryId: string, target: DropTarget) => {
      if (!canEdit) return

      const rule =
        target.kind === 'new'
          ? ({ ok: true, tier: target.tier } as const)
          : bucketDrop(org, target.bucketKey)

      if (!rule.ok) {
        toast({
          title: 'That section cannot be assigned',
          description: rule.reason,
          variant: 'destructive',
        })
        return
      }

      const plan = planDrop({ buckets, entryId, target, tier: rule.tier })
      // Dropped exactly where it started: no request, and nothing to announce.
      if (!plan) return

      const applyOrder = (order: string[]) =>
        reorderPlayers.mutate(positionsFor(order), {
          onError: (error) =>
            toast({
              title: 'Could not save the new order',
              description: error.message,
              variant: 'destructive',
            }),
        })

      if (plan.tier) {
        setPlayerTier.mutate(plan.tier, {
          onError: (error) =>
            toast({
              title: 'Could not move that player',
              description: error.message,
              variant: 'destructive',
            }),
          onSuccess: () => {
            if (plan.order) applyOrder(plan.order)
          },
        })
        return
      }

      if (plan.order) applyOrder(plan.order)
    },
    [buckets, canEdit, org, reorderPlayers, setPlayerTier, toast],
  )
}
