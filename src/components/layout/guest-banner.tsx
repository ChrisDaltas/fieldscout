import Link from 'next/link'

import { Button } from '@/components/ui/button'

/** Guest signup banner — a lime "look here" bar (the draft-bar idiom):
 *  lime never carries the interaction, so the CTA is a dark button. */
export function GuestBanner() {
  return (
    <div className="border-b border-ink bg-brand text-ink">
      <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-2 lg:px-7">
        <p className="min-w-0 truncate text-[12px]">
          <span className="font-extrabold">Save your rankings</span>
          <span className="ml-2 font-medium text-ink/60">
            Track your accuracy. Share your big board.
          </span>
        </p>
        <Button variant="dark" size="sm" shadow asChild className="shrink-0">
          <Link href="/signup">Sign up free</Link>
        </Button>
      </div>
    </div>
  )
}
