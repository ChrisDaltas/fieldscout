'use client'

import { Fragment } from 'react'

import { cn } from '@/lib/utils'

import type { CheckRow, CheckTone } from './team-ops'

/**
 * The Lineup check card above Starters on the Team tab (gap list §3 #11) —
 * the desktop team page's Lineup check in the phone's language (the handoff
 * has no such card): a b1 card like the team card, one row per check with a
 * tone dot, the value on the right. Injured and bye starters are named, and
 * a name opens the player card (mini first). The projection row is a
 * display-only read of stored projections — never a score.
 */
const DOT: Record<CheckTone, string> = {
  positive: 'bg-positive-strong',
  caution: 'bg-warn',
  neutral: 'bg-m-b4',
}

export function LineupCheckCard({ rows, onPlayer }: { rows: readonly CheckRow[]; onPlayer: (playerId: string) => void }) {
  return (
    <section aria-labelledby="lineup-check-title" className="px-3 pt-3" data-lineup-check>
      <div className="rounded-[18px] bg-m-b1 px-[14px] pb-1 pt-3">
        <h2 id="lineup-check-title" className="text-[15px] font-semibold tracking-[-0.01em]">
          Lineup check
        </h2>
        <ul className="mt-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-[10px] border-t border-m-b3 py-[10px] first:border-t-0" data-check={row.id} data-tone={row.tone}>
              <span aria-hidden className={cn('mt-[5px] size-2 flex-none rounded-full', DOT[row.tone])} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-medium">{row.label}</span>
                {row.sub && <span className="text-[12px] font-medium text-m-t3">{row.sub}</span>}
                {row.players.length > 0 && (
                  <span className="text-[12px] font-medium text-m-t3" data-check-players>
                    {row.players.map((p, i) => (
                      <Fragment key={p.id}>
                        <button type="button" onClick={() => onPlayer(p.id)} className="font-semibold text-m-t2">
                          {p.name}
                        </button>
                        {p.tag && <span className="ml-1 text-[11px] font-semibold text-m-red">{p.tag}</span>}
                        {i < row.players.length - 1 && ', '}
                      </Fragment>
                    ))}
                  </span>
                )}
                {row.note && <span className="text-[12px] font-medium text-m-t3">{row.note}</span>}
              </div>
              <div className="flex flex-none flex-col items-end gap-0.5 tabular-nums">
                <span className="text-[14px] font-semibold">{row.value}</span>
                {row.value2 && <span className="text-[12px] font-medium text-m-t3">{row.value2}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
