'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { PendingInviteInput } from '@/components/leagues/invite-panel-ops'
import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'

import { leaguesKeys } from './use-leagues'

/**
 * League-invite reads + mutations for the invite panel (M1 task L.A2.5).
 *
 * READ (`useLeagueInvites`): a direct `league_invites` SELECT over the §12.23
 * "Invites viewable by commish" RLS policy — the canonical CLAUDE.md hook
 * pattern (the `useLists` example; L.A2.3's `use-scoring-templates` reads
 * `scoring_systems` the same way). No new API route is added: the commissioner
 * SELECT is the only read surface, RLS is the gate (a non-commissioner gets
 * zero rows — no existence leak), and `invited_email` is returned ONLY here,
 * to the commissioner, on the invite row. The panel's render authority
 * (`invite-panel-ops`) is what keeps that email off claimed seats.
 *
 * WRITE: every invite mutation goes through the existing L.A1.14 routes /
 * services (create/revoke/rotate/slug) — no RPC is reimplemented. Success
 * invalidates the invites query AND the league detail (rotate changes
 * `leagues.invite_code`; a slug change changes `invite_slug`).
 */

export const leagueInvitesKeys = {
  all: (leagueId: string) => ['league-invites', leagueId] as const,
}

/** Commissioner-visible pending/consumed invites for a league (RLS-gated). */
export function useLeagueInvites(leagueId: string, enabled = true) {
  return useQuery({
    queryKey: leagueInvitesKeys.all(leagueId),
    enabled: enabled && Boolean(leagueId),
    queryFn: async (): Promise<PendingInviteInput[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_invites')
        .select(
          'id, target_team_id, invited_email, invited_username, token, max_uses, use_count, expires_at, revoked_at, created_at',
        )
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PendingInviteInput[]
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations (all over the L.A1.14 routes)
// ---------------------------------------------------------------------------

/** Shared success handler: refetch invites + the league detail. */
function useInvalidateInvites(leagueId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: leagueInvitesKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
  }
}

export interface CreateInviteVars {
  target_team_id?: string
  invited_email?: string
  invited_username?: string
  max_uses?: number
}

export interface CreateInviteResult {
  invite_id: string
  token: string
  expires_at: string
  resent: boolean
  email_sent: boolean
}

/** POST /api/leagues/[id]/invites — seat-targeted (email/username) or link. */
export function useCreateInvite(leagueId: string) {
  const invalidate = useInvalidateInvites(leagueId)
  return useMutation({
    mutationFn: (vars: CreateInviteVars) =>
      sendLeagueAction<CreateInviteResult>(`/api/leagues/${leagueId}/invites`, jsonInit('POST', vars)),
    onSuccess: invalidate,
  })
}

/** DELETE /api/leagues/[id]/invites/[iid] — revoke a pending invite. */
export function useRevokeInvite(leagueId: string) {
  const invalidate = useInvalidateInvites(leagueId)
  return useMutation({
    mutationFn: (inviteId: string) =>
      sendLeagueAction(`/api/leagues/${leagueId}/invites/${inviteId}`, jsonInit('DELETE')),
    onSuccess: invalidate,
  })
}

/** POST /api/leagues/[id]/invite — rotate the share code (§22.5, destructive). */
export function useRotateInviteCode(leagueId: string) {
  const invalidate = useInvalidateInvites(leagueId)
  return useMutation({
    mutationFn: () =>
      sendLeagueAction<{ invite_code: string }>(`/api/leagues/${leagueId}/invite`, jsonInit('POST')),
    onSuccess: invalidate,
  })
}

/** PATCH /api/leagues/[id]/slug — set (string) or clear (null) the slug. */
export function useSetInviteSlug(leagueId: string) {
  const invalidate = useInvalidateInvites(leagueId)
  return useMutation({
    mutationFn: (invite_slug: string | null) =>
      sendLeagueAction<{ invite_slug: string | null }>(
        `/api/leagues/${leagueId}/slug`,
        jsonInit('PATCH', { invite_slug }),
      ),
    onSuccess: invalidate,
  })
}
