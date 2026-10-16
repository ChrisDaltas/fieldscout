/**
 * The operator write doors (M8 L.G1.6; F583 / F585): POST /api/admin/jobs and
 * POST /api/admin/games/[id]/status. Gate first (404 to a non-admin, RPC never
 * called), Zod before the RPC, the operator's own client, and every failure
 * mapped loudly — never an empty 200.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const gate = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))

import { POST as jobsPOST } from './route'
import { POST as gamePOST } from '../games/[id]/status/route'

const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const ACTION = '0b6c2f5e-8f1a-4c1e-9d55-3a1c0e2b7d10'
const jobs = (body: unknown) =>
  jobsPOST(new Request('http://localhost/api/admin/jobs', { method: 'POST', body: JSON.stringify(body) }))
const game = (id: string, body: unknown) =>
  gamePOST(new Request(`http://localhost/api/admin/games/${id}/status`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  rpc.mockReset()
  gate.mockReset()
  gate.mockResolvedValue({ ok: true, user: { id: 'op' }, supabase: { rpc } })
})

describe('the gate', () => {
  it('a non-admin gets 404 from both doors and no RPC runs', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await jobs({ verb: 'pause', job: 'waivers', action_id: ACTION })).status).toBe(404)
    expect((await game('2026_05_KC_BUF', { status: 'cancelled', action_id: ACTION })).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/jobs', () => {
  it('each verb calls its own RPC with the league, action id and reason', async () => {
    rpc.mockResolvedValue({ data: { changed: true }, error: null })
    for (const [verb, fn] of [['pause', 'op_pause_job'], ['resume', 'op_resume_job'], ['run_now', 'op_run_job_now']] as const) {
      const res = await jobs({ verb, job: 'waivers', league_id: LEAGUE, action_id: ACTION, reason: ' storm ' })
      expect(res.status).toBe(200)
      expect(rpc).toHaveBeenLastCalledWith(fn, { p_job: 'waivers', p_league_id: LEAGUE, p_action_id: ACTION, p_reason: 'storm' })
    }
  })

  it('every-league scope sends no league id', async () => {
    rpc.mockResolvedValue({ data: { changed: true }, error: null })
    await jobs({ verb: 'pause', job: 'week-finalize', action_id: ACTION })
    expect(rpc).toHaveBeenCalledWith('op_pause_job', { p_job: 'week-finalize', p_league_id: undefined, p_action_id: ACTION, p_reason: undefined })
  })

  it('refuses before the RPC: lineup locking paused or resumed (Q98), no action id, an unknown job, a bad league id', async () => {
    for (const body of [
      { verb: 'pause', job: 'lineup-lock', action_id: ACTION },
      { verb: 'resume', job: 'lineup-lock', action_id: ACTION },
      { verb: 'pause', job: 'waivers' },
      { verb: 'pause', job: 'draft-clock', action_id: ACTION },
      { verb: 'pause', job: 'waivers', action_id: ACTION, league_id: 'nope' },
      { verb: 'finalize', job: 'week-finalize', action_id: ACTION },
    ]) {
      expect((await jobs(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lineup locking may be run now', async () => {
    rpc.mockResolvedValue({ data: { changed: false, why: 'nothing_due — …' }, error: null })
    const res = await jobs({ verb: 'run_now', job: 'lineup-lock', action_id: ACTION })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: false, why: 'nothing_due — …' })
  })

  it('maps RPC failures loudly', async () => {
    for (const [error, status] of [
      [{ code: 'PGRST202', message: 'missing' }, 503],
      [{ code: '42501', message: 'only a platform operator' }, 404],
      [{ code: '22023', message: 'action id was already used' }, 400],
      [{ code: 'P0002', message: 'pause_job: league x does not exist' }, 404],
      [{ code: 'XX000', message: 'boom' }, 500],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await jobs({ verb: 'pause', job: 'waivers', action_id: ACTION })).status, error.code).toBe(status)
    }
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect((await jobs({ verb: 'pause', job: 'waivers', action_id: ACTION })).status).toBe(500)
    const res503 = await (async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'x' } })
      return jobs({ verb: 'pause', job: 'waivers', action_id: ACTION })
    })()
    expect(await res503.json()).toEqual({ error: 'The job controls are not available yet.' })
  })
})

describe('POST /api/admin/games/[id]/status', () => {
  it('calls op_set_game_status with the game, mark and action id', async () => {
    rpc.mockResolvedValue({ data: { changed: true, operator_hold: 'cancelled' }, error: null })
    const res = await game('2026_05_KC_BUF', { status: 'cancelled', action_id: ACTION })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('op_set_game_status', {
      p_game_id: '2026_05_KC_BUF', p_status: 'cancelled', p_action_id: ACTION, p_reason: undefined,
    })
  })

  it('refuses a bad mark, a missing action id and a bad game id before the RPC — and there is no finalize (Q99 a)', async () => {
    expect((await game('2026_05_KC_BUF', { status: 'finalize', action_id: ACTION })).status).toBe(400)
    expect((await game('2026_05_KC_BUF', { status: 'normal' })).status).toBe(400)
    expect((await game('bad id;drop', { status: 'normal', action_id: ACTION })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a final game (22023) is a 400 with the RPC’s words; an unknown game 404; pre-push 503', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'set_game_status: the game is final' } })
    const r1 = await game('g1', { status: 'cancelled', action_id: ACTION })
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: 'set_game_status: the game is final' })
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'no game' } })
    expect((await game('g1', { status: 'cancelled', action_id: ACTION })).status).toBe(404)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    const r3 = await game('g1', { status: 'cancelled', action_id: ACTION })
    expect(r3.status).toBe(503)
    expect(await r3.json()).toEqual({ error: 'Marking games is not available yet.' })
  })
})
