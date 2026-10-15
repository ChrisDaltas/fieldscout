'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * FieldScout Mobile — Lists: the player pool behind "Add players" and the
 * editor's Pos rk column. It is the same `/api/players/builder` read the
 * desktop Add players popover makes (projection order, then ADP), cached so
 * the editor and the sheet share one request.
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

export function useMobileListsPool(positions: readonly string[] | null, enabled: boolean) {
  const key = positions && positions.length > 0 ? positions.join(',') : 'all'
  return useQuery({
    queryKey: ['mobile-lists', 'pool', key],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PoolPlayer[]> => {
      const params = new URLSearchParams({ scoring: 'ppr' })
      if (key !== 'all') params.set('positions', key)
      const res = await fetch(`/api/players/builder?${params.toString()}`)
      // A failed read must not look like "no players" (CLAUDE.md).
      if (!res.ok) throw new Error(`Could not load players (${res.status})`)
      const body = (await res.json()) as { players?: PoolPlayer[] }
      return body.players ?? []
    },
  })
}

/** Position rank by season points ("QB3"), over players who have played. */
export function posRanks(pool: readonly PoolPlayer[]): Map<string, number> {
  const byPos = new Map<string, PoolPlayer[]>()
  for (const player of pool) {
    if (player.current_games <= 0) continue
    const list = byPos.get(player.position)
    if (list) list.push(player)
    else byPos.set(player.position, [player])
  }
  const out = new Map<string, number>()
  for (const players of byPos.values()) {
    players.sort((a, b) => b.current_pts - a.current_pts)
    players.forEach((player, index) => out.set(player.id, index + 1))
  }
  return out
}
