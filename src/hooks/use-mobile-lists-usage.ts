'use client'

import { useQuery } from '@tanstack/react-query'

import { CURRENT_SEASON } from '@/lib/stats/aggregate-fantasy'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Lists: season usage for the "Usage" stat columns
 * (lr-lists §2.5 — Snap %, Tgt share). `player_usage` (036) is
 * world-readable, one row per player and season, both values already 0–100
 * (`my-team-ops.ts` formatSnap, F579). The table has no weekly values, so
 * these columns ignore the time frame (lr-lists gap table).
 */
export interface ListUsage {
  snap: number | null
  tshare: number | null
}

// One row per player, so a chunk stays far under PostgREST's 1000-row cap.
const CHUNK = 200

export function useMobileListsUsage(playerIds: readonly string[], enabled: boolean) {
  const ids = [...new Set(playerIds)].sort()
  return useQuery({
    queryKey: ['mobile-lists', 'usage', CURRENT_SEASON, ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Map<string, ListUsage>> => {
      const supabase = createBrowserClient()
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
      const parts = await Promise.all(
        chunks.map(async (chunk) => {
          const { data, error } = await supabase
            .from('player_usage')
            .select('player_id, snap_pct, target_share')
            .eq('season', CURRENT_SEASON)
            .in('player_id', chunk)
          // A failed read must not look like "no usage" (CLAUDE.md).
          if (error) throw new Error(`Could not load usage stats: ${error.message}`)
          return data ?? []
        }),
      )
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
      return new Map(parts.flat().map((row) => [row.player_id, { snap: num(row.snap_pct), tshare: num(row.target_share) }]))
    },
  })
}
