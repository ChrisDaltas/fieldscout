'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { currentWeekOf } from '@/components/leagues/lineup-editor-ops'
import { JoinLeagueDialog } from '@/components/leagues/leagues-index'
import { LeagueCreateModal } from '@/components/leagues/league-create-modal'
import { useLeagueTabStore } from '@/components/mobile/league/league/league-tab-store'
import { leagueTabHref } from '@/components/mobile/shell/mobile-nav'
import { initials, leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useLeagues, type MyLeagueRow } from '@/hooks/use-leagues'
import { useMobileHomeAlert } from '@/hooks/use-mobile-home-alerts'
import { useMobileHomeMatchup } from '@/hooks/use-mobile-home-matchup'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { useSchedule } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import { seasonInPlay } from './home-ops'
import { HomeNote, HomeSectionTitle } from './home-section'

/**
 * "Matchups" (m-home §2A.4–6): one card per league the user is in, in the
 * app's one league order (the switcher's); then "Join or create a league".
 * A card opens what its league is doing (Q8): the Match tab in season, the
 * draft room while the draft is live, the League tab's draft home before
 * it. The week beside the title is the current week of the user's first
 * league with a season in play (shown only when one exists — a list of
 * pre-draft leagues has no week to name). A card in season carries the red
 * alert dot when something in its league needs the user — a trade offer
 * waiting on their answer, or a starter out / on IR / on bye or an empty
 * starting slot this week (ruling #14, `useMobileHomeAlert`).
 */
export function HomeMatchups() {
  const leagues = useLeagues()
  const list = leagues.data ?? []
  return (
    <section>
      <HomeSectionTitle title="Matchups" className="mt-6" right={<WeekLabel leagues={list} />} />
      {leagues.isPending ? (
        <div className="mt-[10px] flex flex-col gap-[10px]" aria-busy="true" aria-label="Loading your leagues">
          <span className="block h-[141px] rounded-[18px] bg-m-b1" />
          <span className="block h-16 rounded-[18px] bg-m-b1" />
        </div>
      ) : leagues.isError ? (
        <HomeNote tone="error" action={{ label: 'Try again', onClick: () => void leagues.refetch() }}>
          Couldn’t load your leagues.
        </HomeNote>
      ) : list.length === 0 ? (
        <HomeNote>You’re not in a league yet.</HomeNote>
      ) : (
        <div className="mt-[10px] flex flex-col gap-[10px]">
          {list.map((league, index) => (
            <LeagueCard key={league.id} league={league} index={index} />
          ))}
        </div>
      )}
      <JoinOrCreate />
    </section>
  )
}

function WeekLabel({ leagues }: { leagues: readonly MyLeagueRow[] }) {
  const first = leagues.find((l) => seasonInPlay(l.status))
  const schedule = useSchedule(first?.id)
  const week = useMemo(() => (schedule.data ? currentWeekOf(schedule.data.weeks) : null), [schedule.data])
  if (week === null) return null
  return <span className="text-[12px] font-medium leading-[15px] text-m-t3">Week {week}</span>
}

