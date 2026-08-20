'use client'

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo } from 'react'

import { PlayerRow } from '@/components/players/player-row'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDraftQueue, useUpdateDraftQueue } from '@/hooks/use-draft-queue'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'
import { cn } from '@/lib/utils'

import {
  deriveQueueView,
  orderedIdsForSave,
  removeId,
  reorderIds,
  type QueueViewRow,
} from './my-queue-ops'

interface MyQueueProps {
  leagueId: string
  draftId: string
  /** My seat (a mock's launcher passes the human seat — D103(3)). */
  teamId: string
  /** Live picked ids (E17: drafted rows grey; the next save drops them). */
  draftedIds: ReadonlySet<string>
  className?: string
}

/**
 * MyQueue (§16.2 `my-queue`; §8.4; §15.6) — the caller's own `draft_queues`
 * rows (RLS read, never broadcast — §9.2) with drag-to-reorder. Reorder is
 * OPTIMISTIC (§15.6's table: the cache flips to the posted order, rolls
 * back on error — `useUpdateDraftQueue` owns it); every save is the
 * D113(3) whole-queue replace carrying only non-drafted ids, which is how
 * E17's "auto-removed" happens without a delete verb. Drafted rows render
 * greyed with a Drafted chip until then (E17's "greyed" arm — the picks
 * broadcast drives it through the room's cached rows, no refetch).
 */
export function MyQueue({ leagueId, draftId, teamId, draftedIds, className }: MyQueueProps) {
  const queue = useDraftQueue(draftId, teamId)
  const update = useUpdateDraftQueue(leagueId, draftId, teamId)
  const { playerById, isPending: identityPending } = usePlayersByIds(
    useMemo(() => (queue.data ?? []).map((row) => row.player_id), [queue.data]),
  )

  const view = useMemo(
    () => deriveQueueView(queue.data ?? [], draftedIds),
    [queue.data, draftedIds],
  )
  const saveIds = useMemo(() => orderedIdsForSave(view), [view])
  const allIds = useMemo(() => view.map((row) => row.player_id), [view])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const next = reorderIds(allIds, String(active.id), String(over.id))
    // Whole-queue replace with the drafted rows dropped (E17 auto-remove).
    update.mutate(next.filter((id) => !draftedIds.has(id)))
  }

  const handleRemove = (playerId: string) => {
    update.mutate(removeId(saveIds, playerId))
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>My Targets</CardTitle>
        <span className="fs-num text-[10px] font-semibold text-n-3">{saveIds.length}</span>
      </CardHeader>

      {queue.isPending ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : queue.isError ? (
        <p className="p-card-pad text-[12px] font-medium text-n-3" role="alert">
          Your Targets didn&rsquo;t load. They refresh automatically.
        </p>
      ) : view.length === 0 ? (
        // Timeouts-draft-from-the-queue is §8.4's rule — cited here, not in
        // user-facing copy (R268, M2 batch 13).
        <p className="p-card-pad text-[12px] font-medium text-n-3">
          Add players from the pool so a plan is ready when the clock hits
          you. Timeouts draft from the top of your Targets first.
        </p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5 p-2">
              {view.map((row, i) => (
                <QueueRow
                  key={row.player_id}
                  row={row}
                  ordinal={i + 1}
                  player={playerById.get(row.player_id)}
                  identityPending={identityPending}
                  onRemove={() => handleRemove(row.player_id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  )
}

function QueueRow({
  row,
  ordinal,
  player,
  identityPending,
  onRemove,
}: {
  row: QueueViewRow
  ordinal: number
  player: PlayerIdentity | undefined
  identityPending: boolean
  onRemove: () => void
}) {
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.player_id,
    disabled: row.drafted, // a drafted row has no order left to hold
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  if (!player) {
    return (
      <li ref={setNodeRef} style={style}>
        {identityPending ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex h-10 items-center justify-between rounded-sm border border-n-4 px-2 text-[11px] font-medium text-n-3">
            <span className="truncate">Unknown player ({row.player_id})</span>
            <button
              type="button"
              onClick={onRemove}
              className="shrink-0 font-bold hover:underline"
            >
              Remove
            </button>
          </div>
        )}
      </li>
    )
  }

  return (
    <li ref={setNodeRef} style={style} className={cn(row.drafted && 'opacity-50')}>
      <PlayerRow
        rank={ordinal}
        player={player}
        density="compact"
        draggable={!row.drafted}
        dragHandleProps={row.drafted ? undefined : { ...attributes, ...listeners }}
        isDragging={isDragging}
        onOpen={() => openPlayer(player.id)}
        onRemove={onRemove}
        nameBadge={
          row.drafted ? (
            <Badge variant="stroke" className="shrink-0">
              Drafted
            </Badge>
          ) : undefined
        }
      />
    </li>
  )
}
