/**
 * use-league-channel-room.test.ts — **R769's behavioural pin**: two consumers
 * of the same league share ONE `league:<id>` channel and do not evict each
 * other (M4 task L.D4.2; spec §9.3; PROGRESS D310(3), ledger **F233(a)**).
 *
 * This is not a source pin. `joinLeagueRoom` is a plain function over a
 * module-level registry, so the refcount is executable in node with the
 * supabase browser client mocked — which is the only way to falsify the
 * claim the spine's docblock makes ("a caller that wants `transactions` and
 * a caller that wants `matchups` are the SAME hook with different handler
 * maps"). The bug this file exists to catch, as the reviewer traced it:
 *
 *   B joins → B's `open()` sweeps A's live registry channel →
 *   `removeChannel(A)` → A's subscribe callback fires CLOSED → A counts a
 *   failed join, calls `onDrop` (an invalidate/refetch) and reopens in 1s →
 *   A's `open()` sweeps B's channel → forever, two invalidations per cycle,
 *   with `attempt` reset to 0 on every SUBSCRIBED so the backoff never grows
 *   out of it.
 *
 * The fake client reproduces the two facts that made that real: the browser
 * client is a **singleton** (`createBrowserClient()` returns the same object
 * every call — `@supabase/ssr` caches it), and `channel(topic)` returns the
 * EXISTING instance for a topic already held (realtime-js 2.101.1
 * `RealtimeClient.channel()`), which is why the D109(9) sweep exists at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeagueBroadcastEnvelope } from './use-league-channel-ops'

// ---------------------------------------------------------------------------
// The fake supabase browser client — a singleton with a channel registry.
// ---------------------------------------------------------------------------

type Status = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'

interface FakeChannel {
  topic: string
  /** The options the channel was created with (presence key, private). */
  opts: unknown
  bindings: Map<string, Array<(payload: { payload: unknown }) => void>>
  statusCallback: ((status: Status) => void) | null
  subscribed: boolean
  removed: boolean
  /** What this client tracks over Presence (null = not tracked). */
  tracked: unknown
  trackCalls: number
  untrackCalls: number
  /** The server's presence state, as the next `presenceState()` returns it. */
  presence: Record<string, Array<Record<string, unknown>>>
  on: (kind: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) => FakeChannel
  subscribe: (cb: (status: Status) => void) => FakeChannel
  unsubscribe: () => Promise<'ok'>
  track: (meta: unknown) => Promise<'ok'>
  untrack: () => Promise<'ok'>
  presenceState: () => Record<string, Array<Record<string, unknown>>>
}

const counters = { channelCalls: 0, removeCalls: 0, setAuthCalls: 0 }
let registry: FakeChannel[] = []
/** The signed-in user the fake session reports (null = no user on it). */
let sessionUserId: string | null = null

function makeChannel(topic: string, opts: unknown): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    opts,
    bindings: new Map(),
    statusCallback: null,
    subscribed: false,
    removed: false,
    tracked: null,
    trackCalls: 0,
    untrackCalls: 0,
    presence: {},
    on(_kind, filter, cb) {
      const list = channel.bindings.get(filter.event) ?? []
      list.push(cb)
      channel.bindings.set(filter.event, list)
      return channel
    },
    subscribe(cb) {
      channel.statusCallback = cb
      return channel
    },
    unsubscribe: async () => 'ok',
    track: async (meta) => {
      channel.trackCalls += 1
      channel.tracked = meta
      return 'ok'
    },
    untrack: async () => {
      channel.untrackCalls += 1
      channel.tracked = null
      return 'ok'
    },
    presenceState: () => channel.presence,
  }
  return channel
}

const fakeClient = {
  getChannels: () => [...registry],
  removeChannel: async (channel: FakeChannel) => {
    counters.removeCalls += 1
    channel.removed = true
    registry = registry.filter((held) => held !== channel)
    // realtime-js drives the status callback to CLOSED on removal — the
    // exact event that made the eviction loop self-sustaining.
    channel.statusCallback?.('CLOSED')
    return 'ok'
  },
  channel: (topic: string, opts?: unknown) => {
    counters.channelCalls += 1
    const existing = registry.find((held) => held.topic === `realtime:${topic}`)
    if (existing) return existing
    const created = makeChannel(topic, opts)
    registry.push(created)
    return created
  },
  auth: {
    getSession: async () => ({
      data: { session: { access_token: 'tok', user: sessionUserId ? { id: sessionUserId } : undefined } },
    }),
  },
  realtime: {
    setAuth: async () => {
      counters.setAuthCalls += 1
    },
  },
}

