import { describe, expect, it } from 'vitest'

import { LeagueActionError, rateLimitRetryMs } from '@/lib/leagues/api/client-fetch'

import { mergeQueueIntents, rebaseQueueOrder, type QueueIntent } from '@/hooks/use-draft-queue-ops'

import { LatestValueSender, newPacer, QUEUE_SEND_MIN_GAP_MS, WRITE_TIMEOUT_MESSAGE } from './latest-value-sender'

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
      setTimer: (fn, ms) => {
        if (ms < 15_000) fn() // the gap runs at once; the 15 s write timeout never fires here
      },
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

// ---------------------------------------------------------------------------
// R1691 / R1693 / R1694 — the lane, the always-429, the shared pacer
// ---------------------------------------------------------------------------

/** A virtual clock + timers + a fake server answering after a delay. */
function clock() {
  let now = 0
  let timers: Array<{ at: number; fn: () => void }> = []
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn })
    },
    later<X>(ms: number, fn: () => X): Promise<X> {
      return new Promise((resolve, reject) => {
        timers.push({
          at: now + ms,
          fn: () => {
            try {
              resolve(fn())
            } catch (e) {
              reject(e)
            }
          },
        })
      })
    },
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        for (let i = 0; i < 5; i++) await Promise.resolve()
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (!next || next.at > end) break
        timers = timers.slice(1)
        now = next.at
        next.fn()
      }
      now = end
      for (let i = 0; i < 5; i++) await Promise.resolve()
    },
  }
}

describe('R1691 — the queue lane: Add, Queue-from-list, Add land in click order', () => {
  it('t=0 Add A, t=0.3 load a list, t=0.5 Add B → three writes in that order, and the final queue is the list plus B', async () => {
    const c = clock()
    const server = { order: [] as string[] }
    const log: string[] = []
    let confirmed: string[] | null = []
    const lane = new LatestValueSender<QueueIntent, string[]>({
      post: (intent) => {
        const players = rebaseQueueOrder(intent, confirmed)
        log.push(`${c.now()}:value:${players.join(',')}`)
        return c.later(200, () => {
          server.order = players
          confirmed = players
          return players
        })
      },
      merge: mergeQueueIntents,
      retryAfterMs: rateLimitRetryMs,
      now: c.now,
      setTimer: c.setTimer,
    })
    // t = 0: Add A (the click saw an empty queue)
    const a = lane.offer({ base: [], next: ['A'] })
    await c.advance(300)
    // t = 0.3: load a list (replace) — the server computes the order
    const load = lane.run(() => {
      log.push(`${c.now()}:op:list`)
      return c.later(200, () => {
        server.order = ['L1', 'L2', 'L3']
        confirmed = server.order
        return server.order
      })
    })
    await c.advance(200)
    // t = 0.5: Add B — the click saw the optimistic [A]; the list has not landed
    const b = lane.offer({ base: ['A'], next: ['A', 'B'] })
    await c.advance(5_000)
    expect(log).toEqual(['0:value:A', '1250:op:list', '2500:value:L1,L2,L3,B'])
    expect(server.order).toEqual(['L1', 'L2', 'L3', 'B'])
    await expect(a).resolves.toEqual(['A'])
    await expect(load).resolves.toEqual(['L1', 'L2', 'L3'])
    await expect(b).resolves.toEqual(['L1', 'L2', 'L3', 'B'])
    expect(lane.busy).toBe(false)
  })

  it('a value still waiting when the list is clicked goes out FIRST (never dropped behind the load)', async () => {
    const c = clock()
    const log: string[] = []
    const lane = new LatestValueSender<string[], string[]>({
      post: (v) => {
        log.push(`value:${v.join('')}`)
        return c.later(100, () => v)
      },
      retryAfterMs: rateLimitRetryMs,
      now: c.now,
      setTimer: c.setTimer,
    })
    void lane.offer(['a'])
    void lane.offer(['a', 'b']) // waits in the gap
    void lane.run(async () => {
      log.push('op')
      return null
    })
    void lane.offer(['a', 'b', 'c'])
    await c.advance(10_000)
    expect(log).toEqual(['value:a', 'value:ab', 'op', 'value:abc'])
  })

  it('rebaseQueueOrder: unchanged underneath → the click; an Add over a load → appended; a removal → removed; a reorder → its order, the rest after', () => {
    expect(rebaseQueueOrder({ base: ['a'], next: ['a', 'b'] }, ['a'])).toEqual(['a', 'b'])
    expect(rebaseQueueOrder({ base: ['a'], next: ['a', 'b'] }, null)).toEqual(['a', 'b'])
    expect(rebaseQueueOrder({ base: ['a'], next: ['a', 'b'] }, ['x', 'y'])).toEqual(['x', 'y', 'b'])
    expect(rebaseQueueOrder({ base: ['a', 'x'], next: ['a'] }, ['x', 'y', 'a'])).toEqual(['y', 'a'])
    expect(rebaseQueueOrder({ base: ['a', 'b'], next: ['b', 'a'] }, ['a', 'b', 'z'])).toEqual(['b', 'a', 'z'])
    expect(mergeQueueIntents({ base: ['0'], next: ['1'] }, { base: ['1'], next: ['2'] })).toEqual({ base: ['0'], next: ['2'] })
  })
})

