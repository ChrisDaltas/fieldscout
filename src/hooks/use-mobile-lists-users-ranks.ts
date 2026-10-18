'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Lists: the "Users" rank stat column (lr-lists §2.5,
 * gap list §3 #9). Each player's rank at his position in the users'
 * consensus — the existing `consensus_rankings` view (001), the same read
 * behind /consensus and the phone Rankings hub's Users tab. The view already
 * applies Rule 9: every public, ranked list counts, weighted by its owner's
 * cred score, and a cred of 0 still counts with a weight of 1
 * (`GREATEST(cred_score, 1)`). The consensus is season-long, so the column
 * ignores the time frame and the scoring.
 *
 * The view holds one row per player (`idx_consensus_player`), so a chunk of
 * ids stays far under PostgREST's 1000-row cap. A player missing from the
 * answer simply isn't in the users' consensus.
 */

const CHUNK = 200

/** player id → his position rank among users. Throws on a failed read —
 *  never an empty map that would read as "nobody ranked him". */
export async function readUsersRanks(playerIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(playerIds)].sort()
  const supabase = createBrowserClient()
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from('consensus_rankings')
        .select('player_id, consensus_position_rank')
        .in('player_id', chunk)
      if (error) throw new Error(`Could not load the users' rankings: ${error.message}`)
      return data ?? []
    }),
  )
  const out = new Map<string, number>()
  for (const row of parts.flat()) {
    const rank = row.consensus_position_rank == null ? NaN : Number(row.consensus_position_rank)
    if (row.player_id && Number.isFinite(rank) && rank > 0) out.set(row.player_id, rank)
  }
  return out
}

export function useMobileListsUsersRanks(playerIds: readonly string[], enabled: boolean) {
  const ids = [...new Set(playerIds)].sort()
  return useQuery({
    queryKey: ['mobile-lists', 'users-ranks', ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: () => readUsersRanks(ids),
  })
}
