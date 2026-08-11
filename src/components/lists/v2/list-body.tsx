'use client'

import * as React from 'react'

import { Icon } from '@/components/ui/icon'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import type { ListView } from '@/stores/list-display-store'

import { budgetShare, type Bucket } from './list-buckets'
import {
  BucketHeader,
  DraftedCheckbox,
  Grip,
  NoteMark,
  PlayerFace,
  PlayerMeta,
  RowMenu,
} from './list-row-parts'
import { formatStat, type StatDef } from './list-stats'

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
 * Drag-and-drop is **not** here. It is LV.4, with its own gap model (D5). The
 * grip renders because the row is 4px shorter without it and the design shows
 * one; it is inert and marked `aria-hidden`.
 */

export interface RowHandlers {
  isDrafted: (playerId: string) => boolean
  onToggleDrafted: (playerId: string) => void
  onEditNote: (entry: ListPlayerWithPlayer) => void
  onRemove: (entry: ListPlayerWithPlayer) => void
  canEdit: boolean
}

interface BodyProps {
  buckets: Bucket[]
  stats: StatDef[]
  view: ListView
  /** Budget grouping adds a share-of-budget column (`screens/detail-grouping-budget-pct.png`). */
  showBudgetShare: boolean
  budget: number
  handlers: RowHandlers
  onRenameBand: (bandKey: string, label: string) => void
  onAddToBucket: (bucket: Bucket) => void
}

export function ListBody(props: BodyProps) {
  if (props.view === 'table') return <TableBody {...props} />
  if (props.view === 'card') return <CardsBody {...props} />
  return <RowsBody {...props} />
}

/** A running `#N` across every bucket, as the prototype numbers them. */
function useRanks(buckets: Bucket[]): Map<string, number> {
  return React.useMemo(() => {
    const ranks = new Map<string, number>()
    let n = 0
    for (const bucket of buckets) {
      for (const entry of bucket.entries) {
        n += 1
        ranks.set(entry.id, n)
      }
    }
    return ranks
  }, [buckets])
}

const EMPTY_BUCKET = 'Nothing in this section yet.'

// =============================================================================
// List view — 48px rows, each stat a right-aligned cell with a caption
// =============================================================================

function RowsBody({
  buckets,
  stats,
  handlers,
  onRenameBand,
  onAddToBucket,
}: BodyProps) {
  const ranks = useRanks(buckets)

  return (
    <div className="flex flex-col gap-2.5">
      {buckets.map((bucket) => (
        <div
          key={bucket.key}
          className="border border-ink bg-white transition-shadow hover:shadow-hard-4"
        >
          {bucket.label !== null && (
            <BucketHeader
              bucket={bucket}
              canEdit={handlers.canEdit}
              onRename={onRenameBand}
              onAdd={() => onAddToBucket(bucket)}
            />
          )}
          <div className="overflow-x-auto">
            <div style={{ minWidth: 264 + stats.length * 58 }}>
              {bucket.entries.map((entry) => (
                <ListRow
                  key={entry.id}
                  entry={entry}
                  rank={ranks.get(entry.id) ?? 0}
                  stats={stats}
                  handlers={handlers}
                />
              ))}
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
}: {
  entry: ListPlayerWithPlayer
  rank: number
  stats: StatDef[]
  handlers: RowHandlers
}) {
  const drafted = handlers.isDrafted(entry.player_id)
  return (
    <div
      className={cn(
        'flex h-12 items-center gap-2.5 border-b border-n-4 px-2.5 transition-colors last:border-b-0',
        drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft',
      )}
    >
      <Grip />
      <span className="fs-num w-6 shrink-0 text-[10px] font-bold text-ink">#{rank}</span>
      <PlayerFace entry={entry} size={24} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-[11.5px] font-semibold leading-tight',
              drafted && 'line-through',
            )}
          >
            {entry.player.full_name}
          </span>
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
          onToggleDrafted: () => handlers.onToggleDrafted(entry.player_id),
          onEditNote: () => handlers.onEditNote(entry),
          onRemove: () => handlers.onRemove(entry),
          canEdit: handlers.canEdit,
        }}
      />
    </div>
  )
}

// =============================================================================
// Table view — 36px rows under one sticky column header
// =============================================================================

