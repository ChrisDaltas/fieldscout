'use client'

import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CRED_START, CRED_TIERS } from '@/lib/cred-tiers'

/**
 * "How cred works" — the info button beside My stats' Cred progress.
 *
 * It says only what is true today: every account starts at `CRED_START`
 * (migration 197) and nothing awards cred yet. The old copy promised cred for
 * big board updates, weekly and season-long submissions and start or sit
 * votes, plus accuracy bonuses and slow decay — none of that exists (no table,
 * function or script writes `profiles.cred_score` beyond 197's backfill), and
 * those surfaces are switched off at launch. Name a way to earn cred here only
 * once it is built. The tier ladder is real (`CRED_TIERS`) and stays.
 */
export function CredInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How cred works"
          className="inline-flex h-btn-sm w-btn-sm items-center justify-center rounded-pill text-n-3 transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icon name="info-circle" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <CredExplainer />
      </PopoverContent>
    </Popover>
  )
}

/** The popover's body — its own piece so a render test can read it (the
 *  popover itself portals, so a static render never shows it). */
export function CredExplainer() {
  return (
    <>
      <h3 className="text-h6">How cred works</h3>
      <p className="mt-2 text-[11px] font-medium text-n-3">
        Cred is your reputation score on FieldScout. Everyone starts with{' '}
        {CRED_START} cred, and your Scout tier goes up as your cred does.
      </p>
      <p className="mt-2 text-[10px] font-medium text-n-6">
        Ways to earn more cred aren&apos;t live yet.
      </p>

      <h4 className="mt-4 text-[13px] font-bold tracking-[-0.015em] text-ink">Rank tiers</h4>
      <ol className="mt-2 space-y-1 text-[11px] font-medium">
        {CRED_TIERS.map((tier) => (
          <li
            key={tier.level}
            className="flex items-center justify-between gap-3 text-n-3"
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: tier.accent }}
              />
              <span className="font-semibold text-ink">{tier.name}</span>
            </span>
            <span className="fs-num">
              {tier.threshold.toLocaleString()}+
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
