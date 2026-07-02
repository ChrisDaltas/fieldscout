'use client'

import { Info } from 'lucide-react'

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
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 border-bg-elevated-2 bg-bg-elevated p-4 text-sm"
      >
        <h3 className="text-sm font-semibold">How cred works</h3>
        <p className="mt-2 text-xs text-text-secondary">
          Cred is your reputation score on FieldScout. It rewards both showing up
          and being right. There are three ways to earn it:
        </p>
        <ul className="mt-3 space-y-2 text-xs text-text-secondary">
          <li>
            <span className="font-semibold text-foreground">Big Board updates.</span>{' '}
            Base cred for hitting Update Big Board, plus a bonus based on how that
            saved state predicted real outcomes.
          </li>
          <li>
            <span className="font-semibold text-foreground">Weekly + season-long submissions.</span>{' '}
            Base cred per submission, plus an accuracy bonus calculated from the
            Spearman correlation between your ranking and actual fantasy points.
          </li>
          <li>
            <span className="font-semibold text-foreground">Start or Sit votes.</span>{' '}
            Cred proportional to your accuracy, with a contrarian bonus when
            you&apos;re correct in a minority.
          </li>
        </ul>

        <p className="mt-3 text-[10px] text-text-tertiary">
          Cred decays slowly if you stop participating during the season. New
          users still influence consensus rankings with a weight of 1 until they
          earn cred.
        </p>

        <h4 className="mt-4 text-xs font-semibold">Rank tiers</h4>
        <ol className="mt-2 space-y-1 text-xs">
          {CRED_TIERS.map((tier) => (
            <li
              key={tier.level}
              className="flex items-center justify-between gap-3 text-text-secondary"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: tier.accent }}
                />
                <span className="text-foreground">{tier.name}</span>
              </span>
              <span className="font-mono tabular-nums">
                {tier.threshold.toLocaleString()}+
              </span>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
