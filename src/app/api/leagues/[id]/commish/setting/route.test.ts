/**
 * POST /api/leagues/[id]/commish/setting — the thin handler's own contract (M6A
 * L.E1.11, D351): a malformed league id is a 404 and an unauthenticated
 * caller a 401 BEFORE the service is reached; an authenticated caller's body
 * is handed to `commishChangeSetting` whole with the injected client, and the
 * service's status/body come back unchanged. Everything else — the schema,
 * the RPC, the mapper, the F65(b) guard — is the service's and is proved in
 * `commish-setting-service.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const commishChangeSetting = vi.fn()
vi.mock('@/lib/leagues/api/commish-setting-service', () => ({ commishChangeSetting: (...args: unknown[]) => commishChangeSetting(...args) }))

import { POST } from './route'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.clearAllMocks()
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (body: unknown) =>
  new Request('http://x/api/leagues/' + LEAGUE + '/commish/setting', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/leagues/[id]/commish/setting', () => {
  it('refuses an unauthenticated caller with 401 before the service is built or called', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await POST(post({ action_id: 'x' }), params(LEAGUE))
    expect(res.status).toBe(401)
    expect(commishChangeSetting).not.toHaveBeenCalled()
  })

  it('a non-uuid league id is a 404 before auth is even read', async () => {
    const res = await POST(post({}), params('not-a-uuid'))
    expect(res.status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
    expect(commishChangeSetting).not.toHaveBeenCalled()
  })

  it('an authenticated caller’s body reaches the service WHOLE with the injected client, and the service’s answer is the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    commishChangeSetting.mockResolvedValueOnce({ status: 409, body: { error: 'the verb’s own refusal, verbatim' } })
    const body = { action_id: 'afa00000-0000-4000-8000-000000000001', reason: 'x' }
    const res = await POST(post(body), params(LEAGUE))
    expect(res.status).toBe(409)
    expect(await res.json()).toStrictEqual({ error: 'the verb’s own refusal, verbatim' })
    expect(commishChangeSetting).toHaveBeenCalledTimes(1)
    const [client, leagueId, passed] = commishChangeSetting.mock.calls[0]
    expect(client).toMatchObject({ auth: { getUser } })
    expect(leagueId).toBe(LEAGUE)
    expect(passed).toStrictEqual(body)
  })

  it('an unparseable body reaches the service as null (a 400 there), never a 500 here', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    commishChangeSetting.mockResolvedValueOnce({ status: 400, body: { error: { fieldErrors: {} } } })
    const res = await POST(new Request('http://x', { method: 'POST', body: '{nope' }), params(LEAGUE))
    expect(res.status).toBe(400)
    expect(commishChangeSetting.mock.calls.at(-1)?.[2]).toBeNull()
  })
})
