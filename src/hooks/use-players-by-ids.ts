'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Player identity rows by id (M2 task L.B3.2) — ONE world-readable
 * `players` SELECT keyed on a sorted id set (the D92 read pattern; players
 * is app-read-only). Shared by the draft room's board grid, my-queue and
 * roster tracker so three surfaces don't each mint a fetch for the same
 * picked ids; broadcast hint rows render a placeholder until the keyed
 * refetch lands the new id's row.
 */

export interface PlayerIdentity {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
}

export function usePlayersByIds(ids: readonly string[]) {
  // Sorted + deduped so the query key is stable across re-renders and
  // arrival order.
  const sortedIds = useMemo(() => Array.from(new Set(ids)).sort(), [ids])

  const query = useQuery({
    queryKey: ['players-by-ids', sortedIds],
    enabled: sortedIds.length > 0,
    queryFn: async (): Promise<PlayerIdentity[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('players')
        .select('id, full_name, position, team, headshot_url, status')
        .in('id', sortedIds)
      if (error) throw error
      return (data ?? []) as PlayerIdentity[]
    },
  })

  const playerById = useMemo(
    () => new Map((query.data ?? []).map((p) => [p.id, p])),
    [query.data],
  )

  return { ...query, playerById }
}
