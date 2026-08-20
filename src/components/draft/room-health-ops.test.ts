import { describe, expect, it } from 'vitest'

import { FIRST_JOIN_FAILURES_FOR_BANNER } from '@/hooks/use-draft-ops'

import {
  FETCH_FAILURES_FOR_BANNER,
  absentDraftIsHonest,
  queryHealth,
  worstHealth,
} from './room-health-ops'

/**
 * room-health-ops pins — M3 task L.C3.1, **PROGRESS F56's room half**
 * (spec §16.5.4 required states; §16.3).
 *
 * F56's open question, verbatim: *"whether the room's draft-query error path
 * should fall back to the settings-scheduled branch at all (silent
 * regression vs an explicit error surface — the R263 banner exists for the
 * SUBSCRIBE path but not the fetch path)"*. The answer these pins encode:
 * **no** — an absent draft is only honest when the fetch that failed to
 * produce one is healthy.
 */

describe('the N-failure threshold mirrors the subscribe path, from the same constant', () => {
  it('is R263’s constant itself, not a second number that could drift', () => {
    expect(FETCH_FAILURES_FOR_BANNER).toBe(FIRST_JOIN_FAILURES_FOR_BANNER)
    // Recorded as a literal too: if R263 ever re-tunes the join threshold,
    // this line is the prompt to decide whether the fetch path agrees.
    expect(FETCH_FAILURES_FOR_BANNER).toBe(2)
  })
})

describe('queryHealth — the whole truth table', () => {
  it('WITH data: one failure is transient (ok); N is degraded; error is degraded', () => {
    expect(queryHealth({ failureCount: 0, isError: false, hasData: true })).toBe('ok')
    // The first failure heals invisibly on the retry more often than not —
    // flashing a banner there is the noise R263 declined to make.
    expect(queryHealth({ failureCount: 1, isError: false, hasData: true })).toBe('ok')
    expect(queryHealth({ failureCount: 2, isError: false, hasData: true })).toBe('degraded')
    expect(queryHealth({ failureCount: 9, isError: false, hasData: true })).toBe('degraded')
    // Retries exhausted with last-good data cached: keep the room, add the
    // banner (§16.5.4 "degraded — banner + last-good data, never wrong
    // numbers"). It must NOT become 'failed': a live draft room does not get
    // evicted by a refetch.
    expect(queryHealth({ failureCount: 4, isError: true, hasData: true })).toBe('degraded')
  })

  it('WITHOUT data: there is nothing to be optimistic about — failures are FAILED', () => {
    expect(queryHealth({ failureCount: 0, isError: false, hasData: false })).toBe('ok')
    expect(queryHealth({ failureCount: 1, isError: false, hasData: false })).toBe('ok')
    expect(queryHealth({ failureCount: 2, isError: false, hasData: false })).toBe('failed')
    expect(queryHealth({ failureCount: 0, isError: true, hasData: false })).toBe('failed')
  })
})

describe('worstHealth — the room is as honest as its least honest query', () => {
  it('failed dominates degraded dominates ok', () => {
    expect(worstHealth('ok', 'ok')).toBe('ok')
    expect(worstHealth('ok', 'degraded')).toBe('degraded')
    expect(worstHealth('degraded', 'failed')).toBe('failed')
    expect(worstHealth('failed', 'ok')).toBe('failed')
    expect(worstHealth()).toBe('ok')
  })
})

describe('absentDraftIsHonest — the single line F56’s room half turns on', () => {
  it('only a HEALTHY fetch has earned the right to say “there is no draft”', () => {
    expect(absentDraftIsHonest('ok')).toBe(true)
    expect(absentDraftIsHonest('degraded')).toBe(false)
    expect(absentDraftIsHonest('failed')).toBe(false)
  })

  it('the observed F56 shape, replayed as a model: a failing fetch may NOT render the lobby', () => {
    // F56, gate attempt 1: a LIVE manager room fell back to the
    // scheduled-lobby surface — "the settings-countdown branch renders when
    // the room's draft data is absent". Reconstruct that state: last-good
    // data cached, refetches failing past the threshold, no draft resolved.
    const health = worstHealth(
      queryHealth({ failureCount: 3, isError: true, hasData: true }),
      queryHealth({ failureCount: 3, isError: true, hasData: true }),
    )
    expect(health).toBe('degraded')
    expect(absentDraftIsHonest(health)).toBe(false)
  })
})
