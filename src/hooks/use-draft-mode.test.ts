/**
 * use-draft-mode.test.ts — **LV.1.3** (delivery-plan-lists-v2.md §2.1, **D2**;
 * PROGRESS-lists-v2 §3 **Q1**).
 *
 * The task moves one thing: drafted marks stop living in `localStorage` and
 * start living in the account, over LV.1.2's `/api/lists/[id]/drafted`. Three
 * properties have to hold, and none of them is visible in a diff:
 *
 *   1. **The marks really do come from the server.** The read is a GET to that
 *      route, the write is a POST carrying an explicit desired STATE (never a
 *      toggle — see LV.1.2's contract), the clear is a DELETE, and the old
 *      `fieldscout.drafted.${listId}` key is *gone*, not shadowed. Q1's third
 *      consequence forbids a migration path outright: there are no users, so
 *      there is nothing to migrate.
 *   2. **Q1 consequence 2 — a failed read renders as "no marks", never as a
 *      crashed page.** The flag-OFF legacy detail view
 *      (`list-detail-view.tsx:286`) serves production today and now makes
 *      network calls where it read localStorage. That path is *exercised* here
 *      through a real `QueryObserver` over a real failing `fetch`, not
 *      asserted: the observer must land in `error` with **no data**, and the
 *      hook's own derivation must turn that into an empty `Set`.
 *   3. **A failed write is loud.** A non-OK response throws so React Query
 *      rolls the optimistic mark back and toasts; it must never resolve to a
 *      plausible-looking empty result (CLAUDE.md).
 *   4. **The clear refuses to run over marks nobody has read (R190).**
 *      Consequence 2 and the durable clear intersect: with the GET failing the
 *      page shows zero drafted, and the toggle-off gesture then DELETEs the
 *      real rows. Two marks were destroyed this way in a live reproduction.
 *      `runClearDrafted` is that guard, and it is driven here off a **real**
 *      failed read's state, not a hand-written literal.
 *   5. **…and that guard cannot be forged by a cache write (R195).** The first
 *      cut asked the query's *status*, which the hook's own optimistic
 *      `setQueryData` rewrites to `success` — re-opening the whole path for as
 *      long as the user keeps marking. The bit now comes from the `queryFn`
 *      itself (`createReadLandedFlag`), and the pin drives a real
 *      `QueryClient`: a failed read, then the hook's own `onMutate` verbatim,
 *      and the clear still refuses. Both counter-controls are here too — a
 *      healthy read clears, and a healthy read *plus* a mark clears — because a
 *      guard that refuses everything would satisfy the finding and break the
 *      feature.
 *   6. **…and an ABORTED read cannot forge it either (R199).** The success arm
 *      of the `queryFn` did not check `signal.aborted` while the catch arm did,
 *      so a read resolving after `cancelQueries` discarded it vouched for marks
 *      the cache never received. `lateFetch` reproduces the exact production
 *      window — a response that ignores the abort, as `res.json()` does on an
 *      already-buffered body — and its counter-control proves the same rig
 *      *does* open the flag when nothing cancels it.
 *   7. **The flag lives as long as the CACHE, not as long as the mount (R200).**
 *      `staleTime: 60_000` means a remount inside a minute re-renders the real
 *      marks with no refetch, and a `useRef` flag came back `false` there —
 *      refusing both destructive controls with copy that contradicted the
 *      screen. It hangs off the QueryClient now, and every route back to
 *      `false` is pinned: list switch, read failure, cancellation, and the
 *      cache entry being removed (gc / `removeQueries` / `clear()`).
 *
 * No DOM: this repo's vitest runs on node with no jsdom, so the hook body
 * itself is out of reach. What that costs is stated rather than papered over —
 * the *return shape* the two closed consumers destructure
 * (`list-detail-view.tsx`, `draft-mode/board-column.tsx`, neither editable) is
 * pinned by `npm run type-check`, which fails if a key is renamed or retyped.
 * **Shape is not behavior (R191):** inverting `toggleDrafted`'s desired state,
 * and separately making `clearDrafted` a no-op, were each measured passing the
 * whole gate while breaking the feature outright. The answer is that both
 * decisions are now *exported pure functions* — pinned behaviourally below —
 * and the hook body's job is reduced to wiring, which is pinned as source with
 * a slicer that reads the callback body itself rather than the whole file.
 * The same source-pin idiom covers the two facts that have no runtime surface
 * at all (no suspense, no `throwOnError` — either would route a failed read to
 * an error boundary and crash the very page consequence 2 protects).
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLEAR_REFUSAL_COPY,
  canClearDrafted,
  clearRefusalReason,
  createReadLandedFlag,
  deleteDrafted,
  desiredStateFor,
  draftedKeys,
  draftedQueryOptions,
  fetchDraftedIds,
  listIdFromDraftedKey,
  nextDraftedIds,
  postDrafted,
  readLandedFlagFor,
  runClearDrafted,
  toDraftedSet,
} from './use-draft-mode'

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/**
 * Source with comments stripped. A source pin has to read the **code**, not the
 * prose about it — otherwise a header that merely *names* the thing it declines
 * to do reddens the pin, and the obvious "fix" is to weaken the pin. (Found the
 * hard way: documenting why this file forbids `throwOnError` tripped the pin
 * that forbids it.)
 */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK_FILE = 'src/hooks/use-draft-mode.ts'
const VIEW_FILE = 'src/components/lists/list-detail-view.tsx'
const LIST_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_LIST_ID = '33333333-3333-4333-8333-333333333333'

/**
 * The body of one `useCallback` in the hook, sliced by paren balance from the
 * comment-stripped source. Whole-file source pins have a miss window a mile
 * wide — a fact asserted about "the file" survives being deleted from the
 * callback that needed it, as long as the same text lives anywhere else (R172,
 * on the LV.1.1 pins, is that exact failure). This throws rather than returning
 * `''` if the callback is gone, so a rename fails loudly instead of turning
 * every pin below it vacuous.
 *
 * **Known limitation (R196), stated so the next author does not trust it too
 * far:** the balance scan is not string- or regex-literal aware, so a callback
 * body containing an unbalanced `(` or `)` *inside a string* — `'a :-)'`,
 * `/\(/` — slices short or long. It is a text scanner, not a parser. Today
 * neither callback here holds such a literal, and the failure is loud rather
 * than silent (the slice stops early, the `toContain` pins redden, and the
 * control test below catches a slice that has swallowed the wrong region). If a
 * callback ever needs a paren-bearing string, parse it or move the decision out
 * of the body — do not widen this.
 */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`)
  if (start === -1) throw new Error(`no \`${name}\` useCallback in ${HOOK_FILE}`)
  let depth = 0
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced \`${name}\` useCallback in ${HOOK_FILE}`)
}

