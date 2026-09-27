'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishSetAutopilotResult } from '@/lib/leagues/api/commish-autopilot-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leagueRosterKeys } from './use-rosters'

/**
 * The commissioner's per-team "Put on autopilot" switch — M6A task L.E1.22
 * (spec §7.2.1(c) / §10.1 Membership, Q63 RULED 2026-09-27 →
 * `commish_set_autopilot`, migration 139; §10.3).
 * `POST /api/leagues/[id]/commish/autopilot`.
 *
 * NOT optimistic, NOT retried (explicit `retry: false` — an `action_id` is
 * consumed by its submit, so a retry would be a silent replay), one
 * `action_id` per `submit()`, and the same views re-read on success AND on
 * error (R822(i)): the rosters document (it carries each team's `autopilot`
 * flag — the switch's resting state is the SERVER's, never the click's), the
 * activity feed and the audit log (the act is shown there — Q63).
 *
 * REASON is OPTIONAL (Q66). The team page's switch sends none.
 */

export interface CommishSetAutopilotInput {
  teamId: string
  on: boolean
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishSetAutopilotVariables {
  team_id: string
  on: boolean
  action_id: string
  reason?: string
}

export function commishSetAutopilotMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishSetAutopilotResult, Error, CommishSetAutopilotVariables> {
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: CommishSetAutopilotVariables) =>
      sendLeagueAction<CommishSetAutopilotResult>(`/api/leagues/${leagueId}/commish/autopilot`, jsonInit('POST', variables)),
    onSuccess: () => reread(),
    onError: () => reread(),
  }
}

export function useCommishSetAutopilot(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishSetAutopilotMutationOptions(queryClient, leagueId))

  const variables = (input: CommishSetAutopilotInput): CommishSetAutopilotVariables => ({
    team_id: input.teamId,
    on: input.on,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishSetAutopilotInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishSetAutopilotInput) => mutation.mutateAsync(variables(input)),
  }
}
