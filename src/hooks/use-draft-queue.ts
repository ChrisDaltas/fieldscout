'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonInit, rateLimitRetryMs, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { LatestValueSender, newPacer, type Pacer } from '@/lib/rate-limit/latest-value-sender'
import { createBrowserClient } from '@/lib/supabase/client'

import { draftVerbPath, queueFromListPath } from './use-draft-action-path'
import { mergeQueueIntents, rebaseQueueOrder, type QueueIntent } from './use-draft-queue-ops'
import { toast } from './use-toast'

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
 * ONE WRITE LANE PER QUEUE (route, draft, team) — shared by every caller of
 * `useUpdateDraftQueue` and `useQueueFromList` for that queue, so Adds,
 * reorders and list loads land in click order (L.F2.6 R1685 / R1691 — D707,
 * D709). The PACING is per SCOPE — the league (or the practice draft) the
 * middleware counts by — so every queue a member writes in one league shares
 * the 1.25 s gap and his total stays at most 8 per 10 s (R1694).
 *
 * `confirmed` is the server's last answer for this queue. A value is sent as
 * the click's change replayed on it (`rebaseQueueOrder`), so an Add clicked
 * while a list load was still in the lane does not undo the load.
 */
interface QueueLane {
  sender: LatestValueSender<QueueIntent, QueueResponse>
  confirmed: string[] | null
}

const queueLanes = new Map<string, QueueLane>()
/** Each click's own array → the order it saw (set in onMutate, read in mutationFn). */
const clickBases = new WeakMap<string[], string[]>()
const scopePacers = new Map<string, Pacer>()

function idsOf(rows: readonly DraftQueueRow[]): string[] {
  return rows.map((r) => r.player_id)
}

function queueLane(leagueId: string | null, draftId: string, teamId: string, forAnotherTeam: boolean): QueueLane {
  const path = draftVerbPath(leagueId, draftId, 'queue')
  const key = `${path}|${draftId}|${teamId}|${forAnotherTeam ? 'commish' : 'own'}`
  const existing = queueLanes.get(key)
  if (existing) return existing
  const scope = leagueId ?? draftId
  let pacer = scopePacers.get(scope)
  if (!pacer) {
    pacer = newPacer()
    scopePacers.set(scope, pacer)
  }
  const lane: QueueLane = {
    confirmed: null,
    sender: new LatestValueSender<QueueIntent, QueueResponse>({
      post: async (intent) => {
        const response = await sendLeagueAction<QueueResponse>(
          path,
          jsonInit('POST', {
            draft_id: draftId,
            players: rebaseQueueOrder(intent, lane.confirmed),
            ...(forAnotherTeam ? { team_id: teamId } : {}),
          }),
        )
        if (Array.isArray(response?.queue)) lane.confirmed = idsOf(response.queue)
        return response
      },
      merge: mergeQueueIntents,
      retryAfterMs: rateLimitRetryMs,
      pacer,
      now: () => systemTime.now().getTime(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
    }),
  }
  queueLanes.set(key, lane)
  return lane
}

/** The plain words when a queue change finally fails (R1692). */
function toastQueueFailure(error: unknown) {
  toast({
    title: 'Your queue wasn’t saved',
    description:
      error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.',
    variant: 'destructive',
  })
}

/**
 * POST /api/leagues/[id]/draft/queue — replace/reorder my queue. Optimistic
 * (§15.6): the new order renders immediately; the server row set (RLS +
 * the 065 policy + the service's player validation) stays the truth.
 *
 * COALESCED (§22.5, L.F2.6 R1685 — D707): a burst of Adds / reorders sends
 * only the LATEST order, one write in flight, writes at least 1.25 s apart
 * per league — at most 8 of the 10-per-10-s allowance, never his pick's
 * share. A 429 is re-sent after `Retry-After`, never dropped. Each `mutate`
 * settles with the write that carried its order (or a later one). The cache
 * is re-read only once the lane is idle, so a refetch never paints an older
 * order over a newer optimistic one. A change that finally FAILS says so — a
 * toast in plain words (R1692) — and the re-read shows the server's order;
 * nothing is undone silently.
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
  const lane = queueLane(leagueId, draftId, teamId, forAnotherTeam)
  return useMutation({
    // onMutate runs first (TanStack v5): it records the order this click SAW
    // — the (optimistic) cache before it is overwritten — for mutationFn.
    mutationFn: (players: string[]) =>
      lane.sender.offer({ base: clickBases.get(players) ?? [...players], next: players }),
    onMutate: async (players) => {
      await queryClient.cancelQueries({ queryKey })
      clickBases.set(players, idsOf(queryClient.getQueryData<DraftQueueRow[]>(queryKey) ?? []))
      queryClient.setQueryData<DraftQueueRow[]>(
        queryKey,
        players.map((playerId, index) => ({ player_id: playerId, rank: index + 1 })),
      )
    },
    onError: (error) => toastQueueFailure(error),
    onSettled: () => {
      if (lane.sender.busy) return
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
 *
 * In the queue's ONE write lane (R1691 — D709): it waits for every Add /
 * reorder clicked before it and every one clicked after waits for it, so the
 * three land in click order; it is paced and 429-retried with them, and the
 * cache is re-read only once the lane is idle.
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
  const lane = queueLane(leagueId, draftId, teamId, forAnotherTeam)
  return useMutation({
    mutationFn: ({ listId, mode }: QueueFromListVars) =>
      lane.sender.run(async () => {
        const response = await sendLeagueAction<QueueResponse & { added: number; skipped_drafted: number }>(
          queueFromListPath(leagueId, draftId, listId),
          jsonInit('POST', {
            draft_id: draftId,
            ...(mode ? { mode } : {}),
            ...(forAnotherTeam ? { team_id: teamId } : {}),
          }),
        )
        if (Array.isArray(response?.queue)) lane.confirmed = idsOf(response.queue)
        return response
      }),
    onSettled: () => {
      if (lane.sender.busy) return
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
