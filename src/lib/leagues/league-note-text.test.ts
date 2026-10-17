import { describe, expect, it } from 'vitest'

import { LEAGUE_NOTE_MAX, noteDraft, noteLength, trimNote } from './league-note-text'

/** The client mirror of migration 192's note rules (pgTAP 139 pins the SQL). */
describe('league-note-text — 192’s rules on the client', () => {
  it('the cap is 500', () => {
    expect(LEAGUE_NOTE_MAX).toBe(500)
  })
  it('trims 192’s class (space, tab, CR, LF) at both ends and nothing inside', () => {
    expect(trimNote('\r\n\t  a \n b \t\r\n')).toBe('a \n b')
    expect(trimNote('')).toBe('')
  })
  it('counts code points, like char_length', () => {
    expect(noteLength('abc')).toBe(3)
    expect(noteLength('🏈')).toBe(1)
    expect(noteLength('é')).toBe(1)
  })
  it('a draft knows whether it clears and whether it fits', () => {
    expect(noteDraft('  ')).toEqual({ text: '', clears: true, length: 0, tooLong: false })
    expect(noteDraft('x'.repeat(500)).tooLong).toBe(false)
    expect(noteDraft(` ${'x'.repeat(500)} `).tooLong).toBe(false)
    expect(noteDraft('x'.repeat(501)).tooLong).toBe(true)
  })
})
