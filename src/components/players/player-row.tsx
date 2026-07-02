'use client'

import { X } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PositionBadge } from '@/components/players/position-badge'
import { darkTeamPrimary, teamTintBackground } from '@/lib/nfl-team-colors'
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
  /** Click handler for the player name (opens the player detail modal). */
  onOpen?: () => void
  trailing?: React.ReactNode
  stats?: PlayerRowStat[]
  className?: string
}

const INJURY_STATUSES = new Set(['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Suspended'])

function isInjuryStatus(status?: string | null): boolean {
  return Boolean(status) && (INJURY_STATUSES.has(status!) || status!.toLowerCase().includes('injur'))
}

/**
 * Drag ergonomics: when `draggable`, the ENTIRE row is the drag surface
 * (dragHandleProps spread on the root) — the grip icon is just a visual
 * affordance. Interactive children (name button, remove button) stop
 * pointer-down so clicking them never starts a drag.
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
  trailing,
  stats,
  className,
}: PlayerRowProps) {
  const heightClass = density === 'comfortable' ? 'h-14' : 'h-11'
  const avatarSize = density === 'comfortable' ? 'h-8 w-8' : 'h-6 w-6'

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
        'group flex items-center gap-3 rounded-md px-3 transition-colors hover:bg-bg-elevated-3 hover:ring-1 hover:ring-bg-elevated-3',
        heightClass,
        draggable && 'cursor-grab touch-manipulation active:cursor-grabbing',
        isDragging && 'shadow-lg shadow-black/50 scale-[1.02] bg-bg-elevated-3',
        selected && 'bg-bg-elevated-2 ring-2 ring-foreground hover:ring-foreground',
        className,
      )}
    >
      {showRank && (
        <span className="w-6 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-text-secondary">
          {rank}
        </span>
      )}

      <Avatar
        className={cn(
          'shrink-0 ring-1 ring-bg-elevated-3',
          avatarSize,
        )}
        style={{
          backgroundColor: teamTintBackground(player.team, 0.22),
          borderColor: darkTeamPrimary(player.team),
        }}
      >
        {player.headshot_url && (
          <AvatarImage
            src={player.headshot_url}
            alt={player.full_name}
            className="h-full w-full object-cover object-top"
          />
        )}
        <AvatarFallback className="text-[10px] font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="min-w-0 cursor-pointer truncate text-left text-sm font-semibold leading-tight hover:underline focus:outline-none focus-visible:underline"
            >
              {player.full_name}
            </button>
          ) : (
            <p className="truncate text-sm font-semibold leading-tight">
              {player.full_name}
            </p>
          )}
          {isInjuryStatus(player.status) && (
            <span className="rounded-full bg-destructive/20 px-1.5 py-px text-[10px] font-semibold text-destructive">
              {player.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <PositionBadge position={player.position} size="sm" />
          {player.team && <span>{player.team}</span>}
        </div>
      </div>

      {stats && stats.length > 0 && (
        <div className="hidden shrink-0 items-center gap-4 sm:flex">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex w-14 flex-col items-end leading-tight"
            >
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {s.value}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                {s.label}
              </span>
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
          className="rounded-full p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
