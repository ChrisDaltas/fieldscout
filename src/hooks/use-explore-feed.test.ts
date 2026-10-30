/**
 * The desktop Community feed (plan C3: readiness B2, S8, S14, F12). Pinned:
 *  - what shows, filtered IN the read on every tab and page: lists with
 *    players (never an empty "My Big Board"), and while rankings are off
 *    (`ranksOn()`) no big boards, weekly boards or AI experts' boards — the
 *    phone's own split; with rankings on, those come back;
 *  - the "Ranking" badge is `classifyCommunityList`'s, not "numbered";
 *  - Newest / Following page by `.range()`, one row past the page, so
 *    "Load more" is offered only when there is more — never a stop at 30;
 *  - Popular is the phone's For you order (popular + recent, ruling #35) over
 *    the same candidates, then the older lists past them in update order;
 *  - a failed read throws — the viewer's likes included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}
const h = vi.hoisted(() => ({
  flags: { weeklyRanks: false },
  user: { id: 'viewer' } as { id: string } | null,
}))
const calls: Call[] = []
let answer: (call: Call) => { data: unknown; error: unknown } = () => ({ data: [], error: null })

vi.mock('@/lib/feature-flags', () => ({ featureFlags: h.flags }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }),
}))

import { POPULAR, WEEKLY_BOARD_PATTERN, sortPopular } from '@/components/mobile/community/community-ops'

import {
  EXPLORE_FEED_START,
  EXPLORE_PAGE_SIZE,
  FEED_SELECT,
  exploreFeedItems,
  readExploreFeedPage,
  withLikeCount,
  type ExploreFeedPage,
  type ExploreFeedPageParam,
} from './use-explore-feed'
import { COMMUNITY_POOL_SIZE } from './use-mobile-community-feed'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const listReads = () => calls.filter((c) => c.table === 'lists')
/** The likes window read (every recent like) vs the viewer's own likes. */
const isRecentLikes = (call: Call) => call.table === 'list_likes' && op(call, 'gte').length > 0
const isViewerLikes = (call: Call) => call.table === 'list_likes' && op(call, 'gte').length === 0
const mainOrders = (call: Call) =>
  op(call, 'order').filter(([, o]) => !(o as { referencedTable?: string } | undefined)?.referencedTable)

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    is_big_board: false,
    ai_persona_id: null,
    like_count: 0,
    player_count: 5,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    owner: { id: `u-${id}`, username: `user${id}`, avatar_url: null },
    persona: null,
    comments: [{ count: 2 }],
    tag_links: [],
    ...over,
  }
}
const rows = (n: number, over: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => row(`r${i}`, over(i)))

beforeEach(() => {
  calls.length = 0
  h.flags.weeklyRanks = false
  h.user = { id: 'viewer' }
  answer = () => ({ data: [], error: null })
})

describe('what the feed shows — filtered in the read', () => {
  it.each(['popular', 'newest', 'following'] as const)(
    '%s: lists with players, and no rankings while they are switched off',
    async (tab) => {
      answer = (call) =>
        call.table === 'follows' ? { data: [{ following_id: 'u-a' }], error: null } : { data: [], error: null }
      await readExploreFeedPage(tab, null, EXPLORE_FEED_START, NOW)
      const reads = listReads()
      expect(reads.length).toBeGreaterThan(0)
      for (const call of reads) {
        expect(op(call, 'eq')).toContainEqual(['is_private', false])
        expect(op(call, 'is')).toContainEqual(['deleted_at', null])
        expect(op(call, 'gt')).toContainEqual(['player_count', 0])
        // The phone's split: not the season board, not a weekly board, not
        // an AI expert's board.
        expect(op(call, 'not')).toContainEqual(['is_big_board', 'is', true])
        expect(op(call, 'not')).toContainEqual(['slug', 'match', WEEKLY_BOARD_PATTERN])
        expect(op(call, 'is')).toContainEqual(['ai_persona_id', null])
      }
    },
  )

  it.each(['popular', 'newest', 'following'] as const)(
    '%s: rankings switched on — big boards, weekly and AI boards come back; empty lists still never do',
    async (tab) => {
      h.flags.weeklyRanks = true
      answer = (call) =>
        call.table === 'follows' ? { data: [{ following_id: 'u-a' }], error: null } : { data: [], error: null }
      await readExploreFeedPage(tab, null, EXPLORE_FEED_START, NOW)
      for (const call of listReads()) {
        expect(op(call, 'gt')).toContainEqual(['player_count', 0])
        expect(op(call, 'not')).toEqual([])
        expect(op(call, 'is')).not.toContainEqual(['ai_persona_id', null])
      }
    },
  )

  it('reads is_big_board (the badge needs it) and updated_at (Popular needs it)', async () => {
    await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    expect(op(listReads()[0]!, 'select')).toEqual([[FEED_SELECT]])
    expect(FEED_SELECT).toMatch(/\bis_big_board\b/)
    expect(FEED_SELECT).toMatch(/\bupdated_at\b/)
    // Never a column a migration not yet pushed adds.
    expect(FEED_SELECT).not.toMatch(/cover_color|scoring_format|comments_enabled/)
  })

  it('a topic chip filters inside the read too', async () => {
    await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    calls.length = 0
    await readExploreFeedPage('newest', 'tag-1', EXPLORE_FEED_START, NOW)
    const call = listReads()[0]!
    expect(String(op(call, 'select')[0]![0])).toContain('tag_filter:list_tags!inner(tag_id)')
    expect(op(call, 'eq')).toContainEqual(['tag_filter.tag_id', 'tag-1'])
  })
})

