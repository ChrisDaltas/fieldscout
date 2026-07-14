'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { SortableBoardRow } from '@/components/big-board/board-row'
import { WeekTabs } from '@/components/big-board/week-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { PlayerSearch, type PlayerSearchResult } from '@/components/players/player-search'
import {
  type BigBoardSnapshotPlayer,
  useBigBoardHistory,
  useRestoreSnapshot,
  useSaveBigBoard,
  useWeeklyBigBoard,
} from '@/hooks/use-big-board'
import { useBigBoard, useReorderPlayers } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { rankByVorp, type VorpPosition } from '@/lib/scoring/vorp'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

interface BoardPlayer {
  player_id: string
  player: {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
    adp?: number | null
    projected_pts_ppr?: number | null
  }
}

interface BigBoardGridProps {
  /** When set, fetches that week's Big Board. Otherwise renders the season-long board. */
  weekNumber?: number
  /** Disable all editing affordances. */
  readOnly?: boolean
  /** Current NFL week (0 = offseason) — drives the week tabs' lock styling. */
  currentWeek?: number
  /** Hide the internal week-tab row when a parent renders its own (Rankings). */
  showWeekTabs?: boolean
}

const SIZE_KEY = 'fieldscout:big-board-size'
const SIZE_MIN = 10
const SIZE_MAX = 300
// PRD F2A defaults to top 50; we land at 300 because positional scarcity
// makes the bottom of a 12-team league's pool meaningfully different from
// "freely available off waivers" for RB/WR. Users can dial back via the
// gear popover if the deeper view is overwhelming.
const SIZE_DEFAULT = 300