/**
 * The same idea for a plain `const x = () => { … }`, sliced by **brace**
 * balance — used for `handleReset` in the legacy detail view (R195's second
 * half). It carries `callbackBody`'s limitation in the brace dialect: a `{` or
 * `}` inside a string or a regex literal would mis-slice. `handleReset` holds
 * one template-free string with no braces, and the control test asserts the
 * slice is a real one.
 */
function arrowBody(source: string, declaration: string, file: string): string {
  const start = source.indexOf(declaration)
  if (start === -1) throw new Error(`no \`${declaration}\` in ${file}`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced \`${declaration}\` in ${file}`)
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Every call gets a FRESH Response — a body can only be read once. */
function respondWith(make: () => Response) {
  const fetchMock = vi.fn<FetchLike>(async () => make())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the wire — marks come from the server, not localStorage', () => {
  it('reads with a GET to the LV.1.2 route and returns the ids verbatim', async () => {
    const fetchMock = respondWith(() =>
      jsonResponse(200, { list_id: LIST_ID, drafted: ['p1', 'p2'] }),
    )

    await expect(fetchDraftedIds(LIST_ID)).resolves.toEqual(['p1', 'p2'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/lists/${LIST_ID}/drafted`)
    // No second argument at all = a GET.
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
  })

  it('threads a cancellation signal when given one, and is still a GET (R195)', async () => {
    // React Query's signal has to reach the request, or `cancelQueries` — which
    // every mark calls — leaves a live request that resolves into a promise
    // nobody is listening to. A discarded read must not be able to tell the
    // clear guard that the marks are known.
    const fetchMock = respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: [] }))
    const controller = new AbortController()

    await fetchDraftedIds(LIST_ID, controller.signal)

    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal).toBe(controller.signal)
    expect(init?.method).toBeUndefined() // no method = still a GET
    expect(init?.body).toBeUndefined()
  })

  it('writes an explicit desired STATE, in both directions — never a toggle', async () => {
    // The pin that defends D2's retry-safety from the hook side, mirroring
    // `drafted-service.test.ts`'s pin on the schema. A body carrying only a
    // player id is a toggle, and a toggle replayed lands on the wrong answer.
    for (const drafted of [true, false]) {
      const fetchMock = respondWith(() =>
        jsonResponse(200, {
          list_id: LIST_ID,
          player_id: 'p1',
          drafted,
          changed: true,
        }),
      )

      await postDrafted(LIST_ID, 'p1', drafted)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`/api/lists/${LIST_ID}/drafted`)
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ player_id: 'p1', drafted })
      vi.unstubAllGlobals()
    }
  })

  it('clears with a DELETE and reports the honest row count', async () => {
    const fetchMock = respondWith(() => jsonResponse(200, { list_id: LIST_ID, cleared: 3 }))

    await expect(deleteDrafted(LIST_ID)).resolves.toEqual({ list_id: LIST_ID, cleared: 3 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/lists/${LIST_ID}/drafted`)
    expect(init?.method).toBe('DELETE')
  })

  it('has no localStorage marks left to migrate from (Q1 consequence 3)', () => {
    const source = code(HOOK_FILE)
    // The old key, and the parse that fed it, are GONE — not shadowed by a
    // server read that a later edit could reorder back into relevance.
    expect(source).not.toContain('fieldscout.drafted.')
    expect(source).not.toContain('DRAFTED_KEY')
    // ...while the draft-mode TOGGLE deliberately stays local: D2 buys one
    // table, for the marks, and a second would be the third schema change
    // plan §3 D6 forbids.
    expect(source).toContain('fieldscout.draft-mode.')
  })

  it('the comment stripper keeps code and drops prose (control for the pins above)', () => {
    // Without this, a stripper that ate everything would make every source pin
    // below pass vacuously.
    const stripped = code(HOOK_FILE)
    expect(stripped).toContain('export function useDraftMode')
    expect(stripped).toContain("'@tanstack/react-query'")
    expect(stripped).not.toContain('Q1 consequence 2 passes through here')
  })
})

describe('a failed read is loud at the wire and quiet on the page', () => {
  it('throws on a non-OK response rather than resolving to no marks', async () => {
    respondWith(() => jsonResponse(500, { error: 'boom' }))
    await expect(fetchDraftedIds(LIST_ID)).rejects.toThrow('boom')
  })

  it('throws on a 200 whose body carries no id array', async () => {
    // "Nothing happened" must never mean "it worked" (CLAUDE.md): a malformed
    // 200 is a broken server, not an empty list.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID }))
    await expect(fetchDraftedIds(LIST_ID)).rejects.toThrow(/no player ids/)
  })

  it('a 401 is not retried; a 500 is retried exactly once', async () => {
    const options = draftedQueryOptions(LIST_ID)
    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 })
    const serverFault = Object.assign(new Error('boom'), { status: 500 })

    expect(options.retry(0, unauthorized)).toBe(false)
    expect(options.retry(0, serverFault)).toBe(true)
    expect(options.retry(1, serverFault)).toBe(false)
  })
})

/**
 * **Q1 consequence 2, exercised.** A real `QueryObserver` over the real
 * exported query options, driven by a real failing `fetch` — the same objects
 * `useDraftMode` hands to `useQuery`. What a component would receive is
 * `data === undefined`, and `toDraftedSet` is the single function standing
 * between that and a `TypeError` inside render.
 */
