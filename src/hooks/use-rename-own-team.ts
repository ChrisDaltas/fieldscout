'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { RenameOwnTeamResult } from '@/lib/leagues/api/team-rename-service'

import { leaguesKeys } from './use-leagues'
import { leagueMatchupKeys } from './use-matchups'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'

/**
 * A MANAGER renames his OWN franchise — M6A task L.E1.13 (tasks-M6A §6
 * L.E1.13 item 2; `rename_own_team`, migration 128 §4).
 * `POST /api/leagues/[id]/teams/[tid]/name`.
 *
 * NOT the commissioner's rename (`useCommishRenameTeam`, audited, inside
 * override mode): a manager naming his own team exercises no §10.1 power, so
 * there is no reason, no receipt, no `action_id` and no §10.3 post — which is
 * why this hook does NOT invalidate the commissioner log or the activity
 * feed (nothing is written to either; 128 says so in the document as
 * `audited: false` / `system_post: null`).
 *
 * NOT optimistic and NOT retried (explicit `retry: false`): the name on
 * screen after a rename is the re-read server name. Invalidation on success
 * AND on error (R822(i)) of every read that prints a team name — the league
 * detail, rosters, standings and the week's matchups.
 */
export interface RenameOwnTeamVariables {
  name: string
}

export function renameOwnTeamMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
  teamId: string,
): UseMutationOptions<RenameOwnTeamResult, Error, RenameOwnTeamVariables> {
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: RenameOwnTeamVariables) =>
      sendLeagueAction<RenameOwnTeamResult>(`/api/leagues/${leagueId}/teams/${teamId}/name`, jsonInit('POST', variables)),
    onSuccess: () => reread(),
    onError: () => reread(),
  }
}

export function useRenameOwnTeam(leagueId: string, teamId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(renameOwnTeamMutationOptions(queryClient, leagueId, teamId))
  return {
    ...mutation,
    submit: (name: string) => mutation.mutate({ name }),
  }
}
