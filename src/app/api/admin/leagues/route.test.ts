/**
 * GET /api/admin/leagues and GET /api/admin/leagues/[id]/detail (migration
 * 187; F599) — gate first (404, RPC never called), Zod before the RPC, one
 * RPC through the operator's own client, and every failure loud: the named
 * 503 before the push, 404 / 400 / 500, a payload without its list is 500
 * (never an empty table). The RPCs' behaviour is pgTAP 135's.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LEAGUE_DETAIL_UNAVAILABLE, LEAGUE_TABLE_UNAVAILABLE } from '@/lib/admin/league-table'

const rpc = vi.fn()
const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { GET as listGET } from './route'
import { GET as detailGET } from './[id]/detail/route'

const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const list = (qs = '') => listGET(new Request(`http://localhost/api/admin/leagues${qs}`))
const detail = (id: string) =>
  detailGET(new Request(`http://localhost/api/admin/leagues/${id}/detail`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  rpc.mockReset()
  gate.mockReset()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { rpc } })
})

describe('GET /api/admin/leagues', () => {
  it('a non-admin gets the gate 404 and the RPC is never called', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await list()).status).toBe(404)
    expect((await detail(LEAGUE)).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('defaults: newest first, page of 50 from 0, deleted left out', async () => {
    rpc.mockResolvedValue({ data: { total: 0, leagues: [] }, error: null })
    expect((await list()).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('op_list_leagues', {
      p_q: '', p_sort: 'created', p_desc: true, p_limit: 50, p_offset: 0, p_include_deleted: false,
    })
  })

  it('passes search, sort, direction, page and deleted through', async () => {
    rpc.mockResolvedValue({ data: { total: 120, leagues: [{ id: LEAGUE }], more: true }, error: null })
    const res = await list('?q=%20Sunday%20&sort=members&dir=asc&offset=50&limit=25&deleted=1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 120, leagues: [{ id: LEAGUE }], more: true })
    expect(rpc).toHaveBeenCalledWith('op_list_leagues', {
      p_q: 'Sunday', p_sort: 'members', p_desc: false, p_limit: 25, p_offset: 50, p_include_deleted: true,
    })
  })

  it('refuses bad query values before the RPC (boundary: limit 100 ok, 101 refused)', async () => {
    for (const qs of ['?sort=owner', '?dir=up', '?offset=-1', '?limit=0', '?limit=101', '?deleted=yes', `?q=${'x'.repeat(81)}`]) {
      expect((await list(qs)).status, qs).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: { total: 0, leagues: [] }, error: null })
    expect((await list('?limit=100')).status).toBe(200)
  })

  it('maps failures loudly: named 503 before the push, 404, 400, 500; no list is 500', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const pre = await list()
    expect(pre.status).toBe(503)
    expect(await pre.json()).toEqual({ error: LEAGUE_TABLE_UNAVAILABLE })
    for (const [error, status] of [
      [{ code: '42501', message: 'only a platform operator' }, 404],
      [{ code: '22023', message: 'list_leagues: a page is 1 to 100 leagues' }, 400],
      [{ code: 'XX000', message: 'boom' }, 500],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await list()).status).toBe(status)
    }
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect((await list()).status).toBe(500)
    rpc.mockResolvedValueOnce({ data: { total: 3 }, error: null })
    expect((await list()).status).toBe(500)
  })
})

describe('GET /api/admin/leagues/[id]/detail', () => {
  it('passes the id to op_league_detail', async () => {
    rpc.mockResolvedValue({ data: { league: { id: LEAGUE }, members: [] }, error: null })
    expect((await detail(LEAGUE)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('op_league_detail', { p_league_id: LEAGUE })
  })

  it('refuses a bad id before the RPC', async () => {
    expect((await detail('nope')).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('unknown league 404, named 503 before the push, members missing is 500', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'league_detail: no such league' } })
    expect((await detail(LEAGUE)).status).toBe(404)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    const pre = await detail(LEAGUE)
    expect(pre.status).toBe(503)
    expect(await pre.json()).toEqual({ error: LEAGUE_DETAIL_UNAVAILABLE })
    rpc.mockResolvedValueOnce({ data: { league: {} }, error: null })
    expect((await detail(LEAGUE)).status).toBe(500)
  })
})
