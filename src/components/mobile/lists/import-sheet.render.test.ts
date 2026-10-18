/**
 * FieldScout Mobile — Import a ranking (gap list §3 #5), rendered: the
 * editor's tool chip and empty-state copy, and the sheet's two groups (My
 * rankings, My lists) with the design's option cards — each line counting
 * the players it would really bring in, and an option that would bring in
 * nobody shown but not tappable. With rankings switched off (launch scope)
 * it reads "Import a list" and offers lists only. Every "not shown" case is
 * paired with its shown control.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
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
const flags = vi.hoisted(() => ({ weeklyRanks: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
// Radix portals don't render on the server: an open sheet is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children }: { open: boolean; title: string; subtitle?: string; children: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, createElement('p', null, subtitle), children) : null,
}))

import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'
import { mobileRankingBoardsKey, type MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

import { ImportSheet } from './import-sheet'
import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function entry(n: number, position = 'QB'): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier: null,
    notes: null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position, team: 'BUF', headshot_url: null, status: null, bye_week: 7 },
    stats: { current_pts: 40, current_games: 4, last_pts: 0, last_games: 0, projected_pts: 300 },
  } as ListPlayerWithPlayer
}

const summary = (id: string, title: string, player_count: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  player_count,
  updated_at: NOW,
  thumbnail_url: null,
  position_filter: null,
  cover_color: null,
  ranking_mode: 'ranked',
  is_favorites: false,
  is_big_board: false,
  owner: null,
  tags: [],
  first_players: [],
  ...extra,
})

const LISTS = [
  summary('l1', 'QB board', 2),
  summary('a', 'Sleepers', 3, { ranking_mode: 'rank_and_tier' }),
  summary('b', 'My two QBs', 2),
  summary('theirs', 'Kelly’s list', 5, { owner: { username: 'kelly', avatar_url: null } }),
] as unknown as ListWithTags[]

const PLAYERS = new Map([
  [
    'a',
    [
      { player_id: 'p7', position: 'QB', tier: 'S' },
      { player_id: 'p8', position: 'QB', tier: 'A' },
      { player_id: 'p9', position: 'QB', tier: 'A' },
    ],
  ],
  [
    'b',
    [
      { player_id: 'p1', position: 'QB', tier: null },
      { player_id: 'p2', position: 'QB', tier: null },
    ],
  ],
])

const head = (n: number, position: string) => ({
  list_id: 'season',
  player_id: `p${n}`,
  position: n,
  updated_at: null,
  added_at: null,
  player: { id: `p${n}`, full_name: `Player ${n}`, position, team: 'BUF', headshot_url: null },
})
const BOARDS: MyRankingBoards = {
  season: { listId: 'season', week: 0, players: [head(1, 'QB'), head(11, 'QB'), head(12, 'RB')] },
  weeks: [],
}

const detail = (players: ListPlayerWithPlayer[]): ListWithDetails =>
  ({
    ...(LISTS[0] as object),
    description: null,
    is_owner: true,
    is_private: false,
    slug: 'qb-board',
    owner_id: 'u1',
    links: [],
    players,
  }) as unknown as ListWithDetails

const client = (players: ListPlayerWithPlayer[]) => {
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: LISTS, pagination: { page: 1, pageSize: 50, total: 4, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['lists', 'detail', 'l1'], detail(players))
  qc.setQueryData(['mobile-lists', 'latest-week', 2026], 6)
  qc.setQueryData(['mobile-lists', 'import-players', 'a,b'], PLAYERS)
  qc.setQueryData(mobileRankingBoardsKey('u1'), BOARDS)
  return qc
}

const html = (node: ReturnType<typeof createElement>, qc: QueryClient) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

const editor = (players: ListPlayerWithPlayer[]) => {
  search = new URLSearchParams('list=l1&edit=1')
  return html(createElement(MobileLists, { currentWeek: 5 }), client(players))
}

const sheet = (inList: string[], positionFilter: string | null = null) =>
  html(
    createElement(ImportSheet, {
      open: true,
      onOpenChange: () => {},
      listId: 'l1',
      positionFilter,
      inList: new Set(inList),
      currentWeek: 5,
      onImport: () => true,
    }),
    client([]),
  )

/** An option card's button, by its label: is it disabled, and its sub-line. */
const card = (out: string, label: string) => {
  const match = out.match(new RegExp(`<button type="button"( disabled="")?[^>]*>(?:(?!</button>).)*?>${label}</span><span[^>]*>([^<]*)</span>`))
  return match ? { disabled: Boolean(match[1]), sub: match[2] } : null
}

