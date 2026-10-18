'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { createBrowserClient } from '@/lib/supabase/client'

import { connectionAfterJoinFailure } from './use-draft-ops'
import {
  LEAGUE_CHANNEL_EVENTS,
  leagueChannelRegistryTopic,
  leagueChannelTopic,
  presenceUserIds,
  reopenDelayMs,
  shouldTrackPresence,
  type LeagueBroadcastEnvelope,
  type LeagueChannelEvent,
  type LeaguePresenceMeta,
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
 * **One channel per league topic, multiplexed — never one per consumer, and
 * never one per HOOK INSTANCE either (R769).** That is the D109(1) rule that
 * kept the draft room at a single socket while five surfaces fed off it.
 * The state that makes it true lives in the MODULE-LEVEL `leagueRooms`
 * registry below, not in the effect: one room per topic, refcounted over its
 * subscribers, fanning the one channel's events out to N handler maps. So a
 * caller that wants `transactions` and a caller that wants `matchups` really
 * are the same hook with different handler maps, and L.D4.1's
 * matchups/standings hooks compose onto this rather than opening a second
 * channel (PROGRESS **F233(a)**).
 *
 * **Why a per-instance channel was not merely wasteful but BROKEN.**
 * `createBrowserClient` is a browser singleton (`@supabase/ssr` caches it),
 * so `supabase.getChannels()` is shared by every hook instance, and
 * realtime-js hands back the EXISTING channel for a topic it already holds —
 * which is why the D109(9) stale-registry sweep exists at all. With the
 * sweep inside each instance's effect, the second mount would remove the
 * FIRST one's live channel; the first would see `CLOSED`, count a failed
 * join, refetch, and reopen in 1s — sweeping the second's channel on the way
 * — and the two would evict each other forever, two invalidations per cycle,
 * with `attempt` reset to 0 on every SUBSCRIBED so the backoff never grew
 * out of it. Refcounting is what removes the whole class: the sweep now runs
 * once per ROOM, and only a room with no subscribers is ever torn down.
 *
 * Doctrine, each line a §9.3 requirement (the draft spine's, applied):
 * - **Fetch → render → subscribe, and refetch on every confirmed (re)join.**
 *   `onJoin` fires on SUBSCRIBED — boot window and reconnect gap alike —
 *   because `realtime.send()` drops silently while the service boots
 *   (D109(9)), so no reader may depend on having received a broadcast. A
 *   subscriber that attaches to an ALREADY-live room gets the same call
 *   immediately: from its point of view this is its confirmed join, and its
 *   cache may predate the room.
 * - **Broadcasts are cache HINTS, never authority.** This hook hands the
 *   payload to the caller and does nothing with it itself; the in-season
 *   consumers refetch rather than patch, because D296's payloads are
 *   column-selected and cannot reconstruct a row.
 * - **Unknown events are inert** (the M2 forward-compat pattern) — a future
 *   trigger on this topic cannot make an old client misbehave. That holds by
 *   construction: only `LEAGUE_CHANNEL_EVENTS` members are bound, and each
 *   dispatch is an optional call into the caller's map, so an event with no
 *   handler does nothing. (R773 removed a re-check of the event name against
 *   the very constant it was drawn from — a guard that could not fail.)
 * - **Reconnect = refetch-first, then resubscribe**, with the capped
 *   backoff, and the last subscriber's release unsubscribes (connection
 *   leaks are the #1 quota killer).
 * - **Private channel** (`private: true`) — Broadcast-from-DB topics are
 *   private and 070's `realtime.messages` READ policy is
 *   `is_league_member(split_part(topic, ':', 2)::uuid)`, so a non-member's
 *   join is refused by the database, not by this code.
 *
 * **Presence rides the same channel (gap list §3 #25 — who's online
 * everywhere, not just in the draft room).** Every room joins with the
 * viewer's user id as its presence key and hears the topic's presence state
 * (`onPresence`); it TRACKS the viewer only while a subscriber asks for it
 * (`tracksPresence` — the session's one `PresenceHost`, never a league page
 * or a row) and the page is in front. No second `.channel(` and no new
 * policy: 070 already lets members track presence on `league:<id>` and read
 * it, and nobody else. The cost is honest: the host holds one room per
 * league you're in for the whole session, so a league page adds nothing
 * (it joins the room the host already holds), and a dot never opens one.
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

/** One consumer of a room. `handlers` is the caller's REF, read at dispatch
 *  time, so a re-rendered handler map never churns the socket. */
export interface LeagueRoomSubscriber {
  handlers: { current: LeagueChannelHandlers }
  onJoin?: () => void
  onDrop?: () => void
  onConnection?: (connection: LeagueChannelConnection) => void
  /** Who's here: the user ids tracked on the topic (the viewer's own
   *  included), on every presence sync. Emptied when the channel drops —
   *  a dead socket knows nothing, so it claims nobody. */
  onPresence?: (userIds: ReadonlySet<string>) => void
  /** Count the viewer as here while this subscriber holds the room (the
   *  session's presence host). A room tracks while ANY subscriber asks. */
  tracksPresence?: boolean
}

interface LeagueRoom {
  leagueId: string
  subscribers: Set<LeagueRoomSubscriber>
  channel: RealtimeChannel | null
  retryTimer: ReturnType<typeof setTimeout> | null
  attempt: number
  everSubscribed: boolean
  failedJoins: number
  connection: LeagueChannelConnection
  disposed: boolean
  /** The signed-in viewer — the presence key and the tracked meta. */
  userId: string | null
  /** The last presence sync's user ids (empty while not live). */
  online: ReadonlySet<string>
  /** Whether THIS channel currently tracks the viewer. */
  tracked: boolean
}

/** THE registry — one room per topic, for the whole tab. Module-level on
 *  purpose: the supabase browser client is a singleton, so the channel
 *  registry it owns is shared whether this file acknowledges it or not
 *  (R769). */
const leagueRooms = new Map<string, LeagueRoom>()

function setConnection(room: LeagueRoom, connection: LeagueChannelConnection) {
  room.connection = connection
  for (const subscriber of [...room.subscribers]) subscriber.onConnection?.(connection)
}

const NOBODY: ReadonlySet<string> = new Set()

function setOnline(room: LeagueRoom, online: ReadonlySet<string>) {
  room.online = online
  for (const subscriber of [...room.subscribers]) subscriber.onPresence?.(online)
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/** Track or untrack the viewer so the room matches `shouldTrackPresence`.
 *  Idempotent: it only sends when the answer changes. */
function syncTracking(room: LeagueRoom) {
  const channel = room.channel
  if (!channel || room.disposed) return
  const want = shouldTrackPresence({
    live: room.connection === 'live',
    userId: room.userId,
    wanted: [...room.subscribers].some((s) => s.tracksPresence === true),
    visible: pageVisible(),
  })
  if (want && !room.tracked && room.userId) {
    room.tracked = true
    void channel.track({ user_id: room.userId } satisfies LeaguePresenceMeta)
  } else if (!want && room.tracked) {
    room.tracked = false
    void channel.untrack()
  }
}

/** One listener for the whole tab: a page sent to the background stops
 *  counting as here in every room, and counts again when it comes back. */
let visibilityWired = false
function wireVisibility() {
  if (visibilityWired || typeof document === 'undefined') return
  visibilityWired = true
  document.addEventListener('visibilitychange', () => {
    for (const room of leagueRooms.values()) syncTracking(room)
  })
}

function scheduleReopen(room: LeagueRoom) {
  if (room.disposed || room.retryTimer) return
  const delay = reopenDelayMs(room.attempt)
  room.attempt += 1
  room.retryTimer = setTimeout(() => {
    room.retryTimer = null
    room.channel = null // open() sweeps the stale registry instance, awaited
    void open(room)
  }, delay)
}

async function open(room: LeagueRoom) {
  if (room.disposed) return
  const supabase = createBrowserClient()
  // One channel per topic per client (D109(9)): supabase-js hands back the
  // EXISTING registry instance for a topic it already holds — including one
  // mid-teardown from an unawaited removeChannel — and subscribing that
  // wedges the rejoin forever. Sweep, AWAITED, first. This runs once per
  // ROOM; per hook instance it was what made two consumers evict each other
  // (R769).
  for (const stale of supabase.getChannels()) {
    if (stale.topic === leagueChannelRegistryTopic(room.leagueId)) {
      await supabase.removeChannel(stale)
    }
  }
  if (room.disposed) return
  // Deterministic private-channel auth: pin the realtime token to the
  // current session before the join rather than racing the client's auth
  // listener (the draft-realtime posture).
  const { data } = await supabase.auth.getSession()
  if (room.disposed) return
  await supabase.realtime.setAuth(data.session?.access_token ?? null)
  if (room.disposed) return
  room.userId = data.session?.user?.id ?? null

  // Presence is keyed by the viewer, so two tabs are one person (§3 #25).
  const ch = supabase.channel(leagueChannelTopic(room.leagueId), {
    config: { private: true, presence: { key: room.userId ?? '' } },
  })
  room.channel = ch
  room.tracked = false

  // Every known event registered ONCE, here, on the ONE channel. Dispatch
  // reads each subscriber's ref, so an event no caller wants — including one
  // this build has a name for — is inert by construction.
  for (const event of LEAGUE_CHANNEL_EVENTS) {
    ch.on('broadcast', { event }, ({ payload }) => {
      const envelope = (payload ?? {}) as LeagueBroadcastEnvelope
      for (const subscriber of [...room.subscribers]) {
        subscriber.handlers.current[event]?.(envelope)
      }
    })
  }

  // Who's here — bound before the join, which is what turns Presence on.
  ch.on('presence', { event: 'sync' }, () => {
    if (room.disposed || ch !== room.channel) return
    setOnline(room, presenceUserIds(ch.presenceState()))
  })

  ch.subscribe((status) => {
    if (room.disposed || ch !== room.channel) return
    if (status === 'SUBSCRIBED') {
      room.attempt = 0
      room.everSubscribed = true
      room.failedJoins = 0
      setConnection(room, 'live')
      // §9.3: never depend on missed broadcasts — reconcile on EVERY
      // confirmed join (boot window + reconnect gap alike).
      for (const subscriber of [...room.subscribers]) subscriber.onJoin?.()
      // A (re)join is a new presence session: count the viewer again.
      syncTracking(room)
      return
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      room.failedJoins += 1
      setConnection(room, connectionAfterJoinFailure(room.everSubscribed, room.failedJoins))
      room.tracked = false
      if (room.online.size > 0) setOnline(room, NOBODY)
      for (const subscriber of [...room.subscribers]) subscriber.onDrop?.()
      scheduleReopen(room)
    }
  })
}

/**
 * Join the league's room, opening it if nobody holds it yet. Returns the
 * release function; the room is torn down when the LAST subscriber releases.
 *
 * Exported so the refcount is testable without a React tree
 * (`use-league-channel-room.test.ts`) and so a future context provider can
 * own the join without re-implementing it.
 */
export function joinLeagueRoom(
  leagueId: string,
  subscriber: LeagueRoomSubscriber,
): () => void {
  const topic = leagueChannelTopic(leagueId)
  let room = leagueRooms.get(topic)
  if (!room) {
    room = {
      leagueId,
      subscribers: new Set(),
      channel: null,
      retryTimer: null,
      attempt: 0,
      everSubscribed: false,
      failedJoins: 0,
      connection: 'connecting',
      disposed: false,
      userId: null,
      online: NOBODY,
      tracked: false,
    }
    leagueRooms.set(topic, room)
    room.subscribers.add(subscriber)
    subscriber.onConnection?.(room.connection)
    wireVisibility()
    void open(room)
  } else {
    room.subscribers.add(subscriber)
    // Seed the newcomer with the room's real state, and — if the room is
    // already joined — give it the confirmed-join reconcile the SUBSCRIBED
    // callback gave everyone else. Its own cache may predate this room.
    subscriber.onConnection?.(room.connection)
    if (room.connection === 'live') subscriber.onJoin?.()
    if (room.connection === 'live') subscriber.onPresence?.(room.online)
    syncTracking(room)
  }

  const held = room
  let released = false
  return () => {
    if (released) return
    released = true
    held.subscribers.delete(subscriber)
    // Somebody else still wants this topic — the channel STAYS. This is the
    // whole point of the refcount (R769). (If the one who asked to be
    // counted here left, stop counting.)
    if (held.subscribers.size > 0) return syncTracking(held)
    held.disposed = true
    if (held.retryTimer) clearTimeout(held.retryTimer)
    held.retryTimer = null
    leagueRooms.delete(leagueChannelTopic(held.leagueId))
    const channel = held.channel
    held.channel = null
    if (channel) {
      const supabase = createBrowserClient()
      void channel.unsubscribe().catch(() => undefined)
      void supabase.removeChannel(channel)
    }
  }
}

export function useLeagueChannel(
  leagueId: string | undefined,
  handlers: LeagueChannelHandlers,
  opts?: UseLeagueChannelOptions,
): { connection: LeagueChannelConnection } {
  const [connection, setConnectionState] = useState<LeagueChannelConnection>('connecting')

  // Handlers/callbacks live in refs so the subscribe effect depends ONLY on
  // the league id: a caller passing an inline handler map (every caller)
  // would otherwise leave and rejoin the room on every render.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const onJoinRef = useRef(opts?.onJoin)
  onJoinRef.current = opts?.onJoin
  const onDropRef = useRef(opts?.onDrop)
  onDropRef.current = opts?.onDrop

  useEffect(() => {
    if (!leagueId) return
    return joinLeagueRoom(leagueId, {
      handlers: handlersRef,
      onJoin: () => onJoinRef.current?.(),
      onDrop: () => onDropRef.current?.(),
      onConnection: setConnectionState,
    })
  }, [leagueId])

  return { connection }
}
