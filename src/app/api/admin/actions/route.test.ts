/**
 * GET /api/admin/actions (the operator log) and GET /api/admin/leagues (the
 * league finder) — M8 L.G1.6. Gate first (404), the operator's own client,
 * overflow stated, failures loud.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { GET as logGET } from './route'
import { GET as leaguesGET } from '../leagues/route'

/** A chainable PostgREST stand-in that records calls and resolves to `result`. */
function builder(result: unknown) {
  const calls: [string, unknown[]][] = []
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit', 'is', 'ilike']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return { b, calls }
}

let from: ReturnType<typeof vi.fn>
beforeEach(() => {
  gate.mockReset()
  from = vi.fn()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { from } })
})

describe('GET /api/admin/actions', () => {
  it('a non-admin gets 404 and nothing is read', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await logGET()).status).toBe(404)
    expect((await leaguesGET(new Request('http://localhost/api/admin/leagues'))).status).toBe(404)
    expect(from).not.toHaveBeenCalled()
  })

  it('returns the newest 50 with the exact total', async () => {
    const { b, calls } = builder({ data: [{ id: 'a' }], error: null, count: 312 })
    from.mockReturnValue(b)
    const res = await logGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actions: [{ id: 'a' }], total: 312, limit: 50 })
    expect(from).toHaveBeenCalledWith('platform_operator_actions')
    expect(calls).toContainEqual(['limit', [50]])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
  })

  it('an error is 500, a missing table 503, and a missing count is 500 — never an empty log', async () => {
    from.mockReturnValueOnce(builder({ data: null, error: { code: 'XX000', message: 'boom' }, count: null }).b)
    expect((await logGET()).status).toBe(500)
    from.mockReturnValueOnce(builder({ data: null, error: { code: 'PGRST205', message: 'no table' }, count: null }).b)
    expect((await logGET()).status).toBe(503)
    from.mockReturnValueOnce(builder({ data: [], error: null, count: null }).b)
    expect((await logGET()).status).toBe(500)
  })
})

// GET /api/admin/leagues is now the all-leagues RPC read (193, F599): its
// behaviour is pinned in ../leagues/route.test.ts.
