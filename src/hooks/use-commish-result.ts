'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'

import { leagueActivityKeys } from './use-league-activity'
import { leagueMatchupKeys } from './use-matchups'
import { leagueStandingsKeys } from './use-standings'

/**
 * The AUDITED commissioner result override — M6A task L.E1.10
 * (spec §15.4:1693 → `commish_set_result`, migration 126; §10.3; PROGRESS
 * D351). `POST /api/leagues/[id]/commish/result`.
 *
 * The sibling of `useCommishEditScore` over the SAME verb family and ledger
 * (D350): the number stands and the outcome is restated. Same contract —
 * SEPARATE from every manager hook, NOT optimistic, NOT retried (explicit
 * `retry: false`), one `action_id` per `submit()`, and the same three keys
 * re-read on success AND on error (R822(i)): the week's matchups, the
 * standings, the activity feed. See `use-commish-score.ts` for why.
 *
 * A tie cannot be expressed here — a winner id names a side (F351); the
 * score hook with equal scores records one.
 *
 * REASON is OPTIONAL (Q66). Transitional until L.E1.15 / F362: 126's in-body
 * gate still answers a missing reason with a 400, surfaced verbatim.
 */

export interface CommishSetResultInput {
  matchupId: string
  /** The matchup's week — the invalidation target, NOT sent on the wire. */
  week: number
  winnerTeamId: string
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishSetResultVariables {
  matchup_id: string
  winner_team_id: string
  action_id: string
  reason?: string
  week: number
}

export function commishSetResultMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishMatchupOverrideResult, Error, CommishSetResultVariables> {
  const reread = (week: number) => {
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.week(leagueId, week) })
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: ({ matchup_id, winner_team_id, action_id, reason }: CommishSetResultVariables) =>
      sendLeagueAction<CommishMatchupOverrideResult>(
        `/api/leagues/${leagueId}/commish/result`,
        // `week` stays off the wire — the route's schema is strict.
        jsonInit('POST', { matchup_id, winner_team_id, action_id, ...(reason === undefined ? {} : { reason }) }),
      ),
    onSuccess: (_result, variables) => reread(variables.week),
    onError: (_error, variables) => reread(variables.week),
  }
}

export function useCommishSetResult(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishSetResultMutationOptions(queryClient, leagueId))

  const variables = (input: CommishSetResultInput): CommishSetResultVariables => ({
    matchup_id: input.matchupId,
    winner_team_id: input.winnerTeamId,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
    week: input.week,
  })

  return {
    ...mutation,
    submit: (input: CommishSetResultInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishSetResultInput) => mutation.mutateAsync(variables(input)),
  }
}
