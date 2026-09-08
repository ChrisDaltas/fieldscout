/**
 * GET /api/cron/sync-live — auth and the budget pin (L.D2.3, F216).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createTypedAdminClient: () => {
    throw new Error('the admin client must never be built before the secret check')
  },
}))

import { LIVE_POLL_BUDGET_MS, POLL_CADENCE_MS } from '@/lib/sync/live-poll'

import { GET, maxDuration } from './route'

describe('GET /api/cron/sync-live', () => {
  it('refuses without a secret and with the wrong one (401), before any client is built', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      expect((await GET(new Request('http://x/api/cron/sync-live'))).status).toBe(401)
      expect((await GET(new Request('http://x/api/cron/sync-live', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
      delete process.env.CRON_SECRET
      expect((await GET(new Request('http://x/api/cron/sync-live', { headers: { authorization: 'Bearer right' } }))).status).toBe(401)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('a round starts strictly inside the budget (< 45 s), so the last round has at least maxDuration − budget = 15 s before the platform cuts it (R879); the cadence is §23.2’s 20–30 s', () => {
    // live-poll.ts breaks when `elapsed + cadence >= budget` AFTER a round, so a
    // round may START at any instant below the budget (a 24 s first poll ⇒ the
    // second round starts at 44 s) — what bounds the last round is maxDuration.
    expect(LIVE_POLL_BUDGET_MS).toBeLessThan(maxDuration * 1000)
    expect(maxDuration * 1000 - LIVE_POLL_BUDGET_MS).toBeGreaterThanOrEqual(15_000)
    expect(POLL_CADENCE_MS).toBeGreaterThanOrEqual(20_000)
    expect(POLL_CADENCE_MS).toBeLessThanOrEqual(30_000)
    expect(maxDuration).toBe(60)
  })
})
