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

// Whether the cover has scrolled off (gap list #25). Scrolling can't happen
// under `renderToStaticMarkup`, so the tests say; the subscription itself is
// covered in use-mobile-lists-cover-passed.test.ts. Each call's `ready` is kept.
let coverOff = false
const coverWatchReady: boolean[] = []
vi.mock('@/hooks/use-mobile-lists-cover-passed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-mobile-lists-cover-passed')>()),
  useMobileListsCoverPassed: (_cover: unknown, _bar: unknown, ready: boolean) => {
    coverWatchReady.push(ready)
    return ready && coverOff
  },
}))

import { listPersonaKey } from '@/hooks/use-list-persona'
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

// Takes a different list detail (the titles cases) or extra cache seeding
// (the editor cases).
const render = (arg?: ListWithDetails | ((qc: QueryClient) => void)) => {
  const detail = typeof arg === 'object' && arg !== null ? arg : DETAIL
  const seed = typeof arg === 'function' ? arg : undefined
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: SUMMARY, pagination: { page: 1, pageSize: 50, total: 2, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['lists', 'detail', 'l1'], detail)
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

/**
 * Gap list #25 (Chris, 2026-10-15): on a long list, once the cover scrolls
 * off, a slim bar keeps Back, the title, ⋯ and Edit at the top, and the
 * column names (Player · the stat columns) stay pinned under it. Which of the
 * two shows is decided by scrolling (`useMobileListsCoverPassed`); the markup
 * pins where each sits and that the bar starts hidden.
 */
describe('List view: the slim bar and pinned column names (gap list #25)', () => {
  /** The slim bar's markup, from its anchor up to the cover. */
  const barOf = (out: string) => {
    const at = out.indexOf('data-list-slim-bar')
    expect(at).toBeGreaterThan(-1)
    return { at, bar: out.slice(at, out.indexOf('relative h-[200px]', at)) }
  }

  it('the bar floats over the top of the page, hidden and inert until the cover scrolls off', () => {
    search = new URLSearchParams('list=l1')
    const out = render()
    const { at, bar } = barOf(out)
    // A zero-height sticky anchor ahead of the cover: it takes no room, so
    // nothing moves when the bar appears.
    expect(out.slice(out.lastIndexOf('<div', at), at)).toContain('class="sticky top-0 z-20 h-0"')
    expect(at).toBeLessThan(out.indexOf('relative h-[200px]'))
    expect(bar).toContain('inert=""')
    expect(bar).toContain('invisible opacity-0')
    // Clear of the notch, 48px tall.
    expect(bar).toContain('pt-[env(safe-area-inset-top)]')
    expect(bar).toContain('h-12')
    // Back · the title · ⋯ · Edit.
    const order = ['aria-label="Back"', '>My top 5 QBs for Week 6<', 'aria-label="List options"', '>Edit<'].map((s) =>
      bar.indexOf(s),
    )
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // Themed colours only (dark mode follows the m-* tokens).
    expect(bar).not.toMatch(/\bdark:/)
  })

  it('the cover scrolled off: the bar shows and can be used', () => {
    search = new URLSearchParams('list=l1')
    coverOff = true
    try {
      const { bar } = barOf(render())
      expect(bar).toContain('visible opacity-100')
      expect(bar).not.toContain('invisible')
      expect(bar).not.toContain('inert')
    } finally {
      coverOff = false
    }
  })

  it('the cover is watched once the list is on screen, and not while it loads', () => {
    search = new URLSearchParams('list=l1')
    coverWatchReady.length = 0
    render()
    expect(coverWatchReady.at(-1)).toBe(true)

    // A list whose detail hasn't arrived: the loading state has no cover.
    search = new URLSearchParams('list=l9')
    coverWatchReady.length = 0
    const out = render()
    expect(out).not.toContain('data-list-slim-bar')
    expect(coverWatchReady.length).toBeGreaterThan(0)
    expect(coverWatchReady.every((ready) => ready === false)).toBe(true)
  })

  it("someone else's list: the bar has ⋯ but no Edit, as the cover", () => {
    search = new URLSearchParams('list=l1')
    const { bar } = barOf(render({ ...DETAIL, is_owner: false } as ListWithDetails))
    expect(bar).toContain('aria-label="List options"')
    expect(bar).not.toContain('>Edit<')
  })

  it('the column names are pinned under the bar, outside the sideways scroller', () => {
    search = new URLSearchParams('list=l1')
    const out = render()
    const names = out.indexOf('data-list-column-names')
    const table = out.indexOf('overflow-x-auto pb-6')
    expect(names).toBeGreaterThan(-1)
    expect(names).toBeLessThan(table)
    const strip = out.slice(out.lastIndexOf('<div', names), table)
    // Sticky just under the 48px bar and the safe area, on the page colour.
    expect(strip).toContain('sticky z-10 bg-m-b0 top-[calc(env(safe-area-inset-top)+48px)]')
    expect(strip).toContain('>Player<')
    expect(strip).toContain('>Proj<')
    // The Player name keeps its locked column in the strip too.
    expect(strip).toContain('sticky left-0')
    expect(strip).toContain('w-[172px]')
    // The table itself no longer carries a header row of its own.
    expect(out.slice(table)).not.toContain('>Player<')
    expect(out.slice(table)).toContain('J. Allen')
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

/**
 * Chris, 2026-10-15: "we need the actual YouTube titles or nothing." A video
 * YouTube would not name is stored with title NULL (migration 189) — every
 * phone surface shows NO title line for it, never a placeholder, and the card
 * keeps its thumbnail and source line.
 */
describe('a video with no title (YouTube would not name it)', () => {
  const UNTITLED = {
    ...DETAIL,
    links: [{ id: 'k1', list_id: 'l1', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: null, source_label: null, duration_label: null, position: 1 }],
  } as unknown as ListWithDetails

  /** The markup between `from` and the next `to` — one card. */
  const slice = (out: string, from: string, to: string) => {
    const at = out.indexOf(from)
    expect(at, from).toBeGreaterThan(-1)
    return out.slice(at, out.indexOf(to, at) + to.length)
  }

  it('List view: thumbnail and "Watch on YouTube", no title line, no placeholder', () => {
    search = new URLSearchParams('list=l1')
    const out = render(UNTITLED)
    expect(out).not.toMatch(/youtube video/i)
    const card = slice(out, 'href="https://youtu.be/dQw4w9WgXcQ"', '</a>')
    expect(card).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(card).toContain('>Watch on YouTube<')
    // One text line (the source), and no empty title line left behind.
    expect(card.match(/text-\[11px\] font-medium text-m-t3/g)).toHaveLength(1)
    expect(card).not.toContain('text-[13px] font-semibold')
    expect(card).not.toMatch(/<span[^>]*><\/span>/)
  })

  it('Edit details: the attached video shows its address only — no title, no placeholder', () => {
    search = new URLSearchParams('list=l1&details=1')
    const out = render(UNTITLED)
    expect(out).not.toMatch(/youtube video/i)
    const card = slice(out, 'data-video-row', 'aria-label="Remove video"')
    expect(card).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(card).toContain('>https://youtu.be/dQw4w9WgXcQ<')
    expect(card).not.toContain('text-[13px] font-semibold text-m-t1')
    expect(card).not.toMatch(/<span[^>]*><\/span>/)
  })

  it('a titled video still shows YouTube\u2019s title in both places', () => {
    search = new URLSearchParams('list=l1')
    expect(render()).toContain('Why I’m fading these five')
    search = new URLSearchParams('list=l1&details=1')
    expect(render()).toContain('>Why I’m fading these five<')
  })
})

/**
 * Audit lists-2: a shared list opens on a phone in this List view (the public
 * share page hands a signed-in phone here), so an AI expert's list keeps that
 * page's "Generated by FieldScout AI" line (spec-ai-expert-personas.md, UI
 * requirement 4).
 */
describe('List view: an AI expert’s list says it was made by AI (audit lists-2)', () => {
  const PERSONA_LIST = { ...DETAIL, is_owner: false, ai_persona_id: 'ap1' } as unknown as ListWithDetails
  const line = (out: string) => {
    const at = out.indexOf('data-list-ai-attribution')
    return at < 0 ? null : out.slice(out.lastIndexOf('<p', at), out.indexOf('</p>', at) + 4)
  }

  it('names the expert and says it is a fictional parody persona, under the table', () => {
    search = new URLSearchParams('list=l1')
    const out = render((qc) => {
      qc.setQueryData(['lists', 'detail', 'l1'], PERSONA_LIST)
      qc.setQueryData(listPersonaKey('ap1'), { username: 'bathew', display_name: 'Bathew Merry' })
    })
    const p = line(out)
    expect(p).not.toBeNull()
    expect(p).toContain('>AI</span>Generated by FieldScout AI as ')
    expect(p).toContain('Bathew Merry')
    expect(p).toContain(' — a fictional, parody analyst persona not affiliated with any real person.')
    // Below the players, as the share page's footer.
    expect(out.indexOf('data-list-ai-attribution')).toBeGreaterThan(out.indexOf('J. Allen'))
  })

  it('still says it is AI-made while the expert’s name is being read', () => {
    search = new URLSearchParams('list=l1')
    const p = line(render(PERSONA_LIST))
    expect(p).toContain('>AI</span>Generated by FieldScout AI.')
  })

  it('a switched-off expert’s list has no line, as on the share page', () => {
    search = new URLSearchParams('list=l1')
    const out = render((qc) => {
      qc.setQueryData(['lists', 'detail', 'l1'], PERSONA_LIST)
      qc.setQueryData(listPersonaKey('ap1'), null)
    })
    expect(line(out)).toBeNull()
  })

  it('a person’s list has no AI line', () => {
    search = new URLSearchParams('list=l1')
    expect(line(render())).toBeNull()
    expect(render()).not.toContain('Generated by FieldScout AI')
  })
})
