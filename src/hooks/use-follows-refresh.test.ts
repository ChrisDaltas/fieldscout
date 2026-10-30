/**
 * What a follow / unfollow re-reads once it settles (refreshAfterFollowToggle,
 * useToggleFollow's onSettled). Unfollowing someone from your own Following
 * list must not pull their row out from under you: the list on screen keeps
 * the rows it loaded (the row now shows Follow, so a mis-tap can be undone)
 * and is only marked stale, so the next visit reads it fresh. The follow set
 * and the profile counts still re-read at once. Scouts to follow (plan C4)
 * works the same way: the toggle moves the tapped row's "N followers" at
 * once (`moveScoutFollowers`, put back if it fails), the settle only marks
 * the card stale. Driven through a real QueryClient with mounted observers,
 * on the app's staleTimes.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { followKeys, moveScoutFollowers, putBackScouts, refreshAfterFollowToggle } from './use-follows'
import { SCOUTS_TO_FOLLOW_KEY, type ScoutToFollow } from './use-scouts-to-follow'

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

describe('Scouts to follow: the tapped row\'s "N followers" moves at once, the rows stay put', () => {
  const SCOUTS_KEY = [...SCOUTS_TO_FOLLOW_KEY, 5, false] as const
  const scouts = (): ScoutToFollow[] => [
    { id: 'u-kelly', username: 'kellyscout', avatar_url: null, followers: 3 },
    { id: 'u-ortiz', username: 'ortizfootball', avatar_url: null, followers: 1 },
    { id: 'u-sam', username: 'samsleepers', avatar_url: null, followers: 1 },
  ]
  const counts = (client: QueryClient) =>
    client.getQueryData<ScoutToFollow[]>(SCOUTS_KEY)?.map((r) => [r.username, r.followers])

  /** Mount the card's query: it reads `scouts()` and counts its reads. */
  async function mountScouts(client: QueryClient, reads: { n: number }) {
    const observer = new QueryObserver(client, {
      queryKey: SCOUTS_KEY,
      queryFn: async () => {
        reads.n += 1
        return scouts()
      },
      staleTime: 5 * 60_000,
    })
    unsubs.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    return observer
  }

  it('following @ortizfootball: "1 follower" becomes 2 on the card at once; nobody else changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await mountScouts(client, { n: 0 })
    moveScoutFollowers(client, 'u-ortiz', false)
    expect(counts(client)).toEqual([
      ['kellyscout', 3],
      ['ortizfootball', 2],
      ['samsleepers', 1],
    ])
  })

  it('a count that passes the row above leaves the order alone (no row jumps under the pointer)', () => {
    const client = new QueryClient()
    client.setQueryData(SCOUTS_KEY, scouts())
    for (let i = 0; i < 3; i++) moveScoutFollowers(client, 'u-sam', false)
    expect(counts(client)).toEqual([
      ['kellyscout', 3],
      ['ortizfootball', 1],
      ['samsleepers', 4],
    ])
  })

  it('unfollowing takes one off, never below 0', () => {
    const client = new QueryClient()
    client.setQueryData(SCOUTS_KEY, scouts())
    moveScoutFollowers(client, 'u-kelly', true)
    expect(counts(client)?.[0]).toEqual(['kellyscout', 2])
    client.setQueryData(SCOUTS_KEY, [{ id: 'u-kelly', username: 'kellyscout', avatar_url: null, followers: 0 }])
    moveScoutFollowers(client, 'u-kelly', true)
    expect(counts(client)).toEqual([['kellyscout', 0]])
  })

  it('a toggle that fails puts the count back', () => {
    const client = new QueryClient()
    client.setQueryData(SCOUTS_KEY, scouts())
    const before = moveScoutFollowers(client, 'u-kelly', false)
    expect(counts(client)?.[0]).toEqual(['kellyscout', 4])
    putBackScouts(client, before)
    expect(counts(client)?.[0]).toEqual(['kellyscout', 3])
  })

  it('no Scouts to follow loaded yet: nothing to move, nothing made up', () => {
    const client = new QueryClient()
    expect(moveScoutFollowers(client, 'u-kelly', false)).toEqual([])
    expect(client.getQueryData(SCOUTS_KEY)).toBeUndefined()
  })

  it('the settle marks the open card stale without re-reading it (the rows stay under the pointer); the next visit reads it fresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reads = { n: 0 }
    await mountScouts(client, reads)
    moveScoutFollowers(client, 'u-kelly', false)

    refreshAfterFollowToggle(client)

    await new Promise((r) => setTimeout(r, 20))
    expect(reads.n).toBe(1)
    expect(counts(client)?.[0]).toEqual(['kellyscout', 4])
    expect(client.getQueryState(SCOUTS_KEY)?.isInvalidated).toBe(true)

    // Leave Community and come back, well inside the 5-minute staleTime.
    unsubs.pop()!()
    await mountScouts(client, reads)
    await vi.waitFor(() => expect(reads.n).toBe(2))
  })
})
