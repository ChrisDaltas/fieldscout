/**
 * The requests the phone ranking editor's "Publish" / "Publish updates"
 * makes (`publish-board.ts`, through `useSaveRankingSlice`). These were
 * pinned through the ranking Duplicate, which shared them; Duplicate is gone
 * (Chris, 2026-10-19) and the editor's publish keeps them, so they're pinned
 * here directly:
 *   1. the board read: the season board's route, or that week's;
 *   2. adds first, then every removal in ONE bulk DELETE, then the order
 *      write — the season board's save, or a week's reorder — carrying only
 *      the edited position's slots and the scoring;
 *   3. a failed step throws and nothing after it is sent (never reported as
 *      a publish); a removal past the bulk route's limit goes in turns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BULK_MAX, boardRows, readRankingBoard, writeRankingBoard } from './publish-board'
import { planSliceSave } from './rankings-ops'

type Call = { method: string; url: string; body?: unknown }

const net = {
  calls: [] as Call[],
  routes: new Map<string, () => Response>(),
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  net.calls.length = 0
  net.routes.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      net.calls.push({ method, url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
      const route = net.routes.get(`${method} ${url}`)
      return route ? route() : json({ ok: true })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const row = (id: string, position: string, slot: number) => ({ player_id: id, position: slot, player: { position } })

describe('the board read', () => {
  it('the season board, or that week’s', async () => {
    net.routes.set('GET /api/lists/big-board', () => json({ list: { id: 'season' }, players: [] }))
    net.routes.set('GET /api/big-board/week/7', () => json({ list: { id: 'w7' }, players: [] }))
    expect((await readRankingBoard(0)).list.id).toBe('season')
    expect((await readRankingBoard(7)).list.id).toBe('w7')
  })

  it('a read with no board is a failure, never an empty board', async () => {
    net.routes.set('GET /api/lists/big-board', () => json({ players: [] }))
    await expect(readRankingBoard(0)).rejects.toThrow('The board did not load')
  })
})

describe('the publish writes', () => {
  // Your season board: RB r9 (slot 1), WR w9 (2), RB r1 (3). The editor's RB
  // order is now r1, r2 — r9 leaves, r2 joins.
  const rows = boardRows({
    list: { id: 'season' },
    players: [row('r9', 'RB', 1), row('w9', 'WR', 2), row('r1', 'RB', 3)],
  })
  const plan = planSliceSave(rows, 'RB', ['r1', 'r2'])

  it('season: adds, one bulk removal, then the save — only RB’s slots, with the scoring', async () => {
    await writeRankingBoard({ week: 0, listId: 'season', plan, fresh: new Set(plan.add), scoringFormat: 'ppr' })
    expect(net.calls).toEqual([
      { method: 'POST', url: '/api/lists/season/players/bulk', body: { player_ids: ['r2'] } },
      { method: 'DELETE', url: '/api/lists/season/players/bulk', body: { player_ids: ['r9'] } },
      {
        method: 'POST',
        url: '/api/big-board/save',
        body: {
          positions: [
            { playerId: 'r1', position: 1 },
            { playerId: 'r2', position: 3, isNew: true },
          ],
          scoringFormat: 'ppr',
        },
      },
    ])
  })

  it('a week: the order goes through the list reorder route', async () => {
    await writeRankingBoard({ week: 7, listId: 'w7', plan, fresh: new Set(plan.add), scoringFormat: 'half' })
    expect(net.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/lists/w7/players/bulk',
      'DELETE /api/lists/w7/players/bulk',
      'PATCH /api/lists/w7/players/reorder',
    ])
  })

  it('a failed add stops it: nothing of yours is removed and no order is written', async () => {
    net.routes.set('POST /api/lists/season/players/bulk', () => json({ error: 'Too many requests' }, 429))
    await expect(
      writeRankingBoard({ week: 0, listId: 'season', plan, fresh: new Set(plan.add), scoringFormat: 'ppr' }),
    ).rejects.toThrow('Too many requests')
    expect(net.calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('a failed removal stops it before the order write', async () => {
    net.routes.set('DELETE /api/lists/season/players/bulk', () => json({ error: 'Forbidden' }, 403))
    await expect(
      writeRankingBoard({ week: 0, listId: 'season', plan, fresh: new Set(plan.add), scoringFormat: 'ppr' }),
    ).rejects.toThrow('Forbidden')
    expect(net.calls.some((c) => c.url === '/api/big-board/save')).toBe(false)
  })

  it('a scoring the server couldn’t save comes back, without failing the publish', async () => {
    net.routes.set('POST /api/big-board/save', () => json({ scoringError: 'not yet' }))
    const res = await writeRankingBoard({ week: 0, listId: 'season', plan, fresh: new Set(), scoringFormat: 'ppr' })
    expect(res).toEqual({ scoringError: 'not yet' })
  })

  it('a removal past the bulk route’s limit goes in turns, one request per batch', async () => {
    const mine = Array.from({ length: BULK_MAX + 3 }, (_, i) => row(`r${i + 100}`, 'RB', i + 1))
    const big = planSliceSave(boardRows({ list: { id: 'season' }, players: mine }), 'RB', [])
    await writeRankingBoard({ week: 0, listId: 'season', plan: big, fresh: new Set(), scoringFormat: 'ppr' })
    const deletes = net.calls.filter((c) => c.method === 'DELETE') as Array<Call & { body: { player_ids: string[] } }>
    expect(deletes.map((c) => [c.url, c.body.player_ids.length])).toEqual([
      ['/api/lists/season/players/bulk', BULK_MAX],
      ['/api/lists/season/players/bulk', 3],
    ])
  })
})
