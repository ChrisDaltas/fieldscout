'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL week's games (`nfl_games`, world-readable — 001/005) for the team
 * page's Opp column, kickoff line and bye check (League UX batch 3, D478).
 * The rows are stored instants and the provider's status, never a clock. An
 * empty week is a real state (nothing on the calendar yet — the UI says
 * "—" and the bye check is not shown); a transport error THROWS.
 */
export interface NflWeekGame {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
}

export function useNflWeekGames(season: number | undefined, week: number | undefined) {
  return useQuery({
    queryKey: ['nfl-week-games', season ?? 0, week ?? 0],
    enabled: season !== undefined && week !== undefined,
    queryFn: async (): Promise<NflWeekGame[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('nfl_games')
        .select('id, home_team, away_team, kickoff_at, status')
        .eq('season', season!)
        .eq('week', week!)
        .order('kickoff_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as NflWeekGame[]
    },
  })
}
