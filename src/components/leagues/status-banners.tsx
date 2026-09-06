import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Shared banner catalog (§16.2 `status-banners.tsx`; §16.5.4 — "never invent
 * one-off treatments"). Started in M2 L.B3.1 with the two banners the draft
 * room needs; later tasks EXTEND this file per the catalog (live-stats
 * delayed, charting, maintenance, acting-as) rather than forking treatments.
 *
 * Banners sit in normal page flow: 1px ink border, flat — no resting
 * elevation (CLAUDE.md elevation rule, 2026-08-11).
 */

type BannerTone = 'caution' | 'accent' | 'neutral'

const TONE_CLASSES: Record<BannerTone, string> = {
  caution: 'border-ink bg-caution-soft',
  accent: 'border-accent bg-accent-soft',
  neutral: 'border-ink bg-white',
}

interface StatusBannerProps {
  tone?: BannerTone
  /** Leading badge chip (e.g. MOCK); optional. */
  badge?: ReactNode
  children: ReactNode
  className?: string
  /** Single-line mode: the content ellipsizes instead of wrapping. For
   *  space-constrained hosts (the draft room's 54px command bar — DR.7);
   *  page-flow banners keep the default wrapping. */
  truncate?: boolean
}

/** Base banner strip — the catalog's shared shape. */
export function StatusBanner({
  tone = 'neutral',
  badge,
  children,
  className,
  truncate = false,
}: StatusBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2.5 rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {badge}
      <span className={cn('min-w-0', truncate && 'truncate')}>{children}</span>
    </div>
  )
}

/** The reconnecting copy — BOTH forms live here so the state's words are
 *  single-sourced (one-voice.test.ts pins that no consumer re-spells them).
 *  The compact form is the D176(5) responsive-label treatment for hosts too
 *  narrow for the full sentence (the command bar below `sm`). */
export const RECONNECTING_COPY = 'Reconnecting — syncing the room…'
export const RECONNECTING_COPY_COMPACT = 'Reconnecting…'

/**
 * The §16.5.4 realtime-fallback banner: the room lost its channel; the
 * client is refetching-first and resubscribing (§8.7/§9.3 doctrine — the
 * banner narrates it, the hook does it). Since DR.7 the draft room mounts
 * this INSIDE the 54px command bar (§16.5.4's v2.12 note: the bar is the
 * room's banner surface — one strip, not a stack), with the copy constants
 * above as its single source.
 */
export function ReconnectingBanner({
  children = RECONNECTING_COPY,
  className,
  truncate,
}: {
  children?: ReactNode
  className?: string
  truncate?: boolean
}) {
  return (
    <StatusBanner tone="caution" className={className} truncate={truncate}>
      {children}
    </StatusBanner>
  )
}

/** The DEGRADED copy (§16.5.4's "degraded — banner + last-good data, never
 *  wrong numbers"), single-sourced beside the reconnecting pair for the same
 *  reason: one state, one spelling, pinned in `one-voice.test.ts`. Both
 *  forms exist because its host is the 54px command bar (D176(5)). */
export const STALE_ROOM_COPY = "Draft data isn't refreshing — showing the last state we read."
export const STALE_ROOM_COPY_COMPACT = 'Not refreshing'
/** The in-season twin (L.D5.1 — the team page's degraded state, §16.5.4:
 *  "banner + last-good data, never wrong numbers"): a roster/lineup read
 *  failed while the last-good rows are still on screen. */
export const STALE_LEAGUE_COPY = "Team data isn't refreshing — showing the last state we read."

/**
 * The §16.5.4 DEGRADED banner — the FETCH-path twin of `ReconnectingBanner`
 * (which narrates the SUBSCRIBE path). The room holds last-good data and
 * cannot refresh it: it keeps rendering that data behind this banner rather
 * than being replaced by an error card or, worse, silently falling back to a
 * surface that implies the draft isn't running (PROGRESS **F56**'s room half
 * — `room-health-ops.ts` carries the decision and the N-failure threshold).
 * Mounted in the command bar, like every other room state (§16.5.4 v2.12).
 */
export function StaleDataBanner({
  children = STALE_ROOM_COPY,
  className,
  truncate,
}: {
  children?: ReactNode
  className?: string
  truncate?: boolean
}) {
  return (
    <StatusBanner tone="caution" className={className} truncate={truncate}>
      {children}
    </StatusBanner>
  )
}

/**
 * Persistent MOCK banner (§8.8's zero-side-effect promise is the copy).
 * The RECAP's banner only, since DR.7: inside the draft room the MOCK
 * identity is the command bar's badge (D154 — "absorbed into the bar, not
 * stacked beneath it"), and the recap is a SHELL page with no bar (Q12:
 * not a draft surface), so this banner is its one telling there. Pinned in
 * `one-voice.test.ts` (the room may not mount it).
 */
export function MockBanner({ className }: { className?: string }) {
  return (
    <StatusBanner
      tone="caution"
      className={className}
      badge={
        <Badge variant="yellow" className="shrink-0">
          Mock
        </Badge>
      }
    >
      Practice draft — nothing here touches your league.
    </StatusBanner>
  )
}
