'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CancelClaimResult } from '@/lib/leagues/api/waivers-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Cancel a pending waiver claim — M5 task L.D2.12 (tasks-M5 §5
 * `DELETE …/waivers/[cid]` → `waiver_claim_cancel`, migration 145).
 *
 * NOT optimistic, NOT retried, one `action_id` per `cancel()`; the claims
 * re-read on success and on error (a claim settled by a run in between is
 * refused by name, and the re-read shows why). A commissioner's cancel also
 * re-reads the activity feed and the audit log.
 */

export interface CancelClaimVariables {
  claim_id: string
  action_id: string
  reason?: string
}

export function cancelClaimMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CancelClaimResult, Error, CancelClaimVariables> {
  return {
    retry: false,
    mutationFn: ({ claim_id, ...body }) =>
      sendLeagueAction<CancelClaimResult>(`/api/leagues/${leagueId}/waivers/${claim_id}`, jsonInit('DELETE', body)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
      if (result.acted_as_commissioner) {
        void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
        void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
      }
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
    },
  }
}

export function useCancelClaim(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(cancelClaimMutationOptions(queryClient, leagueId))
  const variables = (claimId: string, reason?: string): CancelClaimVariables => ({
    claim_id: claimId,
    action_id: crypto.randomUUID(),
    ...(reason !== undefined && reason.trim() !== '' ? { reason } : {}),
  })
  return {
    ...mutation,
    cancel: (claimId: string, reason?: string) => mutation.mutate(variables(claimId, reason)),
    cancelAsync: (claimId: string, reason?: string) => mutation.mutateAsync(variables(claimId, reason)),
  }
}
