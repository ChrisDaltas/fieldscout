'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { teamPageHref } from '@/components/leagues/league-cells'
import { NO_LADDER_COPY, heroWeek, scoringLive } from '@/components/leagues/league-home-season-ops'
import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import {
  LEADERBOARD_TITLE,
  OVERRIDDEN_TITLE,
  emptyWeekCopy,
  formatPoints,
  leaderboardRows,
  scoreCell,
  splitRows,
  teamName,
} from '@/components/leagues/matchup-view-ops'
import { formatRecord } from '@/components/leagues/standings-table-ops'
import { LIVE_STATS_DELAYED_COPY, STALE_SCORES_COPY } from '@/components/leagues/status-banners'
import { WeekStatus, WeekStepper } from '@/components/mobile/league/week-stepper'
import type { LeagueDetail } from '@/hooks/use-league'
import { useTeamOnline } from '@/hooks/use-online'
import { useLineup } from '@/hooks/use-lineup'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useSchedule, type ScheduleWeek } from '@/hooks/use-schedule'
import { useStandingsLive } from '@/hooks/use-standings'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'

import { ChampionCard, DraftDoorsCard, MessageBoardCard, YourTeamCard } from './kept-cards'
import { CenteredNote, SkeletonBlocks, StatusLine, TeamAvatar } from './league-bits'
import { matchupsWeek, teamAvatarClass, weekToKeep } from './league-tab-ops'
import { useKeptWeek } from './league-tab-store'
import { MobileBracket } from './mobile-bracket'
import { PreseasonContent } from './preseason'

/**
 * League › Matchups (handoff m-league §2.2): a week picker the design does
 * not draw (gap list §4 item 9 — the week's Live / Final label and
 * "‹ Week N ›", the current week by default), the league median card (only
 * when the league plays the median game), then every matchup of that
 * week — yours first — as a b1 card: avatar and live score per side, the
 * team name and record, "vs" between. Tapping a card opens that matchup on
 * the Match tab. There is no win-probability source, so the win bar and %
 * are left out rather than invented. Once the playoffs start the bracket
 * sits at the top. Below: the league-home cards the design does not draw
 * (Your team, Message board, Draft), kept in the mobile language. Before
 * the draft this segment is the league's draft home.
 */
export function MatchupsSegment({
  leagueId,
  detail,
  myTeamId,
  viewerId,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  viewerId: string | null
}) {
  const status = detail.league.status
  if (status !== 'in_season' && status !== 'playoffs' && status !== 'complete') {
    return <PreseasonContent leagueId={leagueId} detail={detail} />
  }
  return <SeasonMatchups leagueId={leagueId} detail={detail} myTeamId={myTeamId} viewerId={viewerId} state={status} />
}

function SeasonMatchups({
  leagueId,
  detail,
  myTeamId,
  viewerId,
  state,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  viewerId: string | null
  state: 'in_season' | 'playoffs' | 'complete'
}) {
  const inPlay = state !== 'complete'
  const schedule = useSchedule(leagueId)
  // The ladder's current week (the Your team card's), and the week the
  // cards show: the one the picker was stepped to, kept per league.
  const currentWeek = useMemo(() => heroWeek(schedule.data?.weeks), [schedule.data])
  const [kept, keepWeek] = useKeptWeek(leagueId)
  const week = useMemo(() => matchupsWeek(kept, schedule.data?.weeks), [kept, schedule.data])
  const pickWeek = (next: number) => keepWeek(weekToKeep(next, schedule.data?.weeks ?? []))
  const matchups = useMatchupsLive(leagueId, week ?? undefined)
  const standings = useStandingsLive(leagueId)
  const lineup = useLineup(myTeamId ?? undefined, inPlay && currentWeek !== null ? currentWeek : undefined)
  const degraded = useStatsDegraded({ enabled: inPlay && scoringLive(matchups.data?.league_week.status) })
  const delay = liveScoringDelay(degraded.data)
  const bracket = usePlayoffBracketLive(leagueId, state === 'playoffs')
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const records = useMemo(
    () => new Map((standings.data?.standings ?? []).map((r) => [r.team_id, formatRecord(r)])),
    [standings.data],
  )
  const tz = detail.settings.draft.time_zone ?? null
  const reconnecting =
    matchups.connection === 'reconnecting' || standings.connection === 'reconnecting' || bracket.connection === 'reconnecting'
  const av = (id: string | null) => teamAvatarClass(id, teamIds, myTeamId)
  // Who's online (gap list §3 #25): a team's avatar lights up with its manager.
  const online = useTeamOnline(detail.members)

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-5 pt-2.5" data-matchups-segment>
      {reconnecting && <StatusLine>Reconnecting — syncing this league…</StatusLine>}
      {matchups.isError && matchups.data && <StatusLine>{STALE_SCORES_COPY}</StatusLine>}
      {inPlay && delay.delayed && (
        <StatusLine tone="caution">
          {LIVE_STATS_DELAYED_COPY}
          {delay.since && ` Last update ${formatInstantWithDate(delay.since, tz).local}.`}
        </StatusLine>
      )}

      {state === 'complete' && <ChampionCard detail={detail} />}

      {state === 'playoffs' && (
        <section className="flex flex-col gap-2 pb-2" aria-label="Playoffs">
          <h2 className="px-1 text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Playoffs</h2>
          <MobileBracket
            doc={bracket.data}
            pending={bracket.isPending}
            problem={bracket.isError}
            onRetry={() => void bracket.refetch()}
            teamNames={teamNames}
            teamIds={teamIds}
            myTeamId={myTeamId}
          />
        </section>
      )}

      {week !== null && schedule.data && (
        <WeekPicker
          week={week}
          weeks={schedule.data.weeks}
          status={matchups.data?.week === week ? matchups.data.league_week.status : weekStatusOf(schedule.data.weeks, week)}
          onWeek={pickWeek}
        />
      )}

      {schedule.isPending || (week !== null && matchups.isPending) ? (
        <SkeletonBlocks count={3} className="h-[90px]" />
      ) : schedule.isError ? (
        <CenteredNote role="alert" message="Couldn’t load the schedule." action="Try again" onAction={() => void schedule.refetch()} />
      ) : week === null ? (
        <CenteredNote message={NO_LADDER_COPY} />
      ) : !matchups.data ? (
        <CenteredNote role="alert" message="Couldn’t load this week." action="Try again" onAction={() => void matchups.refetch()} />
      ) : (
        <WeekCards
          leagueId={leagueId}
          doc={matchups.data}
          weeks={schedule.data.weeks}
          regularSeasonWeeks={detail.settings.regular_season_weeks}
          medianGame={detail.settings.median_game}
          myTeamId={myTeamId}
          records={records}
          av={av}
          online={online}
        />
      )}

      <div className="mt-3 flex flex-col gap-4">
        {inPlay && (
          <YourTeamCard
            leagueId={leagueId}
            detail={detail}
            myTeamId={myTeamId}
            week={currentWeek}
            lineup={currentWeek === null ? null : lineup.isPending ? undefined : lineup.data}
          />
        )}
        <MessageBoardCard leagueId={leagueId} detail={detail} viewerId={viewerId} />
        <DraftDoorsCard leagueId={leagueId} complete={state === 'complete'} />
      </div>
    </div>
  )
}

