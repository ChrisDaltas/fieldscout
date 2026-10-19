/**
 * Duplicate is a plain list's only (Chris, 2026-10-19: Duplicate is removed
 * from rankings everywhere, phone and desktop). Pinned, rendered:
 *   - `offersDuplicate`: a plain list yes; a ranking — the season board, a
 *     weekly board, an AI expert's board — never;
 *   - the phone's List options: a ranking (yours or a saved one) has no
 *     Duplicate row; a plain list keeps its list copy;
 *   - desktop's Lists card menu and open-list menu: the same;
 *   - the ranking Duplicate is gone, not dormant: its modules are deleted, and
 *     "Start my ranking from this" stays gone (#501 removed it).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/lists',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'dalton', avatar_url: null }, user: { id: 'u1' } }),
}))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return { featureFlags: { ...actual.featureFlags, weeklyRanks: true, leagues: false } }
})
// Radix portals don't render on the server: an open sheet / menu is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, children, footer) : null,
}))
vi.mock('@/components/ui/dropdown-menu', () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuSub: pass,
    DropdownMenuSubTrigger: pass,
    DropdownMenuSubContent: pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => createElement('div', { role: 'menuitem' }, children),
  }
})

import { ListDetailHero } from '@/components/lists/v2/list-detail-hero'
import { ListGalleryCard } from '@/components/lists/v2/list-gallery-card'
import { offersDuplicate } from '@/components/mobile/community/community-ops'
import { ListActionsSheet } from '@/components/mobile/lists/list-actions-sheet'
import type { ListPlayerWithPlayer, ListWithDetails, ListWithTags } from '@/hooks/use-lists'

const noop = () => {}

/** Someone else's season board (Big Board) — saved by the viewer. */
const SEASON = { is_big_board: true, slug: 'big-board', ai_persona_id: null }
const WEEKLY = { is_big_board: false, slug: 'week-6-big-board-1760000000000', ai_persona_id: null }
const EXPERT = { is_big_board: false, slug: 'top-25-rb-ppr', ai_persona_id: 'p1' }
const PLAIN = { is_big_board: false, slug: 'sleepers', ai_persona_id: null }

const RANKINGS = [
  ['a saved season board', SEASON],
  ['a saved weekly board', WEEKLY],
  ['an AI expert’s board', EXPERT],
  ['your own season board', { ...SEASON, is_owner: true }],
  ['your own weekly board', { ...WEEKLY, is_owner: true }],
] as const

function entry(n: number, position: string): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `${position}${n}`,
    position: n,
    tier: null,
    notes: null,
    player: { id: `${position}${n}`, full_name: `Player ${n}`, position, team: 'CIN', headshot_url: null, status: null },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

function list(over: Record<string, unknown> = {}): ListWithDetails & ListWithTags {
  return {
    id: 'l1',
    title: 'Kelly’s board',
    description: null,
    owner_id: 'u-kelly',
    owner: { username: 'kelly', avatar_url: null },
    is_owner: false,
    is_favorited: true,
    is_favorites: false,
    is_private: false,
    folder_id: null,
    ranking_mode: 'ranked',
    comments_enabled: true,
    player_count: 2,
    first_players: [],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    tags: [],
    links: [],
    players: [entry(1, 'RB'), entry(2, 'WR')],
    ...PLAIN,
    ...over,
  } as unknown as ListWithDetails & ListWithTags
}

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node))

describe('offersDuplicate', () => {
  it('a plain list: yes', () => {
    expect(offersDuplicate(PLAIN)).toBe(true)
  })
  it('a ranking of any kind: never', () => {
    for (const ranking of [SEASON, WEEKLY, EXPERT]) expect(offersDuplicate(ranking)).toBe(false)
  })
})

