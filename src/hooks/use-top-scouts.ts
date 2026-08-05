'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

// "Top ranked scouts" leaderboard (package screen 08, right column). No
// accuracy metric exists yet, so the ranking signal is the real cred score —
// the same weighting consensus rankings use. Reads profiles directly through
// the browser client (anon-readable under RLS, same as public profile pages).

export interface TopScout {
  id: string
  username: string
  avatar_url: string | null
  cred_score: number
}

const LEADERBOARD_SIZE = 5

export function useTopScouts() {
  return useQuery({
    queryKey: ['top-scouts', LEADERBOARD_SIZE],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TopScout[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, cred_score')
        .order('cred_score', { ascending: false, nullsFirst: false })
        .limit(LEADERBOARD_SIZE)
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
        cred_score: row.cred_score ?? 0,
      }))
    },
  })
}
