import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { PositionBadge } from '@/components/players/position-badge'
import { cn } from '@/lib/utils'

import { initialsOf, type MockInjuryStatus, type MockLineupPlayer } from './league-mock-data'

/**
 * Small display cells shared across the league workspace tabs. Mock-data UI
 * only — crests and headshots render as initials tiles until the league
 * backend supplies real art.
 *
 * TODO(live-draft): crest/headshot images arrive with real league data.
 */

interface CrestProps {
  name: string
  className?: string
  fallbackClassName?: string
}

/** Square team/league crest — initials on the sunken fill (base Avatar). */
export function Crest({ name, className, fallbackClassName }: CrestProps) {
  return (
    <Avatar className={cn('h-6 w-6 shrink-0', className)}>
      <AvatarFallback className={cn('text-[9px]', fallbackClassName)}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

interface TeamCellProps {
  team: string
  sub?: React.ReactNode
  crestClassName?: string
  className?: string
}

/** Crest + bold team name (+ optional muted sub line). */
export function TeamCell({ team, sub, crestClassName, className }: TeamCellProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Crest name={team} className={crestClassName} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {team}
        </div>
        {sub && (
          <div className="truncate text-[10px] font-semibold leading-tight text-n-3">
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

/** Injury designation tag — Q/D caution, Out negative. */
export function StatusTag({ status }: { status: MockInjuryStatus }) {
  if (!status) return null
  const variant = status === 'O' ? 'pink' : 'yellow'
  const label = status === 'O' ? 'Out' : status
  return (
    <Badge
      variant={variant}
      className="ml-1.5 h-[15px] px-1.5 text-[9px] leading-none"
    >
      {label}
    </Badge>
  )
}

interface PlayerCellProps {
  player: MockLineupPlayer
  /** Extra meta after the team code (defaults to team only). */
  meta?: React.ReactNode
  /** Right-align the cell (opponent side of the Matchup tab). */
  mirror?: boolean
  className?: string
}

/** Headshot tile + name + status + position badge + muted meta. */
export function PlayerCell({ player, meta, mirror, className }: PlayerCellProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        mirror && 'flex-row-reverse',
        className,
      )}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[9px]">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <div className={cn('min-w-0', mirror && 'text-right')}>
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {player.name}
          <StatusTag status={player.status} />
        </div>
        <div
          className={cn(
            'mt-0.5 flex items-center gap-1.5',
            mirror && 'justify-end',
          )}
        >
          <PositionBadge position={player.pos} size="sm" className="shrink-0" />
          <span className="truncate text-[10px] font-semibold text-n-3">
            {meta ?? player.team}
          </span>
        </div>
      </div>
    </div>
  )
}

interface WinProbMeterProps {
  /** Left side's win probability, 0–100. */
  value: number
  /** Dashed center tick marking even odds (Matchup tab). */
  showTick?: boolean
  className?: string
}

/** Accent win-probability meter on the system progress track. */
export function WinProbMeter({ value, showTick, className }: WinProbMeterProps) {
  return (
    <div className={cn('relative', className)}>
      <Progress value={value} className="h-2" />
      {showTick && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 border-l border-dashed border-n-3"
        />
      )}
    </div>
  )
}

/** Opponent positional rank chip — low = tough (negative), high = soft
 *  (positive), middle = caution. Dark text on all three fills. */
export function OprkChip({ value }: { value: number }) {
  const tone =
    value <= 8 ? 'bg-negative' : value >= 24 ? 'bg-positive' : 'bg-caution'
  return (
    <span
      className={cn(
        'fs-num inline-flex h-[18px] min-w-[21px] items-center justify-center rounded-sm px-1.5 text-[10px] font-bold',
        tone,
      )}
    >
      {value}
    </span>
  )
}
