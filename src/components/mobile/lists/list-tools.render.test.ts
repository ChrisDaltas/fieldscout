/**
 * FieldScout Mobile — desktop's list tools on a phone (gap list §3 #3),
 * rendered:
 *   - the List view: drafted rows dimmed and struck through, their tick
 *     boxes (on by themselves once someone's marked, or switched on), the
 *     "· n left" count, the note mark and Show notes, and Rounds headings;
 *   - the ⋯ sheet's tool rows, each shown only when it would do something;
 *   - Side by side: one column per list with its own "n of m left";
 *   - team lists: New list's List / Team choice, and a team's roster in Edit
 *     details (no position group, no type choice once it exists).
 * Every "not shown" case is paired with its shown control, so an absence
 * can't pass because nothing rendered.
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
vi.mock('@/hooks/use-mobile-lists-cover-passed', () => ({
  useMobileListsCoverPassed: () => false,
}))
// Zustand answers a server render from its initial state, so the session
// switches and the grouping are set here rather than through the stores.
const view = vi.hoisted(() => ({
  checkOff: undefined as boolean | undefined,
  notes: false,
  org: null as 'rank' | 'tier' | 'round' | 'cost' | 'budget' | null,
}))
vi.mock('./lists-session-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lists-session-store')>()),
  useListCheckOff: (_id: string, hasMarks: boolean) => [view.checkOff ?? hasMarks, () => {}],
  useListNotes: () => [view.notes, () => {}],
}))
vi.mock('@/stores/list-display-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/list-display-store')>()
  return { ...actual, useListDisplay: () => ({ ...actual.DEFAULT_LIST_DISPLAY, org: view.org }) }
})
// Radix portals don't render on the server: an open sheet is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, children, footer) : null,
}))

import { draftedKeys } from '@/hooks/use-draft-mode'
import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'

import { ListActionsSheet, type ListToolsProps } from './list-actions-sheet'
import { NewListScreen } from './list-details-screen'
import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function entry(listId: string, n: number, name: string, extra: { tier?: string | null; notes?: string | null } = {}): ListPlayerWithPlayer {
  return {
    id: `${listId}-e${n}`,
    list_id: listId,
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier: extra.tier ?? null,
    notes: extra.notes ?? null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: name, position: 'WR', team: 'CIN', headshot_url: null, status: null, bye_week: 7, adp: 12.4 },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

function detail(id: string, title: string, players: ListPlayerWithPlayer[], extra: Record<string, unknown> = {}): ListWithDetails {
  return {
    id,
    title,
    description: null,
    player_count: players.length,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: null,
    is_favorites: false,
    is_team: false,
    ranking_mode: 'ranked',
    is_owner: true,
    is_private: false,
    slug: id,
    owner_id: 'u1',
    tags: [],
    links: [],
    players,
    ...extra,
  } as unknown as ListWithDetails
}

const L1 = detail('l1', 'Draft board', [
  entry('l1', 1, "Ja'Marr Chase", { tier: 'r1', notes: 'Locked-in volume every week.' }),
  entry('l1', 2, 'Puka Nacua', { tier: 'r1' }),
  entry('l1', 3, 'Justin Jefferson', { tier: 'r2' }),
])
const L2 = detail('l2', 'Sleepers', [entry('l2', 2, 'Puka Nacua'), entry('l2', 4, 'Drake London')])

function render(query: string, opts: { drafted?: Record<string, string[]>; lists?: ListWithDetails[] } = {}) {
  search = new URLSearchParams(query)
  const lists = opts.lists ?? [L1, L2]
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'collection', 1, 50], {
    lists: lists.map((l) => ({ ...l, first_players: [] })) as unknown as ListWithTags[],
    pagination: { page: 1, pageSize: 50, total: lists.length, hasMore: false },
  })
  qc.setQueryData(['folders'], { folders: [] })
  for (const list of lists) {
    qc.setQueryData(['lists', 'detail', list.id], list)
    qc.setQueryData(draftedKeys.list(list.id), opts.drafted?.[list.id] ?? [])
  }
  return html(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
}

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

/** A row's tick box for `name`, and whether it's ticked. */
const tick = (out: string, name: string) =>
  out.match(new RegExp(`role="checkbox" aria-checked="(true|false)" aria-label="Drafted: ${name}"`))?.[1]

afterEach(() => {
  view.checkOff = undefined
  view.notes = false
  view.org = null
})

