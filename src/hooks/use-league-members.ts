'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'

import { leagueInvitesKeys } from './use-league-invites'
import { leaguesKeys } from './use-leagues'

/**
 * Member-management mutations for the invite panel (M1 task L.A2.5) — all over
 * the existing L.A1.15 routes / `members-service`, no RPC reimplemented:
 *   - add placeholder seat   POST   /api/leagues/[id]/members
 *   - set role               PATCH  /api/leagues/[id]/members/[mid]
 *   - assign manager         POST   /api/leagues/[id]/teams/[tid]/assign-manager
 *   - remove manager         DELETE /api/leagues/[id]/members/[mid]  (mode body)
 *   - leave league           DELETE /api/leagues/[id]/members/[mid]  (self, no body)
 *
 * The removal route dispatches on whose membership `[mid]` is (D74(8)): the
 * caller's own → `leave_league`; anyone else's → `remove_manager(mode)`. So
 * "leave" and "remove" share one hook with a body-vs-no-body branch.
 *
 * Every success invalidates the league detail (members/teams change) and the
 * invites query (an assign/claim can consume a seat's pending invite).
 */

export type RemoveMode = 'takeover' | 'vacate' | 'retire'

function useInvalidateMembers(leagueId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    void queryClient.invalidateQueries({ queryKey: leagueInvitesKeys.all(leagueId) })
  }
}

/** `add_placeholder_seat`'s return (063:467-473). `seats_filled`/`team_count`
 *  are the league's own postcondition — the only authoritative answer to
 *  "is this league seated yet" — and a bulk fill MUST report from them rather
 *  than from a client-side iteration count (R958). */
export interface PlaceholderSeatResult {
  member_id: string
  team_id: string
  team_name: string
  seats_filled: number
  team_count: number
}

/** POST /api/leagues/[id]/members — create an empty placeholder seat (§7.2). */
export function useAddPlaceholderSeat(leagueId: string) {
  const invalidate = useInvalidateMembers(leagueId)
  return useMutation({
    mutationFn: (teamName?: string) =>
      sendLeagueAction<PlaceholderSeatResult>(
        `/api/leagues/${leagueId}/members`,
        jsonInit('POST', teamName ? { team_name: teamName } : {}),
      ),
    onSuccess: invalidate,
  })
}

export type MemberRole = 'commissioner' | 'co_commissioner' | 'manager'

/** PATCH /api/leagues/[id]/members/[mid] — role change (incl. the atomic
 *  commissioner transfer when `role === 'commissioner'`, §7.2/D74(4)). */
export function useSetMemberRole(leagueId: string) {
  const invalidate = useInvalidateMembers(leagueId)
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: MemberRole }) =>
      sendLeagueAction(`/api/leagues/${leagueId}/members/${memberId}`, jsonInit('PATCH', { role })),
    onSuccess: invalidate,
  })
}

/** POST /api/leagues/[id]/teams/[tid]/assign-manager — seat an existing user. */
export function useAssignManager(leagueId: string) {
  const invalidate = useInvalidateMembers(leagueId)
  return useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      sendLeagueAction(
        `/api/leagues/${leagueId}/teams/${teamId}/assign-manager`,
        jsonInit('POST', { user_id: userId }),
      ),
    onSuccess: invalidate,
  })
}

/** DELETE /api/leagues/[id]/members/[mid] — remove a manager via the D42
 *  chooser (takeover needs a successor; vacate → placeholder). */
export function useRemoveManager(leagueId: string) {
  const invalidate = useInvalidateMembers(leagueId)
  return useMutation({
    mutationFn: ({
      memberId,
      mode,
      successorUserId,
      reason,
    }: {
      memberId: string
      mode: RemoveMode
      successorUserId?: string
      reason?: string
    }) =>
      sendLeagueAction(
        `/api/leagues/${leagueId}/members/${memberId}`,
        jsonInit('DELETE', {
          mode,
          ...(successorUserId ? { successor_user_id: successorUserId } : {}),
          ...(reason ? { reason } : {}),
        }),
      ),
    onSuccess: invalidate,
  })
}

/** DELETE /api/leagues/[id]/members/[mid] on your OWN row — leave the league
 *  (a sitting commissioner must transfer the role first, D74(8)). No body. */
export function useLeaveLeague(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) =>
      sendLeagueAction(`/api/leagues/${leagueId}/members/${memberId}`, jsonInit('DELETE')),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: leaguesKeys.detail(leagueId) })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
    },
  })
}
