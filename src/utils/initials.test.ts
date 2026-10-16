import { describe, expect, it } from 'vitest'

import { computeInitials, handleInitials } from './initials'

describe('computeInitials — the app-wide person avatar rule (gap list #8)', () => {
  it('takes the first two characters of a single-token handle, uppercased', () => {
    expect(computeInitials('chrisdaltas')).toBe('CH')
    expect(computeInitials('  nina ')).toBe('NI')
    expect(computeInitials('x')).toBe('X')
  })

  it('takes one letter from each of the first two words (persona names)', () => {
    expect(computeInitials('FieldScout AI')).toBe('FA')
    expect(computeInitials('The Late Round QB')).toBe('TL')
  })

  it('falls back to "?" when there is nothing to draw', () => {
    expect(computeInitials(null)).toBe('?')
    expect(computeInitials(undefined)).toBe('?')
    expect(computeInitials('   ')).toBe('?')
  })
})

describe('handleInitials', () => {
  it('never makes the "@" one of the two letters', () => {
    expect(handleInitials('@marcus')).toBe('MA')
    expect(handleInitials(' @priya')).toBe('PR')
    expect(handleInitials('marcus')).toBe('MA')
  })

  it('a bare "@" or nothing is "?"', () => {
    expect(handleInitials('@')).toBe('?')
    expect(handleInitials(null)).toBe('?')
  })
})
