/**
 * Duplicate on a ranking that isn't yours, where Lists offers it (Chris,
 * 2026-10-18/19: "If a user dupes some popular ranking it then becomes their
 * own"), rendered:
 *   - the phone's List options (a saved ranking): Duplicate makes it your
 *     ranking — disabled, with the reason, on a week that can't be ranked
 *     now — while a list keeps the list Duplicate;
 *   - desktop's dialog (a saved ranking's card or panel): it always asks —
 *     "Replace your … with this one?" over rankings you have, "Duplicate this
 *     as your …?" otherwise — naming every position the ranking ranks.
 */
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
// Radix portals don't render on the server: an open sheet / dialog is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, children, footer) : null,
}))
vi.mock('@/components/ui/dialog', () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? createElement('div', { 'data-dialog': '' }, children) : null,
    DialogContent: pass,
    DialogHeader: pass,
    DialogFooter: pass,
    DialogTitle: ({ children }: { children?: ReactNode }) => createElement('h2', null, children),
    DialogDescription: ({ children }: { children?: ReactNode }) => createElement('p', null, children),
  }
})

import { RankingDuplicateDialog } from '@/components/lists/v2/ranking-duplicate-dialog'
import { ListActionsSheet } from '@/components/mobile/lists/list-actions-sheet'
import type { RankingDuplicate } from '@/components/mobile/rankings/duplicate-ops'
import type { ListPlayerWithPlayer, ListWithDetails } from '@/hooks/use-lists'
import { mobileRankingBoardsKey, type MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

function entry(listId: string, n: number, position: string): ListPlayerWithPlayer {
  return {
    id: `${listId}-e${n}`,
    list_id: listId,
    player_id: `${position}${n}`,
    position: n,
    tier: null,
    notes: null,
    player: { id: `${position}${n}`, full_name: `Player ${n}`, position, team: 'CIN', headshot_url: null, status: null },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

function list(over: Record<string, unknown> = {}): ListWithDetails {
  return {
    id: 'kelly-board',
    title: 'Kelly’s Big Board',
    description: null,
    is_big_board: true,
    ai_persona_id: null,
    slug: 'big-board',
    owner_id: 'u-kelly',
    is_owner: false,
    is_favorited: true,
    is_favorites: false,
    ranking_mode: 'ranked',
    comments_enabled: true,
    tags: [],
    links: [],
    players: [entry('kelly-board', 1, 'RB'), entry('kelly-board', 2, 'WR'), entry('kelly-board', 3, 'RB')],
    ...over,
  } as unknown as ListWithDetails
}

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

function client(boards?: MyRankingBoards): QueryClient {
  const qc = new QueryClient()
  if (boards) qc.setQueryData(mobileRankingBoardsKey('u1'), boards)
  return qc
}

describe('the phone’s List options on a saved ranking', () => {
  const sheet = (l: ListWithDetails, currentWeek = 6) =>
    html(
      createElement(
        QueryClientProvider,
        { client: client() },
        createElement(ListActionsSheet, {
          open: true,
          onOpenChange: () => {},
          list: l,
          ownerUsername: 'kelly',
          canEdit: false,
          viewer: { username: 'dalton', avatarUrl: null },
          onEditDetails: () => {},
          onDeleted: () => {},
          currentWeek,
          tools: {
            group: null,
            onGroupBy: () => {},
            checkOff: false,
            onCheckOff: () => {},
            marked: 0,
            onClearDrafted: () => {},
            notes: 0,
            notesShown: false,
            onNotes: () => {},
            onCompare: () => {},
          },
        }),
      ),
    )
  /** The Duplicate row's opening tag and its text. */
  const row = (out: string) => /<button type="button"([^>]*)>((?:(?!<\/button>).)*?>Duplicate<(?:(?!<\/button>).)*)<\/button>/.exec(out)

  it('Duplicate, open — it makes the ranking yours', () => {
    const r = row(sheet(list()))
    expect(r).not.toBeNull()
    expect(r![1]).not.toContain('disabled=""')
  })

  it('a played week’s ranking: Duplicate disabled, saying why', () => {
    const r = row(sheet(list({ is_big_board: false, slug: 'week-5-big-board-1760000000000' })))
    expect(r![1]).toContain('disabled=""')
    expect(r![2]).toContain('Week 5 is over')
  })

  it('a saved list (not a ranking) keeps the list Duplicate, never disabled', () => {
    const r = row(sheet(list({ is_big_board: false, slug: 'sleepers' })))
    expect(r![1]).not.toContain('disabled=""')
    expect(r![2]).not.toContain('is over')
  })
})

describe('desktop’s Duplicate dialog on a saved ranking', () => {
  const player = (id: string, position: string) => ({
    list_id: 'mine',
    player_id: id,
    position: 1,
    updated_at: null,
    added_at: null,
    player: { id, full_name: 'A B', position, team: 'KC', headshot_url: null },
  })
  const dialog = (boards: MyRankingBoards, dup: RankingDuplicate = { type: 'season', week: 0, blocked: null }) => {
    const qc = client(boards)
    qc.setQueryData(['lists', 'detail', 'kelly-board'], list())
    return html(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(RankingDuplicateDialog, { target: { listId: 'kelly-board', dup }, currentWeek: 6, onClose: () => {} }),
      ),
    )
  }

  it('over rankings you have: "Replace …?", naming every position it ranks', () => {
    const out = dialog({ season: { listId: 'mine', week: 0, players: [player('r9', 'RB')] }, weeks: [] })
    expect(out).toContain('<h2>Replace your Rest of season RB and WR rankings with this one?</h2>')
    expect(out).toMatch(/<button[^>]*>Replace<\/button>/)
  })

  it('nothing to replace (a week you haven’t ranked): it still asks, as a Duplicate', () => {
    const out = dialog({ season: null, weeks: [] }, { type: 'w7', week: 7, blocked: null })
    expect(out).toContain('<h2>Duplicate this as your Week 7 RB and WR rankings?</h2>')
    expect(out).toMatch(/<button[^>]*>Duplicate<\/button>/)
  })
})