vi.mock('@/lib/supabase/client', () => ({
  // A SINGLETON, like `@supabase/ssr`'s cached browser client — every hook
  // instance shares one channel registry whether it wants to or not.
  createBrowserClient: () => fakeClient,
}))

// Imported after the mock is declared (vitest hoists `vi.mock`).
const { joinLeagueRoom } = await import('./use-league-channel')

const LEAGUE = '11111111-2222-4333-8444-555555555555'
const TOPIC = `realtime:league:${LEAGUE}`

interface Recorder {
  joins: number
  drops: number
  connections: string[]
  events: LeagueBroadcastEnvelope[]
  subscriber: {
    handlers: { current: Record<string, (payload: LeagueBroadcastEnvelope) => void> }
    onJoin: () => void
    onDrop: () => void
    onConnection: (connection: string) => void
  }
}

function recorder(event = 'transactions'): Recorder {
  const rec: Recorder = {
    joins: 0,
    drops: 0,
    connections: [],
    events: [],
    subscriber: {
      handlers: {
        current: {
          [event]: (payload: LeagueBroadcastEnvelope) => {
            rec.events.push(payload)
          },
        },
      },
      onJoin: () => {
        rec.joins += 1
      },
      onDrop: () => {
        rec.drops += 1
      },
      onConnection: (connection: string) => {
        rec.connections.push(connection)
      },
    },
  }
  return rec
}

/** The open path awaits getSession + setAuth, so let the microtasks drain. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function live() {
  const channel = registry.find((held) => held.topic === TOPIC)
  channel?.statusCallback?.('SUBSCRIBED')
}

beforeEach(() => {
  registry = []
  counters.channelCalls = 0
  counters.removeCalls = 0
  counters.setAuthCalls = 0
  sessionUserId = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the league room is refcounted per topic (R769)', () => {
  it('two consumers of the SAME league share ONE channel and do not evict each other', async () => {
    const a = recorder('transactions')
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    live()

    // The second consumer — the exact thing F233(a) tells L.D4.1 to do.
    const b = recorder('matchups')
    const releaseB = joinLeagueRoom(LEAGUE, b.subscriber as never)
    await settle()

    // THE FINDING: one channel, no removals, A never dropped.
    expect(counters.channelCalls).toBe(1)
    expect(counters.removeCalls).toBe(0)
    expect(registry).toHaveLength(1)
    expect(registry[0].removed).toBe(false)
    expect(a.drops).toBe(0)
    expect(b.drops).toBe(0)
    // A joined once (its SUBSCRIBED); B got the same reconcile on attach,
    // because its cache may predate the room.
    expect(a.joins).toBe(1)
    expect(b.joins).toBe(1)
    expect(b.connections).toEqual(['live'])

    releaseA()
    releaseB()
  })

  it('fans ONE channel out to N handler maps — each consumer gets only its own events', async () => {
    const a = recorder('transactions')
    const b = recorder('matchups')
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    const releaseB = joinLeagueRoom(LEAGUE, b.subscriber as never)
    await settle()
    live()

    const channel = registry[0]
    for (const cb of channel.bindings.get('transactions') ?? []) {
      cb({ payload: { operation: 'INSERT', record: { id: 'txn' } } })
    }
    for (const cb of channel.bindings.get('matchups') ?? []) {
      cb({ payload: { operation: 'UPDATE', record: { id: 'mup' } } })
    }

    expect(a.events).toEqual([{ operation: 'INSERT', record: { id: 'txn' } }])
    expect(b.events).toEqual([{ operation: 'UPDATE', record: { id: 'mup' } }])

    releaseA()
    releaseB()
  })

  it('every subscriber sees a confirmed (re)join and a drop — §9.3 recovery is not the first joiner\'s alone', async () => {
    const a = recorder()
    const b = recorder()
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    const releaseB = joinLeagueRoom(LEAGUE, b.subscriber as never)
    await settle()

    registry[0].statusCallback?.('SUBSCRIBED')
    expect(a.joins).toBe(1)
    expect(b.joins).toBe(1)

    vi.useFakeTimers()
    registry[0].statusCallback?.('CHANNEL_ERROR')
    expect(a.drops).toBe(1)
    expect(b.drops).toBe(1)
    expect(a.connections.at(-1)).toBe('reconnecting')
    expect(b.connections.at(-1)).toBe('reconnecting')

    releaseA()
    releaseB()
  })

  it('the channel survives ONE consumer unmounting and closes when the LAST one leaves', async () => {
    const a = recorder()
    const b = recorder()
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    const releaseB = joinLeagueRoom(LEAGUE, b.subscriber as never)
    await settle()
    live()

    releaseA()
    expect(registry).toHaveLength(1)
    expect(registry[0].removed).toBe(false)
    // B is still live and still receiving.
    for (const cb of registry[0].bindings.get('transactions') ?? []) {
      cb({ payload: { operation: 'INSERT' } })
    }
    expect(b.events).toHaveLength(1)
    expect(a.events).toHaveLength(0)

    releaseB()
    await settle()
    expect(registry).toHaveLength(0)
    expect(counters.removeCalls).toBe(1)
  })

  it('a release is idempotent — a double unmount cannot tear down a room somebody else re-opened', async () => {
    const a = recorder()
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    live()
    releaseA()
    await settle()

    const b = recorder()
    const releaseB = joinLeagueRoom(LEAGUE, b.subscriber as never)
    await settle()
    live()
    expect(registry).toHaveLength(1)

    releaseA() // the stale release fires again
    expect(registry).toHaveLength(1)
    expect(registry[0].removed).toBe(false)
    expect(b.joins).toBe(1)

    releaseB()
  })

  it('a DIFFERENT league is a different room — one topic each, neither sweeping the other', async () => {
    const other = '99999999-2222-4333-8444-555555555555'
    const a = recorder()
    const b = recorder()
    const releaseA = joinLeagueRoom(LEAGUE, a.subscriber as never)
    await settle()
    const releaseB = joinLeagueRoom(other, b.subscriber as never)
    await settle()

    expect(counters.channelCalls).toBe(2)
    expect(counters.removeCalls).toBe(0)
    expect(registry.map((held) => held.topic).sort()).toEqual(
      [`realtime:league:${LEAGUE}`, `realtime:league:${other}`].sort(),
    )

    releaseA()
    releaseB()
  })
})

// ---------------------------------------------------------------------------
// Who's online — Presence on the same room (gap list §3 #25)
// ---------------------------------------------------------------------------

/** A presence-aware subscriber: what the session's PresenceHost passes. */
function presenceRecorder(tracksPresence: boolean) {
  const seen: string[][] = []
  return {
    seen,
    subscriber: {
      handlers: { current: {} },
      tracksPresence,
      onPresence: (ids: ReadonlySet<string>) => {
        seen.push([...ids].sort())
      },
    },
  }
}