function LeagueCard({ league, index }: { league: MyLeagueRow; index: number }) {
  const card = useMobileHomeMatchup(league)
  const alert = useMobileHomeAlert(league)
  const roomEntry = useRoomEntryTarget()
  const setSegment = useLeagueTabStore((s) => s.setSegment)
  const live = card.live
  const cls = 'flex flex-col gap-3 rounded-[18px] bg-m-b1 p-[14px] active:bg-m-b2h'
  const body = (
    <>
      <span className="flex items-center gap-[10px]">
        {/* The tile's letters come with its fill (`leagueAvClass`): white,
            except dark on the gold tile — the same everywhere (ruling #38;
            the prototype's Home drew white on gold). */}
        <span
          className={cn('flex size-9 flex-none items-center justify-center rounded-[10px] text-[13px] font-semibold leading-[16px]', leagueAvClass(index))}
          aria-hidden
        >
          {initials(league.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold leading-[19px] text-m-t1">{league.name}</span>
          <span className="text-[12px] font-medium leading-[15px] text-m-t3">{card.sub}</span>
        </span>
        {card.phase === 'pre-draft' && (
          <span className="flex h-6 flex-none items-center whitespace-nowrap rounded-pill bg-m-go px-[10px] text-[11px] font-semibold text-m-to">
            Pre-draft
          </span>
        )}
        {/* Not in the design (its leagues are never mid-draft): the Pre-draft
            pill's shape in the green tint, with the League tab's live dot. */}
        {card.phase === 'draft-live' && (
          <span className="flex h-6 flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-gg px-[10px] text-[11px] font-semibold text-m-tg">
            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />
            Draft live
          </span>
        )}
        {/* The alert dot (m-home §2A.5 `hasDot`: 8×8, Danger red — the
            notification badge's fixed red, the same in both themes): on
            when something in this league needs you (ruling #14). */}
        {alert.label && (
          <span className="flex-none" data-league-alert>
            <span className="block size-2 rounded-full bg-negative-strong" aria-hidden />
            <span className="sr-only">{alert.label}</span>
          </span>
        )}
      </span>
      {!live && card.loading && (
        <span className="flex flex-col gap-1.5" aria-hidden>
          <span className="h-[15px] rounded-md bg-m-b2" />
          <span className="h-6 rounded-md bg-m-b2" />
          <span className="h-[14px] rounded-md bg-m-b2" />
        </span>
      )}
      {!live && card.error && (
        <span className="text-[12px] font-medium leading-[15px] text-m-t3" role="alert">
          Couldn’t load this week’s matchup.
        </span>
      )}
      {live && (
        <span className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2 whitespace-nowrap text-[12px] font-medium leading-[15px] text-m-t3">
            <span className="min-w-0 truncate">{live.me.label}</span>
            <span className="min-w-0 truncate">{live.opp ? live.opp.label : 'Bye'}</span>
          </span>
          <span className="flex items-center gap-[10px]">
            <span className="text-[20px] font-semibold leading-[24px] tracking-[-0.02em] text-m-t1 tabular-nums">{live.me.points}</span>
            {/* The design's win-probability bar sits here; the app has no model for it. */}
            <span className="flex-1" />
            {live.opp && (
              <span className="text-[20px] font-semibold leading-[24px] tracking-[-0.02em] text-m-t1 tabular-nums">{live.opp.points}</span>
            )}
          </span>
          {(live.me.proj || live.opp?.proj) && (
            <span className="flex justify-between gap-2 whitespace-nowrap text-[11px] font-medium leading-[14px] text-m-t3 tabular-nums">
              <span>{live.me.proj}</span>
              <span>{live.opp?.proj}</span>
            </span>
          )}
        </span>
      )}
    </>
  )
  if (card.phase === 'draft-live') {
    // Home is where you join a live draft (CLAUDE.md New IA): straight into
    // the room, split like every other entry (new tab on a measured desktop).
    return (
      <Link href={`/app/leagues/${league.id}/draft`} {...roomEntry} className={cls} data-league-card={league.id}>
        {body}
      </Link>
    )
  }
  if (card.phase === 'pre-draft') {
    // The League tab's Matchups segment is the league's draft home before
    // the draft; open it there even if another segment was last open.
    return (
      <Link
        href={leagueTabHref(league.id, 'league', league.my_team_id)}
        onClick={() => setSegment(league.id, 'matchups')}
        className={cls}
        data-league-card={league.id}
      >
        {body}
      </Link>
    )
  }
  return (
    <Link href={leagueTabHref(league.id, 'match', league.my_team_id)} className={cls} data-league-card={league.id}>
      {body}
    </Link>
  )
}

/**
 * "Join or create a league" (m-home §2A.6): one outlined button that asks
 * which, then opens the app's own join-by-code and create-league flows.
 */
function JoinOrCreate() {
  const [chooser, setChooser] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const pick = (which: 'join' | 'create') => {
    setChooser(false)
    if (which === 'join') setJoinOpen(true)
    else setCreateOpen(true)
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setChooser(true)}
        className="mt-[10px] flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-m-b3s text-[14px] font-semibold leading-[17px] text-m-t1"
      >
        <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
          <path d="M8 3v10M3 8h10" />
        </svg>
        Join or create a league
      </button>
      <MobileSheet open={chooser} onOpenChange={setChooser} title="Join or create a league" bodyClassName="px-4 pb-6">
        <div className="flex flex-col gap-2">
          <ChooserRow title="Join a league" sub="Use the invite code or link your commissioner shared" onClick={() => pick('join')} />
          <ChooserRow title="Create a league" sub="Set it up and invite your friends — it’s free" onClick={() => pick('create')} />
        </div>
      </MobileSheet>
      <JoinLeagueDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <LeagueCreateModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

function ChooserRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-[14px] bg-m-b1 p-[14px] text-left active:bg-m-b2h">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold leading-[19px] text-m-t1">{title}</span>
        <span className="text-[12px] font-medium leading-[15px] text-m-t3">{sub}</span>
      </span>
      <MIcon name="chevronRight" size={14} stroke={2} className="text-m-t4" />
    </button>
  )
}
