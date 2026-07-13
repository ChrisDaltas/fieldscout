'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/** Everything a Big Board dashboard card can show. All stats nullable — the
 * card simply skips chips it has no data for. */
export interface BoardSourcePlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  bye_week: number | null
  adp: number | null
  projected_pts_standard: number | null
  projected_pts_half_ppr: number | null
  projected_pts_ppr: number | null
  snap_pct: number | null
  target_share: number | null
  sos: number | null
}

const PLAYER_COLS =
  'id, full_name, position, team, headshot_url, bye_week, adp, projected_pts_standard, projected_pts_half_ppr, projected_pts_ppr, snap_pct, target_share, sos'

const BOARD_LIMIT = 200
const STALE_TIME = 5 * 60 * 1000

function first<T>(value: T | T[] | null): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Expert consensus board — the cred-weighted community ranking (the same
 * consensus_rankings view behind /consensus), hydrated with player card data. */
export function useConsensusBoard(enabled: boolean) {
  return useQuery({
    queryKey: ['board-source', 'consensus'],
    enabled,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<BoardSourcePlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('consensus_rankings')
        .select(`weighted_rank, player:players(${PLAYER_COLS})`)
        .order('weighted_rank', { ascending: true, nullsFirst: false })
        .limit(BOARD_LIMIT)
      if (error) throw error
      return (data ?? []).flatMap((row) => {
        const player = first(row.player as BoardSourcePlayer | BoardSourcePlayer[] | null)
        return player ? [player] : []
      })
    },
  })
}

/** ADP board — the player pool ordered by average draft position. */
export function useAdpBoard(enabled: boolean) {
  return useQuery({
    queryKey: ['board-source', 'adp'],
    enabled,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<BoardSourcePlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('players')
        .select(PLAYER_COLS)
        .not('adp', 'is', null)
        .order('adp', { ascending: true })
        .limit(BOARD_LIMIT)
      if (error) throw error
      return (data ?? []) as BoardSourcePlayer[]
    },
  })
}

/** An AI persona's public board, in its list order. Persona lists are
 * anon-readable under RLS (see usePersonaBoards). */
export function usePersonaBoardPlayers(listId: string | null) {
  return useQuery({
    queryKey: ['board-source', 'persona', listId],
    enabled: Boolean(listId),
    staleTime: STALE_TIME,
    queryFn: async (): Promise<BoardSourcePlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('list_players')
        .select(`position, player:players(${PLAYER_COLS})`)
        .eq('list_id', listId!)
        .order('position', { ascending: true })
        .limit(300)
      if (error) throw error
      return (data ?? []).flatMap((row) => {
        const player = first(row.player as BoardSourcePlayer | BoardSourcePlayer[] | null)
        return player ? [player] : []
      })
    },
  })
}
