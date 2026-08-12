'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
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
 * **UPDATED AT LV.7 — one consumer, and no toggle.** This header used to name
 * two (`list-detail-view.tsx` and `draft-mode/board-column.tsx`, PROGRESS §3 Q1)
 * and to record that turning draft mode *off* cleared the marks on the way out.
 * The cutover deleted both files, so:
 *
 *   * The only consumer is now
 *     `src/components/lists/v2/list-detail-panel.tsx`, the open list. **A failed
 *     read must render as "no marks", never as a crashed page** — see
 *     `toDraftedSet` for exactly what holds that up.
 *   * **Nothing turns draft mode off any more**, because there is no draft-mode
 *     gate: the drafted checkbox is permanent (Chris, 2026-08-10; handoff
 *     §"Side by side"/§"Cards"). `clearDrafted` is reached only from the open
 *     list's explicit *Clear drafted*, which is the safer end of the reversal
 *     R190/R195/R199/R203 all orbited — the destructive path is now the only
 *     deliberate one.
 *   * Consequently **`enabled` / `setEnabled` have no consumer at all.** They
 *     are left in place rather than ripped out mid-cutover; removing them is a
 *     follow-up (PROGRESS §5 F-row), not a drive-by in a UI task.
 *
 * There is **no localStorage migration path**, on purpose: the ruling that
 * unparked this task is that no user has ever marked anyone drafted, so there
 * is nothing to migrate (Q1, consequence 3).
 *
 * The paragraphs below are kept as written because the hazards they describe
 * are still live on the one remaining path — read "the caller" as the open
 * list.
 *
 * **…but only over marks it can actually see (R190).** Moving the clear to
 * durable storage crossed it with the *other* accepted consequence — a failed
 * read renders as "no marks", silently. Together those two shipped a data-loss
 * path nobody priced: with the GET failing, the page shows zero drafted, and
 * the very next toggle-off issues an unconditional DELETE that destroys the
 * real rows on every device. Measured, not theorised: 2 marks → forced 500 on
 * the GET → one click of "Draft mode" → 0 marks. So `clearDrafted` now refuses
 * to run while the marks are unknown, and says so — see `runClearDrafted`. A
 * clear the user asked for still clears; a clear over marks nobody has seen is
 * the one thing this hook will not do.
 *
 * **"Unknown" is a property of the READ, not of the query status (R195).** The
 * first cut of that guard asked React Query whether the query was in `error` or
 * `pending`, which sounds like the same question and is not: this hook's own
 * optimistic mark calls `setQueryData`, and React Query dispatches that as a
 * *manual success* — an errored query flips to `status: 'success'`,
 * `isError: false`, `isPending: false` on the spot (measured). So one tap on a
 * player re-opened the whole R190 path, and `cancelQueries` in the same
 * `onMutate` killed the failing refetch that would have closed it again, which
 * made it a *continuous* window for as long as the user kept marking rather
 * than a race. The bit the guard actually needs can only come from the read
 * itself, so it does: `draftedQueryOptions` raises `landed`/`failed` from
 * inside the `queryFn`, and `hasRead` asks whether a landing is on record for
 * this list. No cache write can forge it.
 *
 * **Two corrections the final review made to that bit, both about its edges.**
 *
 *   * **R199 — an abort answers nothing in *either* direction.** The first cut
 *     guarded only the failure arm, on the belief that a cancelled read always
 *     rejects. It does not: an abort landing after `res.json()` has been
 *     entered on a buffered body resolves anyway (measured against a real
 *     server, 200/200 in that window), and React Query then discards the value
 *     — so the success arm could vouch for marks the cache never received, and
 *     a clear over them destroyed real rows. Both arms now check
 *     `signal.aborted`.
 *   * **R200 — the flag lives as long as the cache, not as long as the mount.**
 *     It hung off a `useRef`, but `query-provider.tsx` keeps the read fresh for
 *     60 s, so navigating away and back re-rendered the real marks with the
 *     flag reset to `false` — refusing both destructive controls with copy that
 *     contradicted the screen. It now hangs off the QueryClient
 *     (`readLandedFlagFor`), keyed per list, and is dropped when React Query
 *     removes the cache entry it vouched for.
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
 *
 * The optional `signal` is React Query's, threaded through so a cancelled read
 * really is cancelled (R195). Every mark calls `cancelQueries`; without the
 * signal the underlying request runs to completion and resolves into a promise
 * nobody is listening to any more, which would let a *discarded* read tell the
 * clear guard that the marks are known.
 *
 * **Threading it is necessary and NOT sufficient (R199).** With the signal, a
 * cancelled read *usually* rejects — measured against a real server, an abort
 * landing before `res.json()` rejected 200/200 — but an abort landing after
 * `res.json()` has been entered on an already-buffered body **resolves**
 * 200/200, which is exactly the shape `jsonOrThrow` has. So the `queryFn` does
 * not trust the rejection: it checks `signal.aborted` on *both* arms.
 *
 * Omitted → no second argument at all, i.e. still a plain GET.
 */
