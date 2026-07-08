'use client'

import { useMemo } from 'react'

import { BigBoardGrid } from '@/components/big-board/big-board-grid'
import { WeekTabs } from '@/components/big-board/week-tabs'
import { Icon } from '@/components/ui/icon'

interface WeeklyBigBoardViewProps {
  weekNumber: number
  currentWeek: number
}

/**
 * Wraps BigBoardGrid with the Rankings week tabs and the past/current/future
 * lock semantics from the F2A spec. Past weeks render read-only; future weeks
 * show a locked card and never mount the editor.
 *
 * `currentWeek` is sourced from NEXT_PUBLIC_NFL_WEEK at the server boundary —
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
    if (currentWeek === 0) {
      if (weekNumber === 1) return 'current'
      return 'future'
    }
    if (weekNumber < currentWeek) return 'past'
    if (weekNumber === currentWeek) return 'current'
    return 'future'
  }, [weekNumber, currentWeek])

  if (status === 'invalid') {
    return (
      <div className="rounded-sm border border-ink bg-white px-6 py-10 text-center">
        <h3 className="text-h6">That week doesn&apos;t exist</h3>
        <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-negative-strong">
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
        <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <Icon name="clock" size={20} className="mx-auto text-n-3" />
          <h3 className="mt-3 text-h6">Week {weekNumber} is locked</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-n-3">
            You can only edit the current week&apos;s big board. This unlocks
            once the prior week&apos;s board locks at first kickoff.
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
