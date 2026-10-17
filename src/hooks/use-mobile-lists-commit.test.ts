/**
 * The list editor's Update (gap list #16, Chris 2026-10-15): the whole draft
 * goes through the app's existing routes in a safe order, the first failing
 * step stops the rest, and only a re-read that matches the draft counts as
 * saved — anything else comes back with what saved and what didn't.
 */
import { describe, expect, it } from 'vitest'

import {
  addToDraft,
  arrangeDraft,
  draftChanged,
  draftItems,
  draftOf,
  moveItem,
  removeFromDraft,
  setDraftMode,
  type ListDraft,
} from '@/components/mobile/lists/lists-model'
import type { ListPlayerWithPlayer, ListWithDetails } from '@/hooks/use-lists'
import type { PoolPlayer } from '@/hooks/use-mobile-lists-pool'

import { commitDraft } from './use-mobile-lists-commit'

function entry(n: number, tier: string | null = null): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier,
    notes: null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position: 'WR', team: 'BUF', headshot_url: null, status: null },
    stats: null,
  } as ListPlayerWithPlayer
}

const pool = (n: number): PoolPlayer => ({
  id: `p${n}`,
  full_name: `Player ${n}`,
  position: 'WR',
  team: 'KC',
  headshot_url: null,
  status: null,
  projected_pts: null,
  current_pts: 0,
  current_games: 0,
})

/** A fake of the routes Update uses, over one list. */
function server(
  initial: ListPlayerWithPlayer[],
  opts: { fail?: (method: string, path: string) => boolean; ignore?: (method: string, path: string) => boolean } = {},
) {
  const state = {
    title: 'My list',
    ranking_mode: 'ranked',
    players: initial.map((e) => ({ ...e })),
  }
  const log: string[] = []
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    log.push(`${method} ${path}`)
    if (opts.fail?.(method, path)) return reply(500, { error: 'boom' })
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (opts.ignore?.(method, path)) return reply(200, { ok: true })

    let m: RegExpMatchArray | null
    if (method === 'GET' && path === '/api/lists/l1') {
      return reply(200, { id: 'l1', ...state, players: state.players.map((e) => ({ ...e })) } as unknown as ListWithDetails)
    }
    if (method === 'DELETE' && (m = path.match(/^\/api\/lists\/l1\/players\/([^/]+)$/))) {
      state.players = state.players.filter((e) => e.player_id !== m![1])
      return reply(200, { ok: true })
    }
    if (method === 'POST' && path === '/api/lists/l1/players/bulk') {
      let next = state.players.reduce((max, e) => Math.max(max, e.position), 0) + 1
      for (const id of body.player_ids as string[]) {
        const n = Number(id.slice(1))
        state.players.push({ ...entry(n), position: next, overall_rank: next })
        next += 1
      }
      return reply(200, { inserted: body.player_ids.length, skipped: 0 })
    }
    if (method === 'PATCH' && (m = path.match(/^\/api\/lists\/l1\/players\/([^/]+)\/tier$/))) {
      const target = state.players.find((e) => e.player_id === m![1])
      if (!target) return reply(404, { error: 'Player is not on this list.' })
      target.tier = body.tier
      return reply(200, { ok: true })
    }
    if (method === 'PATCH' && path === '/api/lists/l1/players/reorder') {
      for (const { playerId, position } of body.positions as Array<{ playerId: string; position: number }>) {
        const target = state.players.find((e) => e.player_id === playerId)
        if (target) target.position = position
      }
      return reply(200, { ok: true })
    }
    if (method === 'PATCH' && path === '/api/lists/l1') {
      Object.assign(state, body)
      return reply(200, { id: 'l1' })
    }
    return reply(404, { error: `no route ${method} ${path}` })
  }) as typeof fetch

  return { state, log, fetchImpl }
}

/** Remove p2, add p9 at the top, turn Tiers on with p9 in Tier 1, rename. */
function bigDraft(list: { title: string; ranking_mode: string; players: ListPlayerWithPlayer[] }): ListDraft {
  let draft = draftOf(list)
  draft = removeFromDraft(draft, 'p2')
  draft = addToDraft(draft, pool(9), 'l1')
  draft = arrangeDraft(draft, moveItem(draftItems(draft), 2, 0)) // p9 p1 p3
  draft = setDraftMode(draft, 'rank_and_tier')
  draft = { ...draft, pending: 1 }
  draft = arrangeDraft(draft, moveItem(draftItems(draft), 3, 1)) // p9 | p1 p3
  return { ...draft, title: 'Renamed' }
}

