/**
 * The Lists "Users" rank column's read (gap list §3 #9). Pinned:
 *  - it reads the existing users' consensus (`consensus_rankings`, which
 *    applies Rule 9's cred weighting) — the position rank, by player id;
 *  - each id once, in chunks well under PostgREST's 1000-row cap;
 *  - a player the consensus doesn't hold is simply absent;
 *  - a failed read throws (an error state), never an empty map that would
 *    read as "nobody ranked him".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}
const calls: Call[] = []
let answer: (call: Call) => { data: unknown; error: unknown } = () => ({ data: [], error: null })

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }),
}))

import { readUsersRanks } from './use-mobile-lists-users-ranks'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)
const idsOf = (call: Call) => op(call, 'in')[0]?.[1] as string[]

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null })
})

describe('readUsersRanks', () => {
  it('reads each player’s position rank from the users’ consensus', async () => {
    answer = () => ({
      data: [
        { player_id: 'p1', consensus_position_rank: 3 },
        { player_id: 'p2', consensus_position_rank: '12' },
        { player_id: 'p3', consensus_position_rank: null },
      ],
      error: null,
    })
    const ranks = await readUsersRanks(['p2', 'p1', 'p3', 'p4', 'p1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.table).toBe('consensus_rankings')
    expect(op(calls[0]!, 'select')[0]).toEqual(['player_id, consensus_position_rank'])
    expect(op(calls[0]!, 'in')[0]?.[0]).toBe('player_id')
    // Each id once.
    expect(idsOf(calls[0]!)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect([...ranks]).toEqual([
      ['p1', 3],
      ['p2', 12],
    ])
    // Not in the consensus: absent (the column draws "–").
    expect(ranks.has('p3')).toBe(false)
    expect(ranks.has('p4')).toBe(false)
  })

  it('a long list is read in chunks under the row cap', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${String(i).padStart(3, '0')}`)
    await readUsersRanks(ids)
    expect(calls.map((call) => idsOf(call).length)).toEqual([200, 200, 50])
    expect(calls.flatMap(idsOf)).toEqual(ids)
  })

  it('a failed read throws, never an empty answer', async () => {
    answer = () => ({ data: null, error: { message: 'permission denied' } })
    await expect(readUsersRanks(['p1'])).rejects.toThrow("Could not load the users' rankings: permission denied")
  })
})
