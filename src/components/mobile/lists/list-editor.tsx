'use client'

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MPosChip, posLabel } from '@/components/mobile/ui/m-pos-chip'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { listsKeys, useList, useUpdateList, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileListsCommit } from '@/hooks/use-mobile-lists-commit'
import { posRanks, rankPoolPositions, useMobileListsPool } from '@/hooks/use-mobile-lists-pool'
import { useMobileListsLatestWeek } from '@/hooks/use-mobile-lists-timeframe-stats'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useListDisplay, useListDisplayStore } from '@/stores/list-display-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { listTitleSchema, type RankingMode } from '@/types/schemas/lists'

import { AddPlayersSheet } from './add-players-sheet'
import { AddStatsSheet } from './add-stats-sheet'
import {
  MAX_TIERS,
  autoTierItems,
  editorItems,
  fillScores,
  moveItem,
  planCommit,
  playersLabel,
  shortName,
  tierCount,
  tierFillClass,
  tierTextClass,
  trailingMarkers,
  type EdItem,
} from './lists-model'
import { useListsNav } from './lists-nav'
import { CenterNote, GripIcon, InlineError, LIcon, PillButton, SwitchTrack, TimeFrameControl, type LIconName } from './lists-parts'
import { useListTimeFrame } from './lists-session-store'
import { resolveMobileStats } from './lists-stats'

/**
 * FieldScout Mobile — the list editor (lr-lists §2.3, states L4–L4g): no dock,
 * a title you edit in place, the Ranked / Tiers switches, stat chips with the
 * time frame, the tools row, and the rows — players and tier lines, reordered
 * by dragging the whole row.
 *
 * ## Where the app wins over the prototype (each is a lr-lists gap)
 *
 * - **Every change is saved as you make it**, as the desktop list is: the
 *   design's Save pill is "Done", and Back never discards anything (gap 16).
 *   Done waits for writes still in flight and says "List saved" only once
 *   they have all landed.
 * - **Touch drag works**: a long press (220ms) lifts a row, a 2px blue line
 *   shows where it will land — above the target moving up, below it moving
 *   down — and the edges auto-scroll (gaps 17, 18).
 * - **Ranked off + Tiers on can't be stored** (`ranking_mode` has three
 *   values), so turning Tiers on turns Ranked on, and Ranked off turns Tiers
 *   off. A list holds at most six tiers (S–F), so Add tier line stops there.
 * - **A tap on a player opens their profile** (with "Remove from list").
 * - Import a ranking is left out: the app has no rankings to import yet.
 */
export function ListEditor({ listId, autoAdd }: { listId: string; autoAdd: boolean }) {
  const nav = useListsNav()
  const qc = useQueryClient()
  const detail = useList(listId)
  const aiBuild = useAiListBuild(listId)
  const list = detail.data
  const close = () => nav.closeEdit(listId)

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] leading-[normal] text-m-t1 tabular-nums" data-mobile-screen>
      {detail.isError ? (
        <>
          <EditorHeader title={null} onBack={close} onDone={close} />
          <CenterNote
            title="This list could not be loaded."
            body={detail.error.message}
            action={<PillButton onClick={() => void detail.refetch()}>Try again</PillButton>}
          />
        </>
      ) : !list ? (
        <>
          <EditorHeader title={null} onBack={close} onDone={close} />
          <div className="flex flex-col gap-2.5 px-4 pt-2" aria-busy="true" aria-label="Loading list">
            <div className="flex gap-2">
              <div className="h-10 flex-1 animate-pulse rounded-xl bg-m-b1" />
              <div className="h-10 flex-1 animate-pulse rounded-xl bg-m-b1" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[46px] animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        </>
      ) : !list.is_owner || aiBuild.building ? (
        <>
          <EditorHeader title={list.title} onBack={close} onDone={close} />
          <CenterNote
            title={aiBuild.building ? 'The AI is still building this list.' : 'Only the owner can edit this list.'}
            action={<PillButton onClick={close}>Back to the list</PillButton>}
          />
        </>
      ) : (
        <EditorBody list={list} autoAdd={autoAdd} onClose={close} qc={qc} />
      )}
    </div>
  )
}

