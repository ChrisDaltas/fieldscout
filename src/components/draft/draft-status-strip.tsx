'use client'

import { Badge } from '@/components/ui/badge'

import { PickClock } from './pick-clock'
import { type PickClockInput } from './pick-clock-ops'
import { PresenceBar, type PresenceSeat } from './presence-bar'
import { statusStripModel, type StatusStripInput } from './status-strip-ops'

interface DraftStatusStripProps {
  strip: StatusStripInput
  /** One chip per franchise in draft order (§16.4's "draft order" +
   *  presence, both carried by `PresenceBar`). */
  seats: PresenceSeat[]
  /** The drafts-row clock fields (server-authoritative — `PickClock`'s). */
  clock: PickClockInput
  /** Heartbeat-corrected server−client offset from `useDraftRoom`. */
  offsetMs: number
}

/**
 * The status strip — spec §16.2 `draft-status-strip`, §16.4 zone 2 (v2.12;
 * Chris's requirements (3)/(4)); tasks-DR DR.4, D149. ONE band at
 * `h-header` (58px — the existing token), directly beneath the 54px command
 * bar: on-the-clock line (LEFT — the leading element), LIVE/PAUSED badge,
 * Round & Pick, the "Your next" hint, presence/draft-order chips, and the
 * pick clock at the RIGHT edge — the band's two ends read *whose turn* and
 * *how long*. Extracted from the status `Card` M2 shipped inside
 * `DraftRoomLive`, where the on-clock line sat right-aligned beside the
 * clock and presence took a second row. There is no third band (D149).
 *
 * Elevation: the strip does NOT rest elevated (CLAUDE.md's ordinary rule —
 * it is not one of D152's two sanctioned resting shadows; the bar above it
 * is). The 1px ink rule beneath is the separation, and on-clock emphasis is
 * text color/weight — fill/border/text only, never a shadow.
 */
export function DraftStatusStrip({ strip, seats, clock, offsetMs }: DraftStatusStripProps) {
  const model = statusStripModel(strip)

  return (
    <section
      aria-label="Draft status"
      className="flex h-header w-full shrink-0 items-center gap-2.5 border-b border-ink bg-white px-3"
    >
      {/* Requirement (3): whose turn — the strip's LEADING element. */}
      <span
        className={
          model.left.onClock.you
            ? 'fs-overline shrink-0 text-accent-strong'
            : 'fs-overline min-w-0 shrink truncate text-n-3'
        }
      >
        {model.left.onClock.text}
      </span>

      {model.left.badge === 'paused' ? (
        <Badge variant="yellow" className="shrink-0">
          Paused
        </Badge>
      ) : (
        <Badge variant="green" className="shrink-0">
          <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-current" />
          Live
        </Badge>
      )}

      {/* Below `sm` the words compress to "R1 · P6" (the D176(5) responsive-
          labels precedent, re-measured here at 375: the band's rigid run is
          357px of 375, starving presence to a 3px sliver — compressing this
          span hands presence ~70px, one full chip plus its scroll). */}
      <span className="shrink-0 text-[13px] font-extrabold">
        <span className="hidden sm:inline">Round </span>
        <span className="sm:hidden">R</span>
        <span className="fs-num">{model.left.round}</span>
        <span className="hidden sm:inline"> · Pick </span>
        <span className="sm:hidden">·P</span>
        <span className="fs-num">{model.left.pick}</span>
      </span>

      {model.left.nextHint && (
        <span className="fs-overline hidden shrink-0 text-[9px] text-n-3 sm:inline">
          Your next: <span className="fs-num">{model.left.nextHint.label}</span>
        </span>
      )}

      {/* The flexible middle: presence / draft order, scrolling in whatever
          width the band's ends leave it. */}
      <PresenceBar seats={seats} className="min-w-0 flex-1" />

      {/* D149: how long — the RIGHT edge. */}
      <PickClock draft={clock} offsetMs={offsetMs} className="ml-auto shrink-0" />
    </section>
  )
}
