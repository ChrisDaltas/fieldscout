'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DropAnimation,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRouter } from 'next/navigation'
import {
  Copy,
  LayoutGrid,
  LayoutList,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  Settings2,
  ThumbsUp,
  Trash2,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { CustomizeModal } from '@/components/lists/customize-modal'
import { EditableThumbnail } from '@/components/lists/editable-thumbnail'
import { TagChip } from '@/components/lists/tag-chip'
import { TierBadge } from '@/components/lists/tier-badge'
import { PlayerCard } from '@/components/players/player-card'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'
import { PositionBadge } from '@/components/players/position-badge'
import { PlayerRow } from '@/components/players/player-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  type ListPlayerWithPlayer,
  type ListWithDetails,
  useDeleteList,
  useDuplicateList,
  useRemovePlayer,
  useReorderPlayers,
  useSetPlayerSlot,
  useSetPlayerTier,
  useToggleFavorite,
  useToggleLike,
  useUpdateList,
} from '@/hooks/use-lists'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useToast } from '@/hooks/use-toast'
import {
  isCappedSlot,
  SLOT_ELIGIBILITY,
  SLOT_ORDER,
  STARTING_SLOTS,
  slotCapacity,
} from '@/lib/lists/roster'
import { LAST_SEASON } from '@/lib/stats/aggregate-fantasy'
import { cn } from '@/lib/utils'

import type { ListRosterSettings, ListTier, TeamSlot } from '@/types/database'

type ViewMode = 'cards' | 'comfortable' | 'compact'

const TIERS: ListTier[] = ['S', 'A', 'B', 'C', 'D', 'F']

/** Vertical lists feel much steadier when the drag can't wander sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

/**
 * Re-measure droppables while dragging — rows/tiers shift as the preview
 * moves, and stale rects are the main reason drops land in the wrong slot.
 */
// Always animate layout changes — including the moved item settling into its
// new slot after a drop — so cards slide into place instead of snapping.
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

// A slower, soft ease-out so the surrounding players glide aside to make room
// as the dragged card crosses each slot, rather than snapping/twitching. Only
// the non-dragged items use this — the active card still tracks the cursor.
const SORTABLE_TRANSITION = {
  duration: 320,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
}

// The floating drag clone settles into its dropped slot with the same soft
// ease, and the placeholder it leaves behind fades back to full opacity.
const DROP_ANIMATION: DropAnimation = {
  duration: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.3' } },
  }),
}

/** Layout for the players inside a tier — a card grid or a row stack. */
const TIER_LIST_CLASS = (viewMode: ViewMode) =>
  viewMode === 'cards'
    ? // Fixed 120px columns (no 1fr stretch) so the 120×112 cards never resize.
      'grid grid-cols-[repeat(auto-fill,120px)] justify-start gap-3'
    : 'space-y-0.5'

/** The inline PROJ / <season> / ADP stat cells shown on a comfortable list row. */
function rowStatsFor(entry: ListPlayerWithPlayer, density: ViewMode) {
  if (density === 'compact' || !entry.stats) return undefined
  const fantasy = entry.stats
  const adp = entry.player.adp
  return [
    {
      label: 'PROJ',
      value:
        typeof fantasy.projected_pts === 'number'
          ? fantasy.projected_pts.toFixed(1)
          : '—',
    },
    { label: String(LAST_SEASON), value: fantasy.last_pts.toFixed(1) },
    { label: 'ADP', value: typeof adp === 'number' ? adp.toFixed(1) : '—' },
  ]
}

const MEASURE_ALWAYS = {
  droppable: { strategy: MeasuringStrategy.Always },
} as const

type TierAddDrop = ReturnType<typeof useDroppable>

/**
 * App-level droppables (one per tier + untiered) so a player dragged from the
 * right-hand panel — which lives in the app-level DndContext, not the tier
 * board's inner context — can target a specific tier and highlight it. Called
 * in ListDetailView (above the tier board's own DndContext) so the droppables
 * register with the app context; their refs get attached onto the tier rows.
 */
function useTierAddDroppables(listId: string): Record<string, TierAddDrop> {
  const S = useDroppable({ id: `tier-add:${listId}:S` })
  const A = useDroppable({ id: `tier-add:${listId}:A` })
  const B = useDroppable({ id: `tier-add:${listId}:B` })
  const C = useDroppable({ id: `tier-add:${listId}:C` })
  const D = useDroppable({ id: `tier-add:${listId}:D` })
  const F = useDroppable({ id: `tier-add:${listId}:F` })
  const untiered = useDroppable({ id: `tier-add:${listId}:untiered` })
  return { S, A, B, C, D, F, untiered }
}

/** True when a player from the panel is being dragged over this tier zone. */
function isPlayerDragOver(drop: TierAddDrop): boolean {
  if (!drop.isOver) return false
  const kind = (drop.active?.data.current as { kind?: string } | undefined)?.kind
  return kind === 'players'
}

interface ListDetailViewProps {
  list: ListWithDetails
  isOwner: boolean
}

