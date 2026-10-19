/**
 * GET /api/cron/ingest-player-news — auth before any client (F575).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('the admin client must never be built before the secret check')
  },
}))

import { GET } from './route'

describe('GET /api/cron/ingest-player-news', () => {
  it('refuses without a secret and with the wrong one (401)', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    try {
      expect((await GET(new Request('http://x/api/cron/ingest-player-news'))).status).toBe(401)
      expect((await GET(new Request('http://x/api/cron/ingest-player-news', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
      delete process.env.CRON_SECRET
      expect((await GET(new Request('http://x/api/cron/ingest-player-news', { headers: { authorization: 'Bearer right' } }))).status).toBe(401)
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })

  it('a right secret reaches the ingest — a failure there is a 500, never a 200', async () => {
    const prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await GET(new Request('http://x/api/cron/ingest-player-news', { headers: { authorization: 'Bearer right' } }))
      expect(res.status).toBe(500)
    } finally {
      err.mockRestore()
      if (prior === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prior
    }
  })
})
