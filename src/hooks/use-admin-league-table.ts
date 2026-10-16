import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { adminFetch, adminKeys } from '@/lib/admin/admin-api'
import { leagueTableUrl, type LeagueTableQuery, type OpLeagueList } from '@/lib/admin/league-table'

/** GET /api/admin/leagues — one page of EVERY league (193 `op_list_leagues`). */
export function useAdminLeagueTable(query: LeagueTableQuery) {
  const url = leagueTableUrl(query)
  return useQuery({
    queryKey: adminKeys.leagueTable(url),
    queryFn: () => adminFetch<OpLeagueList>(url),
    placeholderData: keepPreviousData,
  })
}
