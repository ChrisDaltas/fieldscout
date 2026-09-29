/**
 * POST /api/leagues/[id]/trades/preview and GET …/trades/deadline — the thin
 * handlers' own contract (M5 L.D3.12, migration 162): a malformed league id
 * is a 404 and an unauthenticated caller a 401 BEFORE the service; otherwise
 * the body reaches the service whole with the injected client, and the
 * service's answer (including 162's named 503 before it is pushed) is the
 * response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const previewTrade = vi.fn()
const readTradeDeadline = vi.fn()
vi.mock('@/lib/leagues/api/trades-service', () => ({
  previewTrade: (...args: unknown[]) => previewTrade(...args),
  readTradeDeadline: (...args: unknown[]) => readTradeDeadline(...args),
}))

import { GET } from '../deadline/route'
import { POST } from './route'

const LEAGUE = 'b8a00000-0000-4000-8000-000000000001'
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/leagues/[id]/trades/preview', () => {
  const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

  it('404 before auth on a malformed league id; 401 before the service when unauthenticated', async () => {
    expect((await POST(post({}), params('nope'))).status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(post({}), params(LEAGUE))).status).toBe(401)
    expect(previewTrade).not.toHaveBeenCalled()
  })

  it('the body reaches the service whole; its status and body are the response (the 503 included)', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    previewTrade.mockResolvedValueOnce({ status: 503, body: { error: 'not yet' } })
    const body = { trade_id: 'x', drops: ['p1'] }
    const res = await POST(post(body), params(LEAGUE))
    expect([res.status, await res.json()]).toStrictEqual([503, { error: 'not yet' }])
    const [client, leagueId, passed] = previewTrade.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect([leagueId, passed]).toStrictEqual([LEAGUE, body])
  })
})

describe('GET /api/leagues/[id]/trades/deadline', () => {
  it('404 / 401 before the service; then the league reaches it and its answer is the response', async () => {
    expect((await GET(new Request('http://x'), params('nope'))).status).toBe(404)
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await GET(new Request('http://x'), params(LEAGUE))).status).toBe(401)
    expect(readTradeDeadline).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    readTradeDeadline.mockResolvedValueOnce({ status: 200, body: { passed: false } })
    const res = await GET(new Request('http://x'), params(LEAGUE))
    expect([res.status, await res.json()]).toStrictEqual([200, { passed: false }])
    expect(readTradeDeadline.mock.calls[0][1]).toBe(LEAGUE)
  })
})
