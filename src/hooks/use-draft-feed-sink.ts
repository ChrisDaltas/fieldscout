import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

import type { DraftState } from './use-draft'
import {
  applyDraftRoomEvent,
  chatEventInvalidatesLeagueDetail,
  type DraftRoomBroadcast,
} from './use-draft-ops'
import { isChatRecord, type DraftChatBroadcast } from './use-draft-chat-ops'

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
  return createStateSink<readonly Row[], Event>(queryClient, queryKey, (rows, event) => {
    const result = reduce(rows, event)
    return { data: result.rows, refetch: result.refetch }
  })
}

/** {@link createStateSink}'s reducer result — the feed shape, over any cache. */
export interface StateReduceResult<Data> {
  /** Next cached value — the SAME reference when nothing was applied. */
  data: Data
  /** True ⇒ refetch the query (§9.3 doubt ⇒ refetch). */
  refetch: boolean
}

/**
 * The sink's mechanism over ANY cached value, not only a row feed — F560
 * (PROGRESS D472). The room-state query (`draftKeys.detail`: the drafts row +
 * its picks) carried the same fetch window R401 closed for the bid feed and
 * F75 for chat, and it was the one cache on the `draft:<id>` channel still
 * patched straight through `setQueryData`: a refetch in flight across an
 * award resolved with its PRE-award snapshot and REPLACED the patched state,
 * so the room rendered a lot the server had already sold until the next 5 s
 * heartbeat noticed the deadline gap (measured at the M6 gate: the
 * `auction-storm` award, manager room — a refused bid's refetch read the
 * held lot 7 ms before the award committed and landed after its broadcast).
 * `createFeedSink` is this with `Data = readonly Row[]`; the semantics above
 * (FIFO, drain only while the key is not in flight, drop with no cache, a
 * reducer's refetch queues what follows) are unchanged and shared.
 */
export function createStateSink<Data, Event>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  reduce: (data: Data, event: Event) => StateReduceResult<Data>,
  options: {
    /** R1452: may this event be held across a fetch and replayed onto its
     *  result? Default: every event. An event that may NOT is dropped the
     *  moment a fetch owns the cache, and the query is refetched ONCE after
     *  that fetch settles (the snapshot may or may not contain it — only the
     *  server can say). */
    replayable?: (event: Event) => boolean
  } = {},
): FeedSink<Event> {
  const hash = hashKey(queryKey)
  const queue: Event[] = []
  const replayable = options.replayable ?? (() => true)
  let draining = false
  let disposed = false
  /** A non-replayable event was dropped behind the current fetch. */
  let refetchOnSettle = false

  /** A fetch is in flight (or paused offline) for this key. `getQueryState`
   *  reads the query's CURRENT state synchronously — React Query dispatches
   *  `fetchStatus: 'fetching'` the moment a fetch starts, before the queryFn
   *  runs, so an invalidate issued one line earlier is already visible. */
  const inFlight = () => {
    const state = queryClient.getQueryState(queryKey)
    return state !== undefined && state.fetchStatus !== 'idle'
  }

  /** A fetch owns the cache: drop what cannot be replayed onto its result. */
  const dropUnreplayable = () => {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (!replayable(queue[i])) {
        queue.splice(i, 1)
        refetchOnSettle = true
      }
    }
  }

  /** At most ONE follow-up refetch per settle — and only when something was
   *  dropped, so a settle with nothing dropped never refetches (no loop). */
  const settle = () => {
    if (!refetchOnSettle || inFlight()) return
    refetchOnSettle = false
    void queryClient.invalidateQueries({ queryKey })
  }

  const drain = () => {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0 && !inFlight()) {
        const event = queue.shift() as Event
        const data = queryClient.getQueryData<Data>(queryKey)
        // No cache to patch (never fetched / gc'd): the mount-time fetch
        // carries the history.
        if (data === undefined) continue
        const result = reduce(data, event)
        if (result.data !== data) queryClient.setQueryData(queryKey, result.data)
        if (result.refetch) {
          // This fetch starts AFTER anything dropped so far, so its snapshot
          // already covers it — one refetch, not two.
          refetchOnSettle = false
          void queryClient.invalidateQueries({ queryKey })
        }
      }
      if (queue.length > 0) dropUnreplayable()
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
    // Not from inside a drain (a nested setQueryData event): the drain may
    // yet start a refetch that covers what was dropped.
    if (!disposed && !draining) settle()
  })

  return {
    push(event) {
      if (disposed) return
      queue.push(event)
      drain()
      if (inFlight()) dropUnreplayable()
    },
    held: () => queue.length,
    dispose() {
      disposed = true
      unsubscribe()
      queue.length = 0
      refetchOnSettle = false
    },
  }
}

