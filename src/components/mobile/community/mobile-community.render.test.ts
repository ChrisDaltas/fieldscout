/**
 * Community's filtered views past the pool (gap list §3 #30: "search and
 * filters cover every public list, not just the newest 100"). Pinned:
 *  - a pool that holds every list: no read past it, the view as before;
 *  - a full pool: the older matches follow the pool's — lists in their own
 *    masonry block per page, rankings after the pool's — and more load by
 *    hand or as the end comes near; no "Showing the 100 most recently
 *    updated" line, because nothing is left out;
 *  - the read past the pool is asked with the same tab / topic / search /
 *    chips;
 *  - nothing found yet but still reading: loading, never "Nothing matches";
 *    a failed read says so with Try again — with nothing shown, one message
 *    for the screen whose one Try again retries every failed read; else
 *    under the section it belongs to, naming it; the empty state only once
 *    every list has been searched.
 */
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OlderSpec } from '@/components/mobile/community/community-ops'
import type { CommunityItem } from '@/hooks/use-mobile-community-feed'

const h = vi.hoisted(() => ({
  flags: { weeklyRanks: true, startOrSit: false, personas: false, messages: false, leagues: false, community: true },
  feed: {} as Record<string, unknown>,
  older: {} as Record<'rank' | 'list', Record<string, unknown>>,
  olderArgs: [] as { spec: unknown; from: unknown; ready: unknown }[],
  emptyActions: [] as { message: string; onAction: () => void }[],
}))

vi.mock('@/lib/feature-flags', () => ({ featureFlags: h.flags }))
vi.mock('@/components/mobile/ui/back-nav', () => ({ useGoBack: () => () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/mobile/ui/mobile-header', () => ({
  MobileScreen: ({ children }: { children: ReactNode }) => createElement('main', null, children),
  HeaderIconButton: ({ label }: { label: string }) => createElement('button', { 'aria-label': label }),
  LogoLockup: () => createElement('span', null, 'FieldScout'),
}))
vi.mock('@/components/mobile/community/create-sheet', () => ({ CreateSheet: () => null }))
// The static render can't tap: keep each empty/error block's action to call.
vi.mock('@/components/mobile/community/community-cards', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/mobile/community/community-cards')>()
  return {
    ...orig,
    EmptyBlock: (props: Parameters<typeof orig.EmptyBlock>[0]) => {
      h.emptyActions.push(props)
      return orig.EmptyBlock(props)
    },
  }
})
vi.mock('@/components/mobile/community/community-detail', () => ({ CommunityDetail: () => null }))
vi.mock('@/components/mobile/community/community-shelves', () => ({
  TopScoutsShelf: () => null,
  TrendingTagsShelf: () => null,
}))
vi.mock('@/hooks/use-follows', () => ({ useFollowingIds: () => ({ data: new Set<string>(), isLoading: false, isError: false }) }))
vi.mock('@/hooks/use-mobile-community-feed', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/hooks/use-mobile-community-feed')>()
  const idle = { data: undefined, isLoading: false, isError: false, refetch: () => {} }
  return {
    ...mod,
    useMobileCommunityFeed: () => h.feed,
    useCommunityPlayerMatches: () => idle,
    useCommunityInjuryMatches: () => idle,
  }
})
// A static render reads a zustand store's server snapshot (its initial
// state), so the screen reads the live state the test sets instead.
vi.mock('@/components/mobile/community/community-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/mobile/community/community-store')>()
  const store = orig.useCommunityStore
  const live = Object.assign(
    (selector: (s: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store,
  )
  return { ...orig, useCommunityStore: live }
})
vi.mock('@/hooks/use-community-older', () => ({
  useCommunityOlder: (spec: OlderSpec | null, from: unknown, ready: unknown) => {
    h.olderArgs.push({ spec, from, ready })
    return spec ? h.older[spec.kind] : { data: undefined, isError: false, hasNextPage: false }
  },
}))

import { useCommunityStore } from './community-store'
import { MobileCommunity } from './mobile-community'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const FROM = { updatedAt: '2026-09-01T00:00:00Z', id: 'last' }

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
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    thumbnailUrl: null,
    ownerUsername: 'kelly',
    author: { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 10, isPersona: false },
    heads: [],
    tags: [],
    videos: [],
    ...over,
  }
}

function setFeed(items: CommunityItem[], olderFrom: typeof FROM | null) {
  h.feed = {
    data: { items, latest: [], popularExtra: [], capped: olderFrom !== null, olderFrom },
    isLoading: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: () => {},
  }
}

function read(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...over,
  }
}
const pages = (...ps: CommunityItem[][]) => ({ pages: ps.map((items) => ({ items, next: null })) })

