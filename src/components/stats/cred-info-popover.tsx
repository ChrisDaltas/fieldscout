'use client'

import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CRED_TIERS } from '@/lib/cred-tiers'

export function CredInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How cred is calculated"
          className="inline-flex h-btn-sm w-btn-sm items-center justify-center rounded-pill text-n-3 transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icon name="info-circle" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <h3 className="text-h6">How cred works</h3>
        <p className="mt-2 text-[11px] font-medium text-n-3">
          Cred is your reputation score on FieldScout. It rewards both showing
          up and being right. There are three ways to earn it:
        </p>
        <ul className="mt-3 space-y-2 text-[11px] font-medium text-n-3">
          <li>
            <span className="font-semibold text-ink">Big board updates.</span>{' '}
            Base cred for hitting update big board, plus a bonus based on how
            that saved state predicted real outcomes.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Weekly + season-long submissions.
            </span>{' '}
            Base cred per submission, plus an accuracy bonus calculated from
            the Spearman correlation between your ranking and actual fantasy
            points.
          </li>
          <li>
            <span className="font-semibold text-ink">Start or sit votes.</span>{' '}
            Cred proportional to your accuracy, with a contrarian bonus when
            you&apos;re correct in a minority.
          </li>
        </ul>

        <p className="mt-3 text-[10px] font-medium text-n-6">
          Cred decays slowly if you stop participating during the season. New
          users still influence consensus rankings with a weight of 1 until
          they earn cred.
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
      </PopoverContent>
    </Popover>
  )
}