describe('the phone’s List options', () => {
  const sheet = (l: ListWithDetails) =>
    html(
      createElement(ListActionsSheet, {
        open: true,
        onOpenChange: noop,
        list: l,
        ownerUsername: 'kelly',
        canEdit: l.is_owner,
        viewer: { username: 'dalton', avatarUrl: null },
        onEditDetails: noop,
        onDeleted: noop,
        tools: {
          group: null,
          onGroupBy: noop,
          checkOff: false,
          onCheckOff: noop,
          marked: 0,
          onClearDrafted: noop,
          notes: 0,
          notesShown: false,
          onNotes: noop,
          onCompare: noop,
        },
      }),
    )

  it.each(RANKINGS)('%s: no Duplicate row', (_name, over) => {
    const out = sheet(list(over))
    expect(out).toContain('Copy link') // the sheet rendered
    expect(out).not.toMatch(/Duplicat/)
  })

  it('a plain list keeps its Duplicate (a list copy)', () => {
    expect(sheet(list())).toMatch(/>Duplicate</)
    expect(sheet(list({ is_owner: true }))).toMatch(/>Duplicate</)
  })
})

describe('desktop’s Lists menus', () => {
  const card = (l: ListWithTags) =>
    html(
      createElement(ListGalleryCard, {
        list: l,
        viewer: { username: 'dalton', avatarUrl: null },
        folders: [],
        onOpen: noop,
        onShare: noop,
        onDuplicate: noop,
        onDelete: noop,
        onOpenComments: noop,
        onTogglePin: noop,
        onMoveToFolder: noop,
      }),
    )
  const hero = (l: ListWithDetails) =>
    html(
      createElement(ListDetailHero, {
        list: l,
        owner: { username: 'kelly', avatarUrl: null },
        canEdit: l.is_owner,
        expanded: false,
        onToggleExpanded: noop,
        onClose: noop,
        onPopOut: noop,
        onRename: noop,
        onShare: noop,
        onDuplicate: noop,
        onSetPrivate: noop,
        onClearDrafted: noop,
        onDelete: noop,
        onTogglePin: noop,
        folders: [],
        onMoveToFolder: noop,
      }),
    )

  it.each(RANKINGS)('%s: no Duplicate in the card menu or the open list’s menu', (_name, over) => {
    const l = list(over)
    for (const out of [card(l), hero(l)]) {
      expect(out).toContain('role="menuitem"') // the menu rendered
      expect(out).not.toMatch(/Duplicat/)
    }
  })

  it('a plain list keeps its Duplicate in both menus', () => {
    for (const l of [list(), list({ is_owner: true, owner: null })]) {
      expect(card(l)).toMatch(/role="menuitem">.*?Duplicate<\/div>/)
      expect(hero(l)).toMatch(/role="menuitem">.*?Duplicate<\/div>/)
    }
  })
})

describe('the ranking Duplicate is deleted, not dormant', () => {
  const root = process.cwd()
  const read = (file: string) => readFileSync(path.resolve(root, file), 'utf8')

  it('its modules are gone', () => {
    for (const file of [
      'src/hooks/use-duplicate-ranking.ts',
      'src/components/mobile/rankings/duplicate-ops.ts',
      'src/components/mobile/rankings/duplicate-ranking.tsx',
      'src/components/lists/v2/ranking-duplicate-dialog.tsx',
    ]) {
      expect(existsSync(path.resolve(root, file)), file).toBe(false)
    }
  })

  it('no screen says it — nor "Start my ranking from this"', () => {
    const dir = 'src/components/mobile/rankings'
    const files = [
      ...readdirSync(path.resolve(root, dir))
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => `${dir}/${f}`),
      'src/components/mobile/community/community-detail.tsx',
      'src/components/mobile/lists/list-actions-sheet.tsx',
      'src/components/lists/v2/list-detail-panel.tsx',
      'src/components/lists/v2/lists-page-v2.tsx',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source, file).not.toMatch(/Start my ranking|Start from this ranking/)
      expect(source, file).not.toMatch(/it’s your ranking now|it's your ranking now|Replace your .* ranking/)
    }
    const editor = read(`${dir}/ranking-editor.tsx`)
    expect(editor).not.toContain('usePersonaBoardPlayers')
    expect(editor).not.toContain("startsWith('p:')")
  })
})
