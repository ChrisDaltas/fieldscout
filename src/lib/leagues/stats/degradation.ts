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
  private consecutiveFailures = 0

  recordPollResult(ok: boolean): void {
    this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1
  }

  /** true after 3 consecutive failures; clears on first success (§23.2). */
  get degraded(): boolean {
    return this.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_DEGRADE
  }
}
