/**
 * The commissioner note's UI rules (gap list #13; migration 192) and its
 * line in the league's activity (the commissioner log's words).
 */
import { describe, expect, it } from 'vitest'

import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'
import { LEAGUE_NOTE_MAX, noteDraft, noteLength, trimNote } from '@/lib/leagues/league-note-text'

import { commishLogLines } from './activity-feed-ops'
import { actionWords } from './commish-log-copy'
import {
  LEAGUE_NOTE_EDITOR_HELP,
  LEAGUE_NOTE_EMPTY_COMMISH,
  canEditLeagueNote,
  noteByline,
  noteEditorState,
  noteSavedToast,
  noteWhen,
} from './league-note-ops'

describe('the note’s text rules (192’s, mirrored)', () => {
  it('trims only spaces, tabs and newlines — not other whitespace', () => {
    expect(trimNote(' \t\r\n Dues \n')).toBe('Dues')
    expect(trimNote(' Dues ')).toBe(' Dues ')
  })
  it('counts characters as Postgres does', () => {
    expect(noteLength('🏈🏈')).toBe(2)
    expect(noteDraft(' x '.repeat(1))).toEqual({ text: 'x', clears: false, length: 1, tooLong: false })
    expect(noteDraft('\n \t')).toEqual({ text: '', clears: true, length: 0, tooLong: false })
    expect(noteDraft('y'.repeat(LEAGUE_NOTE_MAX + 1)).tooLong).toBe(true)
  })
})

describe('who may change it', () => {
  it('the commissioner and co-commissioners, nobody else', () => {
    expect(canEditLeagueNote('commissioner')).toBe(true)
    expect(canEditLeagueNote('co_commissioner')).toBe(true)
    expect(canEditLeagueNote('manager')).toBe(false)
    expect(canEditLeagueNote(null)).toBe(false)
    expect(canEditLeagueNote(undefined)).toBe(false)
  })
})

describe('the byline', () => {
  // Local-time instants at midday, so no time zone moves them across a day.
  const now = new Date(2026, 9, 15, 12, 0, 0)
  it('today / yesterday / a date / a date with the year', () => {
    expect(noteWhen(new Date(2026, 9, 15, 9, 30).toISOString(), now)).toBe('today')
    expect(noteWhen(new Date(2026, 9, 14, 12, 0).toISOString(), now)).toBe('yesterday')
    expect(noteWhen(new Date(2026, 9, 2, 12, 0).toISOString(), now)).toBe('Oct 2')
    expect(noteWhen(new Date(2025, 11, 30, 12, 0).toISOString(), now)).toBe('Dec 30, 2025')
    expect(noteWhen(null, now)).toBeNull()
    expect(noteWhen('not a date', now)).toBeNull()
  })
  it('names the author when the account is there', () => {
    const at = new Date(2026, 9, 15, 9, 30).toISOString()
    expect(noteByline({ text: 'x', updated_at: at, author: { id: 'u1', username: 'chris_gm' } }, now)).toEqual({ username: 'chris_gm', when: 'today' })
    expect(noteByline({ text: 'x', updated_at: at, author: null }, now)).toEqual({ username: null, when: 'today' })
  })
})

describe('the editor', () => {
  it('a new note: "Pin note", offered once there is text', () => {
    expect(noteEditorState('', null)).toMatchObject({ canSave: false, saveLabel: 'Pin note', counter: `0 / ${LEAGUE_NOTE_MAX}` })
    expect(noteEditorState(' Dues by Friday ', null)).toMatchObject({ canSave: true, saveLabel: 'Pin note', counter: `14 / ${LEAGUE_NOTE_MAX}` })
  })
  it('an edit: "Save" for a real change; the same note (after trimming) offers nothing', () => {
    expect(noteEditorState('Dues by Friday', 'Dues by Friday')).toMatchObject({ canSave: false, unchanged: true })
    expect(noteEditorState('  Dues by Friday\n', 'Dues by Friday')).toMatchObject({ canSave: false, unchanged: true })
    expect(noteEditorState('Dues by Saturday', 'Dues by Friday')).toMatchObject({ canSave: true, saveLabel: 'Save' })
  })
  it('emptying a pinned note is "Clear note"; over the cap cannot be saved', () => {
    expect(noteEditorState('  ', 'Dues by Friday')).toMatchObject({ canSave: true, clears: true, saveLabel: 'Clear note' })
    expect(noteEditorState('z'.repeat(501), 'Dues by Friday')).toMatchObject({ canSave: false, tooLong: true, counter: '501 / 500' })
  })
})

