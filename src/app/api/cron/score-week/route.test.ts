/**
 * GET /api/cron/score-week — the invoker's auth and the lease precondition.
 *
 * Pinned here (tasks-M4 §6 L.D2.3 item 3 + F263(f)/R874):
 *   1. No secret / a wrong secret ⇒ 401 before any client is built.
 *   2. `SCORE_WEEK_LEASE_SECONDS ≥ maxDuration + CLOCK_SKEW_SECONDS` — the
 *      route's OWN `maxDuration` export is the operand (a route module may
 *      export only Next's fields, so the inequality lives here, beside it).
 *   3. The invocation budget sits below `maxDuration`.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createTypedAdminClient: () => {
    throw new Error('the admin client must never be built before the secret check')
  },
}))

import {
  CLOCK_SKEW_SECONDS,
  SCORE_WEEK_BUDGET_MS,
  SCORE_WEEK_LEASE_SECONDS,
  SCORE_WEEK_MAX_DURATION_SECONDS,
} from '@/lib/leagues/scoring/score-week-invoker'

import { GET, maxDuration } from './route'

describe('GET /api/cron/score-week', () => {
  it('refuses without a secret and with the wrong one (401), before any client is built', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      expect((await GET(new Request('http://x/api/cron/score-week'))).status).toBe(401)
      expect((await GET(new Request('http://x/api/cron/score-week', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
      delete process.env.CRON_SECRET
      expect((await GET(new Request('http://x/api/cron/score-week', { headers: { authorization: 'Bearer right' } }))).status).toBe(401)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('the lease outlives the invoker: leaseSeconds ≥ maxDuration + clock skew (F263(f)/R874); the budget sits below maxDuration', () => {
    expect(SCORE_WEEK_LEASE_SECONDS).toBeGreaterThanOrEqual(maxDuration + CLOCK_SKEW_SECONDS)
    expect(SCORE_WEEK_BUDGET_MS).toBeLessThan(maxDuration * 1000)
    // R885: the route's export must be a literal (Next.js segment config), so the pin ties the
    // literal to the invoker's constant — the two cannot drift apart silently.
    expect(maxDuration).toBe(SCORE_WEEK_MAX_DURATION_SECONDS)
    expect(maxDuration).toBe(60)
  })
})
