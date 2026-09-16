'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishChangeSettingResult } from '@/lib/leagues/api/commish-setting-service'
import type { Json } from '@/types/database'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguesKeys } from './use-leagues'
import { leagueStandingsKeys } from './use-standings'

/**
 * The AUDITED commissioner in-season change of ONE league setting — M6A
 * task L.E1.11 (spec §15.4:1701 → `commish_change_setting`, migration 129;
 * §10.3; D347's per-key policy; PROGRESS D351).
 * `POST /api/leagues/[id]/commish/setting`.
 *
 * SEPARATE from `useUpdateLeagueSettings` (the pre-draft PATCH, unchanged),
 * NOT optimistic, NOT retried (explicit `retry: false`), one `action_id` per
 * `submit()`, and the same views re-read on success AND on error (R822(i)):
 * the league detail (where `settings` lives), the activity feed, the audit
 * log — and the STANDINGS only when `rescore` was asked for (129's rescore
 * arm rebuilds `team_week_results`; without it nothing scored moved and a
 * blanket re-read would say otherwise).
 *
 * Which keys may change is 129's policy table — a refused key comes back as
 * a 409 with 129's copy verbatim, and L.E1.13 renders it as such.
 *
 * REASON is OPTIONAL (Q66). Blank is dropped before the wire.
 */

export interface CommishChangeSettingInput {
  key: string
  value: Json
  rescore?: boolean
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishChangeSettingVariables {
  key: string
  value: Json
  rescore?: boolean
  action_id: string
  reason?: string
}

export function commishChangeSettingMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishChangeSettingResult, Error, CommishChangeSettingVariables> {
  const reread = (rescore: boolean) => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    if (rescore) {
      void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    }
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: CommishChangeSettingVariables) =>
      sendLeagueAction<CommishChangeSettingResult>(`/api/leagues/${leagueId}/commish/setting`, jsonInit('POST', variables)),
    onSuccess: (_result, variables) => reread(variables.rescore === true),
    onError: (_error, variables) => reread(variables.rescore === true),
  }
}

export function useCommishChangeSetting(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishChangeSettingMutationOptions(queryClient, leagueId))

  const variables = (input: CommishChangeSettingInput): CommishChangeSettingVariables => ({
    key: input.key,
    value: input.value,
    ...(input.rescore !== undefined ? { rescore: input.rescore } : {}),
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishChangeSettingInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishChangeSettingInput) => mutation.mutateAsync(variables(input)),
  }
}