describe('what the commissioner is told about notifications', () => {
  it('a pin or an edit notifies members; a clear does not — and no copy promises otherwise', () => {
    expect(LEAGUE_NOTE_EDITOR_HELP).toBe('Everyone in the league sees it. Members get a notification when you pin or edit it, not when you clear it.')
    expect(LEAGUE_NOTE_EMPTY_COMMISH).toContain('when you pin or edit it')
    for (const copy of [LEAGUE_NOTE_EDITOR_HELP, LEAGUE_NOTE_EMPTY_COMMISH]) expect(copy).not.toMatch(/when you change it/)
  })
})

describe('the toast after a save — from the server’s document', () => {
  it('pinned (with how many were told) or unchanged', () => {
    expect(noteSavedToast({ no_changes: false, cleared: false, notified: 3 })).toEqual({ title: 'Note pinned', description: '3 members were notified.' })
    expect(noteSavedToast({ no_changes: false, cleared: false, notified: 1 })).toEqual({ title: 'Note pinned', description: '1 member was notified.' })
    expect(noteSavedToast({ no_changes: false, cleared: false, notified: 0 })).toEqual({ title: 'Note pinned', description: undefined })
    expect(noteSavedToast({ no_changes: true, cleared: false, notified: 0 }).title).toBe('No changes')
  })
  it('cleared: no claim that anyone was told — a clear notifies nobody (Chris 2026-10-16)', () => {
    expect(noteSavedToast({ no_changes: false, cleared: true, notified: 0 })).toStrictEqual({ title: 'Note cleared' })
    // Even a document that somehow counted recipients never makes the toast say so.
    expect(noteSavedToast({ no_changes: false, cleared: true, notified: 3 })).toStrictEqual({ title: 'Note cleared' })
  })
})

describe('the note’s line in League activity (the commissioner log — Q66)', () => {
  const item = (before: unknown, after: unknown): CommishLogItem => ({
    id: 'ca',
    action_type: 'set_league_note',
    actor: { id: 'u1', username: 'chris_gm' },
    target_type: 'league',
    target_id: 'lg-1',
    reason: null,
    before: before as CommishLogItem['before'],
    after: after as CommishLogItem['after'],
    metadata: { verb: 'commish_set_league_note', season: 2026, cleared: false },
    acting_as_team_id: null,
    reverts_action_id: null,
    created_at: '2026-10-15T18:00:00.000Z',
  })
  const line = (i: CommishLogItem) => commishLogLines([i], new Map(), new Map())[0]

  it('reads in plain words — pinned, changed (quoting the note), cleared', () => {
    expect(line(item({ note: null }, { note: 'Trade deadline is Nov 24' })).text).toBe('pinned a commissioner note: “Trade deadline is Nov 24”')
    expect(line(item({ note: 'Trade deadline is Nov 24' }, { note: 'Dues by Friday.\nVenmo me' })).text).toBe(
      'changed the commissioner note: “Dues by Friday. Venmo me”',
    )
    expect(line(item({ note: 'Dues by Friday' }, { note: null })).text).toBe('cleared the commissioner note')
    expect(line(item({ note: 'Dues by Friday' }, { note: null })).actorUsername).toBe('chris_gm')
  })
  it('a long note is shortened in the line', () => {
    const text = line(item({ note: null }, { note: 'w'.repeat(200) })).text
    expect(text).toBe(`pinned a commissioner note: “${'w'.repeat(79)}…”`)
  })
  it('a receipt without the note keys falls back to the type’s words', () => {
    expect(actionWords('set_league_note')).toBe('changed the commissioner note')
    expect(line(item(null, null)).text).toBe('changed the commissioner note')
  })
})
