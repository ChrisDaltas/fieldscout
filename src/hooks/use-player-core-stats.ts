'use client'

import { useQuery } from '@tanstack/react-query'

import type { CoreStatsPayload } from '@/lib/players/core-stats-ops'

/** The player page's core-stats row (D486(10)) — `/api/players/[id]/core-stats`,
 *  scored under `leagueId`'s rules when given, else the default template. */
export function usePlayerCoreStats(playerId: string, leagueId: string | null) {
  return useQuery({
    queryKey: ['player-core-stats', playerId, leagueId ?? ''],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CoreStatsPayload> => {
      const qs = leagueId ? `?league=${encodeURIComponent(leagueId)}` : ''
      const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/core-stats${qs}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `core stats failed (${res.status})`)
      return body as CoreStatsPayload
    },
  })
}