function TableBody({
  buckets,
  stats,
  showBudgetShare,
  budget,
  handlers,
  onRenameBand,
  onAddToBucket,
}: BodyProps) {
  const ranks = useRanks(buckets)
  const minWidth = 270 + (showBudgetShare ? 112 : 0) + stats.length * 70

  return (
    <div className="overflow-x-auto border border-ink bg-white transition-shadow hover:shadow-hard-4">
      <div style={{ minWidth }}>
        <div className="flex h-[29px] items-center gap-2.5 border-b border-ink bg-white px-2.5">
          <span className="w-[9px]" />
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
          <span className="w-5" />
        </div>

        {buckets.map((bucket) => (
          <div key={bucket.key}>
            {bucket.label !== null && (
              <BucketHeader
                compact
                bucket={bucket}
                canEdit={handlers.canEdit}
                onRename={onRenameBand}
                onAdd={() => onAddToBucket(bucket)}
              />
            )}
            {bucket.entries.map((entry) => (
              <TableRow
                key={entry.id}
                entry={entry}
                rank={ranks.get(entry.id) ?? 0}
                stats={stats}
                showBudgetShare={showBudgetShare}
                budget={budget}
                handlers={handlers}
              />
            ))}
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
  showBudgetShare,
  budget,
  handlers,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  stats: StatDef[]
  showBudgetShare: boolean
  budget: number
  handlers: RowHandlers
}) {
  const drafted = handlers.isDrafted(entry.player_id)
  const share = showBudgetShare ? budgetShare(entry, budget) : null

  return (
    <div
      className={cn(
        'flex h-9 items-center gap-2.5 border-b border-n-4 px-2.5 transition-colors',
        drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft',
      )}
    >
      <Grip />
      <span className="fs-num w-6 shrink-0 text-[10px] font-bold text-ink">#{rank}</span>
      <PlayerFace entry={entry} size={21} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            'min-w-0 truncate text-[11px] font-bold',
            drafted && 'line-through',
          )}
        >
          {entry.player.full_name}
        </span>
        <PlayerMeta entry={entry} />
      </span>

      {showBudgetShare && (
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
          onToggleDrafted: () => handlers.onToggleDrafted(entry.player_id),
          onEditNote: () => handlers.onEditNote(entry),
          onRemove: () => handlers.onRemove(entry),
          canEdit: handlers.canEdit,
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
function CardsBody({ buckets, stats, handlers, onAddToBucket }: BodyProps) {
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
            className={cn(
              'flex items-stretch',
              grouped && 'border border-ink bg-white transition-shadow hover:shadow-hard-4',
            )}
          >
            {grouped && (
              <div
                className={cn(
                  'flex w-[50px] shrink-0 flex-col items-center gap-0.5 border-r border-ink px-1.5 py-2',
                  bucket.className,
                )}
              >
                <span
                  className={cn(
                    'text-center font-bold leading-tight',
                    bucket.editableKey ? 'text-[9px]' : 'text-[18px]',
                  )}
                >
                  {bucket.label}
                </span>
                {bucket.meta ? (
                  <span className="fs-num text-[9px] font-medium">{bucket.meta}</span>
                ) : null}
                {handlers.canEdit ? (
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
              {bucket.entries.map((entry) => (
                <PlayerTile
                  key={entry.id}
                  entry={entry}
                  rank={ranks.get(entry.id) ?? 0}
                  positionRank={posRanks.get(entry.id) ?? 0}
                  stats={cardStats}
                  bandClassName={grouped ? bucket.className : null}
                  handlers={handlers}
                />
              ))}
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
}: {
  entry: ListPlayerWithPlayer
  rank: number
  positionRank: number
  stats: StatDef[]
  bandClassName: string | null
  handlers: RowHandlers
}) {
  const drafted = handlers.isDrafted(entry.player_id)

  return (
    <div
      className={cn(
        'group relative flex w-[131px] shrink-0 flex-col self-start border-1 border-ink transition-shadow hover:shadow-hard-4',
        drafted ? 'bg-n-4' : 'bg-white',
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
        <span
          className={cn(
            'max-w-full truncate text-center text-[12px] font-semibold leading-none',
            drafted && 'line-through',
          )}
        >
          {entry.player.full_name}
        </span>
        <span className="flex items-center gap-1">
          <span className={cn(drafted ? 'flex' : 'hidden group-hover:flex')}>
            <DraftedCheckbox
              drafted={drafted}
              onToggle={() => handlers.onToggleDrafted(entry.player_id)}
            />
          </span>
          <PlayerMeta entry={entry} />
          <NoteMark note={entry.notes} size={10} />
        </span>
        <span className="absolute right-0 top-0 hidden border-1 border-ink bg-white group-hover:inline-flex">
          <RowMenu
            actions={{
              drafted,
              omitDrafted: true,
              onToggleDrafted: () => handlers.onToggleDrafted(entry.player_id),
              onEditNote: () => handlers.onEditNote(entry),
              onRemove: () => handlers.onRemove(entry),
              canEdit: handlers.canEdit,
            }}
          />
        </span>
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
