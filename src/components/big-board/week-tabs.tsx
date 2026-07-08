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
  className?: string
}

function tabClass(active: boolean, locked: boolean) {
  return cn(
    'inline-flex h-tab shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-ink px-3 text-[11px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    active
      ? 'bg-ink text-white'
      : 'bg-white text-ink hover:bg-n-4',
    locked && !active && 'opacity-50',
  )
}

/**
 * Rankings week selector — boxed tabs in the workspace language: "Pre draft"
 * first, then Week 1…18. Locked (future) weeks render dimmed but stay
 * reachable so their locked state can explain itself. Used by both the big
 * board and weekly ranks surfaces so the two routes read as one feature.
 */
export function WeekTabs({
  active,
  currentWeek,
  preHref = '/app/big-board',
  weekHrefBase = '/app/big-board/week',
  onSelectWeek,
  className,
}: WeekTabsProps) {
  const isLocked = (week: number) =>
    currentWeek === 0 ? week > 1 : week > currentWeek

  return (
    <div
      role="tablist"
      aria-label="Rankings week"
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none',
        className,
      )}
    >
      <Link
        role="tab"
        aria-selected={active === 'pre'}
        href={preHref}
        className={tabClass(active === 'pre', false)}
      >
        Pre draft
      </Link>
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