describe('commitDraft', () => {
  it('writes the whole draft in the safe order, then re-reads to confirm', async () => {
    const api = server([entry(1), entry(2), entry(3)])
    const draft = bigDraft({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2), entry(3)] })
    const outcome = await commitDraft('l1', draft, api.fetchImpl)

    expect(outcome.ok).toBe(true)
    expect(api.log).toEqual([
      'GET /api/lists/l1',
      'DELETE /api/lists/l1/players/p2',
      'POST /api/lists/l1/players/bulk',
      'PATCH /api/lists/l1/players/p9/tier',
      'PATCH /api/lists/l1/players/p1/tier',
      'PATCH /api/lists/l1/players/p3/tier',
      'PATCH /api/lists/l1/players/reorder',
      'PATCH /api/lists/l1',
      'GET /api/lists/l1',
    ])
    const order = [...api.state.players].sort((a, b) => a.position - b.position)
    expect(order.map((e) => [e.player_id, e.tier])).toEqual([
      ['p9', 'S'],
      ['p1', 'A'],
      ['p3', 'A'],
    ])
    expect(api.state.title).toBe('Renamed')
    expect(api.state.ranking_mode).toBe('rank_and_tier')
  })

  it('a failed step stops the rest and reports what saved and what did not', async () => {
    const api = server([entry(1), entry(2), entry(3)], {
      fail: (method, path) => method === 'PATCH' && path.endsWith('/p1/tier'),
    })
    const draft = bigDraft({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2), entry(3)] })
    const outcome = await commitDraft('l1', draft, api.fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toBe('Could not set a tier: boom')
    // Neither the order nor the list fields were sent after the failure…
    expect(api.log.some((line) => line.endsWith('/reorder'))).toBe(false)
    expect(api.log.filter((line) => line === 'PATCH /api/lists/l1')).toEqual([])
    // …and the list was read again to see what stuck.
    expect(api.log.at(-1)).toBe('GET /api/lists/l1')
    expect(outcome.remaining?.remove).toEqual([])
    expect(outcome.remaining?.add).toEqual([])
    expect(outcome.remaining?.tiers).toEqual([{ playerId: 'p1', tier: 'A' }])
    expect(outcome.remaining?.order).toEqual(['p9', 'p1', 'p3'])
    expect(outcome.remaining?.fields).toEqual({ title: 'Renamed', ranking_mode: 'rank_and_tier' })
  })

  it('a second Update writes only what is left', async () => {
    let failing = true
    const api = server([entry(1), entry(2), entry(3)], {
      fail: (method, path) => failing && method === 'PATCH' && path === '/api/lists/l1/players/reorder',
    })
    const draft = bigDraft({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2), entry(3)] })
    expect((await commitDraft('l1', draft, api.fetchImpl)).ok).toBe(false)

    failing = false
    api.log.length = 0
    const outcome = await commitDraft('l1', draft, api.fetchImpl)
    expect(outcome.ok).toBe(true)
    expect(api.log).toEqual([
      'GET /api/lists/l1',
      'PATCH /api/lists/l1/players/reorder',
      'PATCH /api/lists/l1',
      'GET /api/lists/l1',
    ])
  })

  it('requests that answer OK without the change sticking are not a save', async () => {
    const api = server([entry(1), entry(2)], { ignore: (method, path) => method === 'DELETE' && path.includes('/players/') })
    const draft = removeFromDraft(draftOf({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2)] }), 'p2')
    const outcome = await commitDraft('l1', draft, api.fetchImpl)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toBe('Some changes didn’t stick.')
    expect(outcome.remaining?.remove).toEqual(['p2'])
  })

  it('a failed first read sends nothing', async () => {
    const api = server([entry(1)], { fail: (method) => method === 'GET' })
    const draft = setDraftMode(draftOf({ title: 'My list', ranking_mode: 'ranked', players: [entry(1)] }), 'unranked')
    const outcome = await commitDraft('l1', draft, api.fetchImpl)
    expect(outcome).toMatchObject({ ok: false, attempted: null, remaining: null })
    expect(api.log).toEqual(['GET /api/lists/l1'])
  })

  it('a draft equal to the list writes nothing', async () => {
    const api = server([entry(1), entry(2)])
    const draft = draftOf({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2)] })
    expect((await commitDraft('l1', draft, api.fetchImpl)).ok).toBe(true)
    expect(api.log).toEqual(['GET /api/lists/l1'])
  })

  it('every write landed but the confirming read failed: Update again confirms the save', async () => {
    let reads = 0
    const api = server([entry(1), entry(2)], { fail: (method) => method === 'GET' && ++reads === 2 })
    const start = draftOf({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2)] })
    const draft = arrangeDraft(start, moveItem(draftItems(start), 1, 0)) // p2 p1
    const first = await commitDraft('l1', draft, api.fetchImpl)
    expect(first).toMatchObject({ ok: false, remaining: null, list: null })
    // The draft is still a change against where editing began, so the
    // editor's Update stays live…
    expect(draftChanged(draft)).toBe(true)
    // …and the retry finds nothing left to write and reports the save.
    api.log.length = 0
    expect((await commitDraft('l1', draft, api.fetchImpl)).ok).toBe(true)
    expect(api.log).toEqual(['GET /api/lists/l1'])
  })
})

