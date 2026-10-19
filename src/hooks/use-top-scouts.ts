'use client'

import { useQuery } from '@tanstack/react-query'

import { credOrStart } from '@/lib/cred-tiers'
import { createBrowserClient } from '@/lib/supabase/client'

// "Top ranked scouts" leaderboard (package screen 08, right column; the
// phone's For you shelf). The ranking signal is `profiles.cred_score` — the
// same weighting consensus rankings use. Reads profiles directly through the
// browser client (anon-readable under RLS, same as public profile pages).
//
// NOTHING AWARDS cred YET: every account starts at 7 (migration 197,
// `CRED_START` — Chris 2026-10-18) and no job, trigger or route changes it,
// so every account everywhere ties at 7 (at 0 where 197 isn't pushed yet). A
// missing cred reads as the start. The fixed tiebreak (earliest account
// first, then id) keeps the 1–5 order stable between reads instead of
// whatever order Postgres happens to return the tie in. It is not a merit
// order.

export interface TopScout {
  id: string
  username: string
  avatar_url: string | null
  cred_score: number
}

export const LEADERBOARD_SIZE = 5

type BrowserClient = ReturnType<typeof createBrowserClient>

export async function fetchTopScouts(supabase: BrowserClient): Promise<TopScout[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, cred_score')
    .order('cred_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(LEADERBOARD_SIZE)
  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    username: row.username,
    avatar_url: row.avatar_url,
    cred_score: credOrStart(row.cred_score),
  }))
}

export function useTopScouts() {
  return useQuery({
    queryKey: ['top-scouts', LEADERBOARD_SIZE],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchTopScouts(createBrowserClient()),
  })
}
