'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'
import { aggregateFantasyStats, type ScoringKey } from '@/lib/stats/aggregate-fantasy'
import { firstEmbed } from '@/utils/supabase-embed'

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
  sos: number | null
  auction_value: number | null
}

const PLAYER_COLS =
  'id, full_name, position, team, headshot_url, bye_week, adp, projected_pts_standard, projected_pts_half_ppr, projected_pts_ppr, sos, auction_value'

const BOARD_LIMIT = 200
const STALE_TIME = 5 * 60 * 1000

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
        const player = firstEmbed(row.player as BoardSourcePlayer | BoardSourcePlayer[] | null)
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

export interface PlayerUsage {
  snap_pct: number | null
  target_share: number | null
}

/** Season usage rates (snap %, target share) from the shared player_usage
 * table — the same per-season source Research stats live in, so the board's
 * season filter and Research always agree. Returns playerId → usage. */
export function useUsageMap(season: number) {
  return useQuery({
    queryKey: ['player-usage', season],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<Map<string, PlayerUsage>> => {
      const supabase = createBrowserClient()
      const map = new Map<string, PlayerUsage>()
      const pageSize = 1000
      let offset = 0
      while (true) {
        const { data, error } = await supabase
          .from('player_usage')
          .select('player_id, snap_pct, target_share')
          .eq('season', season)
          .order('player_id')
          .range(offset, offset + pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        for (const row of data) {
          map.set(row.player_id, {
            snap_pct: row.snap_pct,
            target_share: row.target_share,
          })
        }
        if (data.length < pageSize) break
        offset += pageSize
      }
      return map
    },
  })
}

/** Auction board — the player pool ordered by average auction price
 * (ESPN live draft data, synced by sync-auction). */
export function useAuctionBoard(enabled: boolean) {
  return useQuery({
    queryKey: ['board-source', 'auction'],
    enabled,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<BoardSourcePlayer[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('players')
        .select(PLAYER_COLS)
        .not('auction_value', 'is', null)
        .order('auction_value', { ascending: false })
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
        const player = firstEmbed(row.player as BoardSourcePlayer | BoardSourcePlayer[] | null)
        return player ? [player] : []
      })
    },
  })
}

/** Last-season fantasy point totals for a set of players — Big Board's
 *  "2025 total points" card field. Reads `player_stats` directly (RLS
 *  already allows public read) via the same aggregator the list detail
 *  page's server route uses, just from the browser client instead. Pass an
 *  empty array to skip the fetch entirely (e.g. while the field is off). */
export function useLastSeasonPoints(playerIds: string[], scoring: ScoringKey) {
  const ids = useMemo(() => [...playerIds].sort(), [playerIds])
  return useQuery({
    queryKey: ['board-last-season-points', scoring, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<Map<string, number>> => {
      const supabase = createBrowserClient()
      const stats = await aggregateFantasyStats(supabase, ids, scoring)
      const out = new Map<string, number>()
      for (const [id, s] of stats) out.set(id, s.last_pts)
      return out
    },
  })
}
