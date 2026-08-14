'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { formatClockMs, type PickClockView } from './pick-clock-ops'

interface DraftPauseOverlayProps {
  /** The paused clock view (`pickClockView` — mode 'paused' carries the
   *  frozen `deadline_remaining_ms`; 'untimed' = the draft had no clock to
   *  freeze, R262's honest arm). */
  clock: PickClockView
  /** Resume is offered to whoever may legally call it: commissioner/
   *  co-commissioner on a real draft, the LAUNCHER on a mock (R272 —
   *  `isCommish` is structurally false on mocks per D110(1), and the one
   *  legal resume caller was left with a dead-end overlay). */
  canResume: boolean
  /** Mock room (§8.8): a solo practice has no commissioner attribution to
   *  defer to chat, and its idle lifecycle (72h expiry) is worth stating. */
  mock?: boolean
  resuming?: boolean
  onResume?: () => void
}

/**
 * The §16.5.2 pause overlay ("pause overlay w/ remaining time") — rendered
 * over the board area while `drafts.status = 'paused'` (M2 task L.B3.3).
 * The remaining time is 069's persisted `deadline_remaining_ms` (§8.7 v2.0:
 * clocks never gain or lose time across pauses); WHO paused is the system
 * post in chat (D97) — the overlay narrates, chat attributes. In a MOCK the
 * attribution line is pointless (it can only be the launcher or the E59
 * auto-pause) — it becomes the §16.5.2 72h-expiry note instead (L.B3.5).
 *
 * Elevation (CLAUDE.md ruling, 2026-08-11): this card is a TRUE OVERLAY —
 * it floats above the board content while the pause holds — so it carries a
 * resting shadow deliberately.
 */
export function DraftPauseOverlay({
  clock,
  canResume,
  mock = false,
  resuming,
  onResume,
}: DraftPauseOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center rounded-sm bg-white/80 pt-10"
      role="status"
      aria-label="Draft paused"
    >
      {/* True overlay — floats above the board; resting shadow sanctioned
          (CLAUDE.md → Elevation, "true overlay" exception). */}
      <div className="flex flex-col items-center gap-2.5 rounded-sm border border-ink bg-white px-6 py-5 shadow-hard-6">
        <Badge variant="yellow">Paused</Badge>
        <p className="text-[15px] font-extrabold text-ink">
          {mock ? 'Practice paused' : 'Draft paused'}
        </p>
        {clock.mode === 'paused' && clock.remainingMs !== null ? (
          <p className="text-[12px] font-semibold text-n-3">
            <span className="fs-num text-ink">{formatClockMs(clock.remainingMs)}</span> frozen on
            the clock — it resumes exactly where it stopped.
          </p>
        ) : (
          // R262's honest arm: an untimed draft pauses with NULL remaining —
          // there is no frozen clock to show.
          <p className="text-[12px] font-semibold text-n-3">
            No pick clock — this draft is untimed.
          </p>
        )}
        <p className="text-[11px] font-medium text-n-3">
          {mock
            ? // §16.5.2's 72h-expiry note, at the moment it matters (E59).
              'Paused practice drafts keep for 72 hours of inactivity, then clean themselves up.'
            : 'Who paused it is posted in the draft chat.'}
        </p>
        {canResume && (
          <Button variant="blue" size="sm" onClick={onResume} disabled={resuming}>
            {resuming ? 'Resuming…' : mock ? 'Resume practice' : 'Resume draft'}
          </Button>
        )}
      </div>
    </div>
  )
}
