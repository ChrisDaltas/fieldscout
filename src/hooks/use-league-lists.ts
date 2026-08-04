'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueListWithList } from '@/lib/leagues/api/league-lists-service'

/**
 * League-list attachments for the list ↔ league tie-in (M2 task L.B4.1;
 * spec §7.4, §15.5, §15.6). Consumed by L.B4.2's attach modal + the draft
 * room's My Lists panel.
 *
 * READ (`useLeagueLists`): the §15.5 GET route — one implementation of the
 * mine-plus-league-shared join (RLS scopes rows; the route embeds the list
 * metadata, readable for shared-private lists via 067's additive policy).
 *
 * WRITE: attach / patch (set primary, toggle shared) / detach over the
 * §15.5 routes. Set-primary is OPTIMISTIC per §15.6's "optimistic updates
 * for queue reorder"-class interactions (an attachment flag, not a pick —
 * picks/bids are never optimistic): the cache flips at-most-one-primary
 * immediately, rolls back on error, and always refetches on settle.
 */

export const leagueListsKeys = {
  all: (leagueId: string) => ['league-lists', leagueId] as const,
}

interface LeagueListsResponse {
  league_lists: LeagueListWithList[]
}

/** My attached lists + league-shared ones (§15.5 GET). */
export function useLeagueLists(leagueId: string, enabled = true) {
  return useQuery({
    queryKey: leagueListsKeys.all(leagueId),
    enabled: enabled && Boolean(leagueId),
    queryFn: async (): Promise<LeagueListWithList[]> => {
      const body = await sendLeagueAction<LeagueListsResponse>(
        `/api/leagues/${leagueId}/lists`,
      )
      return body.league_lists ?? []
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations (all over the §15.5 routes)
// ---------------------------------------------------------------------------

export interface AttachListVars {
  list_id: string
  is_primary_board?: boolean
  shared_with_league?: boolean
}

/** POST /api/leagues/[id]/lists — attach one of my lists. */
export function useAttachList(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: AttachListVars) =>
      sendLeagueAction<LeagueListWithList>(
        `/api/leagues/${leagueId}/lists`,
        jsonInit('POST', vars),
      ),
    // onSettled, not onSuccess (R129): a replayed attach's 409 must still
    // refetch so the cache converges on the server truth.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leagueListsKeys.all(leagueId) })
    },
  })
}

export interface PatchLeagueListVars {
  leagueListId: string
  is_primary_board?: boolean
  shared_with_league?: boolean
}

/**
 * PATCH /api/leagues/[id]/lists/[llid] — set primary board / toggle shared.
 * Optimistic for the set-primary flip (§15.6): the caller's rows flip to
 * at-most-one-primary in the cache immediately; the server's clear-first +
 * `uniq_primary_board_per_member` remain the truth (rollback on error,
 * refetch on settle).
 */
export function useUpdateLeagueList(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ leagueListId, ...patch }: PatchLeagueListVars) =>
      sendLeagueAction<LeagueListWithList>(
        `/api/leagues/${leagueId}/lists/${leagueListId}`,
        jsonInit('PATCH', patch),
      ),
    onMutate: async (vars) => {
      const queryKey = leagueListsKeys.all(leagueId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<LeagueListWithList[]>(queryKey)
      if (previous) {
        // Only the row's OWNER can PATCH it, so the target's owner_id IS the
        // caller — scope the demote to their rows (a fellow member's shared
        // attachment may be primary FOR THEM and must not flip).
        const callerId = previous.find((row) => row.id === vars.leagueListId)?.owner_id
        queryClient.setQueryData<LeagueListWithList[]>(
          queryKey,
          previous.map((row) => {
            if (row.id === vars.leagueListId) {
              return {
                ...row,
                ...(vars.is_primary_board !== undefined
                  ? { is_primary_board: vars.is_primary_board }
                  : {}),
                ...(vars.shared_with_league !== undefined
                  ? { shared_with_league: vars.shared_with_league }
                  : {}),
              }
            }
            // Promoting one attachment demotes the caller's others (the
            // server clear-first mirrored).
            if (
              vars.is_primary_board === true &&
              row.is_primary_board &&
              row.owner_id === callerId
            ) {
              return { ...row, is_primary_board: false }
            }
            return row
          }),
        )
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(leagueListsKeys.all(leagueId), context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leagueListsKeys.all(leagueId) })
    },
  })
}

/** DELETE /api/leagues/[id]/lists/[llid] — detach (non-destructive, §7.4). */
export function useDetachList(leagueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (leagueListId: string) =>
      sendLeagueAction<{ detached: boolean; id: string }>(
        `/api/leagues/${leagueId}/lists/${leagueListId}`,
        jsonInit('DELETE'),
      ),
    // onSettled, not onSuccess (R129): a replayed detach's 404 means the row
    // is already gone server-side — refetch so the stale row stops rendering.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leagueListsKeys.all(leagueId) })
    },
  })
}
