'use client'

import * as React from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useList, useLists, type ListWithTags } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import { MAX_BUDGET, MIN_BUDGET, useListDisplay, useListDisplayStore, type ListOrg } from '@/stores/list-display-store'

import { MAX_COMPARE, compareButtonLabel, type GroupOption } from './list-tools'
import { playersLabel } from './lists-model'
import { CenterNote, InlineError } from './lists-parts'

/**
 * FieldScout Mobile — the sheets behind the List options tools (gap list §3
 * #3): Group by, and the Side by side picker. Neither is in the design, so
 * both are drawn in its sheet language (the Scoring sheet's choice rows, the
 * pickers' round tick).
 */

// =============================================================================
// Ticks
// =============================================================================

/** The drafted tick: a 20px rounded square, accent and checked once marked. */
export function DraftedBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 flex-none items-center justify-center rounded-[6px]',
        on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m',
      )}
    >
      {on && <MIcon name="check" size={11} stroke={3} className="text-white" />}
    </span>
  )
}

/** A picker's round tick (the preseason / trade pickers' 22px circle). */
function PickTick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[22px] flex-none items-center justify-center rounded-full',
        on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m',
      )}
    >
      {on && <MIcon name="check" size={11} stroke={3} className="text-white" />}
    </span>
  )
}

// =============================================================================
// Group by
// =============================================================================

/**
 * Group by — desktop's grouping dropdown as a sheet. It's display only, like
 * desktop's side-by-side column menu: the pick is this session's (D3, the
 * shared `list-display-store`), and the list itself is never re-saved — a
 * list's Tiers switch stays in the editor. Budget % carries the auction
 * budget its bands are measured against (desktop's toolbar Budget field).
 */
export function GroupBySheet({
  open,
  onOpenChange,
  listId,
  options,
  value,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
  options: readonly GroupOption[]
  value: ListOrg
}) {
  const setOrg = useListDisplayStore((state) => state.setOrg)
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Group by" subtitle="How this list is split up" showClose>
      <div className="flex flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {options.map((option) => {
          const on = option.id === value
          return (
            <React.Fragment key={option.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setOrg(listId, option.id)
                  // Budget % stays open on its budget field.
                  if (option.id !== 'budget') onOpenChange(false)
                }}
                className="flex min-h-[52px] items-center gap-3 border-b border-m-b2 py-2 text-left last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[15px] font-semibold text-m-t1">{option.label}</span>
                  <span className="text-[12px] font-medium text-m-t3">{option.sub}</span>
                </span>
                {on && <MIcon name="check" size={16} stroke={2.4} className="flex-none text-accent" />}
              </button>
              {on && option.id === 'budget' && <BudgetField listId={listId} />}
            </React.Fragment>
          )
        })}
      </div>
    </MobileSheet>
  )
}

/** "Auction budget $200" — clamped by the store; a cleared field keeps the last budget. */
function BudgetField({ listId }: { listId: string }) {
  const budget = useListDisplay(listId).budget
  const setBudget = useListDisplayStore((state) => state.setBudget)
  const [text, setText] = React.useState(String(budget))
  React.useEffect(() => setText(String(budget)), [budget])
  return (
    <label className="flex h-12 items-center gap-3 border-b border-m-b2 pl-3">
      <span className="flex-1 text-[13px] font-semibold text-m-t2">Auction budget</span>
      <span className="flex h-9 items-center gap-0.5 rounded-xl bg-m-b2 px-3 text-[15px] font-semibold text-m-t1">
        $
        <input
          value={text}
          inputMode="numeric"
          aria-label="Auction budget"
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 5)
            setText(digits)
            if (digits) setBudget(listId, Number(digits))
          }}
          onBlur={() => setText(String(budget))}
          className="w-14 bg-transparent tabular-nums outline-none"
        />
      </span>
      <span className="sr-only">
        From {MIN_BUDGET} to {MAX_BUDGET}
      </span>
    </label>
  )
}

// =============================================================================
// Side by side: pick the lists
// =============================================================================

/**
 * Side by side, step one — desktop's picker (`side-by-side-picker.tsx`) as a
 * sheet: every list you have, your own first, then saved. Opened from a
 * list's options, that list is the first column and stays (`anchorId`);
 * opened from the comparison ("Change"), any two or more will do, and every
 * column already on screen keeps its row — one that isn't among your lists
 * (opened from Community) too, so Change never drops a column you didn't
 * untick. The button names what it will open and is off until it would
 * open a comparison ("prevent, don't refuse").
 */
