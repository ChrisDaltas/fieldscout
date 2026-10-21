/**
 * The realtime-degradation POLL — spec §24.3 ("realtime degradation (fall
 * back to 10s REST polling — clients already REST-first)"); PROGRESS
 * **F758** (filed at L.F2.9 / D641, build ruled by Chris 2026-10-21) and
 * **D690**.
 *
 * Everything decidable without React lives here (the house `-ops` split),
 * so the timer rules are node-testable with fake timers
 * (`use-realtime-fallback-poll.test.ts`); `use-realtime-fallback-poll.ts`
 * is the thin React wrapper every polling screen shares, so the cadence and
 * the stop/pause rules cannot drift between screens.
 *
 * The rules, each one Chris's (F758, 2026-10-21):
 * - **Only while THIS client's channel is down** — `degraded`, which the
 *   spines (`use-league-channel.ts`, `use-draft.ts`) raise on
 *   `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` and lower on `SUBSCRIBED`
 *   (`channelDegradedAfter` below). A connected client never polls: the
 *   room is the freshness mechanism (D298) and every confirmed (re)join
 *   already refetches (§9.3).
 * - **Every 10 s** while down (`REALTIME_FALLBACK_POLL_MS`). The first poll
 *   is one interval after the drop — the drop itself already refetched
 *   (every spine's `onDrop`, the reconnect doctrine's refetch-first).
 * - **Stops the moment the channel is SUBSCRIBED again** — the join's own
 *   refetch is the reconcile from there.
 * - **Never while the tab is hidden** (`document.visibilityState`): a tick
 *   that lands on a hidden tab is skipped, not queued. Coming back to the
 *   front while still down polls at once and restarts the cadence from
 *   there — the screen being looked at again is the moment it most needs to
 *   be current.
 * - **Loud failure:** a poll is an INVALIDATE of the screen's existing
 *   React Query reads (`invalidateForFallbackPoll`), so a failed poll is a
 *   failed refetch — the query keeps its last-good data and goes `isError`,
 *   which is exactly what every polled screen's existing `StaleDataBanner`
 *   (or the draft room's degraded banner) keys on. Never an empty result.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** §24.3's printed cadence. */
export const REALTIME_FALLBACK_POLL_MS = 10_000

/** The channel statuses realtime-js reports to a `subscribe` callback. */
export type RealtimeChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/**
 * Pure: is the channel down after this status? `SUBSCRIBED` is the only
 * thing that clears it; the three failures set it; anything else (a status
 * this build does not know) leaves the previous answer alone.
 */
export function channelDegradedAfter(status: string, previous: boolean): boolean {
  if (status === 'SUBSCRIBED') return false
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return true
  return previous
}

export interface FallbackPollerDeps {
  /** What one poll does — the screen's invalidations. */
  poll: () => void
  /** Whether the page is in front right now (`document.visibilityState`). */
  isVisible: () => boolean
  intervalMs?: number
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (id: ReturnType<typeof setInterval>) => void
}

export interface FallbackPoller {
  /** The channel's state changed: start (down) or stop (SUBSCRIBED). */
  setDegraded: (degraded: boolean) => void
  /** The page's visibility changed — call from a `visibilitychange` listener. */
  visibilityChanged: () => void
  /** Whether a cadence is armed (down and not disposed). */
  running: () => boolean
  dispose: () => void
}

/**
 * The poller, framework-free. The React hook owns one per mounted screen
 * hook; tests drive it directly under fake timers.
 */
export function createFallbackPoller(deps: FallbackPollerDeps): FallbackPoller {
  const intervalMs = deps.intervalMs ?? REALTIME_FALLBACK_POLL_MS
  const arm = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
  const disarm = deps.clearInterval ?? ((id: ReturnType<typeof setInterval>) => clearInterval(id))
  let timer: ReturnType<typeof setInterval> | null = null
  let degraded = false
  let disposed = false

  const tick = () => {
    if (disposed || !degraded) return
    if (!deps.isVisible()) return // hidden: skipped, never queued
    deps.poll()
  }
  const start = () => {
    if (timer !== null) disarm(timer)
    timer = arm(tick, intervalMs)
  }
  const stop = () => {
    if (timer !== null) disarm(timer)
    timer = null
  }

  return {
    setDegraded(next) {
      if (disposed || next === degraded) return
      degraded = next
      if (degraded) start()
      else stop()
    },
    visibilityChanged() {
      if (disposed || !degraded) return
      if (!deps.isVisible()) return
      // Back in front while still down: catch up now, cadence from here.
      deps.poll()
      start()
    },
    running: () => timer !== null,
    dispose() {
      disposed = true
      stop()
    },
  }
}

/**
 * One poll's invalidations. `cancelRefetch: false` is load-bearing for the
 * loud-failure rule: React Query's default CANCELS a refetch still in flight
 * and starts a new one, so a slow failing read (one retry, plus the
 * request) could be cancelled by the next tick forever and never reach
 * `isError` — the stale banner would never show. With `false` the tick
 * joins the fetch already running instead.
 */
export function invalidateForFallbackPoll(queryClient: QueryClient, keys: ReadonlyArray<QueryKey>): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })
  }
}
