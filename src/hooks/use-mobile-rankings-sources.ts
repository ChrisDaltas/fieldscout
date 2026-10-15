'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  expertConsensus,
  fromDbPos,
  onBye,
  type ExpertOrder,
  type RankPos,
  type WeekGameLite,
} from '@/components/mobile/rankings/rankings-ops'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * Real ranking sources for the mobile Rankings hub (lr-hub §1, §5), one
 * position at a time. Each source is the WHOLE position list in order (the
 * hub shows its top 24, the comparison columns look players up in the rest):
 *   - experts → the consensus of the app's AI expert boards (one board per
 *               expert: their board for the position, else their overall
 *               board) — each expert's own rank backs Best / Worst / Std dev,
 *   - users   → `consensus_rankings`, the cred-weighted average of users'
 *               rankings.
 * Scout AI has no ranking in the app, so it has no hook.
 *
 * Plus the position pool's season stats (`/api/players/builder`): points,
 * games, projection — and the position rank derived from points.
 */

export interface HubPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  bye_week: number | null
}

export interface HubRow {
  player: HubPlayer
  /** Tier score — higher is better. */
  score: number
}

/** The hub shows a source's top 24 (lr-hub §5.1). */
export const HUB_CAP = 24
/** A new ranking starts from a source's top 20 (lr-myrank §3 "Start ranking"). */
export const START_CAP = 20

const COLS = 'id, full_name, position, team, headshot_url, bye_week'
const STALE = 5 * 60 * 1000

/** What a new ranking started from a source holds (lr-myrank §3 "Start
 *  ranking"): the source's top 20, without players on bye that week for a
 *  weekly ranking. */
