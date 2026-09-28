/**
 * GET / POST /api/leagues/[id]/waivers — the thin handlers' own contract (M5
 * L.D2.12): a malformed league id is a 404 and an unauthenticated caller a
 * 401 BEFORE the service is reached; otherwise the body (POST) or the query
 * (GET, empty values dropped) reaches the service with the injected client
 * and the caller's id, and the service's answer is the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const submitClaim = vi.fn()
const readClaims = vi.fn()
vi.mock('@/lib/leagues/api/waivers-service', () => ({
  submitClaim: (...args: unknown[]) => submitClaim(...args),
  readClaims: (...args: unknown[]) => readClaims(...args),
}))

import { GET, POST } from './route'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/leagues/[id]/waivers', () => {
  it('404 on a malformed league id before auth; 401 unauthenticated before the service', async () => {
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }), params('nope'))).status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }), params(LEAGUE))).status).toBe(401)
    expect(submitClaim).not.toHaveBeenCalled()
  })

  it('hands the body WHOLE to the service (an unparseable one as null) and answers with its result', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    submitClaim.mockResolvedValueOnce({ status: 409, body: { error: 'verbatim' } })
    const body = { team_id: 't', add_player_id: 'p', action_id: 'a' }
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), params(LEAGUE))
    expect(res.status).toBe(409)
    expect(await res.json()).toStrictEqual({ error: 'verbatim' })
    expect(submitClaim.mock.calls[0].slice(1)).toStrictEqual([LEAGUE, body])
    submitClaim.mockResolvedValueOnce({ status: 400, body: { error: {} } })
    await POST(new Request('http://x', { method: 'POST', body: '{nope' }), params(LEAGUE))
    expect(submitClaim.mock.calls[1][2]).toBeNull()
  })
})

describe('GET /api/leagues/[id]/waivers', () => {
  it('401 unauthenticated; otherwise the query (empty values dropped) and the caller id reach the service', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await GET(new Request('http://x/api/leagues/' + LEAGUE + '/waivers'), params(LEAGUE))).status).toBe(401)
    expect(readClaims).not.toHaveBeenCalled()

    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    readClaims.mockResolvedValueOnce({ status: 200, body: { claims: [] } })
    const res = await GET(new Request('http://x/api/leagues/' + LEAGUE + '/waivers?status=all&team_id='), params(LEAGUE))
    expect(res.status).toBe(200)
    expect(readClaims.mock.calls[0].slice(1)).toStrictEqual([LEAGUE, 'u1', { status: 'all' }])
  })
})
