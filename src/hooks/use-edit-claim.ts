'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { EditClaimResult } from '@/lib/leagues/api/waivers-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Change a pending claim's bid and/or drop — ONE server call, ONE
 * transaction: `PATCH …/waivers/[cid]` with `{ faab_bid, drop_player_id }` →
 * migration 150's `waiver_claim_edit` (M5 L.D2.9, PROGRESS F417). It
 * replaces L.D2.12's cancel + resubmit + move-back (D387(5)), whose failure
 * between steps could leave the old claim cancelled; now the claim keeps its
 * id and either changes or does not. The edit SETS both fields (the new bid;
 * the new drop, null = none); in a FAAB league the team's order follows the
 * bids (F422(b)), so a new bid can move the claim — the answer's
 * `pending_claims` says where it went.
 *
 * NOT optimistic, NOT retried, one `action_id` per `edit()` (re-sending the
 * same gesture replays it). The claims re-read on both answers — on an error
 * the re-read shows the claim exactly as the server holds it, so a lost
 * connection never leaves the screen guessing (R1175). A commissioner's edit
 * also re-reads the activity feed and the audit log.
 */

export interface EditClaimVariables {
  claim_id: string
  faab_bid: number
  /** The new drop — null = no drop. */
  drop_player_id: string | null
  action_id: string
  /** Optional (Q66); only a commissioner's receipt stores it. */
  reason?: string
}

export function editClaimMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<EditClaimResult, Error, EditClaimVariables> {
  const reread = (commissioner: boolean) => {
    void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
    if (commissioner) {
      void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
      void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
    }
  }
  return {
    retry: false,
    mutationFn: ({ claim_id, ...body }) =>
      sendLeagueAction<EditClaimResult>(`/api/leagues/${leagueId}/waivers/${claim_id}`, jsonInit('PATCH', body)),
    onSuccess: (result) => reread(result.acted_as_commissioner),
    onError: () => reread(true),
  }
}

export function useEditClaim(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(editClaimMutationOptions(queryClient, leagueId))
  const variables = (claimId: string, change: Omit<EditClaimVariables, 'claim_id' | 'action_id'>): EditClaimVariables => ({
    claim_id: claimId,
    ...change,
    action_id: crypto.randomUUID(),
  })
  return {
    ...mutation,
    edit: (claimId: string, change: Omit<EditClaimVariables, 'claim_id' | 'action_id'>) => mutation.mutate(variables(claimId, change)),
    editAsync: (claimId: string, change: Omit<EditClaimVariables, 'claim_id' | 'action_id'>) =>
      mutation.mutateAsync(variables(claimId, change)),
  }
}
