/**
 * The Latest page (Chris, 2026-10-16: "a see all latest that would go to a
 * page with a simple literal most recent"). Pinned: Back + "Latest", Back
 * goes where you came from else Community (gap list #27); the rows in the
 * read's order (newest posted first), each opening its detail over this
 * page; paging (more as you scroll, a "Load more" by hand, a failed page
 * says so); and the loading, empty and error states.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunityItem } from '@/hooks/use-mobile-community-feed'

const h = vi.hoisted(() => ({
  flags: { weeklyRanks: true, personas: false, messages: false, leagues: false },
  goBack: vi.fn(),
  back: undefined as (() => void) | undefined,
  feed: {} as Record<string, unknown>,
}))

vi.mock('@/lib/feature-flags', () => ({ featureFlags: h.flags }))
vi.mock('@/components/mobile/ui/back-nav', () => ({ useGoBack: () => h.goBack }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore/latest',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-community-latest', () => ({ useCommunityLatest: () => h.feed }))
vi.mock('@/components/mobile/ui/mobile-header', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/mobile/ui/mobile-header')>()
  return {
    ...mod,
    RoundNavButton: (props: Parameters<typeof mod.RoundNavButton>[0]) => {
      h.back = props.onClick
      return mod.RoundNavButton(props)
    },
  }
})

import { MobileCommunityLatest } from './latest-screen'

const NOW = Date.parse('2026-10-15T12:00:00Z')

function item(id: string, over: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id,
    title: `Title ${id}`,
    slug: id,
    description: null,
    kind: 'list',
    rankType: null,
    positionFilter: 'WR',
    scoring: 'Half PPR',
    scoringFormat: 'half',
    playerCount: 3,
    likeCount: 0,
    recentLikes: [],
    createdAt: '2026-10-15T11:35:00Z',
    updatedAt: '2026-10-15T11:35:00Z',
    thumbnailUrl: null,
    ownerUsername: 'kelly',
    author: { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 10, isPersona: false },
    heads: [],
    tags: [],
    videos: [],
    ...over,
  }
}

function setFeed(over: Record<string, unknown>) {
  h.feed = {
    data: undefined,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    dataUpdatedAt: NOW,
    ...over,
  }
}

const render = () =>
  renderToStaticMarkup(createElement(MobileCommunityLatest, { currentWeek: 6 })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"')

beforeEach(() => {
  h.flags.weeklyRanks = true
  h.goBack.mockClear()
  h.back = undefined
  setFeed({})
})

describe('the Latest page', () => {
  it('Back + "Latest"; Back goes where you came from, else to Community', () => {
    const out = render()
    expect(out).toMatch(/<h2[^>]*>Latest<\/h2>/)
    expect(out).toContain('aria-label="Back"')
    h.back!()
    expect(h.goBack).toHaveBeenCalledWith('/app/explore')
  })

  it('every row in the read’s order — newest posted first — each opening over this page', () => {
    setFeed({
      data: {
        pages: [
          { items: [item('a', { createdAt: '2026-10-15T11:35:00Z' }), item('b', { kind: 'rank', createdAt: '2026-10-15T09:00:00Z' })], next: 20 },
          // A post between reads pushed `b` onto page 2 as well: shown once.
          { items: [item('b', { kind: 'rank' }), item('c', { createdAt: '2026-10-13T12:00:00Z' })], next: null },
        ],
      },
    })
    const out = render()
    const hrefs = [...out.matchAll(/href="(\/app\/explore\/latest\?list=[^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual(['/app/explore/latest?list=a', '/app/explore/latest?list=b', '/app/explore/latest?list=c'])
    expect(out).toContain('@kelly · List · 25m')
    expect(out).toContain('@kelly · Ranking · 3h')
    expect(out).toContain('@kelly · List · 2d')
    // The end: nothing more to load.
    expect(out).not.toContain('Load more')
    expect(out).not.toContain('aria-busy')
  })

  it('rankings stay out while their switch is off', () => {
    h.flags.weeklyRanks = false
    setFeed({ data: { pages: [{ items: [item('a'), item('r', { kind: 'rank' })], next: null }] } })
    const out = render()
    expect(out).toContain('?list=a')
    expect(out).not.toContain('?list=r')
  })

  it('more to read: a "Load more" button (the end of the list also loads it as you scroll)', () => {
    const fetchNextPage = vi.fn()
    setFeed({ data: { pages: [{ items: [item('a')], next: 20 }] }, hasNextPage: true, fetchNextPage })
    expect(render()).toMatch(/<button[^>]*>Load more<\/button>/)
  })

  it('reading the next page: rows loading under the list', () => {
    setFeed({ data: { pages: [{ items: [item('a')], next: 20 }] }, hasNextPage: true, isFetchingNextPage: true })
    const out = render()
    expect(out).toContain('aria-label="Loading more"')
    expect(out).not.toContain('Load more<')
  })

  it('a next page that failed says so and offers a retry — the rows already shown stay', () => {
    setFeed({ data: { pages: [{ items: [item('a')], next: 20 }] }, isError: true, hasNextPage: true, isFetchNextPageError: true })
    const out = render()
    expect(out).toContain('?list=a')
    expect(out).toContain('Couldn’t load more.')
    expect(out).toContain('Try again')
    expect(out).not.toContain('Couldn’t load the latest lists')
  })

  it('loading: rows loading', () => {
    expect(render()).toContain('aria-label="Loading the latest lists"')
  })

  it('error: says so, with a retry — never an empty list', () => {
    setFeed({ isError: true })
    const out = render()
    expect(out).toContain('Couldn’t load the latest lists. Check your connection and try again.')
    expect(out).toContain('Try again')
    expect(out).not.toContain('No lists')
  })

  it('empty: nothing posted yet, with a way to post', () => {
    setFeed({ data: { pages: [{ items: [], next: null }] } })
    let out = render()
    expect(out).toContain('No lists or rankings yet')
    expect(out).toContain('Create a list')
    h.flags.weeklyRanks = false
    out = render()
    expect(out).toContain('No lists yet')
  })

  it('a page of nothing but switched-off rankings, with more to read, keeps loading — not "empty"', () => {
    h.flags.weeklyRanks = false
    setFeed({ data: { pages: [{ items: [item('r', { kind: 'rank' })], next: 20 }] }, hasNextPage: true })
    const out = render()
    expect(out).not.toContain('No lists yet')
    expect(out).toContain('aria-label="Loading more"')
  })
})
