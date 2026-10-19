/**
 * Trash on the phone (gap list §4 item 102): `/app/trash` draws its own
 * FieldScout Mobile screen — the 52px page bar (blue back chevron, "Trash"
 * as the h1) over your soft-deleted lists, each with Restore — in `m-*`
 * tokens only so the phone's dark mode follows, instead of the borrowed
 * desktop layout. Desktop keeps its page, on the same shared hooks.
 *
 * Screens render statically over a seeded query cache (effects don't run);
 * the restore's cache contract runs through a real `QueryClient` with a
 * `MutationObserver` over the hook's own options (no DOM).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/trash',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { listsKeys, restoreListMutationOptions } from '@/hooks/use-lists'
import type { List } from '@/types/database'

import { MobileTrash, TRASH_COPY } from './mobile-trash'

const DAY = 86_400_000

function list(id: string, over: Partial<List> = {}): List {
  return {
    id,
    title: `List ${id}`,
    player_count: 4,
    deleted_at: new Date(Date.now() - 2 * DAY).toISOString(),
    thumbnail_url: null,
    position_filter: null,
    cover_color: null,
    ...over,
  } as List
}

/** Most recently deleted first — the route's order, kept as is. */
const TRASHED: List[] = [
  list('a', { title: 'Sleepers to stash', player_count: 12, position_filter: 'WR' }),
  list('b', { title: 'Zero RB board', player_count: 1, deleted_at: new Date(Date.now() - 5 * DAY).toISOString() }),
  list('c', { title: 'With a cover', thumbnail_url: 'https://example.test/cover.jpg' }),
]

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false }, mutations: { retry: false } } })
}

