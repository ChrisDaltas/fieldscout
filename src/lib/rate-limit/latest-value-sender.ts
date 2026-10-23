/**
 * LatestValueSender — one ordered lane of writes for a whole-state resource
 * (M7 L.F2.6 reviews R1685 / R1691 / R1694; spec §22.5; PROGRESS D707, D709).
 *
 * For a write with REPLACE semantics (the draft queue posts the whole ordered
 * list), every intermediate state in a burst is superseded by the last one.
 * The lane holds two kinds of work, run strictly in the order they arrive:
 *   - VALUES (`offer`) — consecutive values waiting in the lane merge into one
 *     (`merge`, default: the newer wins), so a burst sends only its latest;
 *   - OPERATIONS (`run`) — a non-coalescible write (e.g. "load a list into the
 *     queue"). It waits for every value offered before it, and every value
 *     offered after it waits for it: clicks land in click order (R1691).
 * And for all of it:
 *   - at most ONE write is in flight;
 *   - writes START at least `minGapMs` apart — measured on a `pacer` that
 *     every lane of one scope shares (R1694), so the member's TOTAL for that
 *     league / practice draft stays at most ceil(window / minGapMs);
 *   - a 429 is not a failure: the item (merged with any newer value) is
 *     re-sent after the server's `Retry-After`, up to `maxRetries` times; then
 *     it fails like any other error;
 *   - every promise settles with the write that carried it (or, for a value,
 *     a later merged one): resolved with that write's answer, or rejected;
 *   - a write that has not answered after `timeoutMs` (15 s) fails in plain
 *     words and frees the lane (R1700) — a hung request never blocks the queue.
 *
 * Pure plumbing: the clock and the timer are injected (tests drive them).
 */

export interface Pacer {
  lastStartAt: number
}

export interface LatestValueSenderDeps<T, R> {
  post: (value: T) => Promise<R>
  /** ms to wait before re-sending after this error, or null when it is a real failure. */
  retryAfterMs: (error: unknown) => number | null
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  /** How two waiting values combine (older first). Default: the newer wins. */
  merge?: (older: T, newer: T) => T
  /** Shared by every lane of one scope (R1694). Default: this lane's own. */
  pacer?: Pacer
  minGapMs?: number
  maxRetries?: number
  /** R1700: a write in flight longer than this fails (default 15 s). */
  timeoutMs?: number
}

interface Waiter<X> {
  resolve: (r: X) => void
  reject: (e: unknown) => void
}

type Item<T, R> =
  | { kind: 'value'; value: T; waiters: Waiter<R>[] }
  | { kind: 'op'; fn: () => Promise<unknown>; waiter: Waiter<unknown> }

export const QUEUE_SEND_MIN_GAP_MS = 1250
export const WRITE_TIMEOUT_MS = 15_000
export const WRITE_TIMEOUT_MESSAGE =
  'The server took too long to answer, so this change may not have been saved. Check your queue and try again.'

export function newPacer(): Pacer {
  return { lastStartAt: Number.NEGATIVE_INFINITY }
}

export class LatestValueSender<T, R> {
  private lane: Array<Item<T, R>> = []
  private inFlight = false
  private timerSet = false
  private retries = 0
  private readonly pacer: Pacer
  private readonly minGapMs: number
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly merge: (older: T, newer: T) => T

  constructor(private readonly deps: LatestValueSenderDeps<T, R>) {
    this.pacer = deps.pacer ?? newPacer()
    this.minGapMs = deps.minGapMs ?? QUEUE_SEND_MIN_GAP_MS
    this.maxRetries = deps.maxRetries ?? 5
    this.timeoutMs = deps.timeoutMs ?? WRITE_TIMEOUT_MS
    this.merge = deps.merge ?? ((_older, newer) => newer)
  }

  /** True while a write is in flight or anything is waiting in the lane. */
  get busy(): boolean {
    return this.inFlight || this.lane.length > 0
  }

  offer(value: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const last = this.lane[this.lane.length - 1]
      if (last && last.kind === 'value') {
        last.value = this.merge(last.value, value)
        last.waiters.push({ resolve, reject })
      } else {
        this.lane.push({ kind: 'value', value, waiters: [{ resolve, reject }] })
      }
      this.schedule(0)
    })
  }

  run<X>(fn: () => Promise<X>): Promise<X> {
    return new Promise<X>((resolve, reject) => {
      this.lane.push({ kind: 'op', fn, waiter: { resolve: resolve as (r: unknown) => void, reject } })
      this.schedule(0)
    })
  }

  private schedule(extraDelayMs: number): void {
    if (this.inFlight || this.timerSet || this.lane.length === 0) return
    const gapWait = this.pacer.lastStartAt + this.minGapMs - this.deps.now()
    const wait = Math.max(0, gapWait, extraDelayMs)
    if (wait <= 0) {
      void this.flush()
      return
    }
    this.timerSet = true
    this.deps.setTimer(() => {
      this.timerSet = false
      // Another lane of the scope may have started meanwhile — re-check the gap.
      this.schedule(0)
    }, wait)
  }

  /** R1700: a write that never answers fails after `timeoutMs` and frees the lane. */
  private withTimeout<X>(work: Promise<X>): Promise<X> {
    return new Promise<X>((resolve, reject) => {
      let settled = false
      this.deps.setTimer(() => {
        if (settled) return
        settled = true
        reject(new Error(WRITE_TIMEOUT_MESSAGE))
      }, this.timeoutMs)
      work.then(
        (r) => {
          if (settled) return
          settled = true
          resolve(r)
        },
        (e) => {
          if (settled) return
          settled = true
          reject(e)
        },
      )
    })
  }

  private async flush(): Promise<void> {
    if (this.inFlight) return
    const item = this.lane.shift()
    if (!item) return
    this.inFlight = true
    this.pacer.lastStartAt = this.deps.now()
    try {
      const result = await this.withTimeout(item.kind === 'value' ? this.deps.post(item.value) : item.fn())
      this.inFlight = false
      this.retries = 0
      if (item.kind === 'value') for (const w of item.waiters) w.resolve(result as R)
      else item.waiter.resolve(result)
      this.schedule(0)
    } catch (error) {
      this.inFlight = false
      const wait = this.deps.retryAfterMs(error)
      if (wait !== null && this.retries < this.maxRetries) {
        this.retries += 1
        const head = this.lane[0]
        if (item.kind === 'value' && head && head.kind === 'value') {
          // A newer value arrived during the flight: it carries the refused one's waiters too.
          head.value = this.merge(item.value, head.value)
          head.waiters = [...item.waiters, ...head.waiters]
        } else {
          this.lane.unshift(item)
        }
        this.schedule(wait)
        return
      }
      this.retries = 0
      if (item.kind === 'value') for (const w of item.waiters) w.reject(error)
      else item.waiter.reject(error)
      this.schedule(0)
    }
  }
}
