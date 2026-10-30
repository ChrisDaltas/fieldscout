/**
 * Desktop Lists panel — the author and Share link on the open list
 * (walk-off-1, live on production with Community off).
 *
 * Opening someone else's public list you haven't saved — ⌘K, or
 * `/app/lists?list=<id>` — the panel used to name *you* as its author: the
 * byline read "@<you> created …", the name linked to your profile, and Share
 * copied `/u/<you>/lists/<slug>`, which 404s. Rendered here through the real
 * panel and the real hero:
 *   - someone else's unsaved list never shows you; it shows the real owner
 *     (read by `useListOwner`, the phone's lookup) and Share copies
 *     `/u/<owner>/lists/<slug>`;
 *   - until that read answers — or if it fails — there is no name at all and
 *     Share is disabled, so no wrong link can be copied;
 *   - if it fails, the byline says "Couldn’t load who made this list" rather
 *     than passing for a list with no author (while loading: no note);
 *   - your own list and a saved list look exactly as they did, with no lookup.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListOwner } from '@/hooks/use-list-owner'
import type { ListWithDetails, ListWithTags } from '@/hooks/use-lists'

interface CapturedHero {
  owner: { username: string; avatarUrl: string | null } | null
  onShare: () => void
  shareUnavailable?: string
}

const h = vi.hoisted(() => ({
  detail: undefined as unknown,
  lookup: { data: undefined, isError: false } as { data: ListOwner | null | undefined; isError: boolean },
  lookupCalls: [] as Array<[string | null | undefined, boolean]>,
  hero: undefined as CapturedHero | undefined,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/app/lists',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u-me' }, profile: { username: 'me', avatar_url: null } }),
}))
vi.mock('@/hooks/use-list-owner', () => ({
  useListOwner: (ownerId: string | null | undefined, enabled: boolean) => {
    h.lookupCalls.push([ownerId, enabled])
    return enabled ? h.lookup : { data: undefined, isError: false }
  },
}))
vi.mock('@/hooks/use-lists', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-lists')>()
  const idle = () => ({ mutate: () => {}, isPending: false })
  return {
    ...actual,
    useList: () => h.detail,
    useUpdateList: idle,
    useDuplicateList: idle,
    useDeleteList: idle,
    useAddPlayer: idle,
    useRemovePlayer: idle,
    useAddLink: idle,
    useRemoveLink: idle,
    useToggleFavorite: idle,
  }
})
vi.mock('@/hooks/use-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-comments')>()
  return { ...actual, useComments: () => ({ data: undefined }) }
})
vi.mock('@/hooks/use-draft-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-draft-mode')>()
  return { ...actual, useDraftMode: () => ({ drafted: new Set<string>(), toggleDrafted: () => {}, clearDrafted: () => false }) }
})
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({ data: [] }),
  useMoveListToFolder: () => ({ mutate: () => {} }),
}))
vi.mock('@/hooks/use-ai-list-build', () => ({
  useAiListBuild: () => ({ job: null, building: false, retry: () => {}, dismiss: () => {} }),
}))
vi.mock('@/components/leagues/attach-list-modal', () => ({ AttachListToLeagueModal: () => null }))
vi.mock('@/components/lists/v2/use-list-drop', () => ({ useListDropCommit: () => () => {} }))
// The real hero, with the props the panel hands it kept so Share can be pressed.
vi.mock('@/components/lists/v2/list-detail-hero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/lists/v2/list-detail-hero')>()
  return {
    ...actual,
    ListDetailHero: (props: Parameters<typeof actual.ListDetailHero>[0]) => {
      h.hero = props as unknown as CapturedHero
      return createElement(actual.ListDetailHero, props)
    },
  }
})

import { ListDetailPanel } from './list-detail-panel'
import { OWNER_UNREADABLE, SHARE_LINK_FAILED, SHARE_LINK_LOADING } from './list-owner'

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
    folder_id: null,
    ranking_mode: 'ranked',
    comments_enabled: true,
    player_count: 0,
    view_count: 0,
    created_at: '2026-10-29T00:00:00Z',
    updated_at: '2026-10-29T00:00:00Z',
    tags: [],
    links: [],
    players: [],
    ...over,
  } as unknown as ListWithDetails
}

function render(l: ListWithDetails, summary?: Partial<ListWithTags>): string {
  h.detail = { data: l, isError: false }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ListDetailPanel, {
        listId: l.id,
        summary: summary as ListWithTags | undefined,
        viewer: { username: 'me', avatarUrl: null },
        expanded: false,
        onToggleExpanded: noop,
        onClose: noop,
        onDeleted: noop,
      }),
    ),
  )
}

/** The byline names (`UsernameLink` marks each with its username). */
const names = (out: string) => [...out.matchAll(/data-username-link="([^"]+)"/g)].map((m) => m[1])
/** The byline's word for an owner who couldn't be read, if it shows one. */
const ownerNote = (out: string) => out.match(/data-owner-note="[^"]*"[^>]*>([^<]*)</)?.[1] ?? null
/** Whether Share's `<button>` carries the `disabled` attribute. */
const shareDisabled = (out: string) => {
  const at = out.lastIndexOf('<button', out.indexOf('Share</button>'))
  expect(at).toBeGreaterThan(-1)
  return /\sdisabled=""/.test(out.slice(at, out.indexOf('>', at) + 1))
}

