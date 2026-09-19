/**
 * GET /api/leagues/[id]/commish/log — the thin handler's own contract (M6A
 * L.E1.11, D351): a malformed league id is a 404 and an unauthenticated
 * caller a 401 BEFORE the service is reached; the query string reaches
 * `readCommishLog` as a plain record with EMPTY values dropped, and the
 * service's status/body come back unchanged. The membership gate, the
 * cursor and the page arithmetic are the service's and are proved in
 * `commish-log-service.test.ts` + the stack suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const readCommishLog = vi.fn()
vi.mock('@/lib/leagues/api/commish-log-service', () => ({ readCommishLog: (...args: unknown[]) => readCommishLog(...args) }))

import { GET } from './route'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.clearAllMocks()
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (qs = '') => new Request('http://x/api/leagues/' + LEAGUE + '/commish/log' + qs)

describe('GET /api/leagues/[id]/commish/log', () => {
  it('refuses an unauthenticated caller with 401 before the service is called', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await GET(get(), params(LEAGUE))
    expect(res.status).toBe(401)
    expect(readCommishLog).not.toHaveBeenCalled()
  })

  it('a non-uuid league id is a 404 before auth is even read', async () => {
    const res = await GET(get(), params('not-a-uuid'))
    expect(res.status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    expect(readCommishLog).not.toHaveBeenCalled()
  })

  it('the query string reaches the service as a record (empty values dropped) with the injected client; the service’s answer is the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    readCommishLog.mockResolvedValueOnce({ status: 403, body: { error: 'the gate’s own copy, verbatim' } })
    const res = await GET(get('?limit=5&cursor=abc&week='), params(LEAGUE))
    expect(res.status).toBe(403)
    expect(await res.json()).toStrictEqual({ error: 'the gate’s own copy, verbatim' })
    expect(readCommishLog).toHaveBeenCalledTimes(1)
    const [client, leagueId, query] = readCommishLog.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect(leagueId).toBe(LEAGUE)
    expect(query).toStrictEqual({ limit: '5', cursor: 'abc' })
  })

  it('no query string reaches the service as an empty record (the defaults are the service’s)', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    readCommishLog.mockResolvedValueOnce({ status: 200, body: { items: [], limit: 50, has_more: false, next_cursor: null } })
    const res = await GET(get(), params(LEAGUE))
    expect(res.status).toBe(200)
    expect(readCommishLog.mock.calls[0][2]).toStrictEqual({})
  })
})
