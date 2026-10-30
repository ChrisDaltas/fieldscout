import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { ranksOn } from '@/lib/rankings/ranks-on'

/**
 * What the banner promises — only what's switched on (plan C4): lists
 * always, rankings only while they're on (`ranksOn`). Never accuracy:
 * nothing measures it yet, so it stays unclaimed everywhere until it is.
 */
export function guestBannerCopy(): { lead: string; rest: string } {
  return ranksOn()
    ? { lead: 'Make your own lists and rankings', rest: 'Share them with friends.' }
    : { lead: 'Make your own lists', rest: 'Share them with friends.' }
}

/** Guest signup banner — a soft green "look here" band with v7's live dot:
 *  green never carries the interaction, so the CTA is a dark pill button. */
export function GuestBanner() {
  const { lead, rest } = guestBannerCopy()
  return (
    <div className="border-b border-n-4 bg-brand-soft text-ink">
      <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-2 lg:px-7">
        <p className="flex min-w-0 items-center gap-2 truncate text-[11px]">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-pill bg-brand" />
          <span className="font-bold">{lead}</span>
          <span className="truncate font-medium text-n-3">{rest}</span>
        </p>
        <Button variant="dark" size="sm" asChild className="shrink-0">
          <Link href="/signup">Sign up free</Link>
        </Button>
      </div>
    </div>
  )
}