let writeText: ReturnType<typeof vi.fn>
/** Press the hero's Share as the browser would, and say what was copied. */
async function pressShare(): Promise<string[]> {
  vi.stubGlobal('window', { location: { origin: ORIGIN } })
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  h.hero!.onShare()
  await Promise.resolve()
  return writeText.mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
  h.lookup = { data: undefined, isError: false }
  h.lookupCalls = []
  h.hero = undefined
  writeText = vi.fn(() => Promise.resolve())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('someone else’s public list you haven’t saved (⌘K / ?list=<id>)', () => {
  it('asks for the real owner, by the list’s owner id', () => {
    render(list())
    expect(h.lookupCalls.at(-1)).toEqual(['u-devpro', true])
  })

  it('once read: the byline names the owner (linked to their profile), never you', () => {
    h.lookup = { data: { username: 'devpro', avatarUrl: null }, isError: false }
    const out = render(list())
    expect(names(out)).toEqual(['devpro'])
    expect(out).toContain('>@devpro<')
    expect(out).not.toContain('@me')
    expect(ownerNote(out)).toBeNull()
    expect(shareDisabled(out)).toBe(false)
  })

  it('Share copies the owner’s link — /u/<owner>/lists/<slug> — never yours', async () => {
    h.lookup = { data: { username: 'devpro', avatarUrl: null }, isError: false }
    render(list())
    expect(await pressShare()).toEqual([`${ORIGIN}/u/devpro/lists/devpro-sleepers`])
  })

  it('while the owner is loading: no name at all, Share disabled, nothing copied', async () => {
    const out = render(list())
    expect(names(out)).toEqual([])
    expect(out).not.toContain('@me')
    expect(out).toContain('Created ')
    // Still loading is not a failure: no note in the byline.
    expect(ownerNote(out)).toBeNull()
    expect(shareDisabled(out)).toBe(true)
    expect(out).toContain(`title="${SHARE_LINK_LOADING}"`)
    expect(await pressShare()).toEqual([])
  })

  it('if the owner can’t be read: still never you, the byline says so, Share disabled with the reason', async () => {
    h.lookup = { data: undefined, isError: true }
    const out = render(list())
    expect(names(out)).toEqual([])
    expect(out).not.toContain('@me')
    expect(ownerNote(out)).toBe(OWNER_UNREADABLE)
    // The note leads the byline, then the date and the count.
    expect(out.indexOf(OWNER_UNREADABLE)).toBeLessThan(out.indexOf('· Created '))
    expect(shareDisabled(out)).toBe(true)
    expect(out).toContain(`title="${SHARE_LINK_FAILED}"`)
    expect(await pressShare()).toEqual([])
  })
})

describe('your own and saved lists are unchanged', () => {
  it('your own list: you, no lookup, Share copies your link', async () => {
    const out = render(list({ is_owner: true, owner_id: 'u-me', slug: 'my-board' }), { owner: null })
    expect(h.lookupCalls.every(([, enabled]) => !enabled)).toBe(true)
    expect(names(out)).toEqual(['me'])
    expect(out).toContain('created ')
    expect(ownerNote(out)).toBeNull()
    expect(shareDisabled(out)).toBe(false)
    expect(await pressShare()).toEqual([`${ORIGIN}/u/me/lists/my-board`])
  })

  it('a saved list: the collection’s owner, no lookup, Share copies their link', async () => {
    const out = render(list({ owner_id: 'u-kelly', slug: 'kelly-board' }), {
      owner: { username: 'kelly', avatar_url: null },
    })
    expect(h.lookupCalls.every(([, enabled]) => !enabled)).toBe(true)
    expect(names(out)).toEqual(['kelly'])
    expect(out).not.toContain('@me')
    expect(ownerNote(out)).toBeNull()
    expect(await pressShare()).toEqual([`${ORIGIN}/u/kelly/lists/kelly-board`])
  })
})
