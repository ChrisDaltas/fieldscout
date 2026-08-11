import { cn } from '@/lib/utils'

import { bucketBadgeClass } from './bucket-colors'

/**
 * Tier/bucket chip on the Field Scout ramp (1 = best).
 *
 * The colour rules moved to `bucket-colors.ts` at **LV.1.5** and are documented
 * there — including why `TIER_BG` / `TIER_BAND_BG` stopped being
 * `Record<ListTier, string>` maps (they rendered `undefined`, i.e. an uncoloured
 * band, for every key migration 081 newly allows) and why they had to live in a
 * `.ts` file to be testable at all.
 */

/**
 * Re-exported so `big-board/big-board-dashboard.tsx` keeps importing it from
 * here. `src/components/big-board/**` is off limits to this build
 * (ACTIVE-BUILD.md §1), so its import path must not move.
 */
export { TIER_RAMP } from './bucket-colors'

interface TierBadgeProps {
  /**
   * A bucket key. Typed `string` rather than `ListBucketKey` on purpose: this
   * value comes off `list_players.tier`, i.e. out of the database, and the whole
   * point of `bucketBadgeClass` is that an unexpected one renders legibly
   * instead of uncoloured.
   */
  tier: string
  className?: string
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  return (
    <span
      className={cn(
        'fs-num inline-flex h-7 w-7 items-center justify-center rounded-sm border border-ink text-sm font-extrabold',
        bucketBadgeClass(tier),
        className,
      )}
    >
      {tier}
    </span>
  )
}