/** The server's presence sync: set the state, fire the bound handler. */
function sync(channel: FakeChannel, state: FakeChannel['presence']) {
  channel.presence = state
  for (const cb of channel.bindings.get('sync') ?? []) cb({ payload: undefined })
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, get: () => state })
  globalThis.document.dispatchEvent(new Event('visibilitychange'))
}

describe("who's online rides the league room (gap list §3 #25)", () => {
  beforeEach(() => {
    // A minimal document: the spine reads `visibilityState` and listens for
    // `visibilitychange` (node has no DOM).
    if (typeof globalThis.document === 'undefined') {
      const target = new EventTarget()
      Object.defineProperty(globalThis, 'document', { configurable: true, value: target })
    }
    setVisibility('visible')
  })

  it('keys presence by the signed-in viewer and tracks them once the host joins — still ONE channel', async () => {
    sessionUserId = 'u-me'
    const host = presenceRecorder(true)
    const page = recorder()
    const releaseHost = joinLeagueRoom(LEAGUE, host.subscriber as never)
    await settle()
    const releasePage = joinLeagueRoom(LEAGUE, page.subscriber as never)
    await settle()
    live()

    expect(counters.channelCalls).toBe(1)
    const channel = registry[0]
    expect(channel.opts).toEqual({ config: { private: true, presence: { key: 'u-me' } } })
    expect(channel.tracked).toEqual({ user_id: 'u-me' })
    expect(channel.trackCalls).toBe(1)

    releasePage()
    releaseHost()
  })

  it('a league page alone hears presence but never counts you as here', async () => {
    sessionUserId = 'u-me'
    const page = presenceRecorder(false)
    const release = joinLeagueRoom(LEAGUE, page.subscriber as never)
    await settle()
    live()
    expect(registry[0].trackCalls).toBe(0)
    sync(registry[0], { 'u-nina': [{ user_id: 'u-nina' }] })
    expect(page.seen.at(-1)).toEqual(['u-nina'])
    release()
  })

  it('hands every sync to every subscriber, and seeds a late joiner with who is here', async () => {
    sessionUserId = 'u-me'
    const host = presenceRecorder(true)
    const releaseHost = joinLeagueRoom(LEAGUE, host.subscriber as never)
    await settle()
    live()
    sync(registry[0], {
      'u-me': [{ user_id: 'u-me' }],
      'u-marcus': [{ user_id: 'u-marcus' }, { user_id: 'u-marcus' }],
    })
    expect(host.seen.at(-1)).toEqual(['u-marcus', 'u-me'])

    const late = presenceRecorder(false)
    const releaseLate = joinLeagueRoom(LEAGUE, late.subscriber as never)
    expect(late.seen).toEqual([['u-marcus', 'u-me']])
    expect(counters.channelCalls).toBe(1)

    releaseLate()
    releaseHost()
  })

  it('a dropped channel claims nobody, and the rejoin counts you again', async () => {
    sessionUserId = 'u-me'
    const host = presenceRecorder(true)
    const release = joinLeagueRoom(LEAGUE, host.subscriber as never)
    await settle()
    live()
    sync(registry[0], { 'u-nina': [{ user_id: 'u-nina' }] })

    vi.useFakeTimers()
    registry[0].statusCallback?.('CHANNEL_ERROR')
    expect(host.seen.at(-1)).toEqual([])

    // The reopen (1s backoff) sweeps the stale instance and joins afresh.
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    vi.useRealTimers()
    const reopened = registry.find((held) => held.topic === TOPIC && !held.removed)!
    reopened.statusCallback?.('SUBSCRIBED')
    expect(reopened.tracked).toEqual({ user_id: 'u-me' })

    release()
  })

  it('a tab sent to the background stops counting as here, and counts again in front', async () => {
    sessionUserId = 'u-me'
    const host = presenceRecorder(true)
    const release = joinLeagueRoom(LEAGUE, host.subscriber as never)
    await settle()
    live()
    const channel = registry[0]
    expect(channel.tracked).toEqual({ user_id: 'u-me' })

    setVisibility('hidden')
    expect(channel.tracked).toBeNull()
    expect(channel.untrackCalls).toBe(1)

    setVisibility('visible')
    expect(channel.tracked).toEqual({ user_id: 'u-me' })
    expect(channel.trackCalls).toBe(2)

    release()
  })

  it('stops counting you when the host leaves but a league page still holds the room', async () => {
    sessionUserId = 'u-me'
    const host = presenceRecorder(true)
    const page = recorder()
    const releaseHost = joinLeagueRoom(LEAGUE, host.subscriber as never)
    const releasePage = joinLeagueRoom(LEAGUE, page.subscriber as never)
    await settle()
    live()
    expect(registry[0].tracked).toEqual({ user_id: 'u-me' })

    releaseHost()
    expect(registry[0].removed).toBe(false)
    expect(registry[0].tracked).toBeNull()

    releasePage()
  })

  it('signed out (no user on the session) tracks nothing', async () => {
    const host = presenceRecorder(true)
    const release = joinLeagueRoom(LEAGUE, host.subscriber as never)
    await settle()
    live()
    expect(registry[0].trackCalls).toBe(0)
    release()
  })
})

