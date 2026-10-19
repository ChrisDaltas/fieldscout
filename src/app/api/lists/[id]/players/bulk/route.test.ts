/**
 * DELETE /api/lists/[id]/players/bulk — every player a ranking publish
 * drops, in ONE request and one statement, instead of one DELETE per player
 * fired at once.
 *
 * Pinned:
 *   1. owner only; a bad body is a 400 and nothing is deleted;
 *   2. one delete statement for the whole set, followers notified once;
 *   3. a player already off the list is fine; one the delete didn't remove
 *      who is STILL on the list is a 500 — a delete that matched nothing is
 *      never taken as proof it worked.
 *
 * The Supabase server client is faked: each table call is recorded and
 * answers from `h.state`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null }
  const OWNER = '11111111-1111-4111-8111-111111111111'
  const LIST = '22222222-2222-4222-8222-222222222222'
  const state = {
    owner: OWNER,
    deletes: [] as Array<string[]>,
    /** What the delete reports it removed (null: all it was asked for). */
    deleted: null as string[] | null,
    deleteError: null as Result['error'],
    /** Rows the follow-up check finds still on the list. */
    stillOnList: [] as string[],
    rpcCalls: [] as string[],
  }

  function table(name: string) {
    let op: 'select' | 'delete' = 'select'
    let inIds: string[] = []
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: (_col: string, ids: string[]) => {
        inIds = ids
        if (op === 'delete') state.deletes.push(ids)
        return b
      },
      delete: () => {
        op = 'delete'
        return b
      },
      maybeSingle: async (): Promise<Result> => ({ data: { id: LIST, owner_id: state.owner }, error: null }),
      then: (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
        let result: Result = { data: null, error: null }
        if (name === 'list_players' && op === 'delete') {
          result = state.deleteError
            ? { data: null, error: state.deleteError }
            : { data: (state.deleted ?? inIds).map((player_id) => ({ player_id })), error: null }
        } else if (name === 'list_players') {
          result = {
            data: state.stillOnList.filter((id) => inIds.includes(id)).map((player_id) => ({ player_id })),
            error: null,
          }
        }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    return b
  }

  return { state, OWNER, LIST, table }
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.OWNER } } }) },
    from: (name: string) => h.table(name),
    rpc: async (fn: string) => {
      h.state.rpcCalls.push(fn)
      return { data: null, error: null }
    },
  }),
}))

import { DELETE } from './route'

function remove(body: unknown) {
  return DELETE(
    new Request(`http://localhost/api/lists/${h.LIST}/players/bulk`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: h.LIST }) },
  )
}

beforeEach(() => {
  h.state.owner = h.OWNER
  h.state.deletes = []
  h.state.deleted = null
  h.state.deleteError = null
  h.state.stillOnList = []
  h.state.rpcCalls = []
})

describe('DELETE …/players/bulk', () => {
  it('removes the whole set in one statement and notifies followers once', async () => {
    const res = await remove({ player_ids: ['a', 'b', 'c', 'a'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removed: 3, skipped: 0 })
    expect(h.state.deletes).toEqual([['a', 'b', 'c']])
    expect(h.state.rpcCalls).toEqual(['notify_list_followers'])
  })

  it('a player already off the list is fine — the end state holds', async () => {
    h.state.deleted = ['a']
    const res = await remove({ player_ids: ['a', 'gone'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removed: 1, skipped: 1 })
  })

  it('one the delete didn’t remove who is still on the list fails loudly', async () => {
    h.state.deleted = []
    h.state.stillOnList = ['a', 'b']
    const res = await remove({ player_ids: ['a', 'b'] })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '2 players could not be removed' })
    expect(h.state.rpcCalls).toEqual([])
  })

  it('a database error is a 500, never an empty success', async () => {
    h.state.deleteError = { message: 'boom' }
    const res = await remove({ player_ids: ['a'] })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })

  it('someone else’s list: 403, nothing deleted', async () => {
    h.state.owner = '99999999-9999-4999-8999-999999999999'
    const res = await remove({ player_ids: ['a'] })
    expect(res.status).toBe(403)
    expect(h.state.deletes).toEqual([])
  })

  it('an empty or oversized set is a 400, nothing deleted', async () => {
    expect((await remove({ player_ids: [] })).status).toBe(400)
    expect((await remove({ player_ids: Array.from({ length: 501 }, (_, i) => `p${i}`) })).status).toBe(400)
    expect(h.state.deletes).toEqual([])
  })
})
