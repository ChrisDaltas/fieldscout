import Link from 'next/link'

import { Button } from '@/components/ui/button'

/** Guest signup banner — a soft green "look here" band with v7's live dot:
 *  green never carries the interaction, so the CTA is a dark pill button. */
export function GuestBanner() {
  return (
    <div className="border-b border-n-4 bg-brand-soft text-ink">
      <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-2 lg:px-7">
        <p className="flex min-w-0 items-center gap-2 truncate text-[11px]">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-pill bg-brand" />
          <span className="font-bold">Save your rankings</span>
          <span className="truncate font-medium text-n-3">
            Track your accuracy. Share your big board.
          </span>
        </p>
        <Button variant="dark" size="sm" asChild className="shrink-0">
          <Link href="/signup">Sign up free</Link>
        </Button>
      </div>
    </div>
  )
}
