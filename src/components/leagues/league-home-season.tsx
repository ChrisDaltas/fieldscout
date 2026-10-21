'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useCommishLog } from '@/hooks/use-commish-log'
import { useLeagueActivityFeed } from '@/hooks/use-league-activity'
import { useLineup } from '@/hooks/use-lineup'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandingsLive } from '@/hooks/use-standings'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import type { PlayoffBracket as PlayoffBracketDoc } from '@/lib/leagues/api/playoffs-service'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { cn } from '@/lib/utils'

import { ActivityFeed } from './activity-feed'
import { memberNamesOf } from './activity-feed-ops'
import { activityHref } from './activity-page-ops'
import { correctionsHref } from './corrections-view-ops'
import { Crest, TeamNameLink, teamPageHref } from './league-cells'
import {
  CHAMPION_UNRECORDED_COPY,
  NO_LADDER_COPY,
  NO_ROWS_COPY,
  NO_SEAT_COPY,
  PLAYOFF_NO_ROWS_COPY,
  championName,
  draftDoors,
  heroWeek,
  scoringLive,
  setLineupCopy,
  managersByTeam,
  scoreboardTabs,
  type ScoreboardTab,
  tradeChip,
  waiverChip,
} from './league-home-season-ops'
import { formatInstantWithDate, formatKickoff } from './lineup-editor-ops'
import { LeagueMessageBoard } from './league-message-board'
import {
  OVERRIDDEN_LABEL,
  OVERRIDDEN_TITLE,
  formatPoints,
  leaderboardRows,
  resultChip,
  scoreCell,
  sideResult,
  splitRows,
  teamName,
  weekBadge,
} from './matchup-view-ops'
import { PlayoffBracket } from './playoff-bracket'
import { BracketSkeleton } from './standings-page'
import { formatRecord, standingsEmptyCopy } from './standings-table-ops'
import { StandingsTable } from './standings-table'
import { LiveStatsDelayedBanner, ReconnectingBanner, STALE_LEAGUE_COPY, STALE_SCORES_COPY, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'
import { tradesHref } from './trades-ops'

/** v7 League Home vocabulary: 15px bold section titles over hairline lists,
 *  each with an 11px semibold blue "view all" door on the right. */
const SECTION_TITLE = 'text-h6 text-ink'
const SECTION_LINK =
  'shrink-0 text-[11px] font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
/** v7 inner card (Set lineup, draft doors): 14px radius hairline, ~15px pad. */
const CARD_TITLE = 'text-[13px] font-bold tracking-[-0.01em] text-ink'

/**
 * The league home's SEASON heroes — §16.5.1's `in_season` / `playoffs` /
 * `complete` rows (M4 task L.D5.4; the F46 discharge incl. the R281 post-
 * draft doors; PROGRESS D324). Mounted by `league-home-states.tsx` for those
 * three statuses; `LaterPlaceholder` retires for them.
 *
 * **Composes, never re-solves (D11).** The matchup-of-the-week card IS
 * L.D5.2's `Scoreboard` (exported for this second mount); the standings
 * peek is a SLICE of 117's ranked document rendered with the standings
 * table's own formatters; the `complete` hero's final table is
 * `StandingsTable` itself; the activity feed is `ActivityFeed` over
 * L.D4.2's read; the lock record is the lineup row's `locked_at` through
 * the editor's `formatKickoff`. The one week every card points at is the
 * ladder's current week (`heroWeek` — D316(2); the DoD probe pins it).
 *
 * **The client computes nothing** (CLAUDE.md; §23.3 / the F226 posture): no
 * score, no lock, no countdown (Q40 is OPEN — the Set-lineup CTA renders the
 * server's lock RECORD, "Locks from …", and no client-computed countdown;
 * the team page's named placeholder stands), no elimination ("no playoff
 * game on record" is the copy, never "eliminated"), no deadline arithmetic
 * (the trade chip prints the STORED deadline; the waiver chip prints the
 * server's next-run instant — L.D2.13). The champion is `leagues.champion_team_id`, stored.
 *
 * **One room.** `useMatchupsLive` / `useStandingsLive` /
 * `useLeagueActivityFeed` each JOIN the refcounted `league:<id>` room
 * (F233(a) — three subscribers, one channel, never a second `.channel(`);
 * `useStatsDegraded` polls `system_flags` only while the week is scoring
 * (F274 decided here for the second consumer: the poll stands, gated —
 * F277(d)).
 *
 * **§16.5.4 per surface:** skeleton · empty by REASON · error-with-retry ·
 * degraded (the stale banner + last-good cells; the room's reconnecting
 * banner; the "Live stats delayed" banner off the flag). No `dark:`; no
 * resting shadow — the viewer's side is a FILL (the Scoreboard's own).
 */
export function SeasonHero({
  leagueId,
  data,
  state,
  initialBoardTab = null,
}: {
  leagueId: string
  data: LeagueDetail
  state: 'in_season' | 'playoffs' | 'complete'
  /** The scoreboard tab to open on (`'playoffs'` opens the bracket). League
   *  Home opens on the current week; the render tests use this seam. */
  initialBoardTab?: 'playoffs' | null
}) {
  const { user } = useAuth()
  const myTeamId = data.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const leagueTimeZone = data.settings.draft.time_zone ?? null
  const schedule = useSchedule(leagueId)
  const currentWeek = useMemo(() => heroWeek(schedule.data?.weeks), [schedule.data])
  const tabs = useMemo(() => scoreboardTabs(schedule.data?.weeks, currentWeek, state === 'playoffs'), [schedule.data, currentWeek, state])
  const [tabKey, setTabKey] = useState<string | null>(initialBoardTab)
  const activeTab = tabs.find((t) => tabKeyOf(t) === tabKey) ?? tabs[0] ?? null
  const week = activeTab?.kind === 'week' ? activeTab.week : null
  const inPlay = state !== 'complete'
  const matchups = useMatchupsLive(leagueId, inPlay && week !== null ? week : undefined, { fallbackPoll: true })
  const standings = useStandingsLive(leagueId)
  const lineup = useLineup(myTeamId ?? undefined, inPlay && currentWeek !== null ? currentWeek : undefined)
  const degraded = useStatsDegraded({ enabled: inPlay && scoringLive(matchups.data?.league_week.status) })
  // Provider degradation (122) OR a stalled score-week drain (124) — one
  // banner, because "scores show the last update we received" is true of both.
  const delay = liveScoringDelay(degraded.data)
  // The bracket is the scoreboard's "Playoffs" tab — the SAME component the
  // standings page's "Playoffs" tab mounts; fetched only in that state.
  const bracket = usePlayoffBracketLive(leagueId, state === 'playoffs', { fallbackPoll: true })
  const managers = useMemo(() => managersByTeam(data.members), [data.members])

  const connection =
    matchups.connection === 'reconnecting' || standings.connection === 'reconnecting' || bracket.connection === 'reconnecting'
      ? 'reconnecting'
      : 'live'
  const matchupsProblem = matchups.isError ? (matchups.error instanceof Error ? matchups.error : new Error(String(matchups.error))) : null

  const standingsProps = {
    leagueId,
    doc: standings.data,
    pending: standings.isPending,
    problem: standings.isError ? standings.error : null,
    onRetry: () => void standings.refetch(),
    myTeamId,
    managers,
  }

  return (
    <div className="flex flex-col gap-6" data-season-hero={state}>
      {connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {matchupsProblem && matchups.data && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
      {inPlay && delay.delayed && (
        <LiveStatsDelayedBanner since={delay.since ? formatInstantWithDate(delay.since, leagueTimeZone).local : null} />
      )}

      {state === 'complete' && <ChampionBanner data={data} />}

      {/* v7 League Home: 1.7fr / 1fr, gap 27. R900: minmax(0, …fr) so one
          long line never grows a column past its share. */}
      <div className="grid grid-cols-1 items-start gap-[27px] lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-[27px]">
          {inPlay ? (
            <LiveScoreboard
              leagueId={leagueId}
              data={data}
              tabs={tabs}
              activeTab={activeTab}
              onTab={(t) => setTabKey(tabKeyOf(t))}
              scheduleState={schedule.isPending ? 'pending' : schedule.isError ? 'error' : 'ready'}
              onScheduleRetry={() => schedule.refetch()}
              matchups={matchups.data}
              matchupsPending={matchups.isPending}
              matchupsProblem={matchupsProblem}
              onMatchupsRetry={() => matchups.refetch()}
              myTeamId={myTeamId}
              managers={managers}
              bracket={
                <BracketCard
                  leagueId={leagueId}
                  data={data}
                  doc={bracket.data}
                  pending={bracket.isPending}
                  problem={bracket.isError ? bracket.error : null}
                  onRetry={() => bracket.refetch()}
                  myTeamId={myTeamId}
                  finalStandings={standings.data?.standings ?? null}
                />
              }
            />
          ) : (
            <FinalStandingsCard {...standingsProps} data={data} />
          )}
          <ActivityFeedCard leagueId={leagueId} data={data} />
        </div>

        <div className="flex min-w-0 flex-col gap-[27px]">
          {inPlay && <HomeStandingsCard {...standingsProps} week={currentWeek} />}
          {inPlay && (
            <SetLineupCard
              leagueId={leagueId}
              data={data}
              myTeamId={myTeamId}
              week={currentWeek}
              lineup={currentWeek === null ? null : lineup.isPending ? undefined : lineup.data}
              leagueTimeZone={leagueTimeZone}
            />
          )}
          <LeagueMessageBoard leagueId={leagueId} data={data} viewerId={user?.id ?? null} />
          <DraftDoorsCard leagueId={leagueId} complete={state === 'complete'} />
        </div>
      </div>
    </div>
  )
}

function tabKeyOf(tab: ScoreboardTab): string {
  return tab.kind === 'week' ? `week-${tab.week}` : 'playoffs'
}

// ---------------------------------------------------------------------------
// The live scoreboard — the prototype's left column
// ---------------------------------------------------------------------------

function LiveScoreboard({
  leagueId,
  data,
  tabs,
  activeTab,
  onTab,
  scheduleState,
  onScheduleRetry,
  matchups,
  matchupsPending,
  matchupsProblem,
  onMatchupsRetry,
  myTeamId,
  managers,
  bracket,
}: {
  leagueId: string
  data: LeagueDetail
  tabs: ScoreboardTab[]
  activeTab: ScoreboardTab | null
  onTab: (tab: ScoreboardTab) => void
  scheduleState: 'pending' | 'error' | 'ready'
  onScheduleRetry: () => void
  matchups: WeekMatchups | undefined
  matchupsPending: boolean
  matchupsProblem: Error | null
  onMatchupsRetry: () => void
  myTeamId: string | null
  managers: ReadonlyMap<string, string>
  bracket: ReactNode
}) {
  // "● Live" only while the shown week's games are being played.
  const live = activeTab?.kind === 'week' && matchups?.league_week.status === 'live'
  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-live-scoreboard>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('whitespace-nowrap', SECTION_TITLE)}>Live scoreboard</h2>
        {live && (
          <Badge variant="green" data-live-badge>
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-pill bg-current" aria-hidden="true" />
            Live
          </Badge>
        )}
      </div>
      {tabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Segment aria-label="Scoreboard week" data-scoreboard-tabs>
            {tabs.map((t) => (
              <SegmentItem key={tabKeyOf(t)} active={activeTab !== null && tabKeyOf(activeTab) === tabKeyOf(t)} onClick={() => onTab(t)} data-scoreboard-tab={tabKeyOf(t)}>
                {t.label}
              </SegmentItem>
            ))}
          </Segment>
          <span className="text-[10px] font-medium text-n-6">Updates live · no refresh needed</span>
        </div>
      )}
      {activeTab?.kind === 'playoffs' ? (
        bracket
      ) : (
        <ScoreboardWeek
          leagueId={leagueId}
          data={data}
          week={activeTab?.kind === 'week' ? activeTab.week : null}
          scheduleState={scheduleState}
          onScheduleRetry={onScheduleRetry}
          matchups={matchups}
          matchupsPending={matchupsPending}
          matchupsProblem={matchupsProblem}
          onMatchupsRetry={onMatchupsRetry}
          myTeamId={myTeamId}
          managers={managers}
        />
      )}
    </section>
  )
}

