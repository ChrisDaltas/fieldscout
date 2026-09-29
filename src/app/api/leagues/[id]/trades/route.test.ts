/**
 * POST|GET /api/leagues/[id]/trades — the thin handlers' own contract (M5
 * L.D3.6): a malformed league id is a 404 and an unauthenticated caller a 401
 * BEFORE the service; otherwise the body / query reaches the service whole
 * with the injected client (GET: the caller's id and the TimeProvider's now),
 * and the service's answer is the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const proposeTrade = vi.fn()
const readTrades = vi.fn()
vi.mock('@/lib/leagues/api/trades-service', () => ({
  proposeTrade: (...args: unknown[]) => proposeTrade(...args),
  readTrades: (...args: unknown[]) => readTrades(...args),
}))

import { GET, POST } from './route'

const LEAGUE = 'b8a00000-0000-4000-8000-000000000001'
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/leagues/[id]/trades', () => {
  const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

  it('404 before auth on a malformed league id; 401 before the service when unauthenticated', async () => {
    expect((await POST(post({}), params('nope'))).status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(post({}), params(LEAGUE))).status).toBe(401)
    expect(proposeTrade).not.toHaveBeenCalled()
  })

  it('the body reaches the service whole; its status and body are the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    proposeTrade.mockResolvedValueOnce({ status: 409, body: { error: 'by name' } })
    const body = { from_team_id: 'a', to_team_id: 'b', items: [], action_id: 'x' }
    const res = await POST(post(body), params(LEAGUE))
    expect([res.status, await res.json()]).toStrictEqual([409, { error: 'by name' }])
    const [client, leagueId, passed] = proposeTrade.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect([leagueId, passed]).toStrictEqual([LEAGUE, body])
  })
})

describe('GET /api/leagues/[id]/trades', () => {
  it('404 / 401 before the service; the query (blanks dropped), the user id and a Date reach it', async () => {
    expect((await GET(new Request('http://x'), params('nope'))).status).toBe(404)
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await GET(new Request('http://x'), params(LEAGUE))).status).toBe(401)
    expect(readTrades).not.toHaveBeenCalled()

    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    readTrades.mockResolvedValueOnce({ status: 200, body: { trades: [] } })
    const res = await GET(new Request('http://x/api?status=open&team_id='), params(LEAGUE))
    expect([res.status, await res.json()]).toStrictEqual([200, { trades: [] }])
    const [, leagueId, userId, query, now] = readTrades.mock.calls[0]
    expect([leagueId, userId, query]).toStrictEqual([LEAGUE, 'u1', { status: 'open' }])
    expect(now).toBeInstanceOf(Date)
  })
})
