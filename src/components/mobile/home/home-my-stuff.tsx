'use client'

import Link from 'next/link'

import { M_ICON } from '@/components/mobile/ui/m-icon'
import { useMobileHomeStuff, type StuffCount } from '@/hooks/use-mobile-home-stuff'

import { plural } from './home-ops'
import { HomeNote, HomeSectionTitle } from './home-section'

/** The design's up-and-down arrows (Start/Sit tile). */
const START_SIT_PATH = 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5'

interface Tile {
  label: string
  href: string
  path: string
  sub: string | null
  error: boolean
}

function sub<T>(count: StuffCount<T>, text: (value: T) => string): Pick<Tile, 'sub' | 'error'> {
  if (count.error) return { sub: 'Couldn’t load', error: true }
  return { sub: count.value === null ? null : text(count.value), error: false }
}

/**
 * "My stuff" (m-home §2A.2–3): tiles that open Profile on that segment, with
 * the user's live counts. Rankings and Start/Sit appear only while those
 * surfaces are released (the same flags Profile's segments follow), so a
 * tile never opens a segment that isn't there; the grid keeps its three
 * columns so each tile keeps its designed size. Until a count loads its
 * line keeps its height empty (no placeholder number); a count that fails
 * says so, with Try again under the tiles.
 */
export function HomeMyStuff() {
  const stuff = useMobileHomeStuff(Date.now())
  const tiles: Tile[] = [
    ...(stuff.rankings
      ? [{ label: 'Rankings', href: '/app/profile?tab=rankings', path: M_ICON.rank, ...sub(stuff.rankings, (n) => plural(n, 'ranking')) }]
      : []),
    { label: 'Lists', href: '/app/profile?tab=lists', path: M_ICON.lists, ...sub(stuff.lists, (n) => plural(n, 'list')) },
    ...(stuff.startSit
      ? [
          {
            label: 'Start/Sit',
            href: '/app/profile?tab=ss',
            path: START_SIT_PATH,
            ...sub(stuff.startSit, (c) => `${c.open} open · ${c.closed} closed`),
          },
        ]
      : []),
  ]
  const failed = tiles.some((t) => t.error)
  return (
    <section>
      <HomeSectionTitle title="My stuff" className="mt-[14px]" />
      <div className="mt-2 grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="flex min-h-[92px] min-w-0 flex-col justify-between gap-[10px] rounded-[16px] bg-m-b1 p-3 active:bg-m-b2h"
            data-stuff-tile={t.label}
          >
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-m-ink text-white" aria-hidden>
              <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d={t.path} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[14px] font-semibold leading-[17px] text-m-t1">{t.label}</span>
              <span className="truncate text-[11px] font-medium leading-[14px] text-m-t3">{t.sub ?? ' '}</span>
            </span>
          </Link>
        ))}
      </div>
      {failed && (
        <HomeNote tone="error" action={{ label: 'Try again', onClick: stuff.retry }}>
          Couldn’t load some of your counts.
        </HomeNote>
      )}
    </section>
  )
}
