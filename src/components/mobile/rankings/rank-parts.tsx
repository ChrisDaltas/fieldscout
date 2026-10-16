'use client'

import { fmt1 } from '@/components/mobile/rankings/rankings-ops'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import type { PoolStat } from '@/hooks/use-mobile-rankings-sources'
import { cn } from '@/lib/utils'

/**
 * Small shared pieces of the mobile Rankings screens (lr-frame §2.13): the
 * icon paths the shared `MIcon` set lacks, the Pts / Avg / Pos rk stat
 * columns, and the status pill.
 */

/** 16×16 stroke icons used only in this area (lr-frame §2.13.12). */
export const RK_ICON = {
  chevronDown: 'M4 6l4 4 4-4',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  back: 'M10 3L5 8l5 5',
  check: 'M3 8.5l3.2 3L13 4.5',
  plusSmall: 'M8 3.5v9M3.5 8h9',
} as const

export function RkIcon({
  d,
  size = 16,
  stroke = 2,
  className,
}: {
  d: string
  size?: number
  stroke?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d={d} />
    </svg>
  )
}

export interface StatCell {
  v: string
  l: string
}

/** Three 36px stat columns, 2px apart: value 12/600 over a 9/500 label. */
export function StatCells({ cells }: { cells: readonly StatCell[] }) {
  return (
    <div className="flex flex-none gap-[2px]">
      {cells.map((c) => (
        <div key={c.l} className="flex w-9 flex-col items-center gap-px">
          <span className="whitespace-nowrap text-[12px] font-semibold text-m-t1">{c.v}</span>
          <span className="whitespace-nowrap text-[9px] font-medium text-m-t3">{c.l}</span>
        </div>
      ))}
    </div>
  )
}

/** Season-to-date Pts / Avg / Pos rk for a row ("–" until a game is played). */
export function statCells(stat: PoolStat | undefined, position: string): StatCell[] {
  const played = stat && stat.games > 0 ? stat : null
  return [
    { v: played ? fmt1(played.pts) : '–', l: 'Pts' },
    { v: played ? fmt1(played.pts / played.games) : '–', l: 'Avg' },
    { v: stat?.posRank ? `${posLabel(position)}${stat.posRank}` : '–', l: 'Pos rk' },
  ]
}

/**
 * A ranking's status on the phone (Chris, 2026-10-15): Published — the
 * app's one saved state, which is the ranking that counts — or Finalized, a
 * played week. There is no "saved but not published" or draft state.
 */
export type RankStatus = 'Finalized' | 'Published'

const STATUS_CLASS: Record<RankStatus, string> = {
  Finalized: 'bg-m-t1 text-m-b0',
  // Publish is "save and submit", so it wears the design's Submitted colours.
  Published: 'bg-m-gg text-m-tg',
}

export function StatusPill({ status }: { status: RankStatus }) {
  return (
    <span
      className={cn(
        'flex h-[22px] flex-none items-center whitespace-nowrap rounded-pill px-2 text-[11px] font-semibold',
        STATUS_CLASS[status],
      )}
    >
      {status}
    </span>
  )
}
