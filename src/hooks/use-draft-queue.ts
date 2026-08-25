'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'

import { draftVerbPath, queueFromListPath } from './use-draft-action-path'

/**
 * My draft queue — M2 task L.B2.2 (spec §8.4, §8.9, §15.2, §15.5, §15.6;
 * tasks-M2 D92).
 *
 * READ: RLS-scoped direct SELECT (D92 — `draft_queues` is own-rows-only
 * under the 065 policy, so the query returns exactly the caller's queue;
 * queues are NEVER broadcast, §9.2 — reorder freshness is the caller's own
 * mutations, not the room channel).
 *
 * WRITE: the §15.2 queue route with OPTIMISTIC reorder (§15.6 — queue
 * reorder is in the optimistic set; picks never are). The mutation posts
 * the FULL ordered list (replace semantics), the cache flips to that order
 * immediately, rolls back on error, and refetches on settle.
 */

export const draftQueueKeys = {
  queue: (draftId: string, teamId: string) => ['draft-queue', draftId, teamId] as const,
}

export interface DraftQueueRow {
  player_id: string
  rank: number
}

interface QueueResponse {
  draft_id: string
  team_id: string
  queue: DraftQueueRow[]
}

/** My queue for this (draft, seat), rank-ordered (own rows only — RLS). */
export function useDraftQueue(draftId: string | undefined, teamId: string | undefined) {
  return useQuery({
    queryKey: draftQueueKeys.queue(draftId ?? 'none', teamId ?? 'none'),
    enabled: Boolean(draftId) && Boolean(teamId),
    queryFn: async (): Promise<DraftQueueRow[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('draft_queues')
        .select('player_id, rank')
        .eq('draft_id', draftId!)
        .eq('team_id', teamId!)
        .order('rank', { ascending: true })
      if (error) throw error
      return (data ?? []) as DraftQueueRow[]
    },
  })
}

/**
 * POST /api/leagues/[id]/draft/queue — replace/reorder my queue. Optimistic
 * (§15.6): the new order renders immediately; the server row set (RLS +
 * the 065 policy + the service's player validation) stays the truth.
 */
export function useUpdateDraftQueue(leagueId: string | null, draftId: string, teamId: string) {
  const queryClient = useQueryClient()
  const queryKey = draftQueueKeys.queue(draftId, teamId)
  return useMutation({
    mutationFn: (players: string[]) =>
      sendLeagueAction<QueueResponse>(
        draftVerbPath(leagueId, draftId, 'queue'),
        jsonInit('POST', { draft_id: draftId, players }),
      ),
    onMutate: async (players) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<DraftQueueRow[]>(queryKey)
      queryClient.setQueryData<DraftQueueRow[]>(
        queryKey,
        players.map((playerId, index) => ({ player_id: playerId, rank: index + 1 })),
      )
      return { previous }
    },
    onError: (_error, _players, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}

export interface QueueFromListVars {
  listId: string
  mode?: 'replace' | 'append'
}

/**
 * POST /api/leagues/[id]/draft/queue/from-list/[listId] — §8.9 load-into-
 * queue (replace) / "Add remaining" (append). NOT optimistic: the server
 * computes the skip-drafted result — the settle refetch renders it.
 */
export function useQueueFromList(leagueId: string | null, draftId: string, teamId: string) {
  const queryClient = useQueryClient()
  const queryKey = draftQueueKeys.queue(draftId, teamId)
  return useMutation({
    mutationFn: ({ listId, mode }: QueueFromListVars) =>
      sendLeagueAction<QueueResponse & { added: number; skipped_drafted: number }>(
        queueFromListPath(leagueId, draftId, listId),
        jsonInit('POST', { draft_id: draftId, ...(mode ? { mode } : {}) }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
