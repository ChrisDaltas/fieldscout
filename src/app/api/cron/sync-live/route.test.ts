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

  it('the invocation budget sits below maxDuration (the last round starts at budget − cadence = 25 s at the latest); the cadence is §23.2’s 20–30 s', () => {
    expect(LIVE_POLL_BUDGET_MS).toBeLessThan(maxDuration * 1000)
    expect(LIVE_POLL_BUDGET_MS - POLL_CADENCE_MS).toBeLessThanOrEqual(25_000)
    expect(POLL_CADENCE_MS).toBeGreaterThanOrEqual(20_000)
    expect(POLL_CADENCE_MS).toBeLessThanOrEqual(30_000)
    expect(maxDuration).toBe(60)
  })
})
