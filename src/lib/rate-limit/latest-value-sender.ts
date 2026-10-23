/**
 * LatestValueSender — send only the latest of a burst of whole-state writes
 * (M7 L.F2.6 review R1685; spec §22.5; PROGRESS D707).
 *
 * For a write with REPLACE semantics (the draft queue posts the whole ordered
 * list), every intermediate state in a burst is already superseded by the
 * last one. So:
 *   - at most ONE write is in flight;
 *   - a value offered while one is in flight (or inside the gap) only replaces
 *     the pending value — the next write carries the newest, never a stale one;
 *   - consecutive writes start at least `minGapMs` apart, so a sustained burst
 *     spends at most ceil(window / minGapMs) of the 10-per-10-s allowance and
 *     leaves the rest for the member's own picks;
 *   - a 429 is not a failure: the same (or a newer) value is re-sent after the
 *     server's `Retry-After`, up to `maxRetries` times;
 *   - every offer's promise settles with the write that carried its value or a
 *     later one: resolved with that write's answer, or rejected with its error.
 *
 * Pure plumbing: the clock and the timer are injected (tests drive them).
 */

export interface LatestValueSenderDeps<T, R> {
  post: (value: T) => Promise<R>
  /** ms to wait before re-sending after this error, or null when it is a real failure. */
  retryAfterMs: (error: unknown) => number | null
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  minGapMs?: number
  maxRetries?: number
}

interface Waiter<R> {
  resolve: (r: R) => void
  reject: (e: unknown) => void
}

export const QUEUE_SEND_MIN_GAP_MS = 1250

export class LatestValueSender<T, R> {
  private pending: { value: T; waiters: Waiter<R>[] } | null = null
  private inFlight = false
  private timerSet = false
  private lastStartAt = Number.NEGATIVE_INFINITY
  private retries = 0
  private readonly minGapMs: number
  private readonly maxRetries: number

  constructor(private readonly deps: LatestValueSenderDeps<T, R>) {
    this.minGapMs = deps.minGapMs ?? QUEUE_SEND_MIN_GAP_MS
    this.maxRetries = deps.maxRetries ?? 5
  }

  /** True while a write is in flight or a value is waiting to be sent. */
  get busy(): boolean {
    return this.inFlight || this.pending !== null
  }

  offer(value: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const waiters = this.pending ? this.pending.waiters : []
      waiters.push({ resolve, reject })
      this.pending = { value, waiters }
      this.schedule(0)
    })
  }

  private schedule(extraDelayMs: number): void {
    if (this.inFlight || this.timerSet || !this.pending) return
    const gapWait = this.lastStartAt + this.minGapMs - this.deps.now()
    const wait = Math.max(0, gapWait, extraDelayMs)
    if (wait <= 0) {
      void this.flush()
      return
    }
    this.timerSet = true
    this.deps.setTimer(() => {
      this.timerSet = false
      void this.flush()
    }, wait)
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.pending) return
    const batch = this.pending
    this.pending = null
    this.inFlight = true
    this.lastStartAt = this.deps.now()
    try {
      const result = await this.deps.post(batch.value)
      this.inFlight = false
      this.retries = 0
      for (const w of batch.waiters) w.resolve(result)
      this.schedule(0)
    } catch (error) {
      this.inFlight = false
      const wait = this.deps.retryAfterMs(error)
      if (wait !== null && this.retries < this.maxRetries) {
        this.retries += 1
        // Re-send: a newer offer (if any) supersedes the refused value; its
        // waiters ride along either way.
        // (`this.pending` may have been set by an offer during the await.)
        const newer = this.pending as { value: T; waiters: Waiter<R>[] } | null
        this.pending = newer ? { value: newer.value, waiters: [...batch.waiters, ...newer.waiters] } : batch
        this.schedule(wait)
        return
      }
      this.retries = 0
      for (const w of batch.waiters) w.reject(error)
      this.schedule(0)
    }
  }
}
