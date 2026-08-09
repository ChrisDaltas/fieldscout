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
 *
 * No DOM: this repo's vitest runs on node with no jsdom, so the hook body
 * itself is out of reach. What that costs is stated rather than papered over —
 * the *return shape* the two closed consumers destructure
 * (`list-detail-view.tsx`, `draft-mode/board-column.tsx`, neither editable) is
 * pinned by `npm run type-check`, which fails if a key is renamed or retyped.
 * Everything reachable without a DOM is pinned behaviourally below, and the two
 * genuinely-source-level facts (no suspense, no `throwOnError` — either would
 * route a failed read to an error boundary and crash the very page consequence
 * 2 protects) are pinned as source, with the reason recorded.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteDrafted,
  draftedKeys,
  draftedQueryOptions,
  fetchDraftedIds,
  nextDraftedIds,
  postDrafted,
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
const LIST_ID = '22222222-2222-4222-8222-222222222222'

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

  beforeEach(() => {
    client = new QueryClient()
  })

  afterEach(() => {
    client.clear()
  })

  async function observeUntilSettled(status: 'error' | 'success') {
    const observer = new QueryObserver(client, draftedQueryOptions(LIST_ID))
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(
        () => expect(observer.getCurrentResult().status).toBe(status),
        { timeout: 4000, interval: 10 },
      )
      return observer.getCurrentResult()
    } finally {
      unsubscribe()
    }
  }

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
