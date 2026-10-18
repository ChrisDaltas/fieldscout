'use client'

import { useMemo } from 'react'
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import {
  consensusMovement,
  dbPos,
  expertConsensus,
  fromDbPos,
  hubDbPositions,
  inHubPos,
  onBye,
  storedMovement,
  type ExpertOrderPrev,
  type HubPos,
  type Movement,
  type RankPos,
  type Scoring,
  type WeekGameLite,
} from '@/components/mobile/rankings/rankings-ops'
import { useAdpBoard, useAuctionBoard, type BoardSourcePlayer } from '@/hooks/use-board-sources'
import { QUARTER_PPR_SCORING, calculateFantasyPoints, type StatRow } from '@/lib/scoring/default'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * Real ranking sources for the mobile Rankings hub (lr-hub §1, §5), one
 * position chip at a time — a position, or FLEX (RB, WR and TE together in
 * overall order; Chris, 2026-10-15, #29). Each source is the WHOLE list for
 * the chip in order (the hub shows its top 36, the comparison columns look
 * players up in the rest):
 *   - experts → the consensus of the app's AI expert boards (one board per
 *               expert: their board for the position, else their overall
 *               board; FLEX reads overall boards only) — each expert's own
 *               rank backs Best / Worst / Std dev,
 *   - users   → `consensus_rankings`, the cred-weighted average of users'
 *               rankings,
 *   - adp / auction → the market boards desktop's Big Board shows (the same
 *               hooks and cache): average draft position, average auction
 *               price.
 * Scout AI has no ranking in the app, so it has no hook.
 *
 * Movement (#33): ranking boards keep each row's position before their last
 * publish (`list_players.previous_position`, migration 190). Board reads use
 * `select('*')` and never NAME that column — before the migration is pushed
 * a read naming it fails outright — so until then rows simply lack it and
 * there is no movement to show.
 *
 * Plus the position pool's season stats (`/api/players/builder`): points,
 * games, projection — and the position rank derived from points — in the
 * hub's scoring (PPR, Half PPR, 0.25 PPR or Standard).
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

/** The hub shows a source's top 36 at a position (Chris, 2026-10-15, gap
 *  list #31 — the design's lr-hub §5.1 said 24). */
export const HUB_CAP = 36
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

/** The users' consensus at a position chip. A position reads its own rank
 *  (`consensus_position_rank`); FLEX reads RB, WR and TE in overall order —
 *  the weighted rank that position rank is cut from. Players the view ties
 *  come in player-id order, so the order (and `sourceRankMap`'s numbers) is
 *  the same on every read.
 *
 *  One query, shared: the hub's Users tab and comparisons, a new ranking
 *  started from Users and phone Lists' Users column all read this cache. */
export function usersSourceQuery(pos: HubPos) {
  return queryOptions({
    queryKey: ['mobile-rankings', 'source', 'users', pos === 'FLEX' ? 'FLEX' : dbPos(pos)],
    staleTime: STALE,
    queryFn: async (): Promise<HubRow[]> => {
      const supabase = createBrowserClient()
      // pageAll + exact count: a position can pass PostgREST's 1000-row cap.
      const rows = await pageAll<ConsensusRowDb>(
        (from, to) =>
          supabase
            .from('consensus_rankings')
            .select(`player_id, weighted_rank, player:players(${COLS})`, { count: 'exact' })
            .in('position', hubDbPositions(pos))
            .order(pos === 'FLEX' ? 'weighted_rank' : 'consensus_position_rank', { ascending: true, nullsFirst: false })
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

export function useUsersSource(pos: HubPos, enabled = true) {
  return useQuery({ ...usersSourceQuery(pos), enabled })
}

/** A source's rank of each player: his place in its order (1, 2, 3 — a tie
 *  is already broken by the order). The one numbering a source's rank gets
 *  on every phone screen. */
export function sourceRankMap(rows: readonly HubRow[] | undefined): Map<string, number> {
  return new Map((rows ?? []).map((r, i) => [r.player.id, i + 1]))
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
 *  their latest overall board (boards come newest first). FLEX mixes
 *  positions, so only an overall board can order it. */
export function expertBoardsFor(boards: readonly ExpertBoard[], pos: HubPos): ExpertBoard[] {
  const byExpert = new Map<string, ExpertBoard>()
  for (const b of boards) {
    const own = fromDbPos(b.position_filter)
    if (b.position_filter && (pos === 'FLEX' || own !== pos)) continue
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
  /** Migration 190 — absent from the row until it is pushed. */
  previous_position?: number | null
  player: HubPlayer | HubPlayer[] | null
}

export interface ExpertsSource {
  rows: HubRow[]
  /** Each expert's rank of a player (only the experts who ranked him). */
  ranks: Map<string, number[]>
  /** Experts with at least one player at this position. */
  experts: number
  updatedAt: string | null
  /** The consensus's movement since the experts' previous versions; empty
   *  when no expert's board has been updated since it was recorded. */
  movement: Map<string, Movement>
}

export function useExpertsSource(pos: HubPos, enabled = true) {
  const boards = useExpertBoards()
  const chosen = useMemo(() => (boards.data ? expertBoardsFor(boards.data, pos) : null), [boards.data, pos])
  const ids = chosen?.map((b) => b.id) ?? []
  const q = useQuery({
    queryKey: ['mobile-rankings', 'source', 'experts', pos, ids.join(',')],
    enabled: enabled && chosen !== null,
    staleTime: STALE,
    queryFn: async (): Promise<ExpertsSource> => {
      if (!chosen || chosen.length === 0) {
        return { rows: [], ranks: new Map(), experts: 0, updatedAt: null, movement: new Map() }
      }
      const supabase = createBrowserClient()
      // `*`, not named columns: previous_position rides along once migration
      // 190 is pushed, and the read can't fail before it is.
      const rows = await pageAll<BoardPlayerRowDb>(
        (from, to) =>
          supabase
            .from('list_players')
            .select(`*, player:players(${COLS})`, { count: 'exact' })
            .in('list_id', chosen.map((b) => b.id))
            .order('list_id', { ascending: true })
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResponse<BoardPlayerRowDb>,
      )
      const players = new Map<string, HubPlayer>()
      const byList = new Map<string, { ids: string[]; prev: Array<number | null | undefined> }>()
      for (const r of rows) {
        const p = firstEmbed(r.player)
        if (!p || !inHubPos(p.position, pos)) continue
        players.set(p.id, p)
        const arr = byList.get(r.list_id) ?? { ids: [], prev: [] }
        arr.ids.push(p.id)
        arr.prev.push(r.previous_position)
        byList.set(r.list_id, arr)
      }
      const orders: ExpertOrderPrev[] = []
      let updatedAt: string | null = null
      for (const b of chosen) {
        const list = byList.get(b.id)
        if (!list || list.ids.length === 0) continue
        orders.push({ expert: b.persona.username, players: list.ids, prev: list.prev })
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
        movement: consensusMovement(orders),
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
// One AI expert's board (the author view, lr-hub S4)
// ---------------------------------------------------------------------------

export interface AuthorBoard {
  /** The board's players in its order, every position. */
  players: HubPlayer[]
  /** Each player's stored position before the board's last update. */
  prev: Map<string, number | null | undefined>
}

/** An AI expert's board in its order, with what movement needs. */
export function useAuthorBoard(listId: string | null) {
  return useQuery({
    queryKey: ['mobile-rankings', 'author-board', listId],
    enabled: Boolean(listId),
    staleTime: STALE,
    queryFn: async (): Promise<AuthorBoard> => {
      const supabase = createBrowserClient()
      const rows = await pageAll<BoardPlayerRowDb>(
        (from, to) =>
          supabase
            .from('list_players')
            .select(`*, player:players(${COLS})`, { count: 'exact' })
            .eq('list_id', listId!)
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResponse<BoardPlayerRowDb>,
      )
      const players: HubPlayer[] = []
      const prev = new Map<string, number | null | undefined>()
      for (const r of rows) {
        const p = firstEmbed(r.player)
        if (!p) continue
        players.push(p)
        prev.set(p.id, r.previous_position)
      }
      return { players, prev }
    },
  })
}

/**
 * The movement of a board's players at a position — measured over the
 * board's WHOLE slice there, not just the rows shown (the hub shows the top
 * 36): a player who climbs from RB40 to RB30 moved 10, the same arrow the
 * editor and the Experts consensus would give him. Look the shown rows up.
 */
export function boardMovement(
  board: Pick<AuthorBoard, 'players' | 'prev'> | undefined,
  pos: RankPos,
): Map<string, Movement> {
  if (!board) return new Map()
  return storedMovement(
    board.players.filter((p) => fromDbPos(p.position) === pos).map((p) => ({ id: p.id, prev: board.prev.get(p.id) })),
  )
}

// ---------------------------------------------------------------------------
// ADP and auction values — desktop Big Board's market boards (#29)
// ---------------------------------------------------------------------------

export type MarketKey = 'adp' | 'auction'

export interface MarketSource {
  rows: HubRow[]
  /** The value each row shows: ADP, or the average auction price. */
  values: Map<string, number>
}

/** Desktop's ADP / auction board (the top 200 overall, the same hooks and
 *  cache) cut to a position chip — ADP lowest first, price highest first. */
export function marketRows(players: readonly BoardSourcePlayer[], key: MarketKey, pos: HubPos): MarketSource {
  const rows: HubRow[] = []
  const values = new Map<string, number>()
  for (const p of players) {
    const v = key === 'adp' ? p.adp : p.auction_value
    if (v == null || !inHubPos(p.position, pos)) continue
    rows.push({
      player: {
        id: p.id,
        full_name: p.full_name,
        position: p.position,
        team: p.team,
        headshot_url: p.headshot_url,
        bye_week: p.bye_week,
      },
      score: key === 'adp' ? -v : v,
    })
    values.set(p.id, v)
  }
  return { rows, values }
}

export function useMarketSource(key: MarketKey | null, pos: HubPos) {
  const adp = useAdpBoard(key === 'adp')
  const auction = useAuctionBoard(key === 'auction')
  const q = key === 'auction' ? auction : adp
  const data = useMemo(
    () => (key && q.data ? marketRows(q.data, key, pos) : undefined),
    [key, q.data, pos],
  )
  return {
    data,
    isPending: key !== null && q.isPending,
    isError: key !== null && q.isError,
    refetch: () => void q.refetch(),
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

export interface BuilderPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  current_pts: number
  current_games: number
  projected_pts: number | null
  /** This season's raw stat totals — what `current_pts` is scored from. */
  stats_current?: Record<string, number | null>
}

/** The builder route's own scorings. 0.25 PPR has none (no stored
 *  projection column either), so it is built from Standard and Half PPR. */
type BuilderScoring = 'ppr' | 'half_ppr' | 'standard'
const BUILDER_SCORING: Record<Exclude<Scoring, 'quarter'>, BuilderScoring> = {
  ppr: 'ppr',
  half: 'half_ppr',
  std: 'standard',
}

const round1 = (n: number) => Math.round(n * 10) / 10

async function fetchBuilderPool(dbPosition: string, scoring: BuilderScoring): Promise<BuilderPlayer[]> {
  const res = await fetch(`/api/players/builder?positions=${encodeURIComponent(dbPosition)}&scoring=${scoring}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  const body = (await res.json()) as { players?: BuilderPlayer[] }
  // A body without the pool is a failure, never "no players" (CLAUDE.md).
  if (!Array.isArray(body.players)) throw new Error('The player pool came back without players')
  return body.players
}

/**
 * The pool in 0.25 PPR from its Standard and Half PPR pools. Points are
 * scored from the season's raw totals with the 0.25 rules (exactly what the
 * route does for its own scorings); the projection is the midpoint of the
 * Standard and Half PPR ones — exact, since the scorings differ only in
 * what a catch is worth (the same rule phone Lists use). Re-sorted by that
 * projection, as the route sorts its pools.
 */
export function quarterPool(std: readonly BuilderPlayer[], half: readonly BuilderPlayer[]): BuilderPlayer[] {
  const halfById = new Map(half.map((p) => [p.id, p]))
  return std
    .map((p) => {
      // Missing totals can't be scored — fail loudly rather than show 0s.
      if (!p.stats_current) throw new Error('The player pool came back without season totals')
      const h = halfById.get(p.id)
      return {
        ...p,
        current_pts: round1(calculateFantasyPoints(p.stats_current as StatRow, QUARTER_PPR_SCORING)),
        projected_pts:
          p.projected_pts != null && h?.projected_pts != null ? round1((p.projected_pts + h.projected_pts) / 2) : null,
      }
    })
    .sort((a, b) => (b.projected_pts ?? -Infinity) - (a.projected_pts ?? -Infinity))
}

/**
 * The pool's stats by player. Pos rk is a competition rank by season points
 * among players who have played; it is real league-wide (the builder
 * returns the full pool). The pool comes in projection order.
 */
export function poolStats(players: readonly BuilderPlayer[]): Map<string, PoolStat> {
  const played = players.filter((p) => p.current_games > 0).sort((a, b) => b.current_pts - a.current_pts)
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
}

/**
 * The whole active pool at one position with season stats in a scoring
 * (PPR, Half PPR, 0.25 PPR or Standard — Chris, 2026-10-15, gap list #30).
 * Each route read is cached on its own, so 0.25 PPR reuses a Standard or
 * Half PPR pool already loaded.
 */
export function usePositionPool(dbPosition: string, scoring: Scoring, enabled = true) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: poolKey(dbPosition, scoring),
    enabled,
    staleTime: STALE,
    queryFn: () => loadPool(qc, dbPosition, scoring),
  })
}

/**
 * The pool for a hub chip. FLEX is RB, WR and TE's own pools merged — each
 * player keeps his position's Pos rk (a FLEX rank labelled "RB12" would be
 * wrong) — and each position pool is the same cached read its own chip uses.
 */
export function useHubPool(pos: HubPos, scoring: Scoring, enabled = true) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: poolKey(pos === 'FLEX' ? 'FLEX' : dbPos(pos), scoring),
    enabled,
    staleTime: STALE,
    queryFn: async (): Promise<Map<string, PoolStat>> => {
      if (pos !== 'FLEX') return loadPool(qc, dbPos(pos), scoring)
      const pools = await Promise.all(
        hubDbPositions(pos).map((p) =>
          qc.fetchQuery({ queryKey: poolKey(p, scoring), staleTime: STALE, queryFn: () => loadPool(qc, p, scoring) }),
        ),
      )
      const out = new Map<string, PoolStat>()
      for (const m of pools) for (const [id, stat] of m) out.set(id, stat)
      return out
    },
  })
}

const poolKey = (key: string, scoring: Scoring) => ['mobile-rankings', 'pool', key, scoring] as const

async function loadPool(qc: QueryClient, dbPosition: string, scoring: Scoring): Promise<Map<string, PoolStat>> {
  const builder = (key: BuilderScoring) =>
    qc.fetchQuery({
      queryKey: ['mobile-rankings', 'builder', dbPosition, key],
      staleTime: STALE,
      queryFn: () => fetchBuilderPool(dbPosition, key),
    })
  if (scoring === 'quarter') {
    const [std, half] = await Promise.all([builder('standard'), builder('half_ppr')])
    return poolStats(quarterPool(std, half))
  }
  return poolStats(await builder(BUILDER_SCORING[scoring]))
}
