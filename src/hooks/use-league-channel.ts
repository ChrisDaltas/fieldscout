'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { createBrowserClient } from '@/lib/supabase/client'

import { connectionAfterJoinFailure } from './use-draft-ops'
import {
  LEAGUE_CHANNEL_EVENTS,
  isLeagueChannelEvent,
  leagueChannelRegistryTopic,
  leagueChannelTopic,
  reopenDelayMs,
  type LeagueBroadcastEnvelope,
  type LeagueChannelEvent,
} from './use-league-channel-ops'

/**
 * THE `league:<id>` REALTIME SPINE — M4 task L.D4.2 (spec §9.2/§9.3;
 * PROGRESS D296/D298; tasks-M4 §4 rule 1's realtime doctrine).
 *
 * **This is the second `.channel(` in `src/`, and it is deliberate.** The
 * budget pin in `src/components/draft/single-room-tab.test.ts` says a second
 * hit "is a §9.3 budget event that needs its own review, whoever adds it" —
 * this is that event, reviewed with the PR that adds it (PROGRESS D310(3)).
 * The in-season surfaces need live freshness (D298 chose the broadcast lane
 * for matchups, standings, activity and lock state), the draft spine's topic
 * is `draft:<id>` and cannot carry it, and §9.3's budget is ≤ 3 channels per
 * socket — a league page holds ONE.
 *
 * **One channel per league topic, multiplexed — never one per consumer.**
 * That is the D109(1) rule that kept the draft room at a single socket while
 * five different surfaces fed off it. Every event in
 * `LEAGUE_CHANNEL_EVENTS` is registered here, once, and dispatched to
 * whichever handler the caller supplied; a caller that wants `transactions`
 * and a caller that wants `matchups` are the SAME hook with different
 * handler maps, so L.D4.1's matchups/standings hooks compose onto this
 * rather than opening a second channel (PROGRESS **F233(a)**).
 *
 * Doctrine, each line a §9.3 requirement (the draft spine's, applied):
 * - **Fetch → render → subscribe, and refetch on every confirmed (re)join.**
 *   `onJoin` fires on SUBSCRIBED — boot window and reconnect gap alike —
 *   because `realtime.send()` drops silently while the service boots
 *   (D109(9)), so no reader may depend on having received a broadcast.
 * - **Broadcasts are cache HINTS, never authority.** This hook hands the
 *   payload to the caller and does nothing with it itself; the in-season
 *   consumers refetch rather than patch, because D296's payloads are
 *   column-selected and cannot reconstruct a row.
 * - **Unknown events are inert** (the M2 forward-compat pattern) — a future
 *   trigger on this topic cannot make an old client misbehave.
 * - **Reconnect = refetch-first, then resubscribe**, with the capped
 *   backoff, and the effect cleanup unsubscribes on unmount (connection
 *   leaks are the #1 quota killer).
 * - **Private channel** (`private: true`) — Broadcast-from-DB topics are
 *   private and 070's `realtime.messages` READ policy is
 *   `is_league_member(split_part(topic, ':', 2)::uuid)`, so a non-member's
 *   join is refused by the database, not by this code.
 *
 * No Presence here: §16 gives the league page no presence surface, and
 * tracking one would cost a payload per member per page view for nothing.
 */

export type LeagueChannelConnection = 'connecting' | 'live' | 'reconnecting'

export type LeagueChannelHandlers = Partial<
  Record<LeagueChannelEvent, (payload: LeagueBroadcastEnvelope) => void>
>

export interface UseLeagueChannelOptions {
  /** Fired on every CONFIRMED (re)join — the missed-broadcast recovery.
   *  Consumers refetch here; §9.3 forbids depending on the events alone. */
  onJoin?: () => void
  /** Fired when a join FAILS — refetch-first before the resubscribe. */
  onDrop?: () => void
}

export function useLeagueChannel(
  leagueId: string | undefined,
  handlers: LeagueChannelHandlers,
  opts?: UseLeagueChannelOptions,
): { connection: LeagueChannelConnection } {
  const [connection, setConnection] = useState<LeagueChannelConnection>('connecting')

  // Handlers/callbacks live in refs so the subscribe effect depends ONLY on
  // the league id: a caller passing an inline handler map (every caller)
  // would otherwise tear the channel down and rebuild it on every render.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const onJoinRef = useRef(opts?.onJoin)
  onJoinRef.current = opts?.onJoin
  const onDropRef = useRef(opts?.onDrop)
  onDropRef.current = opts?.onDrop

  useEffect(() => {
    if (!leagueId) return
    const supabase = createBrowserClient()
    let disposed = false
    let channel: RealtimeChannel | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let everSubscribed = false
    let failedJoins = 0

    const scheduleReopen = () => {
      if (disposed || retryTimer) return
      const delay = reopenDelayMs(attempt)
      attempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        channel = null // open() sweeps the stale registry instance, awaited
        void open()
      }, delay)
    }

    const open = async () => {
      if (disposed) return
      // One channel per topic per client (D109(9)): supabase-js hands back
      // the EXISTING registry instance for a topic it already holds —
      // including one mid-teardown from an unawaited removeChannel — and
      // subscribing that wedges the rejoin forever. Sweep, AWAITED, first.
      for (const stale of supabase.getChannels()) {
        if (stale.topic === leagueChannelRegistryTopic(leagueId)) {
          await supabase.removeChannel(stale)
        }
      }
      if (disposed) return
      // Deterministic private-channel auth: pin the realtime token to the
      // current session before the join rather than racing the client's
      // auth listener (the draft-realtime posture).
      const { data } = await supabase.auth.getSession()
      if (disposed) return
      await supabase.realtime.setAuth(data.session?.access_token ?? null)
      if (disposed) return

      const ch = supabase.channel(leagueChannelTopic(leagueId), {
        config: { private: true },
      })
      channel = ch

      // Every known event registered ONCE, here. Dispatch reads the ref, so
      // an event with no handler — including one this build has a name for
      // but this caller does not want — is inert by construction.
      for (const event of LEAGUE_CHANNEL_EVENTS) {
        ch.on('broadcast', { event }, ({ payload }) => {
          if (!isLeagueChannelEvent(event)) return
          handlersRef.current[event]?.((payload ?? {}) as LeagueBroadcastEnvelope)
        })
      }

      ch.subscribe((status) => {
        if (disposed || ch !== channel) return
        if (status === 'SUBSCRIBED') {
          attempt = 0
          everSubscribed = true
          failedJoins = 0
          setConnection('live')
          // §9.3: never depend on missed broadcasts — reconcile on EVERY
          // confirmed join (boot window + reconnect gap alike).
          onJoinRef.current?.()
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          failedJoins += 1
          setConnection(connectionAfterJoinFailure(everSubscribed, failedJoins))
          onDropRef.current?.()
          scheduleReopen()
        }
      })
    }

    void open()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      const held = channel
      channel = null
      if (held) {
        void held.unsubscribe().catch(() => undefined)
        void supabase.removeChannel(held)
      }
    }
  }, [leagueId])

  return { connection }
}
