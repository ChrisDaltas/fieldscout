/**
 * FieldScout Mobile — New list's two steps (gap list §3 #7; lr-lists §4):
 * Return on the keyboard moves on once the list has a name, and step 2 — the
 * editor for a list not made yet — reads "2 of 2" after New list's "1 of 2".
 *
 * Pinned here:
 *   - The name field's Return key is labelled Next on New list and Done in
 *     Edit details, and `nameReturnMovesOn` decides when Return moves on:
 *     only with a name (the button's "on"), never for the Enter that ends
 *     an IME word.
 *   - Step 2 (`NewListEditor`) reads "2 of 2" beside **Save**, which is live
 *     with no players yet (a name is enough — Save is what makes the list),
 *     and it opens on the draft it is handed — the players Back kept.
 *   - The List view's editor has no step, and its Update stays off until
 *     something changes (the positive/negative pair).
 *   - A reload or link on step 2 has no draft: it shows step 1.
 *   - Next saves nothing: step 1's Next only moves on.
 * Save itself (`saveNewList`) is pinned in `new-list-save.test.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
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

import type { ListPlayerWithPlayer, ListWithDetails } from '@/hooks/use-lists'

import { nameReturnMovesOn } from './details-payload'
import { NewListScreen } from './list-details-screen'
import { NewListEditor } from './list-editor'
import type { ListDraft } from './lists-model'
import { MobileLists } from './mobile-lists'
import { stepTwoDraft } from './new-list-save'

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

function renderNew(query = '') {
  search = new URLSearchParams(query)
  const qc = new QueryClient()
  qc.setQueryData(['list-cover-color-support'], true)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NewListScreen)))
}

/** New list's step 2, handed `draft` (as `NewListScreen` hands it). */
function renderStep2(draft: ListDraft, exists = false) {
  search = new URLSearchParams('from=grid&step=2')
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(NewListEditor, {
        draftKey: 'new-list:test',
        title: draft.title,
        positionFilter: 'QB',
        draft,
        exists,
        commit: { mutate: () => {}, isPending: false },
        onDraftChange: () => {},
        onBack: () => {},
        onSaved: () => {},
      }),
    ),
  )
}

function player(id: string, name: string, position: number): ListPlayerWithPlayer {
  return {
    id: `draft-${id}`,
    list_id: 'new-list:test',
    player_id: id,
    position,
    overall_rank: position,
    tier: null,
    rank_in_tier: null,
    notes: null,
    slot: null,
    added_at: null,
    updated_at: null,
    player: { id, full_name: name, position: 'QB', team: 'BUF', headshot_url: null, status: 'active' },
    stats: { current_pts: 0, current_games: 0, last_pts: 0, last_games: 0, projected_pts: 0 },
  } as unknown as ListPlayerWithPlayer
}

/** The name field's tag. */
const nameField = (html: string) => /<input[^>]*aria-label="List name"[^>]*>/.exec(html)?.[0] ?? ''

/** The header's Update button, tag and label. */
const updateButton = (html: string) => /<button(?:(?!<button)[^])*?>Update<\/button>/.exec(html)?.[0] ?? ''

/** Step 2's Save button, tag and label. */
const saveButton = (html: string) => /<button(?:(?!<button)[^])*?>Save<\/button>/.exec(html)?.[0] ?? ''

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

describe('New list’s step 2 of 2: the editor for a list not made yet', () => {
  it('reads 2 of 2 beside Save', () => {
    const out = renderStep2(stepTwoDraft(null, 'My top 5 QBs'))
    expect(stepLabel(out)).toBe('2 of 2')
    // Beside Save, after the name.
    const step = out.indexOf('2 of 2')
    expect(out.indexOf('aria-label="List name"')).toBeLessThan(step)
    expect(out.indexOf('>Save<')).toBeGreaterThan(step)
    expect(out).not.toContain('>Update<')
  })

  it('Save is live with no players yet: a name is enough, and Save is what makes the list', () => {
    const out = renderStep2(stepTwoDraft(null, 'My top 5 QBs'))
    expect(out).toContain('0 players · drag to reorder')
    const button = saveButton(out)
    expect(button).toContain('bg-accent')
    expect(button).not.toContain('disabled')
  })

  it('opens on the draft it is handed: the players Back kept come back with Next', () => {
    const fresh = stepTwoDraft(null, 'Old name')
    const kept: ListDraft = { ...fresh, entries: [player('p1', 'Josh Allen', 1), player('p2', 'Lamar Jackson', 2)] }
    // Step 1 renamed it before Next: the players stay, the name is step 1's.
    const out = renderStep2(stepTwoDraft(kept, 'My top 5 QBs'))
    expect(out).toContain('2 players · drag to reorder')
    expect(out).toContain('J. Allen')
    expect(out).toContain('L. Jackson')
    expect(out).toMatch(/aria-label="List name"[^>]*value="My top 5 QBs"|value="My top 5 QBs"[^>]*aria-label="List name"/)
  })

  it('once a Save has made the list but not all of it, Save follows the changes like Update', () => {
    const fresh = stepTwoDraft(null, 'My top 5 QBs')
    expect(saveButton(renderStep2(fresh, true))).toContain('disabled')
    const withPlayers: ListDraft = { ...fresh, entries: [player('p1', 'Josh Allen', 1)] }
    expect(saveButton(renderStep2(withPlayers, true))).not.toContain('disabled')
  })

  it('a reload or link on step 2 has no draft to show: step 1, nothing made', () => {
    const out = renderNew('from=grid&step=2')
    expect(stepLabel(out)).toBe('1 of 2')
    expect(out).toContain('Next: add players')
    expect(out).not.toContain('drag to reorder')
  })

  it('Next saves nothing: step 1’s Next only moves on to step 2', () => {
    const source = readFileSync(new URL('./list-details-screen.tsx', import.meta.url), 'utf8')
    const next = /\n {2}const next = \(\) => \{\n([^]*?)\n {2}\}\n/.exec(source)?.[1] ?? ''
    // Positive control: this is the handler, and it opens step 2.
    expect(next).toContain('stepTwoDraft(')
    expect(next).toContain('pushState')
    expect(next).not.toMatch(/mutate|fetch|createList|saveNewList/)
    // The form's own Next hands straight to it before anything is sent.
    expect(source).toMatch(/if \(mode === 'new'\) return onNext\?\.\(\)\n {4}setBusy\(true\)/)
  })
})

describe('the List view’s editor', () => {
  it('opened from the List view (Edit, or its empty state’s Add players): no step, and Update stays off until something changes', () => {
    for (const query of ['list=l1&edit=1&from=view', 'list=l1&edit=1&add=1&from=view']) {
      const out = renderLists(query)
      // Positive control: this is the editor, rendered.
      expect(out).toContain('0 players · drag to reorder')
      expect(stepLabel(out)).toBeUndefined()
      expect(out).not.toContain('of 2')
      const button = updateButton(out)
      expect(button).toContain('>Update<')
      expect(button).toContain('disabled')
      expect(button).toContain('bg-m-b2')
      expect(button).not.toContain('bg-accent')
    }
  })

  it('an old step-2 link (`new=1`) is just the list’s editor now', () => {
    const out = renderLists('list=l1&edit=1&add=1&new=1&from=view')
    expect(out).toContain('>Update<')
    expect(stepLabel(out)).toBeUndefined()
  })
})
