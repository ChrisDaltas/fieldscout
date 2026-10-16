/**
 * FieldScout Mobile — tiers without numbers (Chris, 2026-10-15; migration
 * 191, `ranking_mode = 'tier_only'`). A tier-only list is drawn as Tier 1,
 * Tier 2… sections with NO 1-2-3 numbers, in the List view and the editor,
 * and the editor's Ranked / Tiers switches show the two halves independently.
 * Each case is paired with a numbered list as its positive control, so "no
 * number found" can't pass because the rows never rendered.
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
// Scrolling can't happen under `renderToStaticMarkup`: the cover never passes.
vi.mock('@/hooks/use-mobile-lists-cover-passed', () => ({
  useMobileListsCoverPassed: () => false,
}))

import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'

import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function entry(n: number, name: string, tier: string | null): ListPlayerWithPlayer {
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
    player: { id: `p${n}`, full_name: name, position: 'QB', team: 'BUF', headshot_url: null, status: null, bye_week: 7, adp: 12.4 },
    stats: { current_pts: 95.5, current_games: 4, last_pts: 300, last_games: 17, projected_pts: 320 },
  } as ListPlayerWithPlayer
}

const SUMMARY = [
  {
    id: 'l1',
    title: 'QB tiers',
    player_count: 3,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'QB',
    is_favorites: false,
    owner: null,
    tags: [],
    first_players: [],
  },
] as unknown as ListWithTags[]

const detail = (ranking_mode: string): ListWithDetails =>
  ({
    ...(SUMMARY[0] as object),
    description: null,
    ranking_mode,
    is_owner: true,
    is_private: false,
    slug: 'qb-tiers',
    owner_id: 'u1',
    links: [],
    players: [entry(1, 'Josh Allen', 'S'), entry(2, 'Lamar Jackson', 'S'), entry(3, 'Jalen Hurts', 'A')],
  }) as unknown as ListWithDetails

const render = (ranking_mode: string, query: string) => {
  search = new URLSearchParams(query)
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: SUMMARY, pagination: { page: 1, pageSize: 50, total: 1, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['lists', 'detail', 'l1'], detail(ranking_mode))
  qc.setQueryData(['mobile-lists', 'video-flags', 'l1'], new Set<string>())
  qc.setQueryData(['mobile-lists', 'latest-week', 2026], 6)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The List view's rank cell (`ListRow` in list-view.tsx), holding `n`. */
const viewRank = (n: number) => new RegExp(`<span class="w-\\[18px\\] flex-none[^"]*">${n}</span>`)
/** The editor's row number (`DragRowBody` in list-editor.tsx), holding `n`. */
const editorNumber = (n: number) => new RegExp(`<span class="w-\\[22px\\] flex-none[^"]*">${n}</span>`)
/** A switch card's state: `aria-checked` on the button that names `label`. */
const switchState = (out: string, label: string) =>
  out.match(new RegExp(`role="switch" aria-checked="(true|false)"[^>]*><span[^>]*>${label}</span>`))?.[1]

describe('List view: tiers without numbers', () => {
  it('positive control: a ranked list with tiers numbers its rows', () => {
    const out = render('rank_and_tier', 'list=l1')
    expect(out).toContain('3 players · Ranked')
    expect(out).toContain('Tier 1')
    expect(out).toMatch(viewRank(1))
    expect(out).toMatch(viewRank(3))
  })

  it('a tier-only list: Tier 1 / Tier 2 sections, its players, no numbers', () => {
    const out = render('tier_only', 'list=l1')
    expect(out).toContain('3 players · Tiers')
    expect(out).toContain('Tier 1')
    expect(out).toContain('Tier 2')
    expect(out).toContain('J. Allen')
    expect(out).toContain('J. Hurts')
    for (const n of [1, 2, 3]) expect(out).not.toMatch(viewRank(n))
  })

  it('a plain list (neither switch) still reads Unranked, with no tier lines', () => {
    const out = render('unranked', 'list=l1')
    expect(out).toContain('3 players · Unranked')
    expect(out).not.toContain('Tier 1')
    expect(out).not.toMatch(viewRank(1))
  })
})

describe('List editor: Ranked and Tiers are independent switches', () => {
  it('positive control: Ranked + Tiers both on, rows numbered', () => {
    const out = render('rank_and_tier', 'list=l1&edit=1')
    expect(switchState(out, 'Ranked')).toBe('true')
    expect(switchState(out, 'Tiers')).toBe('true')
    expect(out).toMatch(editorNumber(1))
  })

  it('a tier-only list opens with Ranked off and Tiers on — tier lines, tier tools, no numbers', () => {
    const out = render('tier_only', 'list=l1&edit=1')
    expect(switchState(out, 'Ranked')).toBe('false')
    expect(switchState(out, 'Tiers')).toBe('true')
    expect(out).toContain('Tier 1')
    expect(out).toContain('Auto tiers')
    expect(out).toContain('Add tier line')
    expect(out).toContain('3 players · drag to reorder')
    for (const n of [1, 2, 3]) expect(out).not.toMatch(editorNumber(n))
  })

  it('a ranked list without tiers: Ranked on, Tiers off', () => {
    const out = render('ranked', 'list=l1&edit=1')
    expect(switchState(out, 'Ranked')).toBe('true')
    expect(switchState(out, 'Tiers')).toBe('false')
    expect(out).not.toContain('Add tier line')
  })
})
