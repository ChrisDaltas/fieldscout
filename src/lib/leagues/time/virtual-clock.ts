import { systemTime, type TimeProvider } from './time-provider'

/**
 * VirtualClock — a controllable TimeProvider for tests, replays, and the
 * future League Simulator (spec §23.6, delivery plan §4.2; M0 task L.A0.1,
 * decision D2).
 *
 * Two modes:
 * - speed 0 (default): frozen/step-driven — time moves only via
 *   `advanceBy`/`advanceTo`. Deterministic by construction.
 * - speed > 0: wall-paced — virtual time flows at `speed` × wall time
 *   (1×/4×/64× replay). The wall reference is itself a TimeProvider
 *   (defaults to `systemTime`), injectable so paced behavior is testable
 *   deterministically and this class needs no raw clock reads (D3).
 *
 * Virtual time is monotonic: `advanceTo` throws on backwards targets and
 * `advanceBy` rejects negative deltas.
 */
export class VirtualClock implements TimeProvider {
  private virtualAnchorMs: number
  private wallAnchorMs: number
  private speed: number
  private readonly wallClock: TimeProvider

  constructor(start: Date, opts: { speed?: number; wallClock?: TimeProvider } = {}) {
    const speed = opts.speed ?? 0
    assertValidSpeed(speed)
    this.speed = speed
    this.wallClock = opts.wallClock ?? systemTime
    this.virtualAnchorMs = start.getTime()
    this.wallAnchorMs = this.wallClock.now().getTime()
  }

  now(): Date {
    return new Date(this.nowMs())
  }

  /** Step the clock forward by `ms` virtual milliseconds. */
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`VirtualClock.advanceBy: ms must be a finite number >= 0, got ${ms}`)
    }
    this.anchor(this.nowMs() + ms)
  }

  /** Jump the clock to virtual time `t`. Throws if `t` is in the virtual past. */
  advanceTo(t: Date): void {
    const targetMs = t.getTime()
    const currentMs = this.nowMs()
    if (targetMs < currentMs) {
      throw new RangeError(
        `VirtualClock.advanceTo: cannot move backwards (now ${new Date(currentMs).toISOString()}, target ${t.toISOString()})`,
      )
    }
    this.anchor(targetMs)
  }

  /** 1 | 4 | 64 → wall-paced replay; 0 → frozen/manual stepping. Re-anchors at the current virtual instant. */
  setSpeed(multiplier: number): void {
    assertValidSpeed(multiplier)
    this.anchor(this.nowMs())
    this.speed = multiplier
  }

  private nowMs(): number {
    if (this.speed === 0) return this.virtualAnchorMs
    const wallElapsedMs = this.wallClock.now().getTime() - this.wallAnchorMs
    return this.virtualAnchorMs + wallElapsedMs * this.speed
  }

  private anchor(virtualMs: number): void {
    this.virtualAnchorMs = virtualMs
    this.wallAnchorMs = this.wallClock.now().getTime()
  }
}

function assertValidSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed < 0) {
    throw new RangeError(`VirtualClock: speed must be a finite number >= 0, got ${speed}`)
  }
}
