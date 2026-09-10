'use client'

import Link from 'next/link'
import { useMemo, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueActivityFeed } from '@/hooks/use-league-activity'
import { useLineup } from '@/hooks/use-lineup'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandingsLive } from '@/hooks/use-standings'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import type { PlayoffBracket as PlayoffBracketDoc } from '@/lib/leagues/api/playoffs-service'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { cn } from '@/lib/utils'

import { ActivityFeed } from './activity-feed'
import { Crest, TeamNameLink, teamPageHref } from './league-cells'
import {
  CHAMPION_UNRECORDED_COPY,
  NONE_FOR_TEAM_COPY,
  NO_LADDER_COPY,
  NO_ROWS_COPY,
  NO_SEAT_COPY,
  PLAYOFF_NONE_FOR_TEAM_COPY,
  PLAYOFF_NO_ROWS_COPY,
  championName,
  draftDoors,
  heroMatchup,
  heroWeek,
  leagueNav,
  scoringLive,
  setLineupCopy,
  standingsPeek,
  tradeChip,
  waiverChip,
} from './league-home-season-ops'
import { formatInstantWithDate, formatKickoff } from './lineup-editor-ops'
import { Scoreboard } from './matchup-view'
import { formatPoints, leaderboardRows, weekBadge } from './matchup-view-ops'
import { PlayoffBracket } from './playoff-bracket'
import { BracketSkeleton } from './standings-page'
import { formatRecord, standingsEmptyCopy } from './standings-table-ops'
import { StandingsTable } from './standings-table'
import { LiveStatsDelayedBanner, ReconnectingBanner, STALE_LEAGUE_COPY, STALE_SCORES_COPY, StaleDataBanner } from './status-banners'
import { problemCopy } from './team-page'

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
 * (the trade/waiver chips print the STORED settings and say the verbs are
 * not here yet). The champion is `leagues.champion_team_id`, stored.
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
}: {
  leagueId: string
  data: LeagueDetail
  state: 'in_season' | 'playoffs' | 'complete'
}) {
  const { user } = useAuth()
  const myTeamId = data.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const leagueTimeZone = data.settings.draft.time_zone ?? null
  const schedule = useSchedule(leagueId)
  const week = useMemo(() => heroWeek(schedule.data?.weeks), [schedule.data])
  const inPlay = state !== 'complete'
  const matchups = useMatchupsLive(leagueId, inPlay && week !== null ? week : undefined)
  const standings = useStandingsLive(leagueId)
  const lineup = useLineup(myTeamId ?? undefined, inPlay && week !== null ? week : undefined)
  const degraded = useStatsDegraded({ enabled: inPlay && scoringLive(matchups.data?.league_week.status) })
  // Provider degradation (122) OR a stalled score-week drain (124) — one
  // banner, because "scores show the last update we received" is true of both.
  const delay = liveScoringDelay(degraded.data)
  // L.D5.5: the bracket card on the `playoffs` hero — the SAME component the
  // standings page's "Playoffs" tab mounts (§16.5.1's playoffs row: "L.D5.5's
  // tab carries the full bracket"); fetched only in that state.
  const bracket = usePlayoffBracketLive(leagueId, state === 'playoffs')

  const connection =
    matchups.connection === 'reconnecting' || standings.connection === 'reconnecting' || bracket.connection === 'reconnecting'
      ? 'reconnecting'
      : 'live'
  const matchupsProblem = matchups.isError ? (matchups.error instanceof Error ? matchups.error : new Error(String(matchups.error))) : null

  return (
    <div className="flex flex-col gap-4" data-season-hero={state}>
      <LeagueNav leagueId={leagueId} myTeamId={myTeamId} />

      {connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {matchupsProblem && matchups.data && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
      {inPlay && delay.delayed && (
        <LiveStatsDelayedBanner since={delay.since ? formatInstantWithDate(delay.since, leagueTimeZone).local : null} />
      )}

      {state === 'complete' ? (
        <ChampionBanner data={data} />
      ) : (
        <MatchupOfTheWeek
          leagueId={leagueId}
          data={data}
          state={state}
          week={week}
          scheduleState={schedule.isPending ? 'pending' : schedule.isError ? 'error' : 'ready'}
          onScheduleRetry={() => schedule.refetch()}
          matchups={matchups.data}
          matchupsPending={matchups.isPending}
          matchupsProblem={matchupsProblem}
          onMatchupsRetry={() => matchups.refetch()}
          myTeamId={myTeamId}
        />
      )}

      {/* R900 (#270): both column grids below use minmax(0, …fr) — a bare `fr` track floors at
          min-content, so one long feed line (E43 / a remix / a lineup reason) grew the column to
          its nowrap width and pushed the R281 doors off-screen; minmax(0) keeps the share and lets
          `truncate` do its job. Pinned in league-home-season.render.test.ts. */}
      {inPlay ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <SetLineupCard
            leagueId={leagueId}
            data={data}
            myTeamId={myTeamId}
            week={week}
            lineup={week === null ? null : lineup.isPending ? undefined : lineup.data}
            leagueTimeZone={leagueTimeZone}
          />
          <StandingsPeekCard
            leagueId={leagueId}
            doc={standings.data}
            pending={standings.isPending}
            problem={standings.isError ? standings.error : null}
            onRetry={() => standings.refetch()}
            myTeamId={myTeamId}
          />
        </div>
      ) : (
        <FinalStandingsCard
          leagueId={leagueId}
          data={data}
          doc={standings.data}
          pending={standings.isPending}
          problem={standings.isError ? standings.error : null}
          onRetry={() => standings.refetch()}
          myTeamId={myTeamId}
        />
      )}

      {state === 'playoffs' && (
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
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ActivityFeedCard leagueId={leagueId} data={data} />
        <DraftDoorsCard leagueId={leagueId} complete={state === 'complete'} />
      </div>
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
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          Playoff bracket
          <span className="ml-auto">
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/standings?tab=playoffs`} data-open-bracket>
                Full bracket
              </Link>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
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

// ---------------------------------------------------------------------------
// The league nav — the in-season pages, one row (F251(c) / F253(c) / F275(c))
// ---------------------------------------------------------------------------

function LeagueNav({ leagueId, myTeamId }: { leagueId: string; myTeamId: string | null }) {
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="League pages" data-league-nav>
      {leagueNav(leagueId, myTeamId).map((item) => (
        <Button key={item.key} variant="stroke" size="sm" asChild>
          <Link href={item.href} data-nav={item.key}>
            {item.label}
          </Link>
        </Button>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// The matchup of the week — L.D5.2's Scoreboard, pointed at the current week
// ---------------------------------------------------------------------------

function MatchupOfTheWeek({
  leagueId,
  data,
  state,
  week,
  scheduleState,
  onScheduleRetry,
  matchups,
  matchupsPending,
  matchupsProblem,
  onMatchupsRetry,
  myTeamId,
}: {
  leagueId: string
  data: LeagueDetail
  state: 'in_season' | 'playoffs'
  week: number | null
  scheduleState: 'pending' | 'error' | 'ready'
  onScheduleRetry: () => void
  matchups: WeekMatchups | undefined
  matchupsPending: boolean
  matchupsProblem: Error | null
  onMatchupsRetry: () => void
  myTeamId: string | null
}) {
  if (scheduleState === 'pending' || (week !== null && matchupsPending && !matchups)) {
    return <Skeleton className="h-36 rounded-sm" data-skeleton="matchup-of-the-week" />
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

  const badge = weekBadge(matchups.league_week.status)
  const title = `Week ${week}`
  const openHref = `/app/leagues/${leagueId}/matchup?week=${week}`

  if (matchups.schedule_mode === 'total_points') {
    return <WeekSoFar leagueId={leagueId} doc={matchups} myTeamId={myTeamId} title={title} />
  }

  const hero = heroMatchup(matchups.matchups, myTeamId)
  if (hero.kind === 'mine') {
    return (
      <Scoreboard
        doc={matchups}
        row={hero.row}
        settings={{ median_game: data.settings.median_game, second_opponent: data.settings.second_opponent }}
        myTeamId={myTeamId}
        title={`${title} · ${hero.row.round_type === 'playoff' ? 'Playoff matchup' : 'Your matchup'}`}
      >
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}/matchup/${hero.row.id}`} data-open-matchup>
            Open matchup
          </Link>
        </Button>
      </Scoreboard>
    )
  }
  const copy =
    hero.kind === 'no_seat'
      ? NO_SEAT_COPY
      : hero.kind === 'no_rows'
        ? state === 'playoffs'
          ? PLAYOFF_NO_ROWS_COPY
          : NO_ROWS_COPY
        : state === 'playoffs'
          ? PLAYOFF_NONE_FOR_TEAM_COPY
          : NONE_FOR_TEAM_COPY
  return (
    <EmptyCard title={title} copy={copy} badge={badge} data-empty={hero.kind}>
      <Button variant="stroke" size="sm" asChild>
        <Link href={openHref}>See the week</Link>
      </Button>
    </EmptyCard>
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
    <Card data-variant="total_points" data-week-so-far>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          {title} · Your week so far vs the field
          <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
            {badge.label}
          </Badge>
          <span className="ml-auto">
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/matchup`}>Open leaderboard</Link>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-n-4 px-0 py-0">
        {shown.length === 0 && <p className="px-card-pad py-3 text-[12px] font-medium text-n-3">No scores yet this week.</p>}
        {shown.map((row) => (
          <div key={row.team_id} className={cn('flex items-center gap-2 px-card-pad py-2', row.team_id === myTeamId && 'bg-accent-soft')} data-leaderboard-row={row.team_id}>
            <span className="fs-num w-6 shrink-0 text-right text-[12px] font-bold">{row.rank ?? '—'}</span>
            <Crest name={row.name} src={null} />
            {/* A total-points league has no matchup rows at all (§16.5.3), so
                this leaderboard is that league's only team list on the home
                page — and a plain <div> row, so the name links cleanly. */}
            <TeamNameLink name={row.name} leagueId={leagueId} teamId={row.team_id} className="min-w-0 flex-1 truncate text-[12px] font-bold" />
            {row.points !== null ? (
              <span className="fs-num shrink-0 text-[13px] font-bold text-ink">{formatPoints(row.points)}</span>
            ) : (
              <span className="shrink-0 text-[12px] font-medium text-n-3">pending</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
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
  const waivers = waiverChip(data.settings)
  const trades = tradeChip(data.settings)
  return (
    <Card data-set-lineup>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">Your team</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        {myTeamId ? (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="blue" size="sm" shadow asChild>
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
            <p className="text-[11px] font-medium text-n-3" data-lock-record title={locksAt?.title ?? undefined}>
              {week !== null && (
                <>
                  Week <span className="fs-num">{week}</span> ·{' '}
                </>
              )}
              {setLineupCopy(lineup, locksAt?.local ?? null)}
            </p>
          </>
        ) : (
          <p className="text-[12px] font-medium text-n-3" data-empty="no-seat">
            {NO_SEAT_COPY}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5" data-honest-chips>
          <Badge variant="stroke" title={waivers.title} data-chip="waivers">
            {waivers.label}
          </Badge>
          <Badge variant="stroke" title={trades.title} data-chip="trades">
            {trades.label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The standings peek — a slice of 117's document
// ---------------------------------------------------------------------------

function StandingsPeekCard({
  leagueId,
  doc,
  pending,
  problem,
  onRetry,
  myTeamId,
}: {
  leagueId: string
  doc: ReturnType<typeof useStandingsLive>['data']
  pending: boolean
  problem: unknown
  onRetry: () => void
  myTeamId: string | null
}) {
  return (
    <Card data-standings-peek>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          Standings
          <span className="ml-auto">
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/standings`}>Full standings</Link>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-2">
        {problem != null && doc && <StaleDataBanner>{STALE_SCORES_COPY}</StaleDataBanner>}
        {pending && !doc ? (
          <div className="flex flex-col gap-1.5" data-skeleton="standings-peek">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-6 rounded-sm" />
            ))}
          </div>
        ) : problem != null && !doc ? (
          <InlineProblem title="Couldn’t load the standings." detail={problemCopy(problem)} onRetry={onRetry} inline />
        ) : doc ? (
          <StandingsPeek doc={doc} myTeamId={myTeamId} />
        ) : null}
      </CardContent>
    </Card>
  )
}

