'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { autoStartPollMs } from '@/components/leagues/league-home-states-ops'
import { useActiveDraft } from '@/hooks/use-draft'
import { leaguesKeys, useLeagues } from '@/hooks/use-leagues'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { featureFlags } from '@/lib/feature-flags'

import { deriveDraftAlert, draftBarCandidate } from './draft-bar-ops'

/**
 * The real active-draft wiring (M2 task L.B3.4 — the F38/D84 TODO
 * discharged): the bar watches the viewer's REAL memberships (`useLeagues`,
 * flag-gated like the sidebar — D84(6)) for a `drafting` league (LIVE), else
 * a `scheduled` one, and rides `useActiveDraft` for the candidate's summary
 * (the scheduled instant survives with no drafts row — D95/D94). Rules are
 * pure + pinned in draft-bar-ops.ts: live always alerts; scheduled only
 * inside the 1h soon-window (draft night, not a three-week banner);
 * suppressed on the target's own room route. Never a fabricated draft —
 * no candidate, no bar.
 */
function useDraftAlert() {
  const pathname = usePathname()
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const candidate = draftBarCandidate(leagues.data ?? [])
  // One league-detail fetch, only when a candidate exists (useLeague is
  // enabled-gated on the id).
  const active = useActiveDraft(candidate?.id)

  // Minute-granularity countdown detail — a 30s tick is plenty.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // D94 watch: near/past the instant the tick starts the draft server-side;
  // nothing pushes that flip to the bar, so poll the candidate's rows while
  // the window is hot (bounded: only with a scheduled candidate in-window).
  const queryClient = useQueryClient()
  const scheduledAt = candidate?.status === 'scheduled' ? active.scheduledAt : null
  const pollMs = autoStartPollMs(scheduledAt, nowMs)
  const candidateId = candidate?.id ?? null
  useEffect(() => {
    if (pollMs === null || !candidateId) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.all })
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(candidateId) })
    }, pollMs)
    return () => clearInterval(timer)
  }, [pollMs, candidateId, queryClient])

  return deriveDraftAlert(candidate, active.scheduledAt, nowMs, pathname)
}

/** Full-width lime alert bar above the header — only when a draft is live or
 *  about to start. The platform-wide urgency signal ("look here" lime, never
 *  a control surface — the Join button is dark). */
export function DraftBar() {
  const draft = useDraftAlert()
  // DR.6 entry split (§16.1 v2.12): the bar's Join opens the room in a new
  // tab on desktop, in place on mobile. Hook order: before the early return.
  const roomEntry = useRoomEntryTarget()
  if (!draft) return null

  return (
    <div className="flex h-chrome-band shrink-0 items-center gap-3 border-b border-ink bg-brand px-7 text-ink">
      <Button variant="dark" size="sm" shadow asChild>
        <Link href={draft.href} {...roomEntry}>
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
