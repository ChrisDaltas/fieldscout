/**
 * Desktop Home's shelves (plan C8). Pinned:
 *  - "From the Community" is a card in the hub grid, shown only while
 *    Community is switched on: the Popular feed's lists in Popular's order
 *    (the phone's For you order) — real lists only, at most five — as
 *    Community's own rows, each opening the list inside the app; "See all"
 *    opens Community. Loading shows skeleton rows; a failed read says
 *    "Couldn't load", with Try again; nothing to show leaves the card out;
 *  - the AI experts' boards open where a list opens in the app
 *    (`inAppListHref`): Community's list page while Community is on, the
 *    share page otherwise — and a failed read says so, never a shelf that
 *    quietly isn't there.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExploreFeedItem, ExploreFeedPage } from '@/hooks/use-explore-feed'

const h = vi.hoisted(() => ({
  flags: { community: false, personas: false },
  feed: {} as Record<string, unknown>,
  feedArgs: [] as unknown[][],
  boards: {} as Record<string, unknown>,
  posts: {} as Record<string, unknown>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: h.flags }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ setQueriesData: () => {} }),
}))
vi.mock('@/hooks/use-explore-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-explore-feed')>()),
  useExploreFeed: (...args: unknown[]) => {
    h.feedArgs.push(args)
    return h.feed
  },
}))
vi.mock('@/hooks/use-persona-boards', () => ({
  usePersonaBoards: () => h.boards,
  usePersonaPosts: () => h.posts,
}))
vi.mock('@/hooks/use-tags', () => ({ useTags: () => ({ data: { tags: [] } }) }))
vi.mock('@/hooks/use-lists', () => ({ useToggleLike: () => ({ mutate: () => {}, isPending: false }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'viewer' }, profile: null }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/app/u/${u}` }))

import { AiExpertShelf } from './ai-expert-shelf'
import { HomeCommunityCard } from './home-community-card'

function feedItem(id: string, over: Partial<ExploreFeedItem> = {}): ExploreFeedItem {
  return {
    id,
    title: `List ${id}`,
    slug: id,
    is_ranking: false,
    is_ai: false,
    like_count: 2,
    comment_count: 1,
    player_count: 6,
    created_at: '2026-10-01T00:00:00Z',
    author: { name: null, handle: `user${id}`, avatar_url: null },
    href: `/app/explore?list=${id}`,
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
    isPending: !pages,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...over,
  }
}

const clean = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const renderCard = () => clean(renderToStaticMarkup(createElement(HomeCommunityCard)))
const renderShelf = () => clean(renderToStaticMarkup(createElement(AiExpertShelf)))
const rowIds = (out: string) => [...out.matchAll(/href="\/app\/explore\?list=([^"]+)"/g)].map((m) => m[1])

const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, before) => before ?? '')

beforeEach(() => {
  h.flags.community = false
  h.flags.personas = false
  h.feedArgs = []
  setFeed([{ items: ['a', 'b'].map((id) => feedItem(id)), next: null }])
  h.boards = { data: [], isLoading: false, isError: false, refetch: vi.fn() }
  h.posts = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() }
})

describe('From the Community — the hub grid card (plan C8)', () => {
  it('reads Community’s own Popular feed, unfiltered', () => {
    renderCard()
    expect(h.feedArgs[0]).toEqual(['popular', null])
  })

  it('Popular’s lists in Popular’s order — no rankings, none empty — at most five, as Community’s rows', () => {
    setFeed([
      {
        items: [
          feedItem('a'),
          feedItem('board', { is_ranking: true }),
          feedItem('b'),
          feedItem('empty', { player_count: 0 }),
          feedItem('c'),
          feedItem('d'),
          feedItem('e'),
          feedItem('f'),
        ],
        next: null,
      },
    ])
    const out = renderCard()
    expect(out).toContain('From the Community')
    expect(rowIds(out)).toEqual(['a', 'b', 'c', 'd', 'e'])
    // Community's own row: Like (with its count), the comment count and Follow.
    expect(out).toContain('aria-label="Like List a"')
    expect(out).toContain('>Follow<')
    // The author's handle is a profile link (usernames always link).
    expect(out).toContain('href="/app/u/usera"')
  })

  it('"See all" opens Community', () => {
    expect(renderCard()).toMatch(/<a [^>]*href="\/app\/explore"[^>]*>See all/)
  })

  it('loading: skeleton rows, never a blank card', () => {
    setFeed(undefined)
    const out = renderCard()
    expect(out).toContain('From the Community')
    expect(out).toContain('aria-busy="true"')
  })

  it('a failed read says Couldn’t load, with Try again — never an empty card', () => {
    setFeed(undefined, { isPending: false, isError: true })
    const out = renderCard()
    expect(out).toContain("Couldn't load lists from the Community.")
    expect(out).toContain('role="alert"')
    expect(out).toContain('Try again')
    // The error is red words on the white card, never a red fill.
    expect(out).toContain('text-negative-strong')
    expect(out).not.toMatch(/bg-negative-strong|bg-destructive/)
  })

  it('nothing to show (no lists, or rankings only): no card at all', () => {
    setFeed([{ items: [], next: null }])
    expect(renderCard()).toBe('')
    setFeed([{ items: [feedItem('board', { is_ranking: true })], next: null }])
    expect(renderCard()).toBe('')
  })

  it('no resting elevation: the card and its rows lift nothing until hovered', () => {
    const out = renderCard()
    expect(out).not.toMatch(/(?<![:\w-])shadow-hard/)
  })

  it('sits in the hub grid’s main column, and only while Community is switched on', () => {
    const page = code('src/app/app/(shell)/page.tsx')
    const mounts = page.match(/\{featureFlags\.community && <HomeCommunityCard \/>\}/g) ?? []
    // Both hub grids (leagues on, leagues off) carry it, behind the switch.
    expect(mounts).toHaveLength(2)
    expect(page).not.toMatch(/(?<!featureFlags\.community && )<HomeCommunityCard \/>/)
    // In the main column, right after the column's first card.
    expect(page).toMatch(/<YourLeagues \/>\s*\{featureFlags\.community && <HomeCommunityCard \/>\}/)
    expect(page).toMatch(/<TrendingPlayersCard \/>\s*\{featureFlags\.community && <HomeCommunityCard \/>\}/)
  })
})

describe('From the AI experts — where a board opens (plan C8, inAppListHref)', () => {
  const board = {
    id: 'b1',
    title: 'Week 9 RB rankings',
    slug: 'week-9-rb-rankings',
    description: null,
    position_filter: 'RB',
    player_count: 24,
    updated_at: new Date().toISOString(),
    persona: { username: 'bathew', display_name: 'Bathew Merry', avatar_url: null },
    owner: { username: 'fieldscout-ai' },
  }

  it('Community off: the share page, as before', () => {
    h.boards = { ...h.boards, data: [board] }
    const out = renderShelf()
    expect(out).toContain('From the AI experts')
    expect(out).toContain('href="/u/fieldscout-ai/lists/week-9-rb-rankings"')
    expect(out).not.toContain('/app/explore?list=')
  })

  it('Community on: Community’s list page inside the app — never the share page', () => {
    h.flags.community = true
    h.boards = { ...h.boards, data: [board] }
    const out = renderShelf()
    expect(out).toContain('href="/app/explore?list=b1"')
    expect(out).not.toContain('/lists/week-9-rb-rankings')
  })

  it('nothing yet: no shelf', () => {
    expect(renderShelf()).toBe('')
  })

  it('a failed read says Couldn’t load, with Try again — never a shelf that quietly isn’t there', () => {
    h.boards = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    const out = renderShelf()
    expect(out).toContain('From the AI experts')
    expect(out).toContain("Couldn't load the AI experts.")
    expect(out).toContain('role="alert"')
    expect(out).toContain('Try again')
  })

  it('a refetch that fails over boards already loaded keeps them — no error in their place', () => {
    // React Query v5 keeps the old data when a later read fails (isError with
    // data), e.g. Home remounting after the five-minute staleTime.
    h.boards = { data: [board], isLoading: false, isError: true, refetch: vi.fn() }
    const out = renderShelf()
    expect(out).toContain('href="/u/fieldscout-ai/lists/week-9-rb-rankings"')
    expect(out).toContain('Week 9 RB rankings')
    expect(out).not.toContain("Couldn't load")
    expect(out).not.toContain('role="alert"')
  })

  it('posts are only read while personas are released — a posts error with them off is not the shelf’s', () => {
    h.boards = { data: [board], isLoading: false, isError: false, refetch: vi.fn() }
    h.posts = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    const out = renderShelf()
    expect(out).toContain('Week 9 RB rankings')
    expect(out).not.toContain("Couldn't load")
  })

  it('with personas released, posts that failed with nothing loaded say so', () => {
    h.flags.personas = true
    h.boards = { data: [board], isLoading: false, isError: false, refetch: vi.fn() }
    h.posts = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    expect(renderShelf()).toContain("Couldn't load the AI experts.")
  })
})
