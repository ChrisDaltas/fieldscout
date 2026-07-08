import { cn } from '@/lib/utils'

import type { ListTier } from '@/types/database'

interface TierBadgeProps {
  tier: ListTier
  className?: string
}

/**
 * Tier chip on the Field Scout tier ramp (1 = best). The app's S–F grades map
 * onto ramp steps 1–6; tiers 3–4 (orange/yellow) take ink text, the rest white.
 */
const TIER_BG: Record<ListTier, string> = {
  S: 'bg-tier-1 text-white',
  A: 'bg-tier-2 text-white',
  B: 'bg-tier-3 text-ink',
  C: 'bg-tier-4 text-ink',
  D: 'bg-tier-5 text-white',
  F: 'bg-tier-6 text-white',
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  return (
    <span
      className={cn(
        'fs-num inline-flex h-7 w-7 items-center justify-center rounded-sm border border-ink text-sm font-extrabold',
        TIER_BG[tier],
        className,
      )}
    >
      {tier}
    </span>
  )
}

/** Band recipe shared by the tier group headers (detail + public views). */
export const TIER_BAND_BG: Record<ListTier, string> = {
  S: 'bg-tier-1 text-white',
  A: 'bg-tier-2 text-white',
  B: 'bg-tier-3 text-ink',
  C: 'bg-tier-4 text-ink',
  D: 'bg-tier-5 text-white',
  F: 'bg-tier-6 text-white',
}
