import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * The feed SINK — the hook-side seam between a room-channel broadcast and a
 * feed query's React Query cache (M3 task L.C1.6; review finding **R401**,
 * M3 batch 7; spec §9.3's "broadcasts are cache hints, fetch-first on every
 * (re)join"; PROGRESS D185). Built for the auction bid feed
 * (`use-draft-bids.ts` + `use-draft-bids-ops.ts`); generic over the reducer
 * so the chat feed, which carries the same append-only window, can adopt it
 * (F75).
 *
 * WHY THIS EXISTS — THE FETCH WINDOW. `useDraftRoom` invalidates the feed on
 * every confirmed (re)join, and the feed query also refetches on its own
 * (mount, focus, a reducer's doubt ⇒ refetch). While that fetch is in flight
 * React Query keeps serving the OLD rows, and when the fetch resolves it
 * REPLACES the cache with the fetch result — every `setQueryData` made in
 * between is discarded (measured: the mechanism pin in
 * use-draft-feed-sink.test.ts). A handler that applies a broadcast straight
 * onto `getQueryData` therefore loses every event that lands between the
 * SELECT's snapshot and the resolve: a bid vanishes until the next rejoin; a
 * void (cancel / undo / reset) is UNDONE — the pre-void snapshot comes back
 * carrying rows the server has since stamped `voided_at` (zombies), and after
 * a reset those run-1 zombies merge with run 2's rows at the same seq. The
 * first fetch has the same shape (no cache yet ⇒ the event was simply
 * dropped). The bid feed has no gap detector (use-draft-bids.ts), so nothing
 * repaired it until another confirmed join. That is the hole R401 names in
 * D184(3)'s "the reset's one event empties a held cache" — true only when the
 * event is applied AFTER the data it post-dates, which this sink guarantees.
 *
 * WHAT IT DOES. Events are queued FIFO and DRAINED only while the feed's query
 * is NOT in flight (`fetchStatus === 'idle'`, or no query at all). A cache
 * subscription drains the queue the moment a fetch settles (success, error,
 * cancel) — against the rows the fetch produced, which are exactly what the
 * held events post-date. An INSERT the snapshot already contains is absorbed
 * by the reducer's tuple dedupe; a void the snapshot already reflects strikes
 * nothing. FIFO is load-bearing: an event arriving after the settle but
 * before the queue has drained must not overtake a held one — a held VOID of
 * (seq, P) applied AFTER a fresh INSERT of a D143 renomination of the same P
 * at the same seq would strike the live row.
 *
 * With no cache and no fetch in flight (the feed was never mounted, or was
 * gc'd) an event is dropped — the mount-time fetch carries the history (the
 * L.B3.3 chat precedent). A reducer's `refetch: true` starts a fetch, so the
 * events behind it queue and replay onto the refreshed rows. `dispose()`
 * detaches the cache subscription and drops anything held: the sink lives
 * exactly as long as the channel that feeds it, and every channel (re)open
 * ends in a confirmed-join refetch that reconciles whatever was dropped.
 *
 * No React, no Supabase client, no wall-clock read — only the QueryClient it
 * is handed, so the whole window is drivable from a node test.
 */

export interface FeedReduceResult<Row> {
  /** Next cached rows — the SAME reference when nothing was applied. */
  rows: readonly Row[]
  /** True ⇒ refetch the feed (§9.3 doubt ⇒ refetch). */
  refetch: boolean
}

export interface FeedSink<Event> {
  /** Feed one broadcast in: applied now, or held while a fetch is in flight
   *  and replayed in order once it settles. */
  push(event: Event): void
  /** Events currently held behind an in-flight fetch. */
  held(): number
  /** Detach the cache subscription and drop anything held. */
  dispose(): void
}

export function createFeedSink<Row, Event>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  reduce: (rows: readonly Row[], event: Event) => FeedReduceResult<Row>,
): FeedSink<Event> {
  const hash = hashKey(queryKey)
  const queue: Event[] = []
  let draining = false
  let disposed = false

  /** A fetch is in flight (or paused offline) for this key. `getQueryState`
   *  reads the query's CURRENT state synchronously — React Query dispatches
   *  `fetchStatus: 'fetching'` the moment a fetch starts, before the queryFn
   *  runs, so an invalidate issued one line earlier is already visible. */
  const inFlight = () => {
    const state = queryClient.getQueryState(queryKey)
    return state !== undefined && state.fetchStatus !== 'idle'
  }

  const drain = () => {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0 && !inFlight()) {
        const event = queue.shift() as Event
        const rows = queryClient.getQueryData<readonly Row[]>(queryKey)
        // No cache to patch (never fetched / gc'd): the mount-time fetch
        // carries the history.
        if (rows === undefined) continue
        const result = reduce(rows, event)
        if (result.rows !== rows) queryClient.setQueryData(queryKey, result.rows)
        if (result.refetch) void queryClient.invalidateQueries({ queryKey })
      }
    } finally {
      draining = false
    }
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    // Any state change on OUR query (a fetch settling, a cancel, a removal)
    // is a chance to drain — `drain` re-checks `inFlight` itself, so a
    // 'fetch' transition simply finds nothing drainable.
    if (event.query.queryHash !== hash) return
    if (queue.length > 0) drain()
  })

  return {
    push(event) {
      if (disposed) return
      queue.push(event)
      drain()
    },
    held: () => queue.length,
    dispose() {
      disposed = true
      unsubscribe()
      queue.length = 0
    },
  }
}
