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
}

/** Base banner strip — the catalog's shared shape. */
export function StatusBanner({ tone = 'neutral', badge, children, className }: StatusBannerProps) {
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
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/**
 * The §16.5.4 realtime-fallback banner: the room lost its channel; the
 * client is refetching-first and resubscribing (§8.7/§9.3 doctrine — the
 * banner narrates it, the hook does it).
 */
export function ReconnectingBanner({
  children = 'Reconnecting — syncing the room…',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <StatusBanner tone="caution" className={className}>
      {children}
    </StatusBanner>
  )
}

/**
 * Persistent MOCK banner (§16.2 draft-room: "MOCK banner when
 * drafts.is_mock"; §8.8's zero-side-effect promise is the copy).
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
