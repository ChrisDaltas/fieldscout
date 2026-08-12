'use client'

import * as React from 'react'

import { Icon } from '@/components/ui/icon'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import type { ListOrg, ListView } from '@/stores/list-display-store'

import {
  budgetShare,
  canReorder,
  COMPUTED_ORDER_REASON,
  bucketZoneLabel,
  nextBucket,
  rankMap,
  type Bucket,
} from './list-buckets'
import {
  BucketHeader,
  DraftedCheckbox,
  DropGap,
  Grip,
  NewBucketZone,
  NoteMark,
  PlayerFace,
  PlayerMeta,
  PlayerName,
  RowMenu,
} from './list-row-parts'
import type { DropTarget } from './list-reorder'
import { formatStat, type StatDef } from './list-stats'
import { ListDragContext, useDragHandle, useListDrag, type ListDragApi } from './use-list-drag'

/**
 * Lists v2 — the list body in its three view styles.
 *
 * References: `screens/list-rail-list-view.png`, `screens/list-rail-table-view.png`,
 * `screens/list-rail-cards-view.png`, and the four grouping captures.
 *
 * **Drafted is a display treatment and nothing more** (plan D2): a recessed row
 * and a strikethrough on the name. It never reorders or filters — every
 * screenshot with drafted players keeps them exactly where they sat.
 *
 * **Drag-and-drop is the gap model** (design LAW §"Drag and drop", plan D5,
 * LV.4): the row being dragged dims, and the hole it will drop into opens at
 * exactly its own size. Rows never highlight themselves. The mechanics live in
 * `use-list-drag.tsx`; what a drop *means* lives in `list-reorder.ts`; this file
 * only places the targets.
 */

export interface RowHandlers {
  isDrafted: (playerId: string) => boolean
  /** Omitted where `canMark` is false, and unreachable when it is. */
  onToggleDrafted?: (playerId: string) => void
  /** Omitted where `canEdit` is false, and unreachable when it is. */
  onEditNote?: (entry: ListPlayerWithPlayer) => void
  /** Omitted where `canEdit` is false, and unreachable when it is. */
  onRemove?: (entry: ListPlayerWithPlayer) => void
  /**
   * Click the player's name → the app's existing floating player card
   * (`player-window.tsx` via `player-windows-store`). The design LAW names this
   * for the List and Cards styles; it is offered in all three, because a name
   * that opens research in two of three view styles is a worse rule than one
   * that always does.
   *
   * Optional, and omitted by the public share view (LV.6) — a signed-out
   * stranger has no research panel, and LV.6's subtractions are deliberate.
   */
  onOpenPlayer?: (entry: ListPlayerWithPlayer) => void
  /** Owner (and not mid-AI-build): rename, remove, reorder, add. */
  canEdit: boolean
  /**
   * Can this viewer mark players drafted? Separate from `canEdit` because a
   * drafted mark is *per viewer* (`list_player_drafted.user_id`, LV.1.2) rather
   * than per owner — but it still needs an account, so the public share view
   * (LV.6) passes `false` and the checkbox and its menu item disappear instead
   * of offering a signed-out write that would 401.
   */
  canMark: boolean
}

interface BodyProps {
  buckets: Bucket[]
  stats: StatDef[]
  view: ListView
  /** Decides both the label set and whether a section can be rearranged. */
  org: ListOrg
  /** Budget grouping adds a share-of-budget column (`screens/detail-grouping-budget-pct.png`). */
  showBudgetShare: boolean
  budget: number
  handlers: RowHandlers
  /**
   * The three write gestures. **Optional on purpose**: a surface that cannot
   * perform them omits them, rather than passing a no-op that would let a
   * future edit re-enable the affordance and silently do nothing (CLAUDE.md:
   * never let "nothing happened" mean "it worked"). The public share view
   * passes none of the three.
   */
  onRenameBand?: (bandKey: string, label: string) => void
  onAddToBucket?: (bucket: Bucket) => void
  onDrop?: (entryId: string, target: DropTarget) => void
}

