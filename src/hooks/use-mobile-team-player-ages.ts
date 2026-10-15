'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Players' birth dates for the mobile trade builder's "Age 26" tile line
 * (FieldScout Mobile handoff, Trade builder §2.5). `players` is the synced,
 * world-readable table (read-only here). The AGE is computed by the caller
 * against an instant it is handed (the trades read's `evaluated_at`), so
 * nothing here reads a clock.
 */
export function useMobileTeamPlayerAges(ids: readonly string[]) {
  const sortedIds = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  const query = useQuery({
    queryKey: ['mobile-team-player-ages', sortedIds],
    enabled: sortedIds.length > 0,
    queryFn: async (): Promise<Array<{ id: string; birth_date: string | null }>> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase.from('players').select('id, birth_date').in('id', sortedIds)
      if (error) throw error
      return data ?? []
    },
  })
  const birthById = useMemo(() => new Map((query.data ?? []).map((p) => [p.id, p.birth_date])), [query.data])
  return { ...query, birthById }
}
