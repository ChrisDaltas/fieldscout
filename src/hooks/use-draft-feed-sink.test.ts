/**
 * The bid feed's FETCH WINDOW — R401 (M3 batch 7, PR #171; D185).
 *
 * The hole, as the reviewer drove it: `useDraftRoom` invalidates the feed on
 * `SUBSCRIBED` (§9.3 fetch-first), which starts a refetch whose SELECT
 * snapshot is taken at T0; the `'draft_bids'` handler then did
 * `getQueryData → reduceBidEvent → setQueryData`. React Query REPLACES the
 * cache with the fetch result when it resolves, discarding every interim
 * `setQueryData` — so a bid landing in that window was lost, rows VOIDED in
 * that window (cancel / undo / reset) came back as zombies from the pre-void
 * snapshot, and after a reset the run-1 zombies merged with run-2's rows at
 * seq 1 until the next rejoin. The first fetch had the same shape (`if (!rows)
 * return` dropped events while it was in flight). No gap detector repairs
 * the feed, so D184(3)'s "the reset's one event empties a held cache" was
 * false in exactly that window.
 *
 * These pins drive a REAL `QueryClient` through `createFeedSink` with the
 * real bid reducer — no DOM, no React, no stack (the use-draft-mode.test.ts
 * posture): start a fetch, push an event mid-flight, resolve the fetch, and
 * assert the event SURVIVED. Against the pre-fix handler shape (apply
 * straight onto the cache) the window pins go RED — measured before the fix
 * landed and recorded in the PR (the §4.3 falsifiability floor); the first
 * pin below is the MECHANISM control that documents why.
 */

import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { draftBidKeys } from './use-draft-bids'
import { draftChatContext, draftChatKeys } from './use-draft-chat'
import {
  reduceChatEvent,
  type DraftChatBroadcast,
  type DraftChatRow,
} from './use-draft-chat-ops'
import {
  reduceBidEvent,
  type DraftBidBroadcast,
  type DraftBidRow,
} from './use-draft-bids-ops'
import { createFeedSink } from './use-draft-feed-sink'

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const DRAFT = '11111111-1111-4111-8111-111111111111'
const KEY = draftBidKeys.feed(DRAFT)
const T = (n: number) => `00000000-0000-4000-8000-00000000t${n}`

function bid(seq: number, player: string, team: number, amount: number, at: string): DraftBidRow {
  return {
    nomination_seq: seq,
    player_id: player,
    team_id: T(team),
    amount,
    created_at: at,
    voided_at: null,
  }
}

/** Run 1 as a client would hold it: seq 1 awarded (t1 $5 → t2 $7 → t1 $9),
 *  seq 2 live (t2 $3). */
function run1(): DraftBidRow[] {
  return [
    bid(1, 'pl-a', 1, 5, '2026-08-19T12:00:01.000Z'),
    bid(1, 'pl-a', 2, 7, '2026-08-19T12:00:02.000Z'),
    bid(1, 'pl-a', 1, 9, '2026-08-19T12:00:03.000Z'),
    bid(2, 'pl-b', 2, 3, '2026-08-19T12:01:00.000Z'),
  ]
}

const tag = (rows: readonly DraftBidRow[] | undefined) =>
  (rows ?? []).map((r) => `${r.nomination_seq}:${r.player_id}:${r.amount}`)

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let React Query's notifyManager deliver its batched cache notifications
 *  (it schedules them on a macrotask). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

function rig(seed?: DraftBidRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed) client.setQueryData(KEY, seed)
  const sink = createFeedSink<DraftBidRow, DraftBidBroadcast>(client, KEY, reduceBidEvent)
  /** Start a fetch whose result the test controls. */
  const startFetch = () => {
    const d = deferred<DraftBidRow[]>()
    const done = client.fetchQuery({ queryKey: KEY, queryFn: () => d.promise, staleTime: 0 })
    done.catch(() => undefined) // the error pin rejects it on purpose
    return { ...d, done }
  }
  const rows = () => client.getQueryData<readonly DraftBidRow[]>(KEY)
  return { client, sink, startFetch, rows }
}

