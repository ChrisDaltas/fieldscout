'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import type { PlayerNewsPage } from '@/lib/news/types'

/** The player view's News section (F575) — `/api/players/[id]/news`, paged. */
export function usePlayerNews(playerId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['player-news', playerId],
    enabled,
    staleTime: 5 * 60_000,
    initialPageParam: 0,
    getNextPageParam: (last: PlayerNewsPage) => last.nextPage ?? undefined,
    queryFn: async ({ pageParam }): Promise<PlayerNewsPage> => {
      const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/news?page=${pageParam}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `news failed (${res.status})`)
      return body as PlayerNewsPage
    },
  })
}
