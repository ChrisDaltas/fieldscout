import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'

import { ListCard, RankingRow, UpdatedRow, communityDetailHref } from './community-cards'
import { authorBgClass } from './community-ops'

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
  scoring: null,
  playerCount: 5,
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

  it('an updated-by row: handle · title over the update time', () => {
    const out = html(createElement(UpdatedRow, { item: { ...base, kind: 'rank', title: 'Week 5 · RB · PPR' }, now: Date.parse('2026-10-15T12:00:00Z') }))
    expect(out).toContain('@fieldfilm · Week 5 · RB · PPR')
    expect(out).toContain('Updated 40m ago')
    expect(out).toContain('bg-m-b1')
  })
})