const insert = (row: DraftBidRow): DraftBidBroadcast => ({ operation: 'INSERT', record: row })
const voidOf = (...pairs: Array<[number, string]>): DraftBidBroadcast => ({
  operation: 'UPDATE',
  record: {
    voided_at: '2026-08-19T12:02:00.000Z',
    voided_count: pairs.length,
    nominations: pairs.map(([nomination_seq, player_id]) => ({ nomination_seq, player_id })),
  },
})

// ---------------------------------------------------------------------------
// 0. The mechanism — why the window exists at all
// ---------------------------------------------------------------------------

describe('the mechanism (control): React Query discards a cache write made while a fetch is in flight', () => {
  it('setQueryData during a fetch is REPLACED by the fetch result on resolve', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, run1())
    const d = deferred<DraftBidRow[]>()
    const done = client.fetchQuery({ queryKey: KEY, queryFn: () => d.promise, staleTime: 0 })
    expect(client.getQueryState(KEY)?.fetchStatus).toBe('fetching')

    // The interim write a naive handler makes:
    client.setQueryData(KEY, [...run1(), bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')])
    expect(tag(client.getQueryData(KEY))).toContain('2:pl-b:4')

    d.resolve(run1()) // the snapshot, taken before the bid
    await done
    // …and it is gone. This is the hole; everything below is its closure.
    expect(tag(client.getQueryData(KEY))).not.toContain('2:pl-b:4')
  })
})

// ---------------------------------------------------------------------------
// 1. The window pins — R401's demand, RED against the pre-fix handler
// ---------------------------------------------------------------------------