describe('the tags a row carries (the topic chips are drawn from them)', () => {
  it('every tag, with its id; the row shows the first', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? {
            data: [
              row('two', {
                tag_links: [
                  { tag: { id: 't-sleep', name: 'Sleepers', slug: 'sleepers' } },
                  { tag: [{ id: 't-dyn', name: 'Dynasty', slug: 'dynasty' }] },
                  { tag: null },
                ],
              }),
              row('none'),
            ],
            error: null,
          }
        : { data: [], error: null }
    const page = await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    const byId = Object.fromEntries(page.items.map((i) => [i.id, i]))
    expect(byId.two!.tags).toEqual([
      { id: 't-sleep', name: 'Sleepers', slug: 'sleepers' },
      { id: 't-dyn', name: 'Dynasty', slug: 'dynasty' },
    ])
    expect(byId.two!.tag).toEqual({ name: 'Sleepers', slug: 'sleepers' })
    expect(byId.none!.tags).toEqual([])
    expect(byId.none!.tag).toBeNull()
    expect(FEED_SELECT).toContain('tag_links:list_tags(tag:tags(id, name, slug))')
  })
})

describe('the badge', () => {
  it('"Ranking" only for a ranking product — a numbered list is a list', async () => {
    h.flags.weeklyRanks = true
    answer = (call) =>
      call.table === 'lists'
        ? {
            data: [
              // Numbered (the default for a new list) — still a list.
              row('plain', { ranking_mode: 'ranked' }),
              row('board', { is_big_board: true, slug: 'big-board' }),
              row('week', { slug: 'week-6-big-board-1760000000000' }),
              row('ai', {
                ai_persona_id: 'p1',
                persona: { username: 'expert-ai', display_name: 'Expert (AI)', avatar_url: null },
              }),
            ],
            error: null,
          }
        : { data: [], error: null }
    const page = await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    const byId = Object.fromEntries(page.items.map((i) => [i.id, i]))
    expect(byId.plain!.is_ranking).toBe(false)
    expect(byId.board!.is_ranking).toBe(true)
    expect(byId.week!.is_ranking).toBe(true)
    expect(byId.ai!.is_ranking).toBe(true)
    expect(byId.ai!.is_ai).toBe(true)
    expect(byId.ai!.author_id).toBeNull()
  })
})

