import { useQuery } from '@tanstack/react-query'

import type { OpLeagueState } from '@/components/admin/admin-console-ops'
import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

/** GET /api/admin/leagues/[id]/state — one league's live state (186 `op_league_state`). */
export function useAdminLeagueState(leagueId: string) {
  return useQuery({
    queryKey: adminKeys.league(leagueId),
    queryFn: () => adminFetch<OpLeagueState>(`/api/admin/leagues/${leagueId}/state`),
    refetchInterval: 60_000,
  })
}
