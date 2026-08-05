/**
 * Pure-logic pins for the AI generation daily quota (migration 074).
 *
 * The DB-backed claim/release path is exercised end-to-end through the route
 * in src/app/api/lists/generate/route.test.ts; this suite owns the parts that
 * need no database: the UTC reset boundary, the reset copy, and the
 * env-configurable limit.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT,
  aiListGenerationDailyLimit,
} from './limits'
import { formatResetDistance, nextUtcReset, rateLimitMessage } from './quota'

const ENV_KEY = 'AI_LIST_GENERATION_DAILY_LIMIT'

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('daily limit is env-configurable, defaulting to 3', () => {
  it('defaults to 3 when unset — Chris ruled 3/user/day (2026-08-05)', () => {
    expect(AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT).toBe(3) // GOLDEN PIN
    expect(aiListGenerationDailyLimit()).toBe(3)
  })

  it('reads the env var so the cap is tunable without a code change', () => {
    process.env[ENV_KEY] = '10'
    expect(aiListGenerationDailyLimit()).toBe(10)
  })

  it('is re-read per call, so an env change takes effect without a reload', () => {
    process.env[ENV_KEY] = '5'
    expect(aiListGenerationDailyLimit()).toBe(5)
    process.env[ENV_KEY] = '7'
    expect(aiListGenerationDailyLimit()).toBe(7)
  })

  it('honours 0 as "AI generation off" rather than treating it as unset', () => {
    process.env[ENV_KEY] = '0'
    expect(aiListGenerationDailyLimit()).toBe(0)
  })

  it('falls back to the default on garbage rather than failing open', () => {
    for (const bad of ['', '   ', 'lots', '-1', '3.7.1']) {
      process.env[ENV_KEY] = bad
      expect(aiListGenerationDailyLimit()).toBe(3)
    }
  })
})

describe('reset boundary is the next UTC day', () => {
  it('rolls to 00:00:00.000Z of the following UTC day', () => {
    expect(nextUtcReset(new Date('2026-08-05T13:22:31.500Z')).toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    )
  })

  it('a timestamp just before midnight UTC resets minutes later, not a day later', () => {
    expect(nextUtcReset(new Date('2026-08-05T23:59:00.000Z')).toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    )
  })

  it('is UTC-anchored, not local-midnight — the same instant maps to one boundary', () => {
    // 2026-08-05T23:30Z is already 2026-08-06 in Sydney and still 2026-08-05
    // in Los Angeles; the reset is the same instant for both.
    const reset = nextUtcReset(new Date('2026-08-05T23:30:00.000Z'))
    expect(reset.getTime()).toBe(Date.parse('2026-08-06T00:00:00.000Z'))
  })

  it('crosses month and year ends', () => {
    expect(nextUtcReset(new Date('2026-08-31T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(nextUtcReset(new Date('2026-12-31T10:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })
})

describe('formatResetDistance', () => {
  it('reports hours when the day has a way to run', () => {
    expect(formatResetDistance(new Date('2026-08-05T19:00:00.000Z'))).toBe(
      'in about 5 hours',
    )
  })

  it('says "an hour" rather than "1 hours"', () => {
    expect(formatResetDistance(new Date('2026-08-05T23:00:00.000Z'))).toBe(
      'in about an hour',
    )
  })

  it('drops to minutes inside the last hour', () => {
    expect(formatResetDistance(new Date('2026-08-05T23:40:00.000Z'))).toBe(
      'in about 20 minutes',
    )
  })

  it('degrades gracefully on the boundary itself', () => {
    expect(formatResetDistance(new Date('2026-08-05T23:59:40.000Z'))).toBe(
      'in under a minute',
    )
  })
})

describe('rate-limit copy', () => {
  const now = new Date('2026-08-05T19:00:00.000Z')

  it('names the limit, the UTC boundary, and how long until it resets', () => {
    const message = rateLimitMessage(3, now)
    expect(message).toContain('all 3 AI generations')
    expect(message).toContain('midnight UTC')
    expect(message).toContain('in about 5 hours')
  })

  it('says UTC explicitly — never a bare "midnight"/"tomorrow" that implies local time', () => {
    const message = rateLimitMessage(3, now)
    expect(message).toMatch(/midnight UTC/)
    // A bare "midnight" not followed by UTC would read as the user's own clock.
    expect(message).not.toMatch(/midnight(?! UTC)/)
    expect(message).not.toMatch(/\btomorrow\b/i)
  })

  it('is cost-control framing, never an upsell', () => {
    const message = rateLimitMessage(3, now)
    for (const word of ['Pro', 'upgrade', 'Upgrade', 'premium', 'subscribe']) {
      expect(message).not.toContain(word)
    }
  })

  it('handles a limit of 1 without saying "1 generations"', () => {
    expect(rateLimitMessage(1, now)).toContain('all 1 AI generation for today')
  })

  it('has a distinct message when generation is switched off entirely', () => {
    expect(rateLimitMessage(0, now)).toContain('switched off')
  })
})