describe('the fetch window (R401): an event that lands mid-fetch survives the resolve', () => {
  it('a bid INSERT pushed while the join refetch is in flight is in the cache after the fetch resolves', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))

    fetch.resolve(run1()) // snapshot taken before the bid committed
    await fetch.done
    await settle()
    expect(tag(rows())).toEqual(['1:pl-a:5', '1:pl-a:7', '1:pl-a:9', '2:pl-b:3', '2:pl-b:4'])
    expect(sink.held()).toBe(0)
  })

  it('…because the sink HOLDS the event while the fetch owns the cache, rather than writing under it', () => {
    const { sink, startFetch, rows } = rig(run1())
    startFetch()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    expect(sink.held()).toBe(1)
    expect(tag(rows())).not.toContain('2:pl-b:4')
  })

  it('the FIRST fetch has the same window: no cache yet, event mid-flight, survives', async () => {
    const { sink, startFetch, rows } = rig()
    expect(rows()).toBeUndefined()
    const fetch = startFetch()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))

    fetch.resolve(run1())
    await fetch.done
    await settle()
    expect(tag(rows())).toContain('2:pl-b:4')
    expect(sink.held()).toBe(0)
  })

  it('an INSERT the snapshot ALREADY contains replays inert (tuple dedupe — no double row)', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    const late = bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')
    sink.push(insert(late)) // committed just before T0; broadcast arrived after
    fetch.resolve([...run1(), late])
    await fetch.done
    await settle()
    expect(tag(rows()).filter((t) => t === '2:pl-b:4')).toHaveLength(1)
  })

  it('ZOMBIES: a void pushed mid-fetch is applied AFTER the pre-void snapshot resolves — the struck rows do not come back', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(voidOf([2, 'pl-b'])) // the cancel lands in the window

    fetch.resolve(run1()) // snapshot from before the stamp: seq 2 still live
    await fetch.done
    await settle()
    expect(tag(rows())).toEqual(['1:pl-a:5', '1:pl-a:7', '1:pl-a:9'])
    expect(sink.held()).toBe(0)
  })

  it('CROSS-RUN: a reset (void-all) then run 2 opening at seq 1, both mid-fetch, leave ONLY run 2 — no merge', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(voidOf([1, 'pl-a'], [2, 'pl-b'])) // the reset's one sweep event
    sink.push(insert(bid(1, 'pl-z', 4, 1, '2026-08-19T13:00:00.000Z'))) // run 2's opening

    fetch.resolve(run1()) // the pre-reset snapshot
    await fetch.done
    await settle()
    expect(tag(rows())).toEqual(['1:pl-z:1'])
    expect(sink.held()).toBe(0)
  })

  it('FIFO: a held VOID of (seq, P) never overtakes a later INSERT of the same (seq, P) (the D143 renomination)', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(voidOf([2, 'pl-b'])) // cancel, held
    fetch.resolve(run1())
    await fetch.done
    // The fetch has settled but the cache notification has not been
    // delivered yet (no `settle()`): an event arriving NOW must queue behind
    // the held void, not jump it.
    sink.push(insert(bid(2, 'pl-b', 2, 3, '2026-08-19T12:05:00.000Z'))) // renominated on resume
    await settle()
    expect(tag(rows())).toEqual(['1:pl-a:5', '1:pl-a:7', '1:pl-a:9', '2:pl-b:3'])
    expect(rows()?.find((r) => r.nomination_seq === 2)?.created_at).toBe('2026-08-19T12:05:00.000Z')
  })

  it('a fetch that ERRORS settles too: held events replay onto the rows the cache kept', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    fetch.reject(new Error('503'))
    await fetch.done.catch(() => undefined)
    await settle()
    expect(tag(rows())).toContain('2:pl-b:4')
    expect(sink.held()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Outside the window — the ordinary path, unchanged in behaviour
// ---------------------------------------------------------------------------

describe('outside a fetch', () => {
  it('an event is applied immediately (no queueing) when nothing is in flight', () => {
    const { sink, rows } = rig(run1())
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    expect(sink.held()).toBe(0)
    expect(tag(rows())).toContain('2:pl-b:4')
    sink.push(voidOf([2, 'pl-b']))
    expect(tag(rows())).toEqual(['1:pl-a:5', '1:pl-a:7', '1:pl-a:9'])
  })

  it('with no cache and no fetch in flight the event is dropped and no query is created (the mount-time fetch carries history)', () => {
    const { client, sink, rows } = rig()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    expect(sink.held()).toBe(0)
    expect(rows()).toBeUndefined()
    expect(client.getQueryCache().find({ queryKey: KEY })).toBeUndefined()
  })

  it("a reducer's doubt (refetch) starts a fetch through the live observer, and the events behind it queue until it resolves", async () => {
    const { client, sink, rows } = rig(run1())
    // The feed hook's observer — invalidateQueries only refetches ACTIVE
    // queries, which is what the mounted feed is.
    const fetches: Deferred<DraftBidRow[]>[] = []
    const observer = new QueryObserver(client, {
      queryKey: KEY,
      queryFn: () => {
        const d = deferred<DraftBidRow[]>()
        fetches.push(d)
        return d.promise
      },
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    expect(fetches).toHaveLength(0) // fresh seed, no fetch on mount

    sink.push({ operation: 'DELETE', record: {} }) // unknown operation ⇒ doubt ⇒ refetch
    expect(fetches).toHaveLength(1)
    expect(client.getQueryState(KEY)?.fetchStatus).toBe('fetching')

    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    fetches[0].resolve(run1())
    await settle()
    await settle()
    expect(tag(rows())).toContain('2:pl-b:4')
    expect(sink.held()).toBe(0)
    unsubscribe()
  })

  it('dispose() drops what is held and detaches — a later fetch settle applies nothing', async () => {
    const { sink, startFetch, rows } = rig(run1())
    const fetch = startFetch()
    sink.push(insert(bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z')))
    sink.dispose()
    expect(sink.held()).toBe(0)
    sink.push(insert(bid(2, 'pl-b', 3, 6, '2026-08-19T12:01:06.000Z'))) // inert after dispose
    fetch.resolve(run1())
    await fetch.done
    await settle()
    expect(tag(rows())).toEqual(['1:pl-a:5', '1:pl-a:7', '1:pl-a:9', '2:pl-b:3'])
  })
})

// ---------------------------------------------------------------------------
// 3. The spine routes the event THROUGH the sink — source pin
// ---------------------------------------------------------------------------

describe('use-draft.ts wires the bid feed through the sink, never straight onto the cache', () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft.ts'), 'utf8')
  /** The `draft_bids` handler body: from its `ch.on(` to the next `ch.on(`. */
  const start = source.indexOf("ch.on('broadcast', { event: 'draft_bids' }")
  const handler = source.slice(start, source.indexOf('ch.on(', start + 1))

  it('the handler exists and pushes into the sink', () => {
    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('bidSink.push({ operation: envelope.operation, record: envelope.record })')
  })

  it('the handler no longer reads or writes the feed cache itself (the pre-fix shape)', () => {
    expect(handler).not.toContain('getQueryData')
    expect(handler).not.toContain('setQueryData')
    expect(handler).not.toContain('reduceBidEvent(')
  })

  it('the sink is created over the feed key with the real reducer, and disposed with the channel', () => {
    expect(source).toContain('createFeedSink<DraftBidRow, DraftBidBroadcast>(')
    expect(source).toMatch(/createFeedSink<DraftBidRow, DraftBidBroadcast>\(\s*queryClient,\s*draftBidKeys\.feed\(draftId\),\s*reduceBidEvent,\s*\)/)
    expect(source).toContain('bidSink.dispose()')
  })
})

// ---------------------------------------------------------------------------
// 3a. F75 behaviour: a chat message landing mid-fetch survives the resolve
// ---------------------------------------------------------------------------

describe('the CHAT feed’s window, closed by the same sink (F75 — L.C3.1)', () => {
  const CHAT_KEY = draftChatKeys.room(DRAFT)
  const CONTEXT = draftChatContext(DRAFT)
  const msg = (id: string, message: string, at: string): DraftChatRow => ({
    id,
    user_id: T(1),
    message,
    context: CONTEXT,
    is_system: false,
    created_at: at,
  })

  it('a message broadcast during the join refetch is HELD and replayed onto the fetched rows', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(CHAT_KEY, [msg('m1', 'first', '2026-08-19T12:00:00.000Z')])
    const sink = createFeedSink<DraftChatRow, DraftChatBroadcast>(
      client,
      CHAT_KEY,
      (rows, event) => ({
        rows: reduceChatEvent(rows, event.record, CONTEXT),
        refetch: false,
      }),
    )
    const d = deferred<DraftChatRow[]>()
    const done = client.fetchQuery({ queryKey: CHAT_KEY, queryFn: () => d.promise, staleTime: 0 })
    // Mid-flight: the snapshot the server is answering with predates m2.
    sink.push({ record: msg('m2', 'landed mid-fetch', '2026-08-19T12:00:02.000Z') })
    expect(sink.held()).toBe(1)
    d.resolve([msg('m1', 'first', '2026-08-19T12:00:00.000Z')])
    return done.then(settle).then(() => {
      const rows = client.getQueryData<readonly DraftChatRow[]>(CHAT_KEY) ?? []
      // Pre-fix (a raw setQueryData) this read is ['m1'] — the message is
      // gone until the next confirmed rejoin. That is F75, exactly.
      expect(rows.map((r) => r.id)).toEqual(['m1', 'm2'])
      sink.dispose()
    })
  })

  it('a message the fetch ALREADY carries dedupes by id rather than doubling', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(CHAT_KEY, [])
    const sink = createFeedSink<DraftChatRow, DraftChatBroadcast>(
      client,
      CHAT_KEY,
      (rows, event) => ({
        rows: reduceChatEvent(rows, event.record, CONTEXT),
        refetch: false,
      }),
    )
    const d = deferred<DraftChatRow[]>()
    const done = client.fetchQuery({ queryKey: CHAT_KEY, queryFn: () => d.promise, staleTime: 0 })
    const late = msg('m3', 'in both', '2026-08-19T12:00:05.000Z')
    sink.push({ record: late })
    d.resolve([late])
    return done.then(settle).then(() => {
      expect((client.getQueryData<readonly DraftChatRow[]>(CHAT_KEY) ?? []).map((r) => r.id))
        .toEqual(['m3'])
      sink.dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 3b. F75: the CHAT feed rides the same sink (discharged in L.C3.1)
// ---------------------------------------------------------------------------

describe('use-draft.ts wires the chat feed through the sink too (F75 — the same fetch window)', () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft.ts'), 'utf8')
  const start = source.indexOf("ch.on('broadcast', { event: 'league_chat' }")
  const handler = source.slice(start, source.indexOf("ch.on('broadcast', { event: 'draft_bids' }"))

  it('the handler pushes into a chat sink instead of patching the cache directly', () => {
    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('chatSink.push({ record })')
    // The pre-fix shape, gone: a message landing during the join refetch was
    // discarded when that fetch resolved (the mechanism control above).
    expect(handler).not.toContain('getQueryData<readonly DraftChatRow[]>')
    expect(handler).not.toContain('setQueryData(key, next)')
    expect(handler).not.toContain('reduceChatEvent(')
  })

  it('the R271 league-detail invalidation still runs BEFORE the cache write', () => {
    // It must fire whether or not a chat cache exists — the Auto seat badge
    // depends on it, and the sink's no-cache arm drops the event.
    const invalidate = handler.indexOf('chatEventInvalidatesLeagueDetail(record)')
    const push = handler.indexOf('chatSink.push(')
    expect(invalidate).toBeGreaterThan(-1)
    expect(invalidate).toBeLessThan(push)
  })

  it('the sink is created over the chat key with the real reducer, and disposed with the channel', () => {
    expect(source).toContain('createFeedSink<DraftChatRow, DraftChatBroadcast>(')
    expect(source).toContain('draftChatKeys.room(draftId),')
    expect(source).toContain('reduceChatEvent(rows, event.record, draftChatContext(draftId))')
    expect(source).toContain('chatSink.dispose()')
  })
})

// ---------------------------------------------------------------------------
// 4. The feed's READ drains past the 1000-row cap honestly — R402 source pin
// ---------------------------------------------------------------------------

describe("use-draft-bids.ts reads through pageAll with an exact count and a unique final order key (R402)", () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft-bids.ts'), 'utf8')

  it('drains through pageAll, not a hand-rolled short-page stop', () => {
    expect(source).toContain("import { pageAll } from '@/lib/supabase/page-all'")
    expect(source).toContain('await pageAll<DraftBidRow>(')
    expect(source).not.toContain('DRAFT_BIDS_PAGE')
  })

  it("asks for count: 'exact' (the finish line) and ends the order in the UNIQUE id (stable page boundaries)", () => {
    expect(source).toContain(".select(DRAFT_BID_COLUMNS, { count: 'exact' })")
    const orders = [...source.matchAll(/\.order\('([a-z_]+)'/g)].map((m) => m[1])
    expect(orders).toEqual(['nomination_seq', 'amount', 'created_at', 'id'])
  })

  // R408 — a mock auction's draft_bids rows carry the REAL league's
  // league_id (083 RLS keys on it), so a league-scoped reader that does not
  // also filter draft_id sees another member's practice bids. The feed is
  // draft-scoped: `.eq('draft_id', …)` is the ONLY scope on the read, and no
  // league_id filter stands in for it.
  it('scopes the read by draft_id and never by league alone (R408 — practice bids carry the real league_id)', () => {
    expect(source).toContain(".eq('draft_id', draftId!)")
    expect(source).not.toMatch(/\.eq\('league_id'/)
  })
})
