/**
 * The league Players tab's browse window read (gap list §4 item 13): a typed
 * name is searched SERVER-side over the whole active pool, with the
 * position / NFL-team filters and the window cap — never a client filter
 * over the 300 rows a browse loaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POOL_WINDOW } from '@/hooks/use-draft-pool'
import { playerNameFilter } from '@/lib/players/name-search'

/** Every builder call the read makes, in order; the awaited answer. */
const read = vi.hoisted(() => ({
  table: null as string | null,
  calls: [] as Array<[string, unknown[]]>,
  answer: { data: [] as unknown[] | null, error: null as { message: string } | null },
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => {
      read.table = table
      const builder: Record<string, unknown> = {}
      for (const name of ['select', 'not', 'eq', 'in', 'or', 'order', 'limit']) {
        builder[name] = (...args: unknown[]) => {
          read.calls.push([name, args])
          return builder
        }
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(read.answer).then(resolve, reject)
      return builder
    },
  }),
}))

import { fetchPlayersWindow, windowAtCap } from './use-mobile-players-data'

const named = (name: string) => read.calls.filter(([n]) => n === name).map(([, args]) => args)

beforeEach(() => {
  read.table = null
  read.calls = []
  read.answer = { data: [], error: null }
})

describe('fetchPlayersWindow', () => {
  it('a typed name narrows the players read on the server, with the position, team and cap', async () => {
    await fetchPlayersWindow(['RB', 'WR', 'TE'], 'KC', 'aj brown')
    expect(read.table).toBe('players')
    expect(named('or')).toEqual([[playerNameFilter('aj brown')]])
    expect(named('not')).toEqual([['team', 'is', null]])
    expect(named('in')).toEqual([['position', ['RB', 'WR', 'TE']]])
    expect(named('eq')).toEqual([['team', 'KC']])
    expect(named('limit')).toEqual([[POOL_WINDOW]])
    // ADP order, then name, then id — a stable page.
    expect(named('order').map((args) => args[0])).toEqual(['adp', 'full_name', 'id'])
  })

  it('one position is an eq; no search adds no name filter', async () => {
    await fetchPlayersWindow(['QB'], null, '')
    expect(named('or')).toEqual([])
    expect(named('eq')).toEqual([['position', 'QB']])
    expect(named('in')).toEqual([])
    expect(named('limit')).toEqual([[POOL_WINDOW]])
  })

  it('returns the rows; a failed read throws (never an empty list)', async () => {
    read.answer = { data: [{ id: 'p1' }], error: null }
    await expect(fetchPlayersWindow(null, null, 'x')).resolves.toEqual([{ id: 'p1' }])
    read.answer = { data: null, error: { message: 'boom' } }
    await expect(fetchPlayersWindow(null, null, 'x')).rejects.toEqual({ message: 'boom' })
  })
})

describe('windowAtCap', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i)
  it('is this key’s own answer at the cap — never a placeholder’s', () => {
    expect(windowAtCap(rows(POOL_WINDOW), false)).toBe(true)
    expect(windowAtCap(rows(POOL_WINDOW - 1), false)).toBe(false)
    expect(windowAtCap(undefined, false)).toBe(false)
    // The browse's full window kept while a search reads says nothing yet.
    expect(windowAtCap(rows(POOL_WINDOW), true)).toBe(false)
  })
})