export function ListDetailView({ list, isOwner }: ListDetailViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const openPlayerWindow = usePlayerWindowsStore((s) => s.open)
  // Opening a player from an owned list passes the list context so the window's
  // actions include "Remove from list".
  const openPlayer = useCallback(
    (playerId: string) =>
      openPlayerWindow(playerId, {
        listContext: isOwner ? { listId: list.id, listTitle: list.title } : null,
      }),
    [openPlayerWindow, isOwner, list.id, list.title],
  )
  // The player the user has clicked to "select" — highlighted, and movable
  // up/down with the arrow keys. null = nothing selected.
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  // The player currently being dragged in the plain list view — drives the
  // floating DragOverlay clone. null = not dragging.
  const [listDragId, setListDragId] = useState<string | null>(null)

  const reorder = useReorderPlayers(list.id)
  const removePlayer = useRemovePlayer(list.id)
  const toggleLike = useToggleLike(list.id)
  const toggleFavorite = useToggleFavorite()
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const setPlayerTier = useSetPlayerTier(list.id)
  const setPlayerSlot = useSetPlayerSlot(list.id)
  const updateList = useUpdateList(list.id)
  const draft = useDraftMode(list.id)

  const handleDuplicate = () => {
    duplicateList.mutate(list.id, {
      onSuccess: (copy) => {
        toast({ title: 'Duplicated', description: copy.title })
        router.push(`/app/lists/${copy.id}`)
      },
      onError: (err) =>
        toast({
          title: 'Could not duplicate',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  const handleConfirmDelete = () => {
    deleteList.mutate(list.id, {
      onSuccess: () => {
        toast({ title: 'List deleted', description: list.title })
        setDeleteOpen(false)
        router.push('/app/lists')
      },
      onError: (err) =>
        toast({
          title: 'Could not delete',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  const players = list.players
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Drop target for players dragged from the right-hand player bar (or any
  // other `kind: 'players'` source). Registers with the app-level
  // DndContext — the sortable contexts below are independent of it.
  const playerDrop = useDroppable({
    id: `list-drop:detail:${list.id}`,
    disabled: !isOwner,
  })
  const playerDropActive =
    isOwner &&
    (playerDrop.active?.data.current as { kind?: string } | undefined)?.kind ===
      'players'

  // Per-tier app-level drop zones (used only by tiered lists) so a panel drag
  // can target and highlight a specific tier.
  const tierAddDrops = useTierAddDroppables(list.id)

  const orderedIds = useMemo(() => players.map((p) => p.player_id), [players])

  const handleListReorder = (event: DragEndEvent) => {
    if (!isOwner || list.tiers_enabled) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = orderedIds.indexOf(String(active.id))
    const newIdx = orderedIds.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    const next = arrayMove(orderedIds, oldIdx, newIdx)
    const positions = next.map((playerId, i) => ({ playerId, position: i + 1 }))
    reorder.mutate(positions, {
      onError: (err) =>
        toast({
          title: 'Could not save order',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  const handleTierDrop = (playerId: string, tier: ListTier | null) => {
    if (!isOwner) return
    setPlayerTier.mutate(
      { playerId, tier },
      {
        onError: (err) =>
          toast({
            title: 'Could not move tier',
            description: err.message,
            variant: 'destructive',
          }),
      },
    )
  }

  const handleSlotDrop = (playerId: string, slot: TeamSlot) => {
    if (!isOwner) return
    setPlayerSlot.mutate(
      { playerId, slot },
      {
        onError: (err) =>
          toast({
            title: 'Could not move player',
            description: err.message,
            variant: 'destructive',
          }),
      },
    )
  }

  const onRemove = (playerId: string, name: string) => {
    removePlayer.mutate(playerId, {
      onSuccess: () => toast({ title: `Removed ${name}` }),
      onError: (err) =>
        toast({
          title: 'Could not remove',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  // --- Ordering helpers shared by drag and keyboard moves -------------------

  // Persist a new top-to-bottom order (positions 1..N). When `movedId`'s tier
  // changed, `newTier` is also written. Pass `newTier: undefined` to leave
  // tiers untouched (a pure within-tier / list reorder).
  const commitOrder = useCallback(
    (
      ordered: ListPlayerWithPlayer[],
      movedId: string,
      newTier: ListTier | null | undefined,
    ) => {
      if (newTier !== undefined) {
        const moved = players.find((p) => p.player_id === movedId)
        if (moved && ((moved.tier as ListTier | null) ?? null) !== newTier) {
          setPlayerTier.mutate({ playerId: movedId, tier: newTier })
        }
      }
      const positions = ordered.map((p, i) => ({
        playerId: p.player_id,
        position: i + 1,
      }))
      reorder.mutate(positions, {
        onError: (err) =>
          toast({
            title: 'Could not save order',
            description: err.message,
            variant: 'destructive',
          }),
      })
    },
    [players, reorder, setPlayerTier, toast],
  )

  // Group players by tier key ('S'..'F' or 'untiered'), preserving order.
  const groupByTier = useCallback(() => {
    const groups = new Map<string, ListPlayerWithPlayer[]>()
    for (const t of TIERS) groups.set(t, [])
    groups.set('untiered', [])
    for (const p of players) {
      groups.get(((p.tier as ListTier | null) ?? 'untiered') as string)!.push(p)
    }
    return groups
  }, [players])

  const flattenGroups = (groups: Map<string, ListPlayerWithPlayer[]>) =>
    [...TIERS, 'untiered'].flatMap((k) => groups.get(k) ?? [])

  // Reorder within a single tier (used when a tier drag drops onto a player in
  // the same tier — the drop's tier is unchanged so onTierDrop wouldn't fire).
  const handleTierReorder = useCallback(
    (activeId: string, overId: string) => {
      if (!isOwner) return
      const a = players.find((p) => p.player_id === activeId)
      const b = players.find((p) => p.player_id === overId)
      if (!a || !b) return
      const key = ((a.tier as ListTier | null) ?? 'untiered') as string
      if (key !== (((b.tier as ListTier | null) ?? 'untiered') as string)) return
      const groups = groupByTier()
      const members = groups.get(key)!
      const from = members.findIndex((p) => p.player_id === activeId)
      const to = members.findIndex((p) => p.player_id === overId)
      if (from < 0 || to < 0 || from === to) return
      groups.set(key, arrayMove(members, from, to))
      commitOrder(flattenGroups(groups), activeId, undefined)
    },
    [isOwner, players, groupByTier, commitOrder],
  )

  // Move the selected player one slot up/down. In a tiered list, hitting the
  // edge of a tier carries the player into the adjacent tier.
  const moveSelected = useCallback(
    (dir: 1 | -1) => {
      const id = selectedPlayerId
      if (!id || !isOwner || list.hide_order || list.is_team) return

      const tiered = Boolean(list.tiers_enabled)
      if (!tiered) {
        const idx = players.findIndex((p) => p.player_id === id)
        const to = idx + dir
        if (idx < 0 || to < 0 || to >= players.length) return
        commitOrder(arrayMove(players, idx, to), id, undefined)
        return
      }

      const SEQ: string[] = [...TIERS, 'untiered']
      const groups = groupByTier()
      const curKey = ((players.find((p) => p.player_id === id)?.tier as
        | ListTier
        | null) ?? 'untiered') as string
      const members = groups.get(curKey)!
      const pos = members.findIndex((p) => p.player_id === id)
      if (pos < 0) return

      if (dir === 1 ? pos < members.length - 1 : pos > 0) {
        // Within the current tier.
        groups.set(curKey, arrayMove(members, pos, pos + dir))
        commitOrder(flattenGroups(groups), id, undefined)
        return
      }

      // At the edge — carry into the adjacent tier.
      const targetKey = SEQ[SEQ.indexOf(curKey) + dir]
      if (!targetKey) return
      const moved = members[pos]
      groups.set(
        curKey,
        members.filter((p) => p.player_id !== id),
      )
      const target = groups.get(targetKey)!
      if (dir === 1) target.unshift(moved)
      else target.push(moved)
      commitOrder(
        flattenGroups(groups),
        id,
        targetKey === 'untiered' ? null : (targetKey as ListTier),
      )
    },
    [
      selectedPlayerId,
      isOwner,
      list.hide_order,
      list.is_team,
      list.tiers_enabled,
      players,
      groupByTier,
      commitOrder,
    ],
  )

  // Arrow-key moves + Escape to deselect, active only while a player is
  // selected and not typing in a field.
  useEffect(() => {
    if (!selectedPlayerId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPlayerId(null)
        return
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const ae = document.activeElement as HTMLElement | null
      const tag = ae?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) return
      e.preventDefault()
      moveSelected(e.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPlayerId, moveSelected])

  const toggleSelected = (playerId: string) =>
    setSelectedPlayerId((cur) => (cur === playerId ? null : playerId))

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-4">
            <EditableThumbnail
              listId={list.id}
              positionFilter={list.position_filter}
              isTeam={list.is_team ?? false}
              imageUrl={list.thumbnail_url}
              players={list.players.slice(0, 3).map((p) => ({
                id: p.player.id,
                full_name: p.player.full_name,
                team: p.player.team,
                headshot_url: p.player.headshot_url,
                position: p.player.position,
              }))}
              editable={isOwner}
              className="hidden sm:inline-flex"
            />
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 empty:hidden">
                {list.is_big_board && (
                  <Badge className="border-bg-elevated-3 bg-bg-elevated-2 text-[10px] font-semibold text-foreground">
                    Big Board
                  </Badge>
                )}
                {list.position_filter && (
                  <PositionBadge
                    position={
                      list.position_filter === 'DEF' ? 'DST' : list.position_filter
                    }
                    size="sm"
                  />
                )}
                {list.hide_order && (
                  <Badge
                    variant="default"
                    className="border-bg-elevated-3 text-[10px] text-text-secondary"
                  >
                    Unranked
                  </Badge>
                )}
                {list.tiers_enabled && (
                  <Badge
                    variant="default"
                    className="border-bg-elevated-3 text-[10px] text-text-secondary"
                  >
                    Tiers
                  </Badge>
                )}
                {draft.enabled && (
                  <Badge
                    variant="default"
                    className="border-bg-elevated-3 text-[10px] text-text-secondary"
                  >
                    Draft
                  </Badge>
                )}
                {list.is_private && (
                  <Badge
                    variant="default"
                    className="border-bg-elevated-3 text-[10px] text-text-secondary"
                  >
                    <Lock className="mr-1 h-3 w-3" /> Private
                  </Badge>
                )}
              </div>
              <EditableTitle
                title={list.title}
                editable={isOwner && !list.is_big_board}
                onSave={(next) =>
                  updateList.mutate(
                    { title: next },
                    {
                      onError: (err) =>
                        toast({
                          title: 'Could not rename',
                          description: err.message,
                          variant: 'destructive',
                        }),
                    },
                  )
                }
              />
              {list.description && (
                <p className="mt-1 max-w-2xl text-sm text-text-secondary">
                  {list.description}
                </p>
              )}
              <p className="mt-2 text-xs text-text-secondary">
                {list.player_count} player{list.player_count === 1 ? '' : 's'}
                {' · '}
                {list.like_count}
                {list.like_count === 1 ? ' thumbs up' : ' thumbs ups'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="invisible"
              onClick={() =>
                toggleFavorite.mutate(list.id, {
                  onError: (err) =>
                    toast({
                      title: 'Could not pin',
                      description: err.message,
                      variant: 'destructive',
                    }),
                })
              }
              className="text-text-secondary hover:text-foreground"
              aria-label={list.is_favorited ? 'Unpin' : 'Pin'}
              aria-pressed={list.is_favorited ?? false}
            >
              <Pin
                className={cn(
                  'mr-1.5 h-4 w-4',
                  list.is_favorited && 'fill-foreground',
                )}
              />
              {list.is_favorited ? 'Pinned' : 'Pin'}
            </Button>
            <Button
              variant="invisible"
              onClick={() =>
                toggleLike.mutate(undefined, {
                  onError: (err) =>
                    toast({
                      title: 'Could not upvote',
                      description: err.message,
                      variant: 'destructive',
                    }),
                })
              }
              className="text-text-secondary hover:text-foreground"
              aria-label="Upvote"
            >
              <ThumbsUp className="mr-1.5 h-4 w-4" />
              <span className="tabular-nums">{list.like_count}</span>
            </Button>
            {isOwner && (
              <Button
                variant="invisible"
                onClick={() => setCustomizeOpen(true)}
                className="text-text-secondary hover:text-foreground"
              >
                <Settings2 className="mr-1.5 h-4 w-4" /> Customize
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="invisible"
                  className="text-text-secondary hover:text-foreground"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="mr-1.5 h-4 w-4" /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-bg-elevated-2 bg-bg-elevated"
              >
                <DropdownMenuItem
                  disabled={duplicateList.isPending}
                  onSelect={handleDuplicate}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                {isOwner && !list.is_big_board && (
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {list.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {list.tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} slug={tag.slug} />
            ))}
          </div>
        )}
      </header>

      <Toolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        showViewModes={!list.is_team}
        // Tiers is a view mode, not a property of the list — flip it any time.
        tiersOn={
          isOwner && !list.is_team && !list.hide_order
            ? list.tiers_enabled
            : null
        }
        onTiersChange={(next) =>
          // Drive ranking_mode (the source of truth) so hide_order/tiers_enabled
          // stay in sync. Players are never touched — turning tiers on just
          // regroups them; everything starts in the Untiered section.
          updateList.mutate(
            { ranking_mode: next ? 'rank_and_tier' : 'ranked' },
            {
              onError: (err) =>
                toast({
                  title: 'Could not save',
                  description: err.message,
                  variant: 'destructive',
                }),
            },
          )
        }
      />

      <div
        ref={playerDrop.setNodeRef}
        className={cn(
          'rounded-lg transition-all',
          playerDropActive && 'p-2 ring-1 ring-foreground/30 ring-offset-0',
          playerDropActive && playerDrop.isOver && 'bg-foreground/5 ring-foreground/60',
        )}
      >
      {players.length === 0 ? (
        <EmptyState isOwner={isOwner} />
      ) : list.is_team ? (
        <PositionBoard
          players={players}
          roster={list.roster_settings as ListRosterSettings | null}
          isOwner={isOwner}
          density={viewMode === 'compact' ? 'compact' : 'comfortable'}
          onSlotDrop={handleSlotDrop}
          onRemove={onRemove}
          onOpenPlayer={openPlayer}
          onIneligibleDrop={(playerName, slot) =>
            toast({
              title: 'Not eligible',
              description: `${playerName} can't fill the ${slot} slot.`,
              variant: 'destructive',
            })
          }
          onSlotFull={(slot, capacity) =>
            toast({
              title: 'Lineup spot full',
              description: `Your ${SLOT_LABELS[slot]} slot is full (${capacity}/${capacity}). Bench someone first.`,
              variant: 'destructive',
            })
          }
        />
      ) : list.tiers_enabled && !list.hide_order ? (
        <TierBoard
          players={players}
          isOwner={isOwner}
          viewMode={viewMode}
          draftedSet={draft.drafted}
          draftMode={draft.enabled}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={toggleSelected}
          onReorderWithinTier={handleTierReorder}
          onTierDrop={handleTierDrop}
          onTogglePlayerDrafted={draft.toggleDrafted}
          onRemove={onRemove}
          onOpenPlayer={openPlayer}
          tierAddDrops={tierAddDrops}
        />
      ) : viewMode === 'cards' ? (
        <CardGrid
          players={players}
          isOwner={isOwner && !list.hide_order}
          draftedSet={draft.drafted}
          draftMode={draft.enabled}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={toggleSelected}
          onTogglePlayerDrafted={draft.toggleDrafted}
          onListReorder={handleListReorder}
          sensors={sensors}
          onOpenPlayer={openPlayer}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={(e) => setListDragId(String(e.active.id))}
          onDragEnd={(e) => {
            setListDragId(null)
            handleListReorder(e)
          }}
          onDragCancel={() => setListDragId(null)}
        >
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {players.map((p, i) => (
                <SortablePlayer
                  key={p.player_id}
                  rank={i + 1}
                  entry={p}
                  density={viewMode}
                  draggable={isOwner && !list.hide_order}
                  drafted={draft.drafted.has(p.player_id)}
                  draftMode={draft.enabled}
                  selected={selectedPlayerId === p.player_id}
                  usingOverlay
                  onSelect={
                    isOwner && !list.hide_order
                      ? () => toggleSelected(p.player_id)
                      : undefined
                  }
                  onToggleDrafted={
                    draft.enabled ? () => draft.toggleDrafted(p.player_id) : undefined
                  }
                  onRemove={
                    isOwner ? () => onRemove(p.player_id, p.player.full_name) : undefined
                  }
                  onOpen={() => openPlayer(p.player_id)}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay dropAnimation={DROP_ANIMATION}>
            {(() => {
              if (!listDragId) return null
              const idx = players.findIndex((p) => p.player_id === listDragId)
              if (idx < 0) return null
              const p = players[idx]
              return (
                <PlayerRow
                  rank={idx + 1}
                  player={p.player}
                  density={viewMode === 'compact' ? 'compact' : 'comfortable'}
                  stats={rowStatsFor(p, viewMode)}
                  isDragging
                  className="bg-bg-elevated-2"
                />
              )
            })()}
          </DragOverlay>
        </DndContext>
      )}
      </div>

      <CustomizeModal
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        draftMode={draft.enabled}
        onDraftModeChange={(next) => {
          draft.setEnabled(next)
          if (!next) draft.clearDrafted()
        }}
      />

      {isOwner && !list.is_big_board && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="border-bg-elevated-2 bg-bg-elevated sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this list?</DialogTitle>
              <DialogDescription>
                <span className="font-semibold text-foreground">
                  {list.title}
                </span>{' '}
                will be moved to your Trash. You can restore it from there until
                it&apos;s permanently removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="invisible"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteList.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleteList.isPending}
              >
                {deleteList.isPending ? 'Deleting…' : 'Yes, Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Toolbar({
  viewMode,
  onViewMode,
  showViewModes = true,
  tiersOn = null,
  onTiersChange,
}: {
  viewMode: ViewMode
  onViewMode: (next: ViewMode) => void
  showViewModes?: boolean
  /** null hides the switch (team lists, unranked lists, non-owners). */
  tiersOn?: boolean | null
  onTiersChange?: (next: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
      {showViewModes ? (
        <div className="flex items-center gap-1 rounded-full border border-bg-elevated-2 bg-bg-elevated p-1">
          <ViewButton
            icon={<LayoutGrid className="h-4 w-4" />}
            label="Card"
            active={viewMode === 'cards'}
            onClick={() => onViewMode('cards')}
          />
          <ViewButton
            icon={<LayoutList className="h-4 w-4" />}
            label="List"
            active={viewMode === 'comfortable'}
            onClick={() => onViewMode('comfortable')}
          />
        </div>
      ) : (
        <div />
      )}

      <div className="flex items-center gap-2">
        {tiersOn !== null && onTiersChange && (
          <button
            type="button"
            role="switch"
            aria-checked={tiersOn}
            onClick={() => onTiersChange(!tiersOn)}
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <span
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                tiersOn ? 'bg-foreground' : 'bg-bg-elevated-3',
              )}
            >
              <span
                className={cn(
                  'absolute h-4 w-4 rounded-full transition-transform',
                  tiersOn
                    ? 'translate-x-4 bg-background'
                    : 'translate-x-0.5 bg-foreground',
                )}
              />
            </span>
            <span className={cn('font-medium', tiersOn && 'text-foreground')}>
              Tiers
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

function ViewButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-7 w-8 items-center justify-center rounded-full transition-colors',
        active
          ? 'bg-bg-elevated-3 text-foreground'
          : 'text-text-secondary hover:text-foreground',
      )}
    >
      {icon}
    </button>
  )
}

function SortablePlayer({
  rank,
  entry,
  density,
  draggable,
  drafted,
  draftMode,
  selected = false,
  usingOverlay = false,
  onSelect,
  onToggleDrafted,
  onRemove,
  onOpen,
  slotAction,
}: {
  rank: number
  entry: ListPlayerWithPlayer
  density: ViewMode
  draggable: boolean
  drafted: boolean
  draftMode: boolean
  selected?: boolean
  /** When the context renders a DragOverlay clone, the in-list row becomes a
   *  faint placeholder instead of the lifted-card look. */
  usingOverlay?: boolean
  onSelect?: () => void
  onToggleDrafted?: () => void
  onRemove?: () => void
  onOpen?: () => void
  /** Team lists only: a hover-revealed Start/Bench lineup toggle. */
  slotAction?: { label: 'Start' | 'Bench'; onClick: () => void }
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: entry.player_id,
      disabled: !draggable,
      animateLayoutChanges,
      transition: SORTABLE_TRANSITION,
    })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: usingOverlay && isDragging ? 0.3 : undefined,
  }

  const rowStats = rowStatsFor(entry, density)

  return (
    <li ref={setNodeRef} style={style}>
      {density === 'cards' ? (
        <PlayerCard
          rank={rank}
          player={entry.player}
          projectedPts={entry.stats?.projected_pts ?? null}
          onOpen={onOpen}
          draggable={draggable}
          dragHandleProps={{ ...attributes, ...listeners }}
          isDragging={usingOverlay ? false : isDragging}
          selected={selected}
          onSelect={onSelect}
          drafted={drafted}
          draftMode={draftMode}
          onToggleDrafted={onToggleDrafted}
          size="compact"
          onRemove={onRemove}
        />
      ) : (
        <div className={cn(drafted && 'opacity-50')}>
          <PlayerRow
            rank={rank}
            player={entry.player}
            density={density === 'compact' ? 'compact' : 'comfortable'}
            draggable={draggable}
            dragHandleProps={{ ...attributes, ...listeners }}
            isDragging={usingOverlay ? false : isDragging}
            selected={selected}
            onSelect={onSelect}
            onRemove={onRemove}
            onOpen={onOpen}
            stats={rowStats}
            trailing={
              draftMode ? (
                <button
                  type="button"
                  onClick={onToggleDrafted}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    'rounded-full px-2 py-1 text-[10px] font-semibold opacity-0 transition-all focus-visible:opacity-100 group-hover:opacity-100',
                    drafted
                      ? 'bg-bg-elevated-3 text-text-secondary'
                      : 'bg-foreground text-background hover:bg-foreground/90',
                  )}
                >
                  {drafted ? 'Drafted' : 'Mark drafted'}
                </button>
              ) : slotAction ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    slotAction.onClick()
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-semibold opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100',
                    slotAction.label === 'Start'
                      ? 'bg-foreground text-background hover:bg-foreground/90'
                      : 'bg-bg-elevated-3 text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground',
                  )}
                >
                  {slotAction.label}
                </button>
              ) : null
            }
            className={drafted ? 'line-through' : undefined}
          />
        </div>
      )}
    </li>
  )
}

function CardGrid({
  players,
  isOwner,
  draftedSet,
  draftMode,
  selectedPlayerId,
  onSelectPlayer,
  onTogglePlayerDrafted,
  onListReorder,
  sensors,
  onOpenPlayer,
}: {
  players: ListPlayerWithPlayer[]
  isOwner: boolean
  draftedSet: Set<string>
  draftMode: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  onTogglePlayerDrafted: (playerId: string) => void
  onListReorder: (event: DragEndEvent) => void
  sensors: ReturnType<typeof useSensors>
  onOpenPlayer: (playerId: string) => void
}) {
  const ids = players.map((p) => p.player_id)
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdx = dragId ? players.findIndex((p) => p.player_id === dragId) : -1
  const dragging = dragIdx >= 0 ? players[dragIdx] : null
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragEnd={(e) => {
        setDragId(null)
        onListReorder(e)
      }}
      onDragCancel={() => setDragId(null)}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
          {players.map((p, i) => (
            <SortableCard
              key={p.player_id}
              rank={i + 1}
              entry={p}
              draggable={isOwner}
              drafted={draftedSet.has(p.player_id)}
              draftMode={draftMode}
              selected={selectedPlayerId === p.player_id}
              onSelect={isOwner ? () => onSelectPlayer(p.player_id) : undefined}
              onToggleDrafted={() => onTogglePlayerDrafted(p.player_id)}
              onOpen={() => onOpenPlayer(p.player_id)}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {dragging ? (
          <PlayerCard
            rank={dragIdx + 1}
            player={dragging.player}
            projectedPts={dragging.stats?.projected_pts ?? null}
            isDragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function SortableCard({
  rank,
  entry,
  draggable,
  drafted,
  draftMode,
  selected = false,
  onSelect,
  onToggleDrafted,
  onOpen,
}: {
  rank: number
  entry: ListPlayerWithPlayer
  draggable: boolean
  drafted: boolean
  draftMode: boolean
  selected?: boolean
  onSelect?: () => void
  onToggleDrafted: () => void
  onOpen?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: entry.player_id,
      disabled: !draggable,
      animateLayoutChanges,
      transition: SORTABLE_TRANSITION,
    })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // The DragOverlay clone is the visible card while dragging; the original
    // stays in the grid as a faint placeholder marking the open slot.
    opacity: isDragging ? 0.3 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style}>
      <PlayerCard
        rank={rank}
        player={entry.player}
        projectedPts={entry.stats?.projected_pts ?? null}
        onOpen={onOpen}
        draggable={draggable}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={false}
        selected={selected}
        onSelect={onSelect}
        drafted={drafted}
        draftMode={draftMode}
        onToggleDrafted={onToggleDrafted}
      />
    </li>
  )
}

interface TierBoardProps {
  players: ListPlayerWithPlayer[]
  isOwner: boolean
  viewMode: ViewMode
  draftedSet: Set<string>
  draftMode: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  onReorderWithinTier: (activeId: string, overId: string) => void
  onTierDrop: (playerId: string, tier: ListTier | null) => void
  onTogglePlayerDrafted: (playerId: string) => void
  onRemove: (playerId: string, name: string) => void
  onOpenPlayer: (playerId: string) => void
  tierAddDrops: Record<string, TierAddDrop>
}

function TierBoard({
  players,
  isOwner,
  viewMode,
  draftedSet,
  draftMode,
  selectedPlayerId,
  onSelectPlayer,
  onReorderWithinTier,
  onTierDrop,
  onTogglePlayerDrafted,
  onRemove,
  onOpenPlayer,
  tierAddDrops,
}: TierBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const grouped = useMemo(() => {
    const map = new Map<string, ListPlayerWithPlayer[]>()
    for (const tier of TIERS) map.set(tier, [])
    map.set('untiered', [])
    for (const p of players) {
      const key = (p.tier as ListTier | null) ?? 'untiered'
      map.get(key as string)!.push(p)
    }
    return map
  }, [players])

  const handleDragEnd = (event: DragEndEvent) => {
    if (!isOwner) return
    const { active, over } = event
    if (!over) return

    const playerId = String(active.id)
    const overData = over.data.current as { tier?: ListTier | null } | undefined
    const overIsContainer =
      typeof over.id === 'string' && over.id.startsWith('tier:')

    let newTier: ListTier | null | undefined
    if (overIsContainer) {
      newTier = (overData?.tier as ListTier | null | undefined) ?? null
    } else {
      const target = players.find((p) => p.player_id === String(over.id))
      newTier = target ? ((target.tier as ListTier | null) ?? null) : undefined
    }
    if (newTier === undefined) return

    const player = players.find((p) => p.player_id === playerId)
    if (!player) return
    if (((player.tier as ListTier | null) ?? null) === newTier) {
      // Same tier — a drop onto another player reorders within the tier
      // (the tier itself is unchanged, so onTierDrop would be a no-op).
      if (!overIsContainer && String(over.id) !== playerId) {
        onReorderWithinTier(playerId, String(over.id))
      }
      return
    }
    onTierDrop(playerId, newTier)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={MEASURE_ALWAYS}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        {/* Untiered sits at the TOP so that right after enabling tiers (when
            every player is untiered) they're immediately visible and can be
            dragged down into S, A, … rather than hidden below empty tiers. */}
        {(grouped.get('untiered') ?? []).length > 0 && (
          <UntieredRow
            players={grouped.get('untiered') ?? []}
            isOwner={isOwner}
            viewMode={viewMode}
            draftedSet={draftedSet}
            draftMode={draftMode}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={onSelectPlayer}
            onTogglePlayerDrafted={onTogglePlayerDrafted}
            onRemove={onRemove}
            onOpenPlayer={onOpenPlayer}
            tierAddDrop={tierAddDrops.untiered}
          />
        )}
        {TIERS.map((tier) => (
          <TierRow
            key={tier}
            tier={tier}
            players={grouped.get(tier) ?? []}
            isOwner={isOwner}
            viewMode={viewMode}
            draftedSet={draftedSet}
            draftMode={draftMode}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={onSelectPlayer}
            onTogglePlayerDrafted={onTogglePlayerDrafted}
            onRemove={onRemove}
            onOpenPlayer={onOpenPlayer}
            tierAddDrop={tierAddDrops[tier]}
          />
        ))}
      </div>
    </DndContext>
  )
}

function TierRow({
  tier,
  players,
  isOwner,
  viewMode,
  draftedSet,
  draftMode,
  selectedPlayerId,
  onSelectPlayer,
  onTogglePlayerDrafted,
  onRemove,
  onOpenPlayer,
  tierAddDrop,
}: {
  tier: ListTier
  players: ListPlayerWithPlayer[]
  isOwner: boolean
  viewMode: ViewMode
  draftedSet: Set<string>
  draftMode: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  onTogglePlayerDrafted: (playerId: string) => void
  onRemove: (playerId: string, name: string) => void
  onOpenPlayer: (playerId: string) => void
  tierAddDrop: TierAddDrop
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `tier:${tier}`,
    data: { tier },
  })
  // Merge the app-level tier-add droppable ref so a panel drag can target this
  // tier; highlight when reordering over it OR dropping a panel player on it.
  const tierAddSetRef = tierAddDrop.setNodeRef
  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node)
      tierAddSetRef(node)
    },
    [setNodeRef, tierAddSetRef],
  )
  const highlight = isOver || isPlayerDragOver(tierAddDrop)

  return (
    <section>
      <div className="px-1 pb-1.5">
        <TierBadge tier={tier} />
      </div>
      <div
        ref={setRefs}
        className={cn(
          'rounded-md bg-white/[0.03] p-1 transition-colors',
          highlight && 'bg-foreground/10 ring-1 ring-foreground/40',
        )}
      >
        <SortableContext
          items={players.map((p) => p.player_id)}
          strategy={
            viewMode === 'cards'
              ? rectSortingStrategy
              : verticalListSortingStrategy
          }
        >
          {players.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-text-tertiary">
              Drop players here
            </p>
          ) : (
            <ul className={TIER_LIST_CLASS(viewMode)}>
              {players.map((p) => (
                <SortablePlayer
                  key={p.player_id}
                  rank={p.position}
                  entry={p}
                  density={viewMode}
                  draggable={isOwner}
                  drafted={draftedSet.has(p.player_id)}
                  draftMode={draftMode}
                  selected={selectedPlayerId === p.player_id}
                  onSelect={isOwner ? () => onSelectPlayer(p.player_id) : undefined}
                  onToggleDrafted={() => onTogglePlayerDrafted(p.player_id)}
                  onRemove={
                    isOwner
                      ? () => onRemove(p.player_id, p.player.full_name)
                      : undefined
                  }
                  onOpen={() => onOpenPlayer(p.player_id)}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      </div>
    </section>
  )
}

function UntieredRow({
  players,
  isOwner,
  viewMode,
  draftedSet,
  draftMode,
  selectedPlayerId,
  onSelectPlayer,
  onTogglePlayerDrafted,
  onRemove,
  onOpenPlayer,
  tierAddDrop,
}: {
  players: ListPlayerWithPlayer[]
  isOwner: boolean
  viewMode: ViewMode
  draftedSet: Set<string>
  draftMode: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  onTogglePlayerDrafted: (playerId: string) => void
  onRemove: (playerId: string, name: string) => void
  onOpenPlayer: (playerId: string) => void
  tierAddDrop: TierAddDrop
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'tier:untiered',
    data: { tier: null },
  })
  const tierAddSetRef = tierAddDrop.setNodeRef
  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node)
      tierAddSetRef(node)
    },
    [setNodeRef, tierAddSetRef],
  )
  const highlight = isOver || isPlayerDragOver(tierAddDrop)

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        Untiered
      </h3>
      <div
        ref={setRefs}
        className={cn(
          'rounded-md bg-white/[0.03] p-1 transition-colors',
          highlight && 'bg-foreground/10 ring-1 ring-foreground/40',
        )}
      >
        <SortableContext
          items={players.map((p) => p.player_id)}
          strategy={
            viewMode === 'cards'
              ? rectSortingStrategy
              : verticalListSortingStrategy
          }
        >
          <ul className={TIER_LIST_CLASS(viewMode)}>
            {players.map((p) => (
              <SortablePlayer
                key={p.player_id}
                rank={p.position}
                entry={p}
                density={viewMode}
                draggable={isOwner}
                drafted={draftedSet.has(p.player_id)}
                draftMode={draftMode}
                selected={selectedPlayerId === p.player_id}
                onSelect={isOwner ? () => onSelectPlayer(p.player_id) : undefined}
                onToggleDrafted={() => onTogglePlayerDrafted(p.player_id)}
                onRemove={
                  isOwner ? () => onRemove(p.player_id, p.player.full_name) : undefined
                }
                onOpen={() => onOpenPlayer(p.player_id)}
              />
            ))}
          </ul>
        </SortableContext>
      </div>
    </section>
  )
}

// =============================================================================
// Position board — the team-list replacement for tiers. Players are grouped
// into roster slots (QB → Bench); a player with no slot yet shows on the
// bench. Drag a player onto a slot row to assign them.
// =============================================================================

// Slot order, eligibility, and capacity rules live in @/lib/lists/roster so the
// UI and the slot API route share one source of truth. SLOT_LABELS is
// presentation-only, so it stays here.

const SLOT_LABELS: Record<TeamSlot, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  FLEX: 'Flex',
  TE: 'TE',
  DST: 'DST',
  K: 'K',
  IR: 'IR',
  BENCH: 'Bench',
}

interface PositionBoardProps {
  players: ListPlayerWithPlayer[]
  roster: ListRosterSettings | null
  isOwner: boolean
  density: 'comfortable' | 'compact'
  onSlotDrop: (playerId: string, slot: TeamSlot) => void
  onRemove: (playerId: string, name: string) => void
  onOpenPlayer: (playerId: string) => void
  onIneligibleDrop: (playerName: string, slot: TeamSlot) => void
  onSlotFull: (slot: TeamSlot, capacity: number) => void
}

function PositionBoard({
  players,
  roster,
  isOwner,
  density,
  onSlotDrop,
  onRemove,
  onOpenPlayer,
  onIneligibleDrop,
  onSlotFull,
}: PositionBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const effectiveSlot = (p: ListPlayerWithPlayer): TeamSlot =>
    (p.slot as TeamSlot | null) ?? 'BENCH'

  const grouped = useMemo(() => {
    const map = new Map<TeamSlot, ListPlayerWithPlayer[]>()
    for (const slot of SLOT_ORDER) map.set(slot, [])
    for (const p of players) {
      map.get((p.slot as TeamSlot | null) ?? 'BENCH')!.push(p)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players])

  const handleDragEnd = (event: DragEndEvent) => {
    if (!isOwner) return
    const { active, over } = event
    if (!over) return

    const playerId = String(active.id)
    const overData = over.data.current as { slot?: TeamSlot } | undefined

    let newSlot: TeamSlot | undefined
    if (typeof over.id === 'string' && over.id.startsWith('slot:')) {
      newSlot = overData?.slot
    } else {
      const target = players.find((p) => p.player_id === String(over.id))
      newSlot = target ? effectiveSlot(target) : undefined
    }
    if (!newSlot) return

    const player = players.find((p) => p.player_id === playerId)
    if (!player) return
    if (effectiveSlot(player) === newSlot) return

    const eligible = SLOT_ELIGIBILITY[newSlot]
    if (eligible && !eligible.includes(player.player.position)) {
      onIneligibleDrop(player.player.full_name, newSlot)
      return
    }
    // Starting slots are capacity-capped — don't let a 1-QB slot hold two QBs.
    // (Bench/IR overflow is allowed so players can never get soft-locked.)
    if (isCappedSlot(newSlot)) {
      const cap = slotCapacity(roster, newSlot)
      if (cap != null && (grouped.get(newSlot)?.length ?? 0) >= cap) {
        onSlotFull(newSlot, cap)
        return
      }
    }
    onSlotDrop(playerId, newSlot)
  }

  // Bench a starter (or pull from IR): always allowed.
  const handleBench = (playerId: string) => onSlotDrop(playerId, 'BENCH')

  // Start a benched player: drop them into the first eligible lineup slot for
  // their position that still has an open seat. Positional restrictions are
  // honored — a TE only lands in TE or FLEX, never RB. If every eligible slot
  // is full, leave them benched and say so rather than overfilling a slot.
  const handleStart = (player: ListPlayerWithPlayer) => {
    const pos = player.player.position
    const eligibleSlots = STARTING_SLOTS.filter((s) =>
      SLOT_ELIGIBILITY[s]?.includes(pos),
    )
    if (eligibleSlots.length === 0) {
      onIneligibleDrop(player.player.full_name, 'BENCH')
      return
    }
    const open = eligibleSlots.find((s) => {
      const cap = slotCapacity(roster, s)
      return cap == null || (grouped.get(s)?.length ?? 0) < cap
    })
    if (!open) {
      const firstSlot = eligibleSlots[0]
      onSlotFull(firstSlot, slotCapacity(roster, firstSlot) ?? 0)
      return
    }
    onSlotDrop(player.player_id, open)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={MEASURE_ALWAYS}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        {SLOT_ORDER.map((slot) => (
          <SlotRow
            key={slot}
            slot={slot}
            players={grouped.get(slot) ?? []}
            capacity={slotCapacity(roster, slot)}
            isOwner={isOwner}
            density={density}
            onRemove={onRemove}
            onOpenPlayer={onOpenPlayer}
            onStart={handleStart}
            onBench={handleBench}
          />
        ))}
      </div>
    </DndContext>
  )
}

function SlotRow({
  slot,
  players,
  capacity,
  isOwner,
  density,
  onRemove,
  onOpenPlayer,
  onStart,
  onBench,
}: {
  slot: TeamSlot
  players: ListPlayerWithPlayer[]
  capacity: number | null
  isOwner: boolean
  density: 'comfortable' | 'compact'
  onRemove: (playerId: string, name: string) => void
  onOpenPlayer: (playerId: string) => void
  onStart: (player: ListPlayerWithPlayer) => void
  onBench: (playerId: string) => void
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot:${slot}`,
    data: { slot },
  })

  const over = capacity != null && players.length > capacity

  // Bench players can be started; starters can be benched. IR has neither.
  const slotActionFor = (
    p: ListPlayerWithPlayer,
  ): { label: 'Start' | 'Bench'; onClick: () => void } | undefined => {
    if (!isOwner) return undefined
    if (slot === 'BENCH') return { label: 'Start', onClick: () => onStart(p) }
    if (STARTING_SLOTS.includes(slot))
      return { label: 'Bench', onClick: () => onBench(p.player_id) }
    return undefined
  }

  return (
    <section>
      <div className="flex items-center justify-between px-1 pb-1.5">
        {/* Position slots get the colored positional tag (QB green, etc.);
            Bench and IR aren't positions, so they keep a plain text label. */}
        {slot === 'BENCH' || slot === 'IR' ? (
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">
            {SLOT_LABELS[slot]}
          </p>
        ) : (
          <PositionBadge position={slot} size="md" />
        )}
        {capacity != null && (
          <p
            className={cn(
              'text-[10px] tabular-nums',
              over ? 'font-semibold text-destructive' : 'text-text-tertiary',
            )}
          >
            {players.length}/{capacity}
          </p>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-md bg-white/[0.03] p-1 transition-colors',
          isOver && 'bg-foreground/10',
        )}
      >
        <SortableContext
          items={players.map((p) => p.player_id)}
          strategy={verticalListSortingStrategy}
        >
          {players.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-text-tertiary">
              Drop players here
            </p>
          ) : (
            <ul className="space-y-0.5">
              {players.map((p) => (
                <SortablePlayer
                  key={p.player_id}
                  rank={p.position}
                  entry={p}
                  density={density}
                  draggable={isOwner}
                  drafted={false}
                  draftMode={false}
                  onRemove={
                    isOwner
                      ? () => onRemove(p.player_id, p.player.full_name)
                      : undefined
                  }
                  onOpen={() => onOpenPlayer(p.player_id)}
                  slotAction={slotActionFor(p)}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      </div>
    </section>
  )
}

function EditableTitle({
  title,
  editable,
  onSave,
}: {
  title: string
  editable: boolean
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Keep the local draft in sync when the canonical title changes underneath
  // us (e.g. cache invalidation after a successful save).
  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (!editable) {
    return <h1 className="text-2xl font-bold leading-tight">{title}</h1>
  }

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === title) {
      setDraft(title)
      return
    }
    onSave(next)
  }

  const cancel = () => {
    setDraft(title)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        maxLength={100}
        className="w-full max-w-xl rounded-md border border-bg-elevated-3 bg-bg-elevated px-2 py-1 text-2xl font-bold leading-tight text-foreground outline-none focus:border-foreground"
        aria-label="List title"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-2 rounded-full text-left"
      aria-label="Rename list"
    >
      <h1 className="text-2xl font-bold leading-tight">{title}</h1>
      <Pencil className="h-4 w-4 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}

function EmptyState({ isOwner }: { isOwner: boolean }) {
  return (
    <Card className="border-bg-elevated-2 bg-bg-elevated">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-text-secondary">
          {isOwner
            ? "Empty list. Add your first player to get started."
            : 'No players in this list yet.'}
        </p>
        {!isOwner && (
          <Link
            href="/app/players"
            className="text-xs font-medium text-foreground hover:underline"
          >
            Browse players →
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
