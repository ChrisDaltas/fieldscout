'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { teamPageHref } from '@/components/leagues/league-cells'
import { commishMatchupHref } from '@/components/leagues/activity-page-ops'
import { currentWeekOf } from '@/components/leagues/lineup-editor-ops'
import { NO_LADDER_COPY } from '@/components/leagues/league-home-season-ops'
import { OVERRIDDEN_LABEL, OVERRIDDEN_TITLE } from '@/components/leagues/matchup-view-ops'
import { reasonHint, scheduleConsoleHref, scheduleGrid } from '@/components/leagues/schedule-view-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { CenteredNote, LeaguePageBar, PageChip, SkeletonBlocks, StatusLine, useChipRowInView } from '@/components/mobile/league/league/league-bits'
import { historyTeams } from '@/components/mobile/league/league/league-history-ops'
import { SECOND_OPPONENTS_TITLE } from '@/components/mobile/league/league/league-tab-ops'
import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { teamOrder } from '@/components/mobile/league/team/team-ops'
import { WeekStatus } from '@/components/mobile/league/week-stepper'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useScheduleLive } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import {
  ALL_TEAMS_LABEL,
  SCHEDULE_DOOR_NOTE,
  SCHEDULE_DOOR_TITLE,
  SCHEDULE_TITLE,
  TOTAL_POINTS_SCHEDULE_COPY,
  jumpWeek,
  phoneWeeks,
  rowLabel,
  scheduleSearch,
  scheduleTeamFromParam,
  seasonLine,
  type PhoneRow,
  type PhoneSide,
  type PhoneWeek,
} from './schedule-ops'

/**
 * League Menu › Schedule on the phone (gap list §4 item 107) — the phone's
 * screen for `/schedule`, on the same reads as desktop's `ScheduleView`
 * (`useLeague` gates membership first, then `useScheduleLive` — the week
 * ladder and every stored pairing, refetched over the league's one realtime
 * room), which is unchanged. The handoff draws no Schedule page (its Team
 * tile only toasts), so it extends the G pages and League › Matchups: the
 * 52px bar, the G3 chips and the b1 cards.
 *
 * - **Team chips** under the bar ("All teams", then yours first in blue,
 *   then the rest): a team's chip keeps only that team's games, the team on
 *   top — its season at a glance, the way ESPN and Yahoo show a team's
 *   schedule. The chip rides `?team=` (no navigation); the Team tab's
 *   Schedule tile opens on your team.
 * - **A card per week**: "Week N", Playoffs / Current tags and the week's
 *   Live / Final / Upcoming word, the stored league median when there is
 *   one, then its games — two lines each, your team (or the picked one) on
 *   top, the stored scores with the loser's greyed; your own game tinted.
 *   A game opens on the Match tab; a second-opponent game sits in its own
 *   group and each side opens that team (the Match tab swipes the week's
 *   matchups only — League › Matchups' rule). Consolation and third-place
 *   games say so; a commissioner-adjusted game's "✸ Adjusted" opens its
 *   entry in the commissioner log.
 * - **Opens at the current week** once the season is past its first week.
 * - A commissioner gets one door to the console's Schedule section (the
 *   edit and the remix live there — F580 / D493), with the desktop's hint
 *   once Week 1 has started — once there is a schedule to change.
 * - States: a skeleton while it reads, "Couldn’t load…" with Try again, the
 *   no-schedule copy before the draft. The reconnecting and not-refreshing
 *   lines sit in the sticky header under the chips, not in the list — the
 *   page opens scrolled to the current week, so a line at the top of the
 *   list would be off screen while the scores it warns about are on it.
 *
 * No clock: the current week is the ladder's (`currentWeekOf`). Back goes
 * to where you came from (the Menu's or Team tab's screen), else the League
 * tab. Cards rest flat (no shadow).
 */
export function MobileSchedule({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) {
    return (
      <MobileScreen header={<LeaguePageBar leagueId={leagueId} title={SCHEDULE_TITLE} />}>
        <div className="px-4 pt-3" data-schedule-loading>
          <SkeletonBlocks count={3} className="h-[180px]" />
        </div>
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen header={<LeaguePageBar leagueId={leagueId} title={SCHEDULE_TITLE} />}>
        <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void league.refetch()} />
      </MobileScreen>
    )
  }
  return <ScheduleScreen leagueId={leagueId} detail={league.data} />
}

