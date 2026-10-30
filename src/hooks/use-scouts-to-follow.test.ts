/**
 * The Scouts to follow read (desktop's card and the phone's For you shelf —
 * plan C4, readiness S1). Pinned on the query the hook sends and on what it
 * makes of the rows:
 *  - who: public, live lists that Community shows (lists only while rankings
 *    are off), and never an AI handle (`fieldscout-ai`, any "-ai") or a
 *    placeholder `user_xxxxxxxx` handle — filtered in the read, and again on
 *    the rows;
 *  - the order: most followers first, a tie to the most recent public-list
 *    activity (the lists side, ordered by the owner's followers, then newest
 *    update — each person's first row is their latest list);
 *  - each person once, five at most, reading on past a prolific scout;
 *  - a failed read throws (the card says it couldn't load — never empty).
 */
import { describe, expect, it } from 'vitest'

import { WEEKLY_BOARD_PATTERN } from '@/components/mobile/community/community-ops'

import {
  fetchScoutsToFollow,
  followersLabel,
  hiddenFromScouts,
  PLACEHOLDER_HANDLE_PATTERN,
  SCOUTS_PAGE_SIZE,
  SCOUTS_TO_FOLLOW_SIZE,
} from './use-scouts-to-follow'

type Call = [string, ...unknown[]]
type Result = { data: unknown; error: unknown }

/** A fake browser client: each read records its calls and answers the next
 *  result in turn. */
function fakeClient(...results: Result[]) {
  const reads: Call[][] = []
  const client = {
    from: (table: string) => {
      const calls: Call[] = [['from', table]]
      reads.push(calls)
      const result = results[reads.length - 1] ?? { data: [], error: null }
      const builder: Record<string, (...a: unknown[]) => unknown> = {}
      for (const m of ['select', 'eq', 'is', 'gt', 'not', 'order']) {
        builder[m] = (...a: unknown[]) => (calls.push([m, ...a]), builder)
      }
      builder.limit = (...a: unknown[]) => (calls.push(['limit', ...a]), Promise.resolve(result))
      return builder
    },
  }
  return { client: client as unknown as Parameters<typeof fetchScoutsToFollow>[0], reads }
}

/** A list row and its owner. */
function row(username: string, followers: number | null, id = `u-${username}`) {
  return { owner_id: id, owner: { id, username, avatar_url: null, follower_count: followers } }
}

const ok = (rows: unknown[]): Result => ({ data: rows, error: null })