describe('Q1 consequence 2 — a failed drafted read renders as "no marks"', () => {
  let client: QueryClient
  let flag: ReturnType<typeof createReadLandedFlag>

  beforeEach(() => {
    client = new QueryClient()
    flag = createReadLandedFlag()
  })

  afterEach(() => {
    client.clear()
  })

  /** Drives the REAL query options, with the REAL read signals wired in. */
  async function observeUntilSettled(status: 'error' | 'success') {
    const observer = new QueryObserver(client, draftedQueryOptions(LIST_ID, flag.signals))
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe(status), {
        timeout: 4000,
        interval: 10,
      })
      return observer.getCurrentResult()
    } finally {
      unsubscribe()
    }
  }

  /** Exactly what the hook hands the guard, off a real read. */
  const readState = (result: { isError: boolean; isPending: boolean }) => ({
    isError: result.isError,
    isPending: result.isPending,
    hasRead: flag.hasRead(LIST_ID),
  })

  it('an unauthenticated read leaves an error with NO data, and an empty Set', async () => {
    respondWith(() => jsonResponse(401, { error: 'Unauthorized' }))

    const result = await observeUntilSettled('error')

    expect(result.status).toBe('error')
    expect(result.data).toBeUndefined()
    // The derivation the hook performs. This is the assertion that would have
    // been a thrown `TypeError` — i.e. a crashed production page — if the
    // fallback in `toDraftedSet` were ever removed.
    expect(toDraftedSet(result.data).size).toBe(0)
    expect(() => toDraftedSet(result.data)).not.toThrow()
  })

  it('a 500 read, after its one retry, does the same', async () => {
    respondWith(() => jsonResponse(500, { error: 'boom' }))

    const result = await observeUntilSettled('error')

    expect(result.status).toBe('error')
    expect(result.data).toBeUndefined()
    expect(toDraftedSet(result.data).size).toBe(0)
  })

  it('a network failure (no response at all) does the same', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const result = await observeUntilSettled('error')

    expect(result.status).toBe('error')
    expect(result.data).toBeUndefined()
    expect(toDraftedSet(result.data).size).toBe(0)
  })

  it('R190 — and the durable clear refuses to run in that state', async () => {
    // The intersection that shipped a data-loss path: the page above renders
    // "nobody is drafted", and the toggle-off gesture used to DELETE the real
    // rows over that empty picture. The read state here is taken from a REAL
    // failed read, so the guard is pinned against the thing it will actually
    // be handed rather than against a literal someone wrote to match it.
    respondWith(() => jsonResponse(500, { error: 'boom' }))
    const result = await observeUntilSettled('error')

    const clear = vi.fn()
    const refuse = vi.fn()
    runClearDrafted(readState(result), { clear, refuse })

    expect(toDraftedSet(result.data).size).toBe(0) // the page says "no marks"…
    expect(clear).not.toHaveBeenCalled() // …and nothing is destroyed over it
    expect(refuse).toHaveBeenCalledTimes(1) // …and the user is told
    expect(refuse).toHaveBeenCalledWith('read-failed') // …the truth, specifically
    // The read never landed either — the failure is visible in BOTH bits, which
    // is what R195 turns on: only one of them survives an optimistic mark.
    expect(flag.hasRead(LIST_ID)).toBe(false)
  })

  it('R190 counter-control — after a successful read the clear still runs', async () => {
    // Without this the guard could refuse everything and look correct, which
    // would break §4 decision 2 (turning draft mode off clears the marks).
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const result = await observeUntilSettled('success')

    expect(flag.hasRead(LIST_ID)).toBe(true) // the read really landed
    const clear = vi.fn()
    const refuse = vi.fn()
    expect(runClearDrafted(readState(result), { clear, refuse })).toBe(true)

    expect(clear).toHaveBeenCalledTimes(1)
    expect(refuse).not.toHaveBeenCalled()
  })

  it('the counter-control: a successful read really does produce marks', async () => {
    // Without this, every assertion above would pass against a hook that never
    // reads anything at all.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))

    const result = await observeUntilSettled('success')

    expect(result.data).toEqual(['p1'])
    expect(toDraftedSet(result.data).has('p1')).toBe(true)
  })

  it('nothing routes a failed read to an error boundary', () => {
    // The observer above proves the query degrades. These two pin the only
    // configuration that could still crash the page instead of rendering it:
    // suspense, or `throwOnError`, at the hook or at the app-wide client.
    const hook = code(HOOK_FILE)
    expect(hook).not.toContain('useSuspenseQuery')
    expect(hook).not.toContain('throwOnError')

    const provider = code('src/components/providers/query-provider.tsx')
    expect(provider).not.toContain('throwOnError')
    expect(provider).not.toContain('suspense')
  })
})

/**
 * **R195 — the hole R190's first fix left open, and the reason `hasRead` is not
 * a status bit.** The guard used to ask React Query whether the query was in
 * `error` or `pending`. But this hook's own optimistic mark calls
 * `setQueryData`, which React Query dispatches as a **manual success**: an
 * errored query flips to `status: 'success'`, `isError: false`,
 * `isPending: false` on the spot. So one tap on a player re-opened the entire
 * R190 data-loss path — and because the same `onMutate` calls `cancelQueries`,
 * killing the failing refetch that would have closed the window again, a
 * marking session held it open continuously rather than for a moment.
 *
 * Every test below drives the **real** `draftedQueryOptions` through a **real**
 * `QueryClient`, and performs the hook's own `onMutate` verbatim
 * (`cancelQueries` → `setQueryData(nextDraftedIds(...))`). Nothing here is a
 * hand-written read state.
 */
