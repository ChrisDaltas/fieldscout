import { describe, expect, it } from 'vitest'

import { LeagueActionError, rateLimitRetryMs } from '@/lib/leagues/api/client-fetch'

import { oncePerError, QueueLane, rebaseQueueOrder } from './use-draft-queue-ops'

/**
 * The queue's write lane — L.F2.6 final review R1697 / R1698 / R1699
 * (PROGRESS D710). Stored literals; a hand-driven clock.
 */

function rig() {
  let now = 0
  let timers: Array<{ at: number; fn: () => void }> = []
  const sent: string[][] = []
  const lane = new QueueLane<{ queue: Array<{ player_id: string }> }>({
    postOrder: (players) => {
      sent.push(players)
      return new Promise((resolve) => {
        timers.push({ at: now + 100, fn: () => resolve({ queue: players.map((player_id) => ({ player_id })) }) })
      })
    },
    retryAfterMs: rateLimitRetryMs,
    now: () => now,
    setTimer: (fn, ms) => {
      timers.push({ at: now + ms, fn })
    },
  })
  async function advance(ms: number) {
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
  }
  return { lane, sent, advance }
}

describe('R1697 — a stale `confirmed` never rewrites an idle click', () => {
  it('confirmed [A,B,C], the cache [A,B]: Add D sends [A,B,D]; then a cache reorder [C,B,A] and Add D sends [C,B,A,D]', async () => {
    const { lane, sent, advance } = rig()
    lane.confirmed = ['A', 'B', 'C'] // stale: another tab / a refetch has moved on
    void lane.offer({ base: ['A', 'B'], next: ['A', 'B', 'D'] })
    await advance(5_000)
    lane.confirmed = ['A', 'B', 'C'] // stale again
    void lane.offer({ base: ['C', 'B', 'A'], next: ['C', 'B', 'A', 'D'] })
    await advance(5_000)
    expect(sent).toEqual([
      ['A', 'B', 'D'],
      ['C', 'B', 'A', 'D'],
    ])
  })

  it('…while a write that WAITED behind another still replays its change on the server’s answer', async () => {
    const { lane, sent, advance } = rig()
    void lane.offer({ base: [], next: ['A'] })
    void lane.run(async () => ({ queue: [{ player_id: 'L1' }, { player_id: 'L2' }] }))
    void lane.offer({ base: ['A'], next: ['A', 'B'] })
    await advance(10_000)
    expect(sent).toEqual([['A'], ['L1', 'L2', 'B']])
  })
})

describe('R1699 — the add branch also takes the click’s order for the players it kept', () => {
  it('a click that reordered AND added, over a server order that changed underneath', () => {
    // the click saw [a,b], made it [b,a,d]; the server meanwhile has [a,x,b]
    expect(rebaseQueueOrder({ base: ['a', 'b'], next: ['b', 'a', 'd'] }, ['a', 'x', 'b'])).toEqual(['b', 'x', 'a', 'd'])
    // a removal + an add, kept players reordered, a server-only player stays put
    expect(rebaseQueueOrder({ base: ['a', 'b', 'c'], next: ['c', 'a', 'e'] }, ['a', 'b', 'y', 'c'])).toEqual(['c', 'y', 'a', 'e'])
  })
})

describe('R1698 — told once per failed write', () => {
  it('the same error object is told once; another failure is told again', () => {
    const tell = oncePerError()
    const merged = new LeagueActionError(400, 'That player is already drafted.')
    expect([tell(merged), tell(merged), tell(merged)]).toEqual([true, false, false])
    expect(tell(new LeagueActionError(400, 'Another failure'))).toBe(true)
    expect(tell('a string error')).toBe(true)
  })
})
