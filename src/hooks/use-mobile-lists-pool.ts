'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { ListScoring } from '@/hooks/use-mobile-lists-timeframe-stats'

/**
 * FieldScout Mobile — Lists: the player pool behind "Add players" and the
 * editor's Pos rk column. It is the same `/api/players/builder` read the
 * desktop Add players popover makes (projection order, then ADP), cached so
 * the editor and the sheet share one request.
 *
 * Add players always reads the PPR pool. Pos rk ranks in the list's scoring
 * (gap list #19): the builder scores PPR, Half PPR and Standard itself;
 * Quarter PPR is worked out from the PPR and Standard pools (the scorings
 * differ only by the value of a catch, so a quarter-point total is
 * ¾ Standard + ¼ PPR).
 */
export interface PoolPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  projected_pts: number | null
  current_pts: number
  current_games: number
}

/** A list's position group → the builder's `positions` filter. */
export function poolPositions(positionFilter: string | null | undefined): string[] | null {
  if (!positionFilter) return null
  const pos = positionFilter.toUpperCase()
  if (pos === 'FLEX') return ['RB', 'WR', 'TE']
  return [pos]
}

/**
 * The pool a list's Pos rk ranks against: its position group's pool (the one
 * Add players already reads) when every player on the list is in it, else the
 * whole pool — a player outside the group would otherwise show "–" as if he
 * were unranked.
 */
export function rankPoolPositions(
  positionFilter: string | null | undefined,
  playerPositions: ReadonlyArray<string | null | undefined>,
): string[] | null {
  const pool = poolPositions(positionFilter)
  if (pool && playerPositions.every((pos) => Boolean(pos) && pool.includes(pos as string))) return pool
  return null
}

/** The builder route's scoring values. */
export type PoolScoring = 'ppr' | 'half_ppr' | 'standard'

export function useMobileListsPool(positions: readonly string[] | null, enabled: boolean, scoring: PoolScoring = 'ppr') {
  const key = positions && positions.length > 0 ? positions.join(',') : 'all'
  return useQuery({
    // The PPR pool keeps its original key, so Add players and Pos rk in PPR
    // still share one request.
    queryKey: scoring === 'ppr' ? ['mobile-lists', 'pool', key] : ['mobile-lists', 'pool', key, scoring],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PoolPlayer[]> => {
      const params = new URLSearchParams({ scoring })
      if (key !== 'all') params.set('positions', key)
      const res = await fetch(`/api/players/builder?${params.toString()}`)
      // A failed read must not look like "no players" (CLAUDE.md).
      if (!res.ok) throw new Error(`Could not load players (${res.status})`)
      const body = (await res.json()) as { players?: PoolPlayer[] }
      return body.players ?? []
    },
  })
}

/** Position rank by season points ("QB3"), over players who have played.
 *  `ptsOf` scores a player (the pool's own scoring by default). */
export function posRanks(
  pool: readonly PoolPlayer[],
  ptsOf: (player: PoolPlayer) => number = (player) => player.current_pts,
): Map<string, number> {
  const byPos = new Map<string, Array<{ id: string; pts: number }>>()
  for (const player of pool) {
    if (player.current_games <= 0) continue
    const row = { id: player.id, pts: ptsOf(player) }
    const list = byPos.get(player.position)
    if (list) list.push(row)
    else byPos.set(player.position, [row])
  }
  const out = new Map<string, number>()
  for (const players of byPos.values()) {
    players.sort((a, b) => b.pts - a.pts)
    players.forEach((player, index) => out.set(player.id, index + 1))
  }
  return out
}

/** Quarter-PPR ranks from the PPR and Standard pools (¾ Standard + ¼ PPR). */
export function quarterPosRanks(ppr: readonly PoolPlayer[], standard: readonly PoolPlayer[]): Map<string, number> {
  const pprPts = new Map(ppr.map((player) => [player.id, player.current_pts]))
  return posRanks(standard, (player) => 0.75 * player.current_pts + 0.25 * (pprPts.get(player.id) ?? player.current_pts))
}

/**
 * Pos rk in the list's scoring: one pool read (two for Quarter PPR). Shaped
 * like a query (`data` / `isSuccess` / `isError` / `refetch`) so the screens
 * treat it like their other reads — a failed read is said out loud.
 */
export function useMobileListsPosRanks(positions: readonly string[] | null, enabled: boolean, scoring: ListScoring) {
  const wantPpr = scoring === 'ppr' || scoring === 'quarter'
  const wantStd = scoring === 'standard' || scoring === 'quarter'
  const ppr = useMobileListsPool(positions, enabled && wantPpr, 'ppr')
  const half = useMobileListsPool(positions, enabled && scoring === 'half', 'half_ppr')
  const std = useMobileListsPool(positions, enabled && wantStd, 'standard')
  const reads = [wantPpr ? ppr : null, scoring === 'half' ? half : null, wantStd ? std : null].filter(
    (read): read is typeof ppr => read !== null,
  )
  const data = useMemo(() => {
    if (scoring === 'ppr') return ppr.data ? posRanks(ppr.data) : undefined
    if (scoring === 'half') return half.data ? posRanks(half.data) : undefined
    if (scoring === 'standard') return std.data ? posRanks(std.data) : undefined
    return ppr.data && std.data ? quarterPosRanks(ppr.data, std.data) : undefined
  }, [scoring, ppr.data, half.data, std.data])
  return {
    data,
    isSuccess: reads.every((read) => read.isSuccess),
    isError: reads.some((read) => read.isError),
    refetch: () => Promise.all(reads.filter((read) => read.isError).map((read) => read.refetch())),
  }
}