describe('R195 — an optimistic mark cannot forge "these marks are known"', () => {
  let client: QueryClient
  let flag: ReturnType<typeof createReadLandedFlag>

  beforeEach(() => {
    client = new QueryClient()
    flag = createReadLandedFlag()
  })

  afterEach(() => {
    client.clear()
  })

  const key = draftedKeys.list(LIST_ID)

  function observe() {
    const observer = new QueryObserver(client, draftedQueryOptions(LIST_ID, flag.signals))
    const unsubscribe = observer.subscribe(() => {})
    return { observer, unsubscribe }
  }

  const settle = (observer: { getCurrentResult: () => { status: string } }, status: string) =>
    vi.waitFor(() => expect(observer.getCurrentResult().status).toBe(status), {
      timeout: 4000,
      interval: 10,
    })

  const state = (result: { isError: boolean; isPending: boolean }) => ({
    isError: result.isError,
    isPending: result.isPending,
    hasRead: flag.hasRead(LIST_ID),
  })

  /** `setMark.onMutate`, verbatim from the hook. */
  async function optimisticMark(playerId: string) {
    await client.cancelQueries({ queryKey: key })
    const previous = client.getQueryData<string[]>(key)
    client.setQueryData<string[]>(key, nextDraftedIds(previous, playerId, true))
  }

  /**
   * A request that **ignores** the abort and resolves anyway — R199's shape,
   * and the one the production `jsonOrThrow` actually has. Measured against a
   * real localhost server over 300–400 iterations: an abort landing *before*
   * `res.json()` rejects 200/200, but an abort landing *after* `res.json()` has
   * been entered on a buffered body resolves 200/200. `hangingFetch` above
   * models the first window; this models the second, which is the one nothing
   * was guarding.
   */
  function lateFetch() {
    let settle: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<FetchLike>(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return {
      started: () => fetchMock.mock.calls.length > 0,
      calls: () => fetchMock.mock.calls.length,
      /** The response the wire had already produced, delivered late. */
      resolveWith: (ids: string[]) =>
        settle?.(jsonResponse(200, { list_id: LIST_ID, drafted: ids })),
    }
  }

  it('R199 — a read that RESOLVES after its own abort still vouches for nothing', async () => {
    // The residual path the final review found: the catch arm checked
    // `signal.aborted` and the success arm did not, so a read discarded by
    // `cancelQueries` could still report "the marks are known" — over a cache
    // that never received them. Live, that permitted a clear and destroyed
    // rows the user had never been shown.
    const late = lateFetch()
    const { observer, unsubscribe } = observe()
    await vi.waitFor(() => expect(late.started()).toBe(true), { timeout: 2000, interval: 5 })

    await optimisticMark('p3') // cancelQueries aborts the in-flight read…
    late.resolveWith(['p1', 'p2']) // …and the response lands anyway.
    await new Promise((resolve) => setTimeout(resolve, 20))

    // React Query threw the resolved value away — this is the whole point:
    // the ids the read carried are NOT what the page is showing.
    expect(observer.getCurrentResult().data).toEqual(['p3'])
    // …so nothing may vouch for them, and the clear must refuse.
    expect(flag.hasRead(LIST_ID)).toBe(false)
    const after = observer.getCurrentResult()
    expect(after.isError).toBe(false) // status forged by the mark, as ever
    expect(clearRefusalReason(state(after))).toBe('never-read')

    const clear = vi.fn()
    const refuse = vi.fn()
    expect(runClearDrafted(state(after), { clear, refuse })).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('never-read')

    unsubscribe()
  })

  it('R199 COUNTER-CONTROL — the same late read, NOT cancelled, does open the flag', async () => {
    // Without this the test above would pass against a rig whose read never
    // completes at all, which proves nothing about the abort check.
    const late = lateFetch()
    const { observer, unsubscribe } = observe()
    await vi.waitFor(() => expect(late.started()).toBe(true), { timeout: 2000, interval: 5 })

    late.resolveWith(['p1', 'p2'])
    await settle(observer, 'success')

    expect(observer.getCurrentResult().data).toEqual(['p1', 'p2'])
    expect(flag.hasRead(LIST_ID)).toBe(true)
    expect(canClearDrafted(state(observer.getCurrentResult()))).toBe(true)
    expect(late.calls()).toBe(1)

    unsubscribe()
  })

  /** A request that never answers but honours the signal, like the real one. */
  function hangingFetch() {
    let seen: AbortSignal | undefined
    const fetchMock = vi.fn<FetchLike>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return { signal: () => seen }
  }

  it('THE FINDING — a mark over a failed read looks like success, and is refused', async () => {
    respondWith(() => jsonResponse(500, { error: 'boom' }))
    const { observer, unsubscribe } = observe()
    await settle(observer, 'error')

    // Before the mark, R190's own guard is already refusing.
    expect(canClearDrafted(state(observer.getCurrentResult()))).toBe(false)

    await optimisticMark('p3')
    const after = observer.getCurrentResult()

    // Measured, not assumed — this is the manufactured status the old guard
    // trusted. If React Query ever stops doing this, THIS is the line that
    // says so, rather than the guard quietly becoming decorative.
    expect(after.status).toBe('success')
    expect(after.isError).toBe(false)
    expect(after.isPending).toBe(false)
    expect(after.data).toEqual(['p3'])

    // …and the clear refuses anyway, because no READ ever landed.
    expect(flag.hasRead(LIST_ID)).toBe(false)
    expect(canClearDrafted(state(after))).toBe(false)
    expect(clearRefusalReason(state(after))).toBe('never-read')

    const clear = vi.fn()
    const refuse = vi.fn()
    expect(runClearDrafted(state(after), { clear, refuse })).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('never-read')

    unsubscribe()
  })

  it('and it stays refused across a whole marking session, not just one tap', async () => {
    // The Reviewer's timeline: three marks 700ms apart held the window open for
    // the entire session, because `cancelQueries` kills the failing refetch.
    respondWith(() => jsonResponse(500, { error: 'boom' }))
    const { observer, unsubscribe } = observe()
    await settle(observer, 'error')

    for (const playerId of ['p1', 'p2', 'p3']) {
      await optimisticMark(playerId)
      expect(observer.getCurrentResult().status).toBe('success') // still forged
      expect(canClearDrafted(state(observer.getCurrentResult()))).toBe(false)
    }
    expect(observer.getCurrentResult().data).toEqual(['p1', 'p2', 'p3'])
    expect(flag.hasRead(LIST_ID)).toBe(false)

    unsubscribe()
  })

  it('COUNTER-CONTROL — a healthy read, then a mark, and the clear still runs', async () => {
    // The everyday draft-night gesture: mark, mark, toggle off. §4 decision 2
    // must survive the guard, or the fix is just a different bug.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1', 'p2'] }))
    const { observer, unsubscribe } = observe()
    await settle(observer, 'success')
    expect(flag.hasRead(LIST_ID)).toBe(true)

    await optimisticMark('p3')
    const after = observer.getCurrentResult()
    expect(after.data).toEqual(['p1', 'p2', 'p3'])

    expect(clearRefusalReason(state(after))).toBeNull()
    const clear = vi.fn()
    const refuse = vi.fn()
    expect(runClearDrafted(state(after), { clear, refuse })).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(refuse).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('a read still in flight, cancelled by a mark, is neither a landing nor a failure', async () => {
    // The pending twin of the finding: the first read has not answered, the
    // user marks somebody, `cancelQueries` aborts the read. The signal is
    // React Query's own, threaded into the request — so the request really is
    // cancelled instead of resolving into a promise nobody is listening to.
    const { signal } = hangingFetch()
    const { observer, unsubscribe } = observe()
    await vi.waitFor(() => expect(signal()).toBeDefined(), { timeout: 2000, interval: 5 })
    expect(signal()?.aborted).toBe(false)

    await optimisticMark('p3')
    expect(signal()?.aborted).toBe(true) // the threading, proven at the wire
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(observer.getCurrentResult().data).toEqual(['p3'])
    expect(flag.hasRead(LIST_ID)).toBe(false)
    expect(clearRefusalReason(state(observer.getCurrentResult()))).toBe('never-read')

    unsubscribe()
  })

  it('a cancelled REFETCH does not close a flag a real read opened', async () => {
    // The other side of the abort rule. Every mark cancels the in-flight read,
    // so treating an abort as a failure would refuse the clear for the rest of
    // any session in which somebody marks two players quickly.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const { observer, unsubscribe } = observe()
    await settle(observer, 'success')
    expect(flag.hasRead(LIST_ID)).toBe(true)

    const { signal } = hangingFetch()
    void observer.refetch().catch(() => {})
    await vi.waitFor(() => expect(signal()).toBeDefined(), { timeout: 2000, interval: 5 })

    await optimisticMark('p2')
    expect(signal()?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(flag.hasRead(LIST_ID)).toBe(true) // untouched by the abort
    expect(canClearDrafted(state(observer.getCurrentResult()))).toBe(true)

    unsubscribe()
  })

  it('a genuinely failed refetch DOES close it again', async () => {
    // …so `failed` is not dead code, and the flag cannot go stale-true.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const { observer, unsubscribe } = observe()
    await settle(observer, 'success')
    expect(flag.hasRead(LIST_ID)).toBe(true)

    respondWith(() => jsonResponse(401, { error: 'Unauthorized' })) // 4xx: no retry
    await observer.refetch().catch(() => {})
    await vi.waitFor(() => expect(flag.hasRead(LIST_ID)).toBe(false), {
      timeout: 2000,
      interval: 10,
    })

    // React Query keeps the last data, so the page still shows p1 — and the
    // clear refuses on the status bit alone in this state. Then a mark forges
    // the status back to success, and `hasRead` is what still refuses.
    expect(observer.getCurrentResult().data).toEqual(['p1'])
    expect(clearRefusalReason(state(observer.getCurrentResult()))).toBe('read-failed')

    await optimisticMark('p2')
    const after = observer.getCurrentResult()
    expect(after.isError).toBe(false) // forged again
    expect(clearRefusalReason(state(after))).toBe('never-read')

    unsubscribe()
  })
})

/**
 * `createReadLandedFlag` on its own — the bit R195 turns on, exported out of the
 * hook body for R191's reason (a decision left in the body is pinned by nothing
 * this repo can run).
 */
describe('createReadLandedFlag — "a read landed for THIS list"', () => {
  it('starts closed, for every list', () => {
    const flag = createReadLandedFlag()
    expect(flag.hasRead(LIST_ID)).toBe(false)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(false)
  })

  it('opens for the list that landed, and only that one', () => {
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    expect(flag.hasRead(LIST_ID)).toBe(true)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(false)
  })

  it('closes when a read for that list fails', () => {
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    flag.signals.failed(LIST_ID)
    expect(flag.hasRead(LIST_ID)).toBe(false)
  })

  it("ignores another list's failure", () => {
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    flag.signals.failed(OTHER_LIST_ID)
    expect(flag.hasRead(LIST_ID)).toBe(true)
  })

  it('cannot leave a stale TRUE behind when the list changes', () => {
    // Why it is keyed by id rather than a bare boolean: switching lists must
    // not inherit the previous list's permission, and there is no effect to
    // race — the only writers are the read and the cache.
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(false)
    flag.signals.landed(OTHER_LIST_ID)
    flag.signals.failed(OTHER_LIST_ID)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(false)
  })

  it('keeps each list its OWN landing — list A → list B → back to A (R200)', () => {
    // The first cut held a single slot, so B's read evicted A's landing and
    // going back to A inside `staleTime` refused a clear over marks that were
    // on the screen: R200's symptom by a second route.
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    flag.signals.landed(OTHER_LIST_ID)
    expect(flag.hasRead(LIST_ID)).toBe(true)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(true)
  })

  it('forgets a list when its cache entry goes away — and only that list', () => {
    const flag = createReadLandedFlag()
    flag.signals.landed(LIST_ID)
    flag.signals.landed(OTHER_LIST_ID)
    flag.forget(LIST_ID)
    expect(flag.hasRead(LIST_ID)).toBe(false)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(true)
  })
})

describe('listIdFromDraftedKey — which cache removals the flag cares about', () => {
  it('reads the list id out of a drafted key', () => {
    expect(listIdFromDraftedKey(draftedKeys.list(LIST_ID))).toBe(LIST_ID)
  })

  it('is null for every other key, so no other query can clear a landing', () => {
    expect(listIdFromDraftedKey(['auth', 'session'])).toBeNull()
    expect(listIdFromDraftedKey(['lists', 'byUser', LIST_ID])).toBeNull()
    expect(listIdFromDraftedKey(['players', 'drafted', LIST_ID])).toBeNull()
    expect(listIdFromDraftedKey([...draftedKeys.all])).toBeNull() // no list id
    expect(listIdFromDraftedKey([])).toBeNull()
  })
})

/**
 * **R200 — the flag has the CACHE's lifetime, not the MOUNT's.**
 *
 * `query-provider.tsx` keeps a read fresh for 60 s, so navigating away and back
 * inside a minute re-renders the real marks off the cache with **no refetch**.
 * A per-mount `useRef` came back `false` there, and both destructive controls
 * refused with copy — *"have not loaded on this device"* — that flatly
 * contradicted the marks on screen: the failure mode R197 exists to prevent.
 *
 * Each `mount()` below is one component instance: a fresh `QueryObserver` over
 * the client-scoped flag, exactly as `useDraftMode` wires it. The client is
 * built with the app's own defaults, and the pin below ties that number to
 * `query-provider.tsx` so the two cannot drift apart silently.
 */
describe('R200 — a remount inherits the landing the cache inherited', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000, refetchOnWindowFocus: false, retry: 1 } },
    })
  })

  afterEach(() => {
    client.clear()
  })

  const key = draftedKeys.list(LIST_ID)

  /** One mount of `useDraftMode`, as far as node can go without a DOM. */
  function mount(listId = LIST_ID) {
    const flag = readLandedFlagFor(client)
    const observer = new QueryObserver(client, draftedQueryOptions(listId, flag.signals))
    const unmount = observer.subscribe(() => {})
    return { flag, observer, unmount }
  }

  const settled = (observer: { getCurrentResult: () => { status: string } }, status: string) =>
    vi.waitFor(() => expect(observer.getCurrentResult().status).toBe(status), {
      timeout: 4000,
      interval: 10,
    })

  const stateOf = (
    flag: ReturnType<typeof createReadLandedFlag>,
    result: { isError: boolean; isPending: boolean },
    listId = LIST_ID,
  ) => ({ isError: result.isError, isPending: result.isPending, hasRead: flag.hasRead(listId) })

  it('the staleTime this finding turns on is the one the app actually sets', () => {
    // If the provider's number changes, the rig above stops modelling the app
    // and this line says so rather than the suite quietly testing fiction.
    expect(code('src/components/providers/query-provider.tsx')).toContain('staleTime: 60 * 1000')
  })

  it('THE FINDING — land a read, unmount, remount inside staleTime: marks render AND the clear runs', async () => {
    const fetchMock = respondWith(() =>
      jsonResponse(200, { list_id: LIST_ID, drafted: ['p1', 'p2'] }),
    )

    const first = mount()
    await settled(first.observer, 'success')
    expect(first.flag.hasRead(LIST_ID)).toBe(true)
    first.unmount() // navigate away — /app/lists, or the draft-mode board

    const second = mount() // …and straight back in, well inside the minute
    const rendered = second.observer.getCurrentResult()

    // The real marks are on the screen, off the cache…
    expect(toDraftedSet(rendered.data)).toEqual(new Set(['p1', 'p2']))
    // …with no refetch, which is why nothing would ever reopen a mount-scoped
    // flag: `refetchOnMount` does not refire over fresh data.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // …and the clear is permitted, because the landing came with the cache.
    expect(second.flag.hasRead(LIST_ID)).toBe(true)
    expect(clearRefusalReason(stateOf(second.flag, rendered))).toBeNull()

    const clear = vi.fn()
    const refuse = vi.fn()
    expect(runClearDrafted(stateOf(second.flag, rendered), { clear, refuse })).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(refuse).not.toHaveBeenCalled()

    second.unmount()
  })

  it('COUNTER-CONTROL — a remount on a DIFFERENT list inherits nothing', async () => {
    // The keying, at the level the hook uses it: permission is per list, so
    // arriving at another list must not carry this one's.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const first = mount()
    await settled(first.observer, 'success')
    first.unmount()

    const flag = readLandedFlagFor(client)
    expect(flag.hasRead(OTHER_LIST_ID)).toBe(false)
    expect(
      clearRefusalReason({ isError: false, isPending: false, hasRead: flag.hasRead(OTHER_LIST_ID) }),
    ).toBe('never-read')
  })

  it('the landing dies with the cache entry it vouched for (gc / removeQueries)', async () => {
    // The hazard a longer-lived flag introduces, closed. `removeQueries` is the
    // same `QueryCache.remove` path that garbage collection takes after
    // `gcTime` with no observers — without this, a cache collected while the
    // user was elsewhere would leave `hasRead` true over an EMPTY cache, and an
    // optimistic mark on the way back would forge the status and permit a clear
    // over marks nobody had read. R195, again, by the back door.
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const first = mount()
    await settled(first.observer, 'success')
    expect(first.flag.hasRead(LIST_ID)).toBe(true)
    first.unmount()

    client.removeQueries({ queryKey: key, exact: true })

    expect(readLandedFlagFor(client).hasRead(LIST_ID)).toBe(false)
    expect(client.getQueryData(key)).toBeUndefined() // the cache really is gone
  })

  it('a whole-cache clear() takes it too — the wipe a sign-out reset would perform', async () => {
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const first = mount()
    await settled(first.observer, 'success')
    first.unmount()

    client.clear()

    expect(readLandedFlagFor(client).hasRead(LIST_ID)).toBe(false)
  })

  it('another query being removed leaves the landing alone', () => {
    // The counter-control for the two above: if ANY removal cleared the flag,
    // an unrelated eviction would refuse a clear the user is entitled to.
    const flag = readLandedFlagFor(client)
    flag.signals.landed(LIST_ID)
    client.setQueryData(['auth', 'session'], null)
    client.removeQueries({ queryKey: ['auth', 'session'], exact: true })
    expect(flag.hasRead(LIST_ID)).toBe(true)
  })

  it('one flag per QueryClient, and never one shared between clients (SSR)', () => {
    // Per client, not per module: `QueryProvider` builds a client per render,
    // so on the server each REQUEST has its own — one visitor's landings can
    // never answer for another's.
    const other = new QueryClient()
    expect(readLandedFlagFor(client)).toBe(readLandedFlagFor(client))
    expect(readLandedFlagFor(other)).not.toBe(readLandedFlagFor(client))

    readLandedFlagFor(client).signals.landed(LIST_ID)
    expect(readLandedFlagFor(other).hasRead(LIST_ID)).toBe(false)
    other.clear()
  })

  it('a genuinely failed refetch still closes it, across the remount (R195 holds)', async () => {
    respondWith(() => jsonResponse(200, { list_id: LIST_ID, drafted: ['p1'] }))
    const first = mount()
    await settled(first.observer, 'success')
    first.unmount()

    respondWith(() => jsonResponse(401, { error: 'Unauthorized' })) // 4xx: no retry
    const second = mount()
    await second.observer.refetch().catch(() => {})
    await vi.waitFor(() => expect(second.flag.hasRead(LIST_ID)).toBe(false), {
      timeout: 2000,
      interval: 10,
    })

    // React Query keeps the last data, so p1 is still on screen — and this is
    // precisely the state a clear must refuse.
    expect(second.observer.getCurrentResult().data).toEqual(['p1'])
    expect(canClearDrafted(stateOf(second.flag, second.observer.getCurrentResult()))).toBe(false)

    second.unmount()
  })
})