export async function fetchDraftedIds(listId: string, signal?: AbortSignal): Promise<string[]> {
  const body = await jsonOrThrow<DraftedReadResponse>(
    await fetch(`/api/lists/${listId}/drafted`, signal ? { signal } : undefined),
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
 * **The whole of `toggleDrafted`'s decision**, exported so it is falsifiable
 * (R191). The hook body itself is unreachable under this repo's vitest — node,
 * no jsdom — so a decision left inline is pinned by nothing: inverting it was
 * measured passing type-check, `test:unit` 715/715 and `drafted-api-db` 32/32,
 * while making it impossible to mark anybody drafted.
 *
 * Note what it is *not*: a toggle sent to the server. It reads the freshest
 * marks this tab knows about and returns the STATE the tap is asking for, which
 * is why two taps in the same tick converge (both read the same pre-mutation
 * cache, both send the same value) instead of inverting each other.
 */
export function desiredStateFor(current: readonly string[] | undefined, playerId: string): boolean {
  return !toDraftedSet(current).has(playerId)
}

/** The three bits of the drafted read that decide whether a clear may run. */
export interface DraftedReadState {
  isError: boolean
  isPending: boolean
  /**
   * **The load-bearing one (R195/R199).** A real server read has landed for
   * *this* list — the server delivered the marks AND the read was not
   * discarded by a cancellation before the cache could receive them (R199) —
   * and no later read attempt has failed, and the cache entry it vouched for
   * still exists (R200). It comes from the `queryFn` — see
   * `draftedQueryOptions` — never from the query's status, because the hook's
   * own optimistic `setQueryData` manufactures `status: 'success'` over an
   * errored read and would otherwise hand the guard a forged answer.
   */
  hasRead: boolean
}

/** Why a clear was refused. `null` = it may run. */
export type ClearRefusal = 'read-failed' | 'read-in-flight' | 'never-read'

/**
 * **R190/R195 — the whole decision, as the reason.** A clear is only honest
 * over marks that have actually been read. An errored read, a read still in
 * flight, and a cache holding nothing but this tab's own optimistic marks all
 * present as "no marks" or "these marks" on the page (see `toDraftedSet`) while
 * the account may hold rows nobody has seen — and a DELETE issued there
 * destroys them with nothing on screen to suggest it happened.
 *
 * The reason is returned rather than a bare boolean because the user is told
 * which one it was, and the three are *not* the same news (R197): a read still
 * in flight has not failed, and telling someone their marks "could not be
 * loaded" during an ordinary page load blames a failure that did not happen.
 *
 * A *background refetch* over data already read keeps `status: 'success'` and
 * leaves `hasRead` alone, so the everyday case — mark, mark, toggle off — is
 * unaffected.
 */
export function clearRefusalReason(read: DraftedReadState): ClearRefusal | null {
  if (read.isError) return 'read-failed'
  if (read.isPending) return 'read-in-flight'
  if (!read.hasRead) return 'never-read'
  return null
}

/** `clearRefusalReason` as a yes/no, for callers that do not need the copy. */
export function canClearDrafted(read: DraftedReadState): boolean {
  return clearRefusalReason(read) === null
}

/**
 * What the refusal toast says, per reason (R197). Exported so the copy is
 * pinnable: the point of branching at all is that the wrong branch tells the
 * user something untrue about their own data.
 */
export const CLEAR_REFUSAL_COPY: Record<ClearRefusal, string> = {
  'read-failed':
    'Your drafted players could not be loaded, so none were cleared. Reload the page and try again.',
  'read-in-flight':
    'Your drafted players are still loading, so none were cleared. Try again in a moment.',
  'never-read':
    'Your drafted players have not loaded on this device, so none were cleared. Reload the page and try again.',
}

/**
 * The guarded clear, whole, as a pure function of the read state and its two
 * effects — so the guard is *exercised* rather than read out of the source
 * (R190/R191). `refuse` must be loud: a clear that silently does nothing is the
 * same "nothing happened means it worked" failure in the opposite direction
 * (CLAUDE.md).
 *
 * Returns whether the clear actually ran, because the caller's *own* success
 * message is the same failure one layer up: the retired detail view's "Reset
 * list" used to toast "List reset — drafted marks cleared" unconditionally,
 * which is a lie in every refused state (R195). The open list's *Clear drafted*
 * checks this return value (LV.7).
 */
export function runClearDrafted(
  read: DraftedReadState,
  effects: { clear: () => void; refuse: (reason: ClearRefusal) => void },
): boolean {
  const refusal = clearRefusalReason(read)
  if (refusal) {
    effects.refuse(refusal)
    return false
  }
  effects.clear()
  return true
}

/**
 * What the read tells the clear guard (R195). Raised from inside the `queryFn`,
 * which is the only place in this file that knows whether the *server* answered
 * — every other signal React Query exposes can be manufactured by a cache
 * write, and `setQueryData` is exactly such a write.
 */
export interface DraftedReadSignals {
  /** A read landed: the server delivered this list's marks into this tab. */
  landed: (listId: string) => void
  /** A read attempt failed: the marks are unknown again. Aborts are not this. */
  failed: (listId: string) => void
}

/** The `hasRead` bit, the two signals that move it, and the cache's eraser. */
export interface ReadLandedFlag {
  signals: DraftedReadSignals
  hasRead: (listId: string) => boolean
  /**
   * The cache entry a landing vouched for is gone — garbage-collected after
   * `gcTime` with no observers, `removeQueries`d, or wiped by `clear()` — so
   * the landing goes with it (R200). Not a failure: nothing went wrong, the
   * marks are simply unknown again.
   */
  forget: (listId: string) => void
}

/**
 * **`hasRead`, whole (R195).** Exported and closed over a plain variable rather
 * than left in the hook body, for R191's reason: a decision the hook body makes
 * is pinned by nothing this repo can run.
 *
 * **Keyed by list id, one entry per list (R200).** The first cut held a single
 * slot — *the* list the last landed read was for — which is stricter than the
 * property actually needed and cost more than it bought: `list A → list B →
 * back to A` inside `staleTime` re-rendered A's real marks off the cache while
 * A's landing had been evicted by B's, i.e. R200's own symptom via a second
 * route. A per-list set cannot leak a landing across lists either — `hasRead(B)`
 * is false until B's own read lands — and it keeps A's when B arrives.
 */
export function createReadLandedFlag(): ReadLandedFlag {
  const landed = new Set<string>()
  // "The marks for this list are unknown again." Only that list is affected;
  // a list with no entry is already `false` by the lookup below.
  const drop = (listId: string) => {
    landed.delete(listId)
  }
  return {
    signals: {
      landed: (listId) => {
        landed.add(listId)
      },
      failed: drop,
    },
    hasRead: (listId) => landed.has(listId),
    forget: drop,
  }
}

/** This key's list id, or `null` if the key is not a drafted key at all. */
export function listIdFromDraftedKey(queryKey: readonly unknown[]): string | null {
  const [scope, kind, listId] = queryKey
  if (scope !== draftedKeys.all[0] || kind !== draftedKeys.all[1]) return null
  return typeof listId === 'string' ? listId : null
}

/**
 * One flag per **QueryClient**, not per mount — **R200**.
 *
 * The flag guards a clear over *the cache*, so it has to live exactly as long
 * as the cache does. A `useRef` lives as long as one **mount**, and those two
 * lifetimes are not the same: `query-provider.tsx` sets `staleTime: 60_000`, so
 * navigating away and back inside a minute re-renders the real marks off the
 * cache with **no refetch** — and a per-mount flag came back `false`, refusing
 * both destructive controls with copy ("have not loaded on this device") that
 * contradicts the marks on screen. That is the exact class R197 was filed to
 * eliminate. A remount must inherit the landing that the cache inherited.
 *
 * **The hazard a longer-lived flag introduces is a flag that never resets, and
 * every route out of `true` is covered:**
 *
 *   * **list switch** — the flag is keyed by list id, so a landing for one list
 *     is never a permission for another;
 *   * **read failure** — `signals.failed` drops that list's entry, so a
 *     genuinely failed refetch closes it again (R195's rule, unchanged);
 *   * **cancellation** — a discarded read never opens it at all (R199);
 *   * **the cache going away** — the subscription below. When React Query
 *     removes the query (gc after `gcTime` with no observers, `removeQueries`,
 *     or `clear()` — the wipe a future sign-out reset would perform), the
 *     landing is dropped with it. Without this, a cache gc'd while the user was
 *     elsewhere would leave `hasRead` true over an empty cache, and an
 *     optimistic mark on the way back would forge the status to `success` and
 *     permit a clear over marks nobody had read — R195, again.
 *
 * Keyed by a `WeakMap`, so the flag is unreachable the moment its client is,
 * and so an SSR render — where each request builds its own `QueryClient` in
 * `QueryProvider` — cannot share one tab's landings with another request's.
 * The subscription is deliberately never torn down: it is scoped to the client,
 * not to a component, and there is no mount whose unmount should end it.
 */
const flagsByClient = new WeakMap<QueryClient, ReadLandedFlag>()

export function readLandedFlagFor(client: QueryClient): ReadLandedFlag {
  const existing = flagsByClient.get(client)
  if (existing) return existing

  const flag = createReadLandedFlag()
  flagsByClient.set(client, flag)
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return
    const listId = listIdFromDraftedKey(event.query.queryKey)
    if (listId !== null) flag.forget(listId)
  })
  return flag
}

