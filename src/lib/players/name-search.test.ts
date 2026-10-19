/**
 * The one player-name search rule (gap list §4 item 13 — the league Players
 * tab's search). Pinned here:
 *   1. The server filter: `full_name` holds the text, or `search_name` holds
 *      it with the spaces out — quoted, so a comma or bracket can't split it,
 *      and `%` / `_` match themselves.
 *   2. The client mirror agrees with it on rows already in hand.
 */
import { describe, expect, it } from 'vitest'

import { playerNameFilter, playerNameMatches } from './name-search'

describe('playerNameFilter (server-side)', () => {
  it('matches the full name anywhere, or the run-together name without spaces', () => {
    expect(playerNameFilter('aj brown')).toBe('full_name.ilike."%aj brown%",search_name.ilike."%ajbrown%"')
  })

  it('keeps the typed text one quoted value', () => {
    expect(playerNameFilter('Smith, J')).toBe('full_name.ilike."%Smith, J%",search_name.ilike."%Smith,J%"')
  })

  it('escapes LIKE wildcards, then the quotes’ own escapes', () => {
    expect(playerNameFilter('100%_')).toBe('full_name.ilike."%100\\\\%\\\\_%",search_name.ilike."%100\\\\%\\\\_%"')
    expect(playerNameFilter('a"b')).toBe('full_name.ilike."%a\\"b%",search_name.ilike."%a\\"b%"')
  })
})

describe('playerNameMatches (rows in hand)', () => {
  const aj = { full_name: 'A.J. Brown', search_name: 'ajbrown' }
  const amonRa = { full_name: 'Amon-Ra St. Brown', search_name: 'amonrastbrown' }
  const madeUp = { full_name: 'Marcus Delaney', search_name: null }

  it('an empty query matches everyone', () => {
    expect(playerNameMatches(aj, '')).toBe(true)
    expect(playerNameMatches(aj, '   ')).toBe(true)
  })

  it('the full name anywhere, any case', () => {
    expect(playerNameMatches(amonRa, 'st. brown')).toBe(true)
    expect(playerNameMatches(madeUp, 'DELANEY')).toBe(true)
    expect(playerNameMatches(madeUp, ' delaney ')).toBe(true)
    expect(playerNameMatches(madeUp, 'mahomes')).toBe(false)
  })

  it('the run-together name: "aj brown" finds A.J. Brown, "amon ra" finds Amon-Ra', () => {
    expect(playerNameMatches(aj, 'aj brown')).toBe(true)
    expect(playerNameMatches(amonRa, 'amon ra')).toBe(true)
    // No run-together name on record: the full name alone decides.
    expect(playerNameMatches(madeUp, 'marcusdelaney')).toBe(false)
  })

  it('a typed % or _ is literal, as on the server', () => {
    expect(playerNameMatches(aj, '%')).toBe(false)
    expect(playerNameMatches(aj, 'a_j')).toBe(false)
  })
})
