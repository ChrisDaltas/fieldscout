'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { BigBoardGrid } from '@/components/big-board/big-board-grid'
import { SortableBoardRow } from '@/components/big-board/board-row'
import { WeekTabs, type WeekTabValue } from '@/components/big-board/week-tabs'
import { PageHeader } from '@/components/layout/app-header'
import { POSITION_FILTER_ACTIVE } from '@/components/players/position-badge'
import { AIInsight } from '@/components/ui/ai-insight'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { bigBoardKeys, useWeeklyBigBoard } from '@/hooks/use-big-board'
import { useReorderPlayers } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'FLEX'] as const
type Position = (typeof POSITIONS)[number]

interface BoardEntry {
  player_id: string
  player: {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
    status?: string | null
    projected_pts_ppr?: number | null
  }
}

/** Vertical boards feel much steadier when the drag can't wander sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

function matchesPosition(playerPosition: string, filter: Position): boolean {
  if (filter === 'FLEX') {
    return playerPosition === 'RB' || playerPosition === 'WR' || playerPosition === 'TE'
  }
  return playerPosition === filter
}

interface WeeklyRanksViewProps {
  /** Current NFL week from Sleeper state (lib/sports-data/nfl-state); 0 = offseason (week 1 active). */
  currentWeek: number
  /** Open on the pre-draft tab (deep link: /app/weekly-ranks?tab=pre). */
  initialTab?: WeekTabValue
}

/**
 * Weekly rankings workspace — position chips, week tabs (Pre draft first,
 * linking to the big board), a drag-to-reorder board over the week's big
 * board data, and a Scout AI rail fed by real local edit state.
 *
 * The order edited here is the same per-week list the weekly big board
 * persists (reorder RPC) — position filters permute players within their own
 * slots so the rest of the week's board is never disturbed.
 */