function EditorHeader({
  title,
  onBack,
  onDone,
  titleInput,
  busy = false,
}: {
  title: string | null
  onBack: () => void
  onDone: () => void
  titleInput?: React.ReactNode
  /** Waiting for writes still in flight before closing. */
  busy?: boolean
}) {
  return (
    <div className="flex h-[52px] flex-none items-center gap-2 px-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
      >
        <MIcon name="back" size={16} stroke={2} />
      </button>
      {titleInput ?? (
        <span className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold text-m-t1">{title ?? ''}</span>
      )}
      <button
        type="button"
        onClick={onDone}
        disabled={busy}
        aria-busy={busy || undefined}
        className="flex h-8 flex-none items-center rounded-pill bg-accent px-3.5 text-[13px] font-semibold text-white active:bg-accent-strong disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Done'}
      </button>
    </div>
  )
}

function EditorBody({
  list,
  autoAdd,
  onClose,
  qc,
}: {
  list: ListWithDetails
  autoAdd: boolean
  onClose: () => void
  qc: ReturnType<typeof useQueryClient>
}) {
  const updateList = useUpdateList(list.id)
  const commitMutation = useMobileListsCommit(list.id)
  const display = useListDisplay(list.id)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const [tf, setTf] = useListTimeFrame(list.id)

  const [title, setTitle] = React.useState(list.title)
  const [titleFocused, setTitleFocused] = React.useState(false)
  const [pendingMarkers, setPendingMarkers] = React.useState(0)
  const [localItems, setLocalItems] = React.useState<EdItem[] | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [statsOpen, setStatsOpen] = React.useState(false)
  const [finishing, setFinishing] = React.useState(false)

  // The design opens Add players on its own after "Next: add players" (and
  // the List view's empty-state "Add players" lands here the same way).
  React.useEffect(() => {
    if (autoAdd && list.players.length === 0) setAddOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!titleFocused) setTitle(list.title)
  }, [list.title, titleFocused])

  const mode = list.ranking_mode as RankingMode
  const tiersOn = mode === 'rank_and_tier'
  const ranked = mode !== 'unranked'

  const derived = React.useMemo(
    () => editorItems(list.players, tiersOn, tiersOn ? pendingMarkers : 0),
    [list.players, tiersOn, pendingMarkers],
  )
  const items = localItems ?? derived
  const players = items.filter((item): item is Extract<EdItem, { t: 'p' }> => item.t === 'p')

  // Pos rk ranks against the Add players pool; until it lands the cell is
  // blank, and if it fails the editor says so (never a row of "–").
  const pool = useMobileListsPool(
    rankPoolPositions(
      list.position_filter,
      list.players.map((entry) => entry.player.position),
    ),
    true,
  )
  const ranks = React.useMemo(() => (pool.data ? posRanks(pool.data) : null), [pool.data])

  const stats = React.useMemo(() => resolveMobileStats(display.cols), [display.cols])
  const latest = useMobileListsLatestWeek(stats.length > 0)
  const failed = [pool, latest].filter((query) => query.isError)

  // ---------------------------------------------------------------- writes --

  // Every write this screen starts, so Done can wait for them and only say
  // "List saved" once they have all landed.
  const inflight = React.useRef(new Set<Promise<unknown>>())
  const track = React.useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    inflight.current.add(promise)
    const settle = () => {
      inflight.current.delete(promise)
    }
    promise.then(settle, settle)
    return promise
  }, [])

  // The title being written, so a blur and a Done tap in the same gesture
  // send one rename, not two.
  const titleSent = React.useRef<string | null>(null)
  const saveTitle = () => {
    const parsed = listTitleSchema.safeParse(title)
    if (!parsed.success) {
      setTitle(list.title)
      return
    }
    if (parsed.data === list.title || parsed.data === titleSent.current) return
    titleSent.current = parsed.data
    track(updateList.mutateAsync({ title: parsed.data }))
      .catch((error: Error) => toast({ title: 'Could not rename the list', description: error.message }))
      .finally(() => {
        if (titleSent.current === parsed.data) titleSent.current = null
      })
  }

  // A big board's grouping is not the owner's to switch (desktop skips the
  // write too, `list-detail-panel.tsx` chooseOrg).
  const modeLocked = Boolean(list.is_big_board)
  const setMode = (next: RankingMode) => {
    if (next === mode || modeLocked) return
    const key = listsKeys.detail(list.id)
    const prev = qc.getQueryData<ListWithDetails>(key)
    if (prev) qc.setQueryData<ListWithDetails>(key, { ...prev, ranking_mode: next })
    if (next !== 'rank_and_tier') setPendingMarkers(0)
    track(updateList.mutateAsync({ ranking_mode: next })).catch((error: Error) => {
      if (prev) qc.setQueryData(key, prev)
      toast({ title: 'Could not save that setting', description: error.message })
    })
  }

  const commit = (next: EdItem[]) => {
    const plan = planCommit(next, list.players, tiersOn)
    setPendingMarkers(tiersOn ? trailingMarkers(next) : 0)
    if (!plan.order && plan.tiers.length === 0) return
    setLocalItems(next)
    track(commitMutation.mutateAsync({ ...plan, stored: list.players }))
      .catch((error: Error) => toast({ title: 'Could not save the new order', description: error.message }))
      .finally(() => setLocalItems(null))
  }

  /** Done: wait for the writes still in flight; "List saved" only when they
   *  all landed. A failed one has its own error toast up and the rows show
   *  what the server holds, so the editor stays open. */
  const finish = async () => {
    if (finishing) return
    saveTitle()
    const pending = [...inflight.current]
    if (pending.length > 0) {
      setFinishing(true)
      const results = await Promise.allSettled(pending)
      setFinishing(false)
      if (results.some((result) => result.status === 'rejected')) return
    }
    toast({ title: 'List saved' })
    onClose()
  }

  const canAutoTier = players.length >= 3 && fillScores(players.map((p) => p.entry.stats?.projected_pts ?? null)) !== null
  const canAddLine = tierCount(items) < MAX_TIERS && players.length > 0

  const tools: Array<{ label: string; icon: LIconName; onClick: () => void; disabled?: boolean }> = [
    { label: 'Add players', icon: 'plus', onClick: () => setAddOpen(true) },
    ...(tiersOn
      ? [
          {
            label: 'Auto tiers',
            icon: 'autoTiers' as const,
            disabled: !canAutoTier,
            onClick: () => {
              const next = autoTierItems(items)
              // No gap clears the rule: the user's tiers stay as they are and
              // nothing claims success (lr-lists gap 19).
              if (!next) {
                toast({ title: 'No clear tier breaks in this order.' })
                return
              }
              commit(next)
              toast({ title: 'Auto tiers applied. Drag a tier line to adjust.' })
            },
          },
          {
            label: 'Add tier line',
            icon: 'addTierLine' as const,
            disabled: !canAddLine,
            onClick: () => setPendingMarkers((n) => n + 1),
          },
        ]
      : []),
  ]

  return (
    <>
      <EditorHeader
        title={list.title}
        onBack={onClose}
        onDone={() => void finish()}
        busy={finishing}
        titleInput={
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => {
              setTitleFocused(false)
              saveTitle()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            maxLength={100}
            aria-label="List name"
            className="min-w-0 flex-1 bg-transparent text-center text-[16px] font-semibold text-m-t1 outline-none"
          />
        }
      />

      <div className="flex flex-none flex-col gap-2.5 border-b border-m-b3 px-4 pb-2.5">
        <div className="flex gap-2">
          <ToggleCard
            label="Ranked"
            on={ranked}
            disabled={modeLocked}
            onClick={() => setMode(ranked ? 'unranked' : 'ranked')}
          />
          <ToggleCard
            label="Tiers"
            on={tiersOn}
            disabled={modeLocked}
            onClick={() => setMode(tiersOn ? 'ranked' : 'rank_and_tier')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] font-semibold text-m-t1">Stats</span>
            {stats.length > 0 && <TimeFrameControl value={tf} onChange={setTf} latestWeek={latest.data ?? null} />}
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {stats.map((stat) => (
              <span
                key={stat.id}
                className="flex h-7 flex-none items-center gap-0.5 rounded-pill bg-accent pl-2.5 pr-1 text-[12px] font-semibold text-white"
              >
                {stat.chip}
                <button
                  type="button"
                  onClick={() => toggleCol(list.id, stat.id)}
                  aria-label={`Remove ${stat.chip}`}
                  // 20px as drawn; the tap area reaches 30px (lr-lists gap 32).
                  className="relative flex size-5 items-center justify-center rounded-full after:absolute after:-inset-[5px] after:content-['']"
                >
                  <MIcon name="close" size={9} stroke={2.6} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setStatsOpen(true)}
              className="flex h-7 flex-none items-center gap-1 rounded-pill border-[1.5px] border-m-b4 px-2.5 text-[12px] font-semibold text-m-t1 active:bg-m-b2"
            >
              <LIcon name="plus" size={10} stroke={2.4} />
              Add stat
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              onClick={tool.onClick}
              disabled={tool.disabled}
              className="flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-40"
            >
              <LIcon name={tool.icon} size={12} stroke={1.9} />
              {tool.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-medium text-m-t3">{playersLabel(players.length)} · drag to reorder</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(24px,env(safe-area-inset-bottom))] pt-1 scrollbar-none">
        {failed.length > 0 && (
          <InlineError
            className="mx-1 mb-1 mt-1.5"
            message="Some stats could not be loaded."
            onRetry={() => failed.forEach((query) => void query.refetch())}
          />
        )}
        {players.length === 0 ? (
          <CenterNote
            title="No players yet"
            body="Add players to start building this list."
            action={<PillButton onClick={() => setAddOpen(true)}>Add players</PillButton>}
          />
        ) : (
          <>
            {tiersOn && (
              <div className="flex items-center gap-2 px-1 pb-1 pt-2.5">
                <span className={cn('text-[12px] font-bold', tierTextClass(0))}>Tier 1</span>
                <span className="h-px flex-1 bg-m-b3" />
              </div>
            )}
            <DragRows
              items={items}
              ranked={ranked}
              ranks={ranks}
              listId={list.id}
              listTitle={list.title}
              onMove={(from, to) => commit(moveItem(items, from, to))}
              onMerge={(index) => {
                const item = items[index]
                if (item.t !== 'tier') return
                if (item.pending) {
                  setPendingMarkers((n) => Math.max(0, n - 1))
                  return
                }
                commit(items.filter((_, i) => i !== index))
              }}
            />
          </>
        )}
      </div>

      <AddPlayersSheet open={addOpen} onOpenChange={setAddOpen} list={list} tiersOn={tiersOn} track={track} />
      <AddStatsSheet open={statsOpen} onOpenChange={setStatsOpen} listId={list.id} />
    </>
  )
}

/** Ranked / Tiers card (lr-lists §2.3): the whole card is the switch. */
function ToggleCard({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 flex-1 items-center gap-2 rounded-xl bg-m-b1 pl-3 pr-2.5 text-left active:bg-m-b2h disabled:opacity-40"
    >
      <span className="flex-1 text-[13px] font-semibold text-m-t1">{label}</span>
      <SwitchTrack on={on} />
    </button>
  )
}

// =============================================================================
// Drag rows
// =============================================================================

function DragRows({
  items,
  ranked,
  ranks,
  listId,
  listTitle,
  onMove,
  onMerge,
}: {
  items: EdItem[]
  ranked: boolean
  ranks: Map<string, number> | null
  listId: string
  listTitle: string
  onMove: (from: number, to: number) => void
  onMerge: (index: number) => void
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press lifts a row; a quick swipe still scrolls the list.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const justDragged = React.useRef(false)

  const indexOf = (id: string | null) => (id ? items.findIndex((item) => item.id === id) : -1)
  const from = indexOf(activeId)
  const to = indexOf(overId)

  // Numbers count players only, not tier lines.
  const numbers = new Map<string, number>()
  let n = 0
  let tier = 1
  const tierNumber = new Map<string, number>()
  for (const item of items) {
    if (item.t === 'p') numbers.set(item.id, (n += 1))
    else if (item.t === 'tier') tierNumber.set(item.id, (tier += 1))
  }

  const end = (event: DragEndEvent) => {
    const a = indexOf(String(event.active.id))
    const b = event.over ? indexOf(String(event.over.id)) : -1
    setActiveId(null)
    setOverId(null)
    justDragged.current = true
    window.setTimeout(() => {
      justDragged.current = false
    }, 0)
    if (a >= 0 && b >= 0 && a !== b) onMove(a, b)
  }

  const active = from >= 0 ? items[from] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragOver={(event: DragOverEvent) => setOverId(event.over ? String(event.over.id) : null)}
      onDragEnd={end}
      onDragCancel={() => {
        setActiveId(null)
        setOverId(null)
      }}
    >
      {items.map((item, index) => (
        <DragItem
          key={item.id}
          item={item}
          dragging={item.id === activeId}
          indicator={from >= 0 && to === index && to !== from ? (to > from ? 'below' : 'above') : null}
        >
          {item.t === 'p' ? (
            <PlayerRowBody
              entry={item.entry}
              number={ranked ? (numbers.get(item.id) ?? null) : null}
              posRank={ranks ? (ranks.get(item.entry.player_id) ?? null) : undefined}
              listId={listId}
              listTitle={listTitle}
              blockClick={justDragged}
            />
          ) : item.t === 'tier' ? (
            <TierLineBody number={tierNumber.get(item.id) ?? 2} onMerge={() => onMerge(index)} />
          ) : (
            <div className="flex items-center gap-2 px-1 pb-1 pt-3">
              <span className="text-[12px] font-bold text-m-t3">Ungrouped</span>
              <span className="h-px flex-1 bg-m-b3" />
            </div>
          )}
        </DragItem>
      ))}
      <DragOverlay dropAnimation={null}>
        {active ? (
          // A drag ghost floats above the page, so it carries a resting shadow
          // (CLAUDE.md → "Elevation": drag ghosts are true overlays).
          <div className="rounded-[10px] bg-m-b0 shadow-m-menu">
            {active.t === 'p' ? (
              <PlayerRowBody
                entry={active.entry}
                number={ranked ? (numbers.get(active.id) ?? null) : null}
                posRank={ranks ? (ranks.get(active.entry.player_id) ?? null) : undefined}
                listId={listId}
                listTitle={listTitle}
                blockClick={justDragged}
              />
            ) : active.t === 'tier' ? (
              <TierLineBody number={tierNumber.get(active.id) ?? 2} onMerge={() => undefined} />
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function DragItem({
  item,
  dragging,
  indicator,
  children,
}: {
  item: EdItem
  dragging: boolean
  indicator: 'above' | 'below' | null
  children: React.ReactNode
}) {
  const drag = useDraggable({ id: item.id, disabled: item.t === 'ungrouped' })
  const drop = useDroppable({ id: item.id })
  const ref = (node: HTMLElement | null) => {
    drag.setNodeRef(node)
    drop.setNodeRef(node)
  }
  return (
    <div
      ref={ref}
      {...(item.t === 'ungrouped' ? {} : drag.listeners)}
      className={cn(
        'relative touch-manipulation select-none rounded-[10px] [-webkit-touch-callout:none]',
        item.t !== 'ungrouped' && 'cursor-grab',
        dragging && 'opacity-40',
      )}
    >
      {children}
      {indicator && (
        <span
          aria-hidden
          className={cn('pointer-events-none absolute inset-x-0 z-[2] h-0.5 rounded-pill bg-accent', indicator === 'above' ? 'top-0' : 'bottom-0')}
        />
      )}
    </div>
  )
}

function PlayerRowBody({
  entry,
  number,
  posRank,
  listId,
  listTitle,
  blockClick,
}: {
  entry: ListPlayerWithPlayer
  number: number | null
  /** `undefined` while the pool loads. */
  posRank: number | null | undefined
  listId: string
  listTitle: string
  blockClick: React.MutableRefObject<boolean>
}) {
  const player = entry.player
  const games = entry.stats?.current_games ?? 0
  const pts = entry.stats?.current_pts ?? 0
  const mini: Array<{ v: string; l: string }> = [
    { v: games > 0 ? pts.toFixed(1) : '–', l: 'Pts' },
    { v: games > 0 ? (pts / games).toFixed(1) : '–', l: 'Avg' },
    { v: posRank === undefined ? '' : posRank ? `${posLabel(player.position ?? '')}${posRank}` : '–', l: 'Pos rk' },
  ]
  const sub = [player.team ?? 'FA', player.bye_week ? `Bye ${player.bye_week}` : null].filter(Boolean).join(' · ')
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (blockClick.current) return
        openPlayer(entry.player_id, listId, listTitle)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') openPlayer(entry.player_id, listId, listTitle)
      }}
      aria-label={`${player.full_name}: tap for player details, long press to drag.`}
      className="flex min-h-[46px] items-center gap-[9px] border-b border-m-b2 bg-m-b0 py-1 pl-1 pr-2"
    >
      {number !== null && <span className="w-[22px] flex-none text-center text-[14px] font-bold tabular-nums">{number}</span>}
      <MHeadshot player={player} size={26} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-m-t1">{shortName(player.full_name, player.position)}</span>
        <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap text-[11px] font-medium text-m-t3">
          <MPosChip pos={player.position ?? ''} className="h-4 min-w-0 flex-none rounded-[4px] px-[5px] text-[9.5px]" />
          {sub}
        </span>
      </span>
      <span className="flex flex-none gap-0.5">
        {mini.map((cell) => (
          <span key={cell.l} className="flex w-9 flex-col items-center gap-px">
            <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-m-t1">{cell.v}</span>
            <span className="whitespace-nowrap text-[9px] font-medium text-m-t3">{cell.l}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

// The player profile opens through the shared store (on mobile it is the full
// profile — the design has no mini card); an owned list passes its context so
// the profile offers "Remove from list".
function openPlayer(playerId: string, listId: string, listTitle: string) {
  usePlayerModalStore.getState().openPlayerView(playerId, null, { listId, listTitle })
}

function TierLineBody({ number, onMerge }: { number: number; onMerge: () => void }) {
  const index = number - 1
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-3">
      <GripIcon className="text-m-t5" />
      <span className={cn('text-[12px] font-bold', tierTextClass(index))}>Tier {number}</span>
      <span className={cn('h-px flex-1 opacity-35', tierFillClass(index))} />
      <button
        type="button"
        title="Merge tiers"
        aria-label={`Merge Tier ${number} into Tier ${number - 1}`}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={onMerge}
        // 24px as drawn; the tap area reaches 30px (lr-lists gap 32).
        className="relative flex size-6 items-center justify-center rounded-full text-m-t3 after:absolute after:-inset-[3px] after:content-[''] active:bg-m-b2"
      >
        <MIcon name="close" size={10} stroke={2.4} />
      </button>
    </div>
  )
}
