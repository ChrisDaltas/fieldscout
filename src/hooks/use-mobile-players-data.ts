'use client'

import { useMemo } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { STAT_FIELDS, sumLines, type StatLine, type Usage } from '@/components/mobile/players/players-ops'
import { POOL_WINDOW } from '@/hooks/use-draft-pool'
import { poolValueKeys } from '@/hooks/use-pool-values'
import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { PoolPlayerValue, PoolValues } from '@/lib/leagues/api/pool-values-service'
import { playerNameFilter } from '@/lib/players/name-search'
import { createBrowserClient } from '@/lib/supabase/client'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'

/**
 * FieldScout Mobile — Players tab reads. Every one is an existing source read
 * the way the desktop surfaces read it (no new route, table or job):
 *   - the browse WINDOW is `useDraftPool`'s ADP-ordered `players` window
 *     (`POOL_WINDOW`), with the design's FLEX (several positions) and NFL
 *     team filters applied SERVER-side — never a client filter over a
 *     bounded page (the "exactly 1000 rows" lesson);
 *   - rostered players are read by id (the rosters route has no headshot);
 *   - weekly `player_stats` lines (world-readable, 005) for the period;
 *   - `player_usage` (snap % / target share) for the season;
 *   - the league's scored values (`GET …/player-values`, chunked at the
 *     route's own 300-id cap);
 *   - one NFL week's games with the stored score / quarter / clock;
 *   - the account tab's `/api/players/builder` (the research table's read).
 * Every read THROWS on a transport error (loud failure, never an empty list).
 *
 * The league tab's SEARCH is the window's own `players` read with the app's
 * name rule (`playerNameFilter`) applied server-side — so it runs over the
 * WHOLE active pool, not the 300 rows already loaded; the by-id sets are
 * complete, so the caller matches them with the same rule on the client.
 *
 * Placeholders: the browse reads keep the previous rows while a new filter
 * loads. A PERIOD-dependent read (lines, usage) keeps its previous data only
 * while the period is unchanged — the same numbers for the players both id
 * sets share — never across a period change, which shows loading instead of
 * the old period's stats under the new pill.
 */

/** `search_name` rides along so a search can match rows in hand by the same
 *  rule the server applies (`playerNameMatches`). */
const PLAYER_SELECT = 'id, full_name, position, team, adp, headshot_url, status, search_name'

/** A Players-tab row: the pool's columns plus Sleeper's run-together name. */
export type MobilePoolPlayer = PoolPlayer & { search_name?: string | null }

/** The browse window's `players` read: ADP order, position(s), NFL team and
 *  a typed name (already trimmed; '' = no search) all narrowed SERVER-side,
 *  so a search covers the whole active pool — never a client filter over the
 *  rows a browse loaded. Exported so a test pins the filters it sends. */
