import { useQuery } from '@tanstack/react-query'

import { adminFetch, adminKeys } from '@/lib/admin/admin-api'
import type { OpLeagueDetail } from '@/lib/admin/league-table'

/** GET /api/admin/leagues/[id]/detail — members + full settings (193 `op_league_detail`). */
export function useAdminLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: adminKeys.leagueDetail(leagueId),
    queryFn: () => adminFetch<OpLeagueDetail>(`/api/admin/leagues/${leagueId}/detail`),
  })
}
