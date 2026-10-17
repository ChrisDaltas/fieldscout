/**
 * FieldScout Mobile — cover colours and the position group on New list / Edit
 * details (Chris, 2026-10-15; migration 188).
 *
 * Pinned here:
 *   - The six swatches show only for the Player collage cover, and only once
 *     the column exists: Edit details checks the loaded row for the
 *     `cover_color` key; New list asks the database (the support probe).
 *   - No colour chosen = the cover follows the position group; a chosen one
 *     is pressed and fills the collage tile.
 *   - The position group choice is on both screens (hidden for a team list,
 *     as on desktop) — so a team list's swatch line speaks of "the default
 *     colour", not a position group it can't see.
 *   - The grid's cards paint the chosen colour.
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

import type { ListWithDetails, ListWithTags } from '@/hooks/use-lists'

import { NewListScreen } from './list-details-screen'
import { MobileLists } from './mobile-lists'

const NOW = new Date(Date.now() - 2 * 86_400_000).toISOString()

function detail(extra: Record<string, unknown>): ListWithDetails {
  return {
    id: 'l1',
    title: 'My top 5 QBs',
    description: null,
    player_count: 0,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'QB',
    is_favorites: false,
    is_team: false,
    ranking_mode: 'ranked',
    is_owner: true,
    is_private: false,
    slug: 'my-top-5',
    owner_id: 'u1',
    tags: [],
    links: [],
    players: [],
    ...extra,
  } as unknown as ListWithDetails
}

function summary(extra: Record<string, unknown>): ListWithTags {
  return {
    id: 'l2',
    title: 'Coloured list',
    player_count: 0,
    updated_at: NOW,
    thumbnail_url: null,
    position_filter: 'QB',
    is_favorites: false,
    owner: null,
    tags: [],
    first_players: [],
    ...extra,
  } as unknown as ListWithTags
}

function renderApp(query: string, list: ListWithDetails, cards: ListWithTags[] = []) {
  search = new URLSearchParams(query)
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'detail', 'l1'], list)
  qc.setQueryData(['lists', 'collection', 1, 50], {
    lists: cards,
    pagination: { page: 1, pageSize: 50, total: cards.length, hasMore: false },
  })
  qc.setQueryData(['folders'], { folders: [] })
  qc.setQueryData(['mobile-lists', 'video-flags', cards.map((c) => c.id).join(',')], new Set())
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
}

function renderNew(supported: boolean | undefined) {
  search = new URLSearchParams()
  const qc = new QueryClient()
  if (supported !== undefined) qc.setQueryData(['list-cover-color-support'], supported)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NewListScreen)))
}

/** The `class` of the first element carrying `attr`. */
function classOf(html: string, attr: string): string {
  const at = html.indexOf(attr)
  expect(at, attr).toBeGreaterThan(-1)
  const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at))
  return /class="([^"]*)"/.exec(tag)?.[1] ?? ''
}

/** The collage tile's fill (the span inside the "Player collage" button). */
function collageTileClass(html: string): string {
  const at = html.indexOf('>Player collage<')
  const button = html.slice(html.lastIndexOf('<button', at), at)
  return /<span class="([^"]*)"/.exec(button)?.[1] ?? ''
}

describe('Edit details — cover colour', () => {
  it('after 188 (the row carries the key): six swatches, none chosen, the tile follows the position group', () => {
    const out = renderApp('list=l1&details=1', detail({ cover_color: null }))
    expect(out).toContain('aria-label="Cover colour"')
    for (const label of ['Blue', 'Black', 'Red', 'Purple', 'Indigo', 'Green']) {
      expect(out).toContain(`aria-label="${label}"`)
    }
    expect(out).toContain('Follows the position group until you pick one')
    expect(collageTileClass(out)).toContain('bg-pos-qb')
    expect(classOf(out, 'aria-label="Green"')).not.toContain('ring-confirm')
  })

  it('a chosen colour is pressed, ringed in its colour, and fills the tile', () => {
    const out = renderApp('list=l1&details=1', detail({ cover_color: 'green' }))
    const green = classOf(out, 'aria-label="Green"')
    expect(green).toContain('ring-confirm')
    expect(green).toContain('ring-offset-2')
    expect(out).toMatch(/aria-pressed="true" aria-label="Green"/)
    expect(collageTileClass(out)).toContain('bg-confirm')
    expect(out).toContain('Tap it again to follow the position group')
  })

  it('before 188 (no key on the row): no swatches, and the tile keeps the position colour', () => {
    const out = renderApp('list=l1&details=1', detail({}))
    expect(out).not.toContain('aria-label="Cover colour"')
    expect(collageTileClass(out)).toContain('bg-pos-qb')
  })

  it('a team list (no position group to follow) says "the default colour" instead', () => {
    const none = renderApp('list=l1&details=1', detail({ is_team: true, position_filter: null, cover_color: null }))
    expect(none).toContain('aria-label="Cover colour"')
    expect(none).toContain('Uses the default colour until you pick one')
    expect(none).not.toContain('position group')
    const chosen = renderApp('list=l1&details=1', detail({ is_team: true, position_filter: null, cover_color: 'ink' }))
    expect(chosen).toContain('Tap it again to go back to the default colour')
  })

  it('an uploaded cover hides the swatches (they belong to the collage)', () => {
    const out = renderApp('list=l1&details=1', detail({ cover_color: 'red', thumbnail_url: 'https://x.test/c.png' }))
    expect(out).not.toContain('aria-label="Cover colour"')
  })
})

describe('Edit details — position group', () => {
  it('shows the list’s group, with All and every position', () => {
    const out = renderApp('list=l1&details=1', detail({ cover_color: null }))
    expect(out).toContain('>Position group<')
    expect(out).toMatch(/aria-pressed="true"[^>]*>QB</)
    for (const label of ['All', 'RB', 'WR', 'FLEX', 'TE', 'D/ST', 'K']) expect(out).toContain(`>${label}</button>`)
  })

  it('no group reads as All; a team list has no group to pick', () => {
    expect(renderApp('list=l1&details=1', detail({ position_filter: null }))).toMatch(/aria-pressed="true"[^>]*>All</)
    expect(renderApp('list=l1&details=1', detail({ is_team: true }))).not.toContain('>Position group<')
  })
})

describe('New list', () => {
  it('offers the position group and, once the column exists, the swatches', () => {
    const out = renderNew(true)
    expect(out).toContain('>Position group<')
    expect(out).toMatch(/aria-pressed="true"[^>]*>All</)
    expect(out).toContain('aria-label="Cover colour"')
    // No colour yet, no position: today's default accent.
    expect(collageTileClass(out)).toContain('bg-accent')
  })

  it('hides the swatches until the database says the column is there', () => {
    expect(renderNew(false)).not.toContain('aria-label="Cover colour"')
    expect(renderNew(undefined)).not.toContain('aria-label="Cover colour"')
  })
})

describe('Lists grid', () => {
  it('a card paints its chosen colour; a card without one keeps its position colour', () => {
    const out = renderApp('', detail({}), [
      summary({ id: 'l2', title: 'Chosen purple', cover_color: 'purple' }),
      summary({ id: 'l3', title: 'Position red' }),
    ])
    const coverBefore = (title: string) => {
      const at = out.indexOf(title)
      const chunk = out.slice(out.lastIndexOf('<button', at), at)
      return /aspect-square[^"]*/.exec(chunk)?.[0] ?? ''
    }
    expect(coverBefore('Chosen purple')).toContain('bg-pos-wr')
    expect(coverBefore('Position red')).toContain('bg-pos-qb')
  })
})