/** The week picker over the cards (gap list §4 item 9 — the design draws
 *  none): the week's Live / Final label on the left, "‹ Week N ›" on the
 *  right — the Match tab's own pieces. Stepping swaps the cards in place
 *  (no navigation); the picker stays while the new week loads. */
function WeekPicker({
  week,
  weeks,
  status,
  onWeek,
}: {
  week: number
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  status: string | null
  onWeek: (week: number) => void
}) {
  return (
    <div className="-my-1 flex items-center justify-between gap-2 pl-1" data-week-strip>
      <div className="flex min-w-0 items-center">{status && <WeekStatus status={status} />}</div>
      <WeekStepper week={week} weeks={weeks} onWeek={onWeek} />
    </div>
  )
}

/** The ladder's stored status for a week (the picker's label while the
 *  week's own read is still loading). */
function weekStatusOf(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[], week: number): string | null {
  return weeks.find((w) => w.week === week)?.status ?? null
}

type Av = (id: string | null) => string
/** Is this team's manager online (`useTeamOnline`)? */
type Online = (id: string | null) => boolean

function WeekCards({
  leagueId,
  doc,
  weeks,
  regularSeasonWeeks,
  medianGame,
  myTeamId,
  records,
  av,
  online,
}: {
  leagueId: string
  doc: WeekMatchups
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  regularSeasonWeeks: number
  medianGame: boolean
  myTeamId: string | null
  records: ReadonlyMap<string, string>
  av: Av
  online: Online
}) {
  if (doc.schedule_mode === 'total_points') return <Leaderboard leagueId={leagueId} doc={doc} av={av} online={online} />
  const { primary } = splitRows(doc.matchups)
  // The empty copy reads the week SHOWN, not the league's state: a playoff
  // week stepped to in the regular season says its pairings come later
  // (the Match tab's and the desktop matchup page's own helper).
  if (primary.length === 0) return <CenteredNote message={emptyWeekCopy(doc.week, weeks, regularSeasonWeeks)} />
  const mine = (r: MatchupRow) => myTeamId !== null && (r.home_team_id === myTeamId || r.away_team_id === myTeamId)
  const rows = [...primary].sort((a, b) => Number(mine(b)) - Number(mine(a)))
  const regular = primary.every((r) => r.round_type !== 'playoff')
  return (
    <>
      {medianGame && regular && <MedianCard median={doc.league_week.median_score} />}
      {rows.map((row) => (
        <MatchupCard key={row.id} leagueId={leagueId} doc={doc} row={row} records={records} av={av} online={online} myTeamId={myTeamId} />
      ))}
    </>
  )
}

/** The league-median card: the stored median once every score of the week
 *  is in (there is no live or projected median), on the design's cream. */
