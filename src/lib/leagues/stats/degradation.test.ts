import { describe, expect, it } from 'vitest'

import { DegradationTracker } from './degradation'

describe('DegradationTracker (§23.2)', () => {
  it('starts healthy', () => {
    expect(new DegradationTracker().degraded).toBe(false)
  })

  it('stays healthy through two consecutive failures', () => {
    const tracker = new DegradationTracker()
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    expect(tracker.degraded).toBe(false)
  })

  it('degrades on the third consecutive failure and stays degraded while failures continue', () => {
    const tracker = new DegradationTracker()
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    expect(tracker.degraded).toBe(true)
    tracker.recordPollResult(false)
    expect(tracker.degraded).toBe(true)
  })

  it('clears on the first successful poll', () => {
    const tracker = new DegradationTracker()
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    tracker.recordPollResult(true)
    expect(tracker.degraded).toBe(false)
  })

  it('requires the failures to be consecutive — a success resets the count', () => {
    const tracker = new DegradationTracker()
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    tracker.recordPollResult(true)
    tracker.recordPollResult(false)
    tracker.recordPollResult(false)
    expect(tracker.degraded).toBe(false)
    tracker.recordPollResult(false)
    expect(tracker.degraded).toBe(true)
  })
})
