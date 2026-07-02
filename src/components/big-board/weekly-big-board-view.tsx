'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { CalendarDays, Lock } from 'lucide-react'

import { BigBoardGrid } from '@/components/big-board/big-board-grid'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

interface WeeklyBigBoardViewProps {
  weekNumber: number
  currentWeek: number
}

/**
 * Wraps BigBoardGrid with a week selector strip and the past/current/future
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
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-destructive">
          Week must be between 1 and 18.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <WeekStrip currentSelected={weekNumber} currentWeek={currentWeek} />

      {status === 'future' ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Lock className="h-6 w-6 text-text-tertiary" />
            <p className="text-sm font-medium">Week {weekNumber} is locked.</p>
            <p className="max-w-md text-xs text-text-secondary">
              You can only edit the current week&apos;s Big Board. This unlocks
              once the prior week&apos;s board locks at first kickoff.
            </p>
          </CardContent>
        </Card>
      ) : (
        <BigBoardGrid weekNumber={weekNumber} readOnly={status === 'past'} />
      )}
    </div>
  )
}

function WeekStrip({
  currentSelected,
  currentWeek,
}: {
  currentSelected: number
  currentWeek: number
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <CalendarDays className="h-4 w-4 shrink-0 text-text-tertiary" />
      <div
        role="tablist"
        aria-label="Weekly Big Board navigation"
        className="flex items-center gap-1"
      >
        {WEEKS.map((w) => {
          const active = w === currentSelected
          const locked = currentWeek > 0 && w > currentWeek
          return (
            <Link
              key={w}
              role="tab"
              aria-selected={active}
              href={`/app/big-board/week/${w}`}
              className={cn(
                'inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                locked && !active && 'opacity-60',
              )}
            >
              {w}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
