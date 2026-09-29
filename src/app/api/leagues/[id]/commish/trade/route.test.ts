/**
 * POST /api/leagues/[id]/commish/trade — the thin handler's own contract (M5
 * L.D3.6, F451): a malformed league id is a 404 and an unauthenticated caller
 * a 401 BEFORE the service; otherwise the body reaches `commishTrade` whole
 * with the injected client and the service's answer is the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const commishTrade = vi.fn()
vi.mock('@/lib/leagues/api/trades-service', () => ({ commishTrade: (...args: unknown[]) => commishTrade(...args) }))

import { POST } from './route'

const LEAGUE = 'b8b00000-0000-4000-8000-000000000001'
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/leagues/[id]/commish/trade', () => {
  it('404 before auth on a malformed league id; 401 before the service when unauthenticated', async () => {
    expect((await POST(post({}), params('nope'))).status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(post({}), params(LEAGUE))).status).toBe(401)
    expect(commishTrade).not.toHaveBeenCalled()
  })

  it('the body reaches the service whole; its status and body are the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    commishTrade.mockResolvedValueOnce({ status: 409, body: { error: 'refused by name' } })
    const body = { trade_id: 't', op: 'reverse', action_id: 'a' }
    const res = await POST(post(body), params(LEAGUE))
    expect([res.status, await res.json()]).toStrictEqual([409, { error: 'refused by name' }])
    const [client, leagueId, passed] = commishTrade.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect([leagueId, passed]).toStrictEqual([LEAGUE, body])
  })
})
