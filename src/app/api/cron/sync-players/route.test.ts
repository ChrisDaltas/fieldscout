/**
 * GET /api/cron/sync-players — the daily full player sync (PROGRESS D592):
 * auth before any client, a thrown sync is a 500, and an EMPTY feed (zero
 * players mapped) is a 500 too — never a quiet 200. F693 (D593, migration
 * 205): right after the sync, the healthy-IR claim cancel runs with the same
 * client; its report rides the body, and its failure is a 500. ZERO external
 * calls: the admin client, the sync and the cancel are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  adminBuilt: 0,
  sync: vi.fn(),
  cancel: vi.fn(),
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

vi.mock('@/lib/leagues/waivers/healthy-ir-cancel', () => ({
  cancelHealthyIrClaims: h.cancel,
}))

const CANCEL_OK = { ok: true, deployed: true, paused: false, leaguesChecked: 2, cancelled: 1, notified: 1, leagues: [{ league_id: 'lg-1', teams: 1, cancelled: 1, notified: 1 }], skipped: [], why: null, warnings: [], failures: [] }

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
    h.cancel.mockReset()
    h.cancel.mockResolvedValue(CANCEL_OK)
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
    expect(h.cancel).not.toHaveBeenCalled()
  })

  it('a right secret runs the full player sync with the admin client, then the healthy-IR cancel with the same client — 200 with both reports', async () => {
    const summary = { name: 'players', counts: { mapped: 1843, upserted: 1843 }, warnings: [] }
    h.sync.mockResolvedValue(summary)
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...summary, healthyIr: CANCEL_OK })
    expect(h.sync).toHaveBeenCalledTimes(1)
    expect(h.sync).toHaveBeenCalledWith({ admin: true })
    expect(h.cancel).toHaveBeenCalledTimes(1)
    expect(h.cancel.mock.calls[0][0]).toEqual({ admin: true })
    expect(h.sync.mock.invocationCallOrder[0]).toBeLessThan(h.cancel.mock.invocationCallOrder[0])
  })

  it('F693: a cancel that failed is a 500 naming it — the sync summary still in the body', async () => {
    const summary = { name: 'players', counts: { mapped: 1843, upserted: 1843 }, warnings: [] }
    h.sync.mockResolvedValue(summary)
    const failed = { ...CANCEL_OK, ok: false, cancelled: 0, notified: 0, leagues: [], failures: ['healthy-IR claim cancel: waiver_claims_cancel_healthy_ir failed — boom'] }
    h.cancel.mockResolvedValue(failed)
    const res = await GET(authed())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ...summary, healthyIr: failed, error: 'healthy-IR claim cancel: waiver_claims_cancel_healthy_ir failed — boom' })
  })

  it('F693: the door not pushed yet is a named warning — still a 200 (deploy before push)', async () => {
    const summary = { name: 'players', counts: { mapped: 1843, upserted: 1843 }, warnings: [] }
    h.sync.mockResolvedValue(summary)
    const notYet = { ...CANCEL_OK, deployed: false, leaguesChecked: 0, cancelled: 0, notified: 0, leagues: [], warnings: ['not pushed'] }
    h.cancel.mockResolvedValue(notYet)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect((await res.json()).healthyIr).toEqual(notYet)
    expect(warn).toHaveBeenCalledWith('[sync-players]', 'not pushed')
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
    expect(h.cancel).not.toHaveBeenCalled()
  })

  it('a sync that throws (Sleeper down, a failed upsert) is a 500 with the message', async () => {
    h.sync.mockRejectedValue(new Error('Sleeper API error: 503 Service Unavailable'))
    const res = await GET(authed())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sleeper API error: 503 Service Unavailable' })
  })
})
