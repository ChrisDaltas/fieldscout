/**
 * The commissioner note on the phone (gap list #13; migration 192): the
 * League tab's card, the full-note sheet the Menu row and the card open, and
 * the commissioner's edit sheet — rendered from a seeded query.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LEAGUE_NOTE_EMPTY_COMMISH, LEAGUE_NOTE_EMPTY_MEMBER, LEAGUE_NOTE_ERROR, LEAGUE_NOTE_UNAVAILABLE } from '@/components/leagues/league-note-ops'
import { leagueNoteKeys, type LeagueNoteView } from '@/hooks/use-league-note'

import { LeagueNoteCard, LeagueNoteEditSheet, LeagueNoteSheets } from './league-note'

// The sheet portals (Radix) — a static render shows nothing; render its
// body in place so it can be read. A CLOSED sheet leaves an empty marker so a
// pin can tell "mounted but closed" (its state — an open editor's draft —
// alive) from "unmounted"; `visible()` drops the markers.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': title }, children, footer) : createElement('template', { 'data-sheet-closed': title }),
}))

const LEAGUE = 'e9200000-0000-4000-8000-000000000001'
const NOTE: LeagueNoteView = {
  available: true,
  note: { text: 'Trade deadline is Nov 24.\nDues by Friday.', updated_at: '2026-10-02T18:00:00.000Z', author: { id: 'u1', username: 'chris_gm' } },
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** A seeded read: loaded, a failed first read, or a failed RE-read that
 *  keeps the note it already had (React Query keeps `data` on a refetch
 *  error — e.g. the re-read after a save that failed offline). */
type Seed = LeagueNoteView | 'error' | { refetchFailed: LeagueNoteView }

function render(element: ReturnType<typeof createElement>, seed?: Seed): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (seed === 'error' || (typeof seed === 'object' && 'refetchFailed' in seed)) {
    const kept = seed === 'error' ? undefined : seed.refetchFailed
    const query = qc.getQueryCache().build(qc, { queryKey: leagueNoteKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: kept, dataUpdatedAt: kept ? 1 : 0 })
  } else if (seed) {
    qc.setQueryData(leagueNoteKeys.detail(LEAGUE), seed)
  }
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

/** What a viewer sees — the closed-sheet markers dropped. */
const visible = (html: string) => html.replace(/<template data-sheet-closed="[^"]*"><\/template>/g, '')
const closedSheets = (html: string) => (html.match(/data-sheet-closed="Commissioner note"/g) ?? []).length

describe('League tab — the note card', () => {
  it('shows the note (three lines at most), who pinned it (a profile link) and when; a tap opens it', () => {
    const html = render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: false }), NOTE)
    expect(html).toContain('data-league-note="shown"')
    expect(html).toContain('Commissioner note')
    expect(html).toMatch(/line-clamp-3[^"]*"[^>]*>Trade deadline is Nov 24.\nDues by Friday.</)
    expect(html).toMatch(/Pinned by <a[^>]*href="\/u\/chris_gm"[^>]*>chris_gm<\/a>/)
    expect(html).toContain('data-league-note-open')
    // The profile link is not inside the open button (no link in a button).
    expect(html).not.toMatch(/<button[^>]*data-league-note-open[^>]*>(?:(?!<\/button>)[\s\S])*<a /)
  })

  it('no note, or a database without notes, or still reading: no card', () => {
    expect(visible(render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: true }), { available: true, note: null }))).toBe('')
    expect(visible(render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: true }), { available: false, note: null }))).toBe('')
    expect(visible(render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: true })))).toBe('')
  })

  it('a failed first read says so, with Retry', () => {
    const html = visible(render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: false }), 'error'))
    expect(html).toContain('role="alert"')
    expect(html).toContain(LEAGUE_NOTE_ERROR)
    expect(html).toContain('Retry')
  })

  it('a failed RE-read keeps the card with the note it already has — no error banner over it', () => {
    const html = render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: false }), { refetchFailed: NOTE })
    expect(html).toContain('data-league-note="shown"')
    expect(html).not.toContain('role="alert"')
  })

  it('the sheets stay mounted through a failed read — an open note, and the commissioner’s draft in the edit sheet, are never unmounted', () => {
    // A save that fails offline re-reads the note, and that re-read fails
    // too. The full-note sheet and the edit sheet (where the draft lives)
    // are mounted whatever the card shows — banner, card or nothing.
    for (const seed of ['error', { refetchFailed: NOTE }, { available: true, note: null }] as const) {
      expect(closedSheets(render(createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit: true }), seed))).toBe(2)
    }
  })
})

describe('the Menu’s "Commissioner note" — the note in full', () => {
  const sheet = (canEdit: boolean, seed: Seed) =>
    render(createElement(LeagueNoteSheets, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, canEdit }), seed)

  it('a member reads it in full — no edit', () => {
    const html = sheet(false, NOTE)
    expect(html).toContain('data-sheet="Commissioner note"')
    expect(html).toContain('data-league-note-full')
    expect(html).toContain('Trade deadline is Nov 24.\nDues by Friday.')
    expect(html).not.toContain('data-league-note-edit')
  })

  it('a commissioner gets "Edit note"', () => {
    expect(sheet(true, NOTE)).toMatch(/data-league-note-edit[^>]*>Edit note</)
  })

  it('no note: a member is told so; a commissioner is invited to add one', () => {
    const none: LeagueNoteView = { available: true, note: null }
    expect(sheet(false, none)).toContain(LEAGUE_NOTE_EMPTY_MEMBER)
    const commish = sheet(true, none)
    expect(commish).toContain(LEAGUE_NOTE_EMPTY_COMMISH)
    expect(commish).toMatch(/data-league-note-edit[^>]*>Add a note</)
  })

  it('a failed RE-read keeps the note it has (and Edit); a failed first read says so', () => {
    const kept = sheet(true, { refetchFailed: NOTE })
    expect(kept).toContain('data-league-note-full')
    expect(kept).not.toContain('role="alert"')
    expect(kept).toMatch(/data-league-note-edit[^>]*>Edit note</)
    const failed = sheet(false, 'error')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain(LEAGUE_NOTE_ERROR)
  })

  it('a database without notes says so, and offers no edit', () => {
    const html = sheet(true, { available: false, note: null })
    expect(html).toContain(LEAGUE_NOTE_UNAVAILABLE)
    expect(html).not.toContain('data-league-note-edit')
  })
})

describe('the commissioner’s edit sheet', () => {
  const edit = (current: string | null) =>
    render(createElement(LeagueNoteEditSheet, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, current }))

  it('starts from the pinned note, counts it, and offers Clear note', () => {
    const html = edit('Dues by Friday')
    expect(html).toMatch(/<textarea[^>]*aria-label="Commissioner note"[^>]*>Dues by Friday<\/textarea>/)
    expect(html).toContain('14 / 500')
    expect(html).toContain('data-league-note-clear')
    // Unchanged → Save is not offered yet.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-league-note-save[^>]*>Save</)
  })

  it('a new note: an empty field, "Pin note", no Clear', () => {
    const html = edit(null)
    expect(html).toContain('0 / 500')
    expect(html).toMatch(/data-league-note-save[^>]*>Pin note</)
    expect(html).not.toContain('data-league-note-clear')
  })
})
