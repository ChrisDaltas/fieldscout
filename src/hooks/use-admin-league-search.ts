import { useQuery } from '@tanstack/react-query'

import { adminFetch, adminKeys } from '@/lib/admin/admin-api'
import { leagueTableUrl, type OpLeagueList } from '@/lib/admin/league-table'

export const LEAGUE_SEARCH_LIMIT = 25

/**
 * The finder over GET /api/admin/leagues (193 `op_list_leagues`) — EVERY
 * league by name or commissioner, A–Z, the first 25 with the true total
 * (F599: no longer only the operator's own leagues).
 */
export function useAdminLeagueSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: adminKeys.leagueSearch(q),
    queryFn: () =>
      adminFetch<OpLeagueList>(
        leagueTableUrl({ q, sort: 'name', dir: 'asc', offset: 0, limit: LEAGUE_SEARCH_LIMIT, deleted: false }),
      ),
    enabled,
  })
}
