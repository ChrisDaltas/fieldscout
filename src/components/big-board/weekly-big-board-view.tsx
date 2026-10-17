'use client'

import { useMemo } from 'react'

import { BigBoardGrid } from '@/components/big-board/big-board-grid'
import { WeekTabs } from '@/components/big-board/week-tabs'
import { Icon } from '@/components/ui/icon'
import { activeWeekOf, isWeekLocked, opensInWeek } from '@/lib/rankings/week-window'

interface WeeklyBigBoardViewProps {
  weekNumber: number
  currentWeek: number
}

/**
 * Wraps BigBoardGrid with the Rankings week tabs and the past/current/future
 * lock semantics from the F2A spec. Past weeks render read-only; future weeks
 * show a locked card and never mount the editor.
 *
 * `currentWeek` is sourced from Sleeper state (getCurrentNflWeek) at the server boundary —
 * 0 means offseason, in which case Week 1 is treated as the active board.
 */
export function WeeklyBigBoardView({
  weekNumber,
  currentWeek,
}: WeeklyBigBoardViewProps) {
  const status = useMemo<'past' | 'current' | 'future' | 'invalid'>(() => {
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
      return 'invalid'
    }
    // This week and the next three are editable (one rule with the phone).
    if (isWeekLocked(weekNumber, currentWeek)) return 'future'
    if (weekNumber < activeWeekOf(currentWeek)) return 'past'
    return 'current'
  }, [weekNumber, currentWeek])

  if (status === 'invalid') {
    return (
      <div className="rounded-2xl border border-n-4 bg-white px-6 py-10 text-center">
        <h3 className="text-h6">That week doesn&apos;t exist</h3>
        <p className="mx-auto mt-1 max-w-md text-[11px] font-medium text-negative-strong">
          Week must be between 1 and 18.
        </p>
      </div>
    )
  }

  if (status === 'future') {
    return (
      <section>
        <WeekTabs
          className="mb-4"
          active={weekNumber}
          currentWeek={currentWeek}
        />
        <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
          <Icon name="clock" size={20} className="mx-auto text-n-6" />
          <h3 className="mt-2.5 text-h6">Week {weekNumber} is locked</h3>
          <p className="mx-auto mt-1 max-w-md text-[11px] font-medium text-n-6">
            You can rank this week and the next three. Week {weekNumber} opens in
            Week {opensInWeek(weekNumber)}.
          </p>
        </div>
      </section>
    )
  }

  return (
    <BigBoardGrid
      weekNumber={weekNumber}
      readOnly={status === 'past'}
      currentWeek={currentWeek}
    />
  )
}