export function sourceDraft(
  rows: readonly HubRow[] | undefined,
  weekly: boolean,
  games: readonly WeekGameLite[] | undefined,
): HubPlayer[] {
  return (rows ?? [])
    .filter((r) => !weekly || !onBye(r.player.team, games))
    .slice(0, START_CAP)
    .map((r) => r.player)
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface ConsensusRowDb {
  player_id: string | null
  weighted_rank: number | null
  player: HubPlayer | HubPlayer[] | null
}

export function useUsersSource(dbPosition: string, enabled = true) {
  return useQuery({
    queryKey: ['mobile-rankings', 'source', 'users', dbPosition],
    enabled,
    staleTime: STALE,
    queryFn: async (): Promise<HubRow[]> => {
      const supabase = createBrowserClient()
      // pageAll + exact count: a position can pass PostgREST's 1000-row cap.
      const rows = await pageAll<ConsensusRowDb>(
        (from, to) =>
          supabase
            .from('consensus_rankings')
            .select(`player_id, weighted_rank, player:players(${COLS})`, { count: 'exact' })
            .eq('position', dbPosition)
            .order('consensus_position_rank', { ascending: true, nullsFirst: false })
            .order('player_id', { ascending: true })
            .range(from, to) as unknown as PageResponse<ConsensusRowDb>,
      )
      return rows.flatMap((row) => {
        const player = firstEmbed(row.player)
        if (!player || row.weighted_rank == null) return []
        return [{ player, score: -Number(row.weighted_rank) }]
      })
    },
  })
}

// ---------------------------------------------------------------------------
// AI experts
// ---------------------------------------------------------------------------

export interface ExpertBoard {
  id: string
  title: string
  description: string | null
  /** The app's position code, or null for an overall board. */
  position_filter: string | null
  player_count: number
  updated_at: string
  persona: {
    username: string
    display_name: string
    avatar_url: string | null
    /** `style_profile.scoring_default` ("PPR", "Half-PPR", "Standard"). */
    scoring: string | null
  }
}

interface ExpertBoardRow {
  id: string
  title: string
  description: string | null
  position_filter: string | null
  player_count: number | null
  updated_at: string | null
  persona:
    | { username: string; display_name: string; avatar_url: string | null; scoring: string | null }
    | { username: string; display_name: string; avatar_url: string | null; scoring: string | null }[]
    | null
}

/** Every public board an active AI expert owns (the experts behind the
 *  Experts tab, and every board the author view can open). */
export function useExpertBoards() {
  return useQuery({
    queryKey: ['mobile-rankings', 'expert-boards'],
    staleTime: STALE,
    queryFn: async (): Promise<ExpertBoard[]> => {
      const supabase = createBrowserClient()
      const rows = await pageAll<ExpertBoardRow>(
        (from, to) =>
          supabase
            .from('lists')
            .select(
              `id, title, description, position_filter, player_count, updated_at,
               persona:ai_personas!lists_ai_persona_id_fkey!inner(username, display_name, avatar_url, scoring:style_profile->>scoring_default, is_active)`,
              { count: 'exact' },
            )
            .not('ai_persona_id', 'is', null)
            .eq('is_private', false)
            .is('deleted_at', null)
            .eq('ai_personas.is_active', true)
            .order('updated_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResponse<ExpertBoardRow>,
      )
      return rows.flatMap((row) => {
        const persona = firstEmbed(row.persona)
        if (!persona) return []
        return [
          {
            id: row.id,
            title: row.title,
            description: row.description,
            position_filter: row.position_filter,
            player_count: row.player_count ?? 0,
            updated_at: row.updated_at ?? '',
            persona: {
              username: persona.username,
              display_name: persona.display_name,
              avatar_url: persona.avatar_url,
              scoring: persona.scoring,
            },
          },
        ]
      })
    },
  })
}

/** Each expert's board for a position: their latest board for it, else
 *  their latest overall board (boards come newest first). */
export function expertBoardsFor(boards: readonly ExpertBoard[], pos: RankPos): ExpertBoard[] {
  const byExpert = new Map<string, ExpertBoard>()
  for (const b of boards) {
    const own = fromDbPos(b.position_filter)
    if (b.position_filter && own !== pos) continue
    const cur = byExpert.get(b.persona.username)
    // A position board beats an overall one; among equals the newest wins.
    if (!cur || (cur.position_filter === null && b.position_filter !== null)) {
      byExpert.set(b.persona.username, b)
    }
  }
  return Array.from(byExpert.values())
}

interface BoardPlayerRowDb {
  id: string
  list_id: string
  position: number
  player: HubPlayer | HubPlayer[] | null
}

export interface ExpertsSource {
  rows: HubRow[]
  /** Each expert's rank of a player (only the experts who ranked him). */
  ranks: Map<string, number[]>
  /** Experts with at least one player at this position. */
  experts: number
  updatedAt: string | null
}

export function useExpertsSource(pos: RankPos, enabled = true) {
  const boards = useExpertBoards()
  const chosen = useMemo(() => (boards.data ? expertBoardsFor(boards.data, pos) : null), [boards.data, pos])
  const ids = chosen?.map((b) => b.id) ?? []
  const q = useQuery({
    queryKey: ['mobile-rankings', 'source', 'experts', pos, ids.join(',')],
    enabled: enabled && chosen !== null,
    staleTime: STALE,
    queryFn: async (): Promise<ExpertsSource> => {
      if (!chosen || chosen.length === 0) return { rows: [], ranks: new Map(), experts: 0, updatedAt: null }
      const supabase = createBrowserClient()
      const rows = await pageAll<BoardPlayerRowDb>(
        (from, to) =>
          supabase
            .from('list_players')
            .select(`id, list_id, position, player:players(${COLS})`, { count: 'exact' })
            .in('list_id', chosen.map((b) => b.id))
            .order('list_id', { ascending: true })
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResponse<BoardPlayerRowDb>,
      )
      const players = new Map<string, HubPlayer>()
      const byList = new Map<string, string[]>()
      for (const r of rows) {
        const p = firstEmbed(r.player)
        if (!p || fromDbPos(p.position) !== pos) continue
        players.set(p.id, p)
        const arr = byList.get(r.list_id) ?? []
        arr.push(p.id)
        byList.set(r.list_id, arr)
      }
      const orders: ExpertOrder[] = []
      let updatedAt: string | null = null
      for (const b of chosen) {
        const list = byList.get(b.id)
        if (!list || list.length === 0) continue
        orders.push({ expert: b.persona.username, players: list })
        if (b.updated_at && (!updatedAt || b.updated_at > updatedAt)) updatedAt = b.updated_at
      }
      const consensus = expertConsensus(orders)
      return {
        rows: consensus.flatMap((c) => {
          const player = players.get(c.id)
          return player ? [{ player, score: -c.mean }] : []
        }),
        ranks: new Map(consensus.map((c) => [c.id, c.ranks])),
        experts: orders.length,
        updatedAt,
      }
    },
  })
  return {
    data: q.data,
    // A disabled query reads "pending" forever — only count the steps that run.
    isPending: enabled && (boards.isPending || (chosen !== null && q.isPending)),
    isError: enabled && (boards.isError || q.isError),
    error: boards.error ?? q.error,
    refetch: () => {
      if (boards.isError) void boards.refetch()
      else void q.refetch()
    },
  }
}

// ---------------------------------------------------------------------------
// Season stats for the position pool
// ---------------------------------------------------------------------------

export interface PoolStat {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  pts: number
  games: number
  proj: number | null
  /** Position rank by season points (null before anyone has played). */
  posRank: number | null
  /** Rank by projection within the position (the pool comes sorted by it). */
  projRank: number
}

interface BuilderPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  current_pts: number
  current_games: number
  projected_pts: number | null
}

/**
 * The whole active pool at one position with season stats for a scoring.
 * Pos rk is a competition rank by season points among players who have
 * played; it is real league-wide (the builder returns the full pool).
 */
export function usePositionPool(dbPosition: string, scoring: 'ppr' | 'std', enabled = true) {
  const key = scoring === 'std' ? 'standard' : 'ppr'
  return useQuery({
    queryKey: ['mobile-rankings', 'pool', dbPosition, key],
    enabled,
    staleTime: STALE,
    queryFn: async (): Promise<Map<string, PoolStat>> => {
      const res = await fetch(`/api/players/builder?positions=${encodeURIComponent(dbPosition)}&scoring=${key}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed with ${res.status}`)
      }
      const { players } = (await res.json()) as { players: BuilderPlayer[] }
      const played = players
        .filter((p) => p.current_games > 0)
        .sort((a, b) => b.current_pts - a.current_pts)
      const posRank = new Map<string, number>()
      let prevPts: number | null = null
      let prevRank = 0
      played.forEach((p, i) => {
        const rank = prevPts !== null && p.current_pts === prevPts ? prevRank : i + 1
        posRank.set(p.id, rank)
        prevPts = p.current_pts
        prevRank = rank
      })
      const out = new Map<string, PoolStat>()
      players.forEach((p, i) => {
        out.set(p.id, {
          id: p.id,
          full_name: p.full_name,
          position: p.position,
          team: p.team,
          headshot_url: p.headshot_url,
          pts: p.current_pts,
          games: p.current_games,
          proj: p.projected_pts,
          posRank: posRank.get(p.id) ?? null,
          projRank: i + 1,
        })
      })
      return out
    },
  })
}
