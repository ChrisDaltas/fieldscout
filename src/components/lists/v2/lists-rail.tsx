'use client'

import type { ListWithTags } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import { ListCoverTile } from './cover-tile'
import { formatCreated } from './list-stats'

/**
 * Lists v2 — the rail (`screens/list-rail-list-view.png`).
 *
 * 160px wide (the design's 200px at this app's ×0.8 scale), sticky, and sharing
 * one edge with the detail panel — its right border is removed so the two read
 * as a single surface rather than two cards with a seam.
 *
 * A selected row takes the accent-soft wash **and** a 3px accent left border;
 * every other row keeps a transparent 3px border so selecting one never shifts
 * the text sideways. There is no per-row menu, by design.
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
        // `.fs-lift` per docs/design/lists/README.md §Geometry: flat at rest,
        // shadow on hover. The rail is a list of clickable rows, so the lift
        // is an affordance for the thing you are about to click.
        'flex flex-col overflow-y-auto border border-ink bg-white transition-shadow hover:shadow-hard-4 lg:sticky lg:top-3 lg:max-h-[calc(100vh-120px)] lg:border-r-0',
        className,
      )}
    >
      {!loaded && (
        <div className="flex flex-col gap-2 p-2" aria-busy="true" aria-label="Loading your lists">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex animate-pulse items-center gap-2">
              <span className="h-6 w-6 shrink-0 rounded-sm bg-n-4" />
              <span className="h-2.5 flex-1 rounded-sm bg-n-4" />
            </div>
          ))}
        </div>
      )}
      {loaded && lists.length === 0 && (
        <p className="px-3 py-5 text-center text-[11px] font-semibold text-n-3">{emptyMessage}</p>
      )}
      {lists.map((list) => {
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
            className={cn(
              'flex w-full items-center gap-2 border-b border-n-4 py-2 pl-2 pr-2.5 text-left transition-colors last:border-b-0',
              active
                ? 'border-l-[3px] border-l-accent bg-accent-soft'
                : 'border-l-[3px] border-l-transparent hover:bg-accent-soft',
            )}
          >
            <ListCoverTile list={list} players={list.first_players} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10.5px] font-bold leading-tight">
                {list.title}
              </span>
              <span className="mt-px block truncate text-[9px] font-medium leading-tight text-n-3">
                {list.player_count ?? 0} players · {formatCreated(list.created_at)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