describe('commitDraft — the list changed elsewhere after the editor opened', () => {
  const opened = () => ({ title: 'My list', ranking_mode: 'ranked', players: [entry(1), entry(2), entry(3)] })

  it('a player added on desktop is kept, not removed, and goes after the reordered draft', async () => {
    const api = server([entry(1), entry(2), entry(3)])
    // The phone's draft: p3 dragged to the top.
    const start = draftOf(opened())
    const draft = arrangeDraft(start, moveItem(draftItems(start), 2, 0))
    // Meanwhile desktop adds p4.
    api.state.players.push({ ...entry(4), position: 4 })

    const outcome = await commitDraft('l1', draft, api.fetchImpl)
    expect(outcome.ok).toBe(true)
    expect(api.log.some((line) => line.startsWith('DELETE'))).toBe(false)
    expect(api.log).toEqual(['GET /api/lists/l1', 'PATCH /api/lists/l1/players/reorder', 'GET /api/lists/l1'])
    const order = [...api.state.players].sort((a, b) => a.position - b.position).map((e) => e.player_id)
    expect(order).toEqual(['p3', 'p1', 'p2', 'p4'])
  })

  it('with no edits, a list that gained a player is not a change and writes nothing', async () => {
    const api = server([entry(1), entry(2), entry(3)])
    const draft = draftOf(opened())
    api.state.players.push({ ...entry(4), position: 4 })
    expect(draftChanged(draft)).toBe(false)
    expect((await commitDraft('l1', draft, api.fetchImpl)).ok).toBe(true)
    expect(api.log).toEqual(['GET /api/lists/l1'])
    expect(api.state.players.map((e) => e.player_id)).toContain('p4')
  })

  it('a tier, name or removal made elsewhere is not reverted by an unrelated edit', async () => {
    const api = server([entry(1), entry(2), entry(3)])
    // The phone only adds p9.
    const draft = addToDraft(draftOf(opened()), pool(9), 'l1')
    // Desktop meanwhile renames, tiers p2 and removes p3.
    api.state.title = 'Desk name'
    api.state.players = api.state.players.filter((e) => e.player_id !== 'p3')
    api.state.players.find((e) => e.player_id === 'p2')!.tier = 'S'

    const outcome = await commitDraft('l1', draft, api.fetchImpl)
    expect(outcome.ok).toBe(true)
    expect(api.log).toEqual(['GET /api/lists/l1', 'POST /api/lists/l1/players/bulk', 'GET /api/lists/l1'])
    expect(api.state.title).toBe('Desk name')
    expect(api.state.players.find((e) => e.player_id === 'p2')?.tier).toBe('S')
    expect(api.state.players.map((e) => e.player_id)).toEqual(['p1', 'p2', 'p9'])
  })
})
