import Link from 'next/link'

import { weekBadge, weekNav } from '@/components/leagues/matchup-view-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import type { ScheduleWeek } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

/**
 * The phone's week picker — ONE for the league screens that step through
 * the season (the Match tab's Starters header, League › Matchups):
 *
 *  - `WeekStatus`: the week's stored status (`league_weeks.status`, the
 *    desktop `WeekStrip` badge's words): the design's live red — a 6px dot
 *    and 11/600 "Live" — for a week being played, else "Final" /
 *    "Final (pending corrections)" / "Upcoming" in t3.
 *  - `WeekStepper`: "‹ Week N ›" (handoff m-match §2.2 B — 30px round
 *    buttons, 12px #0088FF chevrons, the 13/600 blue label) over the
 *    league's own ladder, resting in t5 at either end instead of the
 *    prototype's silent clamp. `hrefFor` makes each step a link (a page
 *    that keeps the week in its address); `onWeek` makes it a button (a
 *    screen that holds the week itself).
 */

/** The week's status beside a title or the stepper. The word brightens to
 *  #FF6B6B in phone dark mode; the dot keeps #FF0028, as the handoff's
 *  alert dots do. */
export function WeekStatus({ status }: { status: string }) {
  const badge = weekBadge(status)
  if (badge.state === 'live') {
    return (
      <span className="flex flex-none items-center gap-1 text-[11px] font-semibold text-m-red" title={badge.title} data-week-badge="live">
        <span className="size-1.5 rounded-full bg-negative-strong" />
        {badge.label}
      </span>
    )
  }
  return (
    <span className="min-w-0 truncate text-[11px] font-medium text-m-t3" title={badge.title} data-week-badge={badge.state}>
      {badge.label}
    </span>
  )
}

type StepTarget = { hrefFor: (week: number) => string; onWeek?: never } | { onWeek: (week: number) => void; hrefFor?: never }

export function WeekStepper({
  week,
  weeks,
  ...target
}: {
  week: number
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
} & StepTarget) {
  const nav = weekNav(weeks, week)
  return (
    <div className="flex flex-none items-center gap-0.5">
      <WeekStep to={nav.prev} dir="prev" target={target} />
      <span className="whitespace-nowrap text-[13px] font-semibold text-accent" data-week={week} aria-live="polite">
        Week {week}
      </span>
      <WeekStep to={nav.next} dir="next" target={target} />
    </div>
  )
}

const STEP_CLASS = 'flex size-[30px] items-center justify-center rounded-full'

function WeekStep({ to, dir, target }: { to: number | null; dir: 'prev' | 'next'; target: StepTarget }) {
  const label = dir === 'prev' ? 'Previous week' : 'Next week'
  const icon = <MIcon name={dir === 'prev' ? 'back' : 'chevronRight'} size={12} stroke={2.2} />
  if (target.onWeek) {
    const onWeek = target.onWeek
    return (
      <button
        type="button"
        disabled={to === null}
        onClick={() => to !== null && onWeek(to)}
        aria-label={label}
        className={cn(STEP_CLASS, 'text-accent active:bg-m-b2 disabled:text-m-t5 disabled:active:bg-transparent')}
      >
        {icon}
      </button>
    )
  }
  if (to === null) {
    return (
      <span className={cn(STEP_CLASS, 'text-m-t5')} aria-disabled="true" aria-label={label} role="link">
        {icon}
      </span>
    )
  }
  return (
    <Link href={target.hrefFor(to)} scroll={false} aria-label={label} className={cn(STEP_CLASS, 'text-accent active:bg-m-b2')}>
      {icon}
    </Link>
  )
}
