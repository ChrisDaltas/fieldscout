'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { Icon } from '@/components/ui/icon'
import { useLists } from '@/hooks/use-lists'
import { useHistoryStore } from '@/stores/history-store'

const MAX_TILES = 12

/**
 * The home page's "Recently viewed" shelf. Driven by the client-side history
 * store (populated whenever a list detail page is opened). For lists the user
 * owns or has pinned we render the real 4-quadrant thumbnail; for anything
 * else we fall back to the stored image or a generic icon. FieldScout-only
 * surface (not in the package mock) — styled per the hub's white-card /
 * ink-border language.
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
      <h2 className="mb-2.5 text-h5">Recently viewed</h2>

      {recent.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white p-4">
          <p className="text-[13px] font-extrabold">Nothing here yet</p>
          <p className="mt-1 text-[11px] font-medium text-n-3">
            Lists you open will show up here so you can pick up where you left
            off.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {recent.map((entry) => {
            const id = entry.href.split('/').pop() ?? ''
            const list = listsById.get(id)
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="flex h-12 items-center gap-2.5 overflow-hidden rounded-sm border border-ink bg-white transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4"
                >
                  {list ? (
                    <ListThumbnail
                      positionFilter={list.position_filter}
                      isTeam={list.is_team ?? false}
                      imageUrl={list.thumbnail_url}
                      players={list.first_players}
                      size="md"
                      className="m-1"
                    />
                  ) : entry.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.imageUrl}
                      alt=""
                      className="m-1 h-10 w-10 shrink-0 rounded-sm border border-ink object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="m-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-ink bg-n-4 text-ink"
                    >
                      <Icon name="list" size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 pr-2.5">
                    <p className="truncate text-[12px] font-extrabold">
                      {list?.title ?? entry.name}
                    </p>
                    {(list || entry.subtitle) && (
                      <p className="truncate text-[10px] font-semibold text-n-3">
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
