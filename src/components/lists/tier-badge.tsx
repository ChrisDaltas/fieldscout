import { cn } from '@/lib/utils'

import type { ListTier } from '@/types/database'

interface TierBadgeProps {
  tier: ListTier
  className?: string
}

const TIER_BG: Record<ListTier, string> = {
  S: 'bg-tier-s text-black',
  A: 'bg-tier-a text-black',
  B: 'bg-tier-b text-white',
  C: 'bg-tier-c text-black',
  D: 'bg-tier-d text-white',
  F: 'bg-tier-f text-white',
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md font-mono text-sm font-bold',
        TIER_BG[tier],
        className,
      )}
    >
      {tier}
    </span>
  )
}
