'use client'

import { useQuery } from '@tanstack/react-query'

import { calculateFantasyPoints, PPR_SCORING, type StatRow } from '@/lib/scoring/default'
import { CURRENT_SEASON } from '@/lib/stats/aggregate-fantasy'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Lists: the time-frame stats (lr-lists §5 "Stat value
 * rules"). The design's list table switches its counting stats between
 * **Week N**, **Last 3** and **Season**; the app's list payload carries season
 * totals only, so this reads the same weekly `player_stats` rows the season
 * aggregators read (public, `005_public_stats.sql`) through the same paging
 * helper, and sums them per frame. No new route, no new table.
 *
 * - **Week N** is the season's last completed week — the latest week with a
 *   finished (not live, not mock) game anywhere in the league — so every list
 *   shows the same "Week N". A player without a game that week (bye, injury)
 *   shows "–" for it.
 * - **Last 3** is each player's last three games played.
 * - **Season** is every game this season.
 *
 * Mock rows (`source = 'mock'`) are excluded, as the projection rule in
 * `aggregate-fantasy.ts` excludes them.
 */

export type TimeFrame = 'week' | 'last3' | 'season'

export interface FrameTotals {
  games: number
  /** PPR fantasy points. */
  pts: number
  targets: number
  receptions: number
  receiving_yards: number
  rush_attempts: number
  rush_yards: number
  pass_yards: number
  pass_tds: number
  interceptions: number
  pass_attempts: number
  pass_completions: number
}

export interface PlayerFrames {
  /** `null` when the player has no game in the latest week (bye, injury). */
  week: FrameTotals | null
  last3: FrameTotals | null
  season: FrameTotals | null
}

/**
 * The season's last completed week: the highest week holding a finished,
 * real (non-mock) game row. `null` before the first game is final. One read,
 * shared by every list (lr-lists gap table: "use the live current week, not
 * the hard-coded 5").
 */
export function useMobileListsLatestWeek(enabled: boolean) {
  return useQuery({
    queryKey: ['mobile-lists', 'latest-week', CURRENT_SEASON],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await createBrowserClient()
        .from('player_stats')
        .select('week')
        .eq('season', CURRENT_SEASON)
        .gte('week', 1)
        .or('source.is.null,source.neq.mock')
        .not('is_live', 'is', true)
        .order('week', { ascending: false })
        .limit(1)
      // A failed read must not look like "no games yet" (CLAUDE.md).
      if (error) throw new Error(`Could not load the current week: ${error.message}`)
      const week = data?.[0]?.week
      return typeof week === 'number' ? week : null
    },
  })
}

const SELECT =
  'player_id, season, week, source, ' +
  'pass_attempts, pass_completions, pass_yards, pass_tds, interceptions, ' +
  'rush_attempts, rush_yards, rush_tds, fumbles_lost, ' +
  'targets, receptions, receiving_yards, receiving_tds, ' +
  'fg_made, fg_made_40_plus, fg_made_50_plus, xp_made, ' +
  'def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, ' +
  'two_point_conversions'

type Row = Record<string, unknown> & { player_id: string; week: number | null; source: string | null }

const COUNTED = [
  'targets',
  'receptions',
  'receiving_yards',
  'rush_attempts',
  'rush_yards',
  'pass_yards',
  'pass_tds',
  'interceptions',
  'pass_attempts',
  'pass_completions',
] as const

function total(rows: readonly Row[]): FrameTotals | null {
  if (rows.length === 0) return null
  const sum: Record<string, number> = {}
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key === 'player_id' || key === 'season' || key === 'week' || key === 'source') continue
      sum[key] = (sum[key] ?? 0) + Number(value ?? 0)
    }
  }
  const out: FrameTotals = {
    games: rows.length,
    pts: Math.round(calculateFantasyPoints(sum as StatRow, PPR_SCORING) * 10) / 10,
    targets: 0,
    receptions: 0,
    receiving_yards: 0,
    rush_attempts: 0,
    rush_yards: 0,
    pass_yards: 0,
    pass_tds: 0,
    interceptions: 0,
    pass_attempts: 0,
    pass_completions: 0,
  }
  for (const key of COUNTED) out[key] = sum[key] ?? 0
  return out
}

/**
 * Per-player frame totals. `latestWeek` is `useMobileListsLatestWeek`'s value
 * (`undefined` while it loads — the read waits for it).
 */
export function useMobileListsTimeframeStats(
  playerIds: readonly string[],
  latestWeek: number | null | undefined,
  enabled: boolean,
) {
  const ids = [...new Set(playerIds)].sort()
  return useQuery({
    queryKey: ['mobile-lists', 'timeframe-stats', CURRENT_SEASON, latestWeek ?? null, ids.join(',')],
    enabled: enabled && ids.length > 0 && latestWeek !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, PlayerFrames>> => {
      const rows = await fetchWeeklyStatsForPlayers<Row>({
        supabase: createBrowserClient(),
        playerIds: ids,
        seasons: [CURRENT_SEASON],
        select: SELECT,
      })
      const played = rows.filter((row) => row.source !== 'mock' && typeof row.week === 'number')
      const byId = new Map<string, Row[]>()
      for (const row of played) {
        const list = byId.get(row.player_id)
        if (list) list.push(row)
        else byId.set(row.player_id, [row])
      }
      const byPlayer = new Map<string, PlayerFrames>()
      for (const id of ids) {
        const games = (byId.get(id) ?? []).sort((a, b) => (b.week as number) - (a.week as number))
        byPlayer.set(id, {
          week: latestWeek == null ? null : total(games.filter((row) => row.week === latestWeek)),
          last3: total(games.slice(0, 3)),
          season: total(games),
        })
      }
      return byPlayer
    },
  })
}
