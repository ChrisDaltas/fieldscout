'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * The season's defense-vs-position ranks (`defense_position_splits`, 033 —
 * world-readable, sync-written) for the team page's OPRK column (League UX
 * batch 3, D478). 033's `rank` is 1 = the MOST generous defense; the page
 * shows it the way fantasy platforms do (1 = toughest) — `oprkOf` in
 * `my-team-ops.ts`. ~32 × 6 rows, asserted under the cap.
 */
export interface DefenseSplit {
  defense: string
  position: string
  rank: number
}

export function useDefenseSplits(season: number | undefined) {
  return useQuery({
    queryKey: ['defense-splits', season ?? 0],
    enabled: season !== undefined,
    queryFn: async (): Promise<DefenseSplit[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase.from('defense_position_splits').select('defense, position, rank').eq('season', season!)
      if (error) throw error
      const rows = (data ?? []) as DefenseSplit[]
      if (rows.length >= 1000) throw new Error('defense_position_splits: the read hit the 1000-row cap')
      return rows
    },
  })
}
