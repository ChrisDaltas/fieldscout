'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { History as HistoryIcon, ListOrdered } from 'lucide-react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { useLists } from '@/hooks/use-lists'
import { useHistoryStore } from '@/stores/history-store'

const MAX_TILES = 12

/**
 * The home page's "Recently Viewed" shelf. Driven by the client-side history
 * store (populated whenever a list detail page is opened). For lists the user
 * owns or has pinned we render the real 4-quadrant thumbnail; for anything
 * else we fall back to the stored image or a generic icon.
 */
export function RecentlyViewed() {
  const entries = useHistoryStore((s) => s.entries)
  const { data } = useLists(1, 100)

  const listsById = useMemo(() => {
    const map = new Map((data?.lists ?? []).map((l) => [l.id, l]))
    return map
  }, [data])

  const recent = useMemo(
    () => entries.filter((e) => e.type === 'list').slice(0, MAX_TILES),
    [entries],
  )

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <HistoryIcon className="h-4 w-4 text-foreground" />
        Recently Viewed
      </h2>

      {recent.length === 0 ? (
        <p className="rounded-lg bg-bg-elevated p-6 text-sm text-text-secondary">
          Lists you open will show up here so you can pick up where you left off.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {recent.map((entry) => {
            const id = entry.href.split('/').pop() ?? ''
            const list = listsById.get(id)
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="group flex h-14 items-center gap-3 overflow-hidden rounded-lg bg-bg-elevated transition-colors hover:bg-bg-elevated-2"
                >
                  {list ? (
                    <ListThumbnail
                      positionFilter={list.position_filter}
                      isTeam={list.is_team ?? false}
                      imageUrl={list.thumbnail_url}
                      players={list.first_players}
                      size="md"
                    />
                  ) : entry.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.imageUrl}
                      alt=""
                      className="m-1 h-12 w-12 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="m-1 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-bg-elevated-2 text-foreground ring-1 ring-bg-elevated-3"
                    >
                      <ListOrdered className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {list?.title ?? entry.name}
                    </p>
                    {(list || entry.subtitle) && (
                      <p className="truncate text-[10px] text-text-tertiary">
                        {list
                          ? `${list.player_count} player${list.player_count === 1 ? '' : 's'}`
                          : entry.subtitle}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
