'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  actingAsOptions,
  pickedFromValue,
  pickerValue,
  type ActingTeam,
} from './acting-as-ops'

export interface ActingAsControl {
  teams: ReadonlyArray<ActingTeam>
  myTeamId: string | null
  /** The team picked, or null for his own seat. */
  picked: string | null
  onPick: (teamId: string | null) => void
}

/**
 * The commissioner's "acting as" picker (F524). Rendered only for a
 * commissioner on a real league draft (`canActForTeams`); the label says
 * what the choice drives ("Bid for", "Targets for"), so the choice reads as
 * the act — "Bid for Team 4" — not as a mode.
 */
export function ActingAsPicker({
  label,
  control,
  className,
}: {
  label: string
  control: ActingAsControl
  className?: string
}) {
  const options = actingAsOptions(control.teams, control.myTeamId)
  if (options.length === 0) return null
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="fs-overline text-[9px] text-n-3">{label}</span>
      <Select
        value={pickerValue(control.picked, control.myTeamId)}
        onValueChange={(value) => control.onPick(pickedFromValue(value))}
      >
        <SelectTrigger className="h-btn-md min-w-40 text-[12px] font-bold" aria-label={label}>
          <SelectValue placeholder="Choose a team…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
