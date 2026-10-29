/**
 * The shared reader of a database rate-limit refusal (213's comment guard,
 * 214's report_content): code 'rate_limited', the wait in `details`.
 */
import { describe, expect, it } from 'vitest'

import { parseRateLimitRefusal } from './rate-limit-refusal'

describe('parseRateLimitRefusal', () => {
  it('reads the wait and keeps the server’s words (214’s answer, measured on the local stack)', () => {
    expect(
      parseRateLimitRefusal(
        {
          code: 'rate_limited',
          details: 'retry_after_seconds=3600',
          message: "You've sent a lot of reports — you can report again in 60 minutes.",
        },
        3600,
      ),
    ).toEqual({
      retryAfterSeconds: 3600,
      serverMessage: "You've sent a lot of reports — you can report again in 60 minutes.",
    })
  })

  it('an unreadable wait holds for the whole window — never "retry now"', () => {
    expect(parseRateLimitRefusal({ code: 'rate_limited', details: null, message: '  ' }, 3600)).toEqual({
      retryAfterSeconds: 3600,
      serverMessage: null,
    })
    expect(parseRateLimitRefusal({ code: 'rate_limited', details: 'retry_after_seconds=0' }, 60)).toEqual({
      retryAfterSeconds: 60,
      serverMessage: null,
    })
  })

  it('any other error is not a refusal', () => {
    expect(parseRateLimitRefusal(null, 60)).toBeNull()
    expect(parseRateLimitRefusal(undefined, 60)).toBeNull()
    expect(parseRateLimitRefusal({ code: 'PGRST', message: 'x' }, 60)).toBeNull()
    expect(parseRateLimitRefusal({ code: '42501', message: 'nope', details: 'retry_after_seconds=5' }, 60)).toBeNull()
  })
})
