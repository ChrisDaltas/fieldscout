'use client'

import { Icon } from '@/components/ui/icon'
import type { ListWithTags } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import { ListCoverTile } from './cover-tile'
import { formatCreated } from './list-stats'

/**
 * Lists v2 — the rail, drawn as v7's context panel (`FieldScout Next v7`,
 * the Lists panel).
 *
 * A white column with a hairline right edge on desktop (a hairline card when
 * it stacks above the open list on a phone). Rows are v7 nav rows: 31px, an
 * 8px-rounded hit area, the cover tile in the glyph slot, an 11px title and a
 * 10px grey player count on the right. The list's age moves to the row's
 * tooltip — v7 rows carry one meta value, not a second line.
 *
 * The selected row is a **fill** (`bg-surface-selected`), never a shadow or a
 * coloured edge; other rows take the sunken fill on hover. The column itself
 * does not lift — it is a container, not a control (CLAUDE.md, "Elevation").
 * There is no per-row menu, by design.
 */
export function ListsRail({
  lists,
  loaded,
  selectedId,
  onSelect,
  emptyMessage,
  className,
}: {
  lists: ListWithTags[]
  /**
   * Whether the collection has actually arrived.
   *
   * Without this the rail said "No lists yet" for every reason it held no rows
   * — including "the request has not answered". A deliberately-broken
   * `/api/lists` rendered a confident empty state over a request that had never
   * succeeded, which is the exact shape CLAUDE.md names: never let "nothing
   * happened" mean "it worked".
   */
  loaded: boolean
  selectedId: string | null
  onSelect: (list: ListWithTags) => void
  emptyMessage: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-px overflow-y-auto rounded-2xl border border-n-4 bg-white p-[5px] [scrollbar-width:none]',
        'lg:sticky lg:top-3 lg:max-h-[calc(100vh-120px)] lg:rounded-none lg:border-0 lg:border-r lg:py-0 lg:pl-0 lg:pr-2.5',
        className,
      )}
    >
      {!loaded && (
        <div className="flex flex-col gap-px" aria-busy="true" aria-label="Loading your lists">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex h-[31px] animate-pulse items-center gap-2 px-2">
              <span className="h-5 w-5 shrink-0 rounded bg-surface-control" />
              <span className="h-2.5 flex-1 rounded-md bg-surface-control" />
            </div>
          ))}
        </div>
      )}
      {loaded && lists.length === 0 && (
        <p className="px-3 py-5 text-center text-[11px] font-medium text-n-6">{emptyMessage}</p>
      )}
      {groupRows(lists).map((group) => (
        <div key={group.label} className="flex flex-col gap-px">
          <span className="flex h-[26px] shrink-0 items-center px-2 text-[10px] font-semibold text-n-3">
            {group.label}
          </span>
          {group.lists.map((list) => renderRow(list))}
        </div>
      ))}
    </div>
  )

  function renderRow(list: ListWithTags) {
    const active = list.id === selectedId
    return (
      <button
        key={list.id}
        type="button"
        onClick={() => onSelect(list)}
        aria-current={active ? 'true' : undefined}
        // The visible title is inside a nested span next to an aria-hidden
        // cover tile; naming the control explicitly keeps it announceable.
        aria-label={list.title}
        title={`${list.player_count ?? 0} players · ${formatCreated(list.created_at)}`}
        className={cn(
          'flex h-[31px] w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-ink transition-colors',
          active ? 'bg-surface-selected' : 'hover:bg-surface-sunken',
        )}
      >
        <ListCoverTile list={list} players={list.first_players} size={20} />
        <span className="min-w-0 flex-1 truncate text-[11px] leading-tight">
          <span className={active ? 'font-semibold' : 'font-medium'}>
            {list.title}
            {/* Pinned. The control lives in the hero's dots menu (LV.7);
                this is the state it produces, so a pin taken in Cards mode
                is legible here too. */}
            {list.is_favorited && (
              <Icon
                name="marker"
                size={9}
                className="ml-1 inline-block text-accent"
                aria-label="Pinned"
              />
            )}
          </span>
        </span>
        <span className="fs-num shrink-0 text-[10px] font-medium text-n-6">
          {list.player_count ?? 0}
        </span>
      </button>
    )
  }
}

/**
 * v7 groups the panel's rows under small grey headers. The rail is handed one
 * tab's lists, so the grouping is read off the rows themselves: `owner` is set
 * only on a list someone else owns (the Saved tab). Order within a group is the
 * order the page passed in.
 */
function groupRows(lists: ListWithTags[]): { label: string; lists: ListWithTags[] }[] {
  const own = lists.filter((list) => !list.owner)
  const saved = lists.filter((list) => Boolean(list.owner))
  return [
    { label: 'My lists', lists: own },
    { label: 'Saved', lists: saved },
  ].filter((group) => group.lists.length > 0)
}
