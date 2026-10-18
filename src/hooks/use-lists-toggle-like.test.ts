/**
 * The list like toggle (gap list §3 #26 — the phone's Community detail; the
 * desktop feed's LikeButton uses the same hook). CLAUDE.md: like/unlike are
 * optimistic. Pinned, through a real `QueryClient` + `MutationObserver` over
 * the hook's own options:
 *  - a detail that knows the viewer's `is_liked` flips at once and moves its
 *    count by one — before the server answers;
 *  - a failed toggle puts it back exactly;
 *  - the server's answer (liked + authoritative count) is what's left;
 *  - with the liked state unknown (`null`) or no detail cached (a feed row),
 *    nothing is guessed.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listsKeys, toggleLikeMutationOptions, type ListWithDetails } from './use-lists'

const LIST = 'c2600000-0000-4000-8000-000000000001'

function detail(over: Partial<ListWithDetails> = {}): ListWithDetails {
  return { id: LIST, like_count: 4, is_liked: false, players: [], tags: [], links: [], is_owner: false, ...over } as ListWithDetails
}

/** A fetch that answers when `release` is called — so the optimistic state
 *  can be read while the request is in flight. */
function heldFetch(ok: boolean, body: unknown) {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  vi.stubGlobal('fetch', () =>
    gate.then(
      () =>
        ({
          ok,
          status: ok ? 200 : 500,
          json: () => Promise.resolve(body),
        }) as unknown as Response,
    ),
  )
  return () => release()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function client(seed?: ListWithDetails) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (seed) qc.setQueryData(listsKeys.detail(LIST), seed)
  return qc
}

const read = (qc: QueryClient) => qc.getQueryData<ListWithDetails>(listsKeys.detail(LIST))

describe('the like toggle', () => {
  it('flips a known like at once (+1), and the server’s answer is what stays', async () => {
    const qc = client(detail({ like_count: 4, is_liked: false }))
    const release = heldFetch(true, { liked: true, like_count: 7 })
    const done = new MutationObserver(qc, toggleLikeMutationOptions(qc, LIST)).mutate()
    await vi.waitFor(() => expect(read(qc)).toMatchObject({ is_liked: true, like_count: 5 }))
    release()
    await done
    expect(read(qc)).toMatchObject({ is_liked: true, like_count: 7 })
  })

  it('an unlike drops one at once, never below zero', async () => {
    const qc = client(detail({ like_count: 0, is_liked: true }))
    const release = heldFetch(true, { liked: false, like_count: 0 })
    const done = new MutationObserver(qc, toggleLikeMutationOptions(qc, LIST)).mutate()
    await vi.waitFor(() => expect(read(qc)).toMatchObject({ is_liked: false, like_count: 0 }))
    release()
    await done
  })

  it('a failed toggle puts the like and the count back', async () => {
    const qc = client(detail({ like_count: 4, is_liked: false }))
    const release = heldFetch(false, { error: 'nope' })
    const done = new MutationObserver(qc, toggleLikeMutationOptions(qc, LIST)).mutate()
    await vi.waitFor(() => expect(read(qc)).toMatchObject({ is_liked: true, like_count: 5 }))
    release()
    await expect(done).rejects.toThrow()
    expect(read(qc)).toMatchObject({ is_liked: false, like_count: 4 })
  })

  it('an unknown liked state isn’t guessed: the answer is written when it comes', async () => {
    const qc = client(detail({ like_count: 4, is_liked: null }))
    const release = heldFetch(true, { liked: true, like_count: 5 })
    const done = new MutationObserver(qc, toggleLikeMutationOptions(qc, LIST)).mutate()
    await new Promise((r) => setTimeout(r, 0))
    expect(read(qc)).toMatchObject({ is_liked: null, like_count: 4 })
    release()
    await done
    expect(read(qc)).toMatchObject({ is_liked: true, like_count: 5 })
  })

  it('no detail cached (a feed row): nothing is created or guessed', async () => {
    const qc = client()
    const release = heldFetch(true, { liked: true, like_count: 1 })
    const done = new MutationObserver(qc, toggleLikeMutationOptions(qc, LIST)).mutate()
    release()
    await expect(done).resolves.toEqual({ liked: true, like_count: 1 })
    expect(read(qc)).toBeUndefined()
  })
})
