'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL team's depth chart for the mobile player profile's Team tab
 * (m-pprofile §2.9): the offensive skill players and the kicker that the
 * Sleeper roster sync placed on a depth chart (`players.depth_chart_position`
 * / `depth_chart_order`, migration 029). `players` is world-readable and
 * app-read-only; this is a plain SELECT, nothing is written. A team has well
 * under 100 such rows — asserted against the 1000-row cap.
 */
export interface DepthChartPlayer {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  position: string
  birth_date: string | null
  depth_chart_position: string | null
  depth_chart_order: number | null
}

export function useMobileProfileDepthChart(team: string | null | undefined) {
  return useQuery({
    queryKey: ['mobile-pprofile-depth-chart', team ?? ''],
    enabled: !!team && /^[A-Z]{2,4}$/.test(team),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DepthChartPlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('players')
        .select('id, full_name, first_name, last_name, position, birth_date, depth_chart_position, depth_chart_order')
        .eq('team', team!)
        .in('position', ['QB', 'RB', 'WR', 'TE', 'K'])
        .not('depth_chart_order', 'is', null)
        .order('depth_chart_order', { ascending: true })
      if (error) throw error
      const rows = (data ?? []) as DepthChartPlayer[]
      if (rows.length >= 1000) throw new Error('players: the depth-chart read hit the 1000-row cap')
      return rows
    },
  })
}
