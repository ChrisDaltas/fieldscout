/**
 * The comment limit's pure side (migration 213 — 5 comments a minute per
 * person): recognising the trigger's refusal, the route's 429, and the
 * comment box's countdown.
 */
import { describe, expect, it } from 'vitest'

import {
  COMMENT_LIMIT,
  COMMENT_WINDOW_MS,
  commentRateLimitedParts,
  commentRefusalCopy,
  commentWaitCopy,
  commentWaitMs,
  parseCommentRateLimit,
  waitSeconds,
} from './comment-limit'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('the numbers mirror 213', () => {
  it('5 per 60 000 ms', () => {
    expect(COMMENT_LIMIT).toBe(5)
    expect(COMMENT_WINDOW_MS).toBe(60_000)
  })
})

describe('parseCommentRateLimit — the trigger’s refusal on a supabase-js error', () => {
  it('reads the wait from details and keeps the server’s words', () => {
    expect(
      parseCommentRateLimit({
        code: 'rate_limited',
        message: "You're commenting too fast — you can comment again in 20 seconds.",
        details: 'retry_after_seconds=20',
      }),
    ).toEqual({ retryAfterSeconds: 20, message: "You're commenting too fast — you can comment again in 20 seconds." })
  })

  it('any other error is not a rate limit', () => {
    expect(parseCommentRateLimit(null)).toBeNull()
    expect(parseCommentRateLimit({ code: '42501', message: 'new row violates row-level security policy' })).toBeNull()
    expect(parseCommentRateLimit({ code: 'PGRST', message: 'x' })).toBeNull()
  })

  it('a refusal with no readable wait still holds for the whole window, in plain words', () => {
    expect(parseCommentRateLimit({ code: 'rate_limited', message: '', details: null })).toEqual({
      retryAfterSeconds: 60,
      message: commentRefusalCopy(60),
    })
  })

  it('the route’s 429 body and Retry-After', () => {
    expect(commentRateLimitedParts({ retryAfterSeconds: 7, message: 'Wait.' })).toEqual({
      body: { error: 'Wait.', code: 'RATE_LIMITED', bucket: 'comment', retry_after_seconds: 7 },
      retryAfter: '7',
    })
  })

  it('plain words, singular and plural', () => {
    expect(commentRefusalCopy(1)).toBe("You're commenting too fast — you can comment again in 1 second.")
    expect(commentRefusalCopy(20)).toBe("You're commenting too fast — you can comment again in 20 seconds.")
  })
})

describe('commentWaitMs — the comment box’s countdown', () => {
  it('fewer than five comments in the last minute: no wait', () => {
    expect(commentWaitMs([], NOW)).toBe(0)
    expect(commentWaitMs([ago(1000), ago(2000), ago(3000), ago(4000)], NOW)).toBe(0)
  })

  it('five in the last minute: wait until the oldest is a minute old', () => {
    const five = [ago(40_000), ago(30_000), ago(20_000), ago(10_000), ago(1_000)]
    expect(commentWaitMs(five, NOW)).toBe(20_000)
    expect(waitSeconds(commentWaitMs(five, NOW))).toBe(20)
    expect(commentWaitCopy(20)).toBe('You can comment again in 20s')
  })

  it('order does not matter', () => {
    expect(commentWaitMs([ago(1_000), ago(40_000), ago(10_000), ago(30_000), ago(20_000)], NOW)).toBe(20_000)
  })

  it('a comment a minute old or more no longer counts (a hit at t counts for [t, t + 60 s))', () => {
    expect(commentWaitMs([ago(60_000), ago(30_000), ago(20_000), ago(10_000), ago(1_000)], NOW)).toBe(0)
    expect(commentWaitMs([ago(59_999), ago(30_000), ago(20_000), ago(10_000), ago(1_000)], NOW)).toBe(1)
  })

  it('more than five live (posted before the limit existed): wait until only four remain', () => {
    const seven = [ago(50_000), ago(45_000), ago(40_000), ago(30_000), ago(20_000), ago(10_000), ago(1_000)]
    // The 3rd oldest (40 s ago) must leave: 20 s.
    expect(commentWaitMs(seven, NOW)).toBe(20_000)
  })

  it('the server’s wait wins when it is later (it also counts comments since removed)', () => {
    expect(commentWaitMs([], NOW, NOW + 12_000)).toBe(12_000)
    const five = [ago(40_000), ago(30_000), ago(20_000), ago(10_000), ago(1_000)]
    expect(commentWaitMs(five, NOW, NOW + 5_000)).toBe(20_000)
    expect(commentWaitMs(five, NOW, NOW + 45_000)).toBe(45_000)
    expect(commentWaitMs([], NOW, NOW - 1)).toBe(0)
  })

  it('never more than a minute from the box’s own count (a skewed clock), and junk is ignored', () => {
    const future = [ago(-5_000), ago(-5_000), ago(-5_000), ago(-5_000), ago(-5_000)]
    expect(commentWaitMs(future, NOW)).toBe(60_000)
    expect(commentWaitMs(['not a date', '', ago(1_000)], NOW)).toBe(0)
  })

  it('a sub-second wait reads as 1s; no wait reads as 0', () => {
    expect(waitSeconds(200)).toBe(1)
    expect(waitSeconds(0)).toBe(0)
    expect(waitSeconds(-5)).toBe(0)
  })
})
