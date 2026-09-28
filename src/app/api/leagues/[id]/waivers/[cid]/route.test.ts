/**
 * PATCH / DELETE /api/leagues/[id]/waivers/[cid] — the thin handlers' own
 * contract (M5 L.D2.12): malformed ids are 404s and an unauthenticated
 * caller a 401 before the service; otherwise the ids and body reach the
 * service and its answer is the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser } }),
}))

const reorderClaim = vi.fn()
const cancelClaim = vi.fn()
const editClaim = vi.fn()
vi.mock('@/lib/leagues/api/waivers-service', () => ({
  reorderClaim: (...args: unknown[]) => reorderClaim(...args),
  cancelClaim: (...args: unknown[]) => cancelClaim(...args),
  editClaim: (...args: unknown[]) => editClaim(...args),
}))

import { DELETE, PATCH } from './route'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const CLAIM = 'b4000000-0000-4000-8000-0000000000c1'
const params = (id: string, cid: string) => ({ params: Promise.resolve({ id, cid }) })
const req = (method: string, body: unknown) => new Request('http://x', { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each([
  ['PATCH', PATCH, reorderClaim],
  ['DELETE', DELETE, cancelClaim],
] as const)('%s /api/leagues/[id]/waivers/[cid]', (method, handler, service) => {
  it('404 for a malformed league or claim id, before auth', async () => {
    expect((await handler(req(method, {}), params('nope', CLAIM))).status).toBe(404)
    const res = await handler(req(method, {}), params(LEAGUE, 'nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toStrictEqual({ error: 'Claim not found' })
    expect(getUser).not.toHaveBeenCalled()
  })

  it('401 unauthenticated; otherwise (league, claim, body) reach the service and its answer is the response', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect((await handler(req(method, {}), params(LEAGUE, CLAIM))).status).toBe(401)
    expect(service).not.toHaveBeenCalled()

    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    service.mockResolvedValueOnce({ status: 409, body: { error: 'verbatim' } })
    const body = { action_id: 'a', claim_order: 2 }
    const res = await handler(req(method, body), params(LEAGUE, CLAIM))
    expect(res.status).toBe(409)
    expect(service.mock.calls[0].slice(1)).toStrictEqual([LEAGUE, CLAIM, body])
  })
})

describe('PATCH dispatch (M5 L.D2.9 / F417): a body with claim_order is a MOVE; anything else is an EDIT in place', () => {
  it('{ faab_bid, drop_player_id } reaches the one-transaction edit, never the move', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    editClaim.mockResolvedValueOnce({ status: 200, body: { verb: 'waiver_claim_edit' } })
    const body = { action_id: 'a', faab_bid: 12, drop_player_id: null }
    const res = await PATCH(req('PATCH', body), params(LEAGUE, CLAIM))
    expect(res.status).toBe(200)
    expect(editClaim.mock.calls[0].slice(1)).toStrictEqual([LEAGUE, CLAIM, body])
    expect(reorderClaim).not.toHaveBeenCalled()
  })

  it('a body that is not an object goes to the edit, whose schema answers the 400', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    editClaim.mockResolvedValueOnce({ status: 400, body: { error: 'shape' } })
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'nope' }), params(LEAGUE, CLAIM))
    expect(res.status).toBe(400)
    expect(editClaim.mock.calls[0][3]).toBeNull()
    expect(reorderClaim).not.toHaveBeenCalled()
  })
})