describe('R1693 — a server that always answers 429', () => {
  it('re-sends 5 times after each Retry-After, then rejects with the plain refusal — never resolves as if saved', async () => {
    const c = clock()
    const starts: number[] = []
    const words = "You're making changes too fast. Wait 3 seconds and try again — nothing was changed."
    const lane = new LatestValueSender<string[], string[]>({
      post: () => {
        starts.push(c.now())
        return c.later(100, () => {
          throw new LeagueActionError(429, words, undefined, words, 3000)
        })
      },
      retryAfterMs: rateLimitRetryMs,
      now: c.now,
      setTimer: c.setTimer,
    })
    const settled = lane.offer(['a']).then(
      () => 'resolved',
      (e: Error) => e.message,
    )
    await c.advance(60_000)
    expect(await settled).toBe(words)
    expect(starts).toEqual([0, 3100, 6200, 9300, 12400, 15500])
    expect(lane.busy).toBe(false)
  })
})

describe('R1694 — the pacing is per SCOPE: two queues in one league share the gap', () => {
  it('own queue + a team the commissioner acts for, both hammered for 10 s: at most 8 writes in any 10 s, together', async () => {
    const c = clock()
    const pacer = newPacer()
    const starts: number[] = []
    const make = () =>
      new LatestValueSender<string[], string[]>({
        post: (v) => {
          starts.push(c.now())
          return c.later(150, () => v)
        },
        retryAfterMs: rateLimitRetryMs,
        pacer,
        now: c.now,
        setTimer: c.setTimer,
      })
    const own = make()
    const other = make()
    for (let i = 1; i <= 40; i++) {
      void (i % 2 ? own : other).offer([`p${i}`])
      await c.advance(250)
    }
    await c.advance(5_000)
    const maxIn10 = starts.reduce((best, t) => Math.max(best, starts.filter((x) => x >= t && x < t + 10_000).length), 0)
    expect(starts.length).toBeGreaterThan(8)
    expect(maxIn10).toBeLessThanOrEqual(8)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(QUEUE_SEND_MIN_GAP_MS)
  })
})

describe('R1700 — a write that never answers', () => {
  it('fails after 15 s in plain words, frees the lane, and the next change goes out', async () => {
    const c = clock()
    const starts: Array<[number, string]> = []
    let hang = true
    const lane = new LatestValueSender<string[], string[]>({
      post: (v) => {
        starts.push([c.now(), v.join('')])
        if (hang) {
          hang = false
          return new Promise<string[]>(() => {}) // never answers
        }
        return c.later(100, () => v)
      },
      retryAfterMs: rateLimitRetryMs,
      now: c.now,
      setTimer: c.setTimer,
    })
    const first = lane.offer(['a']).then(
      () => 'resolved',
      (e: Error) => e.message,
    )
    await c.advance(14_999)
    expect(lane.busy).toBe(true)
    await c.advance(1)
    expect(await first).toBe(WRITE_TIMEOUT_MESSAGE)
    expect(lane.busy).toBe(false)
    const second = lane.offer(['a', 'b'])
    await c.advance(2_000)
    await expect(second).resolves.toEqual(['a', 'b'])
    expect(starts).toEqual([
      [0, 'a'],
      [15_000, 'ab'],
    ])
  })
})
