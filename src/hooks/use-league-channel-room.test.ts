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
  bindings: Map<string, Array<(payload: { payload: unknown }) => void>>
  statusCallback: ((status: Status) => void) | null
  subscribed: boolean
  removed: boolean
  on: (kind: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) => FakeChannel
  subscribe: (cb: (status: Status) => void) => FakeChannel
  unsubscribe: () => Promise<'ok'>
}

const counters = { channelCalls: 0, removeCalls: 0, setAuthCalls: 0 }
let registry: FakeChannel[] = []

function makeChannel(topic: string): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    bindings: new Map(),
    statusCallback: null,
    subscribed: false,
    removed: false,
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
  channel: (topic: string) => {
    counters.channelCalls += 1
    const existing = registry.find((held) => held.topic === `realtime:${topic}`)
    if (existing) return existing
    const created = makeChannel(topic)
    registry.push(created)
    return created
  },
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
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
