'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { moveClaim, type ReorderClaimsResult, type WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Move a claim to a new place in its team's order — M5 task L.D2.12
 * (tasks-M5 §5 `PATCH …/waivers/[cid]` → `waiver_claim_reorder`, migration
 * 145).
 *
 * **OPTIMISTIC — the one claim verb that is** (tasks-M5 §5: "optimistic only
 * for claim reorder"; CLAUDE.md: list reordering is optimistic). The order is
 * the team's own preference and the server refuses it only when the set of
 * pending claims changed underneath (a run settled one, a cancel in another
 * tab) — so the drag lands instantly, and a refusal ROLLS BACK every cached
 * document to its snapshot and re-reads. NOT retried (`retry: false`), one
 * `action_id` per `move()`.
 */

export interface ReorderClaimVariables {
  claim_id: string
  claim_order: number
  action_id: string
  reason?: string
}

interface Snapshot {
  previous: Array<[readonly unknown[], WaiverClaimsDocument | undefined]>
}

/** Pure: a claims document with `claimId` moved to `position` among its
 *  PENDING claims (settled ones untouched, after them). Exported for pins. */
export function applyClaimMove(doc: WaiverClaimsDocument, claimId: string, position: number): WaiverClaimsDocument {
  const pending = doc.claims.filter((c) => c.status === 'pending')
  if (!pending.some((c) => c.id === claimId)) return doc
  const order = moveClaim(
    pending.map((c) => c.id),
    claimId,
    position,
  )
  const byId = new Map(pending.map((c) => [c.id, c]))
  const moved = order.map((id, i) => ({ ...byId.get(id)!, claim_order: i + 1 }))
  return { ...doc, claims: [...moved, ...doc.claims.filter((c) => c.status !== 'pending')] }
}

export function reorderClaimMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<ReorderClaimsResult, Error, ReorderClaimVariables, Snapshot> {
  const allKey = waiverClaimKeys.all(leagueId)
  return {
    retry: false,
    mutationFn: ({ claim_id, ...body }) =>
      sendLeagueAction<ReorderClaimsResult>(`/api/leagues/${leagueId}/waivers/${claim_id}`, jsonInit('PATCH', body)),
    onMutate: async ({ claim_id, claim_order }) => {
      await queryClient.cancelQueries({ queryKey: allKey })
      const previous = queryClient.getQueriesData<WaiverClaimsDocument>({ queryKey: allKey })
      for (const [key, doc] of previous) {
        if (doc) queryClient.setQueryData(key, applyClaimMove(doc, claim_id, claim_order))
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      for (const [key, doc] of context?.previous ?? []) queryClient.setQueryData(key, doc)
      void queryClient.invalidateQueries({ queryKey: allKey })
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: allKey })
      if (result.acted_as_commissioner && !result.no_changes) {
        void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
        void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
      }
    },
  }
}

export function useReorderClaims(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(reorderClaimMutationOptions(queryClient, leagueId))
  const variables = (claimId: string, claimOrder: number, reason?: string): ReorderClaimVariables => ({
    claim_id: claimId,
    claim_order: claimOrder,
    action_id: crypto.randomUUID(),
    ...(reason !== undefined && reason.trim() !== '' ? { reason } : {}),
  })
  return {
    ...mutation,
    /** Move `claimId` to place `claimOrder` (1 = tried first). */
    move: (claimId: string, claimOrder: number, reason?: string) => mutation.mutate(variables(claimId, claimOrder, reason)),
    moveAsync: (claimId: string, claimOrder: number, reason?: string) => mutation.mutateAsync(variables(claimId, claimOrder, reason)),
  }
}
