'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'

import { useLeagueChannel } from './use-league-channel'
import {
  invalidatingHandlers,
  leagueDetailEventInvalidates,
  mergeHandlers,
  projectedStandingsEventInvalidates,
  standingsEventInvalidates,
} from './use-league-channel-ops'
import { leaguesKeys } from './use-leagues'

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
 * Since 120 (L.D1.10's #266 fix round, R856) a franchise RETIREMENT is the
 * third carrier — the `teams` event: the retired row leaves the table and
 * its record folds into the successor's for seeding (the order can flip,
 * 068 D1), and the standings PAGE names rows from the league detail's
 * `teams` list (`standings-page.tsx`), which had no channel invalidation
 * at all. So the one subscription carries TWO derived maps merged
 * (`mergeHandlers`): the standings map, and the league-detail map
 * (`leagueDetailEventInvalidates` — `teams` only) refetching
 * `leaguesKeys.detail`. A finalization still refetches standings alone.
 *
 * The finalization trigger is L.D1.9's (behind B9); the wiring is pinned in
 * node against a synthetic event, the delivery proof deferred with the
 * trigger (PROGRESS F248).
 */

export const leagueStandingsKeys = {
  all: (leagueId: string) => ['league-standings', leagueId] as const,
  /** L.D5.5: the PROJECTED table (`?view=projected` → 118's
   *  `league_standings_projected`). A child of `all`, so a finalization's
   *  invalidation of the final table reaches the projection too. */
  projected: (leagueId: string) => ['league-standings', leagueId, 'projected'] as const,
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
  // 120 / R856: the detail's teams list (names, status, the lineage) —
  // refetched on `teams` only, never on a finalization.
  const invalidateDetail = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    mergeHandlers(
      invalidatingHandlers(standingsEventInvalidates, invalidate),
      invalidatingHandlers(leagueDetailEventInvalidates, invalidateDetail),
    ),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}

/**
 * The PROJECTED table — L.D5.5 (spec §11.5's standings bullet v2.16.25;
 * migration 118's `league_standings_projected`; PROGRESS D318(3); the
 * L.D5.3 "Projected" control's data source — D317(3)'s pending-by-name
 * copy retires). The SAME chain over the final rows plus every open
 * regular-season week "as if it ended now"; the document is the final
 * one's shape with `projected: true` / `weeks_projected`. Fetched only
 * while `enabled` (the control has it selected) — the scan is member-
 * gated and refetches on every score batch, so an unselected view costs
 * nothing.
 */
export function useProjectedStandings(leagueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: leagueStandingsKeys.projected(leagueId ?? 'none'),
    enabled: Boolean(leagueId) && enabled,
    queryFn: () => sendLeagueAction<LeagueStandings>(`/api/leagues/${leagueId!}/standings?view=projected`),
  })
}

/**
 * Fetch + subscribe for the projected table: the ONE `league:<id>` room
 * (F233(a)), the handler map DERIVED from `projectedStandingsEventInvalidates`
 * (R773) — `matchups` included, because the projection IS the live picture
 * (the predicate's docblock carries the cost). An invalidation while the
 * query is disabled marks it stale and fetches nothing.
 */
export function useProjectedStandingsLive(leagueId: string | undefined, enabled = true) {
  const query = useProjectedStandings(leagueId, enabled)
  const queryClient = useQueryClient()
  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.projected(leagueId) })
  }
  const { connection } = useLeagueChannel(leagueId, invalidatingHandlers(projectedStandingsEventInvalidates, invalidate), {
    onJoin: invalidate,
    onDrop: invalidate,
  })
  return { ...query, connection }
}
