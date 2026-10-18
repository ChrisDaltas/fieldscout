/**
 * Import a ranking's per-list player read (gap list §3 #5) is redone on
 * every open of the sheet. Driven through a REAL `QueryClient` with the
 * app's own 60s default `staleTime` (query-provider.tsx) and a
 * `QueryObserver` over the hook's options — no DOM, no React. Without the
 * hook's `staleTime: 0`, the reopen below reuses the first answer, and a
 * list that has since gained players still reads as empty (hidden).
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { importPlayersQueryOptions, type ImportListPlayer } from './use-mobile-lists-import-players'

interface ServerRow {
  id: string
  list_id: string
  player_id: string
  position: number
  tier: string | null
  player: { position: string | null }
}

const server: { rows: ServerRow[] } = { rows: [] }
const reads = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  // The chain the read builds; pageAll (below) answers it.
  createBrowserClient: () => {
    const chain: Record<string, () => unknown> = {}
    for (const name of ['from', 'select', 'in', 'order', 'range']) chain[name] = () => chain
    return chain
  },
}))
vi.mock('@/lib/supabase/page-all', () => ({
  pageAll: async () => {
    reads()
    return server.rows.map((row) => ({ ...row }))
  },
}))

const row = (list: string, player: string, position: number): ServerRow => ({
  id: `${list}-${player}`,
  list_id: list,
  player_id: player,
  position,
  tier: null,
  player: { position: 'RB' },
})

/** The app's client defaults (query-provider.tsx). */
const appClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 60 * 1000, refetchOnWindowFocus: false, retry: false } } })

type Observer = QueryObserver<
  Map<string, ImportListPlayer[]>,
  Error,
  Map<string, ImportListPlayer[]>,
  Map<string, ImportListPlayer[]>,
  ReturnType<typeof importPlayersQueryOptions>['queryKey']
>

const players = (observer: Observer, list: string) =>
  observer.getCurrentResult().data?.get(list)?.map((p) => p.player_id)

afterEach(() => {
  server.rows = []
  reads.mockClear()
})

describe('Import a ranking: the per-list player read', () => {
  it('is read again when the sheet reopens, within the app’s 60s window', async () => {
    const qc = appClient()
    server.rows = [row('a', 'p1', 1)]
    const observer = new QueryObserver(qc, importPlayersQueryOptions(['c', 'a'], true))
    const unsubscribe = observer.subscribe(() => {})

    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    expect(players(observer, 'a')).toEqual(['p1'])
    expect(players(observer, 'c')).toEqual([])
    expect(reads).toHaveBeenCalledTimes(1)

    // The sheet closes; list C gains a player elsewhere; the sheet reopens.
    observer.setOptions(importPlayersQueryOptions(['c', 'a'], false))
    server.rows = [row('a', 'p1', 1), row('c', 'p7', 1)]
    observer.setOptions(importPlayersQueryOptions(['c', 'a'], true))

    await vi.waitFor(() => expect(players(observer, 'c')).toEqual(['p7']))
    expect(reads).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('stays closed while the sheet is: no read', async () => {
    const qc = appClient()
    const observer = new QueryObserver(qc, importPlayersQueryOptions(['a'], false))
    const unsubscribe = observer.subscribe(() => {})
    await Promise.resolve()
    expect(reads).not.toHaveBeenCalled()
    unsubscribe()
  })
})
