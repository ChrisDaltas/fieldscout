'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { SCORING_FAMILY_LABEL } from '@/components/leagues/league-shell-ops'
import { initials, useLeagueCard } from '@/components/mobile/shell/use-league-card'
import { MIcon, type MIconName } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'

interface MenuRow {
  label: string
  sub?: string
  icon: MIconName
  href?: string
}

/**
 * The league Menu sheet (handoff §2.5 F): your team card, the league's pages,
 * then the FieldScout app grid. Rows the design lists but the app has no
 * screen for yet say so (the prototype's own "screen coming next" toast);
 * league pages the app has that the design's menu leaves out (Schedule,
 * Trades, Members, Stats, Commissioner tools) are kept — restyle everything,
 * delete nothing.
 */
export function LeagueMenuSheet({
  open,
  onOpenChange,
  league,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  league: MyLeagueRow
}) {
  const router = useRouter()
  const card = useLeagueCard(league)
  const base = `/app/leagues/${league.id}`
  const isCommish = league.my_role === 'commissioner' || league.my_role === 'co_commissioner'
  const detail = useLeague(open ? league.id : undefined)
  const { family } = useLeagueScoringFamily(open ? league.id : null)
  const rows: MenuRow[] = [
    { label: 'League settings', sub: `${league.team_count} teams`, icon: 'leaders', href: `${base}/settings` },
    { label: 'Scoring', sub: family ? SCORING_FAMILY_LABEL[family] : undefined, icon: 'scoring', href: `${base}/settings?section=scoring` },
    { label: 'Playoffs', sub: playoffWeeks(detail.data?.settings), icon: 'playoffs', href: `${base}/settings?section=league` },
    { label: 'Draft results', icon: 'lists', href: `${base}/draft/recap` },
    { label: 'Schedule', icon: 'sched', href: `${base}/schedule` },
    { label: 'Trades', icon: 'trade', href: `${base}/trades` },
    { label: 'Members', icon: 'coowners', href: `${base}/members` },
    { label: 'League stats', icon: 'leaders', href: `${base}/stats` },
    { label: 'League history', icon: 'history' },
    { label: 'Previous seasons', icon: 'sched' },
    { label: 'Notifications', icon: 'bell' },
    { label: 'Co-owners', sub: 'None', icon: 'coowners' },
    { label: 'Commissioner note', icon: 'news' },
    { label: 'Stat corrections', icon: 'corrections', href: `${base}/activity/corrections` },
    ...(isCommish ? [{ label: 'Commissioner tools', icon: 'gear', href: `${base}/commish` } as MenuRow] : []),
  ]
  const apps: Array<{ label: string; icon: MIconName; href: string }> = [
    { label: 'Home', icon: 'home', href: '/app' },
    { label: 'Community', icon: 'star', href: '/app/explore' },
    { label: 'Stats', icon: 'leaders', href: '/app/stats' },
    { label: 'Profile', icon: 'profile', href: '/app/profile' },
    { label: 'Settings', icon: 'gear', href: '/app/settings' },
  ]
  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Menu">
      {league.my_team_id && (
        <button
          type="button"
          onClick={() => go(`${base}/team/${league.my_team_id}`)}
          className="mx-3 mb-3.5 flex w-[calc(100%-24px)] items-center gap-3 rounded-2xl bg-m-b1 p-3 text-left active:bg-m-b2h"
        >
          <span className="flex size-11 flex-none items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-white">
            {initials(card.teamName).slice(0, 1)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-[15px] font-semibold text-m-t1">{card.teamName}</span>
            <span className="text-[12px] font-medium text-m-t3">My team · edit name and avatar</span>
          </span>
          <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
        </button>
      )}
      <p className="px-5 pb-1.5 text-[12px] font-semibold text-m-t3">{league.name}</p>
      <div className="flex flex-col px-3 pb-3.5">
        {rows.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => (r.href ? go(r.href) : toast({ title: `${r.label}: screen coming next` }))}
            className="flex h-12 items-center gap-3 rounded-xl px-2 text-left active:bg-m-b2"
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b2 text-m-t1">
              <MIcon name={r.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold text-m-t1">{r.label}</span>
            {r.sub ? <span className="whitespace-nowrap text-[12px] font-medium text-m-t3">{r.sub}</span> : null}
            <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
          </button>
        ))}
      </div>
      <p className="px-5 pb-2 text-[12px] font-semibold text-m-t3">FieldScout</p>
      <div className="grid grid-cols-3 gap-2 px-5 pb-2">
        {apps.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            onClick={() => onOpenChange(false)}
            className="flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-m-b1 text-m-t1 active:bg-m-b2h"
          >
            <MIcon name={a.icon} size={22} />
            <span className="text-[12px] font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>
    </MobileSheet>
  )
}

/** "Weeks 15–17" — the playoff run from the league's settings (one round per
 *  halving of the playoff field, each round 1 or 2 weeks); "None" without
 *  playoffs. Undefined until the settings load. */
export function playoffWeeks(settings: Pick<LeagueDetail['settings'], 'playoff_teams' | 'playoff_start_week' | 'playoff_weeks_per_round'> | undefined): string | undefined {
  if (!settings) return undefined
  if (settings.playoff_teams === 0) return 'None'
  const rounds = Math.ceil(Math.log2(settings.playoff_teams))
  const last = settings.playoff_start_week + rounds * settings.playoff_weeks_per_round - 1
  return last === settings.playoff_start_week ? `Week ${last}` : `Weeks ${settings.playoff_start_week}–${last}`
}
