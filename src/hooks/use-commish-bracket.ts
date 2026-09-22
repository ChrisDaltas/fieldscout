'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishEditBracketResult } from '@/lib/leagues/api/commish-bracket-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leagueMatchupKeys } from './use-matchups'
import { playoffBracketKeys } from './use-playoff-bracket'

/**
 * The AUDITED commissioner hand-pick of one playoff pairing — M6A task
 * L.E1.16 (spec §11.5 "Bracket is commissioner-editable" →
 * `commish_edit_bracket`, migration 134; §10.3; PROGRESS F360 / D351).
 * `POST /api/leagues/[id]/commish/bracket`.
 *
 * SEPARATE from `useCommishEditSchedule` (the regular-season override), NOT
 * optimistic, NOT retried (explicit `retry: false`), one `action_id` per
 * `submit()`, and the same views re-read on success AND on error (R822(i)):
 * the bracket document, the round's WEEKS' matchups (`weeks` rides in the
 * variables and is stripped before the wire — the route's schema is
 * strict), the activity feed and the audit log. Standings are NOT re-read:
 * 134 re-pairs rows that carry no score, so nothing in the table moved.
 *
 * A BYE is `awayTeamId: null` — sent as `away_team_id: null`, never omitted.
 * REASON is OPTIONAL (Q66). Blank is dropped before the wire.
 */

export interface CommishEditBracketInput {
  matchupId: string
  homeTeamId: string
  /** Null = a bye for the home side. */
  awayTeamId: string | null
  /** The round's weeks — for the invalidation only; never sent. */
  weeks: readonly number[]
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishEditBracketVariables {
  matchup_id: string
  home_team_id: string
  away_team_id: string | null
  action_id: string
  reason?: string
  /** Invalidation target only — stripped in `mutationFn`. */
  weeks: readonly number[]
}

export function commishEditBracketMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishEditBracketResult, Error, CommishEditBracketVariables> {
  const reread = (weeks: readonly number[]) => {
    void queryClient.invalidateQueries({ queryKey: playoffBracketKeys.all(leagueId) })
    for (const week of weeks) {
      void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.week(leagueId, week) })
    }
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: ({ matchup_id, home_team_id, away_team_id, action_id, reason }: CommishEditBracketVariables) =>
      sendLeagueAction<CommishEditBracketResult>(
        `/api/leagues/${leagueId}/commish/bracket`,
        // `weeks` stays off the wire — the route's schema is strict.
        jsonInit('POST', { matchup_id, home_team_id, away_team_id, action_id, ...(reason === undefined ? {} : { reason }) }),
      ),
    onSuccess: (_result, variables) => reread(variables.weeks),
    onError: (_error, variables) => reread(variables.weeks),
  }
}

export function useCommishEditBracket(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishEditBracketMutationOptions(queryClient, leagueId))

  const variables = (input: CommishEditBracketInput): CommishEditBracketVariables => ({
    matchup_id: input.matchupId,
    home_team_id: input.homeTeamId,
    away_team_id: input.awayTeamId,
    weeks: input.weeks,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishEditBracketInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishEditBracketInput) => mutation.mutateAsync(variables(input)),
  }
}
