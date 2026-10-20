import { describe, expect, it } from 'vitest'

import { allPass } from '../lib/checks'
import { BROADCAST_WAIT_MS, snakeAsserts } from './snake-draft'

const clean = { unfinished: [], duplicatePlayers: 0, duplicatePickNumbers: 0, picks: 20 }

describe('snakeAsserts — R1642: a missing broadcast fails the run', () => {
  it('all fast and none missing is green', () => {
    expect(allPass(snakeAsserts(Array(20).fill(20), clean, 0))).toBe(true)
  })

  it('ONE missing broadcast turns it red even when every recorded sample is fast', () => {
    const lines = snakeAsserts(Array(20).fill(20), clean, 1)
    expect(allPass(lines)).toBe(false)
    expect(lines.find((l) => l.name.startsWith('every pick'))?.pass).toBe(false)
    expect(lines[0]!.pass).toBe(false)
  })

  it('a missing broadcast enters p95 at the full window, so enough of them break the latency bound on their own', () => {
    expect(BROADCAST_WAIT_MS).toBe(5_000)
    const lines = snakeAsserts([...Array(18).fill(20), BROADCAST_WAIT_MS, BROADCAST_WAIT_MS], clean, 0)
    expect(lines[0]!.pass).toBe(false)
  })
})
