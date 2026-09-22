'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'

import { leagueActivityKeys } from './use-league-activity'
import { leagueMatchupKeys } from './use-matchups'
import { leagueStandingsKeys } from './use-standings'

/**
 * The AUDITED commissioner score correction — M6A task L.E1.10
 * (spec §15.4:1692 → `commish_edit_score`, migration 126; §10.3; PROGRESS
 * D351). `POST /api/leagues/[id]/commish/score`.
 *
 * SEPARATE FROM EVERY MANAGER HOOK ON PURPOSE (D351): no manager verb writes
 * a score, and this one is the exception door with its own ledger.
 *
 * NOT optimistic and NOT retried: the server returns the CANONICAL document
 * (the derived result, whether standings were rebuilt, whether live scoring
 * will overwrite the number — §4 rule 15), so there is nothing honest to
 * paint ahead of it; and an `action_id` is consumed by its submit, so a
 * React Query retry would be a replay — safe, but silent, which is not what
 * an audited verb should do. `retry: false` is set explicitly rather than
 * inherited.
 *
 * Invalidation on success AND on error (R822(i)): the WEEK's matchups (the
 * row this restated), the standings (a FINAL week rebuilds them in-body —
 * D344 — and an open week's projection reads the row) and the activity feed
 * (the §10.3 system post). A refusal means the view this client evaluated
 * was stale — a re-read is how the server's answer reaches the screen.
 *
 * REASON is OPTIONAL (Q66, spec v2.16.41). Transitional: until L.E1.15
 * (F362) relaxes 126's in-body gate, omitting it returns the route's 400
 * with 126's text verbatim; the hook neither hides nor works around that.
 */

export interface CommishEditScoreInput {
  matchupId: string
  /** The matchup's week — the invalidation target, NOT sent on the wire. */
  week: number
  homeScore: number
  /** Null on a BYE row — there is no away side to score (F366). */
  awayScore: number | null
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

/** The wire body, plus `week` for the invalidation (stripped before send —
 *  the route's schema is strict). */
export interface CommishEditScoreVariables {
  matchup_id: string
  home_score: number
  away_score: number | null
  action_id: string
  reason?: string
  week: number
}

export function commishEditScoreMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishMatchupOverrideResult, Error, CommishEditScoreVariables> {
  const reread = (week: number) => {
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.week(leagueId, week) })
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: ({ matchup_id, home_score, away_score, action_id, reason }: CommishEditScoreVariables) =>
      sendLeagueAction<CommishMatchupOverrideResult>(
        `/api/leagues/${leagueId}/commish/score`,
        // `week` stays off the wire — the route's schema is strict.
        jsonInit('POST', { matchup_id, home_score, away_score, action_id, ...(reason === undefined ? {} : { reason }) }),
      ),
    onSuccess: (_result, variables) => reread(variables.week),
    onError: (_error, variables) => reread(variables.week),
  }
}

export function useCommishEditScore(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishEditScoreMutationOptions(queryClient, leagueId))

  const variables = (input: CommishEditScoreInput): CommishEditScoreVariables => ({
    matchup_id: input.matchupId,
    home_score: input.homeScore,
    away_score: input.awayScore,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); re-invoking `mutate` with THESE
    // variables replays, a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
    week: input.week,
  })

  return {
    ...mutation,
    submit: (input: CommishEditScoreInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishEditScoreInput) => mutation.mutateAsync(variables(input)),
  }
}
