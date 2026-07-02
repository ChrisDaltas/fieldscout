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
import { ClipboardList, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-foreground" />
            Big Board
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Drag players to reorder. Click any card for stats and projections. Sign
            up to save your rankings and track accuracy all season.
          </p>
        </div>
        <Button
          variant="brand"
          onClick={() => setShowSavePrompt(true)}
          className="rounded-full font-semibold"
        >
          <Save className="mr-2 h-4 w-4" />
          Save Big Board
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
        className="mt-4 block w-full rounded-full border border-dashed border-bg-elevated-2 py-3 text-center text-xs font-medium text-text-secondary transition-colors hover:border-bg-elevated-3 hover:bg-bg-elevated hover:text-foreground"
      >
        Show top 50 → 300 (sign up to expand)
      </button>

      <GuestSignupPrompt
        open={showSavePrompt}
        onOpenChange={setShowSavePrompt}
        title="Save your Big Board"
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
