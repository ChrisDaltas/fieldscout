'use client'

import Link from 'next/link'

import { cn } from '@/lib/utils'

const WEEK_COUNT = 18

export type WeekTabValue = 'pre' | number

interface WeekTabsProps {
  /** The selected tab — 'pre' for the pre-draft big board, or a week number. */
  active: WeekTabValue
  /** Current NFL week; 0 = offseason (week 1 is treated as the active board). */
  currentWeek: number
  /** Where the "Pre draft" tab points. */
  preHref?: string
  /** Link mode: weekly tabs navigate to `${weekHrefBase}/${week}`. */
  weekHrefBase?: string
  /** Button mode: weekly tabs select in place (wins over weekHrefBase). */
  onSelectWeek?: (week: number) => void
  /** Button mode for the "Pre draft" tab: select in place (wins over preHref). */
  onSelectPre?: () => void
  className?: string
}

// v7 segmented control (FSSegmented7, matching `Segment` in ui/tabs): a grey
// pill track; the selected week is a white pill with its contact shadow
// (`shadow-seg` is part of the control's form, not elevation). Locked weeks
// read lighter but stay reachable.
function tabClass(active: boolean, locked: boolean) {
  return cn(
    'inline-flex h-tab shrink-0 items-center justify-center whitespace-nowrap rounded-pill px-[9px] text-[11px] font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    active
      ? 'bg-white text-ink shadow-seg'
      : locked
        ? 'text-n-6 hover:bg-black/5 hover:text-n-2'
        : 'text-n-2 hover:bg-black/5 hover:text-ink',
  )
}

/**
 * Rankings week selector — a v7 segmented pill track: "Pre draft" first,
 * then Week 1…18. Locked (future) weeks render dimmed but stay
 * reachable so their locked state can explain itself. Used by both the big
 * board and weekly ranks surfaces so the two routes read as one feature.
 */
export function WeekTabs({
  active,
  currentWeek,
  preHref = '/app/weekly-ranks?tab=pre',
  weekHrefBase = '/app/big-board/week',
  onSelectWeek,
  onSelectPre,
  className,
}: WeekTabsProps) {
  const isLocked = (week: number) =>
    currentWeek === 0 ? week > 1 : week > currentWeek

  return (
    <div
      role="tablist"
      aria-label="Rankings week"
      className={cn(
        'flex w-fit max-w-full items-center gap-[2px] overflow-x-auto rounded-pill bg-surface-control p-[3px] scrollbar-none',
        className,
      )}
    >
      {onSelectPre ? (
        <button
          type="button"
          role="tab"
          aria-selected={active === 'pre'}
          onClick={onSelectPre}
          className={tabClass(active === 'pre', false)}
        >
          Pre draft
        </button>
      ) : (
        <Link
          role="tab"
          aria-selected={active === 'pre'}
          href={preHref}
          className={tabClass(active === 'pre', false)}
        >
          Pre draft
        </Link>
      )}
      {Array.from({ length: WEEK_COUNT }, (_, i) => i + 1).map((week) => {
        const cls = tabClass(active === week, isLocked(week))
        if (onSelectWeek) {
          return (
            <button
              key={week}
              type="button"
              role="tab"
              aria-selected={active === week}
              onClick={() => onSelectWeek(week)}
              className={cls}
            >
              Week {week}
            </button>
          )
        }
        return (
          <Link
            key={week}
            role="tab"
            aria-selected={active === week}
            href={`${weekHrefBase}/${week}`}
            className={cls}
          >
            Week {week}
          </Link>
        )
      })}
    </div>
  )
}
