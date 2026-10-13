'use client'

import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Icon } from '@/components/ui/icon'
import { PositionBadge } from '@/components/players/position-badge'
import { PROJ_TEXT } from '@/components/players/projected-points'
import { cn } from '@/lib/utils'

export type PlayerRowDensity = 'comfortable' | 'compact'

interface PlayerSummary {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url?: string | null
  status?: string | null
}

export interface PlayerRowStat {
  label: string
  value: string
  /** A projection — renders in the shared projected-points colour (D497). */
  projected?: boolean
}

interface PlayerRowProps {
  rank: number
  player: PlayerSummary
  density?: PlayerRowDensity
  showRank?: boolean
  draggable?: boolean
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  /** Highlighted "selected" state — the row the arrow keys will move. */
  selected?: boolean
  /** Click handler for the row body — toggles the selected state. */
  onSelect?: () => void
  onRemove?: () => void
  /** Click handler for the player name (opens the player mini-window). */
  onOpen?: () => void
  /** Chip rendered inline after the name (e.g. "On your team"). */
  nameBadge?: React.ReactNode
  /** Small text after the position badge (team override, rostered %, …).
   *  Defaults to the player's team code. */
  meta?: React.ReactNode
  /** Extra full-width line under the meta row (e.g. injury note) — the
   *  compact home-card rows use this. */
  note?: React.ReactNode
  trailing?: React.ReactNode
  stats?: PlayerRowStat[]
  className?: string
}

const INJURY_STATUSES = new Set(['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Suspended'])

function isInjuryStatus(status?: string | null): boolean {
  return Boolean(status) && (INJURY_STATUSES.has(status!) || status!.toLowerCase().includes('injur'))
}

/**
 * Field Scout player row (v7) — flush row: round headshot, semibold name,
 * position pill + grey team meta, tabular stats right, ghost remove on hover.
 * Hover tints the sunken grey (the v7 data-row hover); selected is a blue
 * fill, never a shadow.
 *
 * Drag ergonomics: when `draggable`, the ENTIRE row is the drag surface
 * (dragHandleProps spread on the root). Interactive children (name button,
 * remove button) stop pointer-down so clicking them never starts a drag.
 *
 * The compact density also covers the home hub's card-flush rows
 * (`home/home-player-row.tsx` — `nameBadge`, `meta`, `note`, `trailing`),
 * so that variant can fold into this component in phase 7.
 */
export function PlayerRow({
  rank,
  player,
  density = 'comfortable',
  showRank = true,
  draggable = false,
  dragHandleProps,
  isDragging = false,
  selected = false,
  onSelect,
  onRemove,
  onOpen,
  nameBadge,
  meta,
  note,
  trailing,
  stats,
  className,
}: PlayerRowProps) {
  const compact = density === 'compact'

  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  return (
    <div
      {...(draggable ? dragHandleProps : {})}
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-3 transition-colors hover:bg-surface-sunken',
        compact ? 'h-11' : 'h-14',
        note && 'h-auto items-start py-2',
        draggable && 'cursor-grab touch-manipulation active:cursor-grabbing',
        // Mid-drag the row floats over its list (drag-ghost exception), so
        // it carries the lift at rest while it's being carried.
        isDragging && 'z-10 bg-white shadow-hard-4',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        className,
      )}
    >
      {showRank && (
        <span className="fs-num w-6 shrink-0 text-right text-[12px] font-bold text-ink">
          {rank}
        </span>
      )}

      <Avatar className={cn('shrink-0', compact ? 'h-6 w-6' : 'h-8 w-8')}>
        <PlayerAvatarImage player={player} alt={player.full_name} />
        <AvatarFallback className={cn('font-semibold', compact ? 'text-[9px]' : 'text-[10px]')}>
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'min-w-0 cursor-pointer truncate text-left font-semibold leading-tight transition-colors hover:text-accent-strong hover:underline hover:underline-offset-2 focus:outline-none focus-visible:underline',
                compact ? 'text-[12px]' : 'text-[13px]',
              )}
            >
              {player.full_name}
            </button>
          ) : (
            <p
              className={cn(
                'truncate font-semibold leading-tight',
                compact ? 'text-[12px]' : 'text-[13px]',
              )}
            >
              {player.full_name}
            </p>
          )}
          {nameBadge}
          {isInjuryStatus(player.status) && (
            <span className="inline-flex h-[14px] shrink-0 items-center rounded-sm bg-negative-soft px-1 text-[9px] font-semibold leading-none text-negative-strong">
              {player.status}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge position={player.position} size="sm" className="shrink-0" />
          {meta != null ? (
            <span
              className={cn(
                'truncate font-medium text-n-6',
                compact ? 'text-[10px]' : 'text-[11px]',
              )}
            >
              {meta}
            </span>
          ) : (
            player.team && (
              <span
                className={cn(
                  'truncate font-medium text-n-6',
                  compact ? 'text-[10px]' : 'text-[11px]',
                )}
              >
                {player.team}
              </span>
            )
          )}
        </div>
        {note && (
          <div className="mt-1 text-[10px] font-medium leading-snug text-n-6">
            {note}
          </div>
        )}
      </div>

      {stats && stats.length > 0 && (
        <div className="hidden shrink-0 items-center gap-4 sm:flex">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex w-14 flex-col items-end leading-tight"
            >
              <span className={cn('fs-num text-[12px] font-semibold', s.projected ? PROJ_TEXT : 'text-ink')}>
                {s.value}
              </span>
              <span className="text-[9px] font-semibold text-n-6">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {trailing}

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Remove ${player.full_name}`}
          className="rounded-pill p-1 text-n-6 opacity-0 transition-[background-color,color,opacity] hover:bg-negative-soft hover:text-negative-strong focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}
