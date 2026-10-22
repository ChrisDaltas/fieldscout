import { describe, expect, it } from 'vitest'

import { RealtimeConnection, decode, encode, isQuotaViolation, type PhoenixMessage } from './phoenix'
import type { SocketHandlers, Transport } from './transport'

/** A transport whose one socket is driven by the test. */
function fakeTransport() {
  const sent: PhoenixMessage[] = []
  let handlers: SocketHandlers | null = null
  let now = 1_000
  const t: Transport = {
    request: async () => ({ status: 200, body: '', error: null }),
    connect: (_url, h) => {
      handlers = h
      return { send: (d) => sent.push(JSON.parse(d) as PhoenixMessage), close: () => h.onClose(1000, '') }
    },
    nowMs: () => now,
    sleep: () => new Promise(() => undefined), // never resolves: no heartbeat / timeout fires in a test
    random: () => 0.5,
    metrics: { trend: () => undefined, count: () => undefined },
    log: () => undefined,
  }
  return {
    t,
    sent,
    serverSays: (m: Partial<PhoenixMessage>) => handlers!.onMessage(JSON.stringify({ ref: null, payload: {}, ...m })),
    open: () => handlers!.onOpen(),
    closeFromServer: (code: number, reason: string) => handlers!.onClose(code, reason),
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('Phoenix framing', () => {
  it('round-trips and rejects junk', () => {
    const m: PhoenixMessage = { topic: 'realtime:x', event: 'phx_join', payload: { a: 1 }, ref: '1', join_ref: '1' }
    expect(decode(encode(m))).toEqual(m)
    expect(decode('not json')).toBeNull()
    expect(decode('{"event":"x"}')).toBeNull()
  })

  it('classifies quota wording as a violation, and an ok reply never', () => {
    expect(isQuotaViolation({ topic: 't', event: 'system', payload: { message: 'ChannelRateLimitReached: Too many channels' }, ref: null })).toBe(true)
    expect(isQuotaViolation({ topic: 't', event: 'phx_reply', payload: { status: 'error', response: { reason: 'too_many_joins' } }, ref: '2' })).toBe(true)
    expect(isQuotaViolation({ topic: 't', event: 'phx_reply', payload: { status: 'ok', response: { note: 'quota' } }, ref: '2' })).toBe(false)
    expect(isQuotaViolation({ topic: 't', event: 'broadcast', payload: { event: 'too_many' }, ref: null })).toBe(false)
    expect(isQuotaViolation({ topic: 't', event: 'system', payload: { status: 'ok', message: 'Subscribed to PostgreSQL' }, ref: null })).toBe(false)
  })
})

describe('RealtimeConnection', () => {
  it("joins a PRIVATE channel with the member's token (the app's join) and resolves on the reply", async () => {
    const f = fakeTransport()
    const conn = new RealtimeConnection(f.t, 'ws://x')
    f.open()
    await conn.ready
    const joining = conn.join({ subtopic: 'draft:abc', accessToken: 'jwt-1', presenceKey: 'team-1' })
    const join = f.sent[0]!
    expect(join.topic).toBe('realtime:draft:abc')
    expect(join.event).toBe('phx_join')
    expect(join.payload).toMatchObject({ access_token: 'jwt-1', config: { private: true, presence: { key: 'team-1', enabled: true } } })
    f.advance(42)
    f.serverSays({ topic: 'realtime:draft:abc', event: 'phx_reply', ref: join.ref, payload: { status: 'ok', response: {} } })
    await expect(joining).resolves.toMatchObject({ ok: true, ms: 42 })
  })

  it('dispatches Broadcast-from-DB events with their inner event name and receipt time', async () => {
    const f = fakeTransport()
    const conn = new RealtimeConnection(f.t, 'ws://x')
    f.open()
    await conn.ready
    const got: Array<{ event: string; at: number; record: unknown }> = []
    conn.onBroadcast((e) => got.push({ event: e.event, at: e.receivedAtMs, record: e.payload.record }))
    f.serverSays({ topic: 'realtime:draft:abc', event: 'broadcast', payload: { type: 'broadcast', event: 'draft_picks', payload: { operation: 'INSERT', record: { pick_number: 3 } } } })
    expect(got).toEqual([{ event: 'draft_picks', at: 1_000, record: { pick_number: 3 } }])
  })

  it('counts quota violations and an unexpected server close; our own close is expected', async () => {
    const f = fakeTransport()
    const conn = new RealtimeConnection(f.t, 'ws://x')
    f.open()
    await conn.ready
    f.serverSays({ topic: 'phoenix', event: 'system', payload: { message: 'too many connections' } })
    f.closeFromServer(4000, 'ConnectionRateLimitReached')
    expect(conn.quotaViolations).toBe(2)
    expect(conn.unexpectedClose).toEqual({ code: 4000, reason: 'ConnectionRateLimitReached' })

    const g = fakeTransport()
    const mine = new RealtimeConnection(g.t, 'ws://x')
    g.open()
    await mine.ready
    mine.close()
    expect(mine.unexpectedClose).toBeNull()
  })
})
