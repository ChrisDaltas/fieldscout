'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishEditLineupResult } from '@/lib/leagues/api/commish-lineup-service'

import { teamLineupKeys } from './use-lineup'
import { leagueRosterKeys } from './use-rosters'

/**
 * The AUDITED commissioner lineup override — M6A task L.E1.2
 * (spec §15.4:1695 → `commish_edit_lineup`, migration 123; §11.2, §10.3;
 * PROGRESS §3 STANDING RULE clauses (b), (e), (g)).
 *
 * SEPARATE FROM `useSetLineup` ON PURPOSE. `use-lineup.ts` is the manager's
 * path and is unchanged — `set_lineup` still refuses to move a player whose
 * game has kicked off, for a commissioner as much as a manager. This hook is
 * the exception door: the server verb it calls lifts the lock, the past-week
 * gate and the closed-week gate, and writes an audit row the whole league can
 * read — but only when something actually changed. A reason is OPTIONAL
 * (Q66; migration 131 / L.E1.15).
 *
 * The invalidation contract is `setLineupMutationOptions`': re-read BOTH the
 * week's lineup and the league's rosters on success AND on error (R822(i) —
 * a refusal means the VIEW the client evaluated was stale, which is the same
 * two entries either way). The override also writes `league_chat` and
 * `commissioner_actions`; neither is read by this surface, so neither is
 * invalidated here.
 *
 * NOT optimistic and NOT retried, for the same reason the manager's mutation
 * is neither: the server returns the CANONICAL map (E16 may re-seat a
 * placement), and an `action_id` is consumed by its submit — a React Query
 * retry would be a replay, which is safe, but a silent one, which is not what
 * this verb should do.
 */

export interface CommishEditLineupInput {
  teamId: string
  week: number
  /** The FULL canonical map incl. IR keys (F224(e)). */
  slotMap: Record<string, string>
  /** OPTIONAL — Q66 (Chris, 2026-09-16; spec v2.16.41 §10.3 / §15.4; swept
   *  by L.E1.15 / F362 / R1052). When given it is written TRIMMED into the
   *  audit row and the league-chat system post; when absent or blank the
   *  receipt stores NULL and the post carries no reason clause. The client
   *  may send nothing (PROGRESS (h) / F343 as amended). */
  reason?: string
}

export interface CommishEditLineupVariables {
  team_id: string
  week: number
  slot_map: Record<string, string>
  action_id: string
  reason?: string
}

/**
 * The override's mutation options, built for a client so the invalidation
 * contract is drivable through `MutationObserver` with no React (the
 * `use-lineup-invalidation.test.ts` posture).
 */
export function commishEditLineupMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishEditLineupResult, Error, CommishEditLineupVariables> {
  const reread = (teamId: string, week: number) => {
    void queryClient.invalidateQueries({ queryKey: teamLineupKeys.week(teamId, week) })
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
  }
  return {
    mutationFn: (variables: CommishEditLineupVariables) =>
      sendLeagueAction<CommishEditLineupResult>(
        `/api/leagues/${leagueId}/commish/lineup`,
        jsonInit('POST', variables),
      ),
    onSuccess: (_result, variables) => reread(variables.team_id, variables.week),
    onError: (_error, variables) => reread(variables.team_id, variables.week),
  }
}

export function useCommishEditLineup(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishEditLineupMutationOptions(queryClient, leagueId))

  const variables = (input: CommishEditLineupInput): CommishEditLineupVariables => ({
    team_id: input.teamId,
    week: input.week,
    slot_map: input.slotMap,
    // Omitted from the JSON body when absent (JSON.stringify drops
    // `undefined`), so the strict schema sees no key at all.
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    // One action_id per submit (D68(1)); re-invoking `mutate` with THESE
    // variables replays, a new `submit` call is a new id (R815).
    action_id: crypto.randomUUID(),
  })

  return {
    ...mutation,
    submit: (input: CommishEditLineupInput) => mutation.mutate(variables(input)),
    submitAsync: (input: CommishEditLineupInput) => mutation.mutateAsync(variables(input)),
  }
}
