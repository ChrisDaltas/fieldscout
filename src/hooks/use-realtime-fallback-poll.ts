'use client'

import { useEffect, useRef } from 'react'

import { createFallbackPoller } from './use-realtime-fallback-poll-ops'

/**
 * THE realtime-degradation poll (spec §24.3; PROGRESS F758 / D690) — the one
 * hook every polling surface uses, so the 10 s cadence, the stop-on-
 * SUBSCRIBED rule and the hidden-tab pause cannot drift between screens.
 * The rules and why each holds are in `use-realtime-fallback-poll-ops.ts`.
 *
 * `degraded` is the spine's own flag (the league room's `degraded`, the
 * draft room's), never inferred here. `poll` is read from a ref, so an
 * inline function never re-arms the timer.
 *
 * Where it runs (F758, Chris 2026-10-21 — nothing else): the draft room
 * (`useDraftRoom`), and the live scoring screens through the live hooks'
 * `fallbackPoll` option — League Home's scoreboard, Matchup and My Team, and
 * their phone equivalents.
 */
export function useRealtimeFallbackPoll(degraded: boolean, poll: () => void): void {
  const pollRef = useRef(poll)
  pollRef.current = poll

  useEffect(() => {
    if (!degraded || typeof document === 'undefined') return
    const poller = createFallbackPoller({
      poll: () => pollRef.current(),
      isVisible: () => document.visibilityState !== 'hidden',
    })
    poller.setDegraded(true)
    const onVisibility = () => poller.visibilityChanged()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      poller.dispose()
    }
  }, [degraded])
}