function ScheduleScreen({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const schedule = useScheduleLive(leagueId)
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const totalPoints = detail.settings.schedule_mode === 'total_points'
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const grid = useMemo(
    () =>
      schedule.data
        ? scheduleGrid(
            schedule.data,
            teamNames,
            { regular_season_weeks: detail.settings.regular_season_weeks, schedule_mode: detail.settings.schedule_mode },
            false,
          )
        : [],
    [schedule.data, teamNames, detail.settings.regular_season_weeks, detail.settings.schedule_mode],
  )
  const currentWeek = useMemo(() => currentWeekOf(schedule.data?.weeks ?? []), [schedule.data])

  // The team filter: chips for every team still in the league, yours first.
  const chips = useMemo(() => historyTeams(detail.teams, myTeamId), [detail.teams, myTeamId])
  const chipIds = useMemo(() => chips.map((t) => t.id), [chips])
  const searchParams = useSearchParams()
  const [picked, setPicked] = useState(() => scheduleTeamFromParam(searchParams?.get('team'), chipIds))
  const teamId = picked && chipIds.includes(picked) ? picked : null
  // The address follows the chip without a navigation (instant), so a
  // reload or coming Back reopens the same filter.
  const choose = (next: string | null) => {
    setPicked(next)
    const search = scheduleSearch(window.location.search, next)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}`)
  }

  const weeks = useMemo(
    () => phoneWeeks(grid, { teamId, myTeamId, currentWeek, totalPoints }),
    [grid, teamId, myTeamId, currentWeek, totalPoints],
  )
  const showChips = !totalPoints && grid.length > 0 && chips.length > 1
  const chipRow = useChipRowInView<HTMLDivElement>(showChips)

  // Open at the current week (and come back to it when the filter changes —
  // the cards above it change height). Before the season's second week the
  // top of the page is the start of the season.
  const target = jumpWeek(weeks, currentWeek)
  const listRef = useRef<HTMLDivElement | null>(null)
  const jumpedFor = useRef<string | undefined>(undefined)
  const ready = weeks.length > 0
  useEffect(() => {
    if (!ready) return
    const key = teamId ?? ''
    if (jumpedFor.current === key) return
    const firstOpen = jumpedFor.current === undefined
    jumpedFor.current = key
    const card = target === null ? null : listRef.current?.querySelector<HTMLElement>(`[data-week="${target}"]`)
    if (card) scrollMain(card, cardOffset(card))
    else if (!firstOpen && listRef.current) scrollMain(listRef.current, 'top')
  }, [ready, target, teamId])

  const hint = isCommish ? reasonHint(schedule.data?.weeks ?? []) : null
  const reconnecting = schedule.connection === 'reconnecting'
  const stale = schedule.isError && !!schedule.data
  const header = (
    <>
      <LeaguePageBar leagueId={leagueId} title={SCHEDULE_TITLE} />
      {showChips && (
        <div ref={chipRow} className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 pt-1 scrollbar-none" role="group" aria-label="Teams" data-schedule-teams>
          <PageChip on={teamId === null} onClick={() => choose(null)}>
            {ALL_TEAMS_LABEL}
          </PageChip>
          {chips.map((t) => (
            <PageChip key={t.id} on={t.id === teamId} mine={t.id === myTeamId} onClick={() => choose(t.id)} className="max-w-[180px]">
              <span className="truncate">{t.name}</span>
            </PageChip>
          ))}
        </div>
      )}
      {/* In the sticky header, so they stay in view at any scroll — the page
          opens at the current week, far below the top of the list. */}
      {(reconnecting || stale) && (
        <div className={cn('flex flex-col gap-1.5 px-4 pb-2.5', !showChips && 'pt-1')} data-schedule-status>
          {reconnecting && <StatusLine>Reconnecting — syncing this league…</StatusLine>}
          {stale && <StatusLine>{STALE_LEAGUE_COPY}</StatusLine>}
        </div>
      )}
    </>
  )

  // No scroll anchoring on the list: a status line appearing in the sticky
  // header should push the cards down with it, not slide the header over
  // the current week's title (the browser holding the card in place).
  return (
    <MobileScreen header={header}>
      <div ref={listRef} className="flex flex-col gap-2.5 px-4 pb-8 pt-3 [overflow-anchor:none]" data-schedule-screen>
        {/* Only once there is a schedule to change — before the draft the
            console has nothing to edit or remix. */}
        {isCommish && weeks.length > 0 && (
          <Link
            href={scheduleConsoleHref(leagueId)}
            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-m-b1 px-3.5 py-2.5 active:bg-m-b2"
            data-schedule-commish
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-medium text-m-t1">{SCHEDULE_DOOR_TITLE}</span>
              <span className="text-[12px] font-medium leading-[1.35] text-m-t3">{hint ?? SCHEDULE_DOOR_NOTE}</span>
            </span>
            <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
          </Link>
        )}

        {schedule.isPending ? (
          <SkeletonBlocks count={3} className="h-[180px]" />
        ) : !schedule.data ? (
          <CenteredNote role="alert" message="Couldn’t load the schedule." action="Try again" onAction={() => void schedule.refetch()} />
        ) : weeks.length === 0 ? (
          <CenteredNote role="status" message={NO_LADDER_COPY} className="py-14" />
        ) : (
          <>
            <p className="px-1 text-[12px] font-medium tabular-nums text-m-t3" data-schedule-season>
              {seasonLine(weeks.length, detail.settings.regular_season_weeks, totalPoints)}
            </p>
            {totalPoints && (
              <p className="px-1 text-[13px] font-medium leading-[1.4] text-m-t3" data-schedule-total-points>
                {TOTAL_POINTS_SCHEDULE_COPY}
              </p>
            )}
            {weeks.map((w) => (
              <WeekCard key={w.week} leagueId={leagueId} week={w} teamIds={order} myTeamId={myTeamId} />
            ))}
          </>
        )}
      </div>
    </MobileScreen>
  )
}

/** How far to scroll so the card sits just under the sticky bar and chips. */
function cardOffset(card: HTMLElement): number {
  const header = card.closest('[data-mobile-screen]')?.firstElementChild
  return card.getBoundingClientRect().top - (header?.getBoundingClientRect().bottom ?? 0) - 10
}

/** Scroll the phone shell's `<main>` — it scrolls, not the window (the
 *  League settings editor's `scrollToTop` reading) — by `by` px, or back to
 *  the top. */
function scrollMain(from: Element, by: number | 'top') {
  const scroller: Pick<Window, 'scrollBy' | 'scrollTo'> = from.closest('main') ?? window
  if (by === 'top') scroller.scrollTo({ top: 0 })
  else scroller.scrollBy({ top: by })
}

function WeekCard({
  leagueId,
  week,
  teamIds,
  myTeamId,
}: {
  leagueId: string
  week: PhoneWeek
  teamIds: readonly string[]
  myTeamId: string | null
}) {
  return (
    <section
      aria-label={`Week ${week.week}`}
      className="overflow-hidden rounded-[16px] bg-m-b1"
      data-week={week.week}
      data-week-kind={week.kind}
      data-current={week.isCurrent || undefined}
    >
      <div className="flex flex-col gap-0.5 px-3.5 py-2.5">
        <div className="flex min-h-6 items-center gap-1.5">
          <h2 className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-m-t1">Week {week.week}</h2>
          {week.kind === 'playoff' && <Tag className="bg-m-gp text-m-pos-wr">Playoffs</Tag>}
          {week.isCurrent && <Tag className="bg-m-gg text-m-tg">Current</Tag>}
          <span className="min-w-2 flex-1" />
          <WeekStatus status={week.status} />
        </div>
        {week.median !== null && (
          <span className="text-[12px] font-medium text-m-t3" data-week-median>
            League median <span className="font-semibold tabular-nums text-m-t1">{week.median.toFixed(2)}</span>
          </span>
        )}
      </div>
      {week.note && (
        <p className="border-t border-m-b3 px-3.5 py-3 text-[13px] font-medium leading-[1.4] text-m-t3" data-week-note>
          {week.note}
        </p>
      )}
      {week.primary.length > 0 && (
        <ul className="flex flex-col divide-y divide-m-b3 border-t border-m-b3" aria-label={`Week ${week.week} games`}>
          {week.primary.map((row) => (
            <GameRow key={row.id} leagueId={leagueId} week={week.week} row={row} teamIds={teamIds} myTeamId={myTeamId} door="matchup" />
          ))}
        </ul>
      )}
      {week.secondary.length > 0 && (
        <div className="border-t border-m-b3" data-second-opponents>
          <p className="px-3.5 pb-0.5 pt-2.5 text-[12px] font-semibold text-m-t3">{SECOND_OPPONENTS_TITLE}</p>
          <ul className="flex flex-col divide-y divide-m-b3" aria-label={`Week ${week.week} ${SECOND_OPPONENTS_TITLE.toLowerCase()}`}>
            {week.secondary.map((row) => (
              <GameRow key={row.id} leagueId={leagueId} week={week.week} row={row} teamIds={teamIds} myTeamId={myTeamId} door="teams" />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Tag({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn('flex h-5 flex-none items-center whitespace-nowrap rounded-pill px-2 text-[11px] font-semibold', className)}>{children}</span>
}

/**
 * One game: two lines, the anchor team on top. `door` says where a tap goes
 * — a matchup opens on the Match tab (the whole row; its ✸ tag sits above
 * that door and opens the commissioner log); a second-opponent game is not
 * one of the Match tab's matchups, so each side opens that team instead.
 */
function GameRow({
  leagueId,
  week,
  row,
  teamIds,
  myTeamId,
  door,
}: {
  leagueId: string
  week: number
  row: PhoneRow
  teamIds: readonly string[]
  myTeamId: string | null
  door: 'matchup' | 'teams'
}) {
  const teamDoor = (id: string) => (door === 'teams' ? teamPageHref(leagueId, id) : undefined)
  const tags = row.tag !== null || row.tie || row.overridden
  return (
    <li
      className={cn('relative flex flex-col gap-0.5 px-3.5 py-2', row.mine && 'bg-m-gb')}
      data-matchup={row.id}
      data-mine={row.mine || undefined}
      data-round-type={row.roundType}
    >
      {door === 'matchup' && (
        <Link
          href={`/app/leagues/${leagueId}/matchup/${row.id}`}
          aria-label={rowLabel(week, row)}
          className="absolute inset-0 active:bg-m-t1/5"
          data-matchup-door
        />
      )}
      <SideLine side={row.top} teamIds={teamIds} myTeamId={myTeamId} href={teamDoor(row.top.id)} />
      {row.bottom ? (
        <SideLine side={row.bottom} teamIds={teamIds} myTeamId={myTeamId} href={teamDoor(row.bottom.id)} />
      ) : (
        <span className="flex h-7 items-center pl-8 text-[13px] font-semibold text-m-t3" data-bye>
          Bye
        </span>
      )}
      {tags && (
        <span className="flex flex-wrap items-center gap-1.5 pb-0.5 pl-8 pt-0.5">
          {row.tag && <Tag className="bg-m-b2 text-m-t1">{row.tag}</Tag>}
          {row.tie && <Tag className="bg-m-b2 text-m-t1">Tie</Tag>}
          {row.overridden && (
            <Link
              href={commishMatchupHref(leagueId, week, row.homeTeamId)}
              title={OVERRIDDEN_TITLE}
              className="relative z-[1] flex h-5 items-center rounded-pill bg-m-gp px-2 text-[11px] font-semibold text-m-t1"
              data-overridden
            >
              {OVERRIDDEN_LABEL}
            </Link>
          )}
        </span>
      )}
    </li>
  )
}

function SideLine({
  side,
  teamIds,
  myTeamId,
  href,
}: {
  side: PhoneSide
  teamIds: readonly string[]
  myTeamId: string | null
  /** The side's own door (a second-opponent game's team page). */
  href?: string
}) {
  const body = (
    <>
      <TeamAvatar teamId={side.id} name={side.name} teamIds={teamIds} myTeamId={myTeamId} size={24} fontSize={10} />
      <span className={cn('min-w-0 flex-1 truncate text-[14px] text-m-t1', side.lost ? 'font-medium' : 'font-semibold')}>{side.name}</span>
      <span
        className={cn(
          'flex-none tabular-nums',
          side.pending ? 'text-[12px] font-semibold text-m-t3' : side.notStarted ? 'text-[14px] font-semibold text-m-t4' : side.lost ? 'text-[14px] font-semibold text-m-t3' : 'text-[14px] font-semibold text-m-t1',
        )}
        title={side.scoreTitle ?? undefined}
        data-score
      >
        {side.score}
      </span>
    </>
  )
  const className = 'flex h-7 items-center gap-2'
  return href ? (
    <Link href={href} className={cn(className, 'active:opacity-70')} data-team-door>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
