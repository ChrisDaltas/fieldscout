'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

interface DraftAlert {
  live: boolean
  league: string
  detail: string
  href: string
}

// TODO(M2 draft engine — F38): wire to the real active-draft query. There is
// no live or scheduled draft in M1 (the draft engine lands in M2), so this
// returns null and the bar never renders — never a fabricated live draft.
// When the draft room lands, return the viewer's active draft (or null when
// none is live) so the bar surfaces only a REAL draft.
function useDraftAlert(): DraftAlert | null {
  return null
}

/** Full-width lime alert bar above the header — only when a draft is live or
 *  scheduled. The platform-wide urgency signal ("look here" lime, never a
 *  control surface — the Join button is dark). */
export function DraftBar() {
  const draft = useDraftAlert()
  if (!draft) return null

  return (
    <div className="flex h-[37px] shrink-0 items-center gap-3 border-b border-ink bg-brand px-7 text-ink">
      <Button variant="dark" size="sm" shadow asChild>
        <Link href={draft.href}>
          Join
          <Icon name="arrow-next" />
        </Link>
      </Button>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-extrabold">
        <span
          className={`h-2 w-2 rounded-pill bg-current ${draft.live ? 'animate-pulse' : ''}`}
        />
        {draft.live ? 'Live draft' : 'Draft scheduled'}
      </span>
      <span className="whitespace-nowrap text-[12px] font-bold">
        {draft.league}
      </span>
      <span className="truncate text-[12px] font-medium text-ink/60">
        {draft.detail}
      </span>
    </div>
  )
}
