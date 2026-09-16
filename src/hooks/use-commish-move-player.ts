'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishRosterOverrideResult } from '@/lib/leagues/api/commish-roster-service'

import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { teamLineupKeys } from './use-lineup'
import { leagueRosterKeys } from './use-rosters'

/**
 * The AUDITED commissioner move of one player between two rosters — M6A
 * task L.E1.10 (spec §15.4:1694 → `commish_move_player`, migration 127;
 * §10.3; PROGRESS D351). `POST /api/leagues/[id]/commish/move-player`.
 *
 * SEPARATE FROM `useAddDrop` ON PURPOSE (D351): `use-transactions.ts` is
 * the manager's path and is unchanged — `roster_add_drop` keeps every timing
 * gate for every caller, commissioner included. This hook is the exception
 * door; the verb it calls lifts the game lock and NAMES it in `bypassed[]`,
 * syncs both lineups, and writes an audit row the whole league can read —
 * but only when something actually changed.
 *
 * NOT optimistic and NOT retried (explicit `retry: false`): the server
 * returns the canonical document (which lineup slots vacated, whether the
 * score followed — §4 rule 15), and an `action_id` is consumed by its
 * submit — a React Query retry would be a silent replay.
 *
 * Invalidation on success AND on error (R822(i)): the league's rosters and
 * pool (the two views a move changes — D294's mirror), BOTH teams' lineups
 * (127 re-seats each — `lineups[]`), and the activity feed (the
 * `transactions` row + the §10.3 post).
 *
 * REASON is OPTIONAL (Q66). Transitional until L.E1.15 / F362: 127's in-body
 * gate still answers a missing reason with a 400, surfaced verbatim.
 */

export interface CommishMovePlayerInput {
  playerId: string
  fromTeamId: string
  toTeamId: string
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishMovePlayerVariables {
  player_id: string
  from_team_id: string
  to_team_id: string
  action_id: string
  reason?: string
}

export function commishMovePlayerMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishRosterOverrideResult, Error, CommishMovePlayerVariables> {
  const reread = (fromTeamId: string, toTeamId: string) => {
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: teamLineupKeys.all(fromTeamId) })
    void queryClient.invalidateQueries({ queryKey: teamLineupKeys.all(toTeamId) })
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables: CommishMovePlayerVariables) =>
      sendLeagueAction<CommishRosterOverrideResult>(
        `/api/leagues/${leagueId}/commish/move-player`,
        jsonInit('POST', variables),
      ),
    onSuccess: (_result, variables) => reread(variables.from_team_id, variables.to_team_id),
    onError: (_error, variables) => reread(variables.from_team_id, variables.to_team_id),
  }
}

export function useCommishMovePlayer(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishMovePlayerMutationOptions(queryClient, leagueId))

  const variables = (input: CommishMovePlayerInput): CommishMovePlayerVariables => ({
    player_id: input.playerId,
    from_team_id: input.fromTeamId,
    to_team_id: input.toTeamId,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    // One action_id per submit (D68(1)); a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishMovePlayerInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishMovePlayerInput) => mutation.mutateAsync(variables(input)),
  }
}
