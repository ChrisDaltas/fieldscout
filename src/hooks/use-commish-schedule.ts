'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishEditScheduleResult } from '@/lib/leagues/api/commish-schedule-service'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leagueMatchupKeys } from './use-matchups'
import { scheduleKeys } from './use-schedule'

/**
 * The AUDITED commissioner re-pairing of one matchup — M6A task L.E1.11
 * (spec §15.4:1700 → `commish_edit_schedule`, migration 130; §10.3;
 * PROGRESS D351). `POST /api/leagues/[id]/commish/schedule`.
 *
 * SEPARATE from `useEditMatchup` (the M4 manager-window door, unchanged),
 * NOT optimistic, NOT retried (explicit `retry: false`), one `action_id` per
 * `submit()`, and the same views re-read on success AND on error (R822(i)):
 * the WEEK's matchups (`week` rides in the variables and is stripped before
 * the wire — the route's schema is strict — so the key can be hit exactly),
 * the schedule view, the activity feed and the audit log. Standings are
 * NOT re-read: 130 re-pairs cells that carry no score (`scoring.why`), so
 * nothing in the table moved.
 *
 * REASON is OPTIONAL (Q66). Blank is dropped before the wire.
 */

export interface CommishEditScheduleInput {
  matchupId: string
  homeTeamId: string
  awayTeamId: string
  /** The matchup's week — for the invalidation only; never sent. */
  week: number
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishEditScheduleVariables {
  matchup_id: string
  home_team_id: string
  away_team_id: string
  action_id: string
  reason?: string
  /** Invalidation target only — stripped in `mutationFn`. */
  week: number
}

export function commishEditScheduleMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishEditScheduleResult, Error, CommishEditScheduleVariables> {
  const reread = (week: number) => {
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.week(leagueId, week) })
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: ({ matchup_id, home_team_id, away_team_id, action_id, reason }: CommishEditScheduleVariables) =>
      sendLeagueAction<CommishEditScheduleResult>(
        `/api/leagues/${leagueId}/commish/schedule`,
        // `week` stays off the wire — the route's schema is strict.
        jsonInit('POST', { matchup_id, home_team_id, away_team_id, action_id, ...(reason === undefined ? {} : { reason }) }),
      ),
    onSuccess: (_result, variables) => reread(variables.week),
    onError: (_error, variables) => reread(variables.week),
  }
}

export function useCommishEditSchedule(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishEditScheduleMutationOptions(queryClient, leagueId))

  const variables = (input: CommishEditScheduleInput): CommishEditScheduleVariables => ({
    matchup_id: input.matchupId,
    home_team_id: input.homeTeamId,
    away_team_id: input.awayTeamId,
    week: input.week,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishEditScheduleInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishEditScheduleInput) => mutation.mutateAsync(variables(input)),
  }
}