/** What each view style receives once the drag layer is resolved. */
interface ViewProps extends BodyProps {
  drag: ListDragApi
  canDrag: boolean
  /** Why dragging is unavailable, shown on the grip. `null` when it is. */
  dragReason: string | null
  /**
   * Does a grip belong on these rows at all?
   *
   * A grip means one of two things: "drag me", or "you could drag here but not
   * in this grouping, and here is why". A viewer who can never reorder this
   * list gets **neither** — a permanently inert 9px dot column is furniture
   * that lies about an affordance (the same rule that hides the drafted
   * checkbox on the public view). The table header's leading spacer follows
   * this flag so the columns stay aligned when it goes.
   */
  showGrip: boolean
  /**
   * Does the row menu have anything in it? `RowMenu` answers `null` when it
   * does not, so the table header's trailing spacer has to follow the same
   * rule or the columns drift by one control's width.
   */
  showMenu: boolean
  /** The dragged player's name — it rides inside the open gap. */
  dragName: string
}

const noDrop = () => {}

export function ListBody(props: BodyProps) {
  const reorderable = canReorder(props.org)
  const canDrag = props.handlers.canEdit && Boolean(props.onDrop) && reorderable
  const drag = useListDrag({
    enabled: canDrag,
    horizontal: props.view === 'card',
    onDrop: props.onDrop ?? noDrop,
  })

  const dragName = React.useMemo(() => {
    if (!drag.dragId) return ''
    for (const bucket of props.buckets) {
      const found = bucket.entries.find((entry) => entry.id === drag.dragId)
      if (found) return found.player.full_name
    }
    return ''
  }, [drag.dragId, props.buckets])

  const dragReason =
    props.handlers.canEdit && Boolean(props.onDrop) && !reorderable
      ? COMPUTED_ORDER_REASON
      : null

  const view: ViewProps = {
    ...props,
    drag,
    canDrag,
    dragReason,
    showGrip: canDrag || dragReason !== null,
    showMenu: props.handlers.canEdit || props.handlers.canMark,
    dragName,
  }

  const fresh = nextBucket(props.org, props.buckets)

  return (
    <ListDragContext drag={drag}>
      <div className="flex flex-col gap-2.5">
        {props.view === 'table' ? (
          <TableBody {...view} />
        ) : props.view === 'card' ? (
          <CardsBody {...view} />
        ) : (
          <RowsBody {...view} />
        )}
        {/* "A dashed 'Drop a player here to start tier N' zone sits below the
            last section" — list and cards only, as in the prototype, and only
            where the assignment can actually be written (see nextBucket, which
            answers for rounds as well as tiers since LV.1.5). */}
        {canDrag && fresh && props.view !== 'table' && (
          <NewBucketZone
            bucketKey={fresh}
            label={bucketZoneLabel(props.org, fresh)}
            over={drag.isOverNew()}
          />
        )}
      </div>
    </ListDragContext>
  )
}

/**
 * A running `#N` across every bucket, as the prototype numbers them.
 *
 * The rule itself moved to `list-buckets.ts` at LV.13, where a Side by side
 * column reads it too — a column and the detail panel must not disagree about
 * which number a player carries. This is only its memo.
 */
function useRanks(buckets: Bucket[]): Map<string, number> {
  return React.useMemo(() => rankMap(buckets), [buckets])
}

const EMPTY_BUCKET = 'Nothing in this section yet.'

/** The accent outline the prototype puts on a section a drop would land in. */
function bucketOutline(drag: ListDragApi, bucketKey: string): string | false {
  return drag.isOverBucket(bucketKey) && 'outline outline-2 -outline-offset-2 outline-accent'
}

// =============================================================================
// List view — 48px rows, each stat a right-aligned cell with a caption
// =============================================================================

