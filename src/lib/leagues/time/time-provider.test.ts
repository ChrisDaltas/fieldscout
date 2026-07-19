import { describe, expect, it } from 'vitest'

import { systemTime } from './time-provider'

describe('systemTime', () => {
  // No wall-clock comparisons here — the D3 time-guard applies to tests too,
  // so we assert shape and monotonicity, not agreement with Date.now().
  it('returns fresh, non-decreasing Date instances', () => {
    const a = systemTime.now()
    const b = systemTime.now()

    expect(a).toBeInstanceOf(Date)
    expect(Number.isFinite(a.getTime())).toBe(true)
    expect(b.getTime()).toBeGreaterThanOrEqual(a.getTime())
    expect(b).not.toBe(a) // a new object per call, not a shared mutable Date
  })
})
