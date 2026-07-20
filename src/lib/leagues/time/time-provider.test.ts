import { afterEach, describe, expect, it, vi } from 'vitest'

import { systemTime } from './time-provider'

describe('systemTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // R18: fake timers make this falsifiable lint-clean — a frozen or offset
  // implementation fails, without the test itself reading the wall clock
  // (the D3 time-guard applies to tests too).
  it('tracks the system clock exactly', () => {
    vi.useFakeTimers()
    const t1 = new Date('2026-07-19T12:00:00.000Z')
    vi.setSystemTime(t1)
    expect(systemTime.now().toISOString()).toBe(t1.toISOString())

    vi.setSystemTime(new Date('2026-07-19T12:00:05.000Z'))
    expect(systemTime.now().getTime()).toBe(t1.getTime() + 5_000)
  })

  it('returns a fresh Date instance per call', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))
    const a = systemTime.now()
    const b = systemTime.now()
    expect(b).not.toBe(a) // a new object per call, not a shared mutable Date
    a.setFullYear(1999)
    expect(systemTime.now().getFullYear()).toBe(2026)
  })
})
