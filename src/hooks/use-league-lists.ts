'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueListWithList } from '@/lib/leagues/api/league-lists-service'
import { createBrowserClient } from '@/lib/supabase/client'

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
  myLists: (userId: string) => ['league-lists', 'my-lists', userId] as const,
  listPlayers: (listId: string) => ['league-lists', 'list-players', listId] as const,
  listAttachments: (listId: string) => ['league-lists', 'attachments-of', listId] as const,
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

/**
 * POST /api/leagues/[id]/lists with the league chosen AT MUTATE TIME — the
 * list-side attach modal's shape (§7.4 "Attach to league" from a list: the
 * caller picks the league inside the flow, so the league id is a variable,
 * not a hook argument). Same route, same invalidation as `useAttachList`;
 * kept separate so league-context callers keep the simpler signature.
 */
export function useAttachListAnyLeague() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ leagueId, ...vars }: AttachListVars & { leagueId: string }) =>
      sendLeagueAction<LeagueListWithList>(
        `/api/leagues/${leagueId}/lists`,
        jsonInit('POST', vars),
      ),
    // onSettled (R129): a replayed attach's 409 must still refetch.
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: leagueListsKeys.all(vars.leagueId) })
      void queryClient.invalidateQueries({
        queryKey: leagueListsKeys.listAttachments(vars.list_id),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// L.B4.2 reads (D92: RLS-scoped direct SELECTs — no new API surface)
// ---------------------------------------------------------------------------

/** The list metadata the attach picker + My Lists panel need (§7.4/§8.9). */
export interface MyDraftList {
  id: string
  title: string
  position_filter: string | null
  player_count: number | null
  is_private: boolean | null
  is_big_board: boolean | null
  scoring_system_id: string | null
  updated_at: string | null
}

/**
 * My own (non-deleted) lists, Big Board included — the attach modal's
 * league-side picker and the panel's Big Board row both read this one
 * query. RLS scopes to the owner; ordering is client-meaningful
 * (`attachCandidates` re-sorts), so updated_at desc is just a stable wire
 * order.
 */
export function useMyDraftLists(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: leagueListsKeys.myLists(userId ?? 'none'),
    enabled: enabled && Boolean(userId),
    queryFn: async (): Promise<MyDraftList[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('lists')
        .select(
          'id, title, position_filter, player_count, is_private, is_big_board, scoring_system_id, updated_at',
        )
        .eq('owner_id', userId!)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as MyDraftList[]
    },
  })
}

/** One list's `(player_id, position, tier)` rows — the cheat sheet and the
 *  pool overlay read the SAME ordering the from-list route loads and 068's
 *  autopick resolves in: `list_players.position, player_id` (D113(5) — one
 *  ordering, every consumer). Readable for shared-private lists via 067's
 *  additive policy. */
export interface DraftListPlayerRow {
  player_id: string
  position: number
  tier: string | null
  /** `list_players.notes` (001:239) — the draft-prep note a user wrote
   *  against this player on this list. Read since M3 task L.C3.1 so the
   *  room's cheat sheet can RENDER it (spec §16.2 `my-lists-panel`:
   *  "cheat sheet (incl. per-player notes — v2.10)"); the ruled use case is
   *  cost prep ("$8 max"), which is exactly what an auction manager brings
   *  to draft night. Nullable and usually null — rows without a note render
   *  no notes affordance at all (L.C3.1 item 7: no empty chrome). */
  notes: string | null
}

export function useLeagueListPlayers(listId: string | undefined) {
  return useQuery({
    queryKey: leagueListsKeys.listPlayers(listId ?? 'none'),
    enabled: Boolean(listId),
    queryFn: async (): Promise<DraftListPlayerRow[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('list_players')
        .select('player_id, position, tier, notes')
        .eq('list_id', listId!)
        .order('position', { ascending: true })
        .order('player_id', { ascending: true })
      if (error) throw error
      return (data ?? []) as DraftListPlayerRow[]
    },
  })
}

/**
 * MY attachments of one list across every league (the list-side modal's
 * "already attached" flags). The 067 SELECT policy's owner arm
 * (`owner_id = auth.uid()`) has no league scope, so this cross-league read
 * returns exactly the caller's own rows.
 */
export function useListAttachments(
  listId: string | undefined,
  userId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: leagueListsKeys.listAttachments(listId ?? 'none'),
    enabled: enabled && Boolean(listId) && Boolean(userId),
    queryFn: async (): Promise<Array<{ id: string; league_id: string }>> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('league_lists')
        .select('id, league_id')
        .eq('list_id', listId!)
        // RLS also shows OTHER members' shared rows of this list; "already
        // attached" is about MY attachment (the natural key is per-owner).
        .eq('owner_id', userId!)
      if (error) throw error
      return (data ?? []) as Array<{ id: string; league_id: string }>
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
