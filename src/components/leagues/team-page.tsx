'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLineup } from '@/hooks/use-lineup'
import { useRostersLive } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from '@/lib/leagues/api/inseason-reads'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import { Crest } from './league-cells'
import { LineupEditor } from './lineup-editor'
import { currentWeekOf, defaultLineupWeek, formatKickoff, locksAtCopy, weekEditability } from './lineup-editor-ops'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'

/**
 * Team page — §16.1 `…/leagues/[id]/team/[teamId]` ("Team/roster + weekly
 * lineup"), M4 task L.D5.1 (PROGRESS D316). Hosts `LineupEditor` with the
 * week picker, the "locks from" record and the lock-countdown placeholder.
 *
 * **Data, and who gates whom.** `useLeague` (the §15.1 detail) is the
 * membership gate for the whole page: a non-member gets its 403/404 and
 * nothing below mounts — which is the F249(a) disposition for `useLineup`
 * (a member-RLS read with no assertion of its own): the SURFACE asserts
 * membership before the hook can mount, at no extra round trip on the
 * member path (D315(12)'s reasoning; D316). `useRostersLive` is the
 * roster + the FETCHED lock evaluation (`game_lock`, D315(5)) and the
 * `league:<id>` room's `connection` (F233(a) — one refcounted room, never a
 * second `.channel(`) — refetched on the tick's own `league_player_pool`
 * broadcast (119; the 60 s poll retired at L.D5.4, F259(a));
 * `useSchedule` is the week ladder the current week is read from (no clock
 * — §23.3; `lineup-editor-ops.ts` header).
 *
 * **One 404 copy (F250(a)).** A member of a soft-deleted league meets two
 * bodies in the in-season family (the family's `INSEASON_LEAGUE_GONE_MESSAGE`
 * vs 117's verbatim on standings); this page renders ONE thing for any
 * 404 — the family's copy — whatever the body said. The SQL-side nit
 * (mapping standings' P0002 at `standings-service.ts`) stays F250(a)'s for
 * whoever next opens that file (L.D5.3).
 *
 * **The four states per surface (§16.5.4):** skeleton while the league or
 * roster loads · empty (no roster rows / no lineup row yet — designed copy)
 * · error-with-retry (the league or the roster read failed with nothing to
 * show) · degraded (a refetch failed with last-good rows on screen → the
 * banner + the rows; the realtime drop → the reconnecting banner).
 *
 * **The lock countdown is a NAMED PLACEHOLDER (Q40 / F251).** §16.5.1 and
 * tasks-M4 name a "lock countdown" but the spec never defines what it
 * counts down TO under the one per-player lock (Q34(A)); the record R779
 * mandates — `locked_at` as "locks from" — renders here, and the ticking
 * countdown waits for the ruling rather than inventing its referent (R801).
 */
export function TeamPage({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) return <TeamPageSkeleton />
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  const team = league.data.teams.find((t) => t.id === teamId)
  if (!team) {
    return (
      <ProblemCard
        title="This team isn’t a franchise of this league."
        detail="Check the link — a team lives in exactly one league."
        onRetry={null}
        leagueId={leagueId}
      />
    )
  }
  return <TeamPageContent leagueId={leagueId} teamId={teamId} detail={league.data} teamName={team.name} />
}

/** The in-season family's problem copy for a failed league/family read —
 *  ONE 404 copy (F250(a)), one 403 copy; shared by the standings and
 *  schedule pages (L.D5.3), which is why it is exported. */
export function problemCopy(error: unknown): string {
  if (error instanceof LeagueActionError) {
    if (error.status === 404) return INSEASON_LEAGUE_GONE_MESSAGE
    if (error.status === 403) return INSEASON_READ_FORBIDDEN_MESSAGE
    return error.message
  }
  const message = error instanceof Error ? error.message : ''
  // `useLeague` throws a plain Error carrying the route's copy; a 404 body
  // from any member of the family renders the ONE copy (F250(a)).
  if (/not found|no longer exists|404/i.test(message)) return INSEASON_LEAGUE_GONE_MESSAGE
  if (/only members|forbidden|403/i.test(message)) return INSEASON_READ_FORBIDDEN_MESSAGE
  return message || 'It may have been removed, or you no longer have access.'
}

