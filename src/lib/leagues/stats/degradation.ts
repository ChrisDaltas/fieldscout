/**
 * DegradationTracker — §23.2 provider-outage bookkeeping (M0 task L.A0.2a).
 *
 * Pure state machine, reused by the real incident plumbing later: after 3
 * consecutive failed polls the feed is degraded — league UIs show the honest
 * "Live stats delayed" banner (never wrong numbers, just staleness) — and the
 * first successful poll clears it, after which scoring back-fills.
 */

/** §23.2: "after 3 failed polls, raise a stats_degraded incident flag". */
export const CONSECUTIVE_FAILURES_TO_DEGRADE = 3

export class DegradationTracker {
  private failures: number

  /**
   * `initialConsecutiveFailures` seeds the count from a PERSISTED surface
   * (122's `system_flags.stats_degraded` — L.D2.3 / PROGRESS F217): a
   * serverless poll is a fresh process per invocation, so "3 consecutive
   * failed polls" can only be counted across invocations by reading the
   * count back in and writing it out after each poll (`ingest-flags.ts`).
   * The harness / sim keep one tracker per process and pass nothing.
   */
  constructor(initialConsecutiveFailures = 0) {
    if (!Number.isInteger(initialConsecutiveFailures) || initialConsecutiveFailures < 0) {
      throw new RangeError(`DegradationTracker: initialConsecutiveFailures must be a non-negative integer (got ${initialConsecutiveFailures})`)
    }
    this.failures = initialConsecutiveFailures
  }

  recordPollResult(ok: boolean): void {
    this.failures = ok ? 0 : this.failures + 1
  }

  /** The count as it stands — what the persisted surface stores (F217). */
  get consecutiveFailures(): number {
    return this.failures
  }

  /** true after 3 consecutive failures; clears on first success (§23.2). */
  get degraded(): boolean {
    return this.failures >= CONSECUTIVE_FAILURES_TO_DEGRADE
  }
}
