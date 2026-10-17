import { describe, expect, it } from 'vitest'

import { activeWeekOf, isWeekLocked, lastRankableWeek, opensInWeek } from './week-window'

describe('rankable weeks — this week + 3, phone and desktop alike', () => {
  it('opens this week and the next three', () => {
    expect(lastRankableWeek(6)).toBe(9)
    expect(isWeekLocked(6, 6)).toBe(false)
    expect(isWeekLocked(9, 6)).toBe(false)
    expect(isWeekLocked(10, 6)).toBe(true)
  })
  it('caps at Week 18 and treats the offseason as Week 1', () => {
    expect(lastRankableWeek(17)).toBe(18)
    expect(activeWeekOf(0)).toBe(1)
    expect(lastRankableWeek(0)).toBe(4)
    expect(isWeekLocked(5, 0)).toBe(true)
  })
  it('says when a locked week opens', () => {
    expect(opensInWeek(10)).toBe(7)
    expect(opensInWeek(2)).toBe(1)
  })
})
