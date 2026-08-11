'use client'

import { formatCreated } from './lists-view-state'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { cn } from '@/lib/utils'

import type { ListWithTags } from '@/hooks/use-lists'

/**
 * Lists v2 — the rail (handoff §"Lists page" → Mode: List (rail)).
 *
 * Sticky column of every list in the active tab. Its right border is removed
 * so it shares one edge with the panel beside it — the two-column grid in
 * `lists-page-v2.tsx` runs with no gap for the same reason.
 *
 * Rows: cover tile + name + `N players · Aug 8`, a hairline bottom rule, and a
 * selected treatment of an accent-soft fill with a 3px accent left border.
 * No per-row menu, by design.
 *
 * Scale: the handoff's 200px rail / 30px cover / 9px-10px padding are 1×
 * numbers from a 0.8-zoom shell, so they land here at the app's ×0.8 token
 * scale (delivery plan §1, "Scale") — 160px, 24px, 7px/8px.
 */
interface ListsRailProps {
  lists: ListWithTags[]
  selectedId: string | null
  onSelect: (list: ListWithTags) => void
  /** Shown when the active tab has nothing in it. */
  emptyMessage: string
}

export function ListsRail({
  lists,
  selectedId,
  onSelect,
  emptyMessage,
}: ListsRailProps) {
  return (
    <nav
      aria-label="Your lists"
      className={cn(
        'flex flex-col overflow-auto rounded-sm border-1 border-ink bg-white transition-shadow',
        // Elevation is a hover affordance only — flat at rest.
        'shadow-none hover:shadow-hard-4',
        // Shared edge with the panel to its right (desktop grid only).
        'lg:sticky lg:top-0 lg:max-h-[calc(100vh-9rem)] lg:border-r-0',
      )}
    >
      {lists.length === 0 ? (
        <p className="px-3 py-5 text-center text-[10px] font-semibold leading-snug text-n-3">
          {emptyMessage}
        </p>
      ) : (
        lists.map((list) => {
          const selected = list.id === selectedId
          return (
            <button
              key={list.id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(list)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-n-4 border-l-[3px] px-2 py-[7px] text-left transition-colors last:border-b-0',
                // Selected and hovered share the accent-soft wash; the 3px
                // accent left border is what separates them (handoff
                // §"Mode: List (rail)"). A dimmed hover wash was tried and is
                // invisible against white at this row height.
                selected
                  ? 'border-l-accent bg-accent-soft'
                  : 'border-l-transparent bg-transparent hover:bg-accent-soft',
              )}
            >
              <ListThumbnail
                size="xs"
                positionFilter={list.position_filter}
                isTeam={Boolean(list.is_team)}
                imageUrl={list.thumbnail_url}
                players={list.first_players}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-extrabold leading-tight text-ink">
                  {list.title}
                </span>
                <span className="mt-0.5 block truncate text-[9px] font-medium leading-tight text-n-3">
                  <span className="fs-num">{list.player_count ?? 0}</span>
                  {(list.player_count ?? 0) === 1 ? ' player' : ' players'}
                  {list.created_at ? ` · ${formatCreated(list.created_at)}` : ''}
                </span>
              </span>
            </button>
          )
        })
      )}
    </nav>
  )
}
