'use client'

import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { PoolPlayerValue, PoolValues } from '@/lib/leagues/api/pool-values-service'

/**
 * League-scored values for the players page's window (League UX batch 5):
 * this week's projection and season-to-date points under the league's own
 * rules, for free agents and rostered players alike —
 * `GET /api/leagues/[id]/player-values` (read-only; the league-player-values
 * job's own code, computed on demand). A missing player is "—" on screen; a
 * transport error throws (the page shows the columns as "—" and says why).
 */
export const poolValueKeys = {
  window: (leagueId: string, week: number, ids: string) => ['pool-values', leagueId, week, ids] as const,
}

export function usePoolValues(leagueId: string, week: number | undefined, playerIds: readonly string[]) {
  // A stable key: the window's ids, sorted (the window's order is ADP).
  const ids = useMemo(() => [...new Set(playerIds)].sort().join(','), [playerIds])
  const query = useQuery({
    queryKey: poolValueKeys.window(leagueId, week ?? 0, ids),
    enabled: week !== undefined && ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // projections refresh hourly; the season to date weekly
    queryFn: () =>
      sendLeagueAction<PoolValues>(`/api/leagues/${leagueId}/player-values?week=${week!}&players=${encodeURIComponent(ids)}`),
  })
  const byPlayer = useMemo(() => new Map<string, PoolPlayerValue>((query.data?.values ?? []).map((v) => [v.player_id, v])), [query.data])
  return { ...query, byPlayer }
}
