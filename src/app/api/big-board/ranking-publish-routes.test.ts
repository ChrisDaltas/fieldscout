/**
 * The two routes a ranking publish ends in — POST /api/big-board/save (the
 * season board) and PATCH /api/lists/[id]/players/reorder (a weekly board,
 * and every other list) — after migration 190 (Chris, 2026-10-15, #33/#36).
 *
 * Pinned here:
 *   1. The reorder RPC gets `is_new: true` for exactly the players the
 *      publish added (the RPC records everyone else's previous position);
 *      the save route's own `playerIds` path flags the players IT inserts.
 *   2. A plain reorder (no flags, no scoring) sends what it always sent and
 *      never touches `lists` — it must keep working on the older schema.
 *      The same holds for a ranking published with no scoring (desktop's
 *      Big Board and Weekly ranks saves): the route writes none, so a scoring
 *      already chosen stays; one never chosen is Half PPR, which the reorder
 *      RPC fills on the database side (Chris, 2026-10-16; pgTAP 138).
 *   3. The scoring is saved on the board after the order. Before 190 is
 *      pushed (PGRST204) the publish still succeeds (`unsupported`); any
 *      other failure is reported in the body, never as a failed publish —
 *      the order is already saved.
 *   4. An unknown scoring is a 400 and nothing is written.
 *
 * The Supabase server client is faked: `rpc` and every table write are
 * recorded, and each table answers from `h.state`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: { code?: string; message: string } | null }
  const OWNER = '11111111-1111-4111-8111-111111111111'
  const BOARD = '22222222-2222-4222-8222-222222222222'
  const WEEK = '33333333-3333-4333-8333-333333333333'
  const state = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    rpcError: null as Result['error'],
    listUpdates: [] as Array<Record<string, unknown>>,
    listUpdateResult: { data: [{ id: 'x' }], error: null } as Result,
    inserts: [] as Array<unknown>,
    existingPlayerIds: [] as string[],
  }

  function table(name: string) {
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      order: () => b,
      update: (row: Record<string, unknown>) => {
        op = 'update'
        if (name === 'lists') state.listUpdates.push(row)
        return b
      },
      insert: (rows: unknown) => {
        op = 'insert'
        state.inserts.push(rows)
        return b
      },
      delete: () => {
        op = 'delete'
        return b
      },
      maybeSingle: async (): Promise<Result> => ({ data: { id: BOARD }, error: null }),
      single: async (): Promise<Result> => ({ data: { id: 'snap', saved_at: 'now' }, error: null }),
      then: (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
        const result: Result =
          name === 'lists' && op === 'update'
            ? state.listUpdateResult
            : name === 'list_players' && op === 'select'
              ? { data: state.existingPlayerIds.map((player_id) => ({ player_id, position: 1, player: null })), error: null }
              : { data: null, error: null }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    return b
  }

  return { state, OWNER, BOARD, WEEK, table }
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.OWNER } } }) },
    from: (name: string) => h.table(name),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ fn, args })
      return { data: null, error: h.state.rpcError }
    },
  }),
}))

import { PATCH } from '@/app/api/lists/[id]/players/reorder/route'
import { POST } from './save/route'

const MISSING_COLUMN = {
  code: 'PGRST204',
  message: "Could not find the 'scoring_format' column of 'lists' in the schema cache",
}

const json = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function save(body: unknown) {
  return POST(new Request('http://localhost/api/big-board/save', { method: 'POST', ...json(body) }))
}

function reorder(body: unknown) {
  return PATCH(new Request(`http://localhost/api/lists/${h.WEEK}/players/reorder`, { method: 'PATCH', ...json(body) }), {
    params: Promise.resolve({ id: h.WEEK }),
  })
}

beforeEach(() => {
  h.state.rpcCalls = []
  h.state.rpcError = null
  h.state.listUpdates = []
  h.state.listUpdateResult = { data: [{ id: 'x' }], error: null }
  h.state.inserts = []
  h.state.existingPlayerIds = []
})

const PUBLISH = {
  positions: [
    { playerId: 'a', position: 2 },
    { playerId: 'n', position: 9, isNew: true },
  ],
  scoringFormat: 'half',
}
const RPC_POSITIONS = [
  { player_id: 'a', position: 2 },
  { player_id: 'n', position: 9, is_new: true },
]

describe('PATCH …/players/reorder — a weekly ranking publish', () => {
  it('flags the added players for the RPC and saves the scoring on the board', async () => {
    const res = await reorder(PUBLISH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, scoring: 'saved' })
    expect(h.state.rpcCalls).toEqual([
      { fn: 'reorder_list_players', args: { p_list_id: h.WEEK, p_positions: RPC_POSITIONS } },
    ])
    expect(h.state.listUpdates).toEqual([{ scoring_format: 'half' }])
  })

  it('a plain reorder — or a weekly publish with no scoring — sends what it always sent and never touches lists', async () => {
    const res = await reorder({ positions: [{ playerId: 'a', position: 1 }] })
    expect(await res.json()).toEqual({ ok: true })
    expect(h.state.rpcCalls[0]!.args.p_positions).toEqual([{ player_id: 'a', position: 1 }])
    expect(h.state.listUpdates).toEqual([])
  })

  it('before 190 is pushed the publish still succeeds — the scoring is just unsupported', async () => {
    h.state.listUpdateResult = { data: null, error: MISSING_COLUMN }
    const res = await reorder(PUBLISH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, scoring: 'unsupported' })
  })

  it('a scoring that fails to save is reported, not a failed publish', async () => {
    h.state.listUpdateResult = { data: [], error: null }
    const res = await reorder(PUBLISH)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scoringError: expect.stringMatching(/not found/) })
  })

  it('an unknown scoring is a 400 and nothing is written', async () => {
    const res = await reorder({ ...PUBLISH, scoringFormat: 'half_ppr' })
    expect(res.status).toBe(400)
    expect(h.state.rpcCalls).toEqual([])
    expect(h.state.listUpdates).toEqual([])
  })

  it('a refused reorder saves no scoring', async () => {
    h.state.rpcError = { message: 'Forbidden' }
    const res = await reorder(PUBLISH)
    expect(res.status).toBe(403)
    expect(h.state.listUpdates).toEqual([])
  })
})

describe('POST /api/big-board/save — a season ranking publish', () => {
  it('flags the added players for the RPC and saves the scoring on the board', async () => {
    const res = await save(PUBLISH)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scoring: 'saved' })
    expect(h.state.rpcCalls).toEqual([
      { fn: 'reorder_list_players', args: { p_list_id: h.BOARD, p_positions: RPC_POSITIONS } },
    ])
    expect(h.state.listUpdates).toEqual([{ scoring_format: 'half' }])
  })

  it('the full-replace path flags exactly the players it inserts', async () => {
    h.state.existingPlayerIds = ['a', 'b']
    const res = await save({ playerIds: ['c', 'a', 'b'] })
    expect(res.status).toBe(200)
    expect(h.state.rpcCalls[0]!.args.p_positions).toEqual([
      { player_id: 'c', position: 1, is_new: true },
      { player_id: 'a', position: 2 },
      { player_id: 'b', position: 3 },
    ])
    // No scoring sent → lists untouched: a chosen scoring is never
    // overwritten, and one never chosen is Half PPR (the RPC fills it).
    expect(h.state.listUpdates).toEqual([])
  })

  it('a desktop save with no scoring writes none — the board keeps its own, or the RPC’s Half PPR', async () => {
    const res = await save({ positions: [{ playerId: 'a', position: 1 }] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true })
    expect(body.scoring).toBeUndefined()
    expect(h.state.rpcCalls).toEqual([
      { fn: 'reorder_list_players', args: { p_list_id: h.BOARD, p_positions: [{ player_id: 'a', position: 1 }] } },
    ])
    expect(h.state.listUpdates).toEqual([])
  })

  it('before 190 is pushed the save still succeeds', async () => {
    h.state.listUpdateResult = { data: null, error: MISSING_COLUMN }
    const res = await save(PUBLISH)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scoring: 'unsupported' })
  })
})
