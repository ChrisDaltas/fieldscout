import { describe, expect, it } from 'vitest'

import { nflSeason } from './nfl-season'

const at = (iso: string) => nflSeason(new Date(iso))

describe('nflSeason', () => {
  it('opens Week 1 the Tuesday after Labor Day', () => {
    // 2026: Labor Day is Mon Sep 7, so Week 1 opens Tue Sep 8 (Eastern).
    expect(at('2026-09-08T03:00:00Z')).toEqual({ phase: 'preseason', week: null }) // Mon 10pm ET
    expect(at('2026-09-08T06:00:00Z')).toEqual({ phase: 'regular', week: 1 })
    expect(at('2026-09-13T18:00:00Z')).toEqual({ phase: 'regular', week: 1 }) // first Sunday
    // 2027: Labor Day is Mon Sep 6.
    expect(at('2027-09-07T12:00:00Z')).toEqual({ phase: 'regular', week: 1 })
  })

  it('turns the week over on Tuesday', () => {
    expect(at('2026-11-09T22:00:00Z')).toEqual({ phase: 'regular', week: 9 }) // Monday night
    expect(at('2026-11-10T15:00:00Z')).toEqual({ phase: 'regular', week: 10 }) // Tuesday
  })

  it('runs 18 regular-season weeks, then the postseason', () => {
    expect(at('2027-01-10T18:00:00Z')).toEqual({ phase: 'regular', week: 18 })
    expect(at('2027-01-12T18:00:00Z')).toEqual({ phase: 'postseason', week: null })
    expect(at('2027-02-14T18:00:00Z')).toEqual({ phase: 'postseason', week: null })
  })

  it('is the offseason from late February to July, and preseason in August', () => {
    expect(at('2027-03-01T12:00:00Z')).toEqual({ phase: 'offseason', week: null })
    expect(at('2026-07-15T12:00:00Z')).toEqual({ phase: 'offseason', week: null })
    expect(at('2026-08-15T12:00:00Z')).toEqual({ phase: 'preseason', week: null })
  })
})
