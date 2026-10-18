/**
 * The Lists "Users" rank column's read (gap list §3 #9). Pinned:
 *  - it is the Rankings hub's own Users read — the same query (key, cache
 *    and request: `consensus_rankings` at one position, ordered by the
 *    position rank, ties broken by player id), one per position on the list;
 *  - its numbers are the hub's: a player's place in that order, so players
 *    the consensus ties are 1 and 2 on both screens, never 1 and 1;
 *  - it isn't ready until every position's read has landed (a cell stays
 *    blank, never "–"), and a failed read is an error, never an empty map
 *    that would read as "nobody ranked him".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}
const calls: Call[] = []
let answer: (call: Call) => { data: unknown; error: unknown; count?: number } = () => ({ data: [], error: null, count: 0 })

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

import { sourceRankMap, usersSourceQuery, type HubRow } from './use-mobile-rankings-sources'
import { useMobileListsUsersRanks, usersRankPositions, usersRanks } from './use-mobile-lists-users-ranks'

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)

const row = (id: string, position: string, weightedRank: number): HubRow => ({
  player: { id, full_name: `Player ${id}`, position, team: 'CIN', headshot_url: null, bye_week: 10 },
  score: -weightedRank,
})

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: [], error: null, count: 0 })
})

describe('usersRankPositions', () => {
  it('each position on the list once, in the hub’s chip order (DEF is DST)', () => {
    expect(usersRankPositions(['WR', 'DEF', 'WR', null, undefined, 'FB', 'QB'])).toEqual(['QB', 'WR', 'DST'])
    expect(usersRankPositions([])).toEqual([])
  })
})

describe('the read is the hub’s Users read', () => {
  it('the same query key and request: one position, by position rank, ties by player id', async () => {
    expect(usersSourceQuery('WR').queryKey).toEqual(['mobile-rankings', 'source', 'users', 'WR'])
    expect(usersSourceQuery('DST').queryKey).toEqual(['mobile-rankings', 'source', 'users', 'DEF'])
    answer = () => ({
      data: [
        { player_id: 'p1', weighted_rank: 1.5, player: row('p1', 'WR', 1.5).player },
        { player_id: 'p2', weighted_rank: 1.5, player: row('p2', 'WR', 1.5).player },
      ],
      error: null,
      count: 2,
    })
    const rows = await new QueryClient().fetchQuery(usersSourceQuery('WR'))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.table).toBe('consensus_rankings')
    expect(op(calls[0]!, 'in')).toEqual([['position', ['WR']]])
    expect(op(calls[0]!, 'order').map(([col]) => col)).toEqual(['consensus_position_rank', 'player_id'])
    expect(rows.map((r) => r.player.id)).toEqual(['p1', 'p2'])
  })

  it('a failed read throws, never an empty answer', async () => {
    answer = () => ({ data: null, error: { message: 'permission denied' } })
    await expect(new QueryClient().fetchQuery({ ...usersSourceQuery('WR'), retry: false })).rejects.toThrow(
      'permission denied',
    )
  })
})

describe('usersRanks', () => {
  it('numbers each player by his place in his position’s order, as the hub does', () => {
    // Two lists put Chase and Jefferson 1-2 and 2-1: both average 1.5, and
    // the view's RANK() would call both WR1. The hub shows #1 and #2.
    const wr = [row('chase', 'WR', 1.5), row('jefferson', 'WR', 1.5), row('lamb', 'WR', 3)]
    const rb = [row('bijan', 'RB', 1), row('gibbs', 'RB', 2)]
    const ranks = usersRanks([wr, rb, undefined])
    expect([...ranks]).toEqual([
      ['chase', 1],
      ['jefferson', 2],
      ['lamb', 3],
      ['bijan', 1],
      ['gibbs', 2],
    ])
    // Exactly the hub's numbering of each position.
    for (const [id, rank] of sourceRankMap(wr)) expect(ranks.get(id)).toBe(rank)
    for (const [id, rank] of sourceRankMap(rb)) expect(ranks.get(id)).toBe(rank)
  })
})

describe('useMobileListsUsersRanks', () => {
  /** The hook's result, rendered (the cache is seeded; nothing fetches). */
  function probe(qc: QueryClient, positions: string[], enabled = true) {
    function Probe() {
      const users = useMobileListsUsersRanks(positions, enabled)
      return createElement(
        'pre',
        null,
        JSON.stringify({
          isSuccess: users.isSuccess,
          isError: users.isError,
          data: users.data ? [...users.data] : null,
        }),
      )
    }
    const out = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)))
    return JSON.parse(out.replace(/^<pre>|<\/pre>$/g, '').replace(/&quot;/g, '"')) as {
      isSuccess: boolean
      isError: boolean
      data: Array<[string, number]> | null
    }
  }

  it('reads the hub’s cached Users rows for each position on the list', () => {
    const qc = new QueryClient()
    qc.setQueryData(usersSourceQuery('WR').queryKey, [row('chase', 'WR', 1.5), row('jefferson', 'WR', 1.5)])
    qc.setQueryData(usersSourceQuery('RB').queryKey, [row('bijan', 'RB', 1)])
    expect(probe(qc, ['WR', 'RB', 'WR'])).toEqual({
      isSuccess: true,
      isError: false,
      data: [
        ['bijan', 1],
        ['chase', 1],
        ['jefferson', 2],
      ],
    })
  })

  it('not ready until every position’s read has landed', () => {
    const qc = new QueryClient()
    qc.setQueryData(usersSourceQuery('WR').queryKey, [row('chase', 'WR', 1)])
    expect(probe(qc, ['WR', 'RB'])).toEqual({ isSuccess: false, isError: false, data: null })
  })

  it('a failed position read is an error, with no ranks', () => {
    // Kept failed on mount (no retry), as after a failed fetch.
    const qc = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } })
    qc.setQueryData(usersSourceQuery('WR').queryKey, [row('chase', 'WR', 1)])
    const failed = qc.getQueryCache().build(qc, { queryKey: usersSourceQuery('RB').queryKey })
    failed.setState({ status: 'error', error: new Error('permission denied'), fetchStatus: 'idle' })
    expect(probe(qc, ['WR', 'RB'])).toEqual({ isSuccess: false, isError: true, data: null })
  })
})
