'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'

import { leaguesKeys } from './use-leagues'

/**
 * A structured PATCH failure the settings panel can branch on: `status` picks
 * the 403 (not commissioner) / 404 / 409 (structural lock past scheduled) /
 * 400 (validation) treatments, and `fieldErrors` (when present) map the
 * contract's per-field messages to their inputs. Anything else is `message`.
 */
export class LeaguePatchError extends Error {
  status: number
  fieldErrors?: Record<string, string[]>
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'LeaguePatchError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/** GET /api/leagues/[id] response shape (§15.1 detail — L.A1.12). */
export interface LeagueDetail {
  league: {
    id: string
    name: string
    avatar_url: string | null
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

/** Body for a settings/scoring PATCH (§15.1; L.A1.13 wire shape). The panel
 *  sends the FULL reconciled settings (cross-field re-clamps span groups, so a
 *  whole-object save keeps the merged result internally consistent — a full
 *  object merges to itself, D71) plus `scoring_system_id` only when it changed. */
export interface UpdateLeagueSettingsBody {
  settings?: LeagueSettings
  scoring_system_id?: string
}

/**
 * Update a league's settings / scoring template (PATCH /api/leagues/[id] —
 * commish only; the route calls `update_league_settings` per Q8/v2.8.2 via
 * `patchLeague`). On failure it throws a `LeaguePatchError` carrying the
 * status + any per-field messages so the settings panel (L.A2.4) can render
 * the 403 / 409-lock / per-field states from §16.5.4. Success invalidates the
 * detail query so the panel reloads the persisted baseline (round-trip).
 */
export function useUpdateLeagueSettings(leagueId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: UpdateLeagueSettingsBody) => {
      const response = await fetch(`/api/leagues/${leagueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!response.ok) {
        const error = parsed?.error
        // The contract's per-field 400s arrive as { error: { fieldErrors } }.
        const fieldErrors =
          error && typeof error === 'object' && 'fieldErrors' in error
            ? ((error as { fieldErrors: Record<string, string[]> }).fieldErrors)
            : undefined
        const message =
          typeof error === 'string'
            ? error
            : fieldErrors
              ? 'Some settings need attention.'
              : 'Failed to save settings.'
        throw new LeaguePatchError(response.status, message, fieldErrors)
      }
      return parsed as { ok: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
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

/**
 * League profile — rename + avatar (PATCH/POST/DELETE /api/leagues/[id]/
 * profile; migration 064's update_league_profile RPC, commissioner-only).
 * Cosmetic writes, allowed in every league status (unlike the §7.1
 * structural lock). Success invalidates both the detail and the leagues
 * list, so the sidebar tile and every crest refresh together.
 */
export function useLeagueProfile(leagueId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
  }

  const throwOnError = async (response: Response) => {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    if (!response.ok) {
      throw new Error(
        typeof body?.error === 'string' ? body.error : 'Failed to update the league profile',
      )
    }
    return body
  }

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'POST',
        body: form,
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  const removeAvatar = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}/profile`, {
        method: 'DELETE',
      })
      return throwOnError(response)
    },
    onSuccess: invalidate,
  })

  return { rename, uploadAvatar, removeAvatar }
}
