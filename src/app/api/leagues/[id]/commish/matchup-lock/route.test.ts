/**
 * GET /api/leagues/[id]/commish/matchup-lock — the thin handler's own contract
 * (M6A L.E1.18): a malformed league id is a 404 and an unauthenticated caller
 * a 401 BEFORE the service is reached; an authenticated caller's query string
 * is handed to `readCommishMatchupEditLock` whole with the injected client,
 * and the service's status/body come back unchanged. The schema, the RPC and
 * the mapper are the service's (`commish-matchup-service.test.ts`); the
 * RPC's behaviour is pgTAP 083's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const readCommishMatchupEditLock = vi.fn()
vi.mock('@/lib/leagues/api/commish-matchup-service', () => ({
  readCommishMatchupEditLock: (...args: unknown[]) => readCommishMatchupEditLock(...args),
}))

import { GET } from './route'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const MATCHUP = 'd4000000-0000-4000-8000-000000000041'
beforeEach(() => {
  vi.clearAllMocks()
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (query: string) => new Request(`http://x/api/leagues/${LEAGUE}/commish/matchup-lock${query}`)

describe('GET /api/leagues/[id]/commish/matchup-lock — can this matchup be corrected yet', () => {
  it('refuses an unauthenticated caller with 401 before the service is called', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await GET(get(`?matchup_id=${MATCHUP}`), params(LEAGUE))
    expect(res.status).toBe(401)
    expect(readCommishMatchupEditLock).not.toHaveBeenCalled()
  })

  it('a non-uuid league id is a 404 before auth is even read', async () => {
    const res = await GET(get(`?matchup_id=${MATCHUP}`), params('not-a-uuid'))
    expect(res.status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    expect(readCommishMatchupEditLock).not.toHaveBeenCalled()
  })

  it('the query reaches the service WHOLE with the injected client, and the service’s answer is the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    const doc = { matchup_id: MATCHUP, editable: false, message: 'the server’s sentence, verbatim' }
    readCommishMatchupEditLock.mockResolvedValueOnce({ status: 200, body: doc })
    const res = await GET(get(`?matchup_id=${MATCHUP}&extra=1`), params(LEAGUE))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(doc)
    const [client, leagueId, passed] = readCommishMatchupEditLock.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect(leagueId).toBe(LEAGUE)
    // An unknown key is forwarded so the service's strict schema refuses it by name.
    expect(passed).toStrictEqual({ matchup_id: MATCHUP, extra: '1' })
  })
})