export function ComparePickSheet({
  open,
  onOpenChange,
  initial,
  anchor: anchorList,
  onShow,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: readonly string[]
  /** The list this was opened from — always the first column, shown first
   *  even when it isn't one of yours (a list opened from Community). */
  anchor?: PickList
  onShow: (ids: string[]) => void
}) {
  const anchorId = anchorList?.id
  const lists = useLists(1, 50)
  const [picked, setPicked] = React.useState<string[]>(() => [...initial])
  React.useEffect(() => {
    if (open) setPicked([...initial])
    // Re-seed on each open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const all = lists.data?.lists
  const ordered = React.useMemo(() => {
    const rows = all ?? []
    const own = rows.filter((list) => !list.owner)
    const saved = rows.filter((list) => Boolean(list.owner))
    return [...own, ...saved]
  }, [all])
  const anchor = anchorList ? (ordered.find((list) => list.id === anchorList.id) ?? anchorList) : null
  const others = ordered.filter((list) => list.id !== anchorId)
  const yours = new Set(ordered.map((list) => list.id))
  // Columns on screen that aren't among your lists: each keeps a row, in
  // column order, ahead of your lists.
  const columns = initial.filter((id) => id !== anchorId && !yours.has(id))
  // A list ticked here counts while it has a row (one of yours deleted
  // elsewhere, and never a column, drops out with its row).
  const chosen = picked.filter((id) => yours.has(id) || id === anchorId || columns.includes(id))
  const full = chosen.length >= MAX_COMPARE

  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))

  const ready = chosen.length >= 2
  const show = () => {
    if (!ready) return
    const ids = anchorId ? [anchorId, ...chosen.filter((id) => id !== anchorId)] : chosen
    onOpenChange(false)
    onShow(ids)
  }

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Side by side"
      subtitle="Your lists as columns. Tick players off as they go and every column updates."
      showClose
      footer={
        <div className="border-t border-m-b2 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2.5">
          <button
            type="button"
            onClick={show}
            disabled={!ready}
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
              ready ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
            )}
          >
            {compareButtonLabel(chosen.length, Boolean(anchorId))}
          </button>
        </div>
      }
    >
      <div className="flex flex-col px-3 pb-2">
        {lists.isError ? (
          <InlineError className="mx-1 my-2" message="Your lists could not be loaded." onRetry={() => void lists.refetch()} />
        ) : !all ? (
          <div className="flex flex-col gap-1.5 px-1 py-1" aria-busy="true" aria-label="Loading your lists">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-m-b1" />
            ))}
          </div>
        ) : (
          <>
            {anchor && <PickRow list={anchor} on locked />}
            {columns.map((id) => {
              const on = chosen.includes(id)
              return <ColumnPickRow key={id} id={id} on={on} disabled={!on && full} onToggle={() => toggle(id)} />
            })}
            {others.length === 0 && columns.length === 0 ? (
              <CenterNote
                className="py-8"
                title="No other lists yet"
                body="Make a list, or save someone else’s, to compare it with this one."
              />
            ) : (
              others.map((list) => {
                const on = chosen.includes(list.id)
                return (
                  <PickRow
                    key={list.id}
                    list={list}
                    on={on}
                    disabled={!on && full}
                    onToggle={() => toggle(list.id)}
                  />
                )
              })
            )}
          </>
        )}
      </div>
    </MobileSheet>
  )
}

/** What a picker row draws — a collection row, or the open list itself. */
type PickList = Pick<
  ListWithTags,
  'id' | 'title' | 'player_count' | 'position_filter' | 'cover_color' | 'is_team' | 'thumbnail_url' | 'first_players' | 'owner'
>

/**
 * A column that isn't among your lists, drawn from its own loaded list (the
 * column's cache entry, so nothing extra is fetched). Until that's in, it
 * reads "List", and a list that can't be loaded says so — still ticked,
 * still yours to untick.
 */
function ColumnPickRow({
  id,
  on,
  disabled,
  onToggle,
}: {
  id: string
  on: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const detail = useList(id)
  const list: PickList = detail.data ?? {
    id,
    title: 'List',
    player_count: null,
    position_filter: null,
    cover_color: null,
    is_team: false,
    thumbnail_url: null,
  }
  return (
    <PickRow
      list={list}
      on={on}
      disabled={disabled}
      onToggle={onToggle}
      sub={detail.isError ? 'Could not load' : undefined}
    />
  )
}

function PickRow({
  list,
  on,
  locked = false,
  disabled = false,
  onToggle,
  sub: subOverride,
}: {
  list: PickList
  on: boolean
  /** The list the picker was opened from: ticked and fixed. */
  locked?: boolean
  disabled?: boolean
  onToggle?: () => void
  /** Replaces the usual sub-line (a column that couldn't be loaded). */
  sub?: string
}) {
  const sub = subOverride ?? [
    playersLabel(list.player_count ?? 0),
    // Inside a pick-list a name only ticks (ruling #42): plain text here.
    locked ? 'This list' : list.owner ? `@${list.owner.username}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={locked || disabled}
      onClick={onToggle}
      className="flex h-14 items-center gap-3 rounded-xl px-2 text-left active:bg-m-b2 disabled:opacity-100 [&:disabled:not([aria-pressed=true])]:opacity-40"
    >
      <PickTick on={on} />
      <ListThumbnail
        positionFilter={list.position_filter}
        coverColor={list.cover_color}
        isTeam={list.is_team ?? false}
        imageUrl={list.thumbnail_url}
        players={list.first_players}
        size={36}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold text-m-t1">{list.title}</span>
        <span className="truncate text-[12px] font-medium text-m-t3">{sub}</span>
      </span>
    </button>
  )
}
