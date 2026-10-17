'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Lists: which of the grid's lists carry a video, for the
 * cover's "Video" badge (lr-lists §2.1). The collection payload
 * (`GET /api/lists`) doesn't include links, so this reads `list_links` (080)
 * directly — its RLS makes a link readable exactly when its list is.
 */
// ≤10 links per list (080), so a chunk of 50 lists stays under the 1000-row cap.
const CHUNK = 50

export function useMobileListsVideoFlags(listIds: readonly string[]) {
  const ids = [...new Set(listIds)].sort()
  return useQuery({
    queryKey: ['mobile-lists', 'video-flags', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const supabase = createBrowserClient()
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
      const parts = await Promise.all(
        chunks.map(async (chunk) => {
          const { data, error } = await supabase.from('list_links').select('list_id').eq('kind', 'video').in('list_id', chunk)
          if (error) throw new Error(`Could not load list videos: ${error.message}`)
          return data ?? []
        }),
      )
      return new Set(parts.flat().map((row) => row.list_id))
    },
  })
}
