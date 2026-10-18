/**
 * FieldScout Mobile — New list's two steps (gap list §3 #7): Return on the
 * keyboard moves on once the list has a name, and the editor New list opens
 * reads "2 of 2" after New list's "1 of 2".
 *
 * Pinned here:
 *   - The name field's Return key is labelled Next on New list and Done in
 *     Edit details, and `nameReturnMovesOn` decides when Return moves on:
 *     only with a name (the button's "on"), never for the Enter that ends
 *     an IME word.
 *   - The editor reads "2 of 2" beside Update when its URL carries `new=1`
 *     (New list's Next), loading or loaded, and not when opened from the
 *     List view (the positive/negative pair).
 * The URL that carries the marker is pinned in `lists-nav.test.ts`.
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

import type { ListWithDetails } from '@/hooks/use-lists'

import { nameReturnMovesOn } from './details-payload'
import { NewListScreen } from './list-details-screen'
import { MobileLists } from './mobile-lists'

const LIST = {
  id: 'l1',
  title: 'My top 5 QBs',
  description: null,
  player_count: 0,
  updated_at: new Date().toISOString(),
  thumbnail_url: null,
  position_filter: 'QB',
  is_favorites: false,
  is_team: false,
  is_big_board: false,
  ranking_mode: 'ranked',
  is_owner: true,
  is_private: false,
  slug: 'my-top-5',
  owner_id: 'u1',
  cover_color: null,
  tags: [],
  links: [],
  players: [],
} as unknown as ListWithDetails

function renderLists(query: string, loaded = true) {
  search = new URLSearchParams(query)
  const qc = new QueryClient()
  if (loaded) qc.setQueryData(['lists', 'detail', 'l1'], LIST)
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: [], pagination: { page: 1, pageSize: 50, total: 0, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
}

function renderNew() {
  search = new URLSearchParams()
  const qc = new QueryClient()
  qc.setQueryData(['list-cover-color-support'], true)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NewListScreen)))
}

/** The name field's tag. */
const nameField = (html: string) => /<input[^>]*aria-label="List name"[^>]*>/.exec(html)?.[0] ?? ''

/** The header's step label (New list's and the editor's: 12/600 t3). */
const stepLabel = (html: string) => /<span class="[^"]*text-\[12px\] font-semibold text-m-t3">(\d of 2)<\/span>/.exec(html)?.[1]

describe('Return in the name field', () => {
  it('New list: the key reads Next, and the header is step 1 of 2', () => {
    const out = renderNew()
    expect(nameField(out)).toContain('enterKeyHint="next"')
    expect(stepLabel(out)).toBe('1 of 2')
  })

  it('Edit details: the key reads Done, and there is no step', () => {
    const out = renderLists('list=l1&details=1')
    expect(out).toContain('Edit details')
    expect(nameField(out)).toContain('enterKeyHint="done"')
    expect(stepLabel(out)).toBeUndefined()
  })

  const ret = { key: 'Enter', isComposing: false, keyCode: 13 }

  it('moves on once the list has a name', () => {
    expect(nameReturnMovesOn(ret, true)).toBe(true)
  })

  it('does nothing without a name (the button is off too)', () => {
    expect(nameReturnMovesOn(ret, false)).toBe(false)
  })

  it('the Enter that finishes an IME word is not a Return', () => {
    expect(nameReturnMovesOn({ ...ret, isComposing: true }, true)).toBe(false)
    // Safari: keyCode 229 with `isComposing` already false.
    expect(nameReturnMovesOn({ ...ret, keyCode: 229 }, true)).toBe(false)
  })

  it('other keys type as usual', () => {
    expect(nameReturnMovesOn({ key: 'a', isComposing: false, keyCode: 65 }, true)).toBe(false)
    expect(nameReturnMovesOn({ key: 'Tab', isComposing: false, keyCode: 9 }, true)).toBe(false)
  })
})

describe('the editor New list opens: "2 of 2"', () => {
  it('reads 2 of 2 beside Update', () => {
    const out = renderLists('list=l1&edit=1&add=1&new=1&from=view')
    expect(stepLabel(out)).toBe('2 of 2')
    // Beside Update, after the name.
    const step = out.indexOf('2 of 2')
    expect(out.indexOf('aria-label="List name"')).toBeLessThan(step)
    expect(out.indexOf('>Update<')).toBeGreaterThan(step)
  })

  it('reads 2 of 2 while the new list loads, too', () => {
    const out = renderLists('list=l1&edit=1&add=1&new=1', false)
    expect(out).toContain('aria-label="Loading list"')
    expect(stepLabel(out)).toBe('2 of 2')
  })

  it('opened from the List view (Edit, or its empty state’s Add players): no step', () => {
    for (const query of ['list=l1&edit=1&from=view', 'list=l1&edit=1&add=1&from=view']) {
      const out = renderLists(query)
      // Positive control: this is the editor, rendered.
      expect(out).toContain('>Update<')
      expect(out).toContain('0 players · drag to reorder')
      expect(stepLabel(out)).toBeUndefined()
      expect(out).not.toContain('of 2')
    }
  })
})
