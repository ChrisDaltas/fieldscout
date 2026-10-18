'use client'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'

export interface ScoringSheetOption<V extends string> {
  value: V
  label: string
  /** One plain line under the name ("1 point per catch"). */
  sub: string
}

/**
 * The phone's scoring choice sheet (gap list #19, §3 #18): a "Scoring"
 * bottom sheet of choices, the active one ticked; a tap picks and closes.
 * The design has no scoring control, so this extends its language. Opened
 * by the list's scoring pill (`ScoringControl`) and by the player profile's
 * scoring chip in the stat strip — each trigger says what the points are for
 * in `subtitle`.
 */
export function ScoringSheet<V extends string>({
  open,
  onOpenChange,
  subtitle,
  options,
  value,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subtitle: string
  options: ReadonlyArray<ScoringSheetOption<V>>
  value: V
  onPick: (value: V) => void
}) {
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Scoring" subtitle={subtitle} showClose>
      <div className="flex flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {options.map((option) => {
          const on = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick(option.value)
                onOpenChange(false)
              }}
              className="flex min-h-[52px] items-center gap-3 border-b border-m-b2 py-2 text-left last:border-b-0"
              data-scoring-option={option.value}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[15px] font-semibold text-m-t1">{option.label}</span>
                <span className="text-[12px] font-medium text-m-t3">{option.sub}</span>
              </span>
              {on && <MIcon name="check" size={16} stroke={2.4} className="flex-none text-accent" />}
            </button>
          )
        })}
      </div>
    </MobileSheet>
  )
}
