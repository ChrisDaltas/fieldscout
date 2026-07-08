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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

import { PageHeader } from '@/components/layout/app-header'
import { CustomizeModal } from '@/components/lists/customize-modal'
import { EditableThumbnail } from '@/components/lists/editable-thumbnail'
import { TagChip } from '@/components/lists/tag-chip'
import { TIER_BAND_BG } from '@/components/lists/tier-badge'
import type { BuilderPlayer } from '@/components/lists/builder/types'
import { PlayerCard } from '@/components/players/player-card'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'
import { PositionBadge } from '@/components/players/position-badge'
import { PlayerRow } from '@/components/players/player-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  type ListPlayerWithPlayer,
  type ListWithDetails,
  useAddPlayer,
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
  /** True while the AI build (useAiListBuild) owns this list — swaps the
   *  empty state for a "scouting" placeholder until players start landing. */
  aiBuilding?: boolean
}

export function ListDetailView({ list, isOwner, aiBuilding = false }: ListDetailViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [viewMode, setViewMode] = useState<ViewMode>('comfortable')
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
  const addPlayer = useAddPlayer(list.id)
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

  const handleShare = () => {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    if (!url) return
    void navigator.clipboard?.writeText(url).then(
      () =>
        toast({
          title: 'Link copied',
          description: list.is_private
            ? 'This list is private — only you can open it.'
            : list.title,
        }),
      () => toast({ title: 'Could not copy link', variant: 'destructive' }),
    )
  }

  const handleReset = () => {
    draft.clearDrafted()
    toast({ title: 'List reset — drafted marks cleared' })
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
  const addedIds = useMemo(
    () => new Set(players.map((p) => p.player_id)),
    [players],
  )

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

  const handleAdd = (player: { id: string; full_name: string }) => {
    // Each player appears once per list — the unique constraint is server-side;
    // the combobox greys out players that are already on the board.
    if (addedIds.has(player.id)) {
      toast({
        title: `${player.full_name} is already on this list`,
        variant: 'destructive',
      })
      return
    }
    addPlayer.mutate(player.id, {
      onSuccess: () => toast({ title: `Added ${player.full_name}` }),
      onError: (err) =>
        toast({
          title: 'Could not add',
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

  const draftedCount = players.filter((p) => draft.drafted.has(p.player_id)).length
  const kindBadge = list.is_team ? (
    <Badge variant="stroke">Team</Badge>
  ) : list.hide_order ? (
    <Badge variant="stroke">List</Badge>
  ) : (
    <Badge variant="accent">Ranking</Badge>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back"
              onClick={() => router.back()}
            >
              <Icon name="arrow-prev" size={14} />
            </Button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold"
            >
              <Link
                href="/app/lists"
                className="shrink-0 text-n-3 transition-colors hover:text-ink"
              >
                Lists
              </Link>
              <span className="text-n-3">/</span>
              <span className="truncate text-ink">{list.title}</span>
            </nav>
          </div>
        }
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="stroke" size="sm" onClick={handleShare}>
              <Icon name="send" size={13} /> Share
            </Button>
            {isOwner && (
              <Button
                variant="stroke"
                size="sm"
                disabled={!draft.enabled || draftedCount === 0}
                onClick={handleReset}
              >
                <Icon name="reset" size={13} /> Reset list
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <Icon name="dots" size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    toggleFavorite.mutate(list.id, {
                      onError: (err) =>
                        toast({
                          title: 'Could not pin',
                          description: err.message,
                          variant: 'destructive',
                        }),
                    })
                  }
                >
                  <Icon name="marker" size={13} />
                  {list.is_favorited ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={duplicateList.isPending}
                  onSelect={handleDuplicate}
                >
                  <Icon name="save" size={13} />
                  Duplicate
                </DropdownMenuItem>
                {isOwner && !list.is_big_board && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="focus:bg-negative-soft"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Icon name="remove" size={13} />
                      Delete list
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Identity card */}
      <header className="flex flex-wrap items-center gap-4 rounded-sm border border-ink bg-white px-5 py-4">
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
        <div className="min-w-0 flex-1 basis-56">
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
            <p className="mt-1 max-w-2xl text-sm font-medium text-n-3">
              {list.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {kindBadge}
            {list.is_big_board && <Badge variant="black">Big board</Badge>}
            <Badge variant="stroke">
              <span className="fs-num">{list.player_count}</span>&nbsp;player
              {list.player_count === 1 ? '' : 's'}
            </Badge>
            {list.position_filter && (
              <PositionBadge
                position={
                  list.position_filter === 'DEF' ? 'DST' : list.position_filter
                }
                size="sm"
              />
            )}
            {list.tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} slug={tag.slug} />
            ))}
            <span className="text-[12px] font-semibold text-n-3">
              {list.is_private ? 'Private' : 'Public'}
            </span>
            {draft.enabled && draftedCount > 0 && (
              <Badge variant="black">
                <span className="fs-num">{draftedCount}</span>&nbsp;drafted
              </Badge>
            )}
            <button
              type="button"
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
              aria-label="Thumbs up"
              className="inline-flex h-chip items-center gap-1 rounded-sm border border-ink bg-white px-2 text-[11px] font-bold leading-none text-ink transition-colors hover:bg-n-4"
            >
              <Icon name="like" size={11} />
              <span className="fs-num">{list.like_count}</span>
            </button>
          </div>
        </div>
        {isOwner && !list.is_team && (
          <AddPlayerCombobox
            addedIds={addedIds}
            positionFilter={list.position_filter}
            onAdd={handleAdd}
          />
        )}
      </header>

      {/* Toolbar — grouping tabs, keyboard hint, customize, layout tabs */}
      <div className="flex flex-wrap items-center gap-3">
        {isOwner && !list.is_team && !list.hide_order && (
          <Tabs
            value={list.tiers_enabled ? 'tiers' : 'order'}
            onValueChange={(next) => {
              if (next !== 'tiers' && next !== 'order') return
              // Drive ranking_mode (the source of truth) so hide_order/
              // tiers_enabled stay in sync. Players are never touched —
              // turning tiers on just regroups them into Untiered.
              updateList.mutate(
                { ranking_mode: next === 'tiers' ? 'rank_and_tier' : 'ranked' },
                {
                  onError: (err) =>
                    toast({
                      title: 'Could not save',
                      description: err.message,
                      variant: 'destructive',
                    }),
                },
              )
            }}
          >
            <TabsList>
              <TabsTrigger value="order">List order</TabsTrigger>
              <TabsTrigger value="tiers">Tiers</TabsTrigger>
              <ComingSoonTab label="Rounds" />
              <ComingSoonTab label="Price" />
            </TabsList>
          </Tabs>
        )}
        {selectedPlayerId && !list.tiers_enabled && (
          <span className="fs-num text-[11px] font-bold text-n-3">
            ↑↓ to move · esc to clear
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-2.5">
          {isOwner && (
            <Button
              variant="stroke"
              size="sm"
              onClick={() => setCustomizeOpen(true)}
            >
              <Icon name="setup" size={13} /> Customize
            </Button>
          )}
          {!list.is_team && (
            <Tabs
              value={viewMode === 'cards' ? 'cards' : 'stacked'}
              onValueChange={(next) =>
                setViewMode(next === 'cards' ? 'cards' : 'comfortable')
              }
            >
              <TabsList>
                <TabsTrigger value="stacked">Stacked</TabsTrigger>
                <TabsTrigger value="cards">Cards</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </span>
      </div>

      <div
        ref={playerDrop.setNodeRef}
        className={cn(
          'rounded-sm transition-all',
          playerDropActive && 'p-2 ring-1 ring-accent/50',
          playerDropActive && playerDrop.isOver && 'bg-accent-soft/60 ring-accent',
        )}
      >
      {players.length === 0 ? (
        <EmptyState isOwner={isOwner} aiBuilding={aiBuilding} />
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
            <ul className="space-y-0.5 rounded-sm border border-ink bg-white p-1">
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
                  className="bg-white"
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this list?</DialogTitle>
              <DialogDescription>
                <span className="font-bold text-ink">{list.title}</span> will
                be moved to your Trash. You can restore it from there until
                it&apos;s permanently removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="stroke"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteList.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                shadow
                onClick={handleConfirmDelete}
                disabled={deleteList.isPending}
              >
                {deleteList.isPending ? 'Deleting…' : 'Delete list'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** Disabled grouping tab — Rounds/Price need league sync data we don't have. */
function ComingSoonTab({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <TabsTrigger value={label.toLowerCase()} disabled>
            {label}
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent>Coming with league sync</TooltipContent>
    </Tooltip>
  )
}

// =============================================================================
// Add-a-player combobox — inline quick-add in the identity card. Same data
// source as the player sidebar (/api/players/builder); same add mutation.
// =============================================================================

/**
 * Maps a list's position_filter to the set of player positions the picker
 * should show. FLEX expands to RB/WR/TE; null/empty means no restriction.
 */
function expandPositionFilter(
  positionFilter: string | null | undefined,
): readonly string[] | null {
  if (!positionFilter) return null
  const upper = positionFilter.toUpperCase()
  if (upper === 'FLEX') return ['RB', 'WR', 'TE']
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(upper)) return [upper]
  return null
}

function AddPlayerCombobox({
  addedIds,
  positionFilter,
  onAdd,
}: {
  addedIds: Set<string>
  positionFilter: string | null | undefined
  onAdd: (player: { id: string; full_name: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pool, setPool] = useState<BuilderPlayer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(false)

  // Lazy-load the player pool the first time the field opens.
  useEffect(() => {
    if (!open || fetchedRef.current) return
    fetchedRef.current = true
    setLoading(true)
    const params = new URLSearchParams({ scoring: 'ppr', limit: '300' })
    const positions = expandPositionFilter(positionFilter)
    if (positions) params.set('positions', positions.join(','))
    fetch(`/api/players/builder?${params}`)
      .then((res) => res.json() as Promise<{ players: BuilderPlayer[] }>)
      .then((data) => setPool(data.players ?? []))
      .catch(() => setPool([]))
      .finally(() => setLoading(false))
  }, [open, positionFilter])

  const q = query.trim().toLowerCase()
  const matches = (pool ?? [])
    .filter((p) => !q || p.full_name.toLowerCase().includes(q))
    .slice(0, 8)

  return (
    <div className="relative w-full sm:w-[200px]">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="Add a player…"
        aria-label="Add a player"
        className="h-btn text-[13px]"
      />
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-full min-w-[240px] rounded-sm border border-ink bg-white py-1 shadow-hard-4">
          {loading && (
            <p className="px-3 py-2 text-xs font-semibold text-n-3">Loading…</p>
          )}
          {!loading && matches.length === 0 && (
            <p className="px-3 py-2 text-xs font-semibold text-n-3">
              No players found.
            </p>
          )}
          {!loading &&
            matches.map((p) => {
              const added = addedIds.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={added}
                  // mousedown fires before the input's blur closes the panel.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (!added) onAdd(p)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                    added ? 'opacity-40' : 'hover:bg-accent-soft',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {p.full_name}
                    </span>
                    <span className="block text-[11px] font-medium text-n-3">
                      {[p.position, p.team].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon
                    name={added ? 'check' : 'plus'}
                    size={12}
                    className={added ? 'text-positive-strong' : 'text-ink'}
                  />
                </button>
              )
            })}
        </div>
      )}
    </div>
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
                    'rounded-sm border border-ink px-2 py-1 text-[10px] font-bold leading-none opacity-0 transition-all focus-visible:opacity-100 group-hover:opacity-100',
                    drafted
                      ? 'bg-white text-ink hover:bg-n-4'
                      : 'bg-accent text-accent-foreground hover:bg-accent-strong',
                  )}
                >
                  {drafted ? 'Undo' : 'Drafted'}
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
                    'rounded-sm border border-ink px-2.5 py-1 text-[10px] font-bold leading-none opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100',
                    slotAction.label === 'Start'
                      ? 'bg-positive text-ink hover:brightness-95'
                      : 'bg-white text-ink hover:bg-n-4',
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
      <div className="space-y-4">
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

/** Tier band head — painted with the tier ramp color, count on the right. */
function TierBandHead({
  chip,
  label,
  count,
  className,
}: {
  chip: string
  label: string
  count: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[38px] items-center gap-2.5 border-b border-ink px-4 py-1.5',
        className,
      )}
    >
      <span className="fs-num inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-ink bg-white px-1.5 text-[13px] font-extrabold text-ink">
        {chip}
      </span>
      <span className="text-[13px] font-extrabold tracking-wide">{label}</span>
      <span className="fs-num ml-auto text-[11px] font-bold opacity-80">
        {count} player{count === 1 ? '' : 's'}
      </span>
    </div>
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
    <section className="overflow-hidden rounded-sm border border-ink bg-white">
      <TierBandHead
        chip={tier}
        label={`Tier ${tier}`}
        count={players.length}
        className={TIER_BAND_BG[tier]}
      />
      <div
        ref={setRefs}
        className={cn('p-1 transition-colors', highlight && 'bg-accent-soft')}
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
            <p className="px-3 py-3 text-center text-xs font-semibold text-n-3">
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
    <section className="overflow-hidden rounded-sm border border-ink bg-white">
      <TierBandHead
        chip="—"
        label="Untiered"
        count={players.length}
        className="bg-n-4 text-ink"
      />
      <div
        ref={setRefs}
        className={cn('p-1 transition-colors', highlight && 'bg-accent-soft')}
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
      <div className="space-y-4">
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
    <section className="overflow-hidden rounded-sm border border-ink bg-white">
      <div className="flex min-h-[38px] items-center justify-between gap-2 border-b border-ink px-4 py-1.5">
        {/* Position slots get the colored positional tag (QB orange, etc.);
            Bench and IR aren't positions, so they keep a plain text label. */}
        {slot === 'BENCH' || slot === 'IR' ? (
          <p className="text-[12px] font-extrabold uppercase tracking-wide text-ink">
            {SLOT_LABELS[slot]}
          </p>
        ) : (
          <PositionBadge position={slot} size="md" />
        )}
        {capacity != null && (
          <p
            className={cn(
              'fs-num text-[11px] font-bold',
              over ? 'text-negative-strong' : 'text-n-3',
            )}
          >
            {players.length}/{capacity}
          </p>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn('p-1 transition-colors', isOver && 'bg-accent-soft')}
      >
        <SortableContext
          items={players.map((p) => p.player_id)}
          strategy={verticalListSortingStrategy}
        >
          {players.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs font-semibold text-n-3">
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
    return <h1 className="text-h4">{title}</h1>
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
        className="w-full max-w-xl rounded-sm border border-ink bg-white px-2 py-1 text-h4 text-ink outline-none focus:border-accent"
        aria-label="List title"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex max-w-full items-center gap-2 text-left"
      aria-label="Rename list"
    >
      <h1 className="truncate text-h4">{title}</h1>
      <Icon
        name="edit"
        size={14}
        className="shrink-0 text-n-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  )
}

function EmptyState({
  isOwner,
  aiBuilding = false,
}: {
  isOwner: boolean
  aiBuilding?: boolean
}) {
  if (aiBuilding) {
    return (
      <div className="rounded-sm border border-accent bg-accent-soft px-6 py-14 text-center">
        <p className="animate-pulse text-sm font-bold text-ink">
          FieldScout AI is scouting players for this list…
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
      <h2 className="text-h5">No players yet</h2>
      <p className="mt-2 text-sm font-medium text-n-3">
        {isOwner
          ? 'Add from the player bar on the right, or search above.'
          : 'No players in this list yet.'}
      </p>
      {!isOwner && (
        <Link
          href="/app/players"
          className="mt-3 inline-block text-xs font-bold text-accent hover:underline"
        >
          Browse players →
        </Link>
      )}
    </div>
  )
}
