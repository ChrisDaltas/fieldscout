/**
 * The desktop Community feed's screen (plan C3: readiness S8, S14, F12).
 * Pinned:
 *  - the tabs are Popular · Newest · Following ("Trending", all-time likes,
 *    is gone);
 *  - "Load more" whenever another page exists — "Loading…" while it reads, a
 *    failed page says so with Try again and keeps the rows already shown;
 *  - the empty feed offers New list (the shell's New list dialog);
 *  - a failed first read says "Couldn't load", never an empty feed;
 *  - the badge reads the item's kind: an ordinary list is a "List";
 *  - the topic chips are only trending tags a list on the feed carries
 *    (plan C4), so a chip never opens an empty feed;
 *  - a row's Like keeps keyboard focus through a like — never remounted,
 *    never turned disabled while it's in flight — and re-seeds from the feed's liked state, so a like made on the list's own
 *    page (plan C5) shows on the row;
 *  - a failed Like or Follow shows the error toast (the toast is checked as
 *    what it hands the toaster; the wiring is a source pin, as the click
 *    can't run in a static render).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExploreFeedItem, ExploreFeedPage } from '@/hooks/use-explore-feed'

const h = vi.hoisted(() => ({
  feed: {} as Record<string, unknown>,
  tags: [] as { id: string; name: string; slug: string }[],
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ setQueriesData: () => {} }),
}))
vi.mock('@/hooks/use-explore-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-explore-feed')>()),
  useExploreFeed: () => h.feed,
}))
vi.mock('@/hooks/use-tags', () => ({ useTags: () => ({ data: { tags: h.tags } }) }))
vi.mock('@/hooks/use-lists', () => ({ useToggleLike: () => ({ mutate: () => {}, isPending: false }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'viewer' }, profile: null }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/u/${u}` }))
vi.mock('@/hooks/use-toast', () => ({ toast: (arg: unknown) => h.toast(arg) }))

import { toastFollowFailed } from './follow-button'
import { ExploreFeed, feedTopics, toastLikeFailed } from './explore-feed'

function item(id: string, over: Partial<ExploreFeedItem> = {}): ExploreFeedItem {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    is_ranking: false,
    is_ai: false,
    like_count: 3,
    comment_count: 1,
    player_count: 5,
    created_at: '2026-10-01T00:00:00Z',
    author: { name: null, handle: `user${id}`, avatar_url: null },
    href: `/u/user${id}/lists/${id}`,
    author_href: `/u/user${id}`,
    author_id: `u-${id}`,
    is_liked: false,
    tag: null,
    tags: [],
    ...over,
  }
}

function setFeed(pages: ExploreFeedPage[] | undefined, over: Record<string, unknown> = {}) {
  h.feed = {
    data: pages ? { pages, pageParams: pages.map(() => ({ at: 'start' })) } : undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...over,
  }
}

const render = () =>
  renderToStaticMarkup(createElement(ExploreFeed)).replace(/&#x27;/g, "'").replace(/&quot;/g, '"')

const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, before) => before ?? '')

beforeEach(() => {
  h.toast.mockClear()
  h.tags = []
  setFeed([{ items: [item('a'), item('b')], next: null }])
})

describe('the tabs', () => {
  it('Popular · Newest · Following, Popular first — no Trending', () => {
    const out = render()
    expect(out).toContain('>Popular<')
    expect(out).not.toContain('Trending')
    expect(out.indexOf('>Popular<')).toBeLessThan(out.indexOf('>Newest<'))
    expect(out.indexOf('>Newest<')).toBeLessThan(out.indexOf('>Following<'))
  })
})

describe('Load more — never a silent stop', () => {
  it('shown while another page exists, under the rows', () => {
    setFeed([{ items: [item('a')], next: { at: 'offset', from: 30 } }], { hasNextPage: true })
    const out = render()
    expect(out).toContain('data-feed-more')
    expect(out).toContain('>Load more<')
    expect(out.indexOf('List a')).toBeLessThan(out.indexOf('>Load more<'))
  })

  it('gone on the last page', () => {
    expect(render()).not.toContain('Load more')
  })

  it('“Loading…” while the next page reads', () => {
    setFeed([{ items: [item('a')], next: { at: 'offset', from: 30 } }], { hasNextPage: true, isFetchingNextPage: true })
    const out = render()
    expect(out).toContain('>Loading…<')
    expect(out).not.toContain('>Load more<')
  })

  it('a failed page says so, offers Try again, and keeps the rows already shown', () => {
    setFeed([{ items: [item('a')], next: { at: 'offset', from: 30 } }], {
      hasNextPage: true,
      isError: true,
      isFetchNextPageError: true,
    })
    const out = render()
    expect(out).toContain('List a')
    expect(out).toContain('>Try again<')
    expect(out).toContain('Couldn\'t load more.')
  })

  it('the rows of every page show, each list once', () => {
    setFeed(
      [
        { items: [item('a'), item('b')], next: { at: 'offset', from: 2 } },
        { items: [item('b'), item('c')], next: null },
      ],
    )
    const out = render()
    expect(out.match(/List b</g)).toHaveLength(1)
    expect(out).toContain('List c')
  })
})

describe('empty and error', () => {
  it('the empty feed offers New list', () => {
    setFeed([{ items: [], next: null }])
    const out = render()
    expect(out).toContain('data-feed-empty')
    expect(out).toContain('No public lists yet')
    expect(out).toContain('New list')
    // Lists are public by default — the old "set it to public" was wrong.
    expect(out).not.toContain('set it to public')
  })

  it('the New list button opens the shell’s New list dialog', () => {
    expect(code('src/components/explore/explore-feed.tsx')).toMatch(/onClick=\{\(\) => openCreateList\(true\)\}/)
    expect(code('src/components/explore/explore-feed.tsx')).toMatch(/useUIStore\(\(s\) => s\.setCreateListOpen\)/)
  })

  it('a failed first read says “Couldn’t load” with Try again — never an empty feed', () => {
    setFeed(undefined, { isError: true })
    const out = render()
    expect(out).toContain('Couldn\'t load the feed')
    expect(out).toContain('>Try again<')
    expect(out).not.toContain('No public lists yet')
    expect(out).not.toContain('New list')
  })
})

describe('the topic chips: only tags a list on the feed carries (plan C4)', () => {
  const tag = (id: string, name: string) => ({ id, name, slug: name.toLowerCase() })
  const SLEEPERS = tag('t-sleep', 'Sleepers')
  const BUSTS = tag('t-busts', 'Busts')
  const ROOKIES = tag('t-rook', 'Rookies')
  const DFS = tag('t-dfs', 'DFS')
  /** Most used first, as /api/tags?trending=true answers. */
  const TRENDING = [SLEEPERS, BUSTS, ROOKIES, DFS]
  const chips = (out: string) =>
    (out.match(/aria-label="Filter by topic"[\s\S]*?<\/div>/)?.[0] ?? '')
      .split('<button')
      .slice(1)
      .map((b) => b.replace(/<[^>]+>/g, '').replace(/^[^>]*>/, '').trim())

  it('a trending tag that no list on the feed carries gets no chip; the rest keep the trending order', () => {
    h.tags = TRENDING
    setFeed([{ items: [item('a', { tags: [ROOKIES] }), item('b', { tags: [DFS, SLEEPERS] })], next: null }])
    expect(chips(render())).toEqual(['All', 'Sleepers', 'Rookies', 'DFS'])
  })

  it('no list carries a trending tag: no chip row at all (not an "All" alone)', () => {
    h.tags = TRENDING
    setFeed([{ items: [item('a'), item('b')], next: null }])
    expect(render()).not.toContain('Filter by topic')
  })

  it('the feed not read yet: no chips (never a guess)', () => {
    h.tags = TRENDING
    setFeed(undefined, { isPending: true })
    expect(render()).not.toContain('Filter by topic')
  })

  it('six at most', () => {
    const many = Array.from({ length: 9 }, (_, i) => tag(`t${i}`, `Tag ${i}`))
    expect(feedTopics(many, [{ tags: many }], null).map((t) => t.label)).toEqual([
      'Tag 0',
      'Tag 1',
      'Tag 2',
      'Tag 3',
      'Tag 4',
      'Tag 5',
    ])
  })

  it('the chip that is on stays, so it can be seen and cleared, even once no row carries it', () => {
    expect(feedTopics(TRENDING, [{ tags: [ROOKIES] }], 't-busts').map((t) => t.id)).toEqual(['t-rook', 't-busts'])
    // Already among the chips: not added twice.
    expect(feedTopics(TRENDING, [{ tags: [ROOKIES] }], 't-rook').map((t) => t.id)).toEqual(['t-rook'])
  })

  it('the chips read the unfiltered Popular feed, whatever tab or chip is on', () => {
    expect(code('src/components/explore/explore-feed.tsx')).toMatch(/useExploreFeed\('popular', null\)/)
  })
})

