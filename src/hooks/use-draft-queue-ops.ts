/**
 * The draft queue's write lane (M7 L.F2.6 reviews R1691 / R1697 / R1699;
 * PROGRESS D709, D710). No React; the clock, the timer and the request are
 * injected.
 */
import { LatestValueSender, type Pacer } from '@/lib/rate-limit/latest-value-sender'

/** A queue change as the click made it: the order it saw, and the order it wants. */
export interface QueueIntent {
  base: readonly string[]
  next: readonly string[]
}

/** Two waiting changes in a row are one change: from the first's view to the last's wish. */
export function mergeQueueIntents(older: QueueIntent, newer: QueueIntent): QueueIntent {
  return { base: older.base, next: newer.next }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * The order to send for `intent` when the server's last known order is
 * `confirmed` — a click made before an earlier write in the lane (a list
 * load) landed must not undo that write. When nothing changed underneath,
 * the click's own order is sent. Otherwise the click's CHANGE is replayed on
 * the server's order: its removals removed, its additions appended (an Add is
 * an append); a pure reorder keeps its relative order for the players it
 * knew, and the rest of the server's order follows.
 */
export function rebaseQueueOrder(intent: QueueIntent, confirmed: readonly string[] | null): string[] {
  const { base, next } = intent
  if (confirmed === null || sameList(confirmed, base)) return [...next]
  const baseSet = new Set(base)
  const nextSet = new Set(next)
  const isReorder = base.length === next.length && base.every((id) => nextSet.has(id))
  if (isReorder) {
    const confirmedSet = new Set(confirmed)
    return [...next.filter((id) => confirmedSet.has(id)), ...confirmed.filter((id) => !nextSet.has(id))]
  }
  const removed = new Set(base.filter((id) => !nextSet.has(id)))
  const kept = confirmed.filter((id) => !removed.has(id))
  const keptSet = new Set(kept)
  // R1699: the kept players the click also lists take the click's relative
  // order, in the places they hold; players only the server knows stay put.
  const clickOrder = next.filter((id) => keptSet.has(id))
  let k = 0
  const ordered = kept.map((id) => (nextSet.has(id) ? clickOrder[k++] : id))
  return [...ordered, ...next.filter((id) => !baseSet.has(id) && !keptSet.has(id))]
}

/** What a queue write answers (the server's order). */
export interface QueueAnswer {
  queue?: ReadonlyArray<{ player_id: string }>
}

/**
 * One queue's write lane. `confirmed` is the server's last answer — but only
 * while writes are still waiting: R1697 — when a value or an operation is
 * offered to an IDLE lane, `confirmed` is cleared, so the click's own list is
 * sent exactly as it was before the lane existed, and the replay
 * (`rebaseQueueOrder`) applies only to writes that waited behind another.
 */
export class QueueLane<R extends QueueAnswer> {
  confirmed: string[] | null = null
  readonly sender: LatestValueSender<QueueIntent, R>

  constructor(deps: {
    postOrder: (players: string[]) => Promise<R>
    retryAfterMs: (error: unknown) => number | null
    now: () => number
    setTimer: (fn: () => void, ms: number) => unknown
    pacer?: Pacer
  }) {
    this.sender = new LatestValueSender<QueueIntent, R>({
      post: async (intent) => this.remember(await deps.postOrder(rebaseQueueOrder(intent, this.confirmed))),
      merge: mergeQueueIntents,
      retryAfterMs: deps.retryAfterMs,
      now: deps.now,
      setTimer: deps.setTimer,
      pacer: deps.pacer,
    })
  }

  get busy(): boolean {
    return this.sender.busy
  }

  offer(intent: QueueIntent): Promise<R> {
    if (!this.sender.busy) this.confirmed = null
    return this.sender.offer(intent)
  }

  run<X extends QueueAnswer>(fn: () => Promise<X>): Promise<X> {
    if (!this.sender.busy) this.confirmed = null
    return this.sender.run(async () => this.remember(await fn()))
  }

  private remember<X extends QueueAnswer>(answer: X): X {
    if (Array.isArray(answer?.queue)) this.confirmed = answer.queue.map((r) => r.player_id)
    return answer
  }
}

/**
 * R1698: a merged write fails every click it carried with the SAME error
 * object — the member is told once per failed write, not once per click.
 * Returns a predicate: true the first time it sees an error, false after.
 */
export function oncePerError(): (error: unknown) => boolean {
  const told = new WeakSet<object>()
  return (error) => {
    if (typeof error !== 'object' || error === null) return true
    if (told.has(error)) return false
    told.add(error)
    return true
  }
}
