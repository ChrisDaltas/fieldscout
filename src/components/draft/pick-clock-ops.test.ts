/**
 * Pick-clock golden pins (M2 task L.B3.1; spec §9.3 countdown rule). Stored
 * literals + boundary instants per the falsifiability floor (tasks-M1 §4.3).
 */

import { describe, expect, it } from 'vitest'

import { formatClockMs, isLowTime, pickClockView } from './pick-clock-ops'

const DEADLINE = '2026-08-13T00:01:00.000Z'
const DEADLINE_MS = Date.parse(DEADLINE)

const live = (over: Partial<Parameters<typeof pickClockView>[0]> = {}) => ({
  status: 'live',
  current_deadline: DEADLINE,
  deadline_remaining_ms: null,
  ...over,
})

describe('pickClockView', () => {
  it('running: 30s before the deadline, zero offset (stored literal)', () => {
    const view = pickClockView(live(), DEADLINE_MS - 30_000, 0)
    expect(view).toEqual({ mode: 'running', remainingMs: 30_000 })
  })

  it('boundary: 1ms before the deadline still runs; AT the deadline holds 0:00', () => {
    expect(pickClockView(live(), DEADLINE_MS - 1, 0)).toEqual({
      mode: 'running',
      remainingMs: 1,
    })
    expect(pickClockView(live(), DEADLINE_MS, 0)).toEqual({ mode: 'expired', remainingMs: 0 })
  })

  it('past the deadline clamps to 0 — the SERVER resolves expiry, never this client', () => {
    expect(pickClockView(live(), DEADLINE_MS + 4_000, 0)).toEqual({
      mode: 'expired',
      remainingMs: 0,
    })
  })

  it('the heartbeat offset corrects a skewed client clock (both directions)', () => {
    // Client 10s BEHIND the server (offset +10s): raw remaining would read
    // 40s; corrected reads 30s.
    expect(pickClockView(live(), DEADLINE_MS - 40_000, 10_000).remainingMs).toBe(30_000)
    // Client 10s AHEAD (offset −10s): raw 20s; corrected 30s.
    expect(pickClockView(live(), DEADLINE_MS - 20_000, -10_000).remainingMs).toBe(30_000)
  })

  it('paused: shows the frozen deadline_remaining_ms, never a countdown', () => {
    const view = pickClockView(
      { status: 'paused', current_deadline: null, deadline_remaining_ms: 42_500 },
      DEADLINE_MS,
      0,
    )
    expect(view).toEqual({ mode: 'paused', remainingMs: 42_500 })
  })

  it('untimed: a live draft with a NULL deadline has no clock (§8.2 soft timer)', () => {
    expect(pickClockView(live({ current_deadline: null }), DEADLINE_MS, 0)).toEqual({
      mode: 'untimed',
      remainingMs: null,
    })
  })

  it('idle: scheduled and complete drafts show no clock', () => {
    expect(pickClockView(live({ status: 'scheduled' }), 0, 0).mode).toBe('idle')
    expect(pickClockView(live({ status: 'complete' }), 0, 0).mode).toBe('idle')
  })
})

describe('formatClockMs', () => {
  it('golden literals (ceiled seconds — 1ms away still reads 0:01)', () => {
    expect(formatClockMs(0)).toBe('0:00')
    expect(formatClockMs(1)).toBe('0:01')
    expect(formatClockMs(999)).toBe('0:01')
    expect(formatClockMs(48_000)).toBe('0:48')
    expect(formatClockMs(75_000)).toBe('1:15')
    expect(formatClockMs(600_000)).toBe('10:00')
  })
})

describe('isLowTime', () => {
  it('urgent at ≤ 10s while running; never while paused', () => {
    expect(isLowTime({ mode: 'running', remainingMs: 10_000 })).toBe(true)
    expect(isLowTime({ mode: 'running', remainingMs: 10_001 })).toBe(false)
    expect(isLowTime({ mode: 'paused', remainingMs: 3_000 })).toBe(false)
  })
})
