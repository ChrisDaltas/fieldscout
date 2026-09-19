'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useBoxScore } from '@/hooks/use-box-score'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { useSchedule, type ScheduleWeek } from '@/hooks/use-schedule'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { BoxStarter } from '@/lib/leagues/api/box-score-service'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'

import { Crest, TeamNameLink } from './league-cells'
import { scoringLive } from './league-home-season-ops'
import { formatInstantWithDate, formatKickoff } from './lineup-editor-ops'
import {
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
  groupByPhase,
  leaderboardRows,
  lineSummary,
  medianRow,
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
} from './matchup-view-ops'
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
    <PageHeader
      title="Matchups"
      actions={
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}`}>
            <Icon name="cup" size={13} />
            {detail.league.name}
          </Link>
        </Button>
      }
    />
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
      <span className="text-h5 text-ink" data-week={week}>
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

  if (!selected) {
    return <EmptyCard copy={emptyWeekCopy(doc.week, weeks, detail.settings.regular_season_weeks)} data-empty="no-matchups" />
  }

  return (
    <div className="flex flex-col gap-4" data-variant="h2h">
      <Scoreboard doc={doc} row={selected} settings={settings} myTeamId={myTeamId} badge={false} />

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

      <div className="grid gap-4 md:grid-cols-2">
        <TeamBox leagueId={leagueId} week={doc.week} teamId={selected.home_team_id} name={teamName(doc, selected.home_team_id)} leagueTimeZone={leagueTimeZone} />
        {selected.away_team_id ? (
          <TeamBox leagueId={leagueId} week={doc.week} teamId={selected.away_team_id} name={teamName(doc, selected.away_team_id)} leagueTimeZone={leagueTimeZone} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-[13px]">Bye</CardTitle>
            </CardHeader>
            <CardContent className="px-card-pad py-3 text-[12px] font-medium text-n-3">No opponent this week.</CardContent>
          </Card>
        )}
      </div>

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
 * The head-to-head scoreboard card — ONE component, two mounts: the matchup
 * page (where the week strip already carries the week badge, so `badge` is
 * off — F277(c)) and the league home's matchup-of-the-week hero (L.D5.4 /
 * F46, where the card is the only badge site and `title` names the week).
 * Exported for that second mount; never forked.
 */
export function Scoreboard({
  doc,
  row,
  settings,
  myTeamId,
  badge: showBadge = true,
  title,
  children,
}: {
  doc: WeekMatchups
  row: MatchupRow
  settings: { median_game: boolean; second_opponent: boolean }
  myTeamId: string | null
  /** Render the §16.5.4 week badge in the card header (off where a week
   *  strip already shows it — F277(c)). */
  badge?: boolean
  /** The card's title — defaults to "Matchup" / "Playoff matchup". */
  title?: string
  /** Trailing header content (the hero's "Open matchup" link). */
  children?: ReactNode
}) {
  const badge = weekBadge(doc.league_week.status)
  return (
    <Card className="min-w-0 overflow-hidden" data-matchup={row.id} data-matchup-status={row.status}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          <span>{title ?? (row.round_type === 'playoff' ? 'Playoff matchup' : 'Matchup')}</span>
          {showBadge && (
            <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
              {badge.label}
            </Badge>
          )}
          {row.is_overridden && (
            <Badge variant="stroke-purple" title={OVERRIDDEN_TITLE} data-overridden>
              {OVERRIDDEN_LABEL}
            </Badge>
          )}
          {children && <span className="ml-auto">{children}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-card-pad py-3 sm:grid-cols-2">
        <Side doc={doc} row={row} teamId={row.home_team_id} score={row.home_score} settings={settings} mine={row.home_team_id === myTeamId} />
        {row.away_team_id ? (
          <Side doc={doc} row={row} teamId={row.away_team_id} score={row.away_score} settings={settings} mine={row.away_team_id === myTeamId} />
        ) : (
          <div className="flex items-center gap-2 rounded-sm border border-dashed border-n-3 px-3 py-2 text-[12px] font-medium text-n-3" data-side="bye">
            Bye — no opponent this week.
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
  settings,
  mine,
}: {
  doc: WeekMatchups
  row: MatchupRow
  teamId: string
  score: number | null
  settings: { median_game: boolean; second_opponent: boolean }
  mine: boolean
}) {
  const name = teamName(doc, teamId)
  const cell = scoreCell(score, row.status)
  const h2h = resultChip(sideResult(row, teamId, doc.results))
  const median = medianRow(doc, teamId, settings.median_game)
  const second = secondChip(doc, teamId, settings.second_opponent)
  return (
    // The viewer's own side is a resting FILL, never a shadow (CLAUDE.md).
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-sm border border-ink px-3 py-2', mine && 'bg-accent-soft')} data-side={teamId} data-mine={mine || undefined}>
      <div className="flex items-center gap-2">
        <Crest name={name} src={null} />
        {/* The name is the door to that franchise's page (§16.1) — the CREST
            stays outside the anchor so the link's accessible name is the team
            and not its initials twice over. `doc.league_id` is the document's
            own league; nothing is threaded. */}
        <TeamNameLink name={name} leagueId={doc.league_id} teamId={teamId} className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink" />
        {h2h.decided && (
          <Badge variant={h2h.variant} title={h2h.title} data-result={h2h.text}>
            {h2h.text}
          </Badge>
        )}
      </div>
      <p
        className={cn('fs-num text-h3', cell.pending ? 'text-n-3' : 'text-ink')}
        title={cell.title ?? undefined}
        data-score={cell.pending ? 'pending' : cell.text}
      >
        {cell.text}
      </p>
      {median && (
        <div className="flex items-center justify-between gap-2 border-t border-n-4 pt-1.5 text-[11px] font-medium" data-median-row>
          <span className="text-n-3">{MEDIAN_ROW_LABEL}</span>
          <span className="flex items-center gap-1.5">
            <span className="fs-num text-ink" title={median.median === null ? MEDIAN_PENDING_TITLE : undefined}>
              {median.median === null ? '—' : formatPoints(median.median)}
            </span>
            <ResultBadge result={median.result} data-median-result />
          </span>
        </div>
      )}
      {second && (
        <div className="flex items-center justify-between gap-2 border-t border-n-4 pt-1.5 text-[11px] font-medium" data-second-chip>
          <span className="text-n-3">
            {SECOND_CHIP_LABEL} · {teamName(doc, second.opponent_team_id)}
          </span>
          <span className="flex items-center gap-1.5">
            {second.score !== null && second.opponent_score !== null && (
              <span className="fs-num text-ink">
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
    <Card data-matchup-list={title}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-n-4 px-0 py-0">
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
                className={cn('min-w-0 flex-1 truncate text-[12px] font-bold', mine && 'text-accent-strong')}
              />
              <span className="fs-num shrink-0 text-[12px] font-medium" title={home.title ?? undefined}>
                {home.text}
              </span>
              <span className="text-[10px] font-bold text-n-3">–</span>
              <span className="fs-num shrink-0 text-[12px] font-medium" title={away.title ?? undefined}>
                {m.away_team_id ? away.text : '—'}
              </span>
              {/* A bye row has no away id — `teamName` renders the literal
                  "Bye", which must stay non-interactive text. */}
              <TeamNameLink
                name={teamName(doc, m.away_team_id)}
                leagueId={doc.league_id}
                teamId={doorId(m.away_team_id)}
                className={cn('min-w-0 flex-1 truncate text-right text-[12px] font-bold', mine && 'text-accent-strong')}
              />
              {m.is_overridden && (
                <Badge variant="stroke-purple" title={OVERRIDDEN_TITLE} className="shrink-0">
                  ✸
                </Badge>
              )}
            </>
          )
          const className = cn('flex items-center gap-2 px-card-pad py-2', linkable && 'transition-colors hover:bg-accent-soft')
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
      <Card data-leaderboard>
        <CardHeader className="min-h-0 py-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
            {LEADERBOARD_TITLE}
            <Badge variant="stroke">Total points</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-n-4 px-0 py-0">
          {rows.length === 0 && <p className="px-card-pad py-3 text-[12px] font-medium text-n-3">{NO_LEADERBOARD_ROWS_COPY}</p>}
          {rows.map((row) => (
            <button
              key={row.team_id}
              type="button"
              onClick={() => setPicked(row.team_id)}
              aria-pressed={row.team_id === selectedId}
              className={cn(
                'flex w-full items-center gap-2 px-card-pad py-2 text-left transition-colors hover:bg-accent-soft',
                row.team_id === selectedId && 'bg-accent-soft',
              )}
              data-leaderboard-row={row.team_id}
              data-rank={row.rank ?? 'pending'}
            >
              <span className="fs-num w-6 shrink-0 text-right text-[12px] font-bold">{row.rank ?? '—'}</span>
              <Crest name={row.name} src={null} />
              <span className={cn('min-w-0 flex-1 truncate text-[12px] font-bold', row.team_id === myTeamId && 'text-accent-strong')}>{row.name}</span>
              {row.points !== null ? (
                <span className="fs-num shrink-0 text-[13px] font-bold text-ink">{formatPoints(row.points)}</span>
              ) : (
                <span className="shrink-0 text-[12px] font-medium text-n-3" title="No scoring batch has reached this team yet — an absent row is not a score.">
                  pending
                </span>
              )}
              <Badge variant={row.is_final ? 'black' : 'stroke'} className="shrink-0" title={row.is_final ? 'Final' : 'Provisional — the week has not finalized.'}>
                {row.is_final ? 'Final' : 'Live'}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>
      {selectedId && (
        <TeamBox leagueId={leagueId} week={doc.week} teamId={selectedId} name={teamName(doc, selectedId)} leagueTimeZone={leagueTimeZone} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The box — one team's starters in Live Mode's three groups
// ---------------------------------------------------------------------------

function TeamBox({
  leagueId,
  week,
  teamId,
  name,
  leagueTimeZone,
}: {
  leagueId: string
  week: number
  teamId: string
  name: string
  leagueTimeZone: string | null
}) {
  const box = useBoxScore(leagueId, week, teamId)
  const problem = box.isError ? (box.error instanceof Error ? box.error : new Error(String(box.error))) : null
  const data = box.data
  // No lineup ⇒ no sum to speak of (the empty state says why), not `pending`.
  const sum = data && data.lineup ? boxSumCell(data) : null

  return (
    <Card className="min-w-0 overflow-hidden" data-box={teamId}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          <Crest name={name} src={null} className="h-5 w-5" />
          {/* A box score is where an empty lineup is actually noticed, so the
              name above the starters is the door to the lineup editor. */}
          <TeamNameLink name={name} leagueId={leagueId} teamId={teamId} className="min-w-0 flex-1 truncate" />
          {sum && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-n-3" title={sum.title ?? undefined}>
              {BOX_SUM_LABEL}
              <span className={cn('fs-num font-bold', sum.pending ? 'text-n-3' : 'text-ink')} data-box-sum={sum.pending ? 'pending' : sum.text}>
                {sum.text}
              </span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-2">
        {problem && data && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
        {box.isPending ? (
          <div className="flex flex-col gap-1.5" data-skeleton="box">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 rounded-sm" />
            ))}
          </div>
        ) : problem && !data ? (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-box-error>
            <p className="text-[12px] font-bold">Couldn’t load this box score.</p>
            <p className="text-[11px] font-medium text-n-3">{problemCopy(problem)}</p>
            <Button variant="stroke" size="sm" onClick={() => box.refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : data ? (
          data.lineup === null ? (
            <p className="text-[12px] font-medium text-n-3" data-empty="no-lineup">
              {NO_LINEUP_COPY}
            </p>
          ) : data.starters.every((s) => s.reason === 'empty') ? (
            <p className="text-[12px] font-medium text-n-3" data-empty="no-starters">
              {NO_STARTERS_COPY}
            </p>
          ) : (
            groupByPhase(data.starters).map((group) => (
              <section key={group.phase} className="flex flex-col gap-1" data-phase={group.phase}>
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-n-3">{group.label}</h4>
                {group.starters.map((starter) => (
                  <StarterLine key={starter.slot} starter={starter} leagueTimeZone={leagueTimeZone} />
                ))}
              </section>
            ))
          )
        ) : null}
      </CardContent>
    </Card>
  )
}

function StarterLine({ starter, leagueTimeZone }: { starter: BoxStarter; leagueTimeZone: string | null }) {
  const cell = starterCell(starter)
  const kickoff = starter.game && starter.phase === 'up_next' ? formatKickoff(starter.game.kickoff_at, leagueTimeZone) : null
  const state = starter.phase === 'up_next' ? null : gameStateLine(starter.game)
  const line = lineSummary(starter.line)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5" data-starter={starter.slot} data-starter-reason={starter.reason}>
      <span className="w-9 shrink-0 text-[10px] font-bold text-n-3">{starter.label}</span>
      {starter.player ? (
        <>
          <PositionBadge position={starter.player.position} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[12px] font-bold text-ink">{starter.player.full_name}</span>
              <span className="shrink-0 text-[10px] font-medium text-n-3">{starter.player.nfl_team ?? '—'}</span>
              {kickoff && (
                <span className="fs-num shrink-0 text-[10px] font-medium text-n-3" title={kickoff.title ?? undefined}>
                  {kickoff.local}
                </span>
              )}
            </span>
            {(state || line) && (
              <span className="truncate text-[10px] font-medium text-n-3">{[state, line].filter(Boolean).join(' · ')}</span>
            )}
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 text-[11px] font-medium text-n-3">Empty</span>
      )}
      <span
        className={cn('fs-num shrink-0 text-[12px] font-bold', cell.tone === 'scored' ? 'text-ink' : 'text-n-3')}
        title={cell.title ?? undefined}
        data-starter-cell={cell.tone}
      >
        {cell.text}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty / skeleton (§16.5.4)
// ---------------------------------------------------------------------------

function EmptyCard({ copy, ...rest }: { copy: string } & Record<string, unknown>) {
  return (
    <Card {...rest}>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Icon name="calendar" size={18} className="text-n-3" />
        <p className="max-w-md text-[13px] font-medium text-n-3">{copy}</p>
      </CardContent>
    </Card>
  )
}

function MatchupSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Matchups" />
      <Skeleton className="h-7 w-48 rounded-sm" />
      <BodySkeleton />
    </div>
  )
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-3" data-skeleton="matchup">
      <Skeleton className="h-28 rounded-sm" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-48 rounded-sm" />
        <Skeleton className="h-48 rounded-sm" />
      </div>
    </div>
  )
}