export function WeeklyRanksView({ currentWeek, initialTab }: WeeklyRanksViewProps) {
  const activeWeek = currentWeek === 0 ? 1 : currentWeek
  const [tab, setTab] = useState<WeekTabValue>(initialTab ?? activeWeek)
  const [pos, setPos] = useState<Position>('QB')
  const [lastSubmittedWeek, setLastSubmittedWeek] = useState<number | null>(null)

  // Pre-draft renders the season board editor; weekly logic below treats the
  // active week as selected so its hooks stay mounted without fetching extra.
  const isPre = tab === 'pre'
  const week = typeof tab === 'number' ? tab : activeWeek

  const status: 'past' | 'current' | 'future' =
    week < activeWeek ? 'past' : week === activeWeek ? 'current' : 'future'
  // Fetching a future week would auto-create its board server-side — never
  // mount the query for locked weeks (mirrors WeeklyBigBoardView). The pre
  // tab doesn't need weekly data either.
  const query = useWeeklyBigBoard(status === 'future' || isPre ? -1 : week)
  const { data, isLoading, isError, error } = query

  const listId = data?.list?.id ?? ''
  const reorder = useReorderPlayers(listId)
  const qc = useQueryClient()
  const { toast } = useToast()
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  const serverPlayers = useMemo<BoardEntry[]>(
    () => (data?.players ?? []) as BoardEntry[],
    [data],
  )
  const serverOrder = useMemo(
    () => serverPlayers.map((p) => p.player_id),
    [serverPlayers],
  )
  const playerById = useMemo(() => {
    const map = new Map<string, BoardEntry>()
    for (const p of serverPlayers) map.set(p.player_id, p)
    return map
  }, [serverPlayers])

  const [fullOrder, setFullOrder] = useState<string[]>(serverOrder)
  useEffect(() => {
    setFullOrder(serverOrder)
  }, [serverOrder])

  const dirty = useMemo(() => {
    if (fullOrder.length !== serverOrder.length) return true
    for (let i = 0; i < fullOrder.length; i++) {
      if (fullOrder[i] !== serverOrder[i]) return true
    }
    return false
  }, [fullOrder, serverOrder])

  const inFilter = (id: string) => {
    const entry = playerById.get(id)
    return Boolean(entry && matchesPosition(entry.player.position, pos))
  }
  const subsetIds = fullOrder.filter(inFilter)
  const serverSubset = serverOrder.filter(inFilter)
  const subsetPlayers = subsetIds
    .map((id) => playerById.get(id))
    .filter((p): p is BoardEntry => Boolean(p))

  // Real local edit state: how far each player sits from the last saved
  // order within this position view. Powers the badge, rail, and insight.
  const moves = subsetIds.map((id, i) => ({
    id,
    delta: serverSubset.indexOf(id) - i, // positive = climbed
  }))
  const edits = moves.filter((m) => m.delta !== 0).length
  const riser = moves.reduce<(typeof moves)[number] | null>(
    (best, m) => (m.delta > 0 && (!best || m.delta > best.delta) ? m : best),
    null,
  )
  const faller = moves.reduce<(typeof moves)[number] | null>(
    (worst, m) => (m.delta < 0 && (!worst || m.delta < worst.delta) ? m : worst),
    null,
  )
  const subsetDirty = edits > 0

  const canEdit = status === 'current'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = subsetIds.indexOf(String(active.id))
    const to = subsetIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const nextSubset = arrayMove(subsetIds, from, to)
    // Re-thread the permuted position group through its original slots so
    // every other position keeps its place in the week's full order.
    setFullOrder((prev) => {
      let i = 0
      return prev.map((id) => (inFilter(id) ? nextSubset[i++] : id))
    })
  }

  const handleSubmit = () => {
    if (!listId || !dirty || reorder.isPending) return
    const positions = fullOrder.map((playerId, i) => ({ playerId, position: i + 1 }))
    reorder.mutate(positions, {
      onSuccess: () => {
        setLastSubmittedWeek(week)
        toast({ title: `Week ${week} · ${pos} ranks submitted` })
        qc.invalidateQueries({ queryKey: bigBoardKeys.week(week) })
      },
      onError: (err) =>
        toast({
          title: 'Could not submit',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  // TODO(scout-ai): no Scout AI / consensus baseline exists for weekly boards
  // yet — this stays a stub until a baseline API lands.
  const handleResetToScoutAi = () => {
    toast({ title: 'Reset to Scout AI — coming soon' })
  }

  const submitted = !dirty && lastSubmittedWeek === week
  const playersRanked = subsetIds.length
  const statusLabel = reorder.isPending
    ? 'Submitting…'
    : dirty
      ? 'In progress'
      : submitted
        ? 'Submitted'
        : 'Saved'

  const nameOf = (id: string | undefined) =>
    id ? playerById.get(id)?.player.full_name ?? null : null
  const riserName = riser ? nameOf(riser.id) : null
  const fallerName = faller ? nameOf(faller.id) : null

  return (
    <>
      <PageHeader
        title="Rankings"
        actions={
          <Button asChild variant="stroke" size="sm">
            <Link href="/app/weekly-ranks/history">
              <Icon name="clock" size={13} /> History
            </Link>
          </Button>
        }
      />

      {isPre ? (
        <section>
          <WeekTabs
            className="mb-4"
            active="pre"
            currentWeek={currentWeek}
            onSelectWeek={setTab}
            onSelectPre={() => setTab('pre')}
          />
          <BigBoardGrid currentWeek={currentWeek} showWeekTabs={false} />
        </section>
      ) : (
      <section className="grid items-start gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* min-w-0 lets this grid column shrink so the wide week-tab row
            scrolls internally instead of blowing out the page width. */}
        <div className="min-w-0">
          {/* actions → position chips → week tabs → board */}
          <div className="mb-3.5 flex flex-wrap items-center justify-end gap-2.5">
            <Button
              variant="stroke"
              size="sm"
              onClick={handleResetToScoutAi}
              disabled={!canEdit}
            >
              <Icon name="repeat" size={13} /> Reset to Scout AI
            </Button>
            <Button
              variant="green"
              size="sm"
              onClick={handleSubmit}
              disabled={!canEdit || !dirty || reorder.isPending || !listId}
            >
              <Icon name="check" size={13} />
              {reorder.isPending
                ? 'Submitting…'
                : lastSubmittedWeek === week
                  ? 'Re-submit'
                  : 'Submit'}
            </Button>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {POSITIONS.map((p) => (
              <FilterChip
                key={p}
                pressed={pos === p}
                onPressedChange={() => setPos(p)}
                className={pos === p ? POSITION_FILTER_ACTIVE[p] : undefined}
              >
                {p}
              </FilterChip>
            ))}
          </div>

          <WeekTabs
            className="mb-4"
            active={week}
            currentWeek={currentWeek}
            onSelectWeek={setTab}
            onSelectPre={() => setTab('pre')}
          />

          {status === 'future' ? (
            <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
              <Icon name="clock" size={20} className="mx-auto text-n-3" />
              <h3 className="mt-3 text-h6">Week {week} is locked</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-n-3">
                You can rank the current week only. This board unlocks once the
                prior week kicks off.
              </p>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : isError || !data ? (
            <div className="rounded-sm border border-ink bg-white px-6 py-10 text-center">
              <h3 className="text-h6">Could not load this week</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-negative-strong">
                {(error as Error)?.message ?? 'Something went wrong loading this board.'}
              </p>
            </div>
          ) : (
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-ink px-4 py-2.5">
                <span className="text-[12px] font-extrabold">
                  Week {week} · {pos} board
                </span>
                {submitted && (
                  <Badge variant="green">
                    <Icon name="check" size={11} /> Submitted
                  </Badge>
                )}
                {subsetDirty && <Badge variant="yellow">Unsubmitted edits</Badge>}
                <span className="ml-auto whitespace-nowrap text-[11px] font-bold text-n-3">
                  {canEdit ? 'Drag to reorder' : 'View only'}
                </span>
              </div>
              {subsetPlayers.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <h3 className="text-h6">No {pos} players on this board</h3>
                  <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-n-3">
                    This week&apos;s board seeds from your big board — add
                    players there and they&apos;ll show up here.
                  </p>
                  <Button asChild variant="stroke" size="sm" className="mt-4">
                    <Link href={`/app/big-board/week/${week}`}>
                      Open the full week board
                    </Link>
                  </Button>
                </div>
              ) : canEdit ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={subsetIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-0.5 p-1">
                      {subsetPlayers.map((entry, i) => (
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
                  {subsetPlayers.map((entry, i) => (
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
        </div>

        {/* rail */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-[74px]">
          <AIInsight
            heading={
              status === 'future'
                ? `Week ${week} hasn't opened yet`
                : edits > 0
                  ? `${edits} ${pos} ${edits === 1 ? 'player' : 'players'} moved from your saved board`
                  : `Your ${pos} board matches your last save`
            }
          >
            {status === 'future' ? (
              <>Come back after kickoff — the current week&apos;s board is where the points get won.</>
            ) : edits > 0 ? (
              <>
                {riserName && (
                  <>
                    Biggest riser: {riserName}{' '}
                    <span className="fs-num font-bold text-positive-strong">
                      ▲{riser!.delta}
                    </span>
                    .{' '}
                  </>
                )}
                {fallerName && (
                  <>
                    Biggest faller: {fallerName}{' '}
                    <span className="fs-num font-bold text-negative-strong">
                      ▼{Math.abs(faller!.delta)}
                    </span>
                    .{' '}
                  </>
                )}
                Submit to lock the story in.
              </>
            ) : (
              <>Drag players to make this week&apos;s call your own, then submit it.</>
            )}
          </AIInsight>

          <Card>
            <div className="border-b border-ink px-4 py-2.5">
              <span className="text-[12px] font-extrabold">
                Week {week} · {pos}
              </span>
            </div>
            <div className="flex flex-col gap-3 p-card-pad">
              {(
                [
                  ['Players ranked', String(playersRanked)],
                  ['Edited from saved', String(edits)],
                  ['Status', statusLabel],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2.5 text-[13px] font-bold"
                >
                  <span className="whitespace-nowrap text-n-3">{label}</span>
                  <span className="fs-num whitespace-nowrap font-extrabold">
                    {value}
                  </span>
                </div>
              ))}
              <div className="border-t border-ink pt-3">
                <div className="mb-1.5 flex items-center justify-between gap-2.5 text-[12px] font-bold">
                  <span className="whitespace-nowrap text-n-3">Completeness</span>
                  <span className="fs-num whitespace-nowrap font-extrabold">
                    {playersRanked} / {playersRanked}
                  </span>
                </div>
                <Progress value={playersRanked > 0 ? 100 : 0} />
              </div>
            </div>
          </Card>
        </div>
      </section>
      )}
    </>
  )
}
