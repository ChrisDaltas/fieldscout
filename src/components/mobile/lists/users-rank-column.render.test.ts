/**
 * FieldScout Mobile — the Lists "Users" rank stat column (gap list §3 #9),
 * rendered. Behind the community-rankings switch (`consensus`): on, Add stats
 * offers Users before Pos rk and a chosen Users column draws each player's
 * position rank among users ("–" when they haven't ranked him); off, neither
 * the chip nor the column appears. Every "not shown" case is paired with a
 * column that is shown, so it can't pass because the table never rendered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/lists',
  useSearchParams: () => search,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'dalton', avatar_url: null }, user: { id: 'u1' } }),
}))
const flags = vi.hoisted(() => ({ consensus: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
// Scrolling can't happen under `renderToStaticMarkup`: the cover never passes.
vi.mock('@/hooks/use-mobile-lists-cover-passed', () => ({
  useMobileListsCoverPassed: () => false,
}))
// The chosen columns (a zustand store, whose server snapshot is always its
// initial state under `renderToStaticMarkup`).
let cols: readonly string[] = []
vi.mock('@/stores/list-display-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/list-display-store')>()
  return { ...actual, useListDisplay: () => ({ ...actual.DEFAULT_LIST_DISPLAY, cols }) }
})
// Radix portals don't render on the server: an open sheet is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children }: { open: boolean; title: string; subtitle?: string; children: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, createElement('p', null, subtitle), children) : null,
}))

import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'

import { AddStatsSheet } from './add-stats-sheet'
import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function entry(n: number, name: string, team: string): ListPlayerWithPlayer {
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
    player: { id: `p${n}`, full_name: name, position: 'WR', team, headshot_url: null, status: null, bye_week: 7, adp: 12.4 },
    stats: { current_pts: 95.5, current_games: 4, last_pts: 300, last_games: 17, projected_pts: 320 },
  } as ListPlayerWithPlayer
}

const SUMMARY = [
  {
    id: 'l1',
    title: 'WR board',
    player_count: 2,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'WR',
    is_favorites: false,
    owner: null,
    tags: [],
    first_players: [],
  },
] as unknown as ListWithTags[]

const DETAIL = {
  ...(SUMMARY[0] as object),
  description: null,
  ranking_mode: 'ranked',
  is_owner: true,
  is_private: false,
  slug: 'wr-board',
  owner_id: 'u1',
  links: [],
  players: [entry(1, "Ja'Marr Chase", 'CIN'), entry(2, 'Tee Higgins', 'CIN')],
} as unknown as ListWithDetails

const client = (users?: Map<string, number>) => {
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: SUMMARY, pagination: { page: 1, pageSize: 50, total: 1, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['lists', 'detail', 'l1'], DETAIL)
  qc.setQueryData(['mobile-lists', 'video-flags', 'l1'], new Set<string>())
  qc.setQueryData(['mobile-lists', 'latest-week', 2026], 6)
  if (users) qc.setQueryData(['mobile-lists', 'users-ranks', 'p1,p2'], users)
  return qc
}

const html = (qc: QueryClient, node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

const listView = (users?: Map<string, number>) => {
  search = new URLSearchParams('list=l1')
  return html(client(users), createElement(MobileLists))
}

/** The pinned column-names strip (list-view.tsx). */
const columnNames = (out: string) => {
  const at = out.indexOf('data-list-column-names')
  expect(at).toBeGreaterThan(-1)
  return out.slice(at, out.indexOf('overflow-x-auto pb-6'))
}
const header = (label: string) => new RegExp(`w-\\[58px\\][^"]*">${label}</div>`)
/** A stat cell (`PlayerRow`), holding `value`. */
const cell = (value: string) => new RegExp(`rounded text-\\[12px\\][^"]*">${value}</div>`, 'g')

afterEach(() => {
  flags.consensus = false
  cols = []
})

describe('List view: the Users rank column', () => {
  it('with community rankings on: a Users column of each player’s rank among users', () => {
    flags.consensus = true
    cols = ['users', 'adp']
    const out = listView(new Map([['p1', 3]]))
    const names = columnNames(out)
    expect(names).toMatch(header('Users'))
    expect(names).toMatch(header('ADP'))
    expect(names.indexOf('>Users<')).toBeLessThan(names.indexOf('>ADP<'))
    // J. Chase is WR3 among users; nobody ranked T. Higgins.
    expect(out.match(cell('3'))).toHaveLength(1)
    expect(out).toMatch(/text-m-t5">–<\/div>/)
    expect(out.match(cell('12.4'))).toHaveLength(2)
    // Season-long with no scoring: Users alone brings no scoring control.
    cols = ['users']
    expect(listView(new Map([['p1', 3]]))).not.toContain('aria-label="Scoring:')
  })

  it('blank (never "–") until the users’ read lands', () => {
    flags.consensus = true
    cols = ['users', 'adp']
    const out = listView()
    expect(columnNames(out)).toMatch(header('Users'))
    expect(out).not.toMatch(/text-m-t5">–<\/div>/)
    expect(out.match(cell('12.4'))).toHaveLength(2)
  })

  it('with community rankings off: a chosen Users column isn’t drawn', () => {
    cols = ['users', 'adp']
    const out = listView(new Map([['p1', 3]]))
    const names = columnNames(out)
    expect(names).toMatch(header('ADP'))
    expect(names).not.toContain('>Users<')
    expect(out.match(cell('3'))).toBeNull()
  })
})

describe('Add stats: the Users chip', () => {
  const sheet = () => html(client(), createElement(AddStatsSheet, { open: true, onOpenChange: () => {}, listId: 'l1' }))
  const chip = (label: string) => new RegExp(`<button type="button" aria-pressed="(true|false)"[^>]*>${label}</button>`)

  it('on: offered in Rankings, before Pos rk, and counted when chosen', () => {
    flags.consensus = true
    cols = ['users']
    const out = sheet()
    expect(out).toMatch(chip('Users'))
    expect(out.match(chip('Users'))?.[1]).toBe('true')
    expect(out.indexOf('>Rankings<')).toBeLessThan(out.indexOf('>Users<'))
    expect(out.indexOf('>Users<')).toBeLessThan(out.indexOf('>Pos rk<'))
    expect(out).toContain('1 selected · shown as columns in your list')
  })

  it('off: not offered (Pos rk still is), and not counted', () => {
    cols = ['users']
    const out = sheet()
    expect(out).toMatch(chip('Pos rk'))
    expect(out).not.toMatch(chip('Users'))
    expect(out).toContain('0 selected · shown as columns in your list')
  })
})