/** Vertical boards feel much steadier when the drag can't wander sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

function readStoredSize(): number {
  if (typeof window === 'undefined') return SIZE_DEFAULT
  const raw = window.localStorage.getItem(SIZE_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return SIZE_DEFAULT
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(parsed)))
}

export function BigBoardGrid({
  weekNumber,
  readOnly = false,
  currentWeek = 0,
  showWeekTabs = true,
}: BigBoardGridProps = {}) {
  const isWeekly = typeof weekNumber === 'number'
  const seasonQuery = useBigBoard()
  const weeklyQuery = useWeeklyBigBoard(isWeekly ? weekNumber : -1)
  const data = isWeekly ? weeklyQuery.data : seasonQuery.data
  const isLoading = isWeekly ? weeklyQuery.isLoading : seasonQuery.isLoading
  const isError = isWeekly ? weeklyQuery.isError : seasonQuery.isError
  const error = isWeekly ? weeklyQuery.error : seasonQuery.error

  const listId = data?.list?.id ?? ''
  const reorder = useReorderPlayers(listId)
  const saveBigBoard = useSaveBigBoard()
  const restore = useRestoreSnapshot()
  const { toast } = useToast()

  const serverPlayers = useMemo<BoardPlayer[]>(
    () => (data?.players ?? []) as BoardPlayer[],
    [data],
  )
  const serverOrder = useMemo(
    () => serverPlayers.map((p) => p.player_id),
    [serverPlayers],
  )

  const [order, setOrder] = useState<string[]>(serverOrder)
  // Players added via search or hydrated from a restored snapshot. Keyed by
  // player_id so we can render them even though they're not yet on the
  // server-side list.
  const [additions, setAdditions] = useState<Record<string, BoardPlayer>>({})
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [boardSize, setBoardSize] = useState<number>(SIZE_DEFAULT)

  useEffect(() => {
    setBoardSize(readStoredSize())
  }, [])

  useEffect(() => {
    setOrder(serverOrder)
    setAdditions({})
  }, [serverOrder])

  const dirty = useMemo(() => {
    if (order.length !== serverOrder.length) return true
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== serverOrder[i]) return true
    }
    return false
  }, [order, serverOrder])

  const playerById = useMemo(() => {
    const map = new Map<string, BoardPlayer>()
    for (const p of serverPlayers) map.set(p.player_id, p)
    for (const [id, p] of Object.entries(additions)) map.set(id, p)
    return map
  }, [serverPlayers, additions])

  const orderedPlayers = order
    .map((id) => playerById.get(id))
    .filter((p): p is BoardPlayer => Boolean(p))

  const visiblePlayers = orderedPlayers.slice(0, boardSize)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = order.indexOf(String(active.id))
    const newIdx = order.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    setOrder(arrayMove(order, oldIdx, newIdx))
  }

  const handleSave = () => {
    if (!data || !dirty) return
    if (isWeekly) {
      // Weekly boards persist via the standard reorder RPC — no snapshot.
      const positions = order.map((playerId, i) => ({ playerId, position: i + 1 }))
      reorder.mutate(positions, {
        onSuccess: () => toast({ title: `Week ${weekNumber} saved` }),
        onError: (err) =>
          toast({
            title: 'Could not save',
            description: err.message,
            variant: 'destructive',
          }),
      })
      return
    }
    saveBigBoard.mutate(
      { playerIds: order },
      {
        onSuccess: () => toast({ title: 'Big board saved' }),
        onError: (err) =>
          toast({
            title: 'Could not save',
            description: err.message,
            variant: 'destructive',
          }),
      },
    )
  }

  const handleReset = () => {
    setOrder(serverOrder)
    setAdditions({})
  }

  const handleAddFromSearch = (result: PlayerSearchResult) => {
    if (order.includes(result.id)) {
      toast({ title: 'Already on the board', description: result.full_name })
      return
    }
    setAdditions((prev) => ({
      ...prev,
      [result.id]: {
        player_id: result.id,
        player: {
          id: result.id,
          full_name: result.full_name,
          position: result.position,
          team: result.team,
          headshot_url: result.headshot_url,
          adp: result.adp ?? null,
        },
      },
    }))
    setOrder((prev) => [...prev, result.id])
  }

  const handleSortByAdp = () => {
    const withAdp = orderedPlayers.map((p) => ({
      id: p.player_id,
      adp: typeof p.player.adp === 'number' ? p.player.adp : Number.POSITIVE_INFINITY,
    }))
    withAdp.sort((a, b) => a.adp - b.adp)
    setOrder(withAdp.map((x) => x.id))
  }

  const handleSortByFantasyRank = () => {
    // VORP across the whole working set — scarcity-aware ranking that
    // mirrors how seasoned fantasy players actually value players. See
    // src/lib/scoring/vorp.ts for the reasoning.
    const ranked = rankByVorp(
      orderedPlayers.map((p) => ({
        id: p.player_id,
        position: p.player.position as VorpPosition,
        projected_pts:
          typeof p.player.projected_pts_ppr === 'number'
            ? p.player.projected_pts_ppr
            : null,
      })),
    )
    const rankedIds = ranked.map((r) => r.id)
    // Append any players VORP filtered out (e.g. unknown positions) so we
    // never silently drop them from the working set.
    const knownSet = new Set(rankedIds)
    const tail = orderedPlayers
      .map((p) => p.player_id)
      .filter((id) => !knownSet.has(id))
    setOrder([...rankedIds, ...tail])
  }

  const handleStubSort = (label: string) => {
    toast({ title: `${label} — coming soon` })
  }

  const handleRestore = async (snapshotId: string) => {
    try {
      const result = await restore.mutateAsync(snapshotId)
      const restored = result.snapshot_data as BigBoardSnapshotPlayer[]
      const newAdditions: Record<string, BoardPlayer> = {}
      const ids: string[] = []
      for (const entry of restored) {
        ids.push(entry.player_id)
        if (!playerById.has(entry.player_id)) {
          newAdditions[entry.player_id] = {
            player_id: entry.player_id,
            player: {
              id: entry.player_id,
              full_name: entry.full_name,
              position: entry.position_code,
              team: entry.team,
              headshot_url: entry.headshot_url,
            },
          }
        }
      }
      setAdditions((prev) => ({ ...prev, ...newAdditions }))
      setOrder(ids)
      setHistoryOpen(false)
      toast({
        title: 'Snapshot loaded',
        description: 'Hit Update big board to commit.',
      })
    } catch (err) {
      toast({
        title: 'Could not restore',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const handleSizeChange = (next: number) => {
    const clamped = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(next)))
    setBoardSize(clamped)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIZE_KEY, String(clamped))
    }
  }

  const weekTabs = showWeekTabs ? (
    <WeekTabs
      className="mb-4"
      active={isWeekly ? weekNumber : 'pre'}
      currentWeek={currentWeek}
    />
  ) : null

  if (isLoading) {
    return (
      <section>
        {weekTabs}
        <div className="space-y-2">
          <Skeleton className="h-btn-sm w-52" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (isError || !data) {
    return (
      <section>
        {weekTabs}
        <div className="rounded-sm border border-ink bg-white px-6 py-10 text-center">
          <h3 className="text-h6">Could not load the board</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-negative-strong">
            {(error as Error)?.message ?? 'Something went wrong loading this board.'}
          </p>
        </div>
      </section>
    )
  }

  const saving = isWeekly ? reorder.isPending : saveBigBoard.isPending
  const editable = !readOnly
  const boardLabel = isWeekly ? `Week ${weekNumber} board` : 'Pre draft board'

  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <h2 className="mr-auto whitespace-nowrap text-h5">
          {isWeekly ? `Week ${weekNumber} big board` : 'Pre draft rankings'}
        </h2>

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {!isWeekly && (
              <Button
                variant="stroke"
                size="sm"
                onClick={() => setHistoryOpen(true)}
              >
                <Icon name="clock" size={13} /> History
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="stroke" size="sm">
                  <Icon name="sort" size={13} /> Smart order
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={handleSortByFantasyRank}>
                  Sort by fantasy rank
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSortByAdp}>
                  Sort by ADP
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleStubSort('Consensus rank')}>
                  Sort by consensus rank
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="stroke" size="icon-sm" aria-label="Board size">
                  <Icon name="setup" size={13} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60">
                <p className="fs-overline text-n-3">Board size</p>
                <p className="fs-num mt-1 text-h4">{boardSize}</p>
                <Slider
                  className="mt-2"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={1}
                  value={[boardSize]}
                  onValueChange={([v]) => handleSizeChange(v)}
                  aria-label="Board size"
                />
                <p className="mt-2 text-[11px] font-medium text-n-3">
                  Players beyond {boardSize} stay on your board but are hidden.
                </p>
              </PopoverContent>
            </Popover>

            {dirty && (
              <Button
                variant="stroke"
                size="sm"
                onClick={handleReset}
                disabled={saving}
              >
                <Icon name="repeat" size={13} /> Reset
              </Button>
            )}
            <Button
              variant="green"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              <Icon name="check" size={13} />
              {saving
                ? 'Saving…'
                : isWeekly
                  ? `Save week ${weekNumber}`
                  : 'Update big board'}
            </Button>
          </div>
        )}
      </div>

      {weekTabs}

      {orderedPlayers.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <h3 className="text-h6">This board is empty</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-n-3">
            {isWeekly
              ? 'Empty week. Add players using the search below.'
              : 'Your big board is empty. Refresh to auto-fill the top 50 players from last season.'}
          </p>
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-ink px-4 py-2.5">
            <span className="text-[12px] font-extrabold">{boardLabel}</span>
            {dirty && <Badge variant="yellow">Unsaved changes</Badge>}
            <span className="fs-num ml-auto whitespace-nowrap text-[11px] font-bold text-n-3">
              {visiblePlayers.length} of {orderedPlayers.length} players
            </span>
            <span className="whitespace-nowrap text-[11px] font-bold text-n-3">
              {editable ? 'Drag to reorder' : 'View only'}
            </span>
          </div>
          {editable ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visiblePlayers.map((p) => p.player_id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-0.5 p-1">
                  {visiblePlayers.map((entry, i) => (
                    <SortableBoardRow
                      key={entry.player_id}
                      id={entry.player_id}
                      rank={i + 1}
                      player={entry.player}
                      projection={entry.player.projected_pts_ppr ?? null}
                      draggable
                      onOpen={() => openPlayer(entry.player_id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="space-y-0.5 p-1">
              {visiblePlayers.map((entry, i) => (
                <SortableBoardRow
                  key={entry.player_id}
                  id={entry.player_id}
                  rank={i + 1}
                  player={entry.player}
                  projection={entry.player.projected_pts_ppr ?? null}
                  draggable={false}
                  onOpen={() => openPlayer(entry.player_id)}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {editable && (
        <div className="mt-6 max-w-md">
          <p className="fs-overline mb-2 text-n-3">Add a player</p>
          <PlayerSearch
            placeholder="Search by name…"
            limit={15}
            onSelect={handleAddFromSearch}
          />
        </div>
      )}

      {!isWeekly && (
        <HistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onRestore={handleRestore}
          isRestoring={restore.isPending}
        />
      )}
    </section>
  )
}

function HistorySheet({
  open,
  onOpenChange,
  onRestore,
  isRestoring,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onRestore: (snapshotId: string) => void
  isRestoring: boolean
}) {
  const { data, isLoading, isError, error } = useBigBoardHistory()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <p className="text-[13px] font-medium text-negative-strong">
              {(error as Error)?.message ?? 'Could not load history.'}
            </p>
          )}
          {!isLoading && data?.snapshots.length === 0 && (
            <div className="rounded-sm border border-ink bg-white px-4 py-8 text-center">
              <h3 className="text-h6">No saved versions yet</h3>
              <p className="mt-1 text-[12px] font-medium text-n-3">
                Hit Update big board to capture your first snapshot.
              </p>
            </div>
          )}
          <ul className="space-y-1.5">
            {(data?.snapshots ?? []).map((snap) => (
              <li
                key={snap.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-ink bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="fs-num text-[12px] font-bold">
                    {new Date(snap.saved_at).toLocaleString()}
                  </p>
                  <p className="text-[11px] font-medium text-n-3">
                    <span className="fs-num">{snap.player_count}</span> player
                    {snap.player_count === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="stroke"
                  disabled={isRestoring}
                  onClick={() => onRestore(snap.id)}
                  className="shrink-0"
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}
