'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { SubmitClaimResult } from '@/lib/leagues/api/waivers-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Submit a blind waiver claim — M5 task L.D2.12 (§15.3 `POST …/waivers` →
 * `waiver_claim_submit`, migration 145; tasks-M5 §5 `useSubmitClaim`).
 *
 * NOT optimistic (§15.6: never for bids — the server decides the bid rules,
 * exclusivity and the season gate), NOT retried (`retry: false` — an
 * `action_id` is consumed by its submit), one `action_id` per `submit()`.
 * Re-reads the claims on success AND on error; a commissioner's claim for a
 * team also writes an audit row and a system post, so those two feeds re-read
 * when the answer says `acted_as_commissioner`.
 *
 * A claim SPENDS nothing (TD2): no balance / roster key is touched here.
 */

export interface SubmitClaimInput {
  teamId: string
  addPlayerId: string
  dropPlayerId?: string | null
  /** Whole dollars; omitted = $0 (a priority league refuses anything else). */
  faabBid?: number
  /** Optional (Q66); stored only on the commissioner arm. */
  reason?: string
}

export interface SubmitClaimVariables {
  team_id: string
  add_player_id: string
  drop_player_id?: string | null
  faab_bid?: number
  action_id: string
  reason?: string
}

export function submitClaimMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<SubmitClaimResult, Error, SubmitClaimVariables> {
  return {
    retry: false,
    mutationFn: (variables) => sendLeagueAction<SubmitClaimResult>(`/api/leagues/${leagueId}/waivers`, jsonInit('POST', variables)),
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

export function submitClaimVariables(input: SubmitClaimInput, actionId: string): SubmitClaimVariables {
  return {
    team_id: input.teamId,
    add_player_id: input.addPlayerId,
    ...(input.dropPlayerId ? { drop_player_id: input.dropPlayerId } : {}),
    ...(input.faabBid === undefined ? {} : { faab_bid: input.faabBid }),
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    action_id: actionId,
  }
}

export function useSubmitClaim(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(submitClaimMutationOptions(queryClient, leagueId))
  return {
    ...mutation,
    /** One action_id per submit (D68(1)); a new `submit` is a new id. */
    submit: (input: SubmitClaimInput) => mutation.mutate(submitClaimVariables(input, crypto.randomUUID())),
    submitAsync: (input: SubmitClaimInput) => mutation.mutateAsync(submitClaimVariables(input, crypto.randomUUID())),
  }
}
