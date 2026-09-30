/**
 * GET /api/leagues/[id]/commish/summary — the thin handler's own contract
 * (M6 L.E1.32, D455): a malformed league id is a 404 and an unauthenticated
 * caller a 401 BEFORE the service is reached; the read takes no query
 * parameters (an unexpected one is a 400 by name, never ignored); the
 * service is called with the injected client, the caller's id and the
 * TimeProvider's now, and its status / body come back unchanged — the
 * manager's 403 included. The gate, the sections and their pre-push shapes
 * are the service's (`commish-summary-service.test.ts` + the stack suite).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const readCommishSummary = vi.fn()
vi.mock('@/lib/leagues/api/commish-summary-service', () => ({
  readCommishSummary: (...args: unknown[]) => readCommishSummary(...args),
}))

const { FROZEN } = vi.hoisted(() => ({ FROZEN: new Date('2099-10-04T20:00:00.000Z') }))
vi.mock('@/lib/leagues/time/time-provider', () => ({ systemTime: { now: () => FROZEN } }))

import { GET } from './route'

const LEAGUE = 'c3200000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.clearAllMocks()
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (qs = '') => new Request(`http://x/api/leagues/${LEAGUE}/commish/summary${qs}`)

describe('GET /api/leagues/[id]/commish/summary', () => {
  it('refuses an unauthenticated caller with 401 before the service is called', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await GET(get(), params(LEAGUE))
    expect(res.status).toBe(401)
    expect(readCommishSummary).not.toHaveBeenCalled()
  })

  it('a non-uuid league id is a 404 before auth is even read', async () => {
    const res = await GET(get(), params('not-a-uuid'))
    expect(res.status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    expect(readCommishSummary).not.toHaveBeenCalled()
  })

  it('a query parameter is a 400 naming it — the read has none, so one is a caller’s mistake, not a filter', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    const res = await GET(get('?week=3'), params(LEAGUE))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('week')
    expect(readCommishSummary).not.toHaveBeenCalled()
  })

  it('calls the service with the injected client, the caller and the TimeProvider’s now; a MANAGER’s 403 comes back unchanged', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u-manager' } } })
    readCommishSummary.mockResolvedValueOnce({ status: 403, body: { error: 'the service’s own copy, verbatim' } })
    const res = await GET(get(), params(LEAGUE))
    expect(res.status).toBe(403)
    expect(await res.json()).toStrictEqual({ error: 'the service’s own copy, verbatim' })
    const [client, leagueId, userId, now] = readCommishSummary.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect(leagueId).toBe(LEAGUE)
    expect(userId).toBe('u-manager')
    expect(now).toBe(FROZEN)
  })

  it('a commissioner’s 200 document is the response body', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u-commish' } } })
    const doc = { league_id: LEAGUE, sections: { unmanaged_teams: { state: 'unavailable', missing: ['team_autopilot'], message: 'm' } } }
    readCommishSummary.mockResolvedValueOnce({ status: 200, body: doc })
    const res = await GET(get(), params(LEAGUE))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(doc)
  })
})
