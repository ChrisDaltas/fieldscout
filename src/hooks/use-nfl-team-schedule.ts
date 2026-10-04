'use client'

import { useQuery } from '@tanstack/react-query'

import type { TeamGame } from '@/components/players/player-page-ops'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL team's regular-season games (`nfl_games`, world-readable — 001)
 * for the full player page's Schedule tab and its Scout AI matchup read.
 * ≤ 18 rows. An empty season is a real state (nothing on file yet — the tab
 * says so and the Scout AI band is omitted); a transport error THROWS.
 */
export function useNflTeamSchedule(season: number | undefined, team: string | null | undefined) {
  return useQuery({
    queryKey: ['nfl-team-schedule', season ?? 0, team ?? ''],
    enabled: season !== undefined && !!team && /^[A-Z]{2,4}$/.test(team),
    queryFn: async (): Promise<TeamGame[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('nfl_games')
        .select('week, home_team, away_team, kickoff_at, status')
        .eq('season', season!)
        .eq('game_type', 'regular')
        .or(`home_team.eq.${team},away_team.eq.${team}`)
        .order('week', { ascending: true })
      if (error) throw error
      return (data ?? []) as TeamGame[]
    },
  })
}
