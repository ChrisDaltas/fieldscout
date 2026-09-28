'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishEditFaabResult } from '@/lib/leagues/api/commish-faab-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguesKeys } from './use-leagues'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * The commissioner's FAAB balance edit — M5 task L.D2.12 (§15.4
 * `POST …/commish/faab` → `commish_edit_faab`, migration 147; D385;
 * tasks-M5 §5 `useCommishFaab`).
 *
 * NOT optimistic (money — the response is the truth), NOT retried
 * (`retry: false` — an `action_id` is consumed by its submit), one
 * `action_id` per `submit()`. On success AND error it re-reads every surface
 * that prints a balance — rosters, standings, the league detail's members —
 * plus the claims (the bid ceiling and `pending_bids_above_balance`), the
 * activity feed and the audit log.
 */

export interface CommishEditFaabInput {
  teamId: string
  /** Whole dollars, 0 or more — above the budget is allowed (D385(2)). */
  balance: number
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishEditFaabVariables {
  team_id: string
  balance: number
  action_id: string
  reason?: string
}

export function commishEditFaabMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishEditFaabResult, Error, CommishEditFaabVariables> {
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables) =>
      sendLeagueAction<CommishEditFaabResult>(`/api/leagues/${leagueId}/commish/faab`, jsonInit('POST', variables)),
    onSuccess: () => reread(),
    onError: () => reread(),
  }
}

export function useCommishFaab(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishEditFaabMutationOptions(queryClient, leagueId))
  const variables = (input: CommishEditFaabInput): CommishEditFaabVariables => ({
    team_id: input.teamId,
    balance: input.balance,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    action_id: crypto.randomUUID(),
  })
  return {
    ...mutation,
    submit: (input: CommishEditFaabInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishEditFaabInput) => mutation.mutateAsync(variables(input)),
  }
}
