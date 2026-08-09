'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '@/hooks/use-toast'

/**
 * Draft mode for one list — **LV.1.3** (delivery-plan-lists-v2.md §2.1, design
 * decision **D2**).
 *
 * **What changed, and what deliberately did not.** The drafted marks used to
 * live in `localStorage`, under a per-list key of their own. They now live in
 * the account, behind LV.1.2's `/api/lists/[id]/drafted` over migration 079's
 * `list_player_drafted` — because a list that forgets who is already gone the
 * moment you pick up your phone is useless on draft night (D2). Plan §2.1 is
 * explicit that this hook's *semantics* were already right: per user, per list.
 * **Only the storage moved.** The returned shape is unchanged, because both
 * consumers are closed to edits.
 *
 * **`enabled` is still localStorage, and that is not an oversight.** D2 buys
 * exactly one table, for the marks. The draft-mode toggle is a transient view
 * state of one browser tab — it has no server representation, and giving it one
 * would be a third schema change, which plan §3 **D6** forbids outright.
 *
 * **Two consumers, both closed (PROGRESS §3 Q1, ruled by Chris 2026-08-09).**
 *
 *   * `src/components/lists/list-detail-view.tsx:286` — the flag-OFF legacy
 *     detail view, which serves production. It now makes network calls where it
 *     read localStorage. **A failed read must render as "no marks", never as a
 *     crashed page** — see `toDraftedSet` for exactly what holds that up.
 *   * `src/components/lists/draft-mode/board-column.tsx:35` — inside the
 *     off-limits `draft-mode/**` tree. It gains account-persisted marks through
 *     this hook without a single byte of its own changing. Accepted, recorded,
 *     not a bug.
 *
 * There is **no localStorage migration path**, on purpose: the ruling that
 * unparked this task is that no user has ever marked anyone drafted, so there
 * is nothing to migrate (Q1, consequence 3).
 *
 * **Turning draft mode off still clears the marks** (`list-detail-view.tsx:659`
 * calls `clearDrafted` on the way out). That was true before this task too — it
 * wiped localStorage. It now wipes rows. Same gesture, same outcome, durable
 * storage: plan §2.1's "nothing about its behavior changes; only where it
 * stores", applied to the clear as well as to the mark.
 */

/** Draft mode's on/off toggle — a view state of one tab, never server state. */
const DRAFT_MODE_KEY = (listId: string) => `fieldscout.draft-mode.${listId}`

export const draftedKeys = {
  all: ['lists', 'drafted'] as const,
  list: (listId: string) => ['lists', 'drafted', listId] as const,
}

interface DraftedReadResponse {
  list_id: string
  drafted: string[]
}

export interface SetDraftedResponse {
  list_id: string
  player_id: string
  drafted: boolean
  /** False = the mark was already in the requested state (a replay, not a write). */
  changed: boolean
}

export interface ClearDraftedResponse {
  list_id: string
  cleared: number
}

/**
 * Mirrors `use-lists.ts`'s `jsonOrThrow`: a non-OK response becomes a thrown
 * `Error` carrying `status`, never a plausible-looking empty result. Every
 * "nothing came back" answer in this file has to prove its reason (CLAUDE.md).
 */
async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(body.error ?? `Request failed with ${res.status}`) as Error & {
      status: number
    }
    error.status = res.status
    throw error
  }
  return (await res.json()) as T
}

/**
 * GET my marks on this list. Exported so the wire contract is unit-pinnable
 * without a DOM — the suite stubs `fetch` and asserts the method and the URL.
 */
export async function fetchDraftedIds(listId: string): Promise<string[]> {
  const body = await jsonOrThrow<DraftedReadResponse>(
    await fetch(`/api/lists/${listId}/drafted`),
  )
  // A 200 whose body carries no id array is a broken server, not an empty list.
  if (!Array.isArray(body.drafted)) {
    throw new Error('Drafted read succeeded but carried no player ids')
  }
  return body.drafted
}

/**
 * POST one player's **desired state** — never a blind toggle. LV.1.2's wire
 * contract exists because an optimistic checkbox retries, and a toggle applied
 * twice lands on the opposite answer with nothing to notice it.
 */
