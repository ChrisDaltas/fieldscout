/**
 * GET /api/cron/reconcile — auth (L.D2.3 item 3).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createTypedAdminClient: () => {
    throw new Error('the admin client must never be built before the secret check')
  },
}))

import { GET, maxDuration } from './route'

describe('GET /api/cron/reconcile', () => {
  it('refuses without a secret and with the wrong one (401), before any client is built', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      expect((await GET(new Request('http://x/api/cron/reconcile'))).status).toBe(401)
      expect((await GET(new Request('http://x/api/cron/reconcile', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
      delete process.env.CRON_SECRET
      expect((await GET(new Request('http://x/api/cron/reconcile', { headers: { authorization: 'Bearer right' } }))).status).toBe(401)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('runs under the long fluid-compute timeout (a full season scan is one invocation)', () => {
    expect(maxDuration).toBe(300)
  })
})
