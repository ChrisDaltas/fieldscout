/**
 * The commissioner note on desktop League Home (gap list #13; migration
 * 192): what each viewer sees in each state, rendered from a seeded query.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { leagueNoteKeys, type LeagueNoteView } from '@/hooks/use-league-note'

import { LeagueNoteCard, LeagueNoteCardView } from './league-note-card'
import { LEAGUE_NOTE_EMPTY_COMMISH, LEAGUE_NOTE_ERROR } from './league-note-ops'

const LEAGUE = 'e9200000-0000-4000-8000-000000000001'

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** A seeded read: loaded, still reading, a failed first read, or a failed
 *  RE-read that keeps the note it already had (React Query keeps `data` on a
 *  refetch error — e.g. the re-read after a save that failed offline). */
type Seed = LeagueNoteView | 'pending' | 'error' | { refetchFailed: LeagueNoteView }

function renderSeeded(seed: Seed, element: ReturnType<typeof createElement>): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (seed === 'error' || (typeof seed === 'object' && 'refetchFailed' in seed)) {
    const kept = seed === 'error' ? undefined : seed.refetchFailed
    const query = qc.getQueryCache().build(qc, { queryKey: leagueNoteKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: kept, dataUpdatedAt: kept ? 1 : 0 })
  } else if (seed !== 'pending') {
    qc.setQueryData(leagueNoteKeys.detail(LEAGUE), seed)
  }
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

function render(seed: Seed, canEdit: boolean): string {
  return renderSeeded(seed, createElement(LeagueNoteCard, { leagueId: LEAGUE, canEdit }))
}

/** The card with its editor open (the controlled view LeagueNoteCard holds). */
function renderEditing(seed: Seed): string {
  return renderSeeded(seed, createElement(LeagueNoteCardView, { leagueId: LEAGUE, canEdit: true, editing: true, onEditingChange: () => {} }))
}

const NOTE: LeagueNoteView = {
  available: true,
  note: { text: 'Trade deadline is Nov 24.\nDues by Friday.', updated_at: '2026-10-02T18:00:00.000Z', author: { id: 'u1', username: 'chris_gm' } },
}

describe('League Home — the commissioner note', () => {
  it('a member sees the note, who pinned it (a profile link) and when — no Edit', () => {
    const html = render(NOTE, false)
    expect(html).toContain('data-league-note="shown"')
    expect(html).toContain('Commissioner note')
    expect(html).toContain('Trade deadline is Nov 24.\nDues by Friday.')
    expect(html).toContain('whitespace-pre-line')
    expect(html).toMatch(/Pinned by <a[^>]*href="\/u\/chris_gm"[^>]*>@chris_gm<\/a>/)
    expect(html).not.toContain('data-league-note-edit')
  })

  it('a commissioner also gets Edit', () => {
    expect(render(NOTE, true)).toContain('data-league-note-edit')
  })

  it('no note: nothing for a member; a one-line prompt with Add note for a commissioner', () => {
    const none: LeagueNoteView = { available: true, note: null }
    expect(render(none, false)).toBe('')
    const commish = render(none, true)
    expect(commish).toContain('data-league-note="empty"')
    expect(commish).toContain(LEAGUE_NOTE_EMPTY_COMMISH)
    expect(commish).toContain('data-league-note-add')
  })

  it('before the database has notes (192 not pushed): nothing for anyone', () => {
    expect(render({ available: false, note: null }, true)).toBe('')
    expect(render({ available: false, note: null }, false)).toBe('')
  })

  it('while reading: nothing (the home never waits on the note)', () => {
    expect(render('pending', true)).toBe('')
  })

  it('a failed read says so, with Retry — never a silent "no note"', () => {
    const html = render('error', false)
    expect(html).toContain('role="alert"')
    expect(html).toContain(LEAGUE_NOTE_ERROR)
    expect(html).toContain('Retry')
  })

  it('a failed RE-read keeps showing the note it already has — the error card is only for a note never loaded', () => {
    const html = render({ refetchFailed: NOTE }, false)
    expect(html).toContain('data-league-note="shown"')
    expect(html).toContain('Trade deadline is Nov 24.')
    expect(html).not.toContain('role="alert"')
  })

  it('an open editor survives a failed re-read — the commissioner’s typing is never unmounted under him', () => {
    // A save that fails offline re-reads the note (onSettled), and that
    // re-read fails too: the editor (and its draft) must still be there.
    const html = renderEditing({ refetchFailed: NOTE })
    expect(html).toContain('data-league-note="editing"')
    expect(html).toMatch(/<textarea[^>]*aria-label="Commissioner note"[^>]*>Trade deadline is Nov 24.\nDues by Friday.<\/textarea>/)
    expect(html).not.toContain('role="alert"')
  })

  it('the editor open on a league with no note: an empty field and "Pin note"', () => {
    const html = renderEditing({ available: true, note: null })
    expect(html).toMatch(/<textarea[^>]*aria-label="Commissioner note"[^>]*><\/textarea>/)
    expect(html).toMatch(/data-league-note-save[^>]*>Pin note</)
  })

  it('a note whose author account is gone still shows, without a name', () => {
    const html = render({ available: true, note: { text: 'Dues by Friday', updated_at: null, author: null } }, false)
    expect(html).toContain('Dues by Friday')
    expect(html).not.toContain('Pinned by')
  })
})