export async function fetchPlayersWindow(positions: readonly string[] | null, team: string | null, term: string): Promise<MobilePoolPlayer[]> {
  const supabase = createBrowserClient()
  let q = supabase.from('players').select(PLAYER_SELECT).not('team', 'is', null)
  if (positions && positions.length === 1) q = q.eq('position', positions[0]!)
  else if (positions && positions.length > 1) q = q.in('position', [...positions])
  if (team) q = q.eq('team', team)
  if (term) q = q.or(playerNameFilter(term))
  const { data, error } = await q
    .order('adp', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(POOL_WINDOW)
  if (error) throw error
  return (data ?? []) as MobilePoolPlayer[]
}

/** The window came back at its cap. Only THIS key's own answer can say so:
 *  a placeholder (the previous key's rows, kept while this key reads) never
 *  counts — the browse's 300 rows are no claim about a search still loading. */
export function windowAtCap(rows: readonly unknown[] | undefined, isPlaceholderData: boolean): boolean {
  return !isPlaceholderData && (rows?.length ?? 0) >= POOL_WINDOW
}

/** The league tab's browse window (`fetchPlayersWindow`). `full` = this
 *  key's answer came back at its cap (the screen says so). */
export function useMobilePlayersWindow(positions: readonly string[] | null, team: string | null, search = '') {
  const posKey = positions ? positions.join(',') : ''
  const term = search.trim()
  const query = useQuery({
    queryKey: ['mobile-players-window', posKey, team ?? '', term] as const,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchPlayersWindow(positions, team, term),
  })
  return { ...query, full: windowAtCap(query.data, query.isPlaceholderData) }
}

const ID_CHUNK = 100

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Player rows by id — chunked so a long id list never truncates or
 *  overflows a URL; a missing id is named, never silently dropped. */
export function useMobilePlayersByIds(ids: readonly string[]) {
  const sorted = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  const query = useQuery({
    queryKey: ['mobile-players-by-ids', sorted] as const,
    enabled: sorted.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MobilePoolPlayer[]> => {
      const supabase = createBrowserClient()
      const parts = await Promise.all(
        chunk(sorted, ID_CHUNK).map(async (ids) => {
          const { data, error } = await supabase.from('players').select(PLAYER_SELECT).in('id', ids)
          if (error) throw error
          return (data ?? []) as MobilePoolPlayer[]
        }),
      )
      return parts.flat()
    },
  })
  const byId = useMemo(() => new Map((query.data ?? []).map((p) => [p.id, p])), [query.data])
  return { ...query, byId }
}

/** Which weekly lines a period sums: one week, or every week before one, or
 *  a whole season. */
export type LinesScope = { season: number; week: number } | { season: number; beforeWeek: number } | { season: number }

const LINE_SELECT = `player_id, week, ${STAT_FIELDS.join(', ')}`
const LINE_CHUNK = 50

type LineRow = Partial<Record<(typeof STAT_FIELDS)[number], number | null>> & { player_id: string | null; week: number | null }

const sameScope = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useMobilePlayerLines(scope: LinesScope | null, ids: readonly string[]) {
  const sorted = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  const query = useQuery({
    queryKey: ['mobile-player-lines', scope, sorted] as const,
    enabled: scope !== null && sorted.length > 0,
    // Same period, other players: keep the shared players' lines meanwhile.
    placeholderData: (prev, prevQuery) => (prevQuery && sameScope(prevQuery.queryKey[1], scope) ? prev : undefined),
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<Map<string, StatLine>> => {
      const supabase = createBrowserClient()
      const s = scope!
      const parts = await Promise.all(
        chunk(sorted, LINE_CHUNK).map((ids) =>
          pageAll<LineRow>((from, to) => {
            let q = supabase.from('player_stats').select(LINE_SELECT, { count: 'exact' }).in('player_id', ids).eq('season', s.season).not('week', 'is', null)
            if ('week' in s) q = q.eq('week', s.week)
            if ('beforeWeek' in s) q = q.lt('week', s.beforeWeek)
            return q
              .order('player_id', { ascending: true })
              .order('week', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to) as unknown as PageResponse<LineRow>
          }),
        ),
      )
      return sumLines(parts.flat())
    },
  })
  return query
}

/** Season usage (snap % and target share, both 0–100) by player. */
export function useMobilePlayerUsage(season: number | undefined, ids: readonly string[]) {
  const sorted = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  return useQuery({
    queryKey: ['mobile-player-usage', season ?? 0, sorted] as const,
    enabled: season !== undefined && sorted.length > 0,
    // Same season, other players: keep the shared players' usage meanwhile.
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey[1] === (season ?? 0) ? prev : undefined),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Map<string, Usage>> => {
      const supabase = createBrowserClient()
      const parts = await Promise.all(
        chunk(sorted, ID_CHUNK * 2).map(async (ids) => {
          const { data, error } = await supabase
            .from('player_usage')
            .select('player_id, snap_pct, target_share')
            .eq('season', season!)
            .in('player_id', ids)
          if (error) throw error
          return data ?? []
        }),
      )
      return new Map(
        parts.flat().map((r) => [
          r.player_id,
          { snap: r.snap_pct === null ? null : Number(r.snap_pct), tshare: r.target_share === null ? null : Number(r.target_share) },
        ]),
      )
    },
  })
}