describe('the room says when its channel is DOWN — the §24.3 fallback poll\'s gate (F758)', () => {
  it('raises degraded on CHANNEL_ERROR / TIMED_OUT / CLOSED, lowers it on SUBSCRIBED, and seeds a newcomer', async () => {
    const seen: boolean[] = []
    const a = recorder('matchups')
    const releaseA = joinLeagueRoom(LEAGUE, { ...a.subscriber, onDegraded: (d: boolean) => seen.push(d) } as never)
    await settle()
    expect(seen).toEqual([false]) // seeded on join: a booting room is not an outage
    live()
    expect(seen).toEqual([false]) // SUBSCRIBED on a healthy room changes nothing

    // A FIRST failure is already a down channel — no R263 threshold here.
    registry[0].statusCallback?.('CHANNEL_ERROR')
    expect(seen).toEqual([false, true])
    registry[0].statusCallback?.('TIMED_OUT')
    expect(seen).toEqual([false, true]) // still down: no churn

    // A newcomer attaching DURING the outage is told at once.
    const late: boolean[] = []
    const b = recorder('transactions')
    const releaseB = joinLeagueRoom(LEAGUE, { ...b.subscriber, onDegraded: (d: boolean) => late.push(d) } as never)
    expect(late).toEqual([true])

    // Back: every subscriber hears it, so every poll stops.
    registry[0].statusCallback?.('SUBSCRIBED')
    expect(seen).toEqual([false, true, false])
    expect(late).toEqual([true, false])

    releaseA()
    releaseB()
  })
})
