/**
 * POST /api/admin/notifications (M8 L.G1.2, migration 185) — the thin door:
 * gate first, shape second, then exactly one op_send_notification call with
 * the operator's own client; refusals are loud HTTP errors, never a 200.
 * The verb's own behaviour is pgTAP 133's.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { POST } from './route'

const ACTION = '0b6a3a8e-5d0c-4c1f-9b55-2f7d7c1d0a11'
const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const req = (body: unknown) => new Request('http://localhost/api/admin/notifications', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  rpc.mockReset()
  gate.mockReset()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { rpc } })
})

describe('POST /api/admin/notifications', () => {
  it('a non-admin gets the gate response and the RPC is never called', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const res = await POST(req({ audience: 'all_users', title: 'Hi', action_id: ACTION }))
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a league send passes every field to op_send_notification and returns its count', async () => {
    rpc.mockResolvedValue({ data: { changed: true, recipients: 1001, pages: 2 }, error: null })
    const res = await POST(req({ audience: 'league', league_id: LEAGUE, title: ' Waivers paused ', body: 'A game moved.', link: '/app/leagues/x', action_id: ACTION }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: true, recipients: 1001, pages: 2 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('op_send_notification', {
      p_audience: 'league', p_title: 'Waivers paused', p_body: 'A game moved.', p_link: '/app/leagues/x',
      p_league_id: LEAGUE, p_channels: ['in_app'], p_action_id: ACTION, p_reason: undefined,
    })
  })

  it('refuses a bad shape before the RPC: email channel, league without id, id without league, no action id', async () => {
    for (const body of [
      { audience: 'all_users', title: 'Hi', action_id: ACTION, channels: ['email'] },
      { audience: 'league', title: 'Hi', action_id: ACTION },
      { audience: 'all_users', league_id: LEAGUE, title: 'Hi', action_id: ACTION },
      { audience: 'all_users', title: 'Hi' },
      { audience: 'everyone', title: 'Hi', action_id: ACTION },
    ]) {
      const res = await POST(req(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps the verb\'s refusals loudly', async () => {
    const cases: [{ code: string; message: string }, number][] = [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 503],
      [{ code: '42501', message: 'only a platform operator' }, 403],
      [{ code: 'P0002', message: 'send_notification: this audience has no recipients — nothing was sent' }, 422],
      [{ code: 'P0002', message: 'send_notification: league x does not exist' }, 404],
      [{ code: '22023', message: 'a link must be a page inside FieldScout' }, 400],
      [{ code: 'XX000', message: 'boom' }, 500],
    ]
    for (const [error, status] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      const res = await POST(req({ audience: 'all_users', title: 'Hi', action_id: ACTION }))
      expect(res.status, error.code).toBe(status)
    }
  })
})