/** The route's own per-request cap (`MAX_POOL_VALUE_PLAYERS`). */
const VALUES_CHUNK = 300

/**
 * League-scored values at one week for any number of players — the same
 * route and cache keys as `usePoolValues`, chunked at its 300-id cap.
 * `week` undefined = not read. No placeholder: `useQueries` gives each new
 * chunk key a fresh observer, so a changed id set or week reads as pending
 * (the screen shows loading) — never another week's values.
 */
export function useMobilePoolValuesAt(leagueId: string, week: number | undefined, ids: readonly string[]) {
  const chunks = useMemo(() => chunk(Array.from(new Set(ids)).sort(), VALUES_CHUNK).map((c) => c.join(',')), [ids])
  return useQueries({
    queries: chunks.map((joined) => ({
      queryKey: poolValueKeys.window(leagueId, week ?? 0, joined),
      enabled: week !== undefined && joined.length > 0,
      staleTime: 5 * 60 * 1000,
      queryFn: () => sendLeagueAction<PoolValues>(`/api/leagues/${leagueId}/player-values?week=${week!}&players=${encodeURIComponent(joined)}`),
    })),
    combine: combineValues,
  })
}

type ValuesResult = { data?: PoolValues; isPending: boolean; isFetching: boolean; isError: boolean; error: Error | null; refetch: () => unknown }

/** Stable (module-level) so TanStack memoises the combined result. */
function combineValues(results: ValuesResult[]) {
  const byPlayer = new Map<string, PoolPlayerValue>()
  for (const r of results) for (const v of r.data?.values ?? []) byPlayer.set(v.player_id, v)
  return {
    byPlayer,
    isPending: results.some((r) => r.isPending && r.isFetching),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
  }
}

export interface MobileWeekGame {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
  home_score: number | null
  away_score: number | null
  quarter: number | null
  game_clock: string | null
}

/** One NFL week's games with the provider's stored score, quarter and clock
 *  (`nfl_games`, world-readable — `useNflWeekGames` plus the score columns). */
export function useMobileWeekGames(season: number | undefined, week: number | undefined) {
  return useQuery({
    queryKey: ['mobile-week-games', season ?? 0, week ?? 0] as const,
    enabled: season !== undefined && week !== undefined,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<MobileWeekGame[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('nfl_games')
        .select('id, home_team, away_team, kickoff_at, status, home_score, away_score, quarter, game_clock')
        .eq('season', season!)
        .eq('week', week!)
        .order('kickoff_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as MobileWeekGame[]
    },
  })
}

// ---------------------------------------------------------------------------
// Account Players tab — the research table's read
// ---------------------------------------------------------------------------

export interface ResearchPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  depth_chart_order: number | null
  depth_chart_position: string | null
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  projected_pts: number | null
  stats_last: Record<string, number>
  stats_current: Record<string, number>
}

export interface ResearchPool {
  players: ResearchPlayer[]
  season: { current: number; last: number }
}

/** `/api/players/builder` for the WHOLE active pool (no position / team
 *  narrowing — the route pages every row), so position and overall ranks are
 *  over everyone and the filters are instant. No placeholder: another
 *  scoring's points never sit under the new Scoring pill. A response without
 *  its players or seasons THROWS — never a guessed year or an empty pool. */
export function useMobileResearchPool(scoring: 'ppr' | 'half_ppr' | 'standard') {
  return useQuery({
    queryKey: ['mobile-research-pool', scoring] as const,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ResearchPool> => {
      const res = await fetch(`/api/players/builder?scoring=${scoring}`)
      const body = (await res.json().catch(() => null)) as { players?: ResearchPlayer[]; season?: { current?: unknown; last?: unknown }; error?: unknown } | null
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Players failed (${res.status})`)
      const season = body?.season
      if (!Array.isArray(body?.players) || typeof season?.current !== 'number' || typeof season.last !== 'number') {
        throw new Error('The players read came back without its players or seasons.')
      }
      return { players: body.players, season: { current: season.current, last: season.last } }
    },
  })
}
