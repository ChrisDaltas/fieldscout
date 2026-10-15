/**
 * GET /api/admin/state and GET /api/admin/leagues/[id]/state (M8 L.G1.5,
 * migration 186) — gate first, one RPC with the operator's own client, and
 * every failure loud (never an empty 200). The RPCs' behaviour is pgTAP 134's.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { GET as platformGET } from './route'
import { GET as leagueGET } from '../leagues/[id]/state/route'

const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const leagueCall = (id: string) => leagueGET(new Request(`http://localhost/api/admin/leagues/${id}/state`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  rpc.mockReset()
  gate.mockReset()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { rpc } })
})

describe('GET /api/admin/state', () => {
  it('a non-admin gets the gate response and the RPC is never called', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await platformGET()).status).toBe(404)
    expect((await leagueCall(LEAGUE)).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns the RPC payload as is', async () => {
    rpc.mockResolvedValue({ data: { pauses: [], cron: [{ job: 'lineup-lock' }] }, error: null })
    const res = await platformGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pauses: [], cron: [{ job: 'lineup-lock' }] })
    expect(rpc).toHaveBeenCalledWith('op_platform_state')
  })

  it('maps failures loudly: 503 before the push, 404, 500, and a null payload is 500 not an empty state', async () => {
    for (const [error, status] of [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 503],
      [{ code: '42501', message: 'only a platform operator' }, 404],
      [{ code: 'XX000', message: 'boom' }, 500],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await platformGET()).status).toBe(status)
    }
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const res = await platformGET()
    expect(res.status).toBe(500)
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect((await platformGET()).status).toBe(500)
  })
})

describe('GET /api/admin/leagues/[id]/state', () => {
  it('passes the league id to op_league_state', async () => {
    rpc.mockResolvedValue({ data: { league: { id: LEAGUE } }, error: null })
    const res = await leagueCall(LEAGUE)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('op_league_state', { p_league_id: LEAGUE })
  })

  it('refuses a bad id before the RPC', async () => {
    expect((await leagueCall('not-a-uuid')).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('an unknown league is 404, and the pre-push function absence is 503', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'league_state: no such league' } })
    expect((await leagueCall(LEAGUE)).status).toBe(404)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    const res = await leagueCall(LEAGUE)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'The live-state view is not available yet.' })
  })
})
