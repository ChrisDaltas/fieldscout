import { describe, expect, it } from 'vitest'

import type { TimeProvider } from './time-provider'
import { VirtualClock } from './virtual-clock'

const T0 = new Date('2026-09-13T17:00:00.000Z') // a Sunday 1pm ET slate, arbitrary

// Deterministic wall clock for paced-mode tests (D3: no raw clock reads, even here).
function stubWall(startMs = 1_000_000) {
  let ms = startMs
  return {
    clock: { now: () => new Date(ms) } satisfies TimeProvider,
    tick: (deltaMs: number) => {
      ms += deltaMs
    },
  }
}

describe('VirtualClock — step mode (speed 0)', () => {
  it('starts at the given time and never moves on its own', () => {
    const wall = stubWall()
    const clock = new VirtualClock(T0, { wallClock: wall.clock })

    expect(clock.now().toISOString()).toBe(T0.toISOString())
    wall.tick(60 * 60 * 1000) // an hour of wall time passes
    expect(clock.now().toISOString()).toBe(T0.toISOString())
  })

  it('advanceBy steps forward exactly; advanceBy(0) is a no-op', () => {
    const clock = new VirtualClock(T0, { wallClock: stubWall().clock })

    clock.advanceBy(30_000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 30_000)
    clock.advanceBy(0)
    expect(clock.now().getTime()).toBe(T0.getTime() + 30_000)
  })

  it('advanceTo jumps to the target; equal-to-now is allowed', () => {
    const clock = new VirtualClock(T0, { wallClock: stubWall().clock })
    const target = new Date(T0.getTime() + 90 * 60 * 1000)

    clock.advanceTo(target)
    expect(clock.now().toISOString()).toBe(target.toISOString())
    clock.advanceTo(target) // same instant — monotonic, not strictly increasing
    expect(clock.now().toISOString()).toBe(target.toISOString())
  })

  it('is monotonic: advanceTo throws on backwards, advanceBy on negative', () => {
    const clock = new VirtualClock(T0, { wallClock: stubWall().clock })
    clock.advanceBy(10_000)

    expect(() => clock.advanceTo(T0)).toThrow(RangeError)
    expect(() => clock.advanceBy(-1)).toThrow(RangeError)
    expect(clock.now().getTime()).toBe(T0.getTime() + 10_000) // unchanged after rejects
  })
})

describe('VirtualClock — wall-paced mode', () => {
  it.each([1, 4, 64])('maps wall→virtual exactly at %d×', (speed) => {
    const wall = stubWall()
    const clock = new VirtualClock(T0, { speed, wallClock: wall.clock })

    wall.tick(30_000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 30_000 * speed)
    wall.tick(20_000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 50_000 * speed)
  })

  it('manual advances compose with pacing (re-anchor, then keep flowing)', () => {
    const wall = stubWall()
    const clock = new VirtualClock(T0, { speed: 4, wallClock: wall.clock })

    wall.tick(10_000) // +40s virtual
    clock.advanceBy(5_000) // +5s virtual, re-anchors
    wall.tick(10_000) // +40s virtual
    expect(clock.now().getTime()).toBe(T0.getTime() + 40_000 + 5_000 + 40_000)
  })

  it('setSpeed re-anchors: pace → freeze → pace resumes from the frozen instant', () => {
    const wall = stubWall()
    const clock = new VirtualClock(T0, { speed: 64, wallClock: wall.clock })

    wall.tick(1_000) // +64s virtual
    clock.setSpeed(0)
    wall.tick(600_000) // 10 wall minutes while frozen
    expect(clock.now().getTime()).toBe(T0.getTime() + 64_000)

    clock.setSpeed(1)
    wall.tick(2_000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 64_000 + 2_000)
  })

  it('rejects invalid speeds (constructor and setSpeed)', () => {
    const wall = stubWall()
    expect(() => new VirtualClock(T0, { speed: -1, wallClock: wall.clock })).toThrow(RangeError)
    expect(() => new VirtualClock(T0, { speed: Infinity, wallClock: wall.clock })).toThrow(RangeError)

    const clock = new VirtualClock(T0, { wallClock: wall.clock })
    expect(() => clock.setSpeed(-4)).toThrow(RangeError)
    expect(() => clock.setSpeed(NaN)).toThrow(RangeError)
  })
})

describe('VirtualClock — determinism', () => {
  // The M0 exit criteria hinge on this: the same script must produce the same
  // readings every run (delivery plan §3 M0, D11).
  function scriptedRun(): string[] {
    const wall = stubWall()
    const clock = new VirtualClock(T0, { wallClock: wall.clock })
    const readings: string[] = []
    const read = () => readings.push(clock.now().toISOString())

    read()
    clock.advanceBy(20_000)
    read()
    clock.setSpeed(4)
    wall.tick(15_000)
    read()
    clock.advanceTo(new Date(T0.getTime() + 3 * 60 * 60 * 1000))
    read()
    clock.setSpeed(64)
    wall.tick(1_000)
    read()
    clock.setSpeed(0)
    wall.tick(999_999)
    read()
    return readings
  }

  it('two identically-scripted runs produce identical readings', () => {
    expect(scriptedRun()).toEqual(scriptedRun())
  })

  it('now() returns an independent Date (mutating it does not move the clock)', () => {
    const clock = new VirtualClock(T0, { wallClock: stubWall().clock })
    clock.now().setFullYear(1999)
    expect(clock.now().toISOString()).toBe(T0.toISOString())
  })
})
