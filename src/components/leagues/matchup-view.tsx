'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { leagueCardContext } from '@/components/players/player-card-context'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { UsernameLink } from '@/components/shared/username-link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useBoxScore } from '@/hooks/use-box-score'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { useRosters } from '@/hooks/use-rosters'
import { useSchedule, type ScheduleWeek } from '@/hooks/use-schedule'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { BoxStarter, TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { PROJ_TEXT } from '@/components/players/projected-points'
import { streakArrowText, streakToneClass, teamStreak, type Streak } from '@/components/mobile/league/streak-ops'
import { cn } from '@/lib/utils'

import { commishMatchupHref } from './activity-page-ops'
import { MatchupCorrectionNote } from './corrections-view'
import { boxPointsNote, weekMayHaveCorrections } from './corrections-view-ops'
import { Crest, TeamNameLink, LeaguePageTitle } from './league-cells'
import { managersByTeam, scoringLive } from './league-home-season-ops'
import { formatInstantWithDate, formatKickoff } from './lineup-editor-ops'
import {
  BENCH_LABEL,
  BENCH_NOT_COUNTED_COPY,
  EMPTY_BENCH_COPY,
  benchNote,
  benchUnrecorded,
  WIN_CHANCE_HOW,
  WIN_CHANCE_LABEL,
  winChance,
  benchRows,
  benchSlotLabel,
  type BenchRow,
  BOX_SUM_LABEL,
  LEADERBOARD_TITLE,
  MEDIAN_PENDING_TITLE,
  MEDIAN_ROW_LABEL,
  NO_LEADERBOARD_ROWS_COPY,
  NO_LINEUP_COPY,
  NO_STARTERS_COPY,
  NO_WEEK_COPY,
  OVERRIDDEN_LABEL,
  OVERRIDDEN_TITLE,
  SECOND_CHIP_LABEL,
  boxSumCell,
  emptyWeekCopy,
  formatPoints,
  gameStateLine,
  leaderboardRows,
  lineSummary,
  medianRow,
  opponentLabel,
  pairBench,
  pairSlots,
  projectedTotalText,
  projectionText,
  resolveWeek,
  resultChip,
  scoreCell,
  secondChip,
  selectedMatchup,
  sideResult,
  splitRows,
  starterCell,
  teamName,
  weekBadge,
  weekNav,
  yetToPlayCopy,
  yetToPlayCount,
} from './matchup-view-ops'
import { projectedTotal } from './my-team-ops'
import { MatchupOverrideTools } from './matchup-override-panel'
import { LiveStatsDelayedBanner, ReconnectingBanner, STALE_SCORES_COPY, StaleDataBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * Matchup view — §16.1 `…/leagues/[id]/matchup` (+ `/[mid]`), §16.2
 * `matchup-view` ("head-to-head live scoreboard (Live Mode patterns);
 * median/second-opponent rows + total_points leaderboard variant"), §11.4,
 * §16.5.3, §16.5.4 — M4 task L.D5.2 (PROGRESS D323).
 *
 * **Data, and who gates whom.** `useLeague` is the membership gate for the
 * whole page (the D316(4)/F249(a) posture); nothing below mounts for a
 * non-member. `useSchedule` is the week ladder — the page's week is the
 * named matchup's own, else `?week=`, else the ladder's current week
 * (`resolveWeek`; F248(b)'s product choice, the team page's). `useMatchupsLive`
 * is one week's matchups / results / `league_weeks` row through the
 * matchups route, subscribed to the ONE refcounted `league:<id>` room
 * (F233(a) — never a second `.channel(`), refetching itself AND every box
 * of the week on the coalesced `scores_updated` event (D296/D298 —
 * `matchupsInvalidationKeys`). Each `TeamBox` is one `useBoxScore` read:
 * the starters' points / pending / no-line states computed SERVER-side
 * through the worker's own pipeline (`box-score-service.ts`).
 *
 * **The client computes nothing.** Every number on this page is a stored
 * cell; the `Final (pending corrections)` → `Final` badge is
 * `league_weeks.status` as the server holds it (D295) — no client clock
 * decides it, and none is read here (§23.3 / the F226 posture). Instants
 * (kickoffs) are stored values formatted viewer-local with the league zone
 * on hover (§16.4, `formatKickoff`).
 *
 * **§16.5.3, all three variants:** a `total_points` league REPLACES the
 * matchup surface with the week's scores leaderboard (`TotalPointsWeek`);
 * `median_game` adds the *vs League Median* row with its own W/L chip under
 * each side; `second_opponent` adds the second chip. Divisions: none (Q30
 * (d), F221).
 *
 * **§16.5.4 states, per surface:** skeleton · empty by REASON (a playoff
 * week before its round, no lineup on record, no scores yet) · error-with-
 * retry (`ProblemCard`) · degraded = `StaleDataBanner` + last-good scores,
 * the reconnecting banner off the room's `connection`, and the "Live stats
 * delayed" banner off the `stats_degraded` flag (honest staleness — the
 * numbers stay).
 *
 * **The commissioner's override (M6A L.E1.12):** `MatchupOverrideTools`
 * under the scoreboard of an h2h week — the override-MODE switch (PROGRESS
 * §3(h)) and, while it is on, the both-scores / declare-a-winner panel. The
 * `✸ Adjusted` marker above it reads `matchups.is_overridden`, which these
 * verbs are the first to set. A `total_points` week has no matchup row to
 * correct, so nothing mounts there.
 *
 * **Stat corrections (M6 L.E2.4 — §16.5.2, F477):** under the scoreboard,
 * `MatchupCorrectionNote` says when a stat correction changed a score or
 * the result of this matchup (the corrections read, live on the room), with
 * the door to the week's list; each box says in words where its points come
 * from (`boxPointsNote` over the box read's `points_source` / `stored_note`
 * — a final week's points are the ones the team was scored on, while the
 * stat line is today's).
 *
 * **Deliberately not here (each an F-row):** the ⚑ report-illegal-lineup
 * entry (§10.2 — its route and audit table are M6's); the league-home
 * "matchup of the week" hero (L.D5.4 / F46).
 */
export function MatchupPage({
  leagueId,
  matchupId = null,
  weekParam = null,
}: {
  leagueId: string
  matchupId?: string | null
  weekParam?: number | null
}) {
  const league = useLeague(leagueId)
  if (league.isPending) return <MatchupSkeleton />
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading="Matchups"
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  return <MatchupContent leagueId={leagueId} matchupId={matchupId} weekParam={weekParam} detail={league.data} />
}

function MatchupContent({
  leagueId,
  matchupId,
  weekParam,
  detail,
}: {
  leagueId: string
  matchupId: string | null
  weekParam: number | null
  detail: LeagueDetail
}) {
  const { user } = useAuth()
  const schedule = useSchedule(leagueId)
  const week = useMemo(
    () => resolveWeek({ matchupId, weekParam, weeks: schedule.data?.weeks, matchups: schedule.data?.matchups }),
    [matchupId, weekParam, schedule.data],
  )
  const matchups = useMatchupsLive(leagueId, week ?? undefined)
  // F277(d) / F274: the flag is POLLED (nothing broadcasts `system_flags`),
  // so only a week that is scoring asks — an `upcoming` / `final` week
  // cannot be delayed. The league home's hero applies the same gate.
  const degraded = useStatsDegraded({ enabled: scoringLive(matchups.data?.league_week.status) })
  // Either §23.2 reason the numbers below may be behind: the provider stopped
  // answering (122's `stats_degraded`) or the score-week drain stopped running
  // (124's `scoring_stalled` — the 2026-09-10 stall).
  const delay = liveScoringDelay(degraded.data)
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const leagueTimeZone = detail.settings.draft.time_zone ?? null

  const header = (
    <LeaguePageTitle title="Matchups" />
  )

  if (week === null) {
    if (schedule.isPending) return <MatchupSkeleton />
    if (schedule.isError) {
      return (
        <ProblemCard
          heading="Matchups"
          title="Couldn’t load the schedule."
          detail={problemCopy(schedule.error)}
          onRetry={() => schedule.refetch()}
          leagueId={leagueId}
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyCard copy={NO_WEEK_COPY} data-empty="no-week" />
      </div>
    )
  }

  const problem = matchups.isError ? (matchups.error instanceof Error ? matchups.error : new Error(String(matchups.error))) : null
  const weeks = schedule.data?.weeks ?? []
  const doc = matchups.data

  return (
    <div className="flex flex-col gap-4">
      {header}

      {matchups.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {problem && doc && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
      {delay.delayed && (
        <LiveStatsDelayedBanner since={delay.since ? formatInstantWithDate(delay.since, leagueTimeZone).local : null} />
      )}

      <WeekStrip leagueId={leagueId} week={week} weeks={weeks} weekStatus={doc?.league_week.status ?? null} />

      {matchups.isPending ? (
        <BodySkeleton />
      ) : problem && !doc ? (
        <ProblemCard
          heading="Matchups"
          title="Couldn’t load this week."
          detail={problemCopy(problem)}
          onRetry={() => matchups.refetch()}
          leagueId={leagueId}
        />
      ) : doc ? (
        doc.schedule_mode === 'total_points' ? (
          <TotalPointsWeek leagueId={leagueId} doc={doc} myTeamId={myTeamId} leagueTimeZone={leagueTimeZone} />
        ) : (
          <HeadToHeadWeek
            leagueId={leagueId}
            doc={doc}
            detail={detail}
            weeks={weeks}
            matchupId={matchupId}
            myTeamId={myTeamId}
            leagueTimeZone={leagueTimeZone}
          />
        )
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The week strip — prev / next over the ladder, the §16.5.4 badge
// ---------------------------------------------------------------------------

function WeekStrip({
  leagueId,
  week,
  weeks,
  weekStatus,
}: {
  leagueId: string
  week: number
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  weekStatus: string | null
}) {
  const nav = weekNav(weeks, week)
  const badge = weekStatus ? weekBadge(weekStatus) : null
  return (
    <div className="flex flex-wrap items-center gap-2" data-week-strip>
      <Button variant="stroke" size="sm" asChild={nav.prev !== null} disabled={nav.prev === null} aria-label="Previous week">
        {nav.prev !== null ? (
          <Link href={`/app/leagues/${leagueId}/matchup?week=${nav.prev}`}>
            <Icon name="collapse" size={12} />
          </Link>
        ) : (
          <span>
            <Icon name="collapse" size={12} />
          </span>
        )}
      </Button>
      <span className="px-1 text-[17px] font-bold tracking-[-0.02em] text-ink" data-week={week}>
        Week <span className="fs-num">{week}</span>
      </span>
      <Button variant="stroke" size="sm" asChild={nav.next !== null} disabled={nav.next === null} aria-label="Next week">
        {nav.next !== null ? (
          <Link href={`/app/leagues/${leagueId}/matchup?week=${nav.next}`}>
            <Icon name="expand" size={12} />
          </Link>
        ) : (
          <span>
            <Icon name="expand" size={12} />
          </span>
        )}
      </Button>
      {badge && (
        <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
          {badge.label}
        </Badge>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// h2h — the scoreboard, the two boxes, the rest of the week
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// h2h — the scoreboard, the slot-aligned board, the rest of the week
// ---------------------------------------------------------------------------

function HeadToHeadWeek({
  leagueId,
  doc,
  detail,
  weeks,
  matchupId,
  myTeamId,
  leagueTimeZone,
}: {
  leagueId: string
  doc: WeekMatchups
  detail: LeagueDetail
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  matchupId: string | null
  myTeamId: string | null
  leagueTimeZone: string | null
}) {
  const { primary, secondary } = splitRows(doc.matchups)
  const selected = selectedMatchup(primary, matchupId, myTeamId)
  const settings = { median_game: detail.settings.median_game, second_opponent: detail.settings.second_opponent }
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  // F566: each side's current W/L streak — the one shared count
  // (`streak-ops`) over the schedule read's stored final results.
  const schedule = useSchedule(leagueId)
  const streakOf = (teamId: string) => (schedule.data ? teamStreak(teamId, schedule.data, doc.season) : null)

  if (!selected) {
    return <EmptyCard copy={emptyWeekCopy(doc.week, weeks, detail.settings.regular_season_weeks)} data-empty="no-matchups" />
  }

  return (
    <div className="flex flex-col gap-4" data-variant="h2h">
      <Scoreboard doc={doc} row={selected} settings={settings} myTeamId={myTeamId} managers={managers} streakOf={streakOf} />

      {selected.away_team_id && (
        <WinChanceMeter
          leagueId={leagueId}
          season={doc.season}
          week={doc.week}
          weekStatus={doc.league_week.status}
          home={{ teamId: selected.home_team_id, name: teamName(doc, selected.home_team_id) }}
          away={{ teamId: selected.away_team_id, name: teamName(doc, selected.away_team_id) }}
        />
      )}

      {weekMayHaveCorrections(doc.league_week.status) && (
        // The selected row is always a PRIMARY row (`selectedMatchup` over `splitRows`' primary list) — its game is `matchup` (R1365).
        <MatchupCorrectionNote leagueId={leagueId} week={doc.week} teamIds={[selected.home_team_id, selected.away_team_id]} scope="matchup" />
      )}

      {/* THE COMMISSIONER'S OVERRIDE (M6A L.E1.12; §15.4:1692-1693; PROGRESS
          §3(h)): the mode switch is here in EVERY week state — never behind a
          refusal — and the correction panel opens under it while the mode is
          on. Commissioner only: a manager's page is unchanged. Keyed by the
          matchup so the score drafts never carry from one row to another. */}
      {isCommish && (
        <MatchupOverrideTools
          key={selected.id}
          leagueId={leagueId}
          row={selected}
          homeName={teamName(doc, selected.home_team_id)}
          awayName={selected.away_team_id ? teamName(doc, selected.away_team_id) : null}
        />
      )}

      <LineupBoard
        leagueId={leagueId}
        season={doc.season}
        week={doc.week}
        weekStatus={doc.league_week.status}
        home={{ teamId: selected.home_team_id, name: teamName(doc, selected.home_team_id) }}
        away={selected.away_team_id ? { teamId: selected.away_team_id, name: teamName(doc, selected.away_team_id) } : 'bye'}
        leagueTimeZone={leagueTimeZone}
      />

      {primary.length > 1 && (
        <MatchupList
          leagueId={leagueId}
          doc={doc}
          rows={primary.filter((m) => m.id !== selected.id)}
          title="Around the league"
          myTeamId={myTeamId}
          linkable
        />
      )}
      {secondary.length > 0 && (
        <MatchupList leagueId={leagueId} doc={doc} rows={secondary} title="Second opponents" myTeamId={myTeamId} linkable={false} />
      )}
    </div>
  )
}

/**
 * The head-to-head scoreboard — the prototype's MatchupTab header: each side
 * a crest, the team (a door to its page), its manager, and a big mono score;
 * the week and "vs" between them. A score is muted only while it is pending
 * or once the STORED result says that side lost (the client never compares
 * scores). Each side carries its current W/L streak (F566); the win-chance
 * meter sits under the card (`WinChanceMeter`).
 */
export function Scoreboard({
  doc,
  row,
  settings,
  myTeamId,
  managers,
  streakOf,
}: {
  doc: WeekMatchups
  row: MatchupRow
  settings: { median_game: boolean; second_opponent: boolean }
  myTeamId: string | null
  /** team id → manager username (`managersByTeam`). */
  managers?: ReadonlyMap<string, string>
  /** F566: the team's current streak; null before a decided game. */
  streakOf?: (teamId: string) => Streak | null
}) {
  const homeMedian = medianRow(doc, row.home_team_id, settings.median_game)
  const homeSecond = secondChip(doc, row.home_team_id, settings.second_opponent)
  const awayMedian = row.away_team_id ? medianRow(doc, row.away_team_id, settings.median_game) : null
  const awaySecond = row.away_team_id ? secondChip(doc, row.away_team_id, settings.second_opponent) : null
  const extras = homeMedian || homeSecond || awayMedian || awaySecond
  return (
    <Card className="min-w-0 overflow-hidden" data-matchup={row.id} data-matchup-status={row.status}>
      <CardContent className="flex flex-col gap-3 p-[15px]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
          <Side doc={doc} row={row} teamId={row.home_team_id} score={row.home_score} manager={managers?.get(row.home_team_id) ?? null} streak={streakOf?.(row.home_team_id) ?? null} mine={row.home_team_id === myTeamId} />
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="whitespace-nowrap text-[10px] font-semibold text-n-6">
              Week <span className="fs-num">{doc.week}</span>
              {row.round_type === 'playoff' && ' · Playoffs'}
            </span>
            <span className="flex h-[29px] w-[29px] items-center justify-center rounded-full bg-surface-control text-[9px] font-bold text-n-6">vs</span>
            {row.is_overridden && (
              // §10.3 / F233(d): the ✸ badge lands on the commissioner's log — this
              // week, this matchup's teams (a score / result receipt records both).
              <Link
                href={commishMatchupHref(doc.league_id, doc.week, row.home_team_id)}
                className="rounded-pill focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                data-overridden-link
              >
                <Badge variant="stroke-purple" title={OVERRIDDEN_TITLE} className="hover:bg-accent-soft" data-overridden>
                  {OVERRIDDEN_LABEL}
                </Badge>
              </Link>
            )}
          </div>
          {row.away_team_id ? (
            <Side doc={doc} row={row} teamId={row.away_team_id} score={row.away_score} manager={managers?.get(row.away_team_id) ?? null} streak={streakOf?.(row.away_team_id) ?? null} mine={row.away_team_id === myTeamId} mirror />
          ) : (
            <div className="flex min-w-0 flex-col items-end gap-1 text-right" data-side="bye">
              <span className="text-[13px] font-bold text-n-3">Bye</span>
              <span className="text-[11px] font-medium text-n-6">No opponent this week.</span>
            </div>
          )}
        </div>
        {extras && (
          <div className="grid grid-cols-2 gap-3 border-t border-n-4 pt-2.5">
            <SideExtras doc={doc} median={homeMedian} second={homeSecond} />
            <SideExtras doc={doc} median={awayMedian} second={awaySecond} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Side({
  doc,
  row,
  teamId,
  score,
  manager,
  streak = null,
  mine,
  mirror = false,
}: {
  doc: WeekMatchups
  row: MatchupRow
  teamId: string
  score: number | null
  manager: string | null
  streak?: Streak | null
  mine: boolean
  mirror?: boolean
}) {
  const name = teamName(doc, teamId)
  const cell = scoreCell(score, row.status)
  const h2h = resultChip(sideResult(row, teamId, doc.results))
  const lost = h2h.text === 'L'
  return (
    // The viewer's own side is a resting FILL, never a shadow (CLAUDE.md).
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3',
        mirror && 'items-end text-right sm:flex-row-reverse',
        mine && 'bg-accent-soft',
      )}
      data-side={teamId}
      data-mine={mine || undefined}
    >
      <div className={cn('flex min-w-0 max-w-full items-center gap-2 sm:flex-1', mirror && 'flex-row-reverse')}>
        <Crest name={name} src={null} className="h-[31px] w-[31px]" fallbackClassName="text-[10px]" />
        {/* The name is the door to that franchise's page (§16.1) — the CREST
            stays outside the anchor so the link's accessible name is the team. */}
        <div className="min-w-0">
          <TeamNameLink name={name} leagueId={doc.league_id} teamId={teamId} className="block truncate text-[13px] font-bold tracking-[-0.01em] text-ink" />
          <span className={cn('flex min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
            {manager && (
              <span className="truncate text-[10px] font-medium text-n-6">
                <UsernameLink username={manager} />
              </span>
            )}
            {streak && (
              <span className={cn('fs-num shrink-0 text-[10px] font-bold', streakToneClass(streak, 'text-n-6'))} title="Current streak" data-streak={streakArrowText(streak)}>
                {streakArrowText(streak)}
              </span>
            )}
            {h2h.decided && (
              <Badge variant={h2h.variant} title={h2h.title} data-result={h2h.text}>
                {h2h.text}
              </Badge>
            )}
          </span>
        </div>
      </div>
      <p
        className={cn('fs-num shrink-0 text-[27px] font-bold leading-none tracking-[-0.035em]', cell.pending || lost ? 'text-n-3' : 'text-ink')}
        title={cell.title ?? undefined}
        data-score={cell.pending ? 'pending' : cell.text}
      >
        {cell.text}
      </p>
    </div>
  )
}

/** The second game(s) under a side: the *vs League Median* row and/or the
 *  second opponent, each with its own stored W/L (§16.5.3). */
function SideExtras({
  doc,
  median,
  second,
}: {
  doc: WeekMatchups
  median: ReturnType<typeof medianRow>
  second: ReturnType<typeof secondChip>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {median && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-medium" data-median-row>
          <span className="text-[10px] text-n-6">{MEDIAN_ROW_LABEL}</span>
          <span className="flex items-center gap-1.5">
            <span className="fs-num font-bold text-ink" title={median.median === null ? MEDIAN_PENDING_TITLE : undefined}>
              {median.median === null ? '—' : formatPoints(median.median)}
            </span>
            <ResultBadge result={median.result} data-median-result />
          </span>
        </div>
      )}
      {second && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-medium" data-second-chip>
          <span className="min-w-0 truncate text-[10px] text-n-6">
            {SECOND_CHIP_LABEL} · {teamName(doc, second.opponent_team_id)}
          </span>
          <span className="flex items-center gap-1.5">
            {second.score !== null && second.opponent_score !== null && (
              <span className="fs-num font-bold text-ink">
                {formatPoints(second.score)} – {formatPoints(second.opponent_score)}
              </span>
            )}
            <ResultBadge result={second.result} data-second-result />
          </span>
        </div>
      )}
    </div>
  )
}

function ResultBadge({ result, ...rest }: { result: string | null } & Record<string, unknown>) {
  const chip = resultChip(result)
  return (
    <Badge variant={chip.variant} title={chip.title} className={cn(!chip.decided && 'text-n-3')} {...rest}>
      {chip.text}
    </Badge>
  )
}

function MatchupList({
  leagueId,
  doc,
  rows,
  title,
  myTeamId,
  linkable,
}: {
  leagueId: string
  doc: WeekMatchups
  rows: readonly MatchupRow[]
  title: string
  myTeamId: string | null
  linkable: boolean
}) {
  return (
    <Card className="overflow-hidden" data-matchup-list={title}>
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-1.5 pt-3">
        <CardTitle className="text-[13px] font-bold tracking-[-0.02em]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-n-4 border-t border-n-4 px-0 py-0">
        {rows.map((m) => {
          const home = scoreCell(m.home_score, m.status)
          const away = scoreCell(m.away_score, m.status)
          const mine = m.home_team_id === myTeamId || m.away_team_id === myTeamId
          // A `linkable` row IS an anchor (to its own matchup), and an <a>
          // inside an <a> is invalid HTML — so the team names get their door
          // only on the rows that have none (the "Second opponents" list).
          // Nothing is lost on a linkable row: its matchup page renders both
          // box scores, whose titles are team-page links.
          const doorId = (id: string | null) => (linkable ? null : id)
          const body = (
            <>
              <TeamNameLink
                name={teamName(doc, m.home_team_id)}
                leagueId={doc.league_id}
                teamId={doorId(m.home_team_id)}
                className={cn('min-w-0 flex-1 truncate text-[12px] font-semibold', mine && 'text-accent-strong')}
              />
              <span className="fs-num shrink-0 text-[13px] font-bold tracking-[-0.01em]" title={home.title ?? undefined}>
                {home.text}
              </span>
              <span className="text-[10px] font-semibold text-n-6">–</span>
              <span className="fs-num shrink-0 text-[13px] font-bold tracking-[-0.01em]" title={away.title ?? undefined}>
                {m.away_team_id ? away.text : '—'}
              </span>
              {/* A bye row has no away id — `teamName` renders the literal
                  "Bye", which must stay non-interactive text. */}
              <TeamNameLink
                name={teamName(doc, m.away_team_id)}
                leagueId={doc.league_id}
                teamId={doorId(m.away_team_id)}
                className={cn('min-w-0 flex-1 truncate text-right text-[12px] font-semibold', mine && 'text-accent-strong')}
              />
              {m.is_overridden && (
                <Badge variant="stroke-purple" title={OVERRIDDEN_TITLE} className="shrink-0">
                  ✸
                </Badge>
              )}
            </>
          )
          const className = cn('flex min-h-[34px] items-center gap-2 px-[15px] py-2', linkable && 'transition-colors hover:bg-surface-sunken')
          return linkable ? (
            <Link key={m.id} href={`/app/leagues/${leagueId}/matchup/${m.id}`} className={className} data-matchup-row={m.id}>
              {body}
            </Link>
          ) : (
            <div key={m.id} className={className} data-matchup-row={m.id}>
              {body}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// total_points — the week leaderboard REPLACES the matchup surface (§16.5.3)
// ---------------------------------------------------------------------------

function TotalPointsWeek({
  leagueId,
  doc,
  myTeamId,
  leagueTimeZone,
}: {
  leagueId: string
  doc: WeekMatchups
  myTeamId: string | null
  leagueTimeZone: string | null
}) {
  const rows = leaderboardRows(doc)
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked ?? myTeamId ?? rows[0]?.team_id ?? null
  // F277(c): the week strip above carries the week badge — not a second one.
  return (
    <div className="flex flex-col gap-4" data-variant="total_points">
      <Card className="overflow-hidden" data-leaderboard>
        <CardHeader className="min-h-0 border-b-0 px-[15px] pb-1.5 pt-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-[-0.02em]">
            {LEADERBOARD_TITLE}
            <Badge variant="stroke">Total points</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-n-4 border-t border-n-4 px-0 py-0">
          {rows.length === 0 && <p className="px-[15px] py-4 text-center text-[11px] font-medium text-n-6">{NO_LEADERBOARD_ROWS_COPY}</p>}
          {rows.map((row) => (
            <button
              key={row.team_id}
              type="button"
              onClick={() => setPicked(row.team_id)}
              aria-pressed={row.team_id === selectedId}
              className={cn(
                'flex min-h-[34px] w-full items-center gap-2 px-[15px] py-1.5 text-left transition-colors hover:bg-surface-sunken',
                row.team_id === selectedId && 'bg-accent-soft',
              )}
              data-leaderboard-row={row.team_id}
              data-rank={row.rank ?? 'pending'}
            >
              <span className="fs-num w-6 shrink-0 text-right text-[10px] font-bold text-n-6">{row.rank ?? '—'}</span>
              <Crest name={row.name} src={null} />
              <span className={cn('min-w-0 flex-1 truncate text-[12px] font-semibold', row.team_id === myTeamId && 'text-accent-strong')}>{row.name}</span>
              {row.points !== null ? (
                <span className="fs-num shrink-0 text-[13px] font-bold tracking-[-0.01em] text-ink">{formatPoints(row.points)}</span>
              ) : (
                <span className="shrink-0 text-[11px] font-medium text-n-6" title="No scoring batch has reached this team yet — an absent row is not a score.">
                  pending
                </span>
              )}
              <Badge variant={row.is_final ? 'stroke' : 'lime'} className="shrink-0" title={row.is_final ? 'Final' : 'Provisional — the week has not finalized.'}>
                {row.is_final ? 'Final' : 'Live'}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>
      {selectedId && weekMayHaveCorrections(doc.league_week.status) && (
        <MatchupCorrectionNote leagueId={leagueId} week={doc.week} teamIds={[selectedId]} scope="team" />
      )}
      {selectedId && (
        <LineupBoard
          key={selectedId}
          leagueId={leagueId}
          season={doc.season}
          week={doc.week}
          weekStatus={doc.league_week.status}
          home={{ teamId: selectedId, name: teamName(doc, selectedId) }}
          away={null}
          leagueTimeZone={leagueTimeZone}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The board — both lineups slot by slot, the totals, then the benches
// ---------------------------------------------------------------------------

interface BoardSide {
  teamId: string
  name: string
}

/**
 * The prototype's slot-aligned lineups: one row per lineup slot, the home
 * starter on the left, the slot in the middle, the away starter mirrored on
 * the right; then the two totals; then both benches (never counted). Each
 * side is ONE `useBoxScore` read — every point and pending state is the
 * server's (`box-score-service.ts`); projections are `league_player_values`
 * only, shown where one is stored. `away = null` is the total-points
 * variant's single box; `'bye'` is an h2h side with no opponent.
 *
 * Mobile keeps the two columns as a compact table (the headshots drop, the
 * slot column narrows) — no horizontal page scroll.
 */
function LineupBoard({
  leagueId,
  season,
  week,
  weekStatus,
  home,
  away,
  leagueTimeZone,
}: {
  leagueId: string
  season: number
  week: number
  /** `league_weeks.status` — the points note and bench note depend on it. */
  weekStatus: string
  home: BoardSide
  away: BoardSide | 'bye' | null
  leagueTimeZone: string | null
}) {
  const awaySide = away && away !== 'bye' ? away : null
  const homeBox = useBoxScore(leagueId, week, home.teamId)
  const awayBox = useBoxScore(leagueId, week, awaySide?.teamId ?? null)
  // The bench lines carry ids only; the rosters read names them.
  const rosters = useRosters(leagueId)
  const values = useLeaguePlayerValues(leagueId, season, week)
  const two = away !== null
  const grid = two ? 'grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] sm:gap-2.5' : 'grid grid-cols-[28px_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-2.5'
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null

  const homeData = homeBox.data
  const awayData = awayBox.data
  const slots = pairSlots(homeData?.lineup ? homeData.starters : null, awayData?.lineup ? awayData.starters : null)
  const rosterOf = (teamId: string) => rosters.data?.teams.find((t) => t.team_id === teamId)?.roster
  const homeBench = homeData?.bench ? benchRows(homeData.bench, rosterOf(home.teamId)) : null
  const awayBench = awaySide && awayData?.bench ? benchRows(awayData.bench, rosterOf(awaySide.teamId)) : null
  const showBench = homeBench !== null || awayBench !== null
  const benchPairs = pairBench(homeBench ?? [], awayBench ?? [])
  // F567: a past week's bench is the one stored with its lineup; a side whose
  // bench was not recorded is said in words, never filled from today's roster.
  const benchSides = [
    ...(homeData ? [{ source: homeData.bench_source, team: home.name }] : []),
    ...(awaySide && awayData ? [{ source: awayData.bench_source, team: awaySide.name }] : []),
  ]
  const note = benchNote(weekStatus, benchSides)
  const noBenchRecorded = benchUnrecorded(benchSides)
  const live = weekStatus === 'live'
  const loading = homeBox.isPending || (awaySide !== null && awayBox.isPending)

  const centre = (text: string) => (
    <span className="text-center text-[9px] font-bold text-n-6 sm:text-[10px]">{text}</span>
  )

  return (
    <Card id="box-scores" className="min-w-0 scroll-mt-4 overflow-hidden" data-board>
      <CardContent className="flex flex-col px-[15px] pb-2 pt-3">
        {/* Each side's own state: where its points come from, or why it has none. */}
        <div className={cn(grid, 'items-start pb-2')}>
          {!two && <span />}
          <BoxStatus box={homeBox} side={home} leagueId={leagueId} weekStatus={weekStatus} />
          {two && <span />}
          {two &&
            (awaySide ? (
              <BoxStatus box={awayBox} side={awaySide} leagueId={leagueId} weekStatus={weekStatus} mirror />
            ) : (
              <div className="flex flex-col items-end text-right" data-side="bye-box">
                <span className="text-[12px] font-bold text-n-3">Bye</span>
                <span className="text-[11px] font-medium text-n-6">No opponent this week.</span>
              </div>
            ))}
        </div>

        {loading ? (
          <div className="flex flex-col gap-1.5" data-skeleton="box">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[34px] rounded-md bg-surface-control" />
            ))}
          </div>
        ) : (
          <>
            {slots.length > 0 && (
              <section className="flex flex-col" data-starters>
                <h4 className="border-b border-n-4 pb-1.5 pt-1 text-center text-[10px] font-bold text-ink">Starters</h4>
                {slots.map((pair) => (
                  <div key={pair.key} className={cn(grid, 'min-h-[34px] border-b border-n-4 py-1.5 transition-colors hover:bg-surface-sunken')} data-slot-row={pair.key}>
                    {!two && centre(pair.label)}
                    {pair.home ? <StarterCellView leagueId={leagueId} starter={pair.home} teamId={home.teamId} proj={pair.home.player ? projOf(pair.home.player.id) : null} leagueTimeZone={leagueTimeZone} /> : <span />}
                    {two && centre(pair.label)}
                    {two &&
                      (pair.away && awaySide ? (
                        <StarterCellView leagueId={leagueId} starter={pair.away} teamId={awaySide.teamId} proj={pair.away.player ? projOf(pair.away.player.id) : null} leagueTimeZone={leagueTimeZone} mirror />
                      ) : (
                        <span />
                      ))}
                  </div>
                ))}
                <div className={cn(grid, 'py-2')} data-total-row>
                  {!two && centre(BOX_SUM_LABEL)}
                  <TotalCell data={homeData} teamId={home.teamId} projOf={projOf} live={live} />
                  {two && centre(BOX_SUM_LABEL)}
                  {two && (awaySide ? <TotalCell data={awayData} teamId={awaySide.teamId} projOf={projOf} live={live} mirror /> : <span />)}
                </div>
              </section>
            )}

            {showBench && (
              <section className="flex flex-col border-t border-n-4 pt-[15px]" data-bench>
                <h4 className="text-center text-[10px] font-bold text-ink">{BENCH_LABEL}</h4>
                <p className="pb-1.5 text-center text-[10px] font-medium text-n-6">{BENCH_NOT_COUNTED_COPY}</p>
                {note && (
                  <p className="pb-1.5 text-center text-[10px] font-medium text-n-6" data-bench-note>
                    {note}
                  </p>
                )}
                {benchPairs.length === 0 && noBenchRecorded ? null : benchPairs.length === 0 ? (
                  <p className="py-2 text-center text-[11px] font-medium text-n-6" data-empty="no-bench">
                    {EMPTY_BENCH_COPY}
                  </p>
                ) : (
                  benchPairs.map((pair, i) => (
                    <div key={i} className={cn(grid, 'min-h-[34px] border-b border-n-4 py-1 transition-colors last:border-b-0 hover:bg-surface-sunken')}>
                      {!two && centre(benchSlotLabel(pair))}
                      {pair.home ? <BenchCellView leagueId={leagueId} row={pair.home} teamId={home.teamId} /> : <span />}
                      {two && centre(benchSlotLabel(pair))}
                      {two && (pair.away && awaySide ? <BenchCellView leagueId={leagueId} row={pair.away} teamId={awaySide.teamId} mirror /> : <span />)}
                    </div>
                  ))
                )}
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** One side's header cell on the board: the team (a door to its page — a box
 *  score is where an empty lineup is noticed), where its points come from,
 *  and the honest empty / error states. */
function BoxStatus({
  box,
  side,
  leagueId,
  weekStatus,
  mirror = false,
}: {
  box: ReturnType<typeof useBoxScore>
  side: BoardSide
  leagueId: string
  weekStatus: string
  mirror?: boolean
}) {
  const problem = box.isError ? (box.error instanceof Error ? box.error : new Error(String(box.error))) : null
  const data = box.data
  // F477: where the points come from, in words (null = nothing to say).
  const pointsNote = data ? boxPointsNote(data, weekStatus) : null
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', mirror && 'items-end text-right')} data-box={side.teamId}>
      <TeamNameLink name={side.name} leagueId={leagueId} teamId={side.teamId} className="max-w-full truncate text-[13px] font-bold tracking-[-0.01em] text-ink" />
      {problem && data && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
      {pointsNote && (
        <p className="text-[10px] font-medium text-n-6" data-box-note>
          {pointsNote}
        </p>
      )}
      {problem && !data && (
        <div className={cn('flex flex-col gap-1.5 rounded-xl bg-negative-soft px-3 py-2.5', mirror ? 'items-end' : 'items-start')} role="alert" data-box-error>
          <p className="text-[11px] font-bold">Couldn’t load this box score.</p>
          <p className="text-[10px] font-medium text-n-3">{problemCopy(problem)}</p>
          <Button variant="stroke" size="sm" onClick={() => box.refetch()}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </div>
      )}
      {data && data.lineup === null && (
        <p className="text-[11px] font-medium text-n-6" data-empty="no-lineup">
          {NO_LINEUP_COPY}
        </p>
      )}
      {data && data.lineup !== null && data.starters.every((s) => s.reason === 'empty') && (
        <p className="text-[11px] font-medium text-n-6" data-empty="no-starters">
          {NO_STARTERS_COPY}
        </p>
      )}
    </div>
  )
}

/**
 * F566 — the win-chance meter: the plain rule in `winChance` over the same
 * box reads the board makes (one cache entry each) and the stored
 * projections. Rendered only while the week is upcoming or live and every
 * starter still to play has a projection; otherwise nothing (never a guess).
 * A static bar in page flow — no shadow (CLAUDE.md).
 */
function WinChanceMeter({
  leagueId,
  season,
  week,
  weekStatus,
  home,
  away,
}: {
  leagueId: string
  season: number
  week: number
  weekStatus: string
  home: BoardSide
  away: BoardSide
}) {
  const homeBox = useBoxScore(leagueId, week, home.teamId)
  const awayBox = useBoxScore(leagueId, week, away.teamId)
  const values = useLeaguePlayerValues(leagueId, season, week)
  const side = (d: TeamBoxScore | undefined) => (d?.lineup ? { points: d.points, starters: d.starters } : null)
  const chance = winChance(weekStatus, side(homeBox.data), side(awayBox.data), (id) => values.byPlayer.get(id)?.projected_points ?? null)
  if (!chance) return null
  return (
    <Card className="min-w-0" data-win-chance={`${chance.home}-${chance.away}`}>
      <CardContent className="flex flex-col gap-1.5 px-[15px] py-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
          <span className="fs-num text-ink" data-win-chance-home>
            {chance.home}%
          </span>
          <span className="text-[10px] font-bold text-n-6">{WIN_CHANCE_LABEL}</span>
          <span className="fs-num text-ink" data-win-chance-away>
            {chance.away}%
          </span>
        </div>
        <div
          className="flex h-1.5 overflow-hidden rounded-pill bg-surface-control"
          role="img"
          aria-label={`${WIN_CHANCE_LABEL}: ${home.name} ${chance.home}%, ${away.name} ${chance.away}%`}
        >
          <span className="h-full bg-accent" style={{ width: `${chance.home}%` }} />
        </div>
        <p className="text-center text-[10px] font-medium text-n-6" data-win-chance-how>
          <span className="fs-num">Proj {chance.homeFinal.toFixed(1)} – {chance.awayFinal.toFixed(1)}</span> · {WIN_CHANCE_HOW}
        </p>
      </CardContent>
    </Card>
  )
}

/** The worker's total for one side (pending stays the word — E61), the
 *  projected total when every starter has a stored projection, and how many
 *  starters' games have not kicked off (from each game's stored status). */
function TotalCell({
  data,
  teamId,
  projOf,
  live,
  mirror = false,
}: {
  data: TeamBoxScore | undefined
  teamId: string
  projOf: (id: string) => number | null
  live: boolean
  mirror?: boolean
}) {
  // No lineup ⇒ no sum to speak of (the side's state says why), not `pending`.
  if (!data || !data.lineup) return <span data-box-total={teamId} />
  const sum = boxSumCell(data)
  const ids = data.starters.map((s) => s.player?.id ?? null)
  const proj = projectedTotalText(projectedTotal(ids, projOf), ids.filter(Boolean).length)
  const yet = live ? yetToPlayCount(data.starters) : 0
  return (
    <div className={cn('flex min-w-0 flex-col', mirror ? 'items-start text-left' : 'items-end text-right')} data-box-total={teamId}>
      <span
        className={cn('fs-num text-[17px] font-bold leading-tight tracking-[-0.02em]', sum.pending ? 'text-n-3' : 'text-ink')}
        title={sum.title ?? undefined}
        data-box-sum={sum.pending ? 'pending' : sum.text}
      >
        {sum.text}
      </span>
      {proj && (
        <span className={cn('fs-num text-[10px] font-semibold', PROJ_TEXT)} data-proj-total>
          {proj}
        </span>
      )}
      {yet > 0 && (
        <span className="text-[10px] font-medium text-n-6" data-yet-to-play={yet}>
          {yetToPlayCopy(yet)}
        </span>
      )}
    </div>
  )
}

function PlayerFace({ player }: { player: { id: string; full_name: string; position: string; nfl_team: string | null; headshot_url?: string | null } }) {
  // The headshot from the box read (F572); initials when it is null or fails to load
  // (the name itself renders as the card door beside the face).
  const initials = initialsOf(player.full_name)
  return (
    <Avatar className="hidden h-7 w-7 shrink-0 bg-surface-control sm:flex">
      <PlayerAvatarImage player={{ id: player.id, position: player.position, team: player.nfl_team, headshot_url: player.headshot_url ?? null }} />
      <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
    </Avatar>
  )
}

function StarterCellView({
  leagueId,
  starter,
  teamId,
  proj,
  leagueTimeZone,
  mirror = false,
}: {
  leagueId: string
  starter: BoxStarter
  teamId: string
  proj: number | null
  leagueTimeZone: string | null
  mirror?: boolean
}) {
  const cell = starterCell(starter)
  const kickoff = starter.game && starter.phase === 'up_next' ? formatKickoff(starter.game.kickoff_at, leagueTimeZone) : null
  const state = starter.phase === 'up_next' ? null : gameStateLine(starter.game)
  const line = lineSummary(starter.line)
  const opp = starter.player ? opponentLabel(starter.player.nfl_team, starter.game) : null
  const projText = projectionText(proj)
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2', mirror && 'flex-row-reverse')}
      data-starter={starter.slot}
      data-starter-reason={starter.reason}
      data-side-of={teamId}
    >
      {starter.player ? (
        <>
          <PlayerFace player={starter.player} />
          <div className={cn('min-w-0 flex-1', mirror && 'text-right')}>
            <div className="truncate leading-tight">
              <PlayerLink playerId={starter.player.id} name={starter.player.full_name} context={leagueCardContext(leagueId)} className="text-[11px] font-semibold text-ink" />
            </div>
            <div className={cn('mt-0.5 flex min-w-0 items-center gap-1', mirror && 'flex-row-reverse')}>
              <PositionBadge position={starter.player.position} size="sm" className="shrink-0" />
              <span className="truncate text-[10px] font-medium text-n-6">{[starter.player.nfl_team ?? '—', opp].filter(Boolean).join(' · ')}</span>
            </div>
            {(kickoff || state || line) && (
              <div className="truncate text-[10px] font-medium text-n-6" title={kickoff?.title ?? undefined}>
                {[kickoff?.local, state, line].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </>
      ) : (
        <span className={cn('min-w-0 flex-1 text-[11px] font-medium text-n-6', mirror && 'text-right')}>Empty</span>
      )}
      <div className={cn('flex shrink-0 flex-col', mirror ? 'items-start' : 'items-end')}>
        <span
          className={cn('fs-num text-[12px] font-bold', cell.tone === 'scored' ? 'text-ink' : 'text-n-3')}
          title={cell.title ?? undefined}
          data-starter-cell={cell.tone}
        >
          {cell.text}
        </span>
        {projText && (
          <span className={cn('fs-num text-[9px] font-semibold', PROJ_TEXT)} data-proj>
            {projText}
          </span>
        )}
      </div>
    </div>
  )
}

function BenchCellView({ leagueId, row, teamId, mirror = false }: { leagueId: string; row: BenchRow; teamId: string; mirror?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', mirror && 'flex-row-reverse')} data-bench-row={row.player_id} data-side-of={teamId}>
      {row.player ? (
        <>
          <PlayerFace player={row.player} />
          <div className={cn('min-w-0 flex-1', mirror && 'text-right')}>
            <div className="truncate leading-tight">
              <PlayerLink playerId={row.player.id} name={row.player.full_name} context={leagueCardContext(leagueId)} className="text-[11px] font-semibold text-ink" />
            </div>
            <div className={cn('mt-0.5 flex min-w-0 items-center gap-1', mirror && 'flex-row-reverse')}>
              <PositionBadge position={row.player.position} size="sm" className="shrink-0" />
              <span className="truncate text-[10px] font-medium text-n-6">{row.player.nfl_team ?? '—'}</span>
              {row.ir && <span className="shrink-0 text-[9px] font-bold text-negative-strong">IR</span>}
            </div>
          </div>
        </>
      ) : (
        <span className={cn('min-w-0 flex-1 text-[11px] font-medium text-n-6', mirror && 'text-right')}>Player no longer on this roster</span>
      )}
      <span className={cn('fs-num shrink-0 text-[11px] font-semibold', row.cell.tone === 'scored' ? 'text-n-2' : 'text-n-6')} title={row.cell.title ?? undefined} data-bench-cell={row.cell.tone}>
        {row.cell.text}
      </span>
    </div>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}


// ---------------------------------------------------------------------------
// Empty / skeleton (§16.5.4)
// ---------------------------------------------------------------------------

function EmptyCard({ copy, ...rest }: { copy: string } & Record<string, unknown>) {
  return (
    <Card {...rest}>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Icon name="calendar" size={18} className="text-n-6" />
        <p className="max-w-md text-[11px] font-medium text-n-6">{copy}</p>
      </CardContent>
    </Card>
  )
}

function MatchupSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <LeaguePageTitle title="Matchups" />
      <Skeleton className="h-btn-sm w-48 rounded-pill bg-surface-control" />
      <BodySkeleton />
    </div>
  )
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-3" data-skeleton="matchup">
      <Skeleton className="h-28 rounded-2xl bg-surface-control" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-48 rounded-2xl bg-surface-control" />
        <Skeleton className="h-48 rounded-2xl bg-surface-control" />
      </div>
    </div>
  )
}
