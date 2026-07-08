import { PositionBadge } from '@/components/players/position-badge'
import { cn } from '@/lib/utils'

interface DraftPickProps {
  pick: number
  /** Abbreviated at the call site (board cells are narrow): "C. McCaffrey". */
  playerName?: string
  position?: string
  team?: string | null
  byManager?: string | null
  /** The active pick — accent-soft tint + hard shadow. */
  onClock?: boolean
  /** Upcoming slot — dashed border, no player. */
  empty?: boolean
  className?: string
}

/**
 * DraftPick — a single cell on the draft board grid: pick number, position
 * badge, player name, team · manager. `empty` renders an open dashed slot;
 * `onClock` highlights the pick currently up.
 *
 * Draft-only primitive (lives here, not in components/ui/ — no other surface
 * renders a draft board).
 */
export function DraftPick({
  pick,
  playerName,
  position,
  team,
  byManager,
  onClock = false,
  empty = false,
  className,
}: DraftPickProps) {
  if (empty || !playerName) {
    return (
      <div
        className={cn(
          'flex min-h-[51px] items-center justify-center rounded-sm border border-dashed border-n-3 bg-white',
          onClock && 'bg-accent-soft shadow-hard-4',
          className,
        )}
      >
        <span className="fs-overline text-[9px] text-n-3">
          {onClock ? 'On the clock' : `Pick ${pick}`}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-[51px] flex-col gap-1 rounded-sm border border-ink bg-white px-2 py-1.5',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="fs-num text-[10px] font-semibold text-n-3">
          #{pick}
        </span>
        {position && <PositionBadge position={position} size="sm" />}
      </div>
      <div className="truncate text-[11px] font-extrabold leading-tight">
        {playerName}
      </div>
      <div className="truncate text-[9px] font-semibold tracking-[0.04em] text-n-3">
        {team}
        {byManager ? ` · ${byManager}` : ''}
      </div>
    </div>
  )
}
