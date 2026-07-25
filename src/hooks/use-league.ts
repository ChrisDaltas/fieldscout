'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

import { leaguesKeys } from './use-leagues'

/** GET /api/leagues/[id] response shape (§15.1 detail — L.A1.12). */
export interface LeagueDetail {
  league: {
    id: string
    name: string
    description: string | null
    season: number
    status: string
    owner_id: string
    scoring_system_id: string | null
    invite_code: string | null
    invite_slug: string | null
    max_teams: number
    created_at: string | null
    updated_at: string | null
  }
  settings: LeagueSettings
  members: Array<{
    id: string
    user_id: string | null
    team_id: string | null
    role: string
    is_placeholder: boolean | null
    is_autodraft: boolean | null
    joined_at: string | null
    profiles: { username: string; display_name: string | null; avatar_url: string | null } | null
  }>
  teams: Array<{
    id: string
    name: string
    owner_id: string
    status: string
    created_at: string | null
  }>
  my_role: string | null
}

/** League detail (GET /api/leagues/[id]) — M1 task L.A1.12. */
export function useLeague(leagueId: string | undefined) {
  return useQuery({
    queryKey: leaguesKeys.detail(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await fetch(`/api/leagues/${leagueId}`)
      const body = (await response.json().catch(() => null)) as
        | LeagueDetail
        | { error?: unknown }
        | null
      if (!response.ok) {
        const error = body && 'error' in body ? body.error : undefined
        throw new Error(typeof error === 'string' ? error : 'Failed to load league')
      }
      return body as LeagueDetail
    },
  })
}

/**
 * Soft-delete a league (DELETE /api/leagues/[id] — commish only; the route
 * calls the `soft_delete_league` RPC per Q8/v2.8.2). Retry-safe: the RPC is
 * an idempotent no-op on an already-deleted league.
 */
export function useDeleteLeague() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (leagueId: string) => {
      const response = await fetch(`/api/leagues/${leagueId}`, { method: 'DELETE' })
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Failed to delete league',
        )
      }
      return { leagueId }
    },
    onSuccess: ({ leagueId }) => {
      queryClient.removeQueries({ queryKey: leaguesKeys.detail(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    },
  })
}
