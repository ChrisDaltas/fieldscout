'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/aggregate-fantasy'
import { cn } from '@/lib/utils'

/** Which per-player stat chips can show on a list row (comfortable density
 *  only — compact rows have no room, cards use their own stat). */
export type ListRowStatKey =
  | 'proj'
  | 'current'
  | 'last'
  | 'adp'
  | 'sos'
  | 'auction'
  | 'bye'

export const LIST_ROW_STAT_OPTIONS: Array<{
  key: ListRowStatKey
  label: string
}> = [
  { key: 'proj', label: 'Projected points' },
  { key: 'current', label: `${CURRENT_SEASON} points` },
  { key: 'last', label: `${LAST_SEASON} points` },
  { key: 'adp', label: 'Average draft position' },
  { key: 'sos', label: 'Strength of schedule' },
  { key: 'auction', label: 'Auction value' },
  { key: 'bye', label: 'Bye week' },
]

export const DEFAULT_LIST_ROW_STATS: ListRowStatKey[] = ['proj', 'last', 'adp']

interface CustomizePopoverProps {
  visibleStats: Set<ListRowStatKey>
  onToggleStat: (key: ListRowStatKey) => void
  onReset: () => void
}

/**
 * List page "Customize" — which stats show as inline chips on each row.
 * Same checkbox-tile + trigger pattern as the Research spreadsheet's column
 * picker (players-spreadsheet.tsx's CustomizePopover) and Big Board's card
 * field menu, so "Customize" reads the same everywhere in the app.
 */
export function CustomizePopover({
  visibleStats,
  onToggleStat,
  onReset,
}: CustomizePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="stroke" size="sm">
          <Icon name="setup" size={13} /> Customize
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-n-4 px-3 py-2">
          <span className="fs-overline text-n-3">Show stats</span>
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-bold text-ink transition-colors hover:text-accent"
          >
            Reset
          </button>
        </div>
        <div className="py-1">
          {LIST_ROW_STAT_OPTIONS.map((option) => {
            const checked = visibleStats.has(option.key)
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onToggleStat(option.key)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-accent-soft"
              >
                {/* Static check tile (the ui/checkbox recipe) — a real
                    Checkbox here would nest a button inside a button. */}
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                    checked
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-ink bg-white',
                  )}
                >
                  {checked && <Icon name="check" size={12} />}
                </span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
