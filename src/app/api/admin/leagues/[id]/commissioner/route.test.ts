/**
 * POST /api/admin/leagues/[id]/commissioner (F750; migration 208). Gate first
 * (404 to a non-admin, RPC never called), Zod before the RPC, the operator's
 * own client, and every failure mapped loudly — never an empty 200.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { SET_COMMISSIONER_UNAVAILABLE } from '@/lib/admin/league-table'

import { POST } from './route'

const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const MEMBER = '7a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d'
const ACTION = '0b6c2f5e-8f1a-4c1e-9d55-3a1c0e2b7d10'
const post = (id: string, body: unknown) =>
  POST(new Request(`http://localhost/api/admin/leagues/${id}/commissioner`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  rpc.mockReset()
  gate.mockReset()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { rpc } })
})

describe('the gate', () => {
  it('a non-admin gets 404 and no RPC runs', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await post(LEAGUE, { member_id: MEMBER, action_id: ACTION })).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/leagues/[id]/commissioner', () => {
  it('calls op_set_commissioner with the league, member, action id and trimmed reason', async () => {
    rpc.mockResolvedValue({ data: { changed: true, new_member_id: MEMBER }, error: null })
    const res = await post(LEAGUE, { member_id: MEMBER, action_id: ACTION, reason: ' lost his email ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: true, new_member_id: MEMBER })
    expect(rpc).toHaveBeenCalledWith('op_set_commissioner', {
      p_league_id: LEAGUE,
      p_new_member_id: MEMBER,
      p_action_id: ACTION,
      p_reason: 'lost his email',
    })
  })

  it('no reason sends none', async () => {
    rpc.mockResolvedValue({ data: { changed: true }, error: null })
    await post(LEAGUE, { member_id: MEMBER, action_id: ACTION })
    expect(rpc).toHaveBeenCalledWith('op_set_commissioner', {
      p_league_id: LEAGUE, p_new_member_id: MEMBER, p_action_id: ACTION, p_reason: undefined,
    })
  })

  it('the no-op answers 200 with its why', async () => {
    rpc.mockResolvedValue({ data: { changed: false, why: 'already_commissioner — that member is already the commissioner' }, error: null })
    const res = await post(LEAGUE, { member_id: MEMBER, action_id: ACTION })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(false)
  })

  it('refuses before the RPC: a bad league id, no member, a bad member id, no action id, a blank or too-long reason, no body', async () => {
    const cases: Array<[string, unknown]> = [
      ['nope', { member_id: MEMBER, action_id: ACTION }],
      [LEAGUE, { action_id: ACTION }],
      [LEAGUE, { member_id: 'seat-3', action_id: ACTION }],
      [LEAGUE, { member_id: MEMBER }],
      [LEAGUE, { member_id: MEMBER, action_id: ACTION, reason: '   ' }],
      [LEAGUE, { member_id: MEMBER, action_id: ACTION, reason: 'x'.repeat(501) }],
      [LEAGUE, null],
    ]
    for (const [id, body] of cases) {
      expect((await post(id, body)).status, JSON.stringify([id, body])).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps RPC failures loudly', async () => {
    for (const [error, status, body] of [
      [{ code: 'PGRST202', message: 'missing' }, 503, SET_COMMISSIONER_UNAVAILABLE],
      [{ code: '42501', message: 'only a platform operator' }, 404, undefined],
      [{ code: '22023', message: 'set_commissioner: that seat has no person in it' }, 400, 'set_commissioner: that seat has no person in it'],
      [{ code: 'P0002', message: 'set_commissioner: member x is not in this league' }, 404, 'set_commissioner: member x is not in this league'],
      [{ code: 'XX000', message: 'boom' }, 500, 'boom'],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error })
      const res = await post(LEAGUE, { member_id: MEMBER, action_id: ACTION })
      expect(res.status, error.code).toBe(status)
      if (body) expect((await res.json()).error).toBe(body)
    }
  })

  it('an empty success is a 500, never a healthy-looking 200', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect((await post(LEAGUE, { member_id: MEMBER, action_id: ACTION })).status).toBe(500)
  })
})
