'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL week's games WITH their state (score, quarter, clock) for the
 * mobile Team tab's game line — "Sun 1:00 PM vs DET", "Q4 6:50 @ DEN",
 * "Final W 31-20 @ GB" (FieldScout Mobile handoff, League › Team §2.1 C).
 * `nfl_games` is world-readable (001/005); the columns are the provider's
 * stored values, never a clock. `useNflWeekGames` selects only the kickoff
 * columns, so the mobile line reads its own superset here.
 *
 * While any game of the week is live the read re-polls (a refresh timer —
 * no clock is read to decide anything). A transport error THROWS.
 */
export interface MobileWeekGame {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
  home_score: number | null
  away_score: number | null
  quarter: number | null
  game_clock: string | null
}

export const MOBILE_LIVE_GAMES_REFETCH_MS = 60_000

export function useMobileTeamGames(season: number | undefined, week: number | undefined) {
  return useQuery({
    queryKey: ['mobile-team-games', season ?? 0, week ?? 0],
    enabled: season !== undefined && week !== undefined,
    queryFn: async (): Promise<MobileWeekGame[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('nfl_games')
        .select('id, home_team, away_team, kickoff_at, status, home_score, away_score, quarter, game_clock')
        .eq('season', season!)
        .eq('week', week!)
        .order('kickoff_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as MobileWeekGame[]
    },
    refetchInterval: (query) => (query.state.data?.some((g) => g.status === 'live') ? MOBILE_LIVE_GAMES_REFETCH_MS : false),
  })
}