/**
 * The read's query options, exported so the failure path can be *exercised*
 * rather than asserted — the suite drives these through a real `QueryObserver`
 * with a failing `fetch` and shows the result is an error carrying no data.
 */
export function draftedQueryOptions(listId: string, signals?: DraftedReadSignals) {
  return {
    queryKey: draftedKeys.list(listId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        const ids = await fetchDraftedIds(listId, signal)
        // **Symmetric with the catch arm — R199 is the finding that made it
        // so.** An abort usually makes the request *reject*, but not reliably:
        // once `jsonOrThrow` has entered `res.json()` on a body that is
        // already buffered, the parse runs to completion and the read resolves
        // *after* the abort that discarded it (measured against a real server:
        // in that window, 200/200 resolved). React Query throws that resolved
        // value away — the cache never receives these ids — so raising
        // `landed` here would vouch for marks this tab was never shown, which
        // is R190/R195's data loss reached by a different route. An abort
        // answers nothing about the marks, in EITHER direction.
        if (!signal.aborted) signals?.landed(listId)
        return ids
      } catch (error) {
        // The same rule on the failure side: an abort is this tab cancelling
        // its own read — every mark's `onMutate` calls `cancelQueries` — not
        // an answer about the marks. Measured: React Query aborts the signal
        // it hands the `queryFn`, so a cancelled read carries
        // `signal.aborted === true` here, while a real fault never does.
        if (!signal.aborted) signals?.failed(listId)
        throw error
      }
    },
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

  /**
   * **Whether a real read has delivered these marks (R195/R200).** Not state —
   * nothing renders off it, and re-rendering on it would be a lie about what
   * changed. And not a `useRef` either: a ref lives for one mount, while the
   * marks it vouches for live in the cache for `staleTime`/`gcTime` past it, so
   * a remount within the minute rendered real marks under a `false` flag. It
   * hangs off the QueryClient instead — see `readLandedFlagFor`, which also
   * owns every route back to `false`.
   */
  const readLanded = readLandedFlagFor(qc)

  const marks = useQuery(draftedQueryOptions(listId, readLanded.signals))

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
      // computed against the freshest marks this tab knows about. The decision
      // itself lives in `desiredStateFor`, where the suite can falsify it.
      const current = qc.getQueryData<string[]>(draftedKeys.list(listId))
      setMarkMutate({ playerId, drafted: desiredStateFor(current, playerId) })
    },
    [qc, listId, setMarkMutate],
  )

  const refuseClear = useCallback(
    (reason: ClearRefusal) => {
      toast({
        title: 'Nothing was cleared',
        description: CLEAR_REFUSAL_COPY[reason],
        variant: 'destructive',
      })
    },
    [toast],
  )

  // R190/R195: the clear is durable now, so it refuses to run unless a real
  // read has delivered this list's marks. The status bits alone would not do —
  // one optimistic mark rewrites them into `success` (see the header).
  const clearDrafted = useCallback(() => {
    return runClearDrafted(
      {
        isError: marks.isError,
        isPending: marks.isPending,
        hasRead: readLanded.hasRead(listId),
      },
      { clear: clearMarksMutate, refuse: refuseClear },
    )
  }, [marks.isError, marks.isPending, readLanded, listId, clearMarksMutate, refuseClear])

  return {
    enabled,
    setEnabled,
    drafted,
    toggleDrafted,
    clearDrafted,
  }
}
