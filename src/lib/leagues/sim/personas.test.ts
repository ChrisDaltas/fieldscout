/**
 * Persona-policy pins — L.B6.1 (the pure decision layer; the runner
 * performs the I/O). Stub rng streams make every branch a stored literal.
 */
import { describe, expect, it } from 'vitest'

import { decidePick, desiredQueue, type PickContext } from './personas'

/** Deterministic stub stream: yields the given values in order. */
function stubRng(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

const ctx: PickContext = {
  availableByAdp: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
  queue: ['q1', 'q2'],
}

describe('decidePick', () => {
  it('afk NEVER acts — its picks are the tick timeout path (D102)', () => {
    expect(decidePick('afk', ctx, stubRng([0]))).toEqual({ kind: 'timeout' })
  })

  it('adp-drafter picks near the top of the ADP list (seeded reach 0..2)', () => {
    expect(decidePick('adp-drafter', ctx, stubRng([0]))).toEqual({
      kind: 'pick',
      playerId: 'p1',
      doubleTap: false,
      strayPlayerId: null,
    })
    expect(decidePick('adp-drafter', ctx, stubRng([0.99]))).toEqual({
      kind: 'pick',
      playerId: 'p3',
      doubleTap: false,
      strayPlayerId: null,
    })
    // Reach clamps to the last available player.
    const short: PickContext = { availableByAdp: ['only'], queue: [] }
    expect(decidePick('adp-drafter', short, stubRng([0.99]))).toMatchObject({ playerId: 'only' })
  })

  it('queue-drafter picks its queue head; ADP fallback when the queue is dry', () => {
    expect(decidePick('queue-drafter', ctx, stubRng([0]))).toMatchObject({ playerId: 'q1' })
    expect(
      decidePick('queue-drafter', { ...ctx, queue: [] }, stubRng([0])),
    ).toMatchObject({ playerId: 'p1' })
  })

  it('chaos double-taps every pick; the stray is seeded (rng < 0.5 arm)', () => {
    // First draw (reach) = 0 → p1; second draw 0.2 < 0.5 → stray = next.
    expect(decidePick('chaos', ctx, stubRng([0, 0.2]))).toEqual({
      kind: 'pick',
      playerId: 'p1',
      doubleTap: true,
      strayPlayerId: 'p2',
    })
    // Second draw 0.9 ≥ 0.5 → no stray, still double-tapped.
    expect(decidePick('chaos', ctx, stubRng([0, 0.9]))).toEqual({
      kind: 'pick',
      playerId: 'p1',
      doubleTap: true,
      strayPlayerId: null,
    })
  })

  it('an exhausted pool times out (the engine owns the endgame)', () => {
    expect(decidePick('chaos', { availableByAdp: [], queue: [] }, stubRng([0]))).toEqual({
      kind: 'timeout',
    })
  })
})

describe('desiredQueue', () => {
  it('queue-drafter refreshes ONLY an empty queue (seeded start skip)', () => {
    expect(desiredQueue('queue-drafter', ctx, stubRng([0]))).toBeNull()
    expect(desiredQueue('queue-drafter', { ...ctx, queue: [] }, stubRng([0]))).toEqual({
      players: ['p1', 'p2', 'p3', 'p4', 'p5'],
      concurrentAlternate: null,
    })
    // Seeded skip: start 2 deep.
    expect(desiredQueue('queue-drafter', { ...ctx, queue: [] }, stubRng([0.99]))).toEqual({
      players: ['p3', 'p4', 'p5', 'p6', 'p7'],
      concurrentAlternate: null,
    })
  })

  it('chaos churns two DISJOINT orders every turn — the F54 double-tap', () => {
    const plan = desiredQueue('chaos', ctx, stubRng([0]))
    expect(plan).toEqual({
      players: ['p1', 'p2', 'p3', 'p4', 'p5'],
      // Disjoint alternate (next window, reversed): both INSERTs can land,
      // so an interleave shows as duplicate RANKS — the F54 signature —
      // rather than tripping the player unique (see personas.ts).
      concurrentAlternate: ['p7', 'p6'],
    })
  })

  it('adp-drafter and afk never touch the queue', () => {
    expect(desiredQueue('adp-drafter', ctx, stubRng([0]))).toBeNull()
    expect(desiredQueue('afk', ctx, stubRng([0]))).toBeNull()
  })
})
