'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One player's weekly box lines for the mobile player profile's Game log,
 * History and Key stats trend (FieldScout Mobile handoff, m-pprofile §2.5b /
 * §2.6 / §2.10): the
 * current season and up to three before it, read straight from the
 * world-readable `player_stats` (005) — the same table the stats and
 * core-stats routes read, no new backend. ≤ 4 × 18 rows; the read asserts it
 * stayed far below PostgREST's 1000-row cap so a short answer is a real one.
 */
export const PROFILE_BOX_COLUMNS = [
  'pass_attempts',
  'pass_completions',
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_attempts',
  'rush_yards',
  'rush_tds',
  'targets',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fumbles_lost',
  'two_point_conversions',
  'fg_made',
  'fg_attempted',
  'fg_made_40_plus',
  'fg_made_50_plus',
  'xp_made',
  'xp_attempted',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
  'def_safeties',
  'def_points_allowed',
  'def_yards_allowed',
] as const
export type ProfileBoxColumn = (typeof PROFILE_BOX_COLUMNS)[number]

export type ProfileStatLine = {
  season: number
  week: number
  is_live: boolean | null
} & Partial<Record<ProfileBoxColumn, number | null>>

/** Seasons read: the current one and the three before it (History shows four). */
export const PROFILE_SEASON_SPAN = 4

export function useMobileProfileStatLines(playerId: string | null, currentSeason: number | undefined) {
  return useQuery({
    queryKey: ['mobile-pprofile-stat-lines', playerId ?? 'none', currentSeason ?? 0],
    enabled: Boolean(playerId) && currentSeason !== undefined,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProfileStatLine[]> => {
      const seasons = Array.from({ length: PROFILE_SEASON_SPAN }, (_, i) => currentSeason! - i)
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('player_stats')
        .select(['season', 'week', 'is_live', ...PROFILE_BOX_COLUMNS].join(', '))
        .eq('player_id', playerId!)
        .eq('stat_type', 'weekly')
        .in('season', seasons)
        .gte('week', 1)
        .order('season', { ascending: false })
        .order('week', { ascending: true })
      if (error) throw error
      const rows = (data ?? []) as unknown as ProfileStatLine[]
      if (rows.length >= 1000) throw new Error('player_stats: the profile read hit the 1000-row cap')
      return rows
    },
  })
}
