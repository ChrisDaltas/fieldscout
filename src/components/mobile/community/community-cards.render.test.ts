import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'

import {
  LatestCard,
  LatestShelf,
  ListCard,
  RankingRow,
  ShelfHeader,
  UpdatedRow,
  communityDetailHref,
} from './community-cards'
import { VideoCard } from './community-detail'
import { LATEST_HREF, authorBgClass } from './community-ops'

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const p = (id: string, full_name: string, position = 'RB', team = 'ATL'): CommunityPlayer => ({
  id,
  full_name,
  position,
  team,
  headshot_url: null,
})

const base: CommunityItem = {
  id: 'list-1',
  title: 'Backs one injury away from 15 touches',
  slug: 'backs',
  description: null,
  kind: 'list',
  rankType: null,
  positionFilter: 'RB',
  scoring: 'Half PPR',
  scoringFormat: 'half',
  playerCount: 5,
  likeCount: 0,
  recentLikes: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-15T11:20:00Z',
  thumbnailUrl: null,
  ownerUsername: 'fieldfilm',
  author: { profileId: 'u1', username: 'fieldfilm', avatarUrl: null, followers: 1200, isPersona: false },
  heads: [p('a', 'Tyler Allgeier'), p('b', 'Jordan Mason', 'RB', 'MIN'), p('c', 'Justice Hill', 'RB', 'BAL')],
  tags: [],
  videos: [],
}

