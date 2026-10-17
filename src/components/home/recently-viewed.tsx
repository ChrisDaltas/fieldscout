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
 * surface (not in v7) — restyled in v7's card language: hairline tiles that
 * fill sunken grey on hover, 12px semibold name, 10px grey meta.
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
    <section className="flex flex-col gap-[9px]">
      <h2 className="text-h6">Recently viewed</h2>

      {recent.length === 0 ? (
        <div className="rounded-2xl border border-n-4 bg-white px-6 py-8 text-center">
          <p className="text-[15px] font-bold tracking-[-0.02em]">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[11px] font-medium leading-[1.45] text-n-6">
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
                  className="flex h-[52px] items-center gap-[9px] overflow-hidden rounded-xl border border-n-4 bg-white transition-colors hover:bg-surface-sunken"
                >
                  {list ? (
                    <ListThumbnail
                      positionFilter={list.position_filter}
                      coverColor={list.cover_color}
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
                      className="m-1 h-10 w-10 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="m-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-control text-n-3"
                    >
                      <Icon name="list" size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 pr-2.5">
                    <p className="truncate text-[12px] font-semibold tracking-[-0.01em] text-ink">
                      {list?.title ?? entry.name}
                    </p>
                    {(list || entry.subtitle) && (
                      <p className="truncate text-[10px] font-medium text-n-6">
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
