'use client'

import { useRouter } from 'next/navigation'

import { leagueTabHref, type LeagueTab } from '@/components/mobile/shell/mobile-nav'
import { initials, leagueAvClass, useLeagueCard } from '@/components/mobile/shell/use-league-card'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { cn } from '@/lib/utils'

/**
 * "Switch league" sheet (handoff §2.5 B): one row per league — avatar, your
 * team and record, league name · format — the current league filled and
 * checked. Picking one opens the same tab in that league. The only sheet
 * with a close button.
 */
export function LeagueSwitchSheet({
  open,
  onOpenChange,
  current,
  leagues,
  tab,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: MyLeagueRow
  leagues: MyLeagueRow[]
  tab: LeagueTab
}) {
  const router = useRouter()
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Switch league" showClose>
      <div className="flex flex-col gap-0.5 px-3 pb-1.5">
        {leagues.map((l, i) => (
          <SwitchRow
            key={l.id}
            league={l}
            index={i}
            on={l.id === current.id}
            onPick={() => {
              onOpenChange(false)
              if (l.id !== current.id) router.push(leagueTabHref(l.id, tab, l.my_team_id))
            }}
          />
        ))}
        <p className="px-2 pt-2 text-center text-[12px] font-medium text-m-t3">
          Swipe the bar left or right to switch faster
        </p>
      </div>
    </MobileSheet>
  )
}

function SwitchRow({
  league,
  index,
  on,
  onPick,
}: {
  league: MyLeagueRow
  index: number
  on: boolean
  onPick: () => void
}) {
  const card = useLeagueCard(league)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={on ? 'true' : undefined}
      className={cn('flex min-h-[60px] items-center gap-3 rounded-[14px] p-2 text-left active:bg-m-b2', on && 'bg-m-b1')}
    >
      <span
        className={cn(
          'flex size-10 flex-none items-center justify-center rounded-xl text-[13px] font-semibold',
          leagueAvClass(index),
        )}
      >
        {initials(league.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold text-m-t1">
          {card.teamName} <span className="text-[12px] font-medium text-m-t3">{card.record}</span>
        </span>
        <span className="truncate text-[12px] font-medium text-m-t3">
          {league.name} · {card.format}
        </span>
      </span>
      {on && <MIcon name="check" size={18} stroke={2.2} className="text-accent" />}
    </button>
  )
}
