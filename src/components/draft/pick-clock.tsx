'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import { formatClockMs, isLowTime, pickClockView, type PickClockInput } from './pick-clock-ops'

interface PickClockProps {
  /** The drafts-row clock fields (server-authoritative). */
  draft: PickClockInput
  /** Heartbeat-corrected server−client offset from `useDraftRoom`. */
  offsetMs: number
  className?: string
}

/**
 * PickClock (§16.2) — server-deadline countdown + paused state. The interval
 * below ONLY drives re-render (D82(4)/§9.3): it samples the client clock and
 * injects it into the pure `pick-clock-ops` math, where the server's
 * `current_deadline` + the heartbeat offset are the only authority. At 0:00
 * the display holds — the server tick resolves expiry, never this client.
 */
export function PickClock({ draft, offsetMs, className }: PickClockProps) {
  // Clock SAMPLE for injection into the pure view math — not deadline math.
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const view = pickClockView(draft, nowMs, offsetMs)

  if (view.mode === 'idle') return null

  if (view.mode === 'untimed') {
    return (
      <span className={cn('text-[11px] font-medium text-n-6', className)}>No clock</span>
    )
  }

  // v7 clock: a grey pill with the time in 13px semibold tabular numerals.
  // Paused freezes it (no live dot); low time is a red wash + red text —
  // fill and colour only, never a shadow.
  if (view.mode === 'paused') {
    return (
      <span
        className={cn(
          'inline-flex h-btn-md items-center gap-1.5 rounded-pill bg-surface-control px-3',
          className,
        )}
      >
        <span className="text-[11px] font-medium text-n-3">Paused</span>
        <span className="fs-num text-[13px] font-semibold text-ink">
          {formatClockMs(view.remainingMs ?? 0)}
        </span>
        <span className="text-[11px] font-medium text-n-3">left</span>
      </span>
    )
  }

  // running | expired — the countdown proper.
  const urgent = isLowTime(view) || view.mode === 'expired'
  return (
    <span
      className={cn(
        'fs-num inline-flex h-btn-md items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold',
        urgent ? 'bg-negative-soft text-negative-strong' : 'bg-surface-control text-ink',
        className,
      )}
      role="timer"
      aria-live="off"
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-pill',
          urgent ? 'bg-negative-strong' : 'bg-brand',
        )}
      />
      {formatClockMs(view.remainingMs ?? 0)}
    </span>
  )
}
