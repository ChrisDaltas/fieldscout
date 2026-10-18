'use client'

import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { cn } from '@/lib/utils'
import { useListDisplay, useListDisplayStore } from '@/stores/list-display-store'

import { STAT_GROUPS, offeredStats } from './lists-stats'

/**
 * FieldScout Mobile — Add stats (lr-lists §2.5, state L6): the stat groups as
 * wrapping chips; a tap toggles the column at once and new columns append, so
 * selection order is column order. The chosen columns are the list's
 * session-only display state (D3), shared with desktop. A column whose
 * release switch is off (Users, until community rankings are on) isn't
 * offered.
 */
export function AddStatsSheet({
  open,
  onOpenChange,
  listId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
}) {
  const display = useListDisplay(listId)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const offered = offeredStats()
  const selected = display.cols.filter((id) => offered.some((stat) => stat.id === id)).length

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={onOpenChange}
      title="Add stats"
      subtitle={`${selected} selected · shown as columns in your list`}
      showClose
    >
      <div className="flex flex-col gap-3.5 px-4 pb-2">
        {STAT_GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-m-t3">{group}</span>
            <div className="flex flex-wrap gap-1.5">
              {offered.filter((stat) => stat.group === group).map((stat) => {
                const on = display.cols.includes(stat.id)
                return (
                  <button
                    key={stat.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCol(listId, stat.id)}
                    className={cn(
                      'flex h-8 items-center rounded-pill px-3 text-[13px] font-semibold',
                      on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
                    )}
                  >
                    {stat.chip}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </MobileSheet>
  )
}
