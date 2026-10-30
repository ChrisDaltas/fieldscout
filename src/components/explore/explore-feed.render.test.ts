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
vi.mock('@/hooks/use-tags', () => ({ useTags: () => ({ data: { tags: [] } }) }))
vi.mock('@/hooks/use-lists', () => ({ useToggleLike: () => ({ mutate: () => {}, isPending: false }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'viewer' }, profile: null }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/u/${u}` }))
vi.mock('@/hooks/use-toast', () => ({ toast: (arg: unknown) => h.toast(arg) }))

import { toastFollowFailed } from './follow-button'
import { ExploreFeed, toastLikeFailed } from './explore-feed'

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

describe('the badge', () => {
  it('an ordinary list is a “List”; a ranking is a “Ranking”', () => {
    setFeed([{ items: [item('plain'), item('board', { is_ranking: true })], next: null }])
    const out = render()
    expect(out.match(/>List</g)).toHaveLength(1)
    expect(out.match(/>Ranking</g)).toHaveLength(1)
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
