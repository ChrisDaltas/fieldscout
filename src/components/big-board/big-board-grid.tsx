'use client'

import { useEffect, useMemo, useState } from 'react'
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
import {
  ArrowUpDown,
  ClipboardList,
  History,
  Loader2,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { PlayerCard } from '@/components/players/player-card'
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
}

const SIZE_KEY = 'fieldscout:big-board-size'
const SIZE_MIN = 10
const SIZE_MAX = 300
// PRD F2A defaults to top 50; we land at 300 because positional scarcity
// makes the bottom of a 12-team league's pool meaningfully different from
// "freely available off waivers" for RB/WR. Users can dial back via the
// gear popover if the deeper view is overwhelming.
const SIZE_DEFAULT = 300

function readStoredSize(): number {
  if (typeof window === 'undefined') return SIZE_DEFAULT
  const raw = window.localStorage.getItem(SIZE_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return SIZE_DEFAULT
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(parsed)))
}

export function BigBoardGrid({ weekNumber, readOnly = false }: BigBoardGridProps = {}) {
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
        onSuccess: () => toast({ title: 'Big Board saved' }),
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
        description: 'Hit Update Big Board to commit.',
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

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading your Big Board…</p>
  }

  if (isError || !data) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-destructive">
          {(error as Error)?.message ?? 'Could not load Big Board.'}
        </CardContent>
      </Card>
    )
  }

  const saving = isWeekly ? reorder.isPending : saveBigBoard.isPending
  const editable = !readOnly

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-foreground" />
            {isWeekly ? `Week ${weekNumber} Big Board` : 'Big Board'}
          </h1>
          <p className="mt-1 text-xs text-text-tertiary">
            {visiblePlayers.length} of {orderedPlayers.length} players
            {dirty && (
              <span className="ml-2 text-foreground">· unsaved changes</span>
            )}
          </p>
        </div>

        {editable && (
          <div className="flex items-center gap-2">
            {!isWeekly && (
              <Button
                variant="invisible"
                onClick={() => setHistoryOpen(true)}
                className="text-text-secondary hover:text-foreground"
              >
                <History className="mr-1 h-4 w-4" /> History
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="invisible"
                  className="text-text-secondary hover:text-foreground"
                >
                  <Sparkles className="mr-1 h-4 w-4" /> Smart Order
                  <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={handleSortByFantasyRank}>
                  Sort by Fantasy Rank
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSortByAdp}>
                  Sort by ADP
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleStubSort('Consensus Rank')}>
                  Sort by Consensus Rank
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="invisible"
                  size="icon"
                  aria-label="Board size"
                  className="text-text-secondary hover:text-foreground"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-64 border-bg-elevated-2 bg-bg-elevated"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Board size
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{boardSize}</p>
                <input
                  type="range"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={1}
                  value={boardSize}
                  onChange={(e) => handleSizeChange(Number(e.target.value))}
                  className="mt-2 w-full accent-foreground"
                />
                <p className="mt-2 text-[11px] text-text-tertiary">
                  Players beyond {boardSize} stay on your board but are hidden.
                </p>
              </PopoverContent>
            </Popover>

            {dirty && (
              <Button
                variant="invisible"
                onClick={handleReset}
                disabled={saving}
                className="text-text-secondary hover:text-foreground"
              >
                <RotateCcw className="mr-1 h-4 w-4" /> Reset
              </Button>
            )}
            <Button
              variant="brand"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded-full font-semibold disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="mr-1 h-4 w-4" /> Update Big Board
                </>
              )}
            </Button>
          </div>
        )}
      </header>

      {orderedPlayers.length === 0 ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-8 text-center text-sm text-text-secondary">
            {isWeekly
              ? 'Empty week. Add players using the search below.'
              : 'Your Big Board is empty. Refresh to auto-fill the top 50 players from last season.'}
          </CardContent>
        </Card>
      ) : editable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visiblePlayers.map((p) => p.player_id)}
            strategy={rectSortingStrategy}
          >
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
              {visiblePlayers.map((entry, i) => (
                <SortableCard
                  key={entry.player_id}
                  rank={i + 1}
                  entry={entry}
                  draggable
                  onOpen={() => openPlayer(entry.player_id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
          {visiblePlayers.map((entry, i) => (
            <SortableCard
              key={entry.player_id}
              rank={i + 1}
              entry={entry}
              draggable={false}
              onOpen={() => openPlayer(entry.player_id)}
            />
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-6 max-w-md">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Add a player
          </p>
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
      <SheetContent
        side="right"
        className="border-bg-elevated-2 bg-bg-elevated sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {isLoading && (
            <p className="text-sm text-text-secondary">Loading…</p>
          )}
          {isError && (
            <p className="text-sm text-destructive">
              {(error as Error)?.message ?? 'Could not load history.'}
            </p>
          )}
          {!isLoading && data?.snapshots.length === 0 && (
            <p className="text-sm text-text-tertiary">
              No saved versions yet. Hit Update Big Board to capture your first
              snapshot.
            </p>
          )}
          <ul className="space-y-1.5">
            {(data?.snapshots ?? []).map((snap) => (
              <li
                key={snap.id}
                className="flex items-center justify-between gap-3 rounded-md border border-bg-elevated-2 bg-bg-elevated-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {new Date(snap.saved_at).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    {snap.player_count} player{snap.player_count === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="default"
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

function SortableCard({
  rank,
  entry,
  draggable,
  onOpen,
}: {
  rank: number
  entry: BoardPlayer
  draggable: boolean
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.player_id, disabled: !draggable })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li ref={setNodeRef} style={style} className="touch-manipulation">
      <PlayerCard
        rank={rank}
        player={entry.player}
        projectedPts={entry.player.projected_pts_ppr ?? null}
        onOpen={onOpen}
        draggable={draggable}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </li>
  )
}
