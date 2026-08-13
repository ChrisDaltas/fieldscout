/**
 * Pick-clock math — pure countdown derivation for `pick-clock.tsx` (M2 task
 * L.B3.1; spec §9.3: "Countdowns render from `current_deadline` (server
 * timestamp) + a clock offset measured at subscribe (and corrected by the
 * 15s heartbeat). Clients never own the clock.").
 *
 * Colocated ops split (the L.A2.x / D82(4) precedent): every function takes
 * sampled `nowMs` + the heartbeat-corrected `offsetMs` as parameters — no
 * wall-clock read exists in this file (the §9.3 grep-able rule: no
 * `Date.now()` inside deadline math). The component's interval only drives
 * re-render; the server's `current_deadline` is the only authority, and at
 * 0:00 the display HOLDS — the tick advances the draft, never the client.
 */

export type PickClockMode =
  /** Live draft, deadline running — remainingMs counts down. */
  | 'running'
  /** Live draft, deadline passed client-side — hold 0:00; the server tick
   *  resolves it (autopick or the D102 grace hold), never this client. */
  | 'expired'
  /** Paused — remainingMs is the frozen `deadline_remaining_ms` (§8.7 v2.0
   *  bookkeeping; §16.5.2 renders it). */
  | 'paused'
  /** Live draft with no clock (`pick_timer_seconds` 0 — §8.2 soft timer). */
  | 'untimed'
  /** No clock to show (scheduled/complete). */
  | 'idle'

export interface PickClockView {
  mode: PickClockMode
  /** Milliseconds to show, clamped ≥ 0; null for untimed/idle. */
  remainingMs: number | null
}

export interface PickClockInput {
  status: string
  current_deadline: string | null
  deadline_remaining_ms: number | null
}

/**
 * Derive what the clock shows. `nowMs` is the client sample the component's
 * tick provides; `offsetMs` is the heartbeat-corrected server−client offset
 * (server_now ≈ nowMs + offsetMs).
 */
export function pickClockView(
  draft: PickClockInput,
  nowMs: number,
  offsetMs: number,
): PickClockView {
  if (draft.status === 'paused') {
    return { mode: 'paused', remainingMs: Math.max(0, draft.deadline_remaining_ms ?? 0) }
  }
  if (draft.status !== 'live') return { mode: 'idle', remainingMs: null }
  if (draft.current_deadline == null) return { mode: 'untimed', remainingMs: null }

  const deadlineMs = Date.parse(draft.current_deadline)
  if (Number.isNaN(deadlineMs)) return { mode: 'untimed', remainingMs: null }

  const remaining = deadlineMs - (nowMs + offsetMs)
  if (remaining <= 0) return { mode: 'expired', remainingMs: 0 }
  return { mode: 'running', remainingMs: remaining }
}

/**
 * "M:SS" over ceiled seconds (a deadline 1ms away still reads 0:01 — the
 * clock never shows 0:00 while time legally remains).
 */
export function formatClockMs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Low-time threshold for the urgent treatment (§16.3 one-glance clarity). */
export const LOW_TIME_MS = 10_000

export function isLowTime(view: PickClockView): boolean {
  return view.mode === 'running' && view.remainingMs !== null && view.remainingMs <= LOW_TIME_MS
}
