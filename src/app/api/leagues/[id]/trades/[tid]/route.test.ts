/**
 * PATCH /api/leagues/[id]/trades/[tid] — the thin handler's own contract (M5
 * L.D3.6): a malformed league or trade id is a 404 and an unauthenticated
 * caller a 401 BEFORE the service; otherwise the body reaches `actOnTrade`
 * whole with the injected client and the trade id, and the service's answer
 * is the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const actOnTrade = vi.fn()
vi.mock('@/lib/leagues/api/trades-service', () => ({ actOnTrade: (...args: unknown[]) => actOnTrade(...args) }))

import { PATCH } from './route'

const LEAGUE = 'b8a00000-0000-4000-8000-000000000001'
const TRADE = 'b8a00000-0000-4000-8000-0000000000f1'
const params = (id: string, tid: string) => ({ params: Promise.resolve({ id, tid }) })
const patch = (body: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/leagues/[id]/trades/[tid]', () => {
  it('404 on a malformed league or trade id before auth; 401 before the service when unauthenticated', async () => {
    expect((await PATCH(patch({}), params('nope', TRADE))).status).toBe(404)
    const badTrade = await PATCH(patch({}), params(LEAGUE, 'nope'))
    expect([badTrade.status, await badTrade.json()]).toStrictEqual([404, { error: 'Trade not found' }])
    expect(getUser).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await PATCH(patch({}), params(LEAGUE, TRADE))).status).toBe(401)
    expect(actOnTrade).not.toHaveBeenCalled()
  })

  it('the body reaches the service whole with the trade id; its status and body are the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    actOnTrade.mockResolvedValueOnce({ status: 403, body: { error: 'no-leak copy' } })
    const body = { op: 'vote', vote: 'veto', action_id: 'a' }
    const res = await PATCH(patch(body), params(LEAGUE, TRADE))
    expect([res.status, await res.json()]).toStrictEqual([403, { error: 'no-leak copy' }])
    const [client, leagueId, tradeId, passed] = actOnTrade.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect([leagueId, tradeId, passed]).toStrictEqual([LEAGUE, TRADE, body])
  })
})
