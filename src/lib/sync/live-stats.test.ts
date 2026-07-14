import { describe, expect, it } from 'vitest'

import { weeksToFinalize } from './live-stats'

describe('weeksToFinalize', () => {
  it('finalizes older weeks still flagged live', () => {
    expect(weeksToFinalize([3, 4], 5, false)).toEqual([3, 4])
    expect(weeksToFinalize([3, 4], 5, true)).toEqual([3, 4])
  })

  it('finalizes the current week only once its window closes', () => {
    expect(weeksToFinalize([5], 5, true)).toEqual([])
    expect(weeksToFinalize([5], 5, false)).toEqual([5])
  })

  it('never touches future weeks and handles the clean state', () => {
    expect(weeksToFinalize([6], 5, false)).toEqual([])
    expect(weeksToFinalize([], 5, false)).toEqual([])
  })
})
