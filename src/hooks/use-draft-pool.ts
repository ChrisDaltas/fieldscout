'use client'

import { useQuery } from '@tanstack/react-query'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Draft-room player pool + my Big Board ranks (M2 task L.B3.2; spec §8.5.2
 * available-players; §16.2; tasks-M2 C26/D92 — reads are RLS-scoped direct
 * SELECTs, `players` is world-readable and app-read-only).
 *
 * SEARCH IS SERVER-BACKED on purpose (the "exactly 1000 rows" lesson,
 * CLAUDE.md): the browse view is a deliberately bounded ADP-ordered window
 * (`POOL_WINDOW` — a full 16×16 draft consumes 256 players off the top, so
 * the window comfortably outlives every board), and any player outside it
 * is still findable because a search term becomes an `ilike` FILTER in the
 * query rather than a scan of the bounded page. Drafted subtraction happens
 * client-side BY player_id (C26 — available-players-ops.ts) so the pool,
 * queue and board all move on the same picks broadcast (E17) without
 * refetching this query.
 */

/** ADP-ordered browse window; search/position narrow SERVER-side. */
export const POOL_WINDOW = 300

export const draftPoolKeys = {
  pool: (search: string, position: string) => ['draft-pool', search, position] as const,
  bigBoard: (userId: string) => ['draft-big-board', userId] as const,
}

export function useDraftPool(search: string, position: string) {
  const normalizedSearch = search.trim()
  return useQuery({
    queryKey: draftPoolKeys.pool(normalizedSearch, position),
    queryFn: async (): Promise<PoolPlayer[]> => {
      const supabase = createBrowserClient()
      let query = supabase
        .from('players')
        .select('id, full_name, position, team, adp, headshot_url, status')
        // The active pool: retirees/free agents have no current team (the
        // players-builder route's own filter — one definition of "active").
        .not('team', 'is', null)
      if (position) query = query.eq('position', position)
      if (normalizedSearch) query = query.ilike('full_name', `%${normalizedSearch}%`)
      const { data, error } = await query
        .order('adp', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true })
        .order('id', { ascending: true }) // unique tiebreak — stable window
        .limit(POOL_WINDOW)
      if (error) throw error
      return (data ?? []) as PoolPlayer[]
    },
    staleTime: 5 * 60 * 1000, // the pool itself moves slowly; picks don't touch it
  })
}

/**
 * My season Big Board rank map (§8.9's default reference — the ranks column
 * §16.2 names). Own-lists RLS read: the board is `lists.is_big_board`
 * (partial-unique per owner, auto-created at signup) and rank = position
 * order in `list_players`. Absent board ⇒ an empty map (the column renders
 * "—").
 */
export function useMyBigBoardRanks(userId: string | undefined) {
  return useQuery({
    queryKey: draftPoolKeys.bigBoard(userId ?? 'none'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Array<{ player_id: string }>> => {
      const supabase = createBrowserClient()
      const { data: board, error: boardError } = await supabase
        .from('lists')
        .select('id')
        .eq('owner_id', userId!)
        .eq('is_big_board', true)
        .is('deleted_at', null)
        .maybeSingle()
      if (boardError) throw boardError
      if (!board) return []
      const { data, error } = await supabase
        .from('list_players')
        .select('player_id')
        .eq('list_id', board.id)
        .order('position', { ascending: true })
      if (error) throw error
      return (data ?? []) as Array<{ player_id: string }>
    },
    staleTime: 5 * 60 * 1000,
  })
}
