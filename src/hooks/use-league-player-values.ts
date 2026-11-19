'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * League-scored player values for one week (migration 137 — projected points
 * under the league's own rules, season-to-date points; refreshed hourly by
 * the league-player-values job). League UX batch 3 (D478): the team page's
 * Proj column, projected total and "Proj vs opponent" check read it.
 *
 * A member-RLS direct SELECT (D92 — the table is member-readable, no write
 * policy). MEMBERSHIP: the team page mounts nothing below `useLeague`'s
 * 403/404, so this hook never mounts for a stranger (the `useLineup`
 * posture, F249(a)). A missing row is "no value" (the UI shows "—"); a NULL
 * projection is never a zero (137's CHECKs name why it is missing). A
 * transport error THROWS. Rostered players only (137's population), so the
 * read sits far below the PostgREST cap — asserted, never assumed.
 */
export interface LeaguePlayerValue {
  player_id: string
  projected_points: number | null
  projected_missing: string | null
  season_points: number | null
  season_games: number
}

export const leaguePlayerValueKeys = {
  week: (leagueId: string, season: number, week: number) => ['league-player-values', leagueId, season, week] as const,
}

/**
 * Q108 (Chris 2026-11-06: a team's projected total "should keep updating as
 * projections change"). The table is rewritten by the hourly job, and no
 * realtime event carries it, so a LIVE-week reader (`opts.live` —
 * `useTeamWeekProjections`) re-reads it on this interval and when the window
 * regains focus (the app default turns focus refetch off) — no page reload
 * needed for the projected totals to move. Every other reader of the same
 * week shares the cache entry, so it moves too; a finished week's readers
 * don't poll.
 */
export const LEAGUE_PLAYER_VALUES_REFETCH_MS = 5 * 60_000

/** The one query (key, gate, read) behind `useLeaguePlayerValues` — also
 *  run over several weeks at once by `useTeamProjectionsByWeek` (the
 *  `lineupQueryOptions` pattern), so both share one cache entry per week. */
export function leaguePlayerValuesQueryOptions(
  leagueId: string | undefined,
  season: number | undefined,
  week: number | undefined,
  opts: { live?: boolean } = {},
) {
  return {
    queryKey: leaguePlayerValueKeys.week(leagueId ?? 'none', season ?? 0, week ?? 0),
    enabled: Boolean(leagueId) && season !== undefined && week !== undefined,
    refetchInterval: opts.live ? LEAGUE_PLAYER_VALUES_REFETCH_MS : (false as const),
    refetchOnWindowFocus: opts.live === true,
    queryFn: async (): Promise<LeaguePlayerValue[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_player_values')
        .select('player_id, projected_points, projected_missing, season_points, season_games')
        .eq('league_id', leagueId!)
        .eq('season', season!)
        .eq('week', week!)
      if (error) throw error
      const rows = data ?? []
      if (rows.length >= 1000) throw new Error('league_player_values: the read hit the 1000-row cap')
      return rows.map((r) => ({
        ...r,
        projected_points: r.projected_points === null ? null : Number(r.projected_points),
        season_points: r.season_points === null ? null : Number(r.season_points),
      }))
    },
  }
}

export function useLeaguePlayerValues(
  leagueId: string | undefined,
  season: number | undefined,
  week: number | undefined,
  opts: { live?: boolean } = {},
) {
  const query = useQuery(leaguePlayerValuesQueryOptions(leagueId, season, week, opts))
  const byPlayer = useMemo(() => new Map((query.data ?? []).map((v) => [v.player_id, v])), [query.data])
  const totalProjOf = useMemo(() => (id: string) => projectionForTotal(byPlayer.get(id)), [byPlayer])
  return { ...query, byPlayer, totalProjOf }
}

/**
 * A player's projection as it counts toward a TEAM's projected total. A
 * player the projections feed published no line for this week (`no_line`:
 * on bye, on IR, ruled out) counts 0 — what ESPN, Yahoo and Sleeper all do,
 * so one bye or IR starter no longer blanks the whole team's total (Chris
 * 2026-11-18: "none of the matchups are showing the projected totals").
 * Still unknown (null — the total stays "—"): a stale line, and a player
 * with no value row at all (incl. every player while the read loads or after
 * it failed). The player's OWN Proj cell keeps the dash — this is only for
 * sums.
 */
export function projectionForTotal(v: Pick<LeaguePlayerValue, 'projected_points' | 'projected_missing'> | undefined): number | null {
  if (!v) return null
  if (v.projected_points !== null) return v.projected_points
  return v.projected_missing === 'no_line' ? 0 : null
}
