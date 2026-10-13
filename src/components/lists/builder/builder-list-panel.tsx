'use client'

import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { PlayerRow } from '@/components/players/player-row'
import { Icon } from '@/components/ui/icon'
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
        'flex h-full flex-col rounded-2xl border bg-white transition-colors',
        // A live drop target says so with fill + border, never a lift.
        isOver ? 'border-accent bg-accent-soft' : 'border-n-4',
      )}
    >
      {players.length === 0 ? (
        <EmptyDropZone />
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col">
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
      <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-surface-control text-n-3">
        <Icon name="plus-circle" size={16} />
      </span>
      <div>
        <p className="text-[14px] font-bold text-ink">Drop players here</p>
        <p className="mt-1 text-[11px] font-medium text-n-3">
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

  return (
    <li ref={setNodeRef} style={style}>
      <PlayerRow
        rank={rank}
        player={player}
        density="compact"
        draggable
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        onRemove={onRemove}
        stats={[
          {
            label: 'Proj',
            projected: true,
            value:
              typeof player.projected_pts === 'number'
                ? player.projected_pts.toFixed(0)
                : '—',
          },
        ]}
      />
    </li>
  )
}