function TeamPageContent({
  leagueId,
  teamId,
  detail,
  teamName,
}: {
  leagueId: string
  teamId: string
  detail: LeagueDetail
  teamName: string
}) {
  const { user } = useAuth()
  // COMMISSIONER OVERRIDE MODE lives above this mount (PROGRESS §3(h)): Chris
  // fixed four teams in one sitting, and a per-page flag would have made him
  // re-enter the mode on each route. The page owns the read/write; the editor
  // owns the switch and the work.
  const overrideMode = useOverrideMode(leagueId)
  const enterOverride = useCommishOverrideStore((s) => s.enter)
  const exitOverride = useCommishOverrideStore((s) => s.exit)
  const schedule = useSchedule(leagueId)
  const weeks = useMemo(() => schedule.data?.weeks ?? [], [schedule.data])
  const currentWeek = useMemo(() => currentWeekOf(weeks), [weeks])
  const [pickedWeek, setPickedWeek] = useState<number | null>(null)
  const week = pickedWeek ?? defaultLineupWeek(weeks)
  // The current week's 🔒 is the tick-refreshed pool view, and since
  // migration 119 the tick BROADCASTS its pass (`league_player_pool` on the
  // room — D319(6)); the room's refetch replaced the 60 s poll (F259(a),
  // L.D5.4). F252(c): no lineup read for a week the ladder has not named yet.
  const rosters = useRostersLive(leagueId)
  const lineup = useLineup(teamId, schedule.data ? week : undefined)

  const rosterTeam = rosters.data?.teams.find((t) => t.team_id === teamId) ?? null
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const isOwnTeam = myTeamId === teamId
  const canEdit = isOwnTeam || isCommish
  const editability = weekEditability(weeks, week, currentWeek)
  const leagueTimeZone = detail.settings.draft.time_zone ?? null

  const rosterProblem = rosters.isError ? (rosters.error instanceof Error ? rosters.error : new Error(String(rosters.error))) : null

  const lockedAtView = lineup.data?.locked_at ? formatKickoff(lineup.data.locked_at, leagueTimeZone) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={teamName}
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>
              <Icon name="cup" size={13} />
              {detail.league.name}
            </Link>
          </Button>
        }
      />

      {rosters.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {rosterProblem && rosters.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
      {lineup.isError && lineup.data !== undefined && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 px-card-pad py-3">
          <Crest name={teamName} src={null} className="h-10 w-10" fallbackClassName="text-[12px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-bold text-ink">{teamName}</span>
            <span className="text-[11px] font-medium text-n-3">
              {isOwnTeam ? 'Your team' : rosterTeam?.manager_user_id ? 'Managed by another member' : 'No manager seated'}
              {isCommish && !isOwnTeam ? ' · you are acting as commissioner' : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The mode, said at the TOP of the page — above the week picker and
                the editor, so "it's on" is legible on a phone without
                scrolling. A resting condition, so it is a fill, never a shadow
                (CLAUDE.md). */}
            {overrideMode && isCommish && <Badge variant="lime" data-override-mode-badge>✸ Override mode ON</Badge>}
            {lineup.data?.edited_by_commish && <Badge variant="stroke-purple">✸ commissioner-set</Badge>}
            {currentWeek !== null && week === currentWeek && <Badge variant="green">Current week</Badge>}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segment aria-label="Week">
          {(weeks.length > 0 ? weeks.map((w) => w.week) : [week]).map((w) => (
            <SegmentItem key={w} active={w === week} onClick={() => setPickedWeek(w)}>
              Wk {w}
            </SegmentItem>
          ))}
        </Segment>
        {/* R779: the record ("locks from"), never the lock. The countdown to
            the next lock is a NAMED placeholder pending Q40 (F251). */}
        <p
          className="text-[11px] font-medium text-n-3"
          data-lock-countdown="placeholder-q40"
          title={lockedAtView?.title ?? undefined}
        >
          {lineup.isPending ? 'Reading the week…' : locksAtCopy(lockedAtView?.local ?? null)}
          {lineup.data?.locked_at ? ' · countdown coming' : ''}
        </p>
      </div>

      {rosters.isPending || schedule.isPending || lineup.isPending ? (
        <EditorSkeleton />
      ) : rosterProblem && !rosters.data ? (
        <ProblemCard
          title="Couldn’t load this roster."
          detail={problemCopy(rosterProblem)}
          onRetry={() => rosters.refetch()}
          leagueId={leagueId}
        />
      ) : lineup.isError && lineup.data === undefined ? (
        <ProblemCard
          title="Couldn’t load this week’s lineup."
          detail={lineup.error instanceof Error ? lineup.error.message : 'The lineup read failed.'}
          onRetry={() => lineup.refetch()}
          leagueId={leagueId}
        />
      ) : !rosterTeam ? (
        <ProblemCard
          title="This team has no roster on record."
          detail="Every franchise carries a roster row set once it is seated — none came back for this one."
          onRetry={() => rosters.refetch()}
          leagueId={leagueId}
        />
      ) : (
        <>
          {lineup.data === null && (
            <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3">
              Nothing set for week <span className="fs-num">{week}</span> yet — the week opens with last week’s legal lineup carried over (§11.2); until then every seat is open here.
            </p>
          )}
          <LineupEditor
            leagueId={leagueId}
            teamId={teamId}
            week={week}
            settings={detail.settings.roster_settings}
            allowIllegal={detail.settings.allow_illegal_lineups}
            roster={rosterTeam.roster}
            stored={lineup.data ?? null}
            currentWeek={currentWeek}
            editability={editability}
            canEdit={canEdit}
            isCommissionerArm={canEdit && !isOwnTeam}
            /* The ROLE, not the arm. `isCommissionerArm` only means "acting
               for a team that is not mine"; the audited override is gated on
               being a commissioner at all, so a commissioner fixing HIS OWN
               team after kickoff is offered it too (PROGRESS §3(a)). */
            isCommish={isCommish}
            leagueTimeZone={leagueTimeZone}
            /* Only a commissioner can be IN the mode — the store is keyed by
               league, and a member who is not one must never inherit it. */
            overrideMode={overrideMode && isCommish}
            onOverrideMode={(next) => (next ? enterOverride(leagueId) : exitOverride())}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function TeamPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Team" />
      <Skeleton className="h-16 rounded-sm" />
      <Skeleton className="h-7 w-64 rounded-sm" />
      <EditorSkeleton />
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]" data-skeleton="lineup-editor">
      <Skeleton className="h-80 rounded-sm" />
      <Skeleton className="h-80 rounded-sm" />
    </div>
  )
}

export function ProblemCard({
  title,
  detail,
  onRetry,
  leagueId,
  heading = 'Team',
}: {
  title: string
  detail: string
  onRetry: (() => void) | null
  leagueId: string | null
  /** The page header while the problem shows — the host page's own title
   *  (L.D5.3's standings/schedule pages pass theirs). */
  heading?: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={heading} />
      <Card className="border-negative bg-negative-soft">
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold" role="alert">
            {title}
          </p>
          <p className="text-[12px] font-medium text-n-3">{detail}</p>
          <div className="flex items-center gap-2.5">
            {onRetry && (
              <Button variant="stroke" size="sm" onClick={onRetry}>
                <Icon name="reset" size={13} /> Retry
              </Button>
            )}
            <Button variant="stroke" size="sm" asChild>
              <Link href={leagueId ? `/app/leagues/${leagueId}` : '/app/leagues'}>{leagueId ? 'Back to league' : 'Back to leagues'}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
