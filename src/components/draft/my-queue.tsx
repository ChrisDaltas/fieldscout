'use client'

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
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

import { ActingAsPicker, type ActingAsControl } from './acting-as-picker'
import { targetsTitle } from './acting-as-ops'
import {
  deriveQueueView,
  orderedIdsForSave,
  removeId,
  reorderIds,
  targetsDragSentence,
  type QueueViewRow,
} from './my-queue-ops'

/**
 * The keyboard reorder (WCAG 2.1.1 — a drag needs a keyboard path; M7
 * L.F1.1, D621). Space/Enter lift a FOCUSED ROW, the arrows move it, Space
 * drops, Escape cancels. The row root carries the drag listeners AND
 * interactive children (the name button opens the player card, the Remove
 * button), and keydown bubbles: without this guard, Enter on the name button
 * would lift the row instead of opening the card. dnd-kit's own guard only
 * runs when a separate activator node is registered, and the shared
 * `player-row.tsx` registers none — so the guard lives here, not there.
 */
const baseKeyboardActivator = KeyboardSensor.activators[0]
class RowKeyboardSensor extends KeyboardSensor {
  static activators: typeof KeyboardSensor.activators = [
    {
      eventName: 'onKeyDown',
      handler: (event, options, context) =>
        event.target === event.currentTarget &&
        baseKeyboardActivator.handler(event, options, context),
    },
  ]
}

interface MyQueueProps {
  /** The room's scope league, `null` on a standalone practice draft —
   *  `useUpdateDraftQueue` routes to `/api/mocks/[mockId]/queue` then. */
  leagueId: string | null
  draftId: string
  /** My seat (a mock's launcher passes the human seat — D103(3)). */
  teamId: string
  /** Live picked ids (E17: drafted rows grey; the next save drops them). */
  draftedIds: ReadonlySet<string>
  /** F524: the commissioner's "acting as" control (null for everyone else). */
  actingAs?: ActingAsControl | null
  /** F524: the name of the team the commissioner acts for when `teamId` is
   *  not his own seat — the panel reads and writes THAT team's Targets
   *  (through the commissioner's doors) and says so. */
  actingForName?: string | null
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
export function MyQueue({
  leagueId,
  draftId,
  teamId,
  draftedIds,
  actingAs = null,
  actingForName = null,
  className,
}: MyQueueProps) {
  const forAnother = actingForName !== null && leagueId !== null
  const queue = useDraftQueue(
    draftId,
    teamId,
    forAnother && leagueId ? { asCommish: { leagueId } } : {},
  )
  const update = useUpdateDraftQueue(leagueId, draftId, teamId, forAnother)
  const { playerById, isPending: identityPending } = usePlayersByIds(
    useMemo(() => (queue.data ?? []).map((row) => row.player_id), [queue.data]),
  )

  const view = useMemo(
    () => deriveQueueView(queue.data ?? [], draftedIds),
    [queue.data, draftedIds],
  )
  const saveIds = useMemo(() => orderedIdsForSave(view), [view])
  const allIds = useMemo(() => view.map((row) => row.player_id), [view])

  // F73 (M7 L.F1.1, D621): touch reorder. The single PointerSensor was
  // inert on a phone — the browser claims a touch-move for scrolling and the
  // pointer stream cancels before the 5px activation. The house pairing
  // (lineup editor, lists v2, draft-order editor): Mouse for a mouse, Touch
  // with a press-and-hold so a plain swipe still scrolls the Targets list.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // dnd-kit's default announcements read the draggable id (a player id).
  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number) => playerById.get(String(id))?.full_name ?? 'Player'
    const placeOf = (id: string | number | undefined) => {
      if (id === undefined) return null
      const index = allIds.indexOf(String(id))
      return index < 0 ? null : index + 1
    }
    return {
      onDragStart: ({ active }) =>
        targetsDragSentence('start', nameOf(active.id), placeOf(active.id), allIds.length),
      onDragOver: ({ active, over }) =>
        targetsDragSentence('over', nameOf(active.id), placeOf(over?.id), allIds.length),
      onDragEnd: ({ active, over }) =>
        targetsDragSentence('end', nameOf(active.id), placeOf(over?.id), allIds.length),
      onDragCancel: ({ active }) =>
        targetsDragSentence('cancel', nameOf(active.id), null, allIds.length),
    }
  }, [playerById, allIds])

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
        <CardTitle>{targetsTitle(forAnother ? actingForName : null)}</CardTitle>
        <span className="fs-num text-[10px] font-semibold text-n-3">{saveIds.length}</span>
      </CardHeader>
      {actingAs && (
        <div className="px-card-pad pt-card-pad">
          <ActingAsPicker label="Targets for" control={actingAs} />
        </div>
      )}

      {queue.isPending ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : queue.isError ? (
        <p className="p-card-pad text-[11px] font-medium text-n-3" role="alert">
          {forAnother
            ? `${actingForName}’s Targets didn’t load. ${queue.error instanceof Error ? queue.error.message : ''}`
            : 'Your Targets didn’t load. They refresh automatically.'}
        </p>
      ) : view.length === 0 ? (
        // Timeouts-draft-from-the-queue is §8.4's rule — cited here, not in
        // user-facing copy (R268, M2 batch 13).
        <p className="px-card-pad py-8 text-center text-[11px] font-medium text-n-6">
          {forAnother
            ? `${actingForName} has no Targets yet. Add players from the pool — timeouts draft from the top of a team’s Targets first.`
            : 'Add players from the pool so a plan is ready when the clock hits you. Timeouts draft from the top of your Targets first.'}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements }}
        >
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
          <Skeleton className="h-10 w-full rounded-md" />
        ) : (
          <div className="flex h-10 items-center justify-between rounded-lg bg-surface-sunken px-2.5 text-[11px] font-medium text-n-3">
            <span className="truncate">Unknown player ({row.player_id})</span>
            <button
              type="button"
              onClick={onRemove}
              className="shrink-0 font-semibold text-accent hover:underline"
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
