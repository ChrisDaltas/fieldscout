/**
 * FieldScout Mobile — List options → Copy link, and the list view's byline,
 * on someone else's list you haven't saved (walk-off-1's phone half, live on
 * production with Community off).
 *
 * Copy link used to build `ownerUsername ?? viewer.username`: while the real
 * owner was still being read — or after the read failed — it copied
 * `/u/<you>/lists/<slug>`, which 404s, though the byline on the same screen
 * rightly named nobody. Rendered here:
 *   - the sheet: with the owner unknown the row is disabled and says why,
 *     and pressing it anyway copies nothing; once known it copies
 *     `/u/<owner>/lists/<slug>`; your own and saved lists copy as before;
 *   - the list view: hands the sheet only a known handle (the desktop panel's
 *     rule, `list-owner.ts`) and the reason when there is none, and a read
 *     that failed says so in the byline instead of passing for a list with
 *     no author.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListOwner } from '@/hooks/use-list-owner'

interface CapturedSheet {
  ownerUsername: string | null
  linkUnavailable?: string
}

const h = vi.hoisted(() => ({
  lookup: { data: undefined, isError: false } as { data: ListOwner | null | undefined; isError: boolean },
  lookupCalls: [] as Array<[string | null | undefined, boolean]>,
  rows: new Map<string, { onClick: () => void; disabled?: boolean; sub?: string }>(),
  sheet: undefined as CapturedSheet | undefined,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/lists',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'me', avatar_url: null }, user: { id: 'u-me' } }),
}))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  // Production's switches: Community off.
  return { featureFlags: { ...actual.featureFlags, community: false, leagues: false } }
})
vi.mock('@/hooks/use-list-owner', () => ({
  useListOwner: (ownerId: string | null | undefined, enabled: boolean) => {
    h.lookupCalls.push([ownerId, enabled])
    return enabled ? h.lookup : { data: undefined, isError: false }
  },
}))
vi.mock('@/hooks/use-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-comments')>()
  return { ...actual, useComments: () => ({ data: undefined }) }
})
vi.mock('@/hooks/use-mobile-lists-cover-passed', () => ({
  useMobileListsCoverPassed: () => false,
}))
// Radix portals don't render on the server: an open sheet is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, children, footer) : null,
}))
vi.mock('@/components/mobile/lists/folder-sheets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/mobile/lists/folder-sheets')>()
  return {
    ...actual,
    // The List options rows, with their taps kept so a test can press one.
    SheetRow: ({ label, sub, disabled, onClick }: { label: string; sub?: string; disabled?: boolean; onClick: () => void }) => {
      h.rows.set(label, { onClick, disabled, sub })
      return createElement('button', { 'data-row': label, 'data-sub': sub, disabled }, label)
    },
  }
})
// The real sheet, with the props the list view hands it kept.
vi.mock('./list-actions-sheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./list-actions-sheet')>()
  return {
    ...actual,
    ListActionsSheet: (props: Parameters<typeof actual.ListActionsSheet>[0]) => {
      h.sheet = { ownerUsername: props.ownerUsername, linkUnavailable: props.linkUnavailable }
      return createElement(actual.ListActionsSheet, props)
    },
  }
})

import { OWNER_UNREADABLE, SHARE_LINK_FAILED, SHARE_LINK_LOADING } from '@/components/lists/v2/list-owner'
import { draftedKeys } from '@/hooks/use-draft-mode'
import type { ListWithDetails, ListWithTags } from '@/hooks/use-lists'

import { ListActionsSheet } from './list-actions-sheet'
import { ListView } from './list-view'

const ORIGIN = 'https://fieldscout.gg'
const noop = () => {}

function list(over: Partial<ListWithDetails> = {}): ListWithDetails {
  return {
    id: 'l1',
    title: 'Devpro sleepers',
    slug: 'devpro-sleepers',
    description: null,
    owner_id: 'u-devpro',
    is_owner: false,
    is_favorited: false,
    is_favorites: false,
    is_private: false,
    is_big_board: false,
    is_team: false,
    ai_persona_id: null,
    folder_id: null,
    position_filter: null,
    thumbnail_url: null,
    ranking_mode: 'ranked',
    comments_enabled: true,
    player_count: 0,
    created_at: '2026-10-29T00:00:00Z',
    updated_at: '2026-10-29T00:00:00Z',
    tags: [],
    links: [],
    players: [],
    ...over,
  } as unknown as ListWithDetails
}

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node))

function sheet(l: ListWithDetails, ownerUsername: string | null, linkUnavailable?: string): string {
  return html(
    createElement(ListActionsSheet, {
      open: true,
      onOpenChange: noop,
      list: l,
      ownerUsername,
      linkUnavailable,
      canEdit: l.is_owner,
      viewer: { username: 'me', avatarUrl: null },
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
}

let writeText: ReturnType<typeof vi.fn>
/** Press Copy link as the phone would — disabled or not — and say what was copied. */
async function pressCopyLink(): Promise<string[]> {
  vi.stubGlobal('window', { location: { origin: ORIGIN } })
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  h.rows.get('Copy link')!.onClick()
  await Promise.resolve()
  return writeText.mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
  h.lookup = { data: undefined, isError: false }
  h.lookupCalls = []
  h.rows = new Map()
  h.sheet = undefined
  writeText = vi.fn(() => Promise.resolve())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('List options → Copy link', () => {
  it('someone else’s list, owner still being read: disabled, says why, copies nothing — never your link', async () => {
    sheet(list(), null)
    const row = h.rows.get('Copy link')!
    expect(row.disabled).toBe(true)
    expect(row.sub).toBe(SHARE_LINK_LOADING)
    expect(await pressCopyLink()).toEqual([])
  })

  it('someone else’s list, owner couldn’t be read: disabled with that reason, copies nothing', async () => {
    sheet(list(), null, SHARE_LINK_FAILED)
    const row = h.rows.get('Copy link')!
    expect(row.disabled).toBe(true)
    expect(row.sub).toBe(SHARE_LINK_FAILED)
    expect(await pressCopyLink()).toEqual([])
  })

  it('someone else’s list, owner known: copies /u/<owner>/lists/<slug>', async () => {
    sheet(list(), 'devpro')
    const row = h.rows.get('Copy link')!
    expect(row.disabled).toBe(false)
    expect(row.sub).toBeUndefined()
    expect(await pressCopyLink()).toEqual([`${ORIGIN}/u/devpro/lists/devpro-sleepers`])
  })

  it('a saved list: copies its owner’s link, as before', async () => {
    sheet(list({ owner_id: 'u-kelly', slug: 'kelly-board' }), 'kelly')
    expect(await pressCopyLink()).toEqual([`${ORIGIN}/u/kelly/lists/kelly-board`])
  })

  it('your own list: copies your link, as before', async () => {
    sheet(list({ is_owner: true, owner_id: 'u-me', slug: 'my-board' }), 'me')
    expect(h.rows.get('Copy link')!.disabled).toBe(false)
    expect(await pressCopyLink()).toEqual([`${ORIGIN}/u/me/lists/my-board`])
  })

  it('your own list with no handle handed in: still yours (the viewer’s), never a guess', async () => {
    sheet(list({ is_owner: true, owner_id: 'u-me', slug: 'my-board' }), null)
    expect(await pressCopyLink()).toEqual([`${ORIGIN}/u/me/lists/my-board`])
  })
})

describe('the list view hands Copy link only a known handle', () => {
  function view(l: ListWithDetails, summary?: Partial<ListWithTags>): string {
    const qc = new QueryClient()
    qc.setQueryData(['lists', 'collection', 1, 50], {
      lists: summary ? [{ ...l, first_players: [], ...summary }] : [],
      pagination: { page: 1, pageSize: 50, total: summary ? 1 : 0, hasMore: false },
    })
    qc.setQueryData(['folders'], { folders: [] })
    qc.setQueryData(['lists', 'detail', l.id], l)
    qc.setQueryData(draftedKeys.list(l.id), [])
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ListView, { listId: l.id })))
  }
  const names = (out: string) => [...out.matchAll(/data-username-link="([^"]+)"/g)].map((m) => m[1])
  const note = (out: string) => out.match(/data-owner-note="[^"]*"[^>]*>([^<]*)</)?.[1] ?? null

  it('someone else’s unsaved list, owner still being read: no name, no handle, the loading reason', () => {
    const out = view(list())
    expect(h.lookupCalls.at(-1)).toEqual(['u-devpro', true])
    expect(names(out)).toEqual([])
    expect(note(out)).toBeNull()
    expect(h.sheet).toEqual({ ownerUsername: null, linkUnavailable: SHARE_LINK_LOADING })
  })

  it('owner read: the byline names them, and Copy link gets their handle', () => {
    h.lookup = { data: { username: 'devpro', avatarUrl: null }, isError: false }
    const out = view(list())
    expect(names(out)).toEqual(['devpro'])
    expect(h.sheet).toEqual({ ownerUsername: 'devpro', linkUnavailable: undefined })
  })

  it('owner couldn’t be read: the byline says so, never you; Copy link gets the failure reason', () => {
    h.lookup = { data: undefined, isError: true }
    const out = view(list())
    expect(names(out)).toEqual([])
    expect(out).not.toContain('@me')
    expect(note(out)).toBe(OWNER_UNREADABLE)
    expect(h.sheet).toEqual({ ownerUsername: null, linkUnavailable: SHARE_LINK_FAILED })
  })

  it('your own list: you, no lookup, as before', () => {
    const out = view(list({ is_owner: true, owner_id: 'u-me', slug: 'my-board' }), { owner: null })
    expect(h.lookupCalls.every(([, enabled]) => !enabled)).toBe(true)
    expect(names(out)).toEqual(['me'])
    expect(h.sheet?.ownerUsername).toBe('me')
  })

  it('a saved list: the collection’s owner, no lookup, as before', () => {
    const out = view(list({ owner_id: 'u-kelly' }), { owner: { username: 'kelly', avatar_url: null } })
    expect(h.lookupCalls.every(([, enabled]) => !enabled)).toBe(true)
    expect(names(out)).toEqual(['kelly'])
    expect(h.sheet?.ownerUsername).toBe('kelly')
  })
})