describe('the badge', () => {
  it('an ordinary list is a “List”; a ranking is a “Ranking”', () => {
    setFeed([{ items: [item('plain'), item('board', { is_ranking: true })], next: null }])
    const out = render()
    expect(out.match(/>List</g)).toHaveLength(1)
    expect(out.match(/>Ranking</g)).toHaveLength(1)
  })
})

describe('Like keeps focus and follows the feed', () => {
  // Source pins, as the click can't run in a static render.
  it('the row renders its Like with no key, so a like from the feed never remounts it (focus stays on the button)', () => {
    const feed = code('src/components/explore/explore-feed.tsx')
    expect(feed).toMatch(/<LikeButton item=\{item\} \/>/)
    expect(feed).not.toMatch(/<LikeButton[^>]*\bkey=/)
  })

  it('a like in flight is held by a guard, not `disabled` (a focused button that turns disabled loses focus)', () => {
    const feed = code('src/components/explore/explore-feed.tsx')
    const button = feed.slice(feed.indexOf('function LikeButton'), feed.indexOf('function FeedRow'))
    expect(button).not.toMatch(/(?<![-\w])disabled=/)
    expect(button).toMatch(/aria-disabled=\{toggleLike\.isPending\}/)
    expect(button).toMatch(/onClick=\{\(\) => \{\s*if \(toggleLike\.isPending\) return/)
  })

  it('the button re-seeds from the feed’s liked state when it changes (a like made on the list’s own page shows on the row)', () => {
    const feed = code('src/components/explore/explore-feed.tsx')
    expect(feed).toMatch(
      /const \[seenLiked, setSeenLiked\] = useState\(item\.is_liked\)\s*if \(item\.is_liked !== seenLiked\) \{\s*setSeenLiked\(item\.is_liked\)\s*setLiked\(item\.is_liked\)\s*setDelta\(0\)\s*\}/,
    )
  })
})

describe('a failed Like or Follow says so', () => {
  it('Like: the error toast, in the phone’s words', () => {
    toastLikeFailed(true)
    toastLikeFailed(false)
    expect(h.toast.mock.calls.map(([arg]) => arg)).toEqual([
      { title: 'Couldn’t like this list', description: 'Try again in a moment.', variant: 'destructive' },
      { title: 'Couldn’t unlike this list', description: 'Try again in a moment.', variant: 'destructive' },
    ])
  })

  it('Follow: the error toast', () => {
    toastFollowFailed(false)
    toastFollowFailed(true)
    expect(h.toast.mock.calls.map(([arg]) => (arg as { title: string; variant: string }).title)).toEqual([
      'Couldn’t follow',
      'Couldn’t unfollow',
    ])
    expect(h.toast.mock.calls.every(([arg]) => (arg as { variant: string }).variant === 'destructive')).toBe(true)
  })

  it('both are wired to the toggle’s failure, which also puts the button back', () => {
    const feed = code('src/components/explore/explore-feed.tsx')
    expect(feed).toMatch(/onError: \(\) => \{\s*setLiked\(!next\)\s*setDelta\(0\)\s*toastLikeFailed\(next\)/)
    expect(code('src/components/explore/follow-button.tsx')).toMatch(
      /toggle\.mutate\(\{ targetId: userId, isFollowing \}, \{ onError: \(\) => toastFollowFailed\(isFollowing\) \}\)/,
    )
  })
})