describe('the editor: Import a ranking', () => {
  it('sits beside Add players in the tools row', () => {
    flags.weeklyRanks = true
    const out = editor([entry(1), entry(2)])
    expect(out).toContain('Add players')
    expect(out).toContain('Import a ranking')
  })

  it('the empty editor offers it (the design’s copy)', () => {
    flags.weeklyRanks = true
    const out = editor([])
    expect(out).toContain('No players yet')
    expect(out).toContain('Add players, or import a ranking to bring in players in order with tiers.')
  })

  it('with rankings switched off it reads "Import a list"', () => {
    flags.weeklyRanks = false
    const out = editor([])
    expect(out).toContain('Import a list')
    expect(out).not.toContain('Import a ranking')
    expect(out).toContain('Add players, or import a list to bring in players in order with tiers.')
    flags.weeklyRanks = true
  })
})

describe('the Import a ranking sheet', () => {
  it('the design’s header, then My rankings and My lists', () => {
    const out = sheet(['p1', 'p2'])
    expect(out).toContain('data-sheet="Import a ranking"')
    expect(out).toContain('Brings in players in order, with their tiers')
    expect(out).toContain('My rankings')
    expect(out).toContain('My lists')
    expect(out.indexOf('My rankings')).toBeLessThan(out.indexOf('My lists'))
  })

  it('rankings as My rankings names them, one per position; the user’s avatar as the tile', () => {
    const out = sheet([])
    expect(card(out, 'Rest of season · QB')).toEqual({ disabled: false, sub: '2 players · Published' })
    expect(card(out, 'Rest of season · RB')).toEqual({ disabled: false, sub: '1 player · Published' })
    // The design's "D" on blue: the user's two letters.
    expect(out).toMatch(/bg-accent[^"]*">DA</)
  })

  it('a list’s line counts who it would bring in; one that brings in nobody can’t be tapped', () => {
    const out = sheet(['p1', 'p2', 'p8'])
    expect(card(out, 'Sleepers')).toEqual({ disabled: false, sub: '3 players · 1 already in this list' })
    expect(card(out, 'My two QBs')).toEqual({ disabled: true, sub: 'All already in this list' })
    expect(card(out, 'Rest of season · QB')).toEqual({ disabled: false, sub: '2 players · 1 already in this list' })
  })

  it('a tiered list says how many tiers when nothing is skipped', () => {
    expect(card(sheet([]), 'Sleepers')).toEqual({ disabled: false, sub: '3 players · 2 tiers' })
  })

  it('never offers the list itself or someone else’s saved list', () => {
    const out = sheet([])
    expect(card(out, 'Sleepers')).not.toBeNull()
    expect(card(out, 'QB board')).toBeNull()
    expect(card(out, 'Kelly’s list')).toBeNull()
  })

  it('a QB list is offered QB rankings only', () => {
    const out = sheet([], 'QB')
    expect(card(out, 'Rest of season · QB')).not.toBeNull()
    expect(card(out, 'Rest of season · RB')).toBeNull()
  })

  it('with rankings switched off: "Import a list", lists only', () => {
    flags.weeklyRanks = false
    const out = sheet([])
    expect(out).toContain('data-sheet="Import a list"')
    expect(out).not.toContain('My rankings')
    expect(card(out, 'Rest of season · QB')).toBeNull()
    expect(card(out, 'Sleepers')).not.toBeNull()
    flags.weeklyRanks = true
  })
})
