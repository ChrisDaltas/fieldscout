'use client'

import { useRouter } from 'next/navigation'

import { MessagesAvatar } from '@/components/mobile/messages/messages-avatar'
import { leagueTabHref, type LeagueTab } from '@/components/mobile/shell/mobile-nav'
import { initials, leagueAvClass, useLeagueCard } from '@/components/mobile/shell/use-league-card'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * "Switch league" sheet (handoff §2.5 B): one row per league — the league's
 * photo or tile, your team and record (or its draft, `useLeagueCard`),
 * league name · size and scoring ("12-team PPR") — the current league
 * filled and checked. Picking another opens the same tab in that league and
 * says "Switched to {your team}". The only sheet with a close button.
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
            onPick={(teamName) => {
              onOpenChange(false)
              if (l.id === current.id) return
              toast({ title: `Switched to ${teamName}` })
              router.push(leagueTabHref(l.id, tab, l.my_team_id))
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
  /** Called with the name the row shows — your team there, else the league. */
  onPick: (teamName: string) => void
}) {
  const card = useLeagueCard(league)
  return (
    <button
      type="button"
      onClick={() => onPick(card.teamName)}
      aria-current={on ? 'true' : undefined}
      className={cn('flex min-h-[60px] items-center gap-3 rounded-[14px] p-2 text-left active:bg-m-b2', on && 'bg-m-b1')}
      data-switch-league={league.id}
    >
      <MessagesAvatar
        text={initials(league.name)}
        src={league.avatar_url}
        sizeClass="size-10"
        radiusClass="rounded-xl"
        colorClass={leagueAvClass(index)}
        fgClass="text-inherit"
        textClass="text-[13px]"
      />
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
