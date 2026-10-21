/**
 * GET /api/cron/sync-players — the daily full player sync (PROGRESS D592):
 * auth before any client, a thrown sync is a 500, and an EMPTY feed (zero
 * players mapped) is a 500 too — never a quiet 200. ZERO external calls: the
 * admin client and the sync are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  adminBuilt: 0,
  sync: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    h.adminBuilt++
    return { admin: true }
  },
}))

vi.mock('@/lib/sync/players', () => ({
  syncPlayers: h.sync,
}))

import { GET } from './route'

const URL_ = 'http://x/api/cron/sync-players'
const authed = () => new Request(URL_, { headers: { authorization: 'Bearer right' } })

describe('GET /api/cron/sync-players', () => {
  let prior: string | undefined
  beforeEach(() => {
    prior = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'right'
    h.adminBuilt = 0
    h.sync.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (prior === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prior
  })

  it('refuses without a secret and with the wrong one (401), before any client is built or any sync runs', async () => {
    expect((await GET(new Request(URL_))).status).toBe(401)
    expect((await GET(new Request(URL_, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(authed())).status).toBe(401)
    expect(h.adminBuilt).toBe(0)
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('a right secret runs the full player sync with the admin client — 200 with its summary', async () => {
    const summary = { name: 'players', counts: { mapped: 1843, upserted: 1843 }, warnings: [] }
    h.sync.mockResolvedValue(summary)
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(summary)
    expect(h.sync).toHaveBeenCalledTimes(1)
    expect(h.sync).toHaveBeenCalledWith({ admin: true })
  })

  it('an EMPTY feed (zero players mapped) is a 500, named — never a quiet 200', async () => {
    h.sync.mockResolvedValue({ name: 'players', counts: { mapped: 0, upserted: 0 }, warnings: [] })
    const res = await GET(authed())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      name: 'players',
      counts: { mapped: 0, upserted: 0 },
      warnings: [],
      error: 'the Sleeper player feed mapped 0 players — nothing written; read as a failed fetch, not a quiet day',
    })
  })

  it('a sync that throws (Sleeper down, a failed upsert) is a 500 with the message', async () => {
    h.sync.mockRejectedValue(new Error('Sleeper API error: 503 Service Unavailable'))
    const res = await GET(authed())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sleeper API error: 503 Service Unavailable' })
  })
})
