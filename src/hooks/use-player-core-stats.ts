'use client'

import { useQuery } from '@tanstack/react-query'

import { choiceValue, coreStatsQuery, type CoreStatsPayload, type ScoringChoice } from '@/lib/players/core-stats-ops'

/** The player page's core-stats row (D486(10)/(11)) — `/api/players/[id]/core-stats`,
 *  scored under the chosen preset system or league; the key moves with the choice. */
export function usePlayerCoreStats(playerId: string, choice: ScoringChoice) {
  return useQuery({
    queryKey: ['player-core-stats', playerId, choiceValue(choice)],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CoreStatsPayload> => {
      const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/core-stats${coreStatsQuery(choice)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `core stats failed (${res.status})`)
      return body as CoreStatsPayload
    },
  })
}
