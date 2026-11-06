'use client'

import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import { lineupProjectedTotal } from '@/components/leagues/my-team-ops'

import { LEAGUE_PLAYER_VALUES_REFETCH_MS, useLeaguePlayerValues } from './use-league-player-values'
import { lineupQueryOptions } from './use-lineup'

/**
 * Every team's projected total for one LIVE week — Q108 (Chris 2026-11-06:
 * "a Team with no score should show the projected total for the week, and
 * that projection should keep updating as projections change").
 *
 * No new data path: each team's stored lineup through `useLineup`'s own
 * query (`lineupQueryOptions` — the same cache entries, so a lineup save's
 * invalidation reaches these too) and the week's `league_player_values`
 * through `useLeaguePlayerValues`, summed by the app's one rule
 * (`lineupProjectedTotal` → `wholeProjectedTotal`). Both re-read on
 * `LEAGUE_PLAYER_VALUES_REFETCH_MS` and on window focus, so a projection
 * the hourly job moves shows up without a reload.
 *
 * Reads nothing unless the week is `live`: an upcoming week shows its dash
 * and a finished (or held) week its `pending` — neither shows a projection.
 * Display only: callers pass the number to `teamScoreCell` /
 * `leaderboardPendingCell`, never to a result, a sort or the standings.
 */
export function useTeamWeekProjections(input: {
  leagueId: string | undefined
  season: number | undefined
  week: number | null | undefined
  weekStatus: string | null | undefined
  teamIds: readonly string[]
  irSlots: ReadonlyArray<{ key: string }>
}): (teamId: string) => number | null {
  const { leagueId, season, weekStatus, irSlots } = input
  const week = input.week ?? undefined
  const live = weekStatus === 'live' && Boolean(leagueId) && season !== undefined && week !== undefined
  const values = useLeaguePlayerValues(live ? leagueId : undefined, season, week)
  const ids = useMemo(() => (live ? [...new Set(input.teamIds)] : []), [live, input.teamIds])
  const lineups = useQueries({
    queries: ids.map((teamId) => ({
      ...lineupQueryOptions(teamId, week),
      refetchInterval: LEAGUE_PLAYER_VALUES_REFETCH_MS,
      refetchOnWindowFocus: true,
    })),
  })
  // Summed every render (a dozen short sums): a refetched lineup or
  // projection re-renders the caller, and the cells follow. The lookup's
  // identity changes only when a total does, so callers can memo on it.
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null
  const totals = JSON.stringify(ids.map((teamId, i) => [teamId, lineupProjectedTotal(lineups[i]?.data?.slot_map, irSlots, projOf)]))
  return useMemo(() => {
    const byTeam = new Map(JSON.parse(totals) as Array<[string, number | null]>)
    return (teamId: string) => byTeam.get(teamId) ?? null
  }, [totals])
}