function render(seed?: (qc: QueryClient) => void): string {
  const qc = client()
  seed?.(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileTrash)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

/** A trash read that failed, with or without rows from an earlier read. */
function failed(data: List[] | undefined) {
  return (qc: QueryClient) => {
    const query = qc.getQueryCache().build(qc, { queryKey: listsKeys.trash() })
    query.setState({ ...query.state, status: 'error', error: new Error('boom'), data, fetchStatus: 'idle' })
  }
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/
function expectPhoneTokensOnly(html: string) {
  const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
  expect(tokens.filter((t) => DESKTOP_COLOUR.test(t) && t !== 'text-white')).toEqual([])
}

describe('Trash — the phone screen (gap list §4 item 102)', () => {
  it('has its own page bar: the blue back chevron and “Trash” as the h1', () => {
    const html = render((qc) => qc.setQueryData(listsKeys.trash(), TRASHED))
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toMatch(/<h1[^>]*>Trash<\/h1>/)
    expect(html).toContain('data-mobile-screen')
  })

  it('lists every deleted list in the route’s order: cover, title, when and size, Restore', () => {
    const html = render((qc) => qc.setQueryData(listsKeys.trash(), TRASHED))
    const rows = [...html.matchAll(/data-trash-row="([^"]+)"/g)].map((m) => m[1])
    expect(rows).toEqual(['a', 'b', 'c'])
    expect(html).toContain('>Sleepers to stash<')
    expect(html).toContain('>Deleted 2d ago · 12 players<')
    expect(html).toContain('>Deleted 5d ago · 1 player<')
    expect(html.match(/data-trash-restore[^>]*>Restore</g)).toHaveLength(3)
    expect(html).toContain('aria-label="Restore “Sleepers to stash”"')
    // Each pill is live: nothing is restoring yet.
    expect(html).not.toMatch(/disabled=""[^>]*data-trash-restore/)
    expectPhoneTokensOnly(html)
  })

  it('draws each tile as the lists glyph on b2, or the list’s uploaded cover', () => {
    const html = render((qc) => qc.setQueryData(listsKeys.trash(), TRASHED))
    const tiles = [...html.matchAll(/<span aria-hidden="true" class="([^"]*)" data-trash-cover="true">([\s\S]*?)<\/span>/g)]
    expect(tiles).toHaveLength(3)
    for (const [, cls] of tiles) expect(cls.split(' ')).toEqual(expect.arrayContaining(['size-10', 'rounded-[12px]', 'bg-m-b2']))
    expect(tiles[0][2]).toContain('<svg')
    expect(tiles[2][2]).toContain('url("https://example.test/cover.jpg")')
  })

  it('soft deletes stay soft: a deleted list can only be restored — never opened or deleted for good', () => {
    const html = render((qc) => qc.setQueryData(listsKeys.trash(), TRASHED))
    expect(html).not.toContain('<a ')
    // Every control on the screen: Back, then one Restore per row.
    const controls = [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((m) => m[1])
    expect(controls).toEqual(['Back', ...TRASHED.map((l) => `Restore “${l.title}”`)])
    expect(html).not.toMatch(/forever|empty trash|permanently/i)
  })

  it('says so when Trash is empty', () => {
    const html = render((qc) => qc.setQueryData(listsKeys.trash(), []))
    expect(html).toContain(`>${TRASH_COPY.emptyTitle}<`)
    expect(html).toContain(`>${TRASH_COPY.emptyBody}<`)
    expect(html).not.toContain('data-trash-row')
    expectPhoneTokensOnly(html)
  })

  it('shows loading rows before the first read', () => {
    const html = render()
    expect(html).toContain('data-trash-loading')
    expect(html).not.toContain(TRASH_COPY.emptyTitle)
  })

  it('a failed read is an error with Try again — never an empty Trash', () => {
    const html = render(failed(undefined))
    expect(html).toContain(`>${TRASH_COPY.loadFailed}<`)
    expect(html).toContain('>boom<')
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/)
    expect(html).not.toContain(TRASH_COPY.emptyTitle)
    expectPhoneTokensOnly(html)
  })

  it('a failed refresh keeps the rows and says it could not refresh', () => {
    const html = render(failed(TRASHED))
    expect(html).toMatch(/role="alert"[\s\S]*Trash could not be refreshed\.[\s\S]*Try again/)
    expect([...html.matchAll(/data-trash-row=/g)]).toHaveLength(3)
  })
})

describe('restoring a list (shared by desktop and the phone)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the restore, drops the list from Trash at once and refreshes every list read', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const qc = client()
    qc.setQueryData(listsKeys.trash(), TRASHED)
    qc.setQueryData(listsKeys.collection(1, 50), { lists: [] })

    await new MutationObserver(qc, restoreListMutationOptions(qc)).mutate('b')

    expect(fetchMock).toHaveBeenCalledWith('/api/lists/b/restore', { method: 'POST' })
    expect(qc.getQueryData<List[]>(listsKeys.trash())?.map((l) => l.id)).toEqual(['a', 'c'])
    expect(qc.getQueryState(listsKeys.collection(1, 50))?.isInvalidated).toBe(true)
  })

  it('two restores at once both leave Trash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const qc = client()
    qc.setQueryData(listsKeys.trash(), TRASHED)
    const options = restoreListMutationOptions(qc)

    await Promise.all([new MutationObserver(qc, options).mutate('a'), new MutationObserver(qc, options).mutate('c')])

    expect(qc.getQueryData<List[]>(listsKeys.trash())?.map((l) => l.id)).toEqual(['b'])
  })

  it('a refused restore keeps the list in Trash and surfaces the server’s reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })),
    )
    const qc = client()
    qc.setQueryData(listsKeys.trash(), TRASHED)

    await expect(new MutationObserver(qc, restoreListMutationOptions(qc)).mutate('a')).rejects.toThrow('Forbidden')
    expect(qc.getQueryData<List[]>(listsKeys.trash())?.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the route draws it on the phone (ByLayout), desktop on the same hooks', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/trash/page.tsx'), 'utf8')
  it('ByLayout: desktop keeps its page, the phone gets MobileTrash', () => {
    expect(page).toContain('<ByLayout desktop={<DesktopTrash />} mobile={<MobileTrash />} />')
  })
  it('desktop reads and restores through the shared hooks, not its own fetches', () => {
    expect(page).toContain('useTrashedLists()')
    expect(page).toContain('useRestoreList()')
    expect(page).not.toContain('fetch(')
  })
})
