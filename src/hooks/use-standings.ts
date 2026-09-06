'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'

import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, standingsEventInvalidates } from './use-league-channel-ops'

/**
 * The tiebreaker-ordered standings — M4 task L.D4.1 (spec §15.3/§15.6/§11.5;
 * migration 117's `league_standings`; PROGRESS D297/D298/D314, ledger
 * **F233(a)** + **F247(b)**).
 *
 * READ: the `GET /api/leagues/[id]/standings` route (§15.3 prints it). The
 * ranking is the RPC's — one rule in the product (D297) — and the route
 * passes its document through with the F247(b) scale normalised, so
 * `points_for` / `points_against` / `win_pct` are numbers on every row.
 * `reason: 'no_final_weeks'` is the RPC's own name for an empty table:
 * render "no results yet" from it, never from `standings.length === 0`.
 *
 * LIVE: subscribed to `league:<id>` through the ONE spine (F233(a)),
 * refetching when a week FINALIZES — `team_week_results` and `league_weeks`
 * — and deliberately NOT on the `matchups` score tick: `league_standings`
 * reads only final rows (§11.5 v2.16.23), so a tick cannot change it, and
 * the live projection is L.D5.3's over the provisional cells. The handler
 * map is derived from `standingsEventInvalidates` (R773). Every confirmed
 * (re)join refetches (§9.3).
 *
 * The finalization trigger is L.D1.9's (behind B9); the wiring is pinned in
 * node against a synthetic event, the delivery proof deferred with the
 * trigger (PROGRESS F248).
 */

export const leagueStandingsKeys = {
  all: (leagueId: string) => ['league-standings', leagueId] as const,
}

/** The fetch half. */
export function useStandings(leagueId: string | undefined) {
  return useQuery({
    queryKey: leagueStandingsKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<LeagueStandings>(`/api/leagues/${leagueId!}/standings`),
  })
}

/**
 * The fetch + subscribe half — what a mounted standings table uses. Returns
 * the query plus the spine's `connection` for the §16.5.4 reconnecting
 * banner.
 */
export function useStandingsLive(leagueId: string | undefined) {
  const query = useStandings(leagueId)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    invalidatingHandlers(standingsEventInvalidates, invalidate),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}