describe('fetchScoutsToFollow — the read', () => {
  it('reads public, live lists with players, filters AI and placeholder handles, orders by followers then latest activity', async () => {
    const { client, reads } = fakeClient(ok([]))
    await fetchScoutsToFollow(client, { ranks: true })

    const calls = reads[0]!
    expect(calls[0]).toEqual(['from', 'lists'])
    const select = String(calls.find((c) => c[0] === 'select')?.[1])
    // Profiles by named columns only (migration 210), joined so the
    // owner's filters drop the list.
    expect(select).toContain('owner:profiles!lists_owner_id_fkey!inner(id, username, avatar_url, follower_count)')
    expect(select).not.toMatch(/\*/)
    expect(calls).toContainEqual(['eq', 'is_private', false])
    expect(calls).toContainEqual(['is', 'deleted_at', null])
    expect(calls).toContainEqual(['gt', 'player_count', 0])
    expect(calls).toContainEqual(['not', 'owner.username', 'ilike', '%-ai'])
    expect(calls).toContainEqual(['not', 'owner.username', 'match', PLACEHOLDER_HANDLE_PATTERN])
    expect(calls.filter((c) => c[0] === 'order')).toEqual([
      ['order', 'owner(follower_count)', { ascending: false, nullsFirst: false }],
      ['order', 'updated_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
    ])
    expect(calls.at(-1)).toEqual(['limit', SCOUTS_PAGE_SIZE])
    // Rankings on: a ranking counts as something Community shows.
    expect(calls.some((c) => c[0] === 'not' && c[1] === 'is_big_board')).toBe(false)
  })

  it('while rankings are off, only a list counts (no big board, weekly board or AI board) — what Community shows', async () => {
    const { client, reads } = fakeClient(ok([]))
    await fetchScoutsToFollow(client, { ranks: false })
    const calls = reads[0]!
    expect(calls).toContainEqual(['gt', 'player_count', 0])
    expect(calls).toContainEqual(['not', 'is_big_board', 'is', true])
    expect(calls).toContainEqual(['not', 'slug', 'match', WEEKLY_BOARD_PATTERN])
    expect(calls).toContainEqual(['is', 'ai_persona_id', null])
  })

  it('fails loudly on a read error instead of returning an empty board', async () => {
    const { client } = fakeClient({ data: null, error: new Error('boom') })
    await expect(fetchScoutsToFollow(client, { ranks: false })).rejects.toThrow('boom')
  })
})

describe('fetchScoutsToFollow — the people', () => {
  it('each person once, in the order the lists came (followers, then latest activity), with their follower count', async () => {
    const { client } = fakeClient(
      ok([row('kelly', 12), row('kelly', 12), row('ortiz', 3), row('me', 3), row('ortiz', 3), row('sam', null)]),
    )
    expect(await fetchScoutsToFollow(client, { ranks: false })).toEqual([
      { id: 'u-kelly', username: 'kelly', avatar_url: null, followers: 12 },
      { id: 'u-ortiz', username: 'ortiz', avatar_url: null, followers: 3 },
      { id: 'u-me', username: 'me', avatar_url: null, followers: 3 },
      // No count stored reads as none.
      { id: 'u-sam', username: 'sam', avatar_url: null, followers: 0 },
    ])
  })

  it('never an AI account or a placeholder handle, even if the read let one through', async () => {
    const { client } = fakeClient(
      ok([
        row('fieldscout-ai', 900),
        row('waiver-wizard-ai', 400),
        row('Gridiron-AI', 300),
        row('user_1a2b3c4d', 50),
        row('kelly', 12),
      ]),
    )
    const scouts = await fetchScoutsToFollow(client, { ranks: true })
    expect(scouts.map((s) => s.username)).toEqual(['kelly'])
  })

  it('stops at five people', async () => {
    const { client, reads } = fakeClient(ok(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => row(u, 1))))
    const scouts = await fetchScoutsToFollow(client, { ranks: false })
    expect(scouts.map((s) => s.username)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(scouts).toHaveLength(SCOUTS_TO_FOLLOW_SIZE)
    expect(reads).toHaveLength(1)
  })

  it('reads on past a full page, leaving out everyone already met, until it has five or the lists run out', async () => {
    // One scout's lists fill the first page; the next read leaves them out.
    const prolific = Array.from({ length: SCOUTS_PAGE_SIZE }, () => row('kelly', 40))
    const { client, reads } = fakeClient(ok(prolific), ok([row('ortiz', 2), row('me', 1)]))
    const scouts = await fetchScoutsToFollow(client, { ranks: false })
    expect(scouts.map((s) => s.username)).toEqual(['kelly', 'ortiz', 'me'])
    expect(reads).toHaveLength(2)
    expect(reads[0]!.some((c) => c[0] === 'not' && c[1] === 'owner_id')).toBe(false)
    expect(reads[1]).toContainEqual(['not', 'owner_id', 'in', '(u-kelly)'])
  })

  it('a short page is the end: fewer than five is everyone there is', async () => {
    const { client, reads } = fakeClient(ok([row('kelly', 1)]))
    expect((await fetchScoutsToFollow(client, { ranks: false })).map((s) => s.username)).toEqual(['kelly'])
    expect(reads).toHaveLength(1)
  })

  it('a failed later read throws too — never a quietly short board', async () => {
    const prolific = Array.from({ length: SCOUTS_PAGE_SIZE }, () => row('kelly', 40))
    const { client } = fakeClient(ok(prolific), { data: null, error: new Error('page two') })
    await expect(fetchScoutsToFollow(client, { ranks: false })).rejects.toThrow('page two')
  })
})

describe('hiddenFromScouts', () => {
  it.each(['fieldscout-ai', 'waiver-wizard-ai', 'Scout-AI', 'user_1a2b3c4d', 'user_00000000'])('%s is never suggested', (u) => {
    expect(hiddenFromScouts(u)).toBe(true)
  })

  it.each(['kelly', 'chrisdaltas', 'aiden', 'kai', 'user_1a2b3c4', 'user_1a2b3c4d5', 'user_name', 'dev_user'])(
    '%s can be',
    (u) => {
      expect(hiddenFromScouts(u)).toBe(false)
    },
  )
})

describe('followersLabel', () => {
  it('says "1 follower", then "N followers"', () => {
    expect(followersLabel(0)).toBe('0 followers')
    expect(followersLabel(1)).toBe('1 follower')
    expect(followersLabel(12)).toBe('12 followers')
    expect(followersLabel(1204)).toBe('1,204 followers')
  })
})
