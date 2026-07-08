'use client'

import { useEffect, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { GuestSignupPrompt } from '@/components/layout/guest-signup-prompt'
import { PlayerCard } from '@/components/players/player-card'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

const STORAGE_KEY = 'fieldscout.guest.big-board.order'

export interface GuestBigBoardPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
}

interface GuestBigBoardProps {
  players: GuestBigBoardPlayer[]
}

export function GuestBigBoard({ players }: GuestBigBoardProps) {
  const [order, setOrder] = useState<string[]>(() => players.map((p) => p.id))
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const [showSavePrompt, setShowSavePrompt] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) {
          const valid = new Set(players.map((p) => p.id))
          const cleaned = parsed.filter((id) => valid.has(id))
          const missing = players.map((p) => p.id).filter((id) => !cleaned.includes(id))
          setOrder([...cleaned, ...missing])
        }
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [players])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
    } catch {
      // ignore quota
    }
  }, [order, hydrated])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const orderedPlayers = order
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is GuestBigBoardPlayer => Boolean(p))

  if (orderedPlayers.length === 0) {
    return (
      <section>
        <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <p className="text-h5 text-ink">No players to rank yet</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-n-3">
            The preview board is empty right now — check back once player data
            has synced.
          </p>
        </div>
      </section>
    )
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = order.indexOf(String(active.id))
    const newIdx = order.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    setOrder(arrayMove(order, oldIdx, newIdx))
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-h5">
            <Icon name="list" size={19} />
            Big board
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] font-medium text-n-3">
            Drag players to reorder. Click any card for stats and projections. Sign
            up to save your rankings and track accuracy all season.
          </p>
        </div>
        <Button variant="blue" shadow onClick={() => setShowSavePrompt(true)}>
          <Icon name="save" size={14} />
          Save big board
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
            {orderedPlayers.map((player, i) => (
              <SortableCard
                key={player.id}
                rank={i + 1}
                player={player}
                onClick={() => openPlayer(player.id, { readOnly: true })}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={() => setShowSavePrompt(true)}
        className="mt-4 block w-full rounded-sm border border-dashed border-ink py-3 text-center text-[11px] font-bold text-n-3 transition-colors hover:bg-n-4 hover:text-ink"
      >
        Show top 50 → 300 (sign up to expand)
      </button>

      <GuestSignupPrompt
        open={showSavePrompt}
        onOpenChange={setShowSavePrompt}
        title="Save your big board"
        description="Sign up free and your rankings carry over to your account. Track accuracy all season."
      />
    </section>
  )
}

interface SortableCardProps {
  rank: number
  player: GuestBigBoardPlayer
  onClick: () => void
}

function SortableCard({ rank, player, onClick }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // The whole card is the drag surface (dragHandleProps), matching the
  // signed-in Big Board. Guest data has no projections, so projectedPts is
  // null → the card shows "—".
  return (
    <li ref={setNodeRef} style={style} className="touch-manipulation">
      <PlayerCard
        rank={rank}
        player={player}
        projectedPts={null}
        onOpen={onClick}
        draggable
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </li>
  )
}
