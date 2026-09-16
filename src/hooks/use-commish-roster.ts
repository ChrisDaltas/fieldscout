'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishRosterOverrideResult } from '@/lib/leagues/api/commish-roster-service'

import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { teamLineupKeys } from './use-lineup'
import { leagueRosterKeys } from './use-rosters'

/**
 * The AUDITED commissioner force add / drop on one roster — M6A task
 * L.E1.10 (spec §15.4:1695 → `commish_force_add_drop`, migration 127;
 * §10.3; PROGRESS D351). `POST /api/leagues/[id]/commish/roster`.
 *
 * The sibling of `useCommishMovePlayer` over the SAME verb family and ledger
 * (D350). SEPARATE from `useAddDrop` (the manager's door, unchanged), NOT
 * optimistic, NOT retried (explicit `retry: false`), one `action_id` per
 * `submit()`, and the same views re-read on success AND on error (R822(i)):
 * the league's rosters and pool, the team's lineups, the activity feed. See
 * `use-commish-move-player.ts` for why.
 *
 * REASON is OPTIONAL (Q66). Transitional until L.E1.15 / F362: 127's in-body
 * gate still answers a missing reason with a 400, surfaced verbatim.
 */

export interface CommishForceAddDropInput {
  teamId: string
  addPlayerId?: string
  dropPlayerId?: string
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishForceAddDropVariables {
  team_id: string
  add_player_id?: string
  drop_player_id?: string
  action_id: string
  reason?: string
}

export function commishForceAddDropMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishRosterOverrideResult, Error, CommishForceAddDropVariables> {
  const reread = (teamId: string) => {
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: teamLineupKeys.all(teamId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: CommishForceAddDropVariables) =>
      sendLeagueAction<CommishRosterOverrideResult>(
        `/api/leagues/${leagueId}/commish/roster`,
        jsonInit('POST', variables),
      ),
    onSuccess: (_result, variables) => reread(variables.team_id),
    onError: (_error, variables) => reread(variables.team_id),
  }
}

export function useCommishForceAddDrop(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishForceAddDropMutationOptions(queryClient, leagueId))

  const variables = (input: CommishForceAddDropInput): CommishForceAddDropVariables => ({
    team_id: input.teamId,
    ...(input.addPlayerId !== undefined ? { add_player_id: input.addPlayerId } : {}),
    ...(input.dropPlayerId !== undefined ? { drop_player_id: input.dropPlayerId } : {}),
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishForceAddDropInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishForceAddDropInput) => mutation.mutateAsync(variables(input)),
  }
}