describe('List view: drafted check-off', () => {
  it('a list nobody is marked on shows no tick boxes until Check off drafted is switched on', () => {
    const off = render('list=l1')
    expect(off).toContain('J. Chase')
    expect(tick(off, "Ja'Marr Chase")).toBeUndefined()
    expect(off).not.toContain(' left</span>')

    view.checkOff = true
    const on = render('list=l1')
    expect(tick(on, "Ja'Marr Chase")).toBe('false')
    expect(tick(on, 'Puka Nacua')).toBe('false')
  })

  it('with marks, the boxes show by themselves; a marked row is struck through and counted', () => {
    const out = render('list=l1', { drafted: { l1: ['p2', 'p-not-on-this-list'] } })
    expect(tick(out, 'Puka Nacua')).toBe('true')
    expect(tick(out, "Ja'Marr Chase")).toBe('false')
    expect(out).toMatch(/data-drafted="true"/)
    expect(out).toMatch(/line-through[^"]*">P\. Nacua</)
    expect(out).toContain(' · 2 left</span>')
  })

  it('switched off, the boxes go but the marks still show (a view switch never clears)', () => {
    view.checkOff = false
    const out = render('list=l1', { drafted: { l1: ['p2'] } })
    expect(tick(out, 'Puka Nacua')).toBeUndefined()
    expect(out).toMatch(/line-through[^"]*">P\. Nacua</)
  })
})

describe('List view: notes and grouping', () => {
  it('a note is a mark by the name until Show notes, then the note runs under the row', () => {
    const marked = render('list=l1')
    expect(marked).toContain('Has a note')
    expect(marked).not.toContain('Locked-in volume every week.')

    view.notes = true
    const shown = render('list=l1')
    expect(shown).toMatch(/data-list-note="true">Locked-in volume every week\.</)
    expect(shown).not.toContain('Has a note')
  })

  it('Group by Rounds draws Round 1 / Round 2 sections; the list order has none', () => {
    expect(render('list=l1')).not.toContain('Round 1')
    view.org = 'round'
    const out = render('list=l1')
    expect(out).toContain('Round 1')
    expect(out).toContain('Round 2')
    expect(out.indexOf('Round 1')).toBeLessThan(out.indexOf('J. Jefferson'))
    expect(out.indexOf('J. Jefferson')).toBeGreaterThan(out.indexOf('Round 2'))
  })
})

describe('List options: the tool rows', () => {
  const tools = (extra: Partial<ListToolsProps> = {}): ListToolsProps => ({
    group: 'Ranked',
    onGroupBy: () => {},
    checkOff: true,
    onCheckOff: () => {},
    marked: 2,
    onClearDrafted: () => {},
    notes: 1,
    notesShown: false,
    onNotes: () => {},
    onCompare: () => {},
    ...extra,
  })
  const sheet = (t: ListToolsProps) =>
    html(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ListActionsSheet, {
          open: true,
          onOpenChange: () => {},
          list: L1,
          ownerUsername: 'dalton',
          canEdit: true,
          viewer: { username: 'dalton', avatarUrl: null },
          onEditDetails: () => {},
          onDeleted: () => {},
          tools: t,
        }),
      ),
    )
  const switchState = (out: string, label: string) =>
    out.match(new RegExp(`role="switch" aria-checked="(true|false)"[^>]*>(?:(?!</button>).)*>${label}<`))?.[1]

  it('every tool, with its state, ahead of the list’s other options', () => {
    const out = sheet(tools())
    for (const label of ['Group by', 'Check off drafted', 'Clear drafted', 'Show notes', 'Side by side']) expect(out).toContain(`>${label}<`)
    expect(out).toContain('2 marked')
    expect(out).toContain('1 note')
    expect(switchState(out, 'Check off drafted')).toBe('true')
    expect(switchState(out, 'Show notes')).toBe('false')
    expect(out.indexOf('Side by side')).toBeLessThan(out.indexOf('Edit details'))
  })

  it('a tool that would do nothing stays out: no other grouping, no marks, no notes', () => {
    const out = sheet(tools({ group: null, marked: 0, notes: 0 }))
    expect(out).not.toContain('>Group by<')
    expect(out).not.toContain('>Clear drafted<')
    expect(out).not.toContain('>Show notes<')
    expect(out).toContain('>Check off drafted<')
    expect(out).toContain('>Side by side<')
  })
})

describe('Side by side', () => {
  it('one column per list, each counting what’s left from its own marks', () => {
    const out = render('compare=l1,l2', { drafted: { l1: ['p2'], l2: [] } })
    expect(out).toContain('>Side by side<')
    expect(out).toContain('data-compare-column="l1"')
    expect(out).toContain('data-compare-column="l2"')
    expect(out).toContain('2 of 3 left')
    expect(out).toContain('2 of 2 left')
    expect(out).toContain('D. London')
    // Puka is ticked in the list he's marked on, and not in the other.
    const columns = out.split('data-compare-column=')
    expect(tick(columns[1]!, 'Puka Nacua')).toBe('true')
    expect(tick(columns[2]!, 'Puka Nacua')).toBe('false')
  })
})

describe('team lists', () => {
  it('New list offers List / Team, List chosen, no roster until Team', () => {
    const qc = new QueryClient()
    const out = html(createElement(QueryClientProvider, { client: qc }, createElement(NewListScreen)))
    expect(out).toContain('>Type<')
    expect(out).toMatch(/aria-pressed="true"[^>]*>List</)
    expect(out).toMatch(/aria-pressed="false"[^>]*>Team</)
    expect(out).not.toContain('>Roster<')
    expect(out).toContain('>Position group<')
  })

  it('Edit details on a team shows its roster to change — no type choice, no position group', () => {
    const team = detail('t1', 'My team', [], {
      is_team: true,
      roster_settings: { qb: 1, rb: 2, wr: 3, te: 1, flex: 1, dst: 1, k: 1, bench: 6, ir: 2, total: 18 },
    })
    const out = render('list=t1&details=1', { lists: [team] })
    expect(out).toContain('>Roster<')
    expect(out).toMatch(/data-roster-slot="wr"(?:(?!data-roster-slot).)*>3</)
    expect(out).toContain('18 players in all')
    expect(out).not.toContain('>Type<')
    expect(out).not.toContain('>Position group<')
  })
})
