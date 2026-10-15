'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { listsKeys, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import type { ListBucketKey } from '@/types/schemas/lists'

/**
 * FieldScout Mobile — Lists: write one editor change (a drag, a tier merge,
 * auto tiers) as the per-player tier writes plus the new order it implies.
 *
 * Both halves go through the routes the desktop drag uses —
 * `PATCH …/players/[playerId]/tier` and `PATCH …/players/reorder` — with the
 * same optimistic cache update `useSetPlayerTier` / `useReorderPlayers` make.
 * It is one mutation rather than N calls to those hooks because each of them
 * snapshots the cache in `onMutate`; fired together, a later snapshot would
 * capture an earlier optimistic write and a rollback would restore the wrong
 * state.
 *
 * The app has no route that writes several tiers and an order at once, so a
 * change is several requests and one can fail after others landed. When that
 * happens this **undoes the writes that landed** (each tier back to the value
 * in `stored`; the order is written last, so it never needs undoing) before
 * reporting the failure, then refetches. If an undo write fails too, the
 * error says so and the refetch shows what the server actually holds.
 */
export interface MobileCommit {
  order: string[] | null
  tiers: Array<{ playerId: string; tier: ListBucketKey | null }>
  /** The list's players as stored before this change (the undo values). */
  stored: readonly ListPlayerWithPlayer[]
}

async function ok(res: Response): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `Request failed with ${res.status}`)
}

export function useMobileListsCommit(listId: string) {
  const qc = useQueryClient()

  const writeTier = (playerId: string, tier: ListBucketKey | null) =>
    fetch(`/api/lists/${listId}/players/${playerId}/tier`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier }),
    }).then(ok)

  return useMutation({
    mutationFn: async ({ order, tiers, stored }: MobileCommit) => {
      const before = new Map(stored.map((entry) => [entry.player_id, (entry.tier ?? null) as ListBucketKey | null]))
      const undo = async (landed: MobileCommit['tiers'], cause: unknown): Promise<never> => {
        const reverted = await Promise.allSettled(landed.map(({ playerId }) => writeTier(playerId, before.get(playerId) ?? null)))
        const message = cause instanceof Error ? cause.message : 'The change could not be saved.'
        if (reverted.some((result) => result.status === 'rejected')) {
          throw new Error(`${message} Part of it could not be undone; the list now shows what was saved.`)
        }
        throw cause instanceof Error ? cause : new Error(message)
      }

      const results = await Promise.allSettled(tiers.map(({ playerId, tier }) => writeTier(playerId, tier)))
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) return undo(tiers.filter((_, index) => results[index].status === 'fulfilled'), failed.reason)

      if (order && order.length > 0) {
        try {
          await fetch(`/api/lists/${listId}/players/reorder`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ positions: order.map((playerId, index) => ({ playerId, position: index + 1 })) }),
          }).then(ok)
        } catch (error) {
          return undo(tiers, error)
        }
      }
    },
    onMutate: async ({ order, tiers }) => {
      await qc.cancelQueries({ queryKey: listsKeys.detail(listId) })
      const prev = qc.getQueryData<ListWithDetails>(listsKeys.detail(listId))
      if (prev) {
        const tierBy = new Map(tiers.map((t) => [t.playerId, t.tier]))
        const posBy = new Map((order ?? []).map((id, index) => [id, index + 1]))
        qc.setQueryData<ListWithDetails>(listsKeys.detail(listId), {
          ...prev,
          players: prev.players
            .map((entry) => ({
              ...entry,
              tier: tierBy.has(entry.player_id) ? (tierBy.get(entry.player_id) ?? null) : entry.tier,
              position: posBy.get(entry.player_id) ?? entry.position,
              overall_rank: posBy.get(entry.player_id) ?? entry.overall_rank,
            }))
            .sort((a, b) => a.position - b.position),
        })
      }
      return { prev }
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listsKeys.detail(listId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
    },
  })
}
