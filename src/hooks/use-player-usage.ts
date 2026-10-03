'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Season usage (`player_usage`, 036 — world-readable) by player, for the
 * team page's Snap % column (League UX batch 3, D478). A player with no row
 * shows "—", never 0.
 */
export function usePlayerUsage(season: number | undefined, ids: readonly string[]) {
  const sortedIds = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  const query = useQuery({
    queryKey: ['player-usage', season ?? 0, sortedIds],
    enabled: season !== undefined && sortedIds.length > 0,
    queryFn: async (): Promise<Array<{ player_id: string; snap_pct: number | null }>> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase.from('player_usage').select('player_id, snap_pct').eq('season', season!).in('player_id', sortedIds)
      if (error) throw error
      return (data ?? []).map((r) => ({ player_id: r.player_id, snap_pct: r.snap_pct === null ? null : Number(r.snap_pct) }))
    },
  })
  const snapByPlayer = useMemo(() => new Map((query.data ?? []).map((r) => [r.player_id, r.snap_pct])), [query.data])
  return { ...query, snapByPlayer }
}