describe('toDraftedSet — the fallback consequence 2 rests on', () => {
  it('turns "no data yet" and "the read failed" into the same empty Set', () => {
    expect(toDraftedSet(undefined).size).toBe(0)
    expect(toDraftedSet([]).size).toBe(0)
  })

  it('carries every id through, and is a real Set for `.has`', () => {
    const set = toDraftedSet(['p1', 'p2'])
    expect(set.has('p1')).toBe(true)
    expect(set.has('p3')).toBe(false)
    expect(set.size).toBe(2)
  })
})

/**
 * **R191.** These two decisions used to live inline in the hook body, which no
 * test in this repo can reach. The Reviewer measured what that cost: inverting
 * the desired state (nobody can ever be marked drafted) and separately gutting
 * the clear both passed type-check, `test:unit` **715/715** and
 * `drafted-api-db` **32/32**. Behavior is pinned here; the wiring that reaches
 * it is pinned as source below.
 */
describe('desiredStateFor — the state a tap asks for (R191)', () => {
  it('asks for TRUE when the player is not marked — including with no marks at all', () => {
    expect(desiredStateFor(undefined, 'p1')).toBe(true) // read failed / not landed
    expect(desiredStateFor([], 'p1')).toBe(true)
    expect(desiredStateFor(['p2'], 'p1')).toBe(true)
  })

  it('asks for FALSE when the player is already marked', () => {
    expect(desiredStateFor(['p1'], 'p1')).toBe(false)
    expect(desiredStateFor(['p1', 'p2'], 'p1')).toBe(false)
  })

  it('a same-tick double-tap sends the SAME state twice, never an inversion', () => {
    // §4 decision 3's claim, made falsifiable: both taps read the same
    // pre-mutation cache, so the second is a replay of the first — which is
    // the entire reason LV.1.2's wire carries a STATE and not a toggle.
    const current = ['p2']
    const first = desiredStateFor(current, 'p1')
    const second = desiredStateFor(current, 'p1')
    expect(second).toBe(first)
    expect(first).toBe(true)

    const marked = ['p1']
    expect(desiredStateFor(marked, 'p1')).toBe(desiredStateFor(marked, 'p1'))
  })
})

