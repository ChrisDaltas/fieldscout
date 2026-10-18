'use client'

import { useQuery } from '@tanstack/react-query'

import { isLiveStatus } from '@/components/mobile/players/players-ops'
import type { TeamGame } from '@/components/players/player-page-ops'
import { MOBILE_LIVE_GAMES_REFETCH_MS } from '@/hooks/use-mobile-team-games'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL team's regular-season games (`nfl_games`, world-readable — 001)
 * for the full player page's Schedule tab and its Scout AI matchup read,
 * with where each game stands (the provider's stored score, quarter and
 * clock — the phone profile's this-week card, gap list §3 #19).
 * ≤ 18 rows. An empty season is a real state (nothing on file yet — the tab
 * says so and the Scout AI band is omitted); a transport error THROWS.
 *
 * `pollWhileLive` (the phone profile): while one of his games is on, the
 * read re-polls so the score and clock keep up — a refresh timer, no clock
 * is read to decide anything. Off by default (desktop is unchanged).
 */
export function useNflTeamSchedule(season: number | undefined, team: string | null | undefined, opts?: { pollWhileLive?: boolean }) {
  const poll = opts?.pollWhileLive === true
  return useQuery({
    queryKey: ['nfl-team-schedule', season ?? 0, team ?? ''],
    enabled: season !== undefined && !!team && /^[A-Z]{2,4}$/.test(team),
    queryFn: async (): Promise<TeamGame[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('nfl_games')
        .select('week, home_team, away_team, kickoff_at, status, home_score, away_score, quarter, game_clock')
        .eq('season', season!)
        .eq('game_type', 'regular')
        .or(`home_team.eq.${team},away_team.eq.${team}`)
        .order('week', { ascending: true })
      if (error) throw error
      return (data ?? []) as TeamGame[]
    },
    refetchInterval: (query) => (poll && query.state.data?.some((g) => isLiveStatus(g.status)) ? MOBILE_LIVE_GAMES_REFETCH_MS : false),
  })
}
