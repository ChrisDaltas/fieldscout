import { describe, expect, it } from 'vitest'

import { LeagueActionError, rateLimitRetryMs } from '@/lib/leagues/api/client-fetch'

import { LatestValueSender, QUEUE_SEND_MIN_GAP_MS } from './latest-value-sender'

/**
 * L.F2.6 review R1685 (D707): a fast queue builder never meets the
 * 10-per-10-s limit and never spends his pick's share; the final order lands.
 * A hand-driven clock: `advance(ms)` runs due timers in order, and each
 * `post` answers after `rttMs` of virtual time.
 */
function harness(opts: { rttMs?: number; refuse?: (n: number, value: string[]) => number | null } = {}) {
  let now = 0
  let timers: Array<{ at: number; fn: () => void }> = []
  const writes: Array<{ at: number; value: string[] }> = []
  const server: { order: string[] } = { order: [] }
  const rtt = opts.rttMs ?? 200

  const sender = new LatestValueSender<string[], string[]>({
    post: (value) => {
      writes.push({ at: now, value })
      const n = writes.length
      return new Promise((resolve, reject) => {
        timers.push({
          at: now + rtt,
          fn: () => {
            const wait = opts.refuse?.(n, value) ?? null
            if (wait !== null) {
              reject(new LeagueActionError(429, 'slow down', undefined, 'slow down', wait))
              return
            }
            server.order = value
            resolve(value)
          },
        })
      })
    },
    retryAfterMs: rateLimitRetryMs,
    now: () => now,
    setTimer: (fn, ms) => timers.push({ at: now + ms, fn }),
  })

  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      await Promise.resolve()
      await Promise.resolve()
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers = timers.slice(1)
      now = next.at
      next.fn()
      await Promise.resolve()
    }
    now = end
    await Promise.resolve()
  }

  /** The most writes that started inside any 10 s window (§22.5's sliding window). */
  function maxInWindow(windowMs = 10_000) {
    return writes.reduce((best, w) => Math.max(best, writes.filter((x) => x.at >= w.at && x.at < w.at + windowMs).length), 0)
  }

  return { sender, writes, server, advance, maxInWindow, get now() { return now } }
}

describe('LatestValueSender — the draft queue under a burst', () => {
  it('30 rapid adds at once: 2 writes, the final order lands, every add settles with it', async () => {
    const h = harness()
    const order: string[] = []
    const settled: Array<Promise<string[]>> = []
    for (let i = 1; i <= 30; i++) {
      order.push(`p${i}`)
      settled.push(h.sender.offer([...order]))
    }
    await h.advance(5_000)
    expect(h.writes.map((w) => w.value.length)).toEqual([1, 30])
    expect(h.server.order).toEqual(order)
    const results = await Promise.all(settled)
    expect(results[0]).toEqual(['p1'])
    expect(results.slice(1).every((r) => r.length === 30)).toBe(true)
    expect(h.sender.busy).toBe(false)
  })

  it('30 adds spread over 10 s (one every 333 ms): at most 8 writes in any 10 s, never 10; the final order lands', async () => {
    const h = harness()
    const order: string[] = []
    const settled: Array<Promise<string[]>> = []
    for (let i = 1; i <= 30; i++) {
      order.push(`p${i}`)
      settled.push(h.sender.offer([...order]))
      await h.advance(333)
    }
    await h.advance(5_000)
    expect(h.maxInWindow()).toBeLessThanOrEqual(Math.ceil(10_000 / QUEUE_SEND_MIN_GAP_MS))
    expect(h.maxInWindow()).toBeLessThanOrEqual(8)
    expect(h.writes.length).toBeLessThan(30)
    // golden: 9 writes, 1.25 s apart — 8 in any 10 s window, 2 of the 10 left for picks
    expect(h.writes.map((w) => w.at)).toEqual([0, 1250, 2500, 3750, 5000, 6250, 7500, 8750, 10000])
    expect(h.maxInWindow()).toBe(8)
    expect(h.server.order).toEqual(order)
    await Promise.all(settled)
    // consecutive writes are at least the gap apart, one in flight at a time
    for (let i = 1; i < h.writes.length; i++) {
      expect(h.writes[i].at - h.writes[i - 1].at).toBeGreaterThanOrEqual(QUEUE_SEND_MIN_GAP_MS)
    }
  })

  it('a slow server: still one write in flight, the gap measured from each start', async () => {
    const h = harness({ rttMs: 3_000 })
    h.sender.offer(['a'])
    await h.advance(100)
    h.sender.offer(['a', 'b'])
    h.sender.offer(['a', 'b', 'c'])
    await h.advance(10_000)
    expect(h.writes.map((w) => [w.at, w.value.join('')])).toEqual([
      [0, 'a'],
      [3_000, 'abc'],
    ])
  })

  it('a 429 is re-sent after Retry-After with the NEWEST order — nothing dropped, nothing stale', async () => {
    const h = harness({ refuse: (n) => (n === 2 ? 2_000 : null) })
    const first = h.sender.offer(['a'])
    await h.advance(1_500)
    const second = h.sender.offer(['a', 'b'])
    await h.advance(500) // write 2 starts and is refused
    const third = h.sender.offer(['a', 'b', 'c']) // arrives during the wait
    await h.advance(10_000)
    expect(h.writes.map((w) => w.value.join(''))).toEqual(['a', 'ab', 'abc'])
    expect(h.server.order).toEqual(['a', 'b', 'c'])
    await expect(first).resolves.toEqual(['a'])
    await expect(second).resolves.toEqual(['a', 'b', 'c'])
    await expect(third).resolves.toEqual(['a', 'b', 'c'])
  })

  it('a real failure rejects the writes it carried, and the sender keeps going', async () => {
    let fail = true
    const h = harness()
    const s = new LatestValueSender<string[], string[]>({
      post: async (v) => {
        if (fail) {
          fail = false
          throw new LeagueActionError(400, 'nope')
        }
        return v
      },
      retryAfterMs: rateLimitRetryMs,
      now: () => h.now,
      setTimer: (fn) => fn(),
      minGapMs: 0,
    })
    await expect(s.offer(['x'])).rejects.toThrow('nope')
    await expect(s.offer(['y'])).resolves.toEqual(['y'])
  })

  it('rateLimitRetryMs reads only a 429', () => {
    expect(rateLimitRetryMs(new LeagueActionError(429, 'x', undefined, 'x', 3000))).toBe(3000)
    expect(rateLimitRetryMs(new LeagueActionError(429, 'x'))).toBe(1000)
    expect(rateLimitRetryMs(new LeagueActionError(400, 'x'))).toBeNull()
    expect(rateLimitRetryMs(new Error('x'))).toBeNull()
  })
})
