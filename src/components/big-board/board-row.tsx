'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { PlayerRow } from '@/components/players/player-row'

export interface BoardRowPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status?: string | null
}

interface SortableBoardRowProps {
  id: string
  rank: number
  player: BoardRowPlayer
  /** Projected points — null renders "—" rather than a fabricated zero. */
  projection: number | null
  draggable: boolean
  onOpen?: () => void
}

/**
 * One rankings board row — rank, headshot, name, position/team, mono
 * projection — wrapped in a dnd-kit sortable. The row itself is the shared
 * PlayerRow; this file only adds the board-specific trailing projection and
 * the sortable plumbing shared by the big board and weekly ranks surfaces.
 */
export function SortableBoardRow({
  id,
  rank,
  player,
  projection,
  draggable,
  onOpen,
}: SortableBoardRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !draggable })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li ref={setNodeRef} style={style} className="list-none touch-manipulation">
      <PlayerRow
        rank={rank}
        player={player}
        density="compact"
        draggable={draggable}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        onOpen={onOpen}
        trailing={
          <span className="fs-num w-12 shrink-0 text-right text-[13px] font-extrabold">
            {typeof projection === 'number' ? projection.toFixed(1) : '—'}
          </span>
        }
      />
    </li>
  )
}