function StandingsPeek({ doc, myTeamId }: { doc: NonNullable<ReturnType<typeof useStandingsLive>['data']>; myTeamId: string | null }) {
  const peek = standingsPeek(doc, myTeamId)
  const emptyCopy = standingsEmptyCopy(doc)
  return (
    <div className="flex flex-col gap-1.5">
      {/* 117's own reason over the rows — a stored 0 is a stored 0 and the
          reason is what says "nothing final yet" (never inferred from the
          zeros). */}
      {emptyCopy && (
        <p role="status" className="text-[11px] font-medium text-n-3" data-standings-reason={doc.reason ?? ''}>
          {emptyCopy}
        </p>
      )}
      <ol className="flex flex-col divide-y divide-n-4" data-peek-rows>
        {peek.rows.map((row, i) => (
          <li key={row.team_id}>
            {peek.elided && i === peek.rows.length - 1 && (
              <div className="py-0.5 text-center text-[10px] font-bold text-n-3" data-peek-elided>
                ⋯
              </div>
            )}
            <div className={cn('flex items-center gap-2 py-1.5', row.team_id === myTeamId && 'bg-accent-soft')} data-peek-row={row.team_id}>
              <span className="fs-num w-5 shrink-0 text-right text-[12px] font-bold">{row.rank}</span>
              <Crest name={row.name} src={null} />
              <TeamNameLink name={row.name} leagueId={doc.league_id} teamId={row.team_id} className="min-w-0 flex-1 truncate text-[12px] font-bold" />
              <span className="fs-num shrink-0 text-[11px] font-medium">{formatRecord(row)}</span>
              <span className="fs-num w-14 shrink-0 text-right text-[11px] font-medium text-n-3">{formatPoints(row.points_for)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[10px] font-medium text-n-3">
        <span className="fs-num">{peek.weeksFinal}</span> week{peek.weeksFinal === 1 ? '' : 's'} final · PF
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// complete — the champion banner + the final table (§16.5.1's last row)
// ---------------------------------------------------------------------------

function ChampionBanner({ data }: { data: LeagueDetail }) {
  const champion = championName(data)
  return (
    <Card className={cn(champion && 'bg-brand')} data-champion={champion ?? 'unrecorded'}>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Icon name="cup" size={20} className="text-ink" />
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-n-3">
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
          <p className="max-w-md text-[13px] font-medium text-n-3">{CHAMPION_UNRECORDED_COPY}</p>
        )}
      </CardContent>
    </Card>
  )
}

function FinalStandingsCard({
  leagueId,
  data,
  doc,
  pending,
  problem,
  onRetry,
  myTeamId,
}: {
  leagueId: string
  data: LeagueDetail
  doc: ReturnType<typeof useStandingsLive>['data']
  pending: boolean
  problem: unknown
  onRetry: () => void
  myTeamId: string | null
}) {
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  return (
    <Card data-final-standings>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          Final standings
          <span className="ml-auto">
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/standings`}>Standings page</Link>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-card-pad py-2">
        {problem != null && doc && <StaleDataBanner className="mb-2">{STALE_SCORES_COPY}</StaleDataBanner>}
        {pending && !doc ? (
          <div className="flex flex-col gap-1.5" data-skeleton="final-standings">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-sm" />
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
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Activity (§16.5.1's "activity feed") and the post-draft doors (R281)
// ---------------------------------------------------------------------------

function ActivityFeedCard({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const feed = useLeagueActivityFeed(leagueId, { limit: 8 })
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  return (
    <ActivityFeed
      leagueId={leagueId}
      items={feed.data?.items}
      pending={feed.isPending}
      problem={feed.isError ? feed.error : null}
      onRetry={() => feed.refetch()}
      teamNames={teamNames}
      leagueTimeZone={data.settings.draft.time_zone ?? null}
    />
  )
}

/** The two post-draft doors (F46 / R281): the draft record and the practice
 *  launcher, which post-draft is purely the resume/recap list surface (071
 *  refuses a new launch). §16.5.1's `complete` row prints "View History ·
 *  season recap" — History Mode is a later milestone's page, so the recap
 *  IS the season's record for now and the door says so. */
function DraftDoorsCard({ leagueId, complete }: { leagueId: string; complete: boolean }) {
  const doors = draftDoors(leagueId)
  return (
    <Card data-draft-doors>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">{complete ? 'History' : 'Draft'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 px-card-pad py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant={complete ? 'blue' : 'stroke'} size="sm" shadow={complete} asChild>
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
        <p className="text-[10px] font-semibold text-n-3">
          {complete
            ? 'The season recap is the draft record for now — a fuller history view arrives in a later update. Practice drafts you kept stay in the launcher.'
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
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          {title}
          {badge && (
            <Badge variant={badge.variant} title={badge.title} data-week-badge={badge.state}>
              {badge.label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2 px-card-pad py-3">
        <p className="max-w-md text-[12px] font-medium text-n-3">{copy}</p>
        {children}
      </CardContent>
    </Card>
  )
}

function InlineProblem({
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
    <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-problem>
      <p className="text-[12px] font-bold">{title}</p>
      {detail && <p className="text-[11px] font-medium text-n-3">{detail}</p>}
      <Button variant="stroke" size="sm" onClick={onRetry}>
        <Icon name="reset" size={13} /> Retry
      </Button>
    </div>
  )
  return inline ? body : <Card className="border-0 p-0">{body}</Card>
}