/**
 * **R190 — the finding that mattered.** Live, on the flag-OFF legacy view:
 * 2 rows in `list_player_drafted` → the GET forced to 500 → the page renders
 * "no drafted" with no toast and no console error → one click of "Draft mode"
 * → **0 rows**, permanently, on every device. The clear became durable at
 * LV.1.3 and the failed read was already silent; nobody priced the two
 * together.
 */
describe('runClearDrafted — a clear over marks nobody has read is refused (R190)', () => {
  const spies = () => ({ clear: vi.fn(), refuse: vi.fn() })
  const READ = { isError: false, isPending: false, hasRead: true }

  it('clears when a read landed — §4 decision 2 survives the guard', () => {
    const { clear, refuse } = spies()
    expect(runClearDrafted(READ, { clear, refuse })).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(refuse).not.toHaveBeenCalled()
  })

  it('REFUSES when the read failed — the live data-loss path', () => {
    const { clear, refuse } = spies()
    expect(runClearDrafted({ ...READ, isError: true }, { clear, refuse })).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('read-failed')
  })

  it('refuses while the read is still in flight — same empty picture', () => {
    const { clear, refuse } = spies()
    expect(runClearDrafted({ ...READ, isPending: true }, { clear, refuse })).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('read-in-flight')
  })

  it('REFUSES when the status says success but no read ever landed (R195)', () => {
    const { clear, refuse } = spies()
    expect(runClearDrafted({ ...READ, hasRead: false }, { clear, refuse })).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('never-read')
  })

  it('refuses loudly, never silently — the refusal is an effect, not a return', () => {
    // A guard that just returns is CLAUDE.md's failure in mirror image: the
    // user asked for something, nothing happened, and nothing said so.
    const { clear, refuse } = spies()
    runClearDrafted({ isError: true, isPending: true, hasRead: false }, { clear, refuse })
    expect(refuse).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
  })

  it('canClearDrafted is the whole decision table — all three bits, no exceptions', () => {
    for (const isError of [false, true]) {
      for (const isPending of [false, true]) {
        for (const hasRead of [false, true]) {
          expect(canClearDrafted({ isError, isPending, hasRead })).toBe(
            hasRead && !isError && !isPending,
          )
        }
      }
    }
  })
})

