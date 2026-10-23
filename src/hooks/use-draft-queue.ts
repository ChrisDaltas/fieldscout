'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, rateLimitRetryMs, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { LatestValueSender } from '@/lib/rate-limit/latest-value-sender'
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
 * immediately, and is re-read from the server once the writes settle (a
 * failure's rollback is that re-read). Sends are coalesced (L.F2.6, below).
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

/**
 * The queue for this (draft, team), rank-ordered. My own seat: own rows only
 * (RLS). `asCommish` (F524) — a team the commissioner acts for: the table is
 * that seat's own (178), so the read goes through the queue route's GET
 * (`draft_queue_for_team`) and a refusal or an unpushed door is an ERROR,
 * never an empty queue.
 */
export function useDraftQueue(
  draftId: string | undefined,
  teamId: string | undefined,
  options: { asCommish?: { leagueId: string } } = {},
) {
  const asCommish = options.asCommish
  return useQuery({
    queryKey: draftQueueKeys.queue(draftId ?? 'none', teamId ?? 'none'),
    enabled: Boolean(draftId) && Boolean(teamId),
    retry: asCommish ? false : undefined,
    queryFn: async (): Promise<DraftQueueRow[]> => {
      if (asCommish) {
        const search = new URLSearchParams({ draft_id: draftId!, team_id: teamId! })
        const body = await sendLeagueAction<QueueResponse>(
          `${draftVerbPath(asCommish.leagueId, draftId!, 'queue')}?${search.toString()}`,
        )
        return body.queue
      }
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
 * One sender per (route, draft, team): every caller of `useUpdateDraftQueue`
 * for the same queue shares it, so two components queueing at once still
 * coalesce (L.F2.6 R1685 — D707).
 */
const queueSenders = new Map<string, LatestValueSender<string[], QueueResponse>>()

function queueSender(path: string, draftId: string, teamId: string, forAnotherTeam: boolean) {
  const key = `${path}|${draftId}|${teamId}|${forAnotherTeam ? 'commish' : 'own'}`
  let sender = queueSenders.get(key)
  if (!sender) {
    sender = new LatestValueSender<string[], QueueResponse>({
      post: (players) =>
        sendLeagueAction<QueueResponse>(
          path,
          jsonInit('POST', {
            draft_id: draftId,
            players,
            ...(forAnotherTeam ? { team_id: teamId } : {}),
          }),
        ),
      retryAfterMs: rateLimitRetryMs,
      now: () => systemTime.now().getTime(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
    })
    queueSenders.set(key, sender)
  }
  return sender
}

/**
 * POST /api/leagues/[id]/draft/queue — replace/reorder my queue. Optimistic
 * (§15.6): the new order renders immediately; the server row set (RLS +
 * the 065 policy + the service's player validation) stays the truth.
 *
 * COALESCED (§22.5, L.F2.6 R1685 — D707): the queue is a whole-list replace,
 * so a burst of Adds / reorders sends only the LATEST order, one write in
 * flight, writes at least 1.25 s apart — a fast queue builder spends at most
 * 8 of the 10-per-10-s allowance and never his own pick's. A 429 is re-sent
 * after `Retry-After`, never dropped. Each `mutate` settles with the write
 * that carried its order (or a later one). The cache is re-read only once
 * the sender is idle, so a refetch never paints an older order over a newer
 * optimistic one; a real failure re-reads the server's order (the rollback).
 */
export function useUpdateDraftQueue(
  leagueId: string | null,
  draftId: string,
  teamId: string,
  /** F524: true when the commissioner sets another team's Targets — the
   *  body names the team (the route admits it for a commissioner only). */
  forAnotherTeam = false,
) {
  const queryClient = useQueryClient()
  const queryKey = draftQueueKeys.queue(draftId, teamId)
  const sender = queueSender(draftVerbPath(leagueId, draftId, 'queue'), draftId, teamId, forAnotherTeam)
  return useMutation({
    mutationFn: (players: string[]) => sender.offer(players),
    onMutate: async (players) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<DraftQueueRow[]>(
        queryKey,
        players.map((playerId, index) => ({ player_id: playerId, rank: index + 1 })),
      )
    },
    onSettled: () => {
      if (sender.busy) return
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
export function useQueueFromList(
  leagueId: string | null,
  draftId: string,
  teamId: string,
  /** F524: as `useUpdateDraftQueue`'s. */
  forAnotherTeam = false,
) {
  const queryClient = useQueryClient()
  const queryKey = draftQueueKeys.queue(draftId, teamId)
  return useMutation({
    mutationFn: ({ listId, mode }: QueueFromListVars) =>
      sendLeagueAction<QueueResponse & { added: number; skipped_drafted: number }>(
        queueFromListPath(leagueId, draftId, listId),
        jsonInit('POST', {
          draft_id: draftId,
          ...(mode ? { mode } : {}),
          ...(forAnotherTeam ? { team_id: teamId } : {}),
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
