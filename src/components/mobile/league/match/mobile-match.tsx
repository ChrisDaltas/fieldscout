'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { commishMatchupHref } from '@/components/leagues/activity-page-ops'
import { boxPointsNote, weekMayHaveCorrections } from '@/components/leagues/corrections-view-ops'
import { managersByTeam, scoringLive } from '@/components/leagues/league-home-season-ops'
import { currentWeekOf, formatInstantWithDate, formatKickoff } from '@/components/leagues/lineup-editor-ops'
import {
  BENCH_NOT_COUNTED_COPY,
  BOX_SUM_LABEL,
  EMPTY_BENCH_COPY,
  EMPTY_SEAT_TITLE,
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
  benchNote,
  benchRows,
  benchSlotLabel,
  boxSumCell,
  emptyWeekCopy,
  formatPoints,
  leaderboardRows,
  medianRow,
  pairBench,
  pairSlots,
  resolveWeek,
  resultChip,
  scoreCell,
  secondChip,
  sideResult,
  splitRows,
  starterCell,
  teamName,
  weekBadge,
  weekNav,
  type StarterCell,
} from '@/components/leagues/matchup-view-ops'
import { projectedTotal } from '@/components/leagues/my-team-ops'
import { formatRecord } from '@/components/leagues/standings-table-ops'
import { LIVE_STATS_DELAYED_COPY, STALE_SCORES_COPY } from '@/components/leagues/status-banners'
import { problemCopy } from '@/components/leagues/team-page'
import { MobileLeagueHeader } from '@/components/mobile/league/league/league-header'
import { streakArrowText, streakToneClass, teamStreak, type Streak } from '@/components/mobile/league/streak-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MPosChip, posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { leagueBoxKeys, useBoxScore } from '@/hooks/use-box-score'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { useMobileMatchSwipe } from '@/hooks/use-mobile-match-swipe'
import { useRosters } from '@/hooks/use-rosters'
import { useSchedule, type ScheduleWeek } from '@/hooks/use-schedule'
import { useStandings } from '@/hooks/use-standings'
import { liveScoringDelay, useStatsDegraded } from '@/hooks/use-stats-degraded'
import type { BoxGame, BoxStarter, StarterPhase, TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { MatchupRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'
import { useOverrideMode } from '@/stores/commish-override-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { MobileCorrectionNote } from './match-correction-note'
import {
  BENCH_CHIP,
  cardProjection,
  gameLine,
  isBareMatchHref,
  matchupHref,
  metaTeam,
  orderMatchups,
  pointsDisplay,
  resultWord,
  routeMatchupId,
  shortName,
  sideScore,
  sidesOf,
  slotChipPos,
  slotChipText,
  spotOf,
  spotToRestore,
  teamAvatarClass,
  teamInitial,
  weekHref,
  wrapIndex,
  yetToPlay,
  yetToPlayText,
  type MatchSpot,
} from './match-ops'
import { MobileOverrideTools } from './match-override'
import { useMatchStore } from './match-store'

/**
 * League › Match — the FieldScout Mobile handoff's Match tab
 * (`docs/design/mobile/m-match.md` §2.1–§2.2, §3.1–§3.3), on the app's real
 * week: `useMatchupsLive` (the week's matchups and stored scores, live on the
 * league room), one `useBoxScore` per side (every starter's points / pending /
 * no-line state computed server-side), `league_player_values` projections,
 * the rosters read (bench names, bye weeks) and the standings (records).
 *
 * The whole tab content is one swipe surface — dots, card, "Yet to play",
 * the Starters header and the rows all slide together (§2.2). The swiped
 * matchup is mirrored into the URL (`/matchup/[mid]`, the app's own detail
 * route) with `history.replaceState`, so a reload or Back keeps it.
 *
 * Where the tab was left (the swiped matchup, a non-current week) is kept
 * per league (`match-store.ts`): coming back to Match from another tab or
 * Home restores it, and only a re-tap of Match while it is showing goes
 * back to your matchup and the current week (§3.2 item 7).
 *
 * Each side's meta is "@manager · record streak" (mirrored on the right),
 * the streak ("▼2L" / "▲8W") the one shared count (`streak-ops`, gap list
 * #39) over the schedule's stored final results.
 *
 * Not built because the app has no data for them (each is a reported gap):
 * the win-probability bars and "% win" (no model — the slot carries the
 * stored W/L once decided) and the live-play row (no play-by-play feed). The app-only states and variants are kept in the
 * mobile language: degraded / reconnecting / delayed banners, box errors,
 * no-lineup, bye, playoffs, ✸ Adjusted, League Median / 2nd-opponent
 * results, the box's own Total, the commissioner's override panel,
 * stat-correction notes and the total-points leaderboard week.
 */
export function MobileMatch({
  leagueId,
  matchupId = null,
  weekParam = null,
}: {
  leagueId: string
  matchupId?: string | null
  weekParam?: number | null
}) {
  const league = useLeague(leagueId)
  useForgetOnRetap(leagueId)
  return (
    <MobileScreen header={<MobileLeagueHeader leagueName={league.data?.league.name ?? ''} leagueId={leagueId} />}>
      <div className="pb-5 leading-[normal] tabular-nums" data-mobile-match>
        {league.isPending ? (
          <MatchSkeleton />
        ) : league.isError || !league.data ? (
          <Problem title="Couldn’t load this league." detail={problemCopy(league.error)} onRetry={() => league.refetch()} />
        ) : (
          <MatchContent leagueId={leagueId} matchupId={matchupId} weekParam={weekParam} detail={league.data} />
        )}
      </div>
    </MobileScreen>
  )
}

/** A click on a bare Match link (the dock's Match) while Match is showing
 *  is the re-tap: it forgets where the tab was left, so the navigation it
 *  starts lands on your matchup and the current week. Arriving from another
 *  tab never passes through here — this screen is not mounted then. */
function useForgetOnRetap(leagueId: string) {
  const forget = useMatchStore((s) => s.forget)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (link && isBareMatchHref(link.getAttribute('href'), leagueId)) forget(leagueId)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [leagueId, forget])
}

// ---------------------------------------------------------------------------
// The week — which week, which variant, the honest states
// ---------------------------------------------------------------------------

function MatchContent({
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
  const router = useRouter()
  const pathname = usePathname()
  const schedule = useSchedule(leagueId)

  // Arriving on the bare tab (from another tab, Home, the switcher) brings
  // back where Match was left in this league; any route that names a
  // matchup or a week wins. Held until the route changes — the URL is then
  // brought in line below, so a reload or Back shows the same screen.
  const routeId = routeMatchupId(pathname, leagueId)
  const [restore, setRestore] = useState<MatchSpot | null>(() =>
    routeId || matchupId || weekParam !== null ? null : spotToRestore(useMatchStore.getState().spots[leagueId]),
  )
  const inputs = `${pathname}|${matchupId ?? ''}|${weekParam ?? ''}`
  const [seenInputs, setSeenInputs] = useState(inputs)
  if (inputs !== seenInputs) {
    setSeenInputs(inputs)
    if (restore) setRestore(null)
  }
  useEffect(() => {
    if (!restore) return
    if (restore.matchupId) window.history.replaceState(null, '', matchupHref(leagueId, restore.matchupId))
    else if (restore.week !== null) router.replace(weekHref(leagueId, restore.week), { scroll: false })
  }, [restore, leagueId, router])

  // The route's own matchup first: after a swipe the URL names it while the
  // page props still hold the matchup the page was opened on.
  const shownId = routeId ?? restore?.matchupId ?? matchupId
  const shownWeek = restore ? restore.week : weekParam
  const week = useMemo(
    () => resolveWeek({ matchupId: shownId, weekParam: shownWeek, weeks: schedule.data?.weeks, matchups: schedule.data?.matchups }),
    [shownId, shownWeek, schedule.data],
  )
  const currentWeek = useMemo(() => (schedule.data ? currentWeekOf(schedule.data.weeks) : null), [schedule.data])
  const matchups = useMatchupsLive(leagueId, week ?? undefined)
  // The flag is polled — only a week that is scoring asks (desktop's gate).
  const degraded = useStatsDegraded({ enabled: scoringLive(matchups.data?.league_week.status) })
  const delay = liveScoringDelay(degraded.data)
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const tz = detail.settings.draft.time_zone ?? null
  const weeks = schedule.data?.weeks ?? []

  if (week === null) {
    if (schedule.isPending) return <MatchSkeleton />
    if (schedule.isError) {
      return <Problem title="Couldn’t load the schedule." detail={problemCopy(schedule.error)} onRetry={() => schedule.refetch()} />
    }
    return <EmptyCopy copy={NO_WEEK_COPY} data-empty="no-week" />
  }

  const problem = matchups.isError ? matchups.error : null
  const doc = matchups.data

  return (
    <>
      {matchups.connection === 'reconnecting' && <Strip>Reconnecting — syncing this league…</Strip>}
      {problem && doc && <Strip>{STALE_SCORES_COPY}</Strip>}
      {delay.delayed && (
        <Strip>
          {LIVE_STATS_DELAYED_COPY}
          {delay.since && <span className="opacity-80"> Last update {formatInstantWithDate(delay.since, tz).local}.</span>}
        </Strip>
      )}
      {matchups.isPending ? (
        <MatchSkeleton />
      ) : problem && !doc ? (
        <Problem title="Couldn’t load this week." detail={problemCopy(problem)} onRetry={() => matchups.refetch()} />
      ) : doc ? (
        <>
          {doc.schedule_mode === 'total_points' ? (
            <LeaderboardWeek leagueId={leagueId} doc={doc} detail={detail} weeks={weeks} currentWeek={currentWeek} myTeamId={myTeamId} tz={tz} />
          ) : (
            <HeadToHead
              leagueId={leagueId}
              doc={doc}
              detail={detail}
              weeks={weeks}
              currentWeek={currentWeek}
              matchupId={shownId}
              myTeamId={myTeamId}
              tz={tz}
            />
          )}
        </>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Head to head — the swipe surface
// ---------------------------------------------------------------------------

function HeadToHead({
  leagueId,
  doc,
  detail,
  weeks,
  currentWeek,
  matchupId,
  myTeamId,
  tz,
}: {
  leagueId: string
  doc: WeekMatchups
  detail: LeagueDetail
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  currentWeek: number | null
  /** The matchup to open on — the route's own (`/matchup/<id>`, which a
   *  Back to a swiped matchup restores), else a restored or named one. */
  matchupId: string | null
  myTeamId: string | null
  tz: string | null
}) {
  const pathname = usePathname()
  const ordered = useMemo(() => orderMatchups(splitRows(doc.matchups).primary, myTeamId), [doc.matchups, myTeamId])

  // The selected matchup: the one opened on, then whatever the swipe picked.
  // A navigation that changes the path (the dock's Match → `/matchup`, a
  // week link) re-reads it from the route; our own replaceState lands on the
  // id we already hold, so it changes nothing.
  const [sel, setSel] = useState<string | null>(matchupId)
  const [seenPath, setSeenPath] = useState(pathname)
  if (pathname !== seenPath) {
    setSeenPath(pathname)
    const fromRoute = routeMatchupId(pathname, leagueId)
    if (fromRoute !== sel) setSel(fromRoute)
  }
  const found = sel ? ordered.findIndex((m) => m.id === sel) : -1
  const index = found < 0 ? 0 : found
  const row = ordered[index] ?? null

  const select = (id: string) => {
    setSel(id)
    window.history.replaceState(null, '', matchupHref(leagueId, id))
  }
  // One step through the week's matchups, wrapping — a swipe, or the pager's
  // keyboard / screen-reader buttons.
  const stepBy = (d: 1 | -1) => {
    const next = ordered[wrapIndex(index, d, ordered.length)]
    if (next) select(next.id)
  }
  const swipe = useMobileMatchSwipe({ enabled: ordered.length > 1, onStep: stepBy })

  usePrefetchNeighbours(leagueId, doc.week, ordered, index)

  const status = doc.league_week.status
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  const sides = row ? sidesOf(row, myTeamId) : null
  const boxA = useBoxScore(leagueId, doc.week, sides?.a ?? null)
  const boxB = useBoxScore(leagueId, doc.week, sides?.b ?? null)
  const values = useLeaguePlayerValues(leagueId, doc.season, doc.week)
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null
  const standings = useStandings(leagueId)
  // The schedule read the tab already holds (one cache entry) — the streaks.
  const schedule = useSchedule(leagueId)
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const overrideOn = useOverrideMode(leagueId) && isCommish

  const remember = useMatchStore((s) => s.remember)
  const rowId = row?.id ?? null
  useEffect(() => {
    remember(leagueId, spotOf({ index, matchupId: rowId, week: doc.week, currentWeek }))
  }, [remember, leagueId, index, rowId, doc.week, currentWeek])

  if (!row || !sides) {
    return (
      <>
        <StartersHeader leagueId={leagueId} title="Matchups" week={doc.week} weeks={weeks} status={status} />
        <div className="px-3">
          <EmptyCard copy={emptyWeekCopy(doc.week, weeks, detail.settings.regular_season_weeks)} />
        </div>
      </>
    )
  }

  const live = status === 'live'
  const yetA = boxA.data?.lineup ? yetToPlay(boxA.data.starters) : null
  const yetB = sides.b && boxB.data?.lineup ? yetToPlay(boxB.data.starters) : null
  const recordOf = (teamId: string) => {
    const r = standings.data?.standings.find((s) => s.team_id === teamId)
    return r ? formatRecord(r) : null
  }
  const streakOf = (teamId: string) => (schedule.data ? teamStreak(teamId, schedule.data, detail.league.season) : null)

  return (
    <>
      {overrideOn && (
        <div className="px-3 pt-1.5">
          <MobileOverrideTools
            key={row.id}
            leagueId={leagueId}
            row={row}
            homeName={teamName(doc, row.home_team_id)}
            awayName={row.away_team_id ? teamName(doc, row.away_team_id) : null}
          />
        </div>
      )}
      {/* `clip`, not `hidden`: the translate must not open a sideways scroll
          in the page scroller (§3.2 edge cases) and must not make a new one. */}
      <div className="overflow-x-clip">
        <div {...swipe.handlers} style={swipe.style} className="touch-pan-y select-none" data-match-swipe={row.id}>
          <div className="px-3 pt-1.5">
            {ordered.length > 1 && <Dots doc={doc} rows={ordered} index={index} onStep={stepBy} />}
            <MatchCard
              leagueId={leagueId}
              doc={doc}
              detail={detail}
              row={row}
              a={sides.a}
              b={sides.b}
              myTeamId={myTeamId}
              teamIds={teamIds}
              projA={boxProjection(boxA.data, projOf)}
              projB={boxProjection(boxB.data, projOf)}
              recordOf={recordOf}
              recordsPending={standings.isPending}
              streakOf={streakOf}
              streaksPending={schedule.isPending}
            />
            <ReadProblems
              items={[
                standings.isError && !standings.data ? { key: 'records', text: 'Couldn’t load the records.', retry: () => void standings.refetch() } : null,
                // A failed schedule read must not pass for "no streak" (CLAUDE.md).
                schedule.isError && !schedule.data ? { key: 'streaks', text: 'Couldn’t load the streaks.', retry: () => void schedule.refetch() } : null,
                values.isError && !values.data ? { key: 'projections', text: 'Couldn’t load the projections.', retry: () => void values.refetch() } : null,
              ]}
            />
            {live && yetA && (
              <div className="flex justify-between gap-2 px-1 pt-2.5 text-[11px] font-medium text-m-t3" data-yet-to-play>
                <span className="min-w-0 truncate">{yetToPlayText(yetA.count, yetA.positions)}</span>
                {yetB && <span className="flex-none">{yetToPlayText(yetB.count, null)}</span>}
              </div>
            )}
            {weekMayHaveCorrections(status) && (
              <MobileCorrectionNote leagueId={leagueId} week={doc.week} teamIds={[row.home_team_id, row.away_team_id]} scope="matchup" />
            )}
          </div>
          <StartersHeader leagueId={leagueId} title="Starters" week={doc.week} weeks={weeks} status={status} />
          <Board leagueId={leagueId} doc={doc} a={sides.a} b={sides.b ?? 'bye'} boxA={boxA} boxB={boxB} projOf={projOf} tz={tz} />
        </div>
      </div>
    </>
  )
}

/** The box reads of the matchups either side of the one on screen, so a
 *  swipe lands on rows instead of a skeleton. Plain prefetches — they keep no
 *  query mounted, so the score tick doesn't refetch them. */
function usePrefetchNeighbours(leagueId: string, week: number, ordered: readonly MatchupRow[], index: number) {
  const queryClient = useQueryClient()
  const key = useMemo(() => {
    if (ordered.length < 2) return ''
    const ids = new Set<string>()
    for (const d of [-1, 1]) {
      const r = ordered[wrapIndex(index, d, ordered.length)]
      if (!r) continue
      ids.add(r.home_team_id)
      if (r.away_team_id) ids.add(r.away_team_id)
    }
    return [...ids].sort().join(',')
  }, [ordered, index])
  useEffect(() => {
    if (!key) return
    for (const team of key.split(',')) {
      void queryClient.prefetchQuery({
        queryKey: leagueBoxKeys.team(leagueId, week, team),
        queryFn: () => sendLeagueAction<TeamBoxScore>(`/api/leagues/${leagueId}/matchups/box?week=${week}&team=${team}`),
      })
    }
  }, [queryClient, leagueId, week, key])
}

function boxProjection(data: TeamBoxScore | undefined, projOf: (id: string) => number | null): string | null {
  if (!data?.lineup) return null
  const ids = data.starters.map((s) => s.player?.id ?? null)
  return cardProjection(projectedTotal(ids, projOf), ids.filter(Boolean).length)
}

// ---------------------------------------------------------------------------
// Pager dots (§2.2 A.1) — no label, no arrows; a position indicator only
// (Chris, ruling #23, 2026-10-15: "no tapping, just swiping")
// ---------------------------------------------------------------------------

/** "Matchup 2 of 6: Gridiron Gurus vs Touchdown Tacos" — the pager's
 *  screen-reader status. */
function pagerStatus(doc: Pick<WeekMatchups, 'teams'>, rows: readonly MatchupRow[], index: number): string {
  const row = rows[index]
  const pos = `Matchup ${index + 1} of ${rows.length}`
  return row ? `${pos}: ${teamName(doc, row.home_team_id)} vs ${teamName(doc, row.away_team_id)}` : pos
}

/**
 * Where you are among the week's matchups: one 6px dot each, the current
 * one a 14px pill. The dots are not tappable — swiping the tab is how you
 * move — and are hidden from assistive tech; a polite status names the
 * matchup instead, and speaks again after each move.
 *
 * A swipe needs a pointer, and the tappable dots were the only other way to
 * change matchup, so Previous / Next buttons stay for a keyboard or a screen
 * reader: off screen (`sr-only`) and shown only while keyboard focus is on
 * them — nothing new to see or tap on a phone.
 */
function Dots({
  doc,
  rows,
  index,
  onStep,
}: {
  doc: WeekMatchups
  rows: readonly MatchupRow[]
  index: number
  onStep: (d: 1 | -1) => void
}) {
  return (
    <div className="relative flex justify-center pb-2" data-match-pager>
      <div className="flex gap-1" aria-hidden data-match-dots>
        {rows.map((r, k) => (
          <span
            key={r.id}
            // The active dot is t1, which is the design's #1D1D1F in light;
            // in dark the design's ink #4D4D4D barely shows against the
            // #575757 dots (§6 / Q8), t1 is white.
            className={cn(
              'h-1.5 rounded-pill transition-[width] duration-200 ease-linear',
              k === index ? 'w-3.5 bg-m-t1' : 'w-1.5 bg-m-b4',
            )}
            data-dot-current={k === index ? 'true' : undefined}
          />
        ))}
      </div>
      <span role="status" className="sr-only">
        {pagerStatus(doc, rows, index)}
      </span>
      <PagerStep dir={-1} onStep={onStep} />
      <PagerStep dir={1} onStep={onStep} />
    </div>
  )
}

/** The pager's keyboard / screen-reader step (see `Dots`). */
function PagerStep({ dir, onStep }: { dir: 1 | -1; onStep: (d: 1 | -1) => void }) {
  return (
    <button
      type="button"
      onClick={() => onStep(dir)}
      className={cn(
        'sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:-top-1.5 focus-visible:z-10 focus-visible:rounded-pill focus-visible:bg-m-b2 focus-visible:px-2.5 focus-visible:py-1 focus-visible:text-[11px] focus-visible:font-semibold focus-visible:text-m-t1',
        dir < 0 ? 'focus-visible:left-0' : 'focus-visible:right-0',
      )}
      data-match-pager-step={dir < 0 ? 'prev' : 'next'}
    >
      {dir < 0 ? 'Previous matchup' : 'Next matchup'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// The matchup card (§2.2 A.2)
// ---------------------------------------------------------------------------

function MatchCard({
  leagueId,
  doc,
  detail,
  row,
  a,
  b,
  myTeamId,
  teamIds,
  projA,
  projB,
  recordOf,
  recordsPending,
  streakOf,
  streaksPending,
}: {
  leagueId: string
  doc: WeekMatchups
  detail: LeagueDetail
  row: MatchupRow
  a: string
  b: string | null
  myTeamId: string | null
  teamIds: readonly string[]
  projA: string | null
  projB: string | null
  recordOf: (teamId: string) => string | null
  /** The standings read has not answered yet — the record slot holds a
   *  placeholder instead of silently missing. */
  recordsPending: boolean
  /** The team's current streak (`streak-ops`); null before a decided game. */
  streakOf: (teamId: string) => Streak | null
  /** The schedule read (the streaks' source) has not answered yet. */
  streaksPending: boolean
}) {
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  const playoff = row.round_type === 'playoff'
  const median = { a: medianRow(doc, a, detail.settings.median_game), b: b ? medianRow(doc, b, detail.settings.median_game) : null }
  const second = { a: secondChip(doc, a, detail.settings.second_opponent), b: b ? secondChip(doc, b, detail.settings.second_opponent) : null }
  const extras = median.a || median.b || second.a || second.b
  const side = (teamId: string, proj: string | null, mirror: boolean) => (
    <CardSide
      leagueId={leagueId}
      name={teamName(doc, teamId)}
      teamId={teamId}
      score={scoreCell(sideScore(row, teamId), row.status)}
      proj={proj}
      result={resultWord(sideResult(row, teamId, doc.results))}
      manager={managers.get(teamId) ?? null}
      record={recordOf(teamId)}
      recordPending={recordsPending}
      streak={streakOf(teamId)}
      streakPending={streaksPending}
      avatarClass={teamAvatarClass(teamIds, teamId, myTeamId)}
      mirror={mirror}
    />
  )

  return (
    <div className="overflow-hidden rounded-[18px] bg-m-b1" data-matchup={row.id} data-matchup-status={row.status}>
      {/* App-only (desktop's "Week N · Playoffs"): a playoff game says so. */}
      {playoff && (
        <div className="px-3 pt-3 text-center text-[11px] font-semibold text-m-t3" data-playoff>
          Week {doc.week} · Playoffs
        </div>
      )}
      <div className={cn('grid grid-cols-[minmax(0,1fr)_30px_minmax(0,1fr)] items-center gap-2 px-3 pb-3', playoff ? 'pt-2' : 'pt-3.5')}>
        {side(a, projA, false)}
        <div className="flex size-[30px] items-center justify-center rounded-full bg-m-b0 text-[11px] font-semibold text-m-t3">vs</div>
        {b ? (
          side(b, projB, true)
        ) : (
          <div className="flex min-w-0 flex-col gap-px text-right" data-side="bye">
            <span className="text-[14px] font-semibold text-m-t3">Bye</span>
            <span className="text-[11px] font-medium text-m-t3">No opponent this week.</span>
          </div>
        )}
      </div>
      {extras && (
        <div className="grid grid-cols-2 gap-3 border-t border-m-b3s px-3 py-2.5">
          <SideExtras doc={doc} median={median.a} second={second.a} />
          <SideExtras doc={doc} median={median.b} second={second.b} mirror />
        </div>
      )}
      {row.is_overridden && (
        <div className="flex justify-center border-t border-m-b3s px-3 py-2">
          <Link
            href={commishMatchupHref(doc.league_id, doc.week, row.home_team_id)}
            title={OVERRIDDEN_TITLE}
            className="flex h-5 items-center rounded-pill bg-m-gp px-2 text-[11px] font-semibold text-m-t1"
            data-overridden
          >
            {OVERRIDDEN_LABEL}
          </Link>
        </div>
      )}
    </div>
  )
}

function CardSide({
  leagueId,
  name,
  teamId,
  score,
  proj,
  result,
  manager,
  record,
  recordPending,
  streak,
  streakPending,
  avatarClass,
  mirror,
}: {
  leagueId: string
  name: string
  teamId: string
  score: ReturnType<typeof scoreCell>
  proj: string | null
  result: ReturnType<typeof resultWord>
  manager: string | null
  record: string | null
  recordPending: boolean
  streak: Streak | null
  streakPending: boolean
  avatarClass: string
  mirror: boolean
}) {
  const avatar = (
    <span
      className={cn('flex size-[34px] flex-none items-center justify-center rounded-full text-[12px] font-semibold text-white', avatarClass)}
      aria-hidden
    >
      {teamInitial(name)}
    </span>
  )
  const scoreCol = (
    <span className={cn('flex flex-col', mirror ? 'items-start' : 'items-end')}>
      <span
        className={cn('text-[22px] font-semibold tracking-[-0.02em]', score.pending && 'text-m-t3')}
        title={score.title ?? undefined}
        data-score={score.pending ? 'pending' : score.text}
      >
        {score.text}
      </span>
      {proj && (
        <span className="text-[11px] font-medium text-m-t3" title="Projected" data-proj-total>
          {proj}
        </span>
      )}
    </span>
  )
  const mgr = manager ? <UsernameLink username={manager} /> : null
  const recOnly = record ?? (recordPending ? <span className="inline-block h-2 w-6 rounded-[3px] bg-m-b3 align-middle" aria-hidden data-record="loading" /> : null)
  // "2-6 ▼2L" (m-match §2.2: the streak in its own coloured span after the
  // record). While the schedule read is out, the record's placeholder holds
  // the streak's slot too (one bar beside a known record).
  const stk = streak ? (
    <span className={streakToneClass(streak, 'text-m-t3')} data-streak={streakArrowText(streak)}>
      {streakArrowText(streak)}
    </span>
  ) : streakPending && record !== null ? (
    <span className="inline-block h-2 w-5 rounded-[3px] bg-m-b3 align-middle" aria-hidden data-streak="loading" />
  ) : null
  const rec =
    recOnly || stk ? (
      <>
        {recOnly}
        {recOnly && stk && ' '}
        {stk}
      </>
    ) : null
  const meta = mirror ? (
    <>
      {rec}
      {rec && mgr && ' · '}
      {mgr}
    </>
  ) : (
    <>
      {mgr}
      {rec && mgr && ' · '}
      {rec}
    </>
  )
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', mirror && 'text-right')} data-side={teamId}>
      <div className="flex items-center gap-2">
        {mirror ? scoreCol : avatar}
        <span className="flex-1" />
        {mirror ? avatar : scoreCol}
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        {result && (
          <span
            className={cn(
              'text-[11px] font-semibold',
              result.tone === 'win' ? 'text-confirm' : result.tone === 'loss' ? 'text-negative-strong' : 'text-m-t3',
            )}
            data-result={result.tone}
          >
            {result.text}
          </span>
        )}
        <Link href={`/app/leagues/${leagueId}/team/${teamId}`} className="block truncate text-[14px] font-semibold text-m-t1">
          {name}
        </Link>
        {(mgr || rec) && <span className="truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{meta}</span>}
      </div>
    </div>
  )
}

/** The second games under a side (§16.5.3 — app-only, kept): *vs League
 *  Median* and the 2nd opponent, each with its own stored result. */
function SideExtras({
  doc,
  median,
  second,
  mirror = false,
}: {
  doc: WeekMatchups
  median: ReturnType<typeof medianRow>
  second: ReturnType<typeof secondChip>
  mirror?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', mirror && 'items-end text-right')}>
      {median && (
        <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-m-t3', mirror && 'flex-row-reverse')} data-median-row>
          <span className="truncate">{MEDIAN_ROW_LABEL}</span>
          <span className="flex-none font-semibold text-m-t1" title={median.median === null ? MEDIAN_PENDING_TITLE : undefined}>
            {median.median === null ? '—' : formatPoints(median.median)}
          </span>
          <ResultPill result={median.result} />
        </div>
      )}
      {second && (
        <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-m-t3', mirror && 'flex-row-reverse')} data-second-chip>
          <span className="truncate">
            {SECOND_CHIP_LABEL} · {teamName(doc, second.opponent_team_id)}
          </span>
          {second.score !== null && second.opponent_score !== null && (
            <span className="flex-none font-semibold text-m-t1">
              {formatPoints(second.score)}–{formatPoints(second.opponent_score)}
            </span>
          )}
          <ResultPill result={second.result} />
        </div>
      )}
    </div>
  )
}

function ResultPill({ result }: { result: string | null }) {
  const chip = resultChip(result)
  if (!chip.decided) {
    return (
      <span className="flex-none text-m-t4" title={chip.title}>
        —
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex h-4 flex-none items-center rounded-pill px-1.5 text-[10px] font-semibold',
        chip.text === 'W' ? 'bg-m-gg text-m-tg' : chip.text === 'L' ? 'bg-m-gr text-m-tr' : 'bg-m-b2 text-m-t1',
      )}
      title={chip.title}
    >
      {chip.text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Starters header (§2.2 B) — "Starters" + ‹ Week N ›
// ---------------------------------------------------------------------------

function StartersHeader({
  leagueId,
  title,
  week,
  weeks,
  status,
}: {
  leagueId: string
  title: string
  week: number
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  status: string | null
}) {
  const nav = weekNav(weeks, week)
  return (
    <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-[18px]" data-week-strip>
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="flex-none text-[17px] font-semibold tracking-[-0.01em] text-m-t1">{title}</h2>
        {status && <WeekStatus status={status} />}
      </div>
      <div className="flex flex-none items-center gap-0.5">
        <WeekStep leagueId={leagueId} to={nav.prev} dir="prev" />
        <span className="whitespace-nowrap text-[13px] font-semibold text-accent" data-week={week}>
          Week {week}
        </span>
        <WeekStep leagueId={leagueId} to={nav.next} dir="next" />
      </div>
    </div>
  )
}

/** The week's stored status beside the title (app-only; the design's live
 *  red — a 6px dot and 11/600 #FF0028 — for a week being played). */
function WeekStatus({ status }: { status: string }) {
  const badge = weekBadge(status)
  if (badge.state === 'live') {
    return (
      <span className="flex flex-none items-center gap-1 text-[11px] font-semibold text-negative-strong" title={badge.title} data-week-badge="live">
        <span className="size-1.5 rounded-full bg-negative-strong" />
        {badge.label}
      </span>
    )
  }
  return (
    <span className="min-w-0 truncate text-[11px] font-medium text-m-t3" title={badge.title} data-week-badge={badge.state}>
      {badge.label}
    </span>
  )
}

/** ‹ / › — loads that week (the app's ladder), and rests in t5 at either
 *  end instead of the prototype's silent clamp. */
function WeekStep({ leagueId, to, dir }: { leagueId: string; to: number | null; dir: 'prev' | 'next' }) {
  const label = dir === 'prev' ? 'Previous week' : 'Next week'
  const icon = <MIcon name={dir === 'prev' ? 'back' : 'chevronRight'} size={12} stroke={2.2} />
  if (to === null) {
    return (
      <span className="flex size-[30px] items-center justify-center rounded-full text-m-t5" aria-disabled="true" aria-label={label} role="link">
        {icon}
      </span>
    )
  }
  return (
    <Link
      href={weekHref(leagueId, to)}
      scroll={false}
      aria-label={label}
      className="flex size-[30px] items-center justify-center rounded-full text-accent active:bg-m-b2"
    >
      {icon}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// The board — both lineups slot by slot (§2.2 C), then the benches
// ---------------------------------------------------------------------------

type Box = ReturnType<typeof useBoxScore>

interface HalfPlayer {
  id: string
  fullName: string
  position: string
  nflTeam: string | null
  cell: StarterCell
  phase: StarterPhase
  game: BoxGame | null
}

function starterHalf(s: BoxStarter): HalfPlayer | null {
  if (!s.player) return null
  return {
    id: s.player.id,
    fullName: s.player.full_name,
    position: s.player.position,
    nflTeam: s.player.nfl_team,
    cell: starterCell(s),
    phase: s.phase,
    game: s.game,
  }
}

/**
 * `b` is the right-hand team, `'bye'` for a head-to-head side with no
 * opponent, or `null` for the total-points week's single lineup.
 */
function Board({
  leagueId,
  doc,
  a,
  b,
  boxA,
  boxB,
  projOf,
  tz,
}: {
  leagueId: string
  doc: WeekMatchups
  a: string
  b: string | 'bye' | null
  boxA: Box
  boxB: Box | null
  projOf: (id: string) => number | null
  tz: string | null
}) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const rosters = useRosters(leagueId)
  const two = b !== null
  const bTeam = b && b !== 'bye' ? b : null
  const dataA = boxA.data
  const dataB = bTeam ? boxB?.data : undefined
  const byeOf = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const t of rosters.data?.teams ?? []) for (const p of t.roster) map.set(p.player_id, p.bye_week)
    return map
  }, [rosters.data])
  const rosterOf = (teamId: string) => rosters.data?.teams.find((t) => t.team_id === teamId)?.roster

  const loading = boxA.isPending || (bTeam !== null && boxB?.isPending === true)
  const slots = pairSlots(dataA?.lineup ? dataA.starters : null, dataB?.lineup ? dataB.starters : null)

  // The bench lines carry ids only — the rosters read names them.
  const hasBench = Boolean(dataA?.bench) || Boolean(bTeam && dataB?.bench)
  const benchA = rosters.data && dataA?.bench ? benchHalves(dataA.bench, rosterOf(a)) : null
  const benchB = rosters.data && bTeam && dataB?.bench ? benchHalves(dataB.bench, rosterOf(bTeam)) : null
  const benchPairs = pairBench(benchA ?? [], benchB ?? [])
  const benchExtra = benchNote(doc.league_week.status)

  const grid = two ? 'grid grid-cols-[minmax(0,1fr)_38px_minmax(0,1fr)] items-center gap-2' : 'grid grid-cols-[38px_minmax(0,1fr)] items-center gap-2'
  const half = (p: HalfPlayer | null | 'gone', present: boolean, mirror = false) =>
    !present ? (
      <span />
    ) : p === 'gone' ? (
      <span className={cn('min-w-0 text-[11px] font-medium text-m-t3', mirror && 'text-right')}>Player no longer on this roster</span>
    ) : (
      <PlayerHalf
        player={p}
        proj={p ? projOf(p.id) : null}
        bye={p ? byeOf.get(p.id) : null}
        tz={tz}
        mirror={mirror}
        onOpen={p ? () => openPlayer(p.id, leagueId) : null}
      />
    )

  return (
    <div className="px-3" data-board>
      <BoxNotes doc={doc} boxA={boxA} boxB={bTeam ? boxB : null} two={two} />
      {loading ? (
        <div className="flex flex-col gap-2 pt-1" data-skeleton="box">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[52px] rounded-[14px] bg-m-b1" />
          ))}
        </div>
      ) : (
        <>
          {slots.length > 0 && (
            <div data-starters>
              {slots.map((pair) => {
                const chip = <SlotChip pos={slotChipPos(slotKeyOf(pair), slotChipText(pair.label, slotKeyOf(pair)))} />
                return (
                  <div key={pair.key} className={cn(grid, 'border-b border-m-b2 px-1 py-2.5')} data-slot-row={pair.key}>
                    {!two && chip}
                    {half(pair.home ? starterHalf(pair.home) : null, pair.home !== null)}
                    {two && chip}
                    {two && half(pair.away ? starterHalf(pair.away) : null, pair.away !== null && bTeam !== null, true)}
                  </div>
                )
              })}
              {/* App-only Total row (desktop's box sum): each side's own sum,
                  or pending as the word — it can differ from the stored score
                  on the card while live scoring catches up. */}
              <div className={cn(grid, 'px-1 py-2.5')} data-total-row>
                {!two && <TotalLabel />}
                <TotalHalf data={dataA} />
                {two && <TotalLabel />}
                {two && <TotalHalf data={dataB} mirror />}
              </div>
            </div>
          )}

          {hasBench && (
            <section data-bench>
              <h3 className="px-1 pb-1 pt-[18px] text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Bench</h3>
              <p className="px-1 pb-1.5 text-[11px] font-medium text-m-t3">
                {BENCH_NOT_COUNTED_COPY}
                {benchExtra ? ` ${benchExtra}` : ''}
              </p>
              {rosters.isPending ? (
                <div className="flex flex-col gap-2 pt-1" data-skeleton="bench">
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="h-[52px] rounded-[14px] bg-m-b1" />
                  ))}
                </div>
              ) : !rosters.data ? (
                <div className="flex flex-col items-center gap-1.5 py-4 text-center" role="alert">
                  <span className="text-[13px] font-medium text-m-t3">Couldn’t load the bench.</span>
                  <button type="button" onClick={() => void rosters.refetch()} className="text-[13px] font-semibold text-accent">
                    Try again
                  </button>
                </div>
              ) : benchPairs.length === 0 ? (
                <p className="py-4 text-center text-[13px] font-medium text-m-t3" data-empty="no-bench">
                  {EMPTY_BENCH_COPY}
                </p>
              ) : (
                benchPairs.map((pair, i) => {
                  const label = benchSlotLabel({ home: pair.home, away: pair.away })
                  return (
                    <div key={i} className={cn(grid, 'border-b border-m-b2 px-1 py-2.5')} data-bench-row>
                      {!two && <SlotChip pos={label} className={BENCH_CHIP} />}
                      {half(pair.home?.half ?? 'gone', pair.home !== null)}
                      {two && <SlotChip pos={label} className={BENCH_CHIP} />}
                      {two && half(pair.away?.half ?? 'gone', pair.away !== null && bTeam !== null, true)}
                    </div>
                  )
                })
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function slotKeyOf(pair: { home: BoxStarter | null; away: BoxStarter | null }): string {
  return (pair.home ?? pair.away)?.slot_key ?? ''
}

/** The box's bench lines joined to the rosters read for names (the desktop
 *  order: IR last, then position, then name), keeping each line's game. */
function benchHalves(
  bench: NonNullable<TeamBoxScore['bench']>,
  roster: Parameters<typeof benchRows>[1],
): Array<{ ir: boolean; half: HalfPlayer | 'gone' }> {
  const lineById = new Map(bench.map((l) => [l.player_id, l]))
  return benchRows(bench, roster).map((row) => {
    const line = lineById.get(row.player_id)
    return {
      ir: row.ir,
      half: row.player
        ? {
            id: row.player.id,
            fullName: row.player.full_name,
            position: row.player.position,
            nflTeam: row.player.nfl_team,
            cell: row.cell,
            phase: line?.phase ?? 'up_next',
            game: line?.game ?? null,
          }
        : 'gone',
    }
  })
}

/** The 38px slot chip (§2.2 C — 26px, radius 8, 11/600): the shared
 *  `MPosChip`, its fill and label, at the Match tab's size. */
function SlotChip({ pos, className }: { pos: string; className?: string }) {
  return <MPosChip pos={pos} className={cn('flex h-[26px] w-full rounded-[8px] text-[11px] font-semibold', className)} />
}

function TotalLabel() {
  return <span className="text-center text-[11px] font-semibold text-m-t3">{BOX_SUM_LABEL}</span>
}

/** One side's box sum, at the points column's edge. No lineup ⇒ nothing
 *  (the side's note says why), never a pending sum. */
function TotalHalf({ data, mirror = false }: { data: TeamBoxScore | undefined; mirror?: boolean }) {
  if (!data?.lineup) return <span />
  const sum = boxSumCell(data)
  return (
    <span className={cn('flex min-w-0', mirror ? 'justify-start' : 'justify-end')} data-box-total={data.team_id}>
      <span
        className={cn('font-semibold', sum.pending ? 'text-[11px] text-m-t3' : 'text-[16px] text-m-t1')}
        title={sum.title ?? undefined}
        data-box-sum={sum.pending ? 'pending' : sum.text}
      >
        {sum.text}
      </span>
    </span>
  )
}

/** One player's half of a row (§2.2 C): short name, POS · TEAM (bye), points
 *  and projection, the game line. A tap opens the player profile. */
function PlayerHalf({
  player,
  proj,
  bye,
  tz,
  mirror,
  onOpen,
}: {
  player: HalfPlayer | null
  proj: number | null
  bye: number | null | undefined
  tz: string | null
  mirror: boolean
  onOpen: (() => void) | null
}) {
  if (!player) {
    return (
      // An empty seat keeps the filled row's shape (name + meta, points, game
      // line) so both columns stay level; it is not a door to anything.
      <div className={cn('flex min-w-0 flex-col gap-[3px]', mirror && 'text-right')} data-starter-reason="empty">
        <div className={cn('flex items-start gap-1.5', mirror && 'flex-row-reverse')}>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-[14px] font-semibold">Empty</span>
            <span className="text-[11px] font-medium text-m-t3">{'\u00a0'}</span>
          </span>
          <span className="flex-none text-[16px] font-semibold text-m-t5" title={EMPTY_SEAT_TITLE}>
            –
          </span>
        </div>
        <span className="text-[11px] font-medium text-m-t3">{'\u00a0'}</span>
      </div>
    )
  }
  const pts = pointsDisplay(player.cell)
  const kickoff = player.game && player.phase === 'up_next' ? formatKickoff(player.game.kickoff_at, tz).local : null
  const game = gameLine(player.nflTeam, player.phase, player.game, kickoff)
  const team = metaTeam(player.nflTeam, bye)
  const nameCol = (
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="truncate text-[14px] font-semibold">{shortName(player.fullName, player.position)}</span>
      <span className="truncate whitespace-nowrap text-[11px] font-medium text-m-t3">
        <span className={cn('font-semibold', posTextClass(player.position))}>{posLabel(player.position)}</span>
        {team ? ` · ${team}` : ''}
      </span>
    </span>
  )
  const pointsCol = (
    <span className={cn('flex flex-none flex-col gap-px', mirror ? 'items-start' : 'items-end')}>
      <span
        className={cn(
          'font-semibold',
          pts.tone === 'word' ? 'pt-1 text-[11px] text-m-t3' : 'text-[16px]',
          pts.tone === 'dim' && 'text-m-t5',
        )}
        title={player.cell.title ?? undefined}
        data-starter-cell={player.cell.tone}
      >
        {pts.text}
      </span>
      {proj !== null && <span className="text-[11px] font-medium text-m-t3">{proj.toFixed(2)}</span>}
    </span>
  )
  return (
    <button
      type="button"
      onClick={onOpen ?? undefined}
      className={cn('flex w-full min-w-0 flex-col gap-[3px]', mirror ? 'text-right' : 'text-left')}
      data-player={player.id}
    >
      <span className="flex w-full items-start gap-1.5">
        {mirror ? pointsCol : nameCol}
        {mirror ? nameCol : pointsCol}
      </span>
      <span className="w-full truncate text-[11px] font-medium text-m-t3">{game || ' '}</span>
    </button>
  )
}

/** Each side's own state, in words, above its column: where its points come
 *  from, why it has none, or that its read failed (with a retry). */
function BoxNotes({ doc, boxA, boxB, two }: { doc: WeekMatchups; boxA: Box; boxB: Box | null; two: boolean }) {
  const status = doc.league_week.status
  const noteOf = (box: Box | null): { text: string | null; points: string | null; retry: (() => void) | null } => {
    if (!box) return { text: null, points: null, retry: null }
    const data = box.data
    if (box.isError && !data) return { text: `Couldn’t load this box score. ${problemCopy(box.error)}`, points: null, retry: () => void box.refetch() }
    const parts: string[] = []
    if (box.isError && data) parts.push(STALE_SCORES_COPY)
    if (data && data.lineup === null) parts.push(NO_LINEUP_COPY)
    if (data && data.lineup !== null && data.starters.length > 0 && data.starters.every((s) => s.reason === 'empty')) parts.push(NO_STARTERS_COPY)
    return { text: parts.join(' ') || null, points: data ? boxPointsNote(data, status) : null, retry: null }
  }
  const na = noteOf(boxA)
  // A bye side says so on the card; its column of rows simply stays blank.
  const nb = noteOf(boxB)
  const sharedPoints = na.points !== null && na.points === nb.points ? na.points : null
  const left = [na.text, sharedPoints ? null : na.points].filter(Boolean).join(' ')
  const right = [nb.text, sharedPoints ? null : nb.points].filter(Boolean).join(' ')
  if (!left && !right && !sharedPoints && !na.retry && !nb.retry) return null
  return (
    <div className="flex flex-col gap-1.5 px-1 pb-2 text-[11px] font-medium text-m-t3" data-box-notes>
      {sharedPoints && <p className="text-center">{sharedPoints}</p>}
      {(left || right || na.retry || nb.retry) && (
        <div className={cn('grid gap-2', two ? 'grid-cols-2' : 'grid-cols-1')}>
          <NoteCell text={left} retry={na.retry} />
          {two && <NoteCell text={right} retry={nb.retry} mirror />}
        </div>
      )}
    </div>
  )
}

function NoteCell({ text, retry, mirror = false }: { text: string; retry: (() => void) | null; mirror?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', mirror ? 'items-end text-right' : 'items-start')} role={retry ? 'alert' : undefined}>
      {text && <span>{text}</span>}
      {retry && (
        <button type="button" onClick={retry} className="text-[13px] font-semibold text-accent">
          Try again
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// total_points — the week leaderboard replaces the matchup (§16.5.3)
// ---------------------------------------------------------------------------

function LeaderboardWeek({
  leagueId,
  doc,
  detail,
  weeks,
  currentWeek,
  myTeamId,
  tz,
}: {
  leagueId: string
  doc: WeekMatchups
  detail: LeagueDetail
  weeks: readonly Pick<ScheduleWeek, 'week'>[]
  currentWeek: number | null
  myTeamId: string | null
  tz: string | null
}) {
  const rows = leaderboardRows(doc)
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked ?? myTeamId ?? rows[0]?.team_id ?? null
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  const box = useBoxScore(leagueId, doc.week, selectedId)
  const values = useLeaguePlayerValues(leagueId, doc.season, doc.week)
  const projOf = (id: string) => values.byPlayer.get(id)?.projected_points ?? null
  const status = doc.league_week.status

  const remember = useMatchStore((s) => s.remember)
  useEffect(() => {
    remember(leagueId, spotOf({ index: 0, matchupId: null, week: doc.week, currentWeek }))
  }, [remember, leagueId, doc.week, currentWeek])

  return (
    <>
      <div className="px-3 pt-1.5">
        <div className="overflow-hidden rounded-[18px] bg-m-b1" data-leaderboard>
          <div className="flex items-center gap-2 px-3 pb-1.5 pt-3">
            <span className="text-[13px] font-semibold text-m-t3">{LEADERBOARD_TITLE}</span>
            {/* App-only: desktop's "Total points" badge — this league's format. */}
            <span className="flex h-5 items-center rounded-pill bg-m-b2 px-2 text-[11px] font-semibold text-m-t3" data-total-points-label>
              Total points
            </span>
          </div>
          {rows.length === 0 && <p className="px-3 pb-4 pt-2 text-center text-[13px] font-medium text-m-t3">{NO_LEADERBOARD_ROWS_COPY}</p>}
          {rows.map((r) => {
            const on = r.team_id === selectedId
            return (
              <button
                key={r.team_id}
                type="button"
                onClick={() => setPicked(r.team_id)}
                aria-pressed={on}
                className={cn('flex h-12 w-full items-center gap-2.5 border-t border-m-b3s px-3 text-left', on ? 'bg-m-gb' : 'active:bg-m-b2h')}
                data-leaderboard-row={r.team_id}
              >
                <span className="w-5 flex-none text-right text-[11px] font-semibold text-m-t3">{r.rank ?? '–'}</span>
                <span
                  className={cn(
                    'flex size-7 flex-none items-center justify-center rounded-full text-[11px] font-semibold text-white',
                    teamAvatarClass(teamIds, r.team_id, myTeamId),
                  )}
                  aria-hidden
                >
                  {teamInitial(r.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{r.name}</span>
                {r.points !== null ? (
                  <span className="flex-none text-[15px] font-semibold text-m-t1">{formatPoints(r.points)}</span>
                ) : (
                  <span className="flex-none text-[11px] font-semibold text-m-t3" title="No scoring batch has reached this team yet — an absent row is not a score.">
                    pending
                  </span>
                )}
                {r.is_final ? (
                  <span className="w-9 flex-none text-right text-[11px] font-semibold text-m-t3">Final</span>
                ) : (
                  <span className="flex w-9 flex-none items-center justify-end gap-1 text-[11px] font-semibold text-negative-strong" title="Provisional — the week has not finalized.">
                    <span className="size-1.5 rounded-full bg-negative-strong" />
                    Live
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <ReadProblems
          items={[values.isError && !values.data ? { key: 'projections', text: 'Couldn’t load the projections.', retry: () => void values.refetch() } : null]}
        />
        {selectedId && weekMayHaveCorrections(status) && (
          <MobileCorrectionNote leagueId={leagueId} week={doc.week} teamIds={[selectedId]} scope="team" />
        )}
      </div>
      <StartersHeader leagueId={leagueId} title="Starters" week={doc.week} weeks={weeks} status={status} />
      {selectedId && <Board key={selectedId} leagueId={leagueId} doc={doc} a={selectedId} b={null} boxA={box} boxB={null} projOf={projOf} tz={tz} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Commissioner override (app-only) — the mode's indicator and its Turn off
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** Reads the screen leans on that failed, said with a retry — never a
 *  record or projection that silently isn't there. */
function ReadProblems({ items }: { items: ReadonlyArray<{ key: string; text: string; retry: () => void } | null> }) {
  const shown = items.filter((i): i is { key: string; text: string; retry: () => void } => i !== null)
  if (shown.length === 0) return null
  return (
    <div role="alert" className="flex flex-col gap-1 px-1 pt-2.5" data-read-problems>
      {shown.map((i) => (
        <div key={i.key} className="flex items-center justify-between gap-2 text-[11px] font-medium text-m-t3" data-read-problem={i.key}>
          <span className="min-w-0">{i.text}</span>
          <button type="button" onClick={i.retry} className="flex-none text-[13px] font-semibold text-accent">
            Try again
          </button>
        </div>
      ))}
    </div>
  )
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mx-3 mt-1.5 rounded-[12px] bg-m-go px-3 py-2 text-[12px] font-medium text-m-to">
      {children}
    </div>
  )
}

function Problem({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2.5 px-4 py-12 text-center">
      <span className="text-[14px] font-medium leading-[1.4] text-m-t3">{title}</span>
      {detail && <span className="text-[13px] font-medium leading-[1.4] text-m-t4">{detail}</span>}
      <button type="button" onClick={onRetry} className="text-[14px] font-semibold text-accent">
        Try again
      </button>
    </div>
  )
}

function EmptyCopy({ copy, ...rest }: { copy: string } & Record<string, unknown>) {
  return (
    <p className="px-4 py-12 text-center text-[14px] font-medium leading-[1.4] text-m-t3" {...rest}>
      {copy}
    </p>
  )
}

function EmptyCard({ copy }: { copy: string }) {
  return (
    <div className="rounded-[18px] bg-m-b1 px-4 py-8 text-center text-[13px] font-medium leading-[1.4] text-m-t3" data-empty="no-matchups">
      {copy}
    </div>
  )
}

function MatchSkeleton() {
  return (
    <div className="flex flex-col px-3 pt-1.5" data-skeleton="match" aria-busy="true">
      <div className="flex justify-center pb-2">
        <div className="h-1.5 w-12 rounded-pill bg-m-b1" />
      </div>
      <div className="h-[132px] rounded-[18px] bg-m-b1" />
      <div className="flex items-center justify-between px-1 pb-1.5 pt-[18px]">
        <div className="h-5 w-20 rounded-[6px] bg-m-b1" />
        <div className="h-5 w-24 rounded-[6px] bg-m-b1" />
      </div>
      <div className="flex flex-col gap-2 pt-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[52px] rounded-[14px] bg-m-b1" />
        ))}
      </div>
    </div>
  )
}
