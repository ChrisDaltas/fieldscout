'use client'

import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useState } from 'react'

import { PlayerCard } from '@/components/players/player-card'
import { foldersKeys } from '@/hooks/use-folders'
import { listsKeys } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { useListOrderStore } from '@/stores/list-order-store'

interface DragPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  projected_pts: number | null
}

// Nested droppables can both sit under the pointer. Prefer the most specific
// target: a tier zone (drop a player onto a tier) over the whole-list zone, and
// a list row (manual reorder) over the folder-root zone.
const collisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args)
  const preferred =
    collisions.find((c) => String(c.id).startsWith('tier-add:')) ??
    collisions.find((c) => String(c.id).startsWith('list-drag:'))
  return preferred ? [preferred] : collisions
}

/**
 * Top-level drag context wired into the app shell so players from any page
 * (Players spreadsheet, list detail, etc.) can be dropped onto a list in the
 * sidebar nav. The sidebar's `SidebarSubsection` registers each list row as a
 * `useDroppable` with id `list-drop:<listId>` — this handler intercepts drops
 * carrying a `kind: 'players'` payload and POSTs to the bulk-add endpoint.
 *
 * Each in-page DndContext (list detail's tier board, big board grid, etc.)
 * is independent; the global handler only fires when a drop targets a list
 * droppable. Cross-page drags wouldn't be caught by the inner contexts.
 */
export function AppDndContext({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [activePlayer, setActivePlayer] = useState<DragPlayer | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const clearActive = useCallback(() => {
    setActiveKind(null)
    setActiveLabel(null)
    setActivePlayer(null)
  }, [])

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | { kind?: string; playerIds?: string[]; label?: string; player?: DragPlayer }
      | undefined
    setActiveKind(data?.kind ?? null)
    const count = data?.playerIds?.length ?? 0
    setActiveLabel(count > 1 ? `${count} players` : (data?.label ?? null))
    // Single player drag → keep the player so the overlay shows a real card.
    setActivePlayer(count <= 1 ? (data?.player ?? null) : null)
  }, [])

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      clearActive()
      const { active, over } = event
      if (!over) return

      const overId = String(over.id)

      // A player dropped onto a specific tier of a tiered list: add it, then
      // move it to that tier. Id shape: `tier-add:<listId>:<tier>`
      // ('untiered' = no tier).
      if (overId.startsWith('tier-add:')) {
        const data = active.data.current as
          | { kind?: string; playerIds?: string[] }
          | undefined
        if (data?.kind !== 'players') return
        const playerIds = data.playerIds ?? []
        if (playerIds.length === 0) return
        const rest = overId.slice('tier-add:'.length)
        const sep = rest.lastIndexOf(':')
        const listId = rest.slice(0, sep)
        const tierRaw = rest.slice(sep + 1)
        const tier = tierRaw === 'untiered' ? null : tierRaw
        try {
          const res = await fetch(`/api/lists/${listId}/players/bulk`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ player_ids: playerIds }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
          if (tier) {
            await Promise.all(
              playerIds.map((pid) =>
                fetch(`/api/lists/${listId}/players/${pid}/tier`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ tier }),
                }),
              ),
            )
          }
          toast({ title: `Added to ${tier ?? 'Untiered'}` })
          qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
          qc.invalidateQueries({ queryKey: listsKeys.all })
        } catch (err) {
          toast({
            title: 'Could not add to list',
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          })
        }
        return
      }

      // Sidebar folder targets: a dragged list (`kind: 'list'`) dropped on
      // `folder-drop:<folderId>` moves into that folder; `folder-drop:root`
      // moves it back out.
      if (overId.startsWith('folder-drop:')) {
        const data = active.data.current as
          | { kind?: string; listId?: string; label?: string }
          | undefined
        if (data?.kind !== 'list' || !data.listId) return
        const target = overId.slice('folder-drop:'.length)
        const folderId = target === 'root' ? null : target
        try {
          const res = await fetch(`/api/lists/${data.listId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ folder_id: folderId }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
          toast({
            title: folderId ? 'Moved to folder' : 'Removed from folder',
            description: data.label,
          })
          qc.invalidateQueries({ queryKey: listsKeys.all })
          qc.invalidateQueries({ queryKey: foldersKeys.all })
        } catch (err) {
          toast({
            title: 'Could not move list',
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          })
        }
        return
      }

      // Manual reorder: a sidebar list (`kind: 'list'`) dropped onto another
      // list row reorders them in the persisted manual order.
      if (overId.startsWith('list-drag:')) {
        const data = active.data.current as
          | { kind?: string; listId?: string }
          | undefined
        if (data?.kind !== 'list' || !data.listId) return
        const overListId = overId.slice('list-drag:'.length)
        if (overListId && overListId !== data.listId) {
          useListOrderStore.getState().move(data.listId, overListId)
        }
        return
      }

      if (!overId.startsWith('list-drop:')) return
      // Ids are `list-drop:<listId>` (sidebar nav) or
      // `list-drop:detail:<listId>` (the list detail drop zone).
      const listId = overId.split(':').pop()!

      const data = active.data.current as
        | { kind?: string; playerIds?: string[]; label?: string }
        | undefined
      if (data?.kind !== 'players') return
      const playerIds = data.playerIds ?? []
      if (playerIds.length === 0) return

      try {
        const res = await fetch(`/api/lists/${listId}/players/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ player_ids: playerIds }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
        const inserted = (body as { inserted?: number }).inserted ?? 0
        const skipped = (body as { skipped?: number }).skipped ?? 0
        toast({
          title:
            inserted === 0
              ? 'Already on that list'
              : `Added ${inserted} player${inserted === 1 ? '' : 's'}`,
          description: skipped > 0 ? `${skipped} already on the list` : undefined,
        })
        qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
        qc.invalidateQueries({ queryKey: listsKeys.all })
      } catch (err) {
        toast({
          title: 'Could not add to list',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        })
      }
    },
    [qc, toast, clearActive],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={clearActive}
    >
      <div data-app-drag-active={activeKind ?? 'none'}>{children}</div>
      {/* Floating drag preview. A single player drags as a real PlayerCard
          following the cursor; lists / multi-select fall back to a chip. */}
      <DragOverlay dropAnimation={null}>
        {activeKind === 'players' && activePlayer ? (
          <div className="pointer-events-none w-40 cursor-grabbing">
            <PlayerCard
              rank={0}
              showRank={false}
              player={activePlayer}
              projectedPts={activePlayer.projected_pts}
              isDragging
            />
          </div>
        ) : (activeKind === 'players' || activeKind === 'list') && activeLabel ? (
          <div className="pointer-events-none inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-lg shadow-black/40">
            {activeLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