/**
 * **R197.** The refusal used to say the marks "could not be loaded" in every
 * state, including the one where they simply had not arrived yet — and the
 * legacy view wires Draft mode to `clearDrafted()` unconditionally, so an
 * ordinary page load could raise a destructive toast blaming a failure that
 * never happened. Three states, three answers, and none of them guesses.
 */
describe('the refusal says which of the three it was (R197)', () => {
  it('names the reason, most-specific first', () => {
    expect(clearRefusalReason({ isError: true, isPending: false, hasRead: false })).toBe(
      'read-failed',
    )
    expect(clearRefusalReason({ isError: false, isPending: true, hasRead: false })).toBe(
      'read-in-flight',
    )
    expect(clearRefusalReason({ isError: false, isPending: false, hasRead: false })).toBe(
      'never-read',
    )
    expect(clearRefusalReason({ isError: false, isPending: false, hasRead: true })).toBeNull()
  })

  it('the in-flight copy does not blame a failure that did not happen', () => {
    // The R197 bug, verbatim: "could not be loaded" during a normal page load.
    expect(CLEAR_REFUSAL_COPY['read-in-flight']).not.toMatch(/could not/i)
    expect(CLEAR_REFUSAL_COPY['read-in-flight']).toMatch(/still loading/i)
    // …and it does not tell the user to reload a page that is loading fine.
    expect(CLEAR_REFUSAL_COPY['read-in-flight']).not.toMatch(/reload/i)
  })

  it('every reason has its own copy, and every copy says nothing was cleared', () => {
    const copies = Object.values(CLEAR_REFUSAL_COPY)
    expect(copies).toHaveLength(3)
    expect(new Set(copies).size).toBe(3)
    for (const copy of copies) expect(copy).toMatch(/none were cleared/)
    // The failure case keeps the advice that actually helps.
    expect(CLEAR_REFUSAL_COPY['read-failed']).toMatch(/reload/i)
    expect(CLEAR_REFUSAL_COPY['never-read']).toMatch(/reload/i)
  })
})

/**
 * **The wiring (R190/R191).** Exported decisions are worth nothing if the hook
 * stops calling them, and the hook body has no runtime surface here. Each pin
 * reads the *callback's own body*, not the file — see `callbackBody`.
 */