const render = () =>
  renderToStaticMarkup(createElement(MobileCommunity, { currentWeek: 7 })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
const cardIds = (out: string) => [...out.matchAll(/href="\/app\/explore\?list=([^"]+)"/g)].map((m) => m[1])
/** The masonry blocks, each as its card ids. */
const blocks = (out: string) =>
  out
    .split('class="columns-2')
    .slice(1)
    .map((chunk) => cardIds(chunk.split('</div></div>')[0]!))

beforeEach(() => {
  h.flags.weeklyRanks = true
  h.olderArgs.length = 0
  h.emptyActions.length = 0
  h.older = { rank: read(), list: read() }
  useCommunityStore.setState({ tab: 'list', topic: null, query: '', searchOpen: false, rk: { type: 'all', pos: 'all', scoring: 'all' } })
  setFeed([item('p1'), item('p2')], FROM)
})

describe('Community past the pool (gap list §3 #30)', () => {
  it('a pool that holds every list: no read past it — the view as before', () => {
    setFeed([item('p1'), item('p2')], null)
    const out = render()
    expect(cardIds(out)).toEqual(['p1', 'p2'])
    expect(h.olderArgs.every((a) => a.from === null)).toBe(true)
    expect(out).not.toContain('Load more')
    expect(out).not.toContain('aria-busy')
  })

  it('a full pool: the older lists follow, one masonry block per page — no "most recently updated" line', () => {
    h.older.list = read({ data: pages([item('o1'), item('o2')], [item('o3')]), hasNextPage: true })
    const out = render()
    expect(cardIds(out)).toEqual(['p1', 'p2', 'o1', 'o2', 'o3'])
    expect(blocks(out)).toEqual([['p1', 'p2'], ['o1', 'o2'], ['o3']])
    expect(out).toMatch(/<button[^>]*>Load more<\/button>/)
    expect(out).not.toMatch(/most recently updated/)
  })

  it('asks with the same view: the tab, and the search once typing settles', () => {
    render()
    expect(h.olderArgs).toContainEqual({
      spec: { kind: 'list', following: null, topic: null, q: '', rankType: 'all', rankPos: 'all' },
      from: FROM,
      ready: true,
    })
    // Lists tab: no rankings read.
    expect(h.olderArgs.find((a) => (a.spec as OlderSpec | null)?.kind === 'rank')).toBeUndefined()
    // For you with a search: rankings and lists, with the search as the
    // client reads it (sent once typing settles — `ready`).
    h.olderArgs.length = 0
    useCommunityStore.setState({ tab: 'all', searchOpen: true, query: '  Kelce ' })
    render()
    const asked = h.olderArgs.filter((a) => a.spec !== null)
    expect(asked.map((a) => (a.spec as OlderSpec).kind).sort()).toEqual(['list', 'rank'])
    expect(asked.every((a) => (a.spec as OlderSpec).q === 'kelce' && a.ready === true)).toBe(true)
  })

  it('nothing matched yet and still reading: loading — never "Nothing matches"', () => {
    useCommunityStore.setState({ tab: 'list', searchOpen: true, query: 'zzz' })
    const out = render()
    expect(out).toContain('aria-label="Loading more lists"')
    expect(out).not.toContain('Nothing matches')
  })

  it('empty only once every list has been searched', () => {
    useCommunityStore.setState({ tab: 'list', searchOpen: true, query: 'zzz' })
    h.older.list = read({ data: pages([]), hasNextPage: false })
    const out = render()
    expect(out).toContain('Nothing matches your search')
    expect(out).not.toContain('aria-busy')
  })

  it('a failed read says so, with Try again — even with nothing drawn, and never as empty', () => {
    useCommunityStore.setState({ tab: 'list', searchOpen: true, query: 'zzz' })
    h.older.list = read({ isError: true })
    const out = render()
    expect(out).toContain('Couldn’t finish the search.')
    expect(out).toContain('Try again')
    expect(out).not.toContain('Couldn’t load more')
    expect(out).not.toContain('Nothing matches')
    // No search: it names what didn't load.
    useCommunityStore.setState({ tab: 'list', searchOpen: false, query: '' })
    setFeed([], FROM)
    expect(render()).toContain('Couldn’t load the lists.')
  })

  it('both reads failed with nothing shown: one message, one Try again that retries both', () => {
    useCommunityStore.setState({ tab: 'all', searchOpen: true, query: 'zzq' })
    h.older.rank = read({ isError: true })
    h.older.list = read({ isError: true })
    const out = render()
    expect(out.match(/Couldn’t finish the search\./g)).toHaveLength(1)
    expect(out.match(/>Try again</g)).toHaveLength(1)
    expect(out).not.toContain('Couldn’t load more')
    expect(out).not.toContain('aria-busy')
    const block = h.emptyActions.find((a) => a.message === 'Couldn’t finish the search.')
    block!.onAction()
    expect(h.older.rank.refetch).toHaveBeenCalledTimes(1)
    expect(h.older.list.refetch).toHaveBeenCalledTimes(1)
    // A later page that failed is read again on its own (not the whole read).
    h.emptyActions.length = 0
    h.older.rank = read({ isError: true })
    h.older.list = read({ data: pages([]), hasNextPage: true, isError: true, isFetchNextPageError: true })
    render()
    h.emptyActions.find((a) => a.message === 'Couldn’t finish the search.')!.onAction()
    expect(h.older.rank.refetch).toHaveBeenCalledTimes(1)
    expect(h.older.list.fetchNextPage).toHaveBeenCalledTimes(1)
    expect(h.older.list.refetch).not.toHaveBeenCalled()
  })

  it('something shown: a failed read says so under its own section, naming it', () => {
    useCommunityStore.setState({ tab: 'all', searchOpen: true, query: 'title' })
    // No ranking shown, the lists are: the rankings' failure, above the Lists heading.
    h.older.rank = read({ isError: true })
    h.older.list = read({ data: pages([item('ol')]) })
    let out = render()
    const failed = out.indexOf('Couldn’t load the rankings.')
    expect(failed).toBeGreaterThan(-1)
    expect(failed).toBeLessThan(out.indexOf('>Lists</h2>'))
    expect(out).not.toContain('Couldn’t finish the search.')
    expect(out).not.toContain('Couldn’t load more.')
    // Rankings and lists shown, a later page of each failed: each says which.
    setFeed([item('p1'), item('pr', { kind: 'rank', rankType: 'season' })], FROM)
    const pageFailed = { hasNextPage: true, isError: true, isFetchNextPageError: true }
    h.older.rank = read({ data: pages([]), ...pageFailed })
    h.older.list = read({ data: pages([item('ol')]), ...pageFailed })
    out = render()
    const moreRanks = out.indexOf('Couldn’t load more rankings.')
    const lists = out.indexOf('>Lists</h2>')
    expect(moreRanks).toBeGreaterThan(out.indexOf('>Rankings</h2>'))
    expect(moreRanks).toBeLessThan(lists)
    expect(out.indexOf('Couldn’t load more lists.')).toBeGreaterThan(lists)
  })

  it('For you with a search: the older rankings after the pool’s, "More rankings" by hand above the lists', () => {
    useCommunityStore.setState({ tab: 'all', searchOpen: true, query: 'title' })
    setFeed([item('p1'), item('pr', { kind: 'rank', rankType: 'season' })], FROM)
    h.older.rank = read({ data: pages([item('or', { kind: 'rank', rankType: 'weekly', rankWeek: 3 })]), hasNextPage: true })
    h.older.list = read({ data: pages([item('ol')]) })
    const out = render()
    const rankings = out.indexOf('>Rankings</h2>')
    const lists = out.indexOf('>Lists</h2>')
    expect(rankings).toBeGreaterThan(-1)
    expect(lists).toBeGreaterThan(rankings)
    const more = out.indexOf('>More rankings</button>')
    expect(more).toBeGreaterThan(rankings)
    expect(more).toBeLessThan(lists)
    expect(out.indexOf('?list=or')).toBeGreaterThan(out.indexOf('?list=pr'))
    expect(out.indexOf('?list=ol')).toBeGreaterThan(out.indexOf('?list=p1'))
  })

  it('Rankings: the scoring chip applies to older rankings, and reads on while a page adds none', () => {
    useCommunityStore.setState({ tab: 'rank', rk: { type: 'all', pos: 'all', scoring: 'ppr' } })
    setFeed([item('p1')], FROM)
    h.older.rank = read({
      data: pages([item('half', { kind: 'rank', rankType: 'season', scoringFormat: 'half' })]),
      hasNextPage: true,
    })
    const out = render()
    expect(out).not.toContain('?list=half')
    // Nothing shown, more to read: loading (it reads on as the end is near), not the empty state.
    expect(out).toContain('aria-label="Loading more rankings"')
    expect(out).not.toContain('Nothing matches these filters')
    expect(h.olderArgs).toContainEqual(
      expect.objectContaining({ spec: { kind: 'rank', following: null, topic: null, q: '', rankType: 'all', rankPos: 'all' } }),
    )
  })
})