describe('Community cards', () => {
  it('a list card opens the detail over the feed and draws the collage on the list colour', () => {
    const out = html(createElement(ListCard, { item: base }))
    expect(out).toContain(`href="${communityDetailHref('list-1')}"`)
    expect(communityDetailHref('list-1')).toBe('/app/explore?list=list-1')
    expect(out).toContain('bg-pos-rb')
    expect(out).toContain('grid-cols-[repeat(2,44px)]')
    expect(out).toMatch(/h-\[(150|180|205)px\]/)
    expect(out).toContain('@fieldfilm · 5 players')
    // Three heads → three headshots (initials fallback).
    expect(out.match(/title="(Tyler Allgeier|Jordan Mason|Justice Hill)"/g)).toHaveLength(3)
    expect(out).not.toContain('video')
  })

  it('a YouTube video makes a 110px thumbnail cover with the video badge', () => {
    const out = html(
      createElement(ListCard, {
        item: { ...base, videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Week 5 waivers', duration: '14:02', source: null }] },
      }),
    )
    expect(out).toContain('h-[110px]')
    expect(out).toContain('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(out).toContain('1 video')
    expect(out).not.toContain('grid-cols-[repeat(2,44px)]')
  })

  it('videos without players and without a YouTube id → the video placeholder', () => {
    const out = html(
      createElement(ListCard, {
        item: {
          ...base,
          heads: [],
          videos: [
            { url: 'https://vimeo.com/1', title: 'FAAB bids explained', duration: null, source: null },
            { url: 'https://vimeo.com/2', title: 'Second', duration: null, source: null },
          ],
        },
      }),
    )
    expect(out).toContain('bg-m-ink')
    expect(out).toContain('FAAB bids explained')
    expect(out).toContain('2 videos')
  })

  it('a ranking row: 60px tile with the #1 player, author line and the top three', () => {
    const rank: CommunityItem = {
      ...base,
      id: 'r1',
      kind: 'rank',
      title: 'Top 25 RB — PPR',
      heads: [p('a', 'Bijan Robinson'), p('b', 'Jonathan Taylor', 'RB', 'IND'), p('c', 'Kyren Williams', 'RB', 'LAR')],
      author: { profileId: 'u2', username: 'shahranks', avatarUrl: null, followers: 12000, isPersona: false },
    }
    const out = html(createElement(RankingRow, { item: rank }))
    expect(out).toContain('h-[60px] w-[60px]')
    // The tile is the author's colour (§2.10), not the list's position group.
    expect(out).toMatch(new RegExp(`h-\\[60px\\] w-\\[60px\\][^"]*${authorBgClass('u2')}`))
    expect(out).toContain(`href="${communityDetailHref('r1')}"`)
    expect(out).toContain('@shahranks · 12k follows')
    expect(out).toContain('1. B. Robinson 2. J. Taylor 3. K. Williams')
    expect(out).toContain('title="Bijan Robinson"')
  })

  it('an AI expert has no follow count', () => {
    const out = html(
      createElement(RankingRow, {
        item: { ...base, kind: 'rank', author: { profileId: null, username: 'bathew-merry-ai', avatarUrl: null, followers: null, isPersona: true } },
      }),
    )
    expect(out).toContain('>@bathew-merry-ai<')
  })

  it('a Latest row (#35) says what it is and when it was posted; a list keeps its cover colour', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    const list = html(createElement(RankingRow, { item: { ...base, createdAt: '2026-10-15T11:35:00Z' }, postedNow: now }))
    expect(list).toContain('@fieldfilm · List · 25m')
    expect(list).not.toContain('follows')
    expect(list).toMatch(/h-\[60px\] w-\[60px\][^"]*bg-pos-rb/)
    const rank = html(
      createElement(RankingRow, {
        item: { ...base, id: 'r9', kind: 'rank', createdAt: '2026-10-13T12:00:00Z' },
        postedNow: now,
      }),
    )
    expect(rank).toContain('@fieldfilm · Ranking · 2d')
    expect(rank).toMatch(new RegExp(`h-\\[60px\\] w-\\[60px\\][^"]*${authorBgClass('u1')}`))
  })

  it('a shelf with no fuller view has no "See all"', () => {
    expect(html(createElement(ShelfHeader, { title: 'Rankings' }))).not.toContain('See all')
    expect(html(createElement(ShelfHeader, { title: 'Lists for you', onSeeAll: () => {} }))).toContain('See all')
  })

  it('"See all" to a page of its own is a link (Latest → the Latest page)', () => {
    const out = html(createElement(ShelfHeader, { title: 'Latest', seeAllHref: LATEST_HREF }))
    expect(out).toMatch(/<a [^>]*href="\/app\/explore\/latest"[^>]*>See all<\/a>/)
    expect(out).not.toContain('<button')
  })

  it('an updated-by row: handle · title over the update time', () => {
    const out = html(createElement(UpdatedRow, { item: { ...base, kind: 'rank', title: 'Week 5 · RB · PPR' }, now: Date.parse('2026-10-15T12:00:00Z') }))
    expect(out).toContain('@fieldfilm · Week 5 · RB · PPR')
    expect(out).toContain('Updated 40m ago')
    expect(out).toContain('bg-m-b1')
  })
})

/**
 * Chris, 2026-10-15: "we need the actual YouTube titles or nothing." A video
 * YouTube would not name carries title NULL (migration 189) — no surface
 * shows a placeholder for it, and none leaves an empty title line.
 */
describe('Community — a video with no title', () => {
  it('a list card with an untitled YouTube video keeps its thumbnail cover and badge, no placeholder', () => {
    const out = html(
      createElement(ListCard, {
        item: { ...base, videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: null, duration: null, source: null }] },
      }),
    )
    expect(out).toContain('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(out).toContain('1 video')
    expect(out).not.toMatch(/youtube video/i)
  })

  it('the video placeholder cover with an untitled first video shows no caption, only the ink block and badge', () => {
    const out = html(
      createElement(ListCard, {
        item: { ...base, heads: [], videos: [{ url: 'https://vimeo.com/1', title: null, duration: null, source: null }] },
      }),
    )
    expect(out).toContain('bg-m-ink')
    expect(out).toContain('1 video')
    expect(out).not.toContain('justify-end gap-1 p-[10px]')
    expect(out).not.toMatch(/youtube video/i)
  })

  it('the detail’s video card: thumbnail, duration and "YouTube", named by its action — no title line', () => {
    const out = html(
      createElement(VideoCard, {
        video: { url: 'https://youtu.be/dQw4w9WgXcQ', title: null, duration: '14:02', source: null },
      }),
    )
    expect(out).toContain('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(out).toContain('>14:02<')
    expect(out).toContain('>YouTube<')
    expect(out).toContain('aria-label="Watch on YouTube"')
    expect(out).not.toContain('text-[12px] font-semibold leading-[1.3]')
    expect(out).not.toMatch(/youtube video/i)
  })

  it('a titled video on the detail shows YouTube’s title and needs no extra label', () => {
    const out = html(
      createElement(VideoCard, {
        video: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Week 5 waivers', duration: null, source: null },
      }),
    )
    expect(out).toContain('>Week 5 waivers<')
    expect(out).not.toContain('aria-label=')
  })
})

/**
 * For you's "Latest" (Chris, 2026-10-16): "a horizontal scroll section with a
 * see all latest" — about ten fixed-width cards that snap, edge to edge with
 * the 16px gutter, scrolling on their own (never the page).
 */
describe('Community — the Latest shelf', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const items: CommunityItem[] = [
    { ...base, id: 'l1', createdAt: '2026-10-15T11:35:00Z' },
    { ...base, id: 'r1', kind: 'rank', title: 'Week 6 RB', createdAt: '2026-10-13T12:00:00Z' },
  ]

  it('one row that scrolls sideways and snaps, bleeding to the edge with the gutter kept', () => {
    const out = html(createElement(LatestShelf, { items, now }))
    const shelf = /<div class="([^"]*)" data-latest-shelf/.exec(out)
    expect(shelf).not.toBeNull()
    for (const cls of ['-mx-4', 'px-4', 'flex', 'overflow-x-auto', 'snap-x', 'snap-mandatory', 'scroll-px-4', 'scrollbar-none']) {
      expect(shelf![1]!.split(' '), cls).toContain(cls)
    }
    expect(shelf![1]).not.toContain('flex-col')
    // Fixed-width cards, each a snap point, in the order given (newest first).
    const cards = [...out.matchAll(/<a href="([^"]*)" class="([^"]*)" data-latest-card/g)]
    expect(cards.map((m) => m[1])).toEqual([communityDetailHref('l1'), communityDetailHref('r1')])
    for (const m of cards) {
      expect(m[2]!.split(' ')).toEqual(expect.arrayContaining(['w-[150px]', 'flex-none', 'snap-start']))
    }
  })

  it('a card: the fixed cover, title, author, and what it is and when it was posted', () => {
    const list = html(createElement(LatestCard, { item: items[0]!, now }))
    expect(list).toContain('h-[150px]')
    expect(list).toContain('bg-pos-rb')
    expect(list).toContain('line-clamp-2')
    expect(list).toContain('Backs one injury away from 15 touches')
    expect(list).toContain('>@fieldfilm<')
    expect(list).toContain('List · 25m')
    const rank = html(createElement(LatestCard, { item: items[1]!, now }))
    expect(rank).toContain('Ranking · 2d')
  })

  it('a ranking’s card is always the collage, as its detail is — never a video thumbnail', () => {
    const out = html(
      createElement(LatestCard, {
        item: {
          ...items[1]!,
          videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Week 5 waivers', duration: null, source: null }],
        },
        now,
      }),
    )
    expect(out).toContain('grid-cols-[repeat(2,44px)]')
    expect(out).not.toContain('i.ytimg.com')
    expect(out).toContain('h-[150px]')
  })

  it('a Latest page row opens its detail over the Latest page', () => {
    const out = html(createElement(RankingRow, { item: items[0]!, postedNow: now, from: LATEST_HREF }))
    expect(out).toContain('href="/app/explore/latest?list=l1"')
    expect(communityDetailHref('l1', LATEST_HREF)).toBe('/app/explore/latest?list=l1')
  })
})