describe('the hook body wires those decisions in', () => {
  it('toggleDrafted sends desiredStateFor, un-negated and not re-derived', () => {
    const body = callbackBody(code(HOOK_FILE), 'toggleDrafted')
    expect(body).toContain(
      'setMarkMutate({ playerId, drafted: desiredStateFor(current, playerId) })',
    )
    // The two edits that put the feature back where R191 found it: negate the
    // call, or inline the decision again where nothing can falsify it.
    expect(body).not.toContain('!desiredStateFor')
    expect(body).not.toContain('.has(')
  })

  it('clearDrafted goes through the guard and cannot reach the mutation directly', () => {
    const body = callbackBody(code(HOOK_FILE), 'clearDrafted')
    expect(body).toContain('runClearDrafted(')
    // The real read state, not literals that would make the guard decorative.
    expect(body).toContain('isError: marks.isError')
    expect(body).toContain('isPending: marks.isPending')
    expect(body).toContain('hasRead: readLanded.hasRead(listId)')
    expect(body).toContain('clear: clearMarksMutate')
    expect(body).toContain('refuse:')
    // The pre-R190 body, verbatim: an unconditional durable DELETE.
    expect(body).not.toMatch(/clearMarksMutate\(\)/)
    // R195: the bit must come from the READ. A literal, or the query's own
    // status standing in for it, is the bug this finding was about.
    expect(body).not.toMatch(/hasRead:\s*(true|!marks|marks\.)/)
  })

  it('the read that feeds hasRead is the one the hook actually runs (R195)', () => {
    const source = code(HOOK_FILE)
    // The flag is threaded INTO the query — an options object built without it
    // raises no signals at all, and `hasRead` would then be false forever.
    expect(source).toContain('useQuery(draftedQueryOptions(listId, readLanded.signals))')
    // …and the flag comes from the QUERY CLIENT, never from the mount (R200):
    // the marks it vouches for outlive the mount by `staleTime`/`gcTime`, so a
    // mount-scoped flag refuses clears the user is entitled to.
    expect(source).toContain('const readLanded = readLandedFlagFor(qc)')
    expect(source).not.toContain('useRef')
    // The flag is built once per client, and the cache's removals reach it.
    expect(code(HOOK_FILE)).toContain('flagsByClient.set(client, flag)')
    expect(code(HOOK_FILE)).toContain('client.getQueryCache().subscribe(')
  })

  it('the queryFn raises landed/failed itself, and BOTH arms check the abort (R199)', () => {
    const source = code(HOOK_FILE)
    // Every raise of either signal, with the line it sits on — so an unguarded
    // one re-introduced anywhere in the file reddens this, rather than the pin
    // being satisfied by the one guarded call that happens to remain.
    const landed = source.match(/[^\n]*signals\?\.landed\(listId\)/g) ?? []
    const failed = source.match(/[^\n]*signals\?\.failed\(listId\)/g) ?? []
    expect(landed).toHaveLength(1)
    expect(failed).toHaveLength(1)
    // R199: the SUCCESS arm's guard is the fix. A read that resolves after its
    // own cancellation was discarded by React Query and must vouch for nothing.
    expect(landed[0]).toContain('if (!signal.aborted)')
    expect(failed[0]).toContain('if (!signal.aborted)')
    // The signal reaches the request, or "cancelled" would not mean cancelled.
    expect(source).toContain('fetchDraftedIds(listId, signal)')
  })

  /**
   * **R195's second half.** The Reviewer's point was that *both* destructive
   * controls are live in the degraded state: "Reset list" is gated on
   * `draftedCount === 0`, and one optimistic mark makes that count 1. The hook
   * guard now refuses in both, but `handleReset` announced a reset regardless —
   * "nothing happened means it worked" one layer up (CLAUDE.md). It may claim
   * the reset only when the hook says the clear actually ran.
   */
  it('the legacy view only claims a reset that really happened (R195)', () => {
    const body = arrowBody(code(VIEW_FILE), 'const handleReset = () => {', VIEW_FILE)
    const compact = body.replace(/\s+/g, ' ')
    expect(compact).toMatch(/if \(draft\.clearDrafted\(\)\)\s*\{?\s*toast\(/)
    // The pre-fix body, verbatim: clear, then announce whatever happened.
    expect(compact).not.toMatch(/draft\.clearDrafted\(\);? toast\(/)
    // …and the toast that would be the lie appears nowhere outside the guard.
    expect(compact.indexOf('toast(')).toBeGreaterThan(compact.indexOf('draft.clearDrafted()'))
  })

  it('turning Draft mode off still clears — §4 decision 2 is still wired', () => {
    // The counter-control for the pin above: a "fix" that stops calling the
    // clear at all would satisfy every refusal assertion in this file.
    expect(code(VIEW_FILE)).toContain('if (!next) draft.clearDrafted()')
  })

  it('the slicers return real bodies (control for the pins above)', () => {
    const view = code(VIEW_FILE)
    const reset = arrowBody(view, 'const handleReset = () => {', VIEW_FILE)
    expect(reset).toContain('draft.clearDrafted()')
    expect(reset.length).toBeLessThan(view.length)
    // It really stops at the end of the function, rather than running on.
    expect(reset).not.toContain('const toggleStat')
    expect(() => arrowBody(view, 'const noSuchHandler = () => {', VIEW_FILE)).toThrow(
      /no `const noSuchHandler/,
    )
  })

  it('the slicer returns real callback bodies (control for the two pins above)', () => {
    // Without this a slicer that returned '' would make every pin above pass,
    // and one that returned the whole file would make them pass for the wrong
    // reason — the R172 miss window, re-opened.
    const source = code(HOOK_FILE)
    const toggle = callbackBody(source, 'toggleDrafted')
    const clear = callbackBody(source, 'clearDrafted')

    expect(toggle).toContain('setMarkMutate')
    expect(clear).toContain('clearMarksMutate')
    // Each body is genuinely a slice: it does not contain the other one.
    expect(toggle).not.toContain('runClearDrafted')
    expect(clear).not.toContain('setMarkMutate')
    expect(clear.length).toBeLessThan(source.length)
    // A missing callback throws instead of silently pinning nothing.
    expect(() => callbackBody(source, 'noSuchCallback')).toThrow(/no `noSuchCallback`/)
  })
})

describe('nextDraftedIds — the optimistic reducer', () => {
  it('marks and un-marks', () => {
    expect(nextDraftedIds([], 'p1', true)).toEqual(['p1'])
    expect(nextDraftedIds(['p1', 'p2'], 'p1', false)).toEqual(['p2'])
  })

  it('is idempotent in both directions, so a retry cannot invert the answer', () => {
    expect(nextDraftedIds(['p1'], 'p1', true)).toEqual(['p1'])
    expect(nextDraftedIds([], 'p1', false)).toEqual([])
  })

  it('treats an absent cache as no marks rather than throwing', () => {
    expect(nextDraftedIds(undefined, 'p1', true)).toEqual(['p1'])
    expect(nextDraftedIds(undefined, 'p1', false)).toEqual([])
  })

  it('never returns the array it was given, so React Query sees a change', () => {
    const current = ['p1']
    expect(nextDraftedIds(current, 'p2', true)).not.toBe(current)
  })
})

describe('draftedKeys — one cache entry per list, never a global one', () => {
  it('scopes marks to a single list (D2 — per user, PER LIST)', () => {
    expect(draftedKeys.list('a')).toEqual(['lists', 'drafted', 'a'])
    expect(draftedKeys.list('a')).not.toEqual(draftedKeys.list('b'))
    // The prefix every per-list key shares, for a future bulk invalidation.
    expect(draftedKeys.list('a').slice(0, 2)).toEqual([...draftedKeys.all])
  })

  it('does not fetch at all without a list id', () => {
    expect(draftedQueryOptions('').enabled).toBe(false)
    expect(draftedQueryOptions(LIST_ID).enabled).toBe(true)
  })
})