// ---------------------------------------------------------------------------
// The ROOM STATE's sink and its route in (F560; PROGRESS D472)
// ---------------------------------------------------------------------------

/** The room-state sink `useDraftRoom` builds: {@link createStateSink} over the
 *  room query's key with the real room reducer.
 *
 *  ONLY `drafts` events are replayed onto a fetched snapshot — they carry a
 *  version (`updated_at`), and the reducer's `incoming < known` rule makes a
 *  replay the snapshot already contains a no-op. `draft_picks` events carry
 *  NO version and no row id (D109(2)), so a held pick event cannot tell
 *  whether the snapshot post-dates it: R1452 — a held INSERT(#5, P, live)
 *  replayed onto a snapshot that already shows #5 P undone added a ghost
 *  live row, and the held undo UPDATE then matched two rows. Treating "same
 *  (pick_number, player_id) already present" as applied instead would drop a
 *  genuine re-pick of P at #5 after its undo, so that was not taken. A pick
 *  event arriving while the room fetch is in flight is dropped and the room
 *  refetched once after the fetch settles; outside a fetch it applies at
 *  once, exactly as before. */
export function createRoomStateSink(
  queryClient: QueryClient,
  queryKey: QueryKey,
): FeedSink<DraftRoomBroadcast> {
  return createStateSink<DraftState, DraftRoomBroadcast>(
    queryClient,
    queryKey,
    (state, b) => {
      const result = applyDraftRoomEvent(state, b)
      return { data: result.state, refetch: result.refetch }
    },
    { replayable: (b) => b.event === 'drafts' },
  )
}

/**
 * `use-draft.ts`'s `drafts` / `draft_picks` route, as a callable (the R434
 * shape — so the wiring has a BEHAVIOURAL pin, not only source pins). With no
 * room state cached and no fetch in flight there is no baseline to patch ⇒
 * fetch one (§9.3; unchanged). Otherwise the event goes THROUGH THE SINK —
 * applied now, or held behind the in-flight fetch (the first one included)
 * and replayed onto its result. Never straight onto the cache: that was F560.
 */
export function applyRoomBroadcast(input: {
  queryClient: QueryClient
  queryKey: QueryKey
  sink: Pick<FeedSink<DraftRoomBroadcast>, 'push'>
  broadcast: DraftRoomBroadcast
  refetch: () => void
}): void {
  const { queryClient, queryKey } = input
  const cached = queryClient.getQueryData(queryKey)
  const fetching = (queryClient.getQueryState(queryKey)?.fetchStatus ?? 'idle') !== 'idle'
  if (cached === undefined && !fetching) {
    input.refetch()
    return
  }
  input.sink.push(input.broadcast)
}

// ---------------------------------------------------------------------------
// The chat broadcast's route INTO the sink (F75; review finding R434)
// ---------------------------------------------------------------------------

/**
 * `use-draft.ts`'s `league_chat` handler, as a callable — extracted so F75's
 * discharge has a BEHAVIOURAL pin and not only source pins (**R434**,
 * PROGRESS D192). The pre-fix shape wrote the broadcast straight onto
 * `getQueryData`/`setQueryData`; with the body inline in `use-draft.ts`,
 * restoring it reddened 2 of 24 in `use-draft-feed-sink.test.ts` — both of
 * them SOURCE pins — while every behavioural pin stayed green, because those
 * drove sinks they built themselves and never the wiring. Now they drive
 * this, and breaking the push below reddens them.
 *
 * There is no React and no Supabase client here, and deliberately no
 * QueryClient either: the R271 league-detail refresh arrives as a callback so
 * this module keeps the import graph it documents above. Two rules the shape
 * encodes:
 *
 *  - **R271 runs FIRST.** A SYSTEM post is the "a commissioner action landed"
 *    signal (D97 posts in-txn) and some of those change league-detail-fed
 *    renders that 072 broadcasts nowhere (the §16.5.4 Auto seat badge). It
 *    must fire whether or not a chat cache exists — so it cannot live behind
 *    the sink, which drops events with no cache.
 *  - **The message goes through the SINK, never onto the cache.** That is the
 *    whole of F75: a message landing while the chat query's join refetch is
 *    in flight is held and replayed onto the fetched rows.
 */
export function applyChatBroadcast(input: {
  /** The raw broadcast payload (`{ record }` — §9.2's envelope). */
  payload: unknown
  sink: Pick<FeedSink<DraftChatBroadcast>, 'push'>
  /** R271: refresh league detail. Called ONLY for a system post, and always
   *  before the sink push. */
  invalidateLeagueDetail: () => void
}): void {
  const record = ((input.payload ?? {}) as { record?: unknown }).record
  if (!isChatRecord(record)) return
  if (chatEventInvalidatesLeagueDetail(record)) input.invalidateLeagueDetail()
  input.sink.push({ record })
}