function RowsBody(props: ViewProps) {
  const { buckets, stats, handlers, onRenameBand, onAddToBucket, drag, dragName } = props
  const ranks = useRanks(buckets)
  const minWidth = 264 + stats.length * 58

  return (
    <div className="flex flex-col gap-2.5">
      {buckets.map((bucket) => (
        <div
          key={bucket.key}
          data-drop-bucket={bucket.key}
          className={cn(
            'border border-ink bg-white transition-shadow hover:shadow-hard-4',
            bucketOutline(drag, bucket.key),
          )}
        >
          {bucket.label !== null && (
            <BucketHeader
              bucket={bucket}
              canEdit={handlers.canEdit}
              onRename={onRenameBand}
              onAdd={onAddToBucket && (() => onAddToBucket(bucket))}
            />
          )}
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>
              {bucket.entries.map((entry, index) => (
                <React.Fragment key={entry.id}>
                  {drag.active && (
                    <DropGap
                      bucketKey={bucket.key}
                      index={index}
                      open={drag.isOpen(bucket.key, index)}
                      height={drag.size.height}
                      width={drag.size.width}
                      name={dragName}
                      minWidth={minWidth}
                    />
                  )}
                  <ListRow
                    entry={entry}
                    rank={ranks.get(entry.id) ?? 0}
                    stats={stats}
                    handlers={handlers}
                    bucketKey={bucket.key}
                    index={index}
                    view={props}
                  />
                </React.Fragment>
              ))}
              {drag.active && bucket.entries.length > 0 && (
                <DropGap
                  bucketKey={bucket.key}
                  index={bucket.entries.length}
                  open={drag.isOpen(bucket.key, bucket.entries.length)}
                  height={drag.size.height}
                  width={drag.size.width}
                  name={dragName}
                  minWidth={minWidth}
                />
              )}
              {bucket.entries.length === 0 && (
                <div className="p-4 text-center text-[11px] font-semibold text-n-3">
                  {EMPTY_BUCKET}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ListRow({
  entry,
  rank,
  stats,
  handlers,
  bucketKey,
  index,
  view,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  stats: StatDef[]
  handlers: RowHandlers
  bucketKey: string
  index: number
  view: ViewProps
}) {
  const drafted = handlers.isDrafted(entry.player_id)
  const { listeners, setNodeRef } = useDragHandle(entry.id, !view.canDrag)
  const dragging = view.drag.dragId === entry.id

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drop-row={`${bucketKey}:${index}`}
      data-drag-id={entry.id}
      className={cn(
        'flex h-12 items-center gap-2.5 border-b border-n-4 px-2.5 transition-[background-color,opacity] last:border-b-0',
        drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft',
        view.canDrag && 'touch-manipulation',
        dragging && 'opacity-35',
      )}
    >
      {view.showGrip && (
        <Grip draggable={view.canDrag} reason={view.dragReason ?? undefined} />
      )}
      <span className="fs-num w-6 shrink-0 text-[10px] font-bold text-ink">#{rank}</span>
      <PlayerFace entry={entry} size={24} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <PlayerName
            name={entry.player.full_name}
            drafted={drafted}
            onOpen={handlers.onOpenPlayer && (() => handlers.onOpenPlayer?.(entry))}
            className="min-w-0 truncate text-[11.5px] font-semibold leading-tight"
          />
          <NoteMark note={entry.notes} />
        </span>
        <PlayerMeta entry={entry} className="mt-1" />
      </span>
      {stats.map((stat) => (
        <span key={stat.id} className="w-[50px] shrink-0 text-right">
          <span className="block text-[11.5px] font-medium leading-none tabular-nums">
            {formatStat(stat, entry)}
          </span>
          <span className="mt-1 block whitespace-nowrap text-[8px] font-normal leading-none text-n-3">
            {stat.label}
          </span>
        </span>
      ))}
      <RowMenu
        actions={{
          drafted,
          onToggleDrafted: () => handlers.onToggleDrafted?.(entry.player_id),
          onEditNote: () => handlers.onEditNote?.(entry),
          onRemove: () => handlers.onRemove?.(entry),
          canEdit: handlers.canEdit,
          canMark: handlers.canMark,
        }}
      />
    </div>
  )
}

// =============================================================================
// Table view — 36px rows under one sticky column header
// =============================================================================

function TableBody(props: ViewProps) {
  const {
    buckets,
    stats,
    showBudgetShare,
    handlers,
    onRenameBand,
    onAddToBucket,
    drag,
    dragName,
  } = props
  const ranks = useRanks(buckets)
  const minWidth = 270 + (showBudgetShare ? 112 : 0) + stats.length * 70

  return (
    <div className="overflow-x-auto border border-ink bg-white transition-shadow hover:shadow-hard-4">
      <div style={{ minWidth }}>
        <div className="flex h-[29px] items-center gap-2.5 border-b border-ink bg-white px-2.5">
          {props.showGrip && <span className="w-[9px]" />}
          <span className="w-6 text-[9px] font-medium text-n-3">#</span>
          <span className="w-[21px]" />
          <span className="flex-1 text-[9px] font-medium text-n-3">Player</span>
          {showBudgetShare && (
            <span className="w-[104px] text-right text-[9px] font-medium text-n-3">
              Share of budget
            </span>
          )}
          {stats.map((stat) => (
            <span
              key={stat.id}
              title={stat.full}
              className="w-[70px] shrink-0 cursor-help text-right text-[9px] font-medium text-n-3"
            >
              {stat.label}
            </span>
          ))}
          <span className="w-4" />
          {props.showMenu && <span className="w-5" />}
        </div>

        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            data-drop-bucket={bucket.key}
            className={cn(bucketOutline(drag, bucket.key))}
          >
            {bucket.label !== null && (
              <BucketHeader
                compact
                bucket={bucket}
                canEdit={handlers.canEdit}
                onRename={onRenameBand}
                onAdd={onAddToBucket && (() => onAddToBucket(bucket))}
              />
            )}
            {bucket.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {drag.active && (
                  <DropGap
                    bucketKey={bucket.key}
                    index={index}
                    open={drag.isOpen(bucket.key, index)}
                    height={drag.size.height}
                    width={drag.size.width}
                    name={dragName}
                    minWidth={minWidth}
                  />
                )}
                <TableRow
                  entry={entry}
                  rank={ranks.get(entry.id) ?? 0}
                  stats={stats}
                  handlers={handlers}
                  bucketKey={bucket.key}
                  index={index}
                  view={props}
                />
              </React.Fragment>
            ))}
            {drag.active && bucket.entries.length > 0 && (
              <DropGap
                bucketKey={bucket.key}
                index={bucket.entries.length}
                open={drag.isOpen(bucket.key, bucket.entries.length)}
                height={drag.size.height}
                width={drag.size.width}
                name={dragName}
                minWidth={minWidth}
              />
            )}
            {bucket.entries.length === 0 && (
              <div className="border-b border-n-4 p-3 text-center text-[11px] font-semibold text-n-3">
                {EMPTY_BUCKET}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TableRow({
  entry,
  rank,
  stats,
  handlers,
  bucketKey,
  index,
  view,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  stats: StatDef[]
  handlers: RowHandlers
  bucketKey: string
  index: number
  view: ViewProps
}) {
  const drafted = handlers.isDrafted(entry.player_id)
  const share = view.showBudgetShare ? budgetShare(entry, view.budget) : null
  const { listeners, setNodeRef } = useDragHandle(entry.id, !view.canDrag)
  const dragging = view.drag.dragId === entry.id

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drop-row={`${bucketKey}:${index}`}
      data-drag-id={entry.id}
      className={cn(
        'flex h-9 items-center gap-2.5 border-b border-n-4 px-2.5 transition-[background-color,opacity]',
        drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft',
        view.canDrag && 'touch-manipulation',
        dragging && 'opacity-35',
      )}
    >
      {view.showGrip && (
        <Grip draggable={view.canDrag} reason={view.dragReason ?? undefined} />
      )}
      <span className="fs-num w-6 shrink-0 text-[10px] font-bold text-ink">#{rank}</span>
      <PlayerFace entry={entry} size={21} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <PlayerName
          name={entry.player.full_name}
          drafted={drafted}
          onOpen={handlers.onOpenPlayer && (() => handlers.onOpenPlayer?.(entry))}
          className="min-w-0 truncate text-[11px] font-bold"
        />
        <PlayerMeta entry={entry} />
      </span>

      {view.showBudgetShare && (
        <span className="flex w-[104px] shrink-0 items-center gap-1.5">
          <span className="relative h-[7px] flex-1 border border-ink bg-n-4">
            <span
              className="absolute inset-y-0 left-0 bg-brand"
              style={{ width: `${Math.min(100, (share ?? 0) * 2.5)}%` }}
            />
          </span>
          <span className="fs-num w-[26px] text-right text-[10px] font-medium">
            {share == null ? '—' : `${share}%`}
          </span>
        </span>
      )}

      {stats.map((stat) => (
        <span
          key={stat.id}
          className="fs-num w-[70px] shrink-0 text-right text-[11px] font-semibold"
        >
          {formatStat(stat, entry)}
        </span>
      ))}
      <span className="flex w-4 shrink-0 justify-center">
        <NoteMark note={entry.notes} size={12} />
      </span>
      <RowMenu
        actions={{
          drafted,
          onToggleDrafted: () => handlers.onToggleDrafted?.(entry.player_id),
          onEditNote: () => handlers.onEditNote?.(entry),
          onRemove: () => handlers.onRemove?.(entry),
          canEdit: handlers.canEdit,
          canMark: handlers.canMark,
        }}
      />
    </div>
  )
}

// =============================================================================
// Cards view — 131px tiles, wrapping inside each section
// =============================================================================

/**
 * Grouped sections get a 50px label rail down the left filled with the band
 * colour; a plain ranked list has **no rail and no container at all** — the
 * cards sit straight on the page (design LAW, "View style: Cards").
 */
function CardsBody(props: ViewProps) {
  const { buckets, stats, handlers, onAddToBucket, drag, dragName } = props
  const ranks = useRanks(buckets)
  const posRanks = usePositionRanks(buckets)
  // Card view renders the first three chosen stats; list and table show all
  // (design LAW; `colsForView` in list-display-store).
  const cardStats = stats.slice(0, 3)

  return (
    <div className="flex flex-col gap-2.5">
      {buckets.map((bucket) => {
        const grouped = bucket.label !== null
        return (
          <div
            key={bucket.key}
            data-drop-bucket={bucket.key}
            className={cn(
              'flex items-stretch',
              grouped && 'border border-ink bg-white transition-shadow hover:shadow-hard-4',
              bucketOutline(drag, bucket.key),
            )}
          >
            {grouped && (
              <div
                className={cn(
                  'flex w-[50px] shrink-0 flex-col items-center gap-0.5 border-r border-ink px-1.5 py-2',
                  bucket.className,
                )}
              >
                {/* Size by the label, not by whether it is renameable. The
                    rail is 50px wide and the 18px face is for the *value*
                    alone — `S`, `4`. `Ungrouped` and `No auction value` are
                    words, and at 18px they ran straight out of the rail and
                    over the cards; both were reachable before LV.6 and both
                    are on the public share view the moment a list carries a
                    round key. */}
                <span
                  className={cn(
                    'min-w-0 break-words text-center font-bold leading-tight',
                    (bucket.label?.length ?? 0) > 3 ? 'text-[9px]' : 'text-[18px]',
                  )}
                >
                  {bucket.label}
                </span>
                {bucket.meta ? (
                  <span className="fs-num text-[9px] font-medium">{bucket.meta}</span>
                ) : null}
                {handlers.canEdit && onAddToBucket ? (
                  <button
                    type="button"
                    onClick={() => onAddToBucket(bucket)}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium opacity-85 hover:opacity-100"
                  >
                    Add
                    <Icon name="plus" size={9} />
                  </button>
                ) : null}
              </div>
            )}
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-wrap content-start items-start gap-2',
                grouped && 'p-2',
              )}
            >
              {bucket.entries.map((entry, index) => (
                <React.Fragment key={entry.id}>
                  {drag.active && drag.isOpen(bucket.key, index) && (
                    <DropGap
                      axis="x"
                      bucketKey={bucket.key}
                      index={index}
                      open
                      height={drag.size.height}
                      width={drag.size.width}
                      name={dragName}
                    />
                  )}
                  <PlayerTile
                    entry={entry}
                    rank={ranks.get(entry.id) ?? 0}
                    positionRank={posRanks.get(entry.id) ?? 0}
                    stats={cardStats}
                    bandClassName={grouped ? bucket.className : null}
                    handlers={handlers}
                    bucketKey={bucket.key}
                    index={index}
                    view={props}
                  />
                </React.Fragment>
              ))}
              {drag.active && drag.isOpen(bucket.key, bucket.entries.length) && (
                <DropGap
                  axis="x"
                  bucketKey={bucket.key}
                  index={bucket.entries.length}
                  open
                  height={drag.size.height}
                  width={drag.size.width}
                  name={dragName}
                />
              )}
              {bucket.entries.length === 0 && (
                <div className="px-1.5 py-4 text-[11px] font-medium text-n-3">{EMPTY_BUCKET}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The card's top-right ordinal.
 *
 * The design shows the player's **pool-wide** positional rank (`2nd`, `9th`).
 * That number needs the whole player pool ranked by position, which this screen
 * never loads, so this is their rank **within this list** among players of the
 * same position — the same shape, a narrower claim. Named rather than passed
 * off as the design's number.
 */
function usePositionRanks(buckets: Bucket[]): Map<string, number> {
  return React.useMemo(() => {
    const seen = new Map<string, number>()
    const ranks = new Map<string, number>()
    for (const bucket of buckets) {
      for (const entry of bucket.entries) {
        const position = entry.player.position ?? '—'
        const next = (seen.get(position) ?? 0) + 1
        seen.set(position, next)
        ranks.set(entry.id, next)
      }
    }
    return ranks
  }, [buckets])
}

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const

function ordinal(value: number): string {
  const mod100 = value % 100
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : (ORDINAL_SUFFIX[value % 10] ?? 'th')
  return `${value}${suffix}`
}

function PlayerTile({
  entry,
  rank,
  positionRank,
  stats,
  bandClassName,
  handlers,
  bucketKey,
  index,
  view,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  positionRank: number
  stats: StatDef[]
  bandClassName: string | null
  handlers: RowHandlers
  bucketKey: string
  index: number
  view: ViewProps
}) {
  const drafted = handlers.isDrafted(entry.player_id)
  const { listeners, setNodeRef } = useDragHandle(entry.id, !view.canDrag)
  const dragging = view.drag.dragId === entry.id

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drop-row={`${bucketKey}:${index}`}
      data-drag-id={entry.id}
      className={cn(
        'group relative flex w-[131px] shrink-0 flex-col self-start border-1 border-ink transition-[box-shadow,opacity] hover:shadow-hard-4',
        drafted ? 'bg-n-4' : 'bg-white',
        view.canDrag && 'cursor-grab touch-manipulation',
        dragging && 'opacity-35',
      )}
    >
      <div className="relative flex flex-col items-center gap-1 px-1.5 pb-1.5 pt-1.5">
        {/* Corner cells sit flush to the corner, closed by an inner rule. */}
        <span
          className={cn(
            'fs-num absolute left-0 top-0 inline-flex h-[18px] items-center border-b-1 border-r-1 border-ink px-1.5 text-[10px] font-bold leading-none',
            bandClassName ?? 'bg-brand text-ink',
          )}
        >
          #{rank}
        </span>
        <span
          title={`${ordinal(positionRank)} ${entry.player.position ?? ''} on this list`}
          className="fs-num absolute right-0 top-0 inline-flex h-[18px] items-center border-b-1 border-l-1 border-ink px-1.5 text-[10px] font-bold leading-none text-ink"
        >
          {ordinal(positionRank)}
        </span>
        <PlayerFace entry={entry} size={30} round />
        <PlayerName
          name={entry.player.full_name}
          drafted={drafted}
          onOpen={handlers.onOpenPlayer && (() => handlers.onOpenPlayer?.(entry))}
          className="max-w-full truncate text-center text-[12px] font-semibold leading-none"
        />
        <span className="flex items-center gap-1">
          {handlers.canMark && (
            <span className={cn(drafted ? 'flex' : 'hidden group-hover:flex')}>
              <DraftedCheckbox
                drafted={drafted}
                onToggle={() => handlers.onToggleDrafted?.(entry.player_id)}
              />
            </span>
          )}
          <PlayerMeta entry={entry} />
          <NoteMark note={entry.notes} size={10} />
        </span>
        {view.showMenu && (
          <span className="absolute right-0 top-0 hidden border-1 border-ink bg-white group-hover:inline-flex">
            <RowMenu
              actions={{
                drafted,
                omitDrafted: true,
                onToggleDrafted: () => handlers.onToggleDrafted?.(entry.player_id),
                onEditNote: () => handlers.onEditNote?.(entry),
                onRemove: () => handlers.onRemove?.(entry),
                canEdit: handlers.canEdit,
                canMark: handlers.canMark,
              }}
            />
          </span>
        )}
      </div>
      {stats.length > 0 && (
        <div
          className="grid border-t-1 border-ink"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map((stat) => (
            <span key={stat.id} className="min-w-0 px-px pb-1 pt-1.5 text-center">
              <span className="block text-[12px] font-medium leading-none tabular-nums">
                {formatStat(stat, entry)}
              </span>
              <span className="mt-0.5 block truncate text-[8px] font-normal leading-none text-n-3">
                {stat.label}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