function ScoreboardWeek({
  leagueId,
  data,
  week,
  scheduleState,
  onScheduleRetry,
  matchups,
  matchupsPending,
  matchupsProblem,
  onMatchupsRetry,
  myTeamId,
  managers,
}: {
  leagueId: string
  data: LeagueDetail
  week: number | null
  scheduleState: 'pending' | 'error' | 'ready'
  onScheduleRetry: () => void
  matchups: WeekMatchups | undefined
  matchupsPending: boolean
  matchupsProblem: Error | null
  onMatchupsRetry: () => void
  myTeamId: string | null
  managers: ReadonlyMap<string, string>
}) {
  if (scheduleState === 'pending' || (week !== null && matchupsPending && !matchups)) {
    return <Skeleton className="h-36 rounded-xl" data-skeleton="scoreboard" />
  }
  if (scheduleState === 'error') {
    return <InlineProblem title="Couldn’t load the schedule." detail={null} onRetry={onScheduleRetry} />
  }
  if (week === null) {
    return <EmptyCard title="This week" copy={NO_LADDER_COPY} data-empty="no-ladder" />
  }
  if (matchupsProblem && !matchups) {
    return <InlineProblem title="Couldn’t load this week." detail={problemCopy(matchupsProblem)} onRetry={onMatchupsRetry} />
  }
  if (!matchups) return null

  if (matchups.schedule_mode === 'total_points') {
    return <WeekSoFar leagueId={leagueId} doc={matchups} myTeamId={myTeamId} title={`Week ${week}`} />
  }

  const { primary } = splitRows(matchups.matchups)
  if (primary.length === 0) {
    const playoffWeek = data.league.status === 'playoffs'
    return (
      <EmptyCard title={`Week ${week}`} copy={playoffWeek ? PLAYOFF_NO_ROWS_COPY : NO_ROWS_COPY} data-empty="no_rows">
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}/matchup?week=${week}`}>See the week</Link>
        </Button>
      </EmptyCard>
    )
  }
  // The viewer's own game first, then the rest in the stored order.
  const rows = [...primary].sort((a, b) => Number(isMine(b, myTeamId)) - Number(isMine(a, myTeamId)))
  return (
    <ol className="flex flex-col gap-[9px]" data-scoreboard-week={week}>
      {rows.map((row) => (
        <li key={row.id}>
          <ScoreboardMatchup leagueId={leagueId} doc={matchups} row={row} myTeamId={myTeamId} managers={managers} />
        </li>
      ))}
    </ol>
  )
}

function isMine(row: MatchupRow, myTeamId: string | null): boolean {
  return myTeamId !== null && (row.home_team_id === myTeamId || row.away_team_id === myTeamId)
}

/** One compact matchup card: two sides, "vs", Matchup + Box score doors.
 *  No win-probability meter — there is no win-probability source, and the
 *  client never invents one. The leading side is never decided here: a side
 *  goes muted only once the STORED result says it lost. */
function ScoreboardMatchup({
  leagueId,
  doc,
  row,
  myTeamId,
  managers,
}: {
  leagueId: string
  doc: WeekMatchups
  row: MatchupRow
  myTeamId: string | null
  managers: ReadonlyMap<string, string>
}) {
  const href = `/app/leagues/${leagueId}/matchup/${row.id}`
  return (
    <div className="flex min-w-0 flex-col gap-[7px]" data-matchup={row.id} data-matchup-status={row.status}>
      {/* v7's matchup pair: two side tiles with a "vs" disc between them. */}
      <div className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[7px]">
        <ScoreboardSide doc={doc} row={row} teamId={row.home_team_id} score={row.home_score} manager={managers.get(row.home_team_id) ?? null} mine={row.home_team_id === myTeamId} />
        {row.away_team_id ? (
          <ScoreboardSide doc={doc} row={row} teamId={row.away_team_id} score={row.away_score} manager={managers.get(row.away_team_id) ?? null} mine={row.away_team_id === myTeamId} align="end" />
        ) : (
          <p className="flex min-w-0 items-center justify-end rounded-xl border border-n-4 px-3.5 py-3 text-right text-[12px] font-semibold text-n-6" data-side="bye">
            Bye
          </p>
        )}
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-[29px] w-[29px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-control text-[9px] font-bold text-n-6 ring-[3px] ring-white">
          vs
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.is_overridden && (
          <Badge variant="stroke-purple" title={OVERRIDDEN_TITLE} data-overridden>
            {OVERRIDDEN_LABEL}
          </Badge>
        )}
        <span className="ml-auto flex gap-1">
          <Button variant="stroke" size="sm" asChild>
            <Link href={href} data-open-matchup>
              Matchup
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${href}#box-scores`} data-open-box-score>
              Box score
            </Link>
          </Button>
        </span>
      </div>
    </div>
  )
}