function MedianCard({ median }: { median: number | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[16px] bg-m-median p-3" data-median-card>
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-warn text-[13px] font-semibold text-white">
        M
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">
          {median !== null ? (
            <>
              League median <span className="tabular-nums">{formatPoints(median)}</span>
            </>
          ) : (
            <>
              League median <span className="font-medium text-fs-text-3">· when every score is in</span>
            </>
          )}
        </span>
        <span className="text-[11.5px] font-medium leading-[1.35] text-fs-text-3">Beat the median to win an extra matchup this week.</span>
      </div>
    </div>
  )
}

function MatchupCard({
  leagueId,
  doc,
  row,
  records,
  av,
  online,
  myTeamId,
}: {
  leagueId: string
  doc: WeekMatchups
  row: MatchupRow
  records: ReadonlyMap<string, string>
  av: Av
  online: Online
  myTeamId: string | null
}) {
  // Your own matchup puts you on the left (the design's team A), home or away.
  const flip = myTeamId !== null && row.away_team_id === myTeamId
  const left = flip ? { id: row.away_team_id!, score: row.away_score } : { id: row.home_team_id, score: row.home_score }
  const right = flip ? { id: row.home_team_id, score: row.home_score } : row.away_team_id ? { id: row.away_team_id, score: row.away_score } : null
  return (
    <Link
      href={`/app/leagues/${leagueId}/matchup/${row.id}`}
      className="grid grid-cols-[minmax(0,1fr)_26px_minmax(0,1fr)] items-center gap-2 rounded-[16px] bg-m-b1 p-3"
      data-matchup={row.id}
    >
      <Side name={teamName(doc, left.id)} score={left.score} status={row.status} record={records.get(left.id) ?? null} avClass={av(left.id)} online={online(left.id)} />
      <span className="flex flex-col items-center gap-0.5 text-center text-[11px] font-semibold text-m-t4">
        vs
        {row.is_overridden && (
          <span className="text-m-pos-wr" title={OVERRIDDEN_TITLE} aria-label={OVERRIDDEN_TITLE}>
            ✸
          </span>
        )}
      </span>
      {right ? (
        <Side name={teamName(doc, right.id)} score={right.score} status={row.status} record={records.get(right.id) ?? null} avClass={av(right.id)} online={online(right.id)} end />
      ) : (
        <div className="flex min-w-0 flex-col items-end gap-[5px] text-right">
          <span className="text-[13px] font-semibold text-m-t3">Bye</span>
        </div>
      )}
    </Link>
  )
}

function Side({
  name,
  score,
  status,
  record,
  avClass,
  online,
  end = false,
}: {
  name: string
  score: number | null
  status: string
  record: string | null
  avClass: string
  online: boolean
  end?: boolean
}) {
  const cell = scoreCell(score, status)
  return (
    <div className={cn('flex min-w-0 flex-col gap-[5px]', end && 'text-right')}>
      <div className={cn('flex items-center gap-2', end && 'flex-row-reverse')}>
        <TeamAvatar name={name} className={avClass} online={online} onlineRingClass="ring-m-b1" />
        <span className="flex-1" />
        <span
          className={cn(
            'tabular-nums',
            cell.pending ? 'text-[13px] font-semibold text-m-t3' : score === null ? 'text-[17px] font-semibold text-m-t4' : 'text-[17px] font-semibold text-m-t1',
          )}
          title={cell.title ?? undefined}
        >
          {cell.text}
        </span>
      </div>
      <span className="truncate whitespace-nowrap text-[13px] font-semibold text-m-t1">{name}</span>
      {record && <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-m-t3">{record}</span>}
    </div>
  )
}

/** A total-points league's week: the stored leaderboard, ranked by the ops
 *  (absence is pending, never 0). */
function Leaderboard({ leagueId, doc, av, online }: { leagueId: string; doc: WeekMatchups; av: Av; online: Online }) {
  const rows = leaderboardRows(doc)
  return (
    <section className="overflow-hidden rounded-[16px] bg-m-b1" aria-label={LEADERBOARD_TITLE}>
      <p className="px-3 pb-1 pt-3 text-[12px] font-semibold text-m-t3">{LEADERBOARD_TITLE}</p>
      {rows.length === 0 && <p className="px-3 pb-3 text-[13px] font-medium text-m-t3">No scores yet this week.</p>}
      {rows.map((r) => (
        <Link key={r.team_id} href={teamPageHref(leagueId, r.team_id)} className="flex h-12 items-center gap-2.5 border-t border-m-b3 px-3">
          <span className="w-5 flex-none text-[13px] font-semibold tabular-nums text-m-t3">{r.rank ?? '—'}</span>
          <TeamAvatar name={r.name} className={av(r.team_id)} online={online(r.team_id)} onlineRingClass="ring-m-b1" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{r.name}</span>
          {r.points !== null ? (
            <span className="text-[14px] font-semibold tabular-nums text-m-t1">{formatPoints(r.points)}</span>
          ) : (
            <span className="text-[12px] font-medium text-m-t3">pending</span>
          )}
        </Link>
      ))}
    </section>
  )
}