describe('Newest and Following — paged, never a silent stop', () => {
  it('Newest: newest posted first, a total order, one row past the page', async () => {
    answer = (call) => (call.table === 'lists' ? { data: rows(EXPLORE_PAGE_SIZE + 1), error: null } : { data: [], error: null })
    const page = await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    const call = listReads()[0]!
    expect(mainOrders(call)).toEqual([
      ['created_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ])
    expect(op(call, 'range')).toEqual([[0, EXPLORE_PAGE_SIZE]])
    expect(page.items).toHaveLength(EXPLORE_PAGE_SIZE)
    expect(page.next).toEqual({ at: 'offset', from: EXPLORE_PAGE_SIZE })
  })

  it('Load more reads the next page; a page with nothing past it is the last', async () => {
    answer = (call) => (call.table === 'lists' ? { data: rows(EXPLORE_PAGE_SIZE), error: null } : { data: [], error: null })
    const page = await readExploreFeedPage('newest', null, { at: 'offset', from: EXPLORE_PAGE_SIZE }, NOW)
    expect(op(listReads()[0]!, 'range')).toEqual([[EXPLORE_PAGE_SIZE, 2 * EXPLORE_PAGE_SIZE]])
    expect(page.items).toHaveLength(EXPLORE_PAGE_SIZE)
    expect(page.next).toBeNull()
  })

  it('Following: the people you follow; following nobody reads no lists', async () => {
    answer = (call) =>
      call.table === 'follows'
        ? { data: [{ following_id: 'u-a' }, { following_id: 'u-b' }], error: null }
        : { data: [], error: null }
    await readExploreFeedPage('following', null, EXPLORE_FEED_START, NOW)
    expect(op(listReads()[0]!, 'in')).toContainEqual(['owner_id', ['u-a', 'u-b']])

    calls.length = 0
    answer = () => ({ data: [], error: null })
    const none = await readExploreFeedPage('following', null, EXPLORE_FEED_START, NOW)
    expect(none).toEqual({ items: [], next: null })
    expect(listReads()).toHaveLength(0)
  })

  it('each list shows once across pages (a list posted between reads shifts the offset)', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ id }) as ExploreFeedPage['items'][number])
    const pages: ExploreFeedPage[] = [
      { items: [a!, b!], next: { at: 'offset', from: 2 } },
      { items: [b!, c!], next: null },
    ]
    expect(exploreFeedItems(pages).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('Popular — the phone’s For you order', () => {
  it('a list liked lately rises over one with more likes long ago, exactly as For you orders them', async () => {
    const lists = [
      row('old-favourite', { like_count: 40, updated_at: iso(NOW - 60 * DAY) }),
      row('fresh', { like_count: 0, updated_at: iso(NOW - 2 * 60 * 60 * 1000) }),
      row('liked-lately', { like_count: 3, updated_at: iso(NOW - 20 * DAY) }),
    ]
    const likes = [
      { list_id: 'liked-lately', user_id: 'x', created_at: iso(NOW - 60 * 60 * 1000) },
      { list_id: 'liked-lately', user_id: 'y', created_at: iso(NOW - 2 * 60 * 60 * 1000) },
      { list_id: 'liked-lately', user_id: 'z', created_at: iso(NOW - DAY) },
    ]
    answer = (call) =>
      call.table === 'lists'
        ? { data: lists, error: null }
        : isRecentLikes(call)
          ? { data: likes, error: null }
          : { data: [], error: null }
    const page = await readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)

    // The phone's own ranking of the same lists.
    const forYou = sortPopular(
      lists.map((r) => ({
        id: r.id,
        likeCount: r.like_count,
        recentLikes: likes.filter((l) => l.list_id === r.id).map((l) => Date.parse(l.created_at)),
        updatedAt: r.updated_at,
      })),
      NOW,
    ).map((i) => i.id)
    expect(page.items.map((i) => i.id)).toEqual(forYou)
    expect(forYou[0]).toBe('liked-lately')
    expect(forYou.indexOf('old-favourite')).toBe(2)
  })

  it('reads the candidates For you reads: the most recently updated lists, and every like of the window', async () => {
    await readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)
    const pool = listReads()[0]!
    expect(mainOrders(pool)).toEqual([
      ['updated_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ])
    expect(op(pool, 'limit')).toContainEqual([COMMUNITY_POOL_SIZE])
    const window = calls.find(isRecentLikes)!
    expect(op(window, 'gte')).toEqual([
      ['created_at', iso(NOW - POPULAR.LIKE_WINDOW_DAYS * DAY)],
    ])
  })

  it('a list liked lately that the newest lists left out joins the candidates, through the same filters', async () => {
    answer = (call) => {
      if (call.table === 'lists' && op(call, 'in').length > 0) return { data: [row('liked-elsewhere', { like_count: 1 })], error: null }
      if (call.table === 'lists') return { data: [row('a')], error: null }
      if (isRecentLikes(call)) return { data: [{ list_id: 'liked-elsewhere', user_id: 'x', created_at: iso(NOW - 1000) }], error: null }
      return { data: [], error: null }
    }
    const page = await readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)
    const extra = listReads().find((c) => op(c, 'in').length > 0)!
    expect(op(extra, 'in')).toEqual([['id', ['liked-elsewhere']]])
    expect(op(extra, 'gt')).toContainEqual(['player_count', 0])
    expect(op(extra, 'not')).toContainEqual(['is_big_board', 'is', true])
    expect(page.items.map((i) => i.id)).toEqual(['liked-elsewhere', 'a'])
  })

  it('Load more walks the candidates in order, then the older lists past them — every list, never a stop', async () => {
    // A full pool: older lists exist past it.
    const pool = rows(COMMUNITY_POOL_SIZE, (i) => ({ updated_at: iso(NOW - (i + 1) * 60 * 1000) }))
    answer = (call) => (call.table === 'lists' ? { data: pool, error: null } : { data: [], error: null })
    const seen: string[] = []
    let page = await readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)
    seen.push(...page.items.map((i) => i.id))
    expect(page.items).toHaveLength(EXPLORE_PAGE_SIZE)

    // The candidates' remaining pages read no lists — only the viewer's likes.
    while (page.next?.at === 'ranked') {
      calls.length = 0
      page = await readExploreFeedPage('popular', null, page.next, NOW)
      seen.push(...page.items.map((i) => i.id))
      expect(listReads()).toHaveLength(0)
      expect(calls.filter(isViewerLikes)).toHaveLength(1)
    }
    expect(seen).toEqual(pool.map((r) => r.id))

    // Then the older lists, after the pool's last row in its order.
    const older = page.next as Extract<ExploreFeedPageParam, { at: 'older' }>
    expect(older).toEqual({ at: 'older', after: { updatedAt: pool.at(-1)!.updated_at, id: pool.at(-1)!.id }, exclude: [] })
    calls.length = 0
    answer = (call) => (call.table === 'lists' ? { data: rows(EXPLORE_PAGE_SIZE + 1, (i) => ({ updated_at: iso(NOW - (200 + i) * 60 * 1000) })), error: null } : { data: [], error: null })
    page = await readExploreFeedPage('popular', null, older, NOW)
    const read = listReads()[0]!
    expect(op(read, 'or')[0]![0]).toContain(`id.lt.${pool.at(-1)!.id}`)
    expect(op(read, 'gt')).toContainEqual(['player_count', 0])
    expect(op(read, 'limit')).toContainEqual([EXPLORE_PAGE_SIZE + 1])
    expect(page.items).toHaveLength(EXPLORE_PAGE_SIZE)
    expect(page.next).toMatchObject({ at: 'older' })
  })

  it('the older lists leave out the liked-lately lists the candidates already showed', async () => {
    const param: ExploreFeedPageParam = { at: 'older', after: { updatedAt: '2026-10-01T00:00:00Z', id: 'z' }, exclude: ['e1', 'e2'] }
    await readExploreFeedPage('popular', null, param, NOW)
    expect(op(listReads()[0]!, 'not')).toContainEqual(['id', 'in', '(e1,e2)'])
  })

  it('a pool that holds every list has no older read', async () => {
    answer = (call) => (call.table === 'lists' ? { data: rows(12), error: null } : { data: [], error: null })
    const page = await readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)
    expect(page.items).toHaveLength(12)
    expect(page.next).toBeNull()
  })
})

describe('loud failure', () => {
  it('a failed lists read throws', async () => {
    answer = (call) => (call.table === 'lists' ? { data: null, error: { message: 'boom' } } : { data: [], error: null })
    await expect(readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)).rejects.toMatchObject({ message: 'boom' })
  })

  it('a failed read of the viewer’s likes throws — never every list shown unliked', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? { data: [row('a')], error: null }
        : isViewerLikes(call)
          ? { data: null, error: { message: 'likes down' } }
          : { data: [], error: null }
    await expect(readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)).rejects.toMatchObject({ message: 'likes down' })
  })

  it('a failed likes window read fails Popular (no silent "no likes")', async () => {
    answer = (call) => (isRecentLikes(call) ? { data: null, error: { message: 'window down' } } : { data: [], error: null })
    await expect(readExploreFeedPage('popular', null, EXPLORE_FEED_START, NOW)).rejects.toMatchObject({ message: 'window down' })
  })

  it('the viewer’s liked lists render liked', async () => {
    answer = (call) =>
      call.table === 'lists'
        ? { data: [row('a'), row('b')], error: null }
        : isViewerLikes(call)
          ? { data: [{ list_id: 'b' }], error: null }
          : { data: [], error: null }
    const page = await readExploreFeedPage('newest', null, EXPLORE_FEED_START, NOW)
    expect(page.items.map((i) => [i.id, i.is_liked])).toEqual([
      ['a', false],
      ['b', true],
    ])
  })
})

describe('the like count written back', () => {
  it('updates the list on every loaded page, nothing else', () => {
    const a = { id: 'a', like_count: 1 } as ExploreFeedPage['items'][number]
    const b = { id: 'b', like_count: 5 } as ExploreFeedPage['items'][number]
    const data = { pages: [{ items: [a], next: null }, { items: [b], next: null }], pageParams: [EXPLORE_FEED_START, EXPLORE_FEED_START] }
    const out = withLikeCount(data, 'b', 6)!
    expect(out.pages[0]!.items[0]!.like_count).toBe(1)
    expect(out.pages[1]!.items[0]!.like_count).toBe(6)
    expect(withLikeCount(undefined, 'b', 6)).toBeUndefined()
  })
})
