'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { BuilderPlayer } from '@/components/lists/builder/types'
import { trendLists } from '@/components/mobile/home/home-ops'

/**
 * Home's "Trending players" data — the SAME read the desktop Home's trending
 * card makes (`['home', 'players', 'ppr']` over `/api/players/builder`, the
 * whole active pool), so the two layouts share one cache entry. The trend is
 * the app's only one: projection vs last season (`trendLists`). There is no
 * add/drop or rostered-% source, so the design's "+502.1K" / "14.8% rostered"
 * are not shown.
 */
export function useMobileHomeTrending(rows = 5) {
  const query = useQuery({
    queryKey: ['home', 'players', 'ppr'],
    queryFn: async (): Promise<{ players: BuilderPlayer[] }> => {
      const res = await fetch('/api/players/builder?scoring=ppr')
      if (!res.ok) throw new Error(`Trending players: ${res.status}`)
      return (await res.json()) as { players: BuilderPlayer[] }
    },
    staleTime: 5 * 60 * 1000,
  })
  const lists = useMemo(() => trendLists(query.data?.players ?? [], rows), [query.data, rows])
  return { ...lists, isPending: query.isPending, isError: query.isError || (query.isSuccess && !Array.isArray(query.data?.players)), refetch: query.refetch }
}
