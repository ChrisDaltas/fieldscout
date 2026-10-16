/**
 * FieldScout Mobile — Lists (lr-lists) over seeded data: the grid, the List
 * view and the editor render the design's structure and copy from the app's
 * real list payloads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/lists',
  useSearchParams: () => search,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'dalton', avatar_url: null }, user: { id: 'u1' } }),
}))
// The session scoring (a zustand store, whose server snapshot is always its
// initial state under `renderToStaticMarkup`).
let scoring: ListScoring = 'ppr'
vi.mock('./lists-session-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lists-session-store')>()),
  useListScoring: () => [scoring, () => {}],
}))

import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'
import type { FrameTotals, ListScoring, PlayerFrames } from '@/hooks/use-mobile-lists-timeframe-stats'

import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function entry(n: number, name: string, pos: string, team: string, tier: string | null = null): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier,
    notes: null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: name, position: pos, team, headshot_url: null, status: null, bye_week: 7, adp: 12.4 },
    stats: { current_pts: 95.5, current_games: 4, last_pts: 300, last_games: 17, projected_pts: 320 },
  } as ListPlayerWithPlayer
}

const SUMMARY: ListWithTags[] = [
  {
    id: 'l1',
    title: 'My top 5 QBs for Week 6',
    player_count: 2,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'QB',
    is_favorites: false,
    owner: null,
    tags: [],
    first_players: [{ id: 'p1', full_name: 'Josh Allen', team: 'BUF', headshot_url: null, position: 'QB' }],
  } as unknown as ListWithTags,
  {
    id: 'l4',
    title: 'Buy-low WRs after Week 4',
    player_count: 1,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'WR',
    is_favorites: false,
    owner: { username: 'kellyscouts', avatar_url: null },
    tags: [],
    first_players: [],
  } as unknown as ListWithTags,
]

const DETAIL: ListWithDetails = {
  ...(SUMMARY[0] as object),
  description: 'Who I’d start in a 1QB league this week.',
  ranking_mode: 'rank_and_tier',
  is_owner: true,
  is_private: false,
  slug: 'my-top-5',
  owner_id: 'u1',
  links: [{ id: 'k1', list_id: 'l1', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Why I’m fading these five', source_label: null, duration_label: null, position: 1 }],
  players: [entry(1, 'Josh Allen', 'QB', 'BUF', 'S'), entry(2, 'Lamar Jackson', 'QB', 'BAL', 'A')],
} as unknown as ListWithDetails

const render = (seed?: (qc: QueryClient) => void) => {
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: SUMMARY, pagination: { page: 1, pageSize: 50, total: 2, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['lists', 'detail', 'l1'], DETAIL)
  qc.setQueryData(['mobile-lists', 'video-flags', 'l1,l4'], new Set(['l1']))
  qc.setQueryData(['mobile-lists', 'latest-week', 2026], 6)
  seed?.(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

describe('mobile Lists grid', () => {
  it('title, tabs, New list tile first, card meta', () => {
    search = new URLSearchParams()
    const out = render()
    expect(out).toMatch(/text-\[26px\][^"]*">Lists</)
    expect(out).toContain('My lists')
    expect(out).toContain('Saved')
    expect(out.indexOf('New list')).toBeLessThan(out.indexOf('My top 5 QBs for Week 6'))
    expect(out).toContain('Create with AI')
    expect(out).toContain('2 players · Updated 2d ago')
    // A list with a video link carries the cover's "Video" badge.
    expect(out).toMatch(/bg-black\/60[^"]*">.*?Video<\/span>/)
    // Saved lists live on the other tab.
    expect(out).not.toContain('Buy-low WRs')
  })

  it('the Saved tab shows others’ lists with their author', () => {
    search = new URLSearchParams('tab=saved')
    const out = render()
    expect(out).toContain('Buy-low WRs after Week 4')
    expect(out).toContain('1 player · ')
    expect(out).toContain('@kellyscouts')
    // No New list tile on Saved (the header's Create stays).
    expect(out).not.toContain('>New list</span>')
    expect(out).toContain('title="Create"')
  })
})

describe('mobile List view', () => {
  it('cover controls, meta, video, tiers and the locked player column', () => {
    search = new URLSearchParams('list=l1')
    const out = render()
    expect(out).toContain('aria-label="Back"')
    expect(out).toContain('>Edit<')
    expect(out).toContain('@dalton')
    expect(out).toContain('2 players · Ranked · Updated 2d ago')
    expect(out).toContain('Why I’m fading these five')
    expect(out).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(out).toContain('Players · 2')
    expect(out).toContain('Tier 1')
    expect(out).toContain('Tier 2')
    expect(out).toContain('w-[172px]')
    expect(out).toContain('J. Allen')
    expect(out).toContain('>Proj<')
    // The time frame shows whenever the list has stats, labelled with the
    // season's last completed week.
    expect(out).toContain('>Week 6<')
    expect(out).toContain('>Last 3<')
    // #19: the points columns name their scoring — PPR until the user picks.
    expect(out).toContain('aria-label="Scoring: PPR"')
  })

  it('points follow the session scoring (gap list #19)', () => {
    search = new URLSearchParams('list=l1')
    scoring = 'half'
    const frame = (games: number, pts: FrameTotals['pts']): FrameTotals =>
      ({ games, pts, receptions: 0 }) as unknown as FrameTotals
    const frames = new Map<string, PlayerFrames>([
      [
        'p1',
        {
          week: null,
          last3: null,
          season: frame(4, { ppr: 100, half: 90, quarter: 85, standard: 80 }),
          lastSeason: frame(17, { ppr: 400, half: 380, quarter: 370, standard: 360 }),
        },
      ],
      ['p2', { week: null, last3: null, season: null, lastSeason: null }],
    ])
    try {
      // Proj and 2025 pts (the default columns) read the weekly rows outside
      // PPR — this season's and last season's.
      const out = render((qc) =>
        qc.setQueryData(['mobile-lists', 'timeframe-stats', 2026, 6, 'with-last', 'p1,p2'], frames),
      )
      expect(out).toContain('aria-label="Scoring: Half PPR"')
      // Proj: 90 over 4 games, paced to 17 → 382.5; 2025 pts in Half PPR.
      expect(out).toContain('>382.5<')
      expect(out).toContain('>380.0<')
      // The payload's PPR figures are not shown in Half PPR.
      expect(out).not.toContain('>320.0<')
      expect(out).not.toContain('>300.0<')
      // No games yet this season or last: the stored Half PPR projection is
      // missing, so "–"; last season scores 0.
      expect(out).toContain('>0.0<')
    } finally {
      scoring = 'ppr'
    }
  })
})

describe('mobile List editor', () => {
  it('switches, stat chips, tools, tier lines and rows', () => {
    search = new URLSearchParams('list=l1&edit=1')
    const out = render()
    // Gap list #16 (Chris, 2026-10-15): edits are a draft written by
    // "Update" (it was "Done" while every change saved at once), greyed out
    // until something changes.
    expect(out).toMatch(/<button type="button" disabled=""[^>]*bg-m-b2 text-m-t3">Update<\/button>/)
    expect(out).not.toContain('>Done<')
    // #19: the rows' points name their scoring.
    expect(out).toContain('aria-label="Scoring: PPR"')
    expect(out).toContain('Ranked')
    expect(out).toContain('Tiers')
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('Add stat')
    expect(out).toContain('Add players')
    expect(out).toContain('Auto tiers')
    expect(out).toContain('Add tier line')
    expect(out).toContain('2 players · drag to reorder')
    expect(out).toContain('Tier 1')
    expect(out).toContain('Merge tiers')
    expect(out).toContain('BUF · Bye 7')
    expect(out).toContain('95.5')
  })
})
