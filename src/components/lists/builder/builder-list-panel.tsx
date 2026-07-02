'use client'

import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Inbox, X } from 'lucide-react'

import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { darkTeamPrimary, getTeamColors, teamTintBackground } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

import type { BuilderPlayer } from './types'

interface BuilderListPanelProps {
  players: BuilderPlayer[]
  onRemove: (playerId: string) => void
}

export function BuilderListPanel({ players, onRemove }: BuilderListPanelProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'builder-drop',
    data: { kind: 'builder-drop' },
  })

  const ids = players.map((p) => p.id)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full flex-col rounded-lg border border-dashed border-bg-elevated-2 bg-bg-elevated/40 transition-colors',
        isOver && 'border-bg-elevated-3 bg-bg-elevated-2',
      )}
    >
      {players.length === 0 ? (
        <EmptyDropZone />
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {players.map((player, i) => (
                <SortableRow
                  key={player.id}
                  rank={i + 1}
                  player={player}
                  onRemove={() => onRemove(player.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </div>
      )}
    </div>
  )
}

function EmptyDropZone() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-elevated-2 text-text-tertiary">
        <Inbox className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">Drop players here</p>
        <p className="mt-1 text-xs text-text-secondary">
          Drag from the left, or click the + on a player row to add.
        </p>
      </div>
    </div>
  )
}

function SortableRow({
  rank,
  player,
  onRemove,
}: {
  rank: number
  player: BuilderPlayer
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  const teamColor = darkTeamPrimary(player.team)
  const tintBg = teamTintBackground(player.team, 0.22)

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-3 rounded-md border border-bg-elevated-2 bg-bg-elevated px-3 py-2 transition-colors hover:bg-bg-elevated-2',
        isDragging && 'border-bg-elevated-3 shadow-lg shadow-black/40',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="-ml-1 cursor-grab rounded-full text-text-tertiary opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="w-6 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-text-secondary">
        {rank}
      </span>

      <Avatar
        className="h-8 w-8 shrink-0 border-2"
        style={{ backgroundColor: tintBg, borderColor: teamColor }}
      >
        {player.headshot_url && (
          <AvatarImage
            src={player.headshot_url}
            alt={player.full_name}
            className="h-full w-full object-cover object-top"
          />
        )}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">
          {player.full_name}
        </p>
        <div className="flex items-center gap-1">
          <PositionBadge position={player.position} />
          {player.team && (
            <span className="text-[10px] text-text-secondary">{player.team}</span>
          )}
        </div>
      </div>

      <span className="shrink-0 text-right text-xs">
        <span className="block text-[8px] uppercase tracking-wider text-text-tertiary">
          Proj
        </span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {typeof player.projected_pts === 'number'
            ? player.projected_pts.toFixed(0)
            : '—'}
        </span>
      </span>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${player.full_name}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-tertiary opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
