'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishRenameTeamResult } from '@/lib/leagues/api/commish-team-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguesKeys } from './use-leagues'
import { leagueMatchupKeys } from './use-matchups'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'

/**
 * The AUDITED commissioner rename of any franchise — M6A task L.E1.11
 * (spec §15.4's v2.16.39 erratum → `commish_rename_team`, migration 128;
 * §10.3; PROGRESS D351). `POST /api/leagues/[id]/commish/team`.
 *
 * NOT the manager's own rename (`rename_own_team`, L.E1.13's team-page arm),
 * NOT optimistic, NOT retried (explicit `retry: false` — an `action_id` is
 * consumed by its submit, so a retry would be a silent replay), one
 * `action_id` per `submit()`, and the same views re-read on success AND on
 * error (R822(i)): a team's name is read LIVE at every site (128's
 * `propagation.live`), so every cached document that prints one — the
 * league detail (its teams list), rosters, standings, every week's
 * matchups — is re-read, plus the activity feed and the audit log.
 *
 * REASON is OPTIONAL (Q66). Blank is dropped before the wire.
 */

export interface CommishRenameTeamInput {
  teamId: string
  name: string
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishRenameTeamVariables {
  team_id: string
  name: string
  action_id: string
  reason?: string
}

export function commishRenameTeamMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishRenameTeamResult, Error, CommishRenameTeamVariables> {
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: CommishRenameTeamVariables) =>
      sendLeagueAction<CommishRenameTeamResult>(`/api/leagues/${leagueId}/commish/team`, jsonInit('POST', variables)),
    onSuccess: () => reread(),
    onError: () => reread(),
  }
}

export function useCommishRenameTeam(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishRenameTeamMutationOptions(queryClient, leagueId))

  const variables = (input: CommishRenameTeamInput): CommishRenameTeamVariables => ({
    team_id: input.teamId,
    name: input.name,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishRenameTeamInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishRenameTeamInput) => mutation.mutateAsync(variables(input)),
  }
}