function ScoreboardSide({
  doc,
  row,
  teamId,
  score,
  manager,
  mine,
  align = 'start',
}: {
  doc: WeekMatchups
  row: MatchupRow
  teamId: string
  score: number | null
  manager: string | null
  mine: boolean
  align?: 'start' | 'end'
}) {
  const name = teamName(doc, teamId)
  const cell = scoreCell(score, row.status)
  const lost = resultChip(sideResult(row, teamId, doc.results)).text === 'L'
  return (
    <div
      className={cn(
        // The viewer's own side is a resting FILL (never a shadow); the rest
        // sit on the 1px hairline.
        'flex min-w-0 flex-col gap-[9px] rounded-xl border px-3.5 py-3',
        mine ? 'border-transparent bg-accent-soft' : 'border-n-4 bg-white',
        align === 'end' && 'items-end text-right',
      )}
      data-side={teamId}
      data-mine={mine || undefined}
    >
      <div className={cn('flex min-w-0 max-w-full items-center gap-2.5', align === 'end' && 'flex-row-reverse')}>
        <Crest name={name} src={null} className="h-[27px] w-[27px]" />
        <div className="min-w-0">
          <TeamNameLink name={name} leagueId={doc.league_id} teamId={teamId} className="block truncate text-[12px] font-bold tracking-[-0.01em] text-ink" />
          {manager && (
            <span className="block truncate text-[10px] font-medium text-n-6">
              <UsernameLink username={manager} />
            </span>
          )}
        </div>
      </div>
      <p
        className={cn('fs-num text-[20px] font-bold leading-none tracking-[-0.02em]', cell.pending || lost ? 'text-n-6' : 'text-ink')}
        title={cell.title ?? undefined}
        data-score={cell.pending ? 'pending' : cell.text}
      >
        {cell.text}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The bracket card — L.D5.5's component on the playoffs hero (§16.5.1)
// ---------------------------------------------------------------------------

/** The bracket the reads expose, on the `playoffs` hero: 118's document
 *  through `playoff-bracket.tsx` in its compact trim (no commissioner
 *  doors here — the tab carries them), with the door to the full tab.
 *  §16.5.4: skeleton · error-with-retry · degraded (the stale banner over
 *  the last-good bracket). */
function BracketCard({
  leagueId,
  data,
  doc,
  pending,
  problem,
  onRetry,
  myTeamId,
  finalStandings,
}: {
  leagueId: string
  data: LeagueDetail
  doc: PlayoffBracketDoc | undefined
  pending: boolean
  problem: unknown
  onRetry: () => void
  myTeamId: string | null
  finalStandings: LeagueStandings['standings'] | null
}) {
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  return (
    <Card data-bracket-card>
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-0 pt-[13px]">
        <CardTitle className={cn('flex flex-wrap items-center gap-2', CARD_TITLE)}>
          Playoff bracket
          <span className="ml-auto">
            <Link href={`/app/leagues/${leagueId}/standings?tab=playoffs`} className={SECTION_LINK} data-open-bracket>
              Full bracket
            </Link>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-[15px] pb-[15px] pt-2.5">
        {problem !== null && doc && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
        {pending && !doc ? (
          <BracketSkeleton />
        ) : problem !== null && !doc ? (
          <InlineProblem title="Couldn’t load the bracket." detail={problemCopy(problem)} onRetry={onRetry} />
        ) : doc ? (
          <PlayoffBracket
            doc={doc}
            teamNames={teamNames}
            leagueTimeZone={data.settings.draft.time_zone ?? null}
            myRole={data.my_role}
            myTeamId={myTeamId}
            finalStandings={finalStandings}
            compact
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/** §16.5.3: a `total_points` league's hero is "your week so far vs the
 *  field" — the week leaderboard's top rows (stored `team_week_results`,
 *  ranked by the ops; absence is `pending`, never 0) with the viewer's own
 *  row when it sits below. */
function WeekSoFar({ leagueId, doc, myTeamId, title }: { leagueId: string; doc: WeekMatchups; myTeamId: string | null; title: string }) {
  const rows = leaderboardRows(doc)
  const top = rows.slice(0, 4)
  const mine = myTeamId ? rows.find((r) => r.team_id === myTeamId) : undefined
  const shown = mine && !top.some((r) => r.team_id === mine.team_id) ? [...top, mine] : top
  const badge = weekBadge(doc.league_week.status)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-variant="total_points" data-week-so-far>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold tracking-[-0.01em] text-ink">{title} · Your week so far vs the field</span>
        <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
          {badge.label}
        </Badge>
        <span className="ml-auto">
          <Link href={`/app/leagues/${leagueId}/matchup`} className={SECTION_LINK}>
            Open leaderboard
          </Link>
        </span>
      </div>
      <div className="flex flex-col">
        {shown.length === 0 && <p className="border-t border-n-4 py-3 text-[11px] font-medium text-n-6">No scores yet this week.</p>}
        {shown.map((row) => (
          <div
            key={row.team_id}
            className={cn(
              'flex min-h-[34px] items-center gap-2 border-t border-n-4 px-[5px] py-1 text-[11px]',
              row.team_id === myTeamId && 'rounded-md border-transparent bg-accent-soft',
            )}
            data-leaderboard-row={row.team_id}
          >
            <span className="fs-num w-4 shrink-0 text-[10px] font-semibold text-n-6">{row.rank ?? '—'}</span>
            <Crest name={row.name} src={null} className="h-[17px] w-[17px] rounded-[5px]" />
            {/* A total-points league has no matchup rows at all (§16.5.3), so
                this leaderboard is that league's only team list on the home
                page — and a plain <div> row, so the name links cleanly. */}
            <TeamNameLink name={row.name} leagueId={leagueId} teamId={row.team_id} className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink" />
            {row.points !== null ? (
              <span className="fs-num shrink-0 text-[12px] font-bold text-ink">{formatPoints(row.points)}</span>
            ) : (
              <span className="shrink-0 text-[10px] font-medium text-n-6">pending</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Set lineup — the CTA, the server's lock record, the roster-move door, the chips
// ---------------------------------------------------------------------------

function SetLineupCard({
  leagueId,
  data,
  myTeamId,
  week,
  lineup,
  leagueTimeZone,
}: {
  leagueId: string
  data: LeagueDetail
  myTeamId: string | null
  week: number | null
  /** `undefined` while reading; `null` = no row for the week. */
  lineup: { locked_at: string | null } | null | undefined
  leagueTimeZone: string | null
}) {
  const locksAt = lineup?.locked_at ? formatKickoff(lineup.locked_at, leagueTimeZone) : null
  // L.D2.13: the next run from the server's window read, in the viewer's zone.
  const waivers = waiverChip(data.settings, data.waiver_window ?? null, (iso) => formatInstantWithDate(iso, leagueTimeZone).local)
  const trades = tradeChip(data.settings)
  return (
    <Card data-set-lineup>
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-0 pt-[13px]">
        <CardTitle className={CARD_TITLE}>Your team</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-[15px] pb-[15px] pt-2.5">
        {myTeamId ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="blue" size="sm" asChild>
                <Link href={teamPageHref(leagueId, myTeamId)} data-set-lineup-cta>
                  <Icon name="team" size={13} />
                  Set lineup
                </Link>
              </Button>
              <Button variant="stroke" size="sm" asChild>
                <Link href={`/app/leagues/${leagueId}/players`} data-players-cta>
                  <Icon name="plus" size={13} />
                  Add / drop players
                </Link>
              </Button>
            </div>
            {/* R779: the RECORD ("locks from"), never the lock; no countdown
                while its referent is an open question (Q40 — the team page's
                named placeholder carries it). */}
            <p className="text-[10px] font-medium text-n-6" data-lock-record title={locksAt?.title ?? undefined}>
              {week !== null && (
                <>
                  Week <span className="fs-num">{week}</span> ·{' '}
                </>
              )}
              {setLineupCopy(lineup, locksAt?.local ?? null)}
            </p>
          </>
        ) : (
          <p className="text-[11px] font-medium text-n-6" data-empty="no-seat">
            {NO_SEAT_COPY}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5" data-honest-chips>
          <Badge variant="stroke" title={waivers.title} data-chip="waivers">
            {waivers.label}
          </Badge>
          {/* L.D3.7: the trade chip is the door to the trade center. */}
          <Link href={tradesHref(leagueId)} title={trades.title} className="rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" data-trades-link>
            <Badge variant="stroke" className="transition-colors hover:bg-surface-pressed" data-chip="trades">
              <Icon name="transfer" size={11} />
              {trades.label}
            </Badge>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Standings — EVERY team, in 117's order (Chris 2026-10-03: no partial view)
// ---------------------------------------------------------------------------

type StandingsDoc = ReturnType<typeof useStandingsLive>['data']

interface StandingsCardProps {
  leagueId: string
  doc: StandingsDoc
  pending: boolean
  problem: unknown
  onRetry: () => void
  myTeamId: string | null
  managers: ReadonlyMap<string, string>
}

/** The prototype's right-column standings card: rank, crest, team +
 *  manager, W–L(–T), PF — every franchise, never a slice. The viewer's row
 *  is a resting accent-soft FILL, never a shadow. The full table (PA, the
 *  tiebreakers, median / second-game records) is one tap away. */
function HomeStandingsCard({ leagueId, doc, pending, problem, onRetry, myTeamId, managers, week }: StandingsCardProps & { week: number | null }) {
  const emptyCopy = doc ? standingsEmptyCopy(doc) : null
  return (
    // v7's right-column Standings: a bare section — 15px title, 10px grey
    // column heads, 11px hairline rows, the viewer's row an accent-soft fill.
    <div className="flex min-w-0 flex-col gap-2.5" data-home-standings>
      <div className="flex items-center gap-2">
        <span className={SECTION_TITLE}>Standings</span>
        {week !== null && (
          <Badge variant="stroke" data-standings-week>
            Week <span className="fs-num">{week}</span>
          </Badge>
        )}
        <span className="ml-auto">
          <Link href={`/app/leagues/${leagueId}/standings`} className={SECTION_LINK} data-open-standings>
            Full table
          </Link>
        </span>
      </div>
      <div className="flex flex-col">
        {problem != null && doc && <StaleDataBanner className="mb-2">{STALE_SCORES_COPY}</StaleDataBanner>}
        {pending && !doc ? (
          <div className="flex flex-col gap-1.5" data-skeleton="home-standings">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : problem != null && !doc ? (
          <InlineProblem title="Couldn’t load the standings." detail={problemCopy(problem)} onRetry={onRetry} inline />
        ) : doc ? (
          <>
            {/* 117's own reason over the rows — a stored 0 is a stored 0 and
                the reason is what says "nothing final yet". */}
            {emptyCopy && (
              <p role="status" className="pb-2 text-[11px] font-medium text-n-6" data-standings-reason={doc.reason ?? ''}>
                {emptyCopy}
              </p>
            )}
            <div className="flex items-center gap-[9px] px-[5px] pb-[5px] text-[10px] font-semibold text-n-6">
              <span className="w-[15px] shrink-0" />
              <span className="mr-auto">Team</span>
              <span className="shrink-0 text-right">Record</span>
              <span className="w-12 shrink-0 text-right">PF</span>
            </div>
            <ol className="flex flex-col" data-standings-rows={doc.standings.length}>
              {doc.standings.map((row) => {
                const manager = managers.get(row.team_id) ?? null
                const mine = row.team_id === myTeamId
                return (
                  <li
                    key={row.team_id}
                    className={cn(
                      'flex min-h-[31px] items-center gap-[9px] border-t px-[5px] py-1 text-[11px] transition-colors',
                      mine ? 'rounded-md border-transparent bg-accent-soft' : 'border-n-4 hover:bg-surface-sunken',
                    )}
                    data-standings-row={row.team_id}
                  >
                    <span className="fs-num w-[15px] shrink-0 text-[10px] font-semibold text-n-6">{row.rank}</span>
                    <Crest name={row.name} src={null} className="h-[17px] w-[17px] rounded-[5px]" />
                    <div className="mr-auto flex min-w-0 items-baseline gap-1.5">
                      <TeamNameLink name={row.name} leagueId={doc.league_id} teamId={row.team_id} className={cn('min-w-0 truncate text-ink', mine ? 'font-bold' : 'font-semibold')} />
                      {manager && (
                        <span className="min-w-0 truncate text-[10px] font-medium text-n-6">
                          <UsernameLink username={manager} />
                        </span>
                      )}
                    </div>
                    <span className="fs-num shrink-0 text-right font-semibold text-ink">{formatRecord(row)}</span>
                    <span className="fs-num w-12 shrink-0 text-right font-medium text-n-6">{formatPoints(row.points_for)}</span>
                  </li>
                )
              })}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// complete — the champion banner + the final table (§16.5.1's last row)
// ---------------------------------------------------------------------------

function ChampionBanner({ data }: { data: LeagueDetail }) {
  const champion = championName(data)
  return (
    <Card className={cn('border-transparent', champion ? 'bg-brand-soft' : 'bg-surface-sunken')} data-champion={champion ?? 'unrecorded'}>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Icon name="cup" size={20} className={champion ? 'text-brand-strong' : 'text-n-6'} />
        <p className="text-[10px] font-semibold text-n-3">
          <span className="fs-num">{data.league.season}</span> champion
        </p>
        {champion ? (
          // `championName` is non-null only when the STORED id resolved to a
          // team, so the door here can never point at a franchise we could
          // not name.
          <p className="text-h3 text-ink">
            <TeamNameLink name={champion} leagueId={data.league.id} teamId={data.league.champion_team_id} />
          </p>
        ) : (
          <p className="max-w-md text-[11px] font-medium text-n-6">{CHAMPION_UNRECORDED_COPY}</p>
        )}
      </CardContent>
    </Card>
  )
}

function FinalStandingsCard({ leagueId, data, doc, pending, problem, onRetry, myTeamId, managers }: StandingsCardProps & { data: LeagueDetail }) {
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-final-standings>
      <div className="flex items-center gap-2">
        <span className={SECTION_TITLE}>Final standings</span>
        <span className="ml-auto">
          <Link href={`/app/leagues/${leagueId}/standings`} className={SECTION_LINK}>
            Standings page
          </Link>
        </span>
      </div>
      <div className="min-w-0">
        {problem != null && doc && <StaleDataBanner className="mb-2">{STALE_SCORES_COPY}</StaleDataBanner>}
        {pending && !doc ? (
          <div className="flex flex-col gap-1.5" data-skeleton="final-standings">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : problem != null && !doc ? (
          <InlineProblem title="Couldn’t load the standings." detail={problemCopy(problem)} onRetry={onRetry} inline />
        ) : doc ? (
          <StandingsTable
            doc={doc}
            settings={{ median_game: data.settings.median_game, second_opponent: data.settings.second_opponent }}
            teamNames={teamNames}
            highlightTeamId={myTeamId}
            managers={managers}
          />
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity (§16.5.1's "activity feed") and the post-draft doors (R281)
// ---------------------------------------------------------------------------

function ActivityFeedCard({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const feed = useLeagueActivityFeed(leagueId, { limit: 8 })
  // Q66 (spec v2.16.41 §10 / §10.3): every commissioner action is SHOWN in
  // League Home's activity section — this is that read (`GET /commish/log`,
  // any member). Re-read by every commissioner mutation hook on settle; a
  // row is a claim, not proof a verb ran (C70 — `use-commish-log.ts`).
  const log = useCommishLog(leagueId, { limit: COMMISH_LOG_HOME_LIMIT })
  // League Home shows the newest page only (L.E1.32: the log is an infinite
  // query; the Activity page is the one that calls `fetchNextPage`).
  const newest = log.data?.pages[0]
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  return (
    <ActivityFeed
      leagueId={leagueId}
      items={feed.data?.items}
      pending={feed.isPending}
      problem={feed.isError ? feed.error : null}
      onRetry={() => feed.refetch()}
      teamNames={teamNames}
      memberNames={memberNamesOf(data.members)}
      leagueTimeZone={data.settings.draft.time_zone ?? null}
      correctionsHref={correctionsHref(leagueId, null)}
      // L.E1.34 (F371): the short list stays; the whole feed is the Activity page.
      seeAllHref={activityHref(leagueId)}
      commishLog={{
        items: newest?.items,
        pending: log.isPending,
        problem: log.isError ? log.error : null,
        onRetry: () => log.refetch(),
        hasMore: newest?.has_more ?? false,
        moreHref: activityHref(leagueId, { tab: 'commissioner' }),
        memberNames: memberNamesOf(data.members),
      }}
    />
  )
}

/** How many commissioner actions League Home shows (the log pages beyond it). */
const COMMISH_LOG_HOME_LIMIT = 8

/** The two post-draft doors (F46 / R281): the draft record and the practice
 *  launcher, which post-draft is purely the resume/recap list surface (071
 *  refuses a new launch). §16.5.1's `complete` row prints "View History ·
 *  season recap" — History Mode is a later milestone's page, so the recap
 *  IS the season's record for now and the door says so. */
function DraftDoorsCard({ leagueId, complete }: { leagueId: string; complete: boolean }) {
  const doors = draftDoors(leagueId)
  return (
    <Card data-draft-doors>
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-0 pt-[13px]">
        <CardTitle className={CARD_TITLE}>{complete ? 'History' : 'Draft'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 px-[15px] pb-[15px] pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={complete ? 'blue' : 'stroke'} size="sm" asChild>
            <Link href={doors.recap} data-door="recap">
              <Icon name="document" size={13} />
              {complete ? 'View History' : 'Draft recap'}
            </Link>
          </Button>
          <Button variant="stroke" size="sm" asChild>
            <Link href={doors.practice} data-door="practice">
              <Icon name="rocket" size={13} />
              Practice drafts
            </Link>
          </Button>
        </div>
        <p className="text-[10px] font-medium text-n-6">
          {complete
            ? 'The final draft board and every roster as drafted. Practice drafts you kept stay in the launcher.'
            : 'The final board and every roster as drafted; practice drafts you kept stay in the launcher.'}
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Shared states (§16.5.4)
// ---------------------------------------------------------------------------

function EmptyCard({
  title,
  copy,
  badge,
  children,
  ...rest
}: {
  title: string
  copy: string
  badge?: ReturnType<typeof weekBadge>
  children?: ReactNode
} & Record<string, unknown>) {
  return (
    <Card {...rest}>
      <CardContent className="flex flex-col items-center gap-2 px-[15px] py-8 text-center">
        <CardTitle className="flex flex-wrap items-center justify-center gap-2">
          {title}
          {badge && (
            <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
              {badge.label}
            </Badge>
          )}
        </CardTitle>
        <p className="max-w-md text-[11px] font-medium text-n-6">{copy}</p>
        {children}
      </CardContent>
    </Card>
  )
}

/** Exported for the Commissioner Console's second mount (L.E1.33 R1374 —
 *  one error-with-retry block, not a copy). */
export function InlineProblem({
  title,
  detail,
  onRetry,
  inline = false,
}: {
  title: string
  detail: string | null
  onRetry: () => void
  inline?: boolean
}) {
  const body = (
    <div className="flex flex-col items-start gap-2 rounded-xl bg-negative-soft px-3.5 py-3" role="alert" data-problem>
      <p className="text-[12px] font-bold text-ink">{title}</p>
      {detail && <p className="text-[11px] font-medium text-n-3">{detail}</p>}
      <Button variant="stroke" size="sm" onClick={onRetry}>
        <Icon name="reset" size={13} /> Retry
      </Button>
    </div>
  )
  return inline ? body : <Card className="border-0 p-0">{body}</Card>
}
