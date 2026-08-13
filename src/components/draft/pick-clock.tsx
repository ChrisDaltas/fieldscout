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
      <span className={cn('fs-overline text-n-3', className)}>No clock</span>
    )
  }

  if (view.mode === 'paused') {
    return (
      <span className={cn('flex items-baseline gap-1.5', className)}>
        <span className="fs-overline text-n-3">Paused</span>
        <span className="fs-num text-[18px] font-extrabold text-ink">
          {formatClockMs(view.remainingMs ?? 0)}
        </span>
        <span className="fs-overline text-n-3">left</span>
      </span>
    )
  }

  // running | expired — the countdown proper.
  return (
    <span
      className={cn(
        'fs-num text-[18px] font-extrabold',
        isLowTime(view) || view.mode === 'expired'
          ? 'text-negative-strong'
          : 'text-accent-strong',
        className,
      )}
      role="timer"
      aria-live="off"
    >
      {formatClockMs(view.remainingMs ?? 0)}
    </span>
  )
}
