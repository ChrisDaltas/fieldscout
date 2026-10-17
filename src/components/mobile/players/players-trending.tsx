'use client'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { cn } from '@/lib/utils'

import { ActionPill, type ActionDoor } from './players-actions'
import { PathIcon } from './players-chrome'

/**
 * FieldScout Mobile — League › Players "Trending" section (spec m-players
 * §2.2): a collapsible header and a sideways row of 190px tiles.
 *
 * The design's tiles are trending ADDS (rostered %, 7-day change, add
 * counts); the app has no such source. It has one trend signal — this
 * season's projection against last season's points, the one mobile Home's
 * "Trending players" shows (`useMobileHomeTrending`, the same cache) — so
 * the tiles are Home's risers, and each says what its number is
 * ("+38.1 vs last yr") where the design's "Rost 14.8% +4.5" sits. Proj is
 * this week's projection in the league's scoring, as in the design.
 */

const TREND_ICON = 'M2.5 11.5l4-4 3 3 4-5M10 5.5h3.5V9'
const CHEVRON_UP = 'M4 10l4-4 4 4'

export interface TrendTile {
  id: string
  player: { id: string; full_name: string; position: string; team: string | null; headshot_url: string | null }
  short: string
  /** "{team} · {game}" (or the team alone when the week's games are not on record). */
  teamLine: string
  /** Projection vs last season's points (Home's trend), signed text + direction. */
  delta: { text: string; up: boolean }
  /** This week's league projection, "–" when there is none. */
  proj: string
  /** Null when the viewer has no team here (no actions). */
  door: ActionDoor | null
}

export function TrendingSection({
  open,
  onToggle,
  state,
  tiles,
  onOpen,
  onRetry,
}: {
  open: boolean
  onToggle: () => void
  state: 'loading' | 'error' | 'ready'
  tiles: readonly TrendTile[]
  onOpen: (id: string) => void
  onRetry: () => void
}) {
  return (
    <section className="mt-2.5" data-players-trending>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-7 w-full items-center gap-1.5 px-4 text-left">
        <PathIcon d={TREND_ICON} size={13} stroke={1.9} className="text-m-t1" />
        <span className="flex-1 text-[13px] font-semibold text-m-t1">Trending</span>
        <PathIcon d={CHEVRON_UP} size={11} stroke={2.2} className={cn('text-m-t4', !open && 'rotate-180')} />
      </button>
      {open &&
        (state === 'loading' ? (
          <div className="flex gap-1.5 overflow-hidden px-3 pb-0.5 pt-1" data-skeleton="trending">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[92px] w-[190px] flex-none animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        ) : state === 'error' ? (
          <div className="flex items-center gap-3 px-4 pb-0.5 pt-1.5 text-[13px] font-medium text-m-t3" role="alert">
            <span className="min-w-0 flex-1">Couldn’t load trending players.</span>
            <button type="button" onClick={onRetry} className="h-8 flex-none rounded-full bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h">
              Try again
            </button>
          </div>
        ) : tiles.length === 0 ? (
          <p className="px-4 pb-0.5 pt-1.5 text-[13px] font-medium text-m-t3">No risers yet — trends need last season’s stats.</p>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto px-3 pb-0.5 pt-1 scrollbar-none">
            {tiles.map((t) => (
              <div key={t.id} className="flex w-[190px] flex-none flex-col gap-2 rounded-[14px] bg-m-b1 p-2.5" data-trend-tile={t.id}>
                {/* The top area — headshot included — opens the profile. */}
                <button type="button" onClick={() => onOpen(t.id)} className="flex min-w-0 items-center gap-2 text-left">
                  <MHeadshot player={t.player} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[13px] font-semibold text-m-t1">
                      {t.short} <span className={cn('text-[10px]', posTextClass(t.player.position))}>{posLabel(t.player.position)}</span>
                    </span>
                    <span className="truncate text-[10px] font-medium text-m-t3">{t.teamLine}</span>
                  </span>
                </button>
                <div className="flex items-end gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-m-t1">
                      <span className={t.delta.up ? 'text-positive-strong' : 'text-negative-strong'}>{t.delta.text}</span> vs last yr
                    </span>
                    <span className="whitespace-nowrap text-[10px] font-medium tabular-nums text-m-t3">Proj {t.proj}</span>
                  </div>
                  {t.door && <ActionPill door={t.door} />}
                </div>
              </div>
            ))}
          </div>
        ))}
    </section>
  )
}
