import { useQuery } from '@tanstack/react-query'

import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

export interface AdminLeagueHit {
  id: string
  name: string
  season: number
  status: string
}

export interface AdminLeagueSearch {
  leagues: AdminLeagueHit[]
  more: boolean
  limit: number
}

/** GET /api/admin/leagues?q= — leagues the operator can see, by name. */
export function useAdminLeagueSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: adminKeys.leagueSearch(q),
    queryFn: () => adminFetch<AdminLeagueSearch>(`/api/admin/leagues?q=${encodeURIComponent(q)}`),
    enabled,
  })
}
