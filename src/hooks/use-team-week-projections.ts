'use client'

import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import { lineupProjectedTotal } from '@/components/leagues/my-team-ops'
import { weekGamesStarted } from '@/components/leagues/schedule-view-ops'

import { LEAGUE_PLAYER_VALUES_REFETCH_MS, leaguePlayerValuesQueryOptions } from './use-league-player-values'
import { lineupQueryOptions } from './use-lineup'

/**
 * Teams' projected totals for the weeks whose games have started — Q108
 * (Chris 2026-11-06: "a Team with no score should show the projected total
 * for the week, and that projection should keep updating as projections
 * change"), widened by D845 (Chris 2026-11-06: managers never see the word
 * "pending") from the live week to every started week: live, the correction
 * window and final. A team with no score in any of them shows its projected
 * total, never "pending".
 *
 * No new data path: each team's stored lineup through `useLineup`'s own
 * query (`lineupQueryOptions` — the same cache entries, so a lineup save's
 * invalidation reaches these too) and each week's `league_player_values`
 * through `useLeaguePlayerValues`'s own query (`leaguePlayerValuesQueryOptions`),
 * summed by the app's one rule (`lineupProjectedTotal` → `wholeProjectedTotal`).
 * The LIVE week re-reads both on `LEAGUE_PLAYER_VALUES_REFETCH_MS` and on
 * window focus, so a projection the hourly job moves shows up without a
 * reload; a week whose games are over does not poll.
 *
 * Reads nothing for a week that has not started (its cells are the dash).
 * Display only: callers pass the number to `teamScoreCell` /
 * `leaderboardPendingCell`, never to a result, a sort, the median, the win
 * chance or the standings.
 */
export function useTeamProjectionsByWeek(input: {
  leagueId: string | undefined
  season: number | undefined
  weeks: ReadonlyArray<{ week: number; status: string | null | undefined; teamIds: readonly string[] }>
  irSlots: ReadonlyArray<{ key: string }>
}): (week: number, teamId: string) => number | null {
  const { leagueId, season, irSlots } = input
  const ready = Boolean(leagueId) && season !== undefined
  const weeks = useMemo(() => {
    if (!ready) return []
    const byWeek = new Map<number, { week: number; live: boolean; teamIds: string[] }>()
    for (const w of input.weeks) {
      if (!weekGamesStarted(w.status)) continue
      const entry = byWeek.get(w.week) ?? { week: w.week, live: w.status === 'live', teamIds: [] }
      entry.teamIds = [...new Set([...entry.teamIds, ...w.teamIds])]
      byWeek.set(w.week, entry)
    }
    return [...byWeek.values()].sort((a, b) => a.week - b.week)
  }, [ready, input.weeks])
  const values = useQueries({ queries: weeks.map((w) => leaguePlayerValuesQueryOptions(leagueId, season, w.week, { live: w.live })) })
  const pairs = useMemo(() => weeks.flatMap((w) => w.teamIds.map((teamId) => ({ week: w.week, live: w.live, teamId }))), [weeks])
  const lineups = useQueries({
    queries: pairs.map((p) => ({
      ...lineupQueryOptions(p.teamId, p.week),
      refetchInterval: p.live ? LEAGUE_PLAYER_VALUES_REFETCH_MS : (false as const),
      refetchOnWindowFocus: p.live,
    })),
  })
  // Summed every render (a few dozen short sums at most): a refetched lineup
  // or projection re-renders the caller, and the cells follow. The lookup's
  // identity changes only when a total does, so callers can memo on it.
  const projOfWeek = new Map(
    weeks.map((w, i) => {
      const byPlayer = new Map((values[i]?.data ?? []).map((v) => [v.player_id, v.projected_points]))
      return [w.week, (id: string) => byPlayer.get(id) ?? null] as const
    }),
  )
  const totals = JSON.stringify(
    pairs.map((p, i) => [`${p.week}:${p.teamId}`, lineupProjectedTotal(lineups[i]?.data?.slot_map, irSlots, projOfWeek.get(p.week) ?? (() => null))]),
  )
  return useMemo(() => {
    const byKey = new Map(JSON.parse(totals) as Array<[string, number | null]>)
    return (week: number, teamId: string) => byKey.get(`${week}:${teamId}`) ?? null
  }, [totals])
}

/** One week's projected totals (`useTeamProjectionsByWeek` over that week) —
 *  every team in `teamIds`, read only once the week's games have started. */
export function useTeamWeekProjections(input: {
  leagueId: string | undefined
  season: number | undefined
  week: number | null | undefined
  weekStatus: string | null | undefined
  teamIds: readonly string[]
  irSlots: ReadonlyArray<{ key: string }>
}): (teamId: string) => number | null {
  const { week, weekStatus, teamIds } = input
  const weeks = useMemo(() => (week === null || week === undefined ? [] : [{ week, status: weekStatus, teamIds }]), [week, weekStatus, teamIds])
  const byWeek = useTeamProjectionsByWeek({ leagueId: input.leagueId, season: input.season, weeks, irSlots: input.irSlots })
  return useMemo(() => (teamId: string) => (week === null || week === undefined ? null : byWeek(week, teamId)), [byWeek, week])
}