export async function postDrafted(
  listId: string,
  playerId: string,
  drafted: boolean,
): Promise<SetDraftedResponse> {
  return jsonOrThrow<SetDraftedResponse>(
    await fetch(`/api/lists/${listId}/drafted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player_id: playerId, drafted }),
    }),
  )
}

/** DELETE every mark I hold on this list — D2's "Clear drafted". */
export async function deleteDrafted(listId: string): Promise<ClearDraftedResponse> {
  return jsonOrThrow<ClearDraftedResponse>(
    await fetch(`/api/lists/${listId}/drafted`, { method: 'DELETE' }),
  )
}

/**
 * **Q1 consequence 2 passes through here.** A read that failed, or has not
 * landed yet, is `undefined`, and must become an empty `Set` so the page
 * renders "nobody is drafted" rather than crashing. This is the ONLY place the
 * hook converts the query's data, so it is the only place that can dereference
 * it — which is the point: `ids.length ? … : []`, `ids.map(…)` or any other
 * touch of `ids` before the fallback is a `TypeError` inside render, i.e. a
 * crashed page for the legacy view that serves production today.
 *
 * Measured, not assumed: `new Set(undefined)` is itself harmless — the spec
 * skips iteration for `undefined`/`null` — so the `?? []` alone is NOT what
 * stands between a failed read and a white screen. What stands there is (a)
 * nothing in this file dereferencing the query's data, and (b) no
 * `throwOnError` and no suspense, at this query or at the app-wide client,
 * either of which would hand the error to an error boundary instead. All three
 * are pinned in the suite, each shown reddening under its own break.
 */
export function toDraftedSet(ids: readonly string[] | undefined): Set<string> {
  return new Set(ids ?? [])
}

/** The optimistic reducer — deduping and order-insensitive, like the Set it feeds. */
export function nextDraftedIds(
  current: readonly string[] | undefined,
  playerId: string,
  drafted: boolean,
): string[] {
  const next = new Set(current ?? [])
  if (drafted) next.add(playerId)
  else next.delete(playerId)
  return Array.from(next)
}

/**
 * The read's query options, exported so the failure path can be *exercised*
 * rather than asserted — the suite drives these through a real `QueryObserver`
 * with a failing `fetch` and shows the result is an error carrying no data.
 */
export function draftedQueryOptions(listId: string) {
  return {
    queryKey: draftedKeys.list(listId),
    queryFn: () => fetchDraftedIds(listId),
    enabled: Boolean(listId),
    /**
     * A 4xx is an answer, not a hiccup: retrying a 401 or a 404 only delays
     * the empty render. Server faults get exactly one retry, matching the
     * app-wide default in `query-provider.tsx`.
     */
    retry: (failureCount: number, error: Error) => {
      const status = (error as Error & { status?: number }).status
      if (typeof status === 'number' && status < 500) return false
      return failureCount < 1
    },
  }
}

export function useDraftMode(listId: string) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setEnabled(window.localStorage.getItem(DRAFT_MODE_KEY(listId)) === '1')
    } catch {
      // A blocked localStorage means draft mode starts off. It is a toggle.
    }
    setHydrated(true)
  }, [listId])

  useEffect(() => {
    if (!hydrated) return
    try {
      if (enabled) window.localStorage.setItem(DRAFT_MODE_KEY(listId), '1')
      else window.localStorage.removeItem(DRAFT_MODE_KEY(listId))
    } catch {
      // ignore
    }
  }, [enabled, hydrated, listId])

  const key = useMemo(() => draftedKeys.list(listId), [listId])
  const marks = useQuery(draftedQueryOptions(listId))

  // The query's data is undefined while loading AND when the read failed. Both
  // render as "no marks" — see `toDraftedSet`. The memo keeps the Set
  // referentially stable, because consumers pass it straight into children.
  const drafted = useMemo(() => toDraftedSet(marks.data), [marks.data])

  const rollback = useCallback(
    (previous: string[] | undefined) => {
      if (previous === undefined) qc.removeQueries({ queryKey: key, exact: true })
      else qc.setQueryData<string[]>(key, previous)
    },
    [qc, key],
  )

  const failed = useCallback(
    (error: Error) => {
      // A mark that silently un-sticks is exactly "nothing happened means it
      // worked". Say so out loud (CLAUDE.md).
      toast({
        title: 'Could not update drafted',
        description: error.message,
        variant: 'destructive',
      })
    },
    [toast],
  )

  const setMark = useMutation({
    mutationFn: ({ playerId, drafted: next }: { playerId: string; drafted: boolean }) =>
      postDrafted(listId, playerId, next),
    onMutate: async ({ playerId, drafted: next }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<string[]>(key)
      qc.setQueryData<string[]>(key, nextDraftedIds(previous, playerId, next))
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      failed(error)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
    },
  })

  const clearMarks = useMutation({
    mutationFn: () => deleteDrafted(listId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<string[]>(key)
      qc.setQueryData<string[]>(key, [])
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      failed(error)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
    },
  })

  const setMarkMutate = setMark.mutate
  const clearMarksMutate = clearMarks.mutate

  const toggleDrafted = useCallback(
    (playerId: string) => {
      // Read the cache, not a render-time closure, so the desired state is
      // computed against the freshest marks this tab knows about. Two taps in
      // the SAME tick both read the pre-mutation cache and therefore send the
      // same desired state twice — a no-op, not an inversion, which is
      // precisely why LV.1.2's wire takes a state rather than a toggle.
      const current = qc.getQueryData<string[]>(draftedKeys.list(listId))
      setMarkMutate({ playerId, drafted: !toDraftedSet(current).has(playerId) })
    },
    [qc, listId, setMarkMutate],
  )

  const clearDrafted = useCallback(() => {
    clearMarksMutate()
  }, [clearMarksMutate])

  return {
    enabled,
    setEnabled,
    drafted,
    toggleDrafted,
    clearDrafted,
  }
}
