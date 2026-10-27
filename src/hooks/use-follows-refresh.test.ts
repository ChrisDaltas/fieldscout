/**
 * What a follow / unfollow re-reads once it settles (refreshAfterFollowToggle,
 * useToggleFollow's onSettled). Unfollowing someone from your own Following
 * list must not pull their row out from under you: the list on screen keeps
 * the rows it loaded (the row now shows Follow, so a mis-tap can be undone)
 * and is only marked stale, so the next visit reads it fresh. The follow set
 * and the profile counts still re-read at once. Driven through a real
 * QueryClient with mounted observers, on the app's 60s staleTime.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { followKeys, refreshAfterFollowToggle } from './use-follows'

const ME = 'dev_user'
const unsubs: Array<() => void> = []

afterEach(() => {
  while (unsubs.length) unsubs.pop()!()
})

/** Mount a screen's query: an observer reading `key`, counting its reads. */
async function mount(client: QueryClient, key: readonly unknown[], reads: { n: number }) {
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      reads.n += 1
      return { read: reads.n }
    },
    staleTime: 60_000,
  })
  unsubs.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
  return observer
}

describe('a follow toggle re-reads the counts but leaves an open Followers / Following list alone', () => {
  it('the open Following list keeps its rows (no re-read) and is marked stale; the profile and follow set re-read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const list = { n: 0 }
    const profile = { n: 0 }
    const set = { n: 0 }
    const listObs = await mount(client, followKeys.personFollows(ME, 'following'), list)
    await mount(client, followKeys.person(ME), profile)
    await mount(client, followKeys.followingSet('user-me'), set)
    expect([list.n, profile.n, set.n]).toEqual([1, 1, 1])

    refreshAfterFollowToggle(client)

    await vi.waitFor(() => expect(profile.n).toBe(2))
    await vi.waitFor(() => expect(set.n).toBe(2))
    // Give a stray re-read every chance to land before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20))
    expect(list.n).toBe(1)
    expect(listObs.getCurrentResult().data).toEqual({ read: 1 })
    expect(client.getQueryState(followKeys.personFollows(ME, 'following'))?.isInvalidated).toBe(true)
  })

  it('coming back to the list reads it fresh, inside the 60s staleTime', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const list = { n: 0 }
    await mount(client, followKeys.personFollows(ME, 'following'), list)
    refreshAfterFollowToggle(client)
    // Leave the list…
    unsubs.pop()!()
    expect(list.n).toBe(1)
    // …and open it again.
    await mount(client, followKeys.personFollows(ME, 'following'), list)
    await vi.waitFor(() => expect(list.n).toBe(2))
  })

  it('the other list (Followers) is marked stale the same way, and the feed re-reads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const followers = { n: 0 }
    const feed = { n: 0 }
    await mount(client, followKeys.personFollows('devpro', 'followers'), followers)
    await mount(client, ['explore-feed', 'latest'], feed)

    refreshAfterFollowToggle(client)

    await vi.waitFor(() => expect(feed.n).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(followers.n).toBe(1)
    expect(client.getQueryState(followKeys.personFollows('devpro', 'followers'))?.isInvalidated).toBe(true)
  })
})
