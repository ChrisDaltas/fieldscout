'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useEditMatchup, useScheduleLive, type EditMatchupResult } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import { Crest, TeamNameLink } from './league-cells'
import { currentWeekOf } from './lineup-editor-ops'
import { ScheduleRemixModal } from './schedule-remix-modal'
import {
  NO_SCHEDULE_COPY,
  editFormProblem,
  editableTeams,
  formatScore,
  reasonHint,
  scheduleGrid,
  weekStatusBadge,
  type MatchupCell,
  type TeamRef,
  type WeekCell,
} from './schedule-view-ops'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner, StatusBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * ScheduleView — §16.1 `…/leagues/[id]/schedule` ("Season schedule (member
 * view; commish: edit + Remix §11.7)"), §16.2 `schedule-view` ("week-by-week
 * grid; byes; commish edit affordances"; division badges struck v2.16.12 —
 * Q30), §16.5.2's Schedule & Remix row — M4 task L.D5.3 (PROGRESS D317).
 *
 * **Data, and who gates whom.** `useLeague` is the membership gate for the
 * whole page (the D316(4)/F249(a) posture — the SURFACE asserts membership;
 * `useSchedule` stays a plain member read, and this is the `useSchedule`
 * half F249(a) routed here). `useScheduleLive` is the week ladder + every
 * pairing (member-RLS, D92) plus the `league:<id>` room's `connection`
 * (F233(a) — one refcounted room, never a second `.channel(`), refetching
 * on `matchups` / `league_weeks` (119's triggers — a Remix's or an edit's
 * rows reach the grid directly; the `league_chat` stand-in retired, F254(a)).
 *
 * **The commissioner's two doors (§11.7), both audited per D290.** REMIX
 * opens `ScheduleRemixModal` (seed → preview → confirm; E41's two copies).
 * EDIT is per row: an `upcoming` week's `scheduled`, unscored, un-overridden
 * pairing shows "Edit" to a commissioner; the form re-pairs the row through
 * 111's `schedule_edit_matchup` (`useEditMatchup`, F233(e) — one
 * `action_id` per submit), which re-seats the displaced teams itself and
 * writes the D97 post in the same transaction. The reason field is always
 * present on the form and ALWAYS OPTIONAL (Q66, spec v2.16.41 — since
 * migration 131 the verb lands without one in every window; F361) — the
 * ladder gives a hint (`reasonHint`), a refusal renders VERBATIM
 * (`role="alert"`). NEVER
 * optimistic: the rows after an edit are the re-read server rows.
 *
 * **Pending by name (R801):** playoff weeks (Q39, L.D1.8) render "bracket
 * pending"; a total-points league's weeks say why they have no pairings.
 *
 * **The four states per surface (§16.5.4):** skeleton while the league or
 * the schedule loads · empty (no weeks — designed copy) · error-with-retry
 * (ONE 404 copy, F250(a)) · degraded (a refetch failed with last-good rows
 * on screen → the banner + the grid; the realtime drop → the reconnecting
 * banner).
 *
 * No clock (§23.3 / the F226 fence): the current week is the ladder's
 * (`currentWeekOf`, D316(2)); every instant rendered is a stored one.
 * Elevation: rows and cards rest flat; the Remix dialog's shadow is the
 * primitive's (a true overlay) — nothing here adds one.
 */
export function ScheduleView({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) return <ScheduleSkeleton />
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading="Schedule"
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  return <ScheduleContent leagueId={leagueId} detail={league.data} />
}

function ScheduleContent({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user, profile } = useAuth()
  const schedule = useScheduleLive(leagueId)
  const [remixOpen, setRemixOpen] = useState(false)
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const teams = useMemo(() => editableTeams(detail.teams), [detail.teams])
  const grid = useMemo(
    () =>
      schedule.data
        ? scheduleGrid(
            schedule.data,
            teamNames,
            { regular_season_weeks: detail.settings.regular_season_weeks, schedule_mode: detail.settings.schedule_mode },
            isCommish,
          )
        : [],
    [schedule.data, teamNames, detail.settings.regular_season_weeks, detail.settings.schedule_mode, isCommish],
  )
  const currentWeek = useMemo(() => currentWeekOf(schedule.data?.weeks ?? []), [schedule.data])
  const hint = isCommish ? reasonHint(schedule.data?.weeks ?? []) : null
  const problem = schedule.isError ? (schedule.error instanceof Error ? schedule.error : new Error(String(schedule.error))) : null
  const leagueTimeZone = detail.settings.draft.time_zone ?? null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Schedule"
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>
              <Icon name="cup" size={13} />
              {detail.league.name}
            </Link>
          </Button>
        }
      />

      {schedule.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {problem && schedule.data && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
      {hint && <StatusBanner tone="caution">{hint}</StatusBanner>}

      <div className="flex flex-wrap items-center justify-between gap-2" data-schedule-toolbar>
        <span className="text-[11px] font-medium text-n-3">
          {schedule.data ? (
            <>
              <span className="fs-num">{schedule.data.weeks.length}</span> week{schedule.data.weeks.length === 1 ? '' : 's'} ·{' '}
              <span className="fs-num">{detail.settings.regular_season_weeks}</span> regular-season
              {detail.settings.schedule_mode === 'total_points' ? ' · total points' : ''}
            </>
          ) : (
            'Season'
          )}
        </span>
        {isCommish && (
          <Button variant="blue" size="sm" onClick={() => setRemixOpen(true)} data-remix-open>
            <Icon name="repeat" size={13} />
            Remix schedule
          </Button>
        )}
      </div>

      {schedule.isPending ? (
        <GridSkeleton />
      ) : problem && !schedule.data ? (
        <ProblemCard
          heading="Schedule"
          title="Couldn’t load the schedule."
          detail={problemCopy(problem)}
          onRetry={() => schedule.refetch()}
          leagueId={leagueId}
        />
      ) : grid.length === 0 ? (
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3">
          {NO_SCHEDULE_COPY}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-schedule-grid>
          {grid.map((week) => (
            <WeekCard
              key={week.week}
              leagueId={leagueId}
              week={week}
              isCurrent={week.week === currentWeek}
              myTeamId={myTeamId}
              teams={teams}
            />
          ))}
        </div>
      )}

      {isCommish && schedule.data && (
        <ScheduleRemixModal
          open={remixOpen}
          onOpenChange={setRemixOpen}
          leagueId={leagueId}
          current={schedule.data.matchups}
          teamNames={teamNames}
          leagueTimeZone={leagueTimeZone}
          actorName={profile?.username ?? 'you'}
        />
      )}
    </div>
  )
}

function WeekCard({
  leagueId,
  week,
  isCurrent,
  myTeamId,
  teams,
}: {
  leagueId: string
  week: WeekCell
  isCurrent: boolean
  myTeamId: string | null
  teams: TeamRef[]
}) {
  const badge = weekStatusBadge(week.status)
  return (
    <Card data-week={week.week} data-week-kind={week.kind} className={cn(isCurrent && 'border-accent')}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-card-pad py-2">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          Week <span className="fs-num">{week.week}</span>
          {week.kind === 'playoff' && <Badge variant="stroke-purple">Playoffs</Badge>}
          {isCurrent && <Badge variant="green">Current</Badge>}
        </CardTitle>
        <span className="flex items-center gap-2">
          {week.median_score !== null && (
            <span className="text-[11px] font-medium text-n-3">
              median <span className="fs-num">{week.median_score.toFixed(2)}</span>
            </span>
          )}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-card-pad pb-3 pt-0">
        {week.note ? (
          <p className="text-[12px] font-medium text-n-3" data-week-note>
            {week.note}
          </p>
        ) : (
          week.rows.map((row) => <MatchupRowView key={row.id} leagueId={leagueId} row={row} myTeamId={myTeamId} teams={teams} />)
        )}
      </CardContent>
    </Card>
  )
}

function MatchupRowView({
  leagueId,
  row,
  myTeamId,
  teams,
}: {
  leagueId: string
  row: MatchupCell
  myTeamId: string | null
  teams: TeamRef[]
}) {
  const [editing, setEditing] = useState(false)
  const mine = row.home.id === myTeamId || row.away?.id === myTeamId
  return (
    <div
      className={cn('flex flex-col gap-1 rounded-sm border border-n-4 px-2 py-1.5', mine && 'border-accent bg-accent-soft')}
      data-matchup={row.id}
      data-round-type={row.round_type}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <TeamLabel leagueId={leagueId} team={row.home} winner={row.result === 'home'} />
        <span className="fs-num text-[11px] text-n-3">{formatScore(row.home_score, row.status)}</span>
        <span className="text-[10px] font-bold text-n-3">vs</span>
        {row.away ? (
          <>
            <TeamLabel leagueId={leagueId} team={row.away} winner={row.result === 'away'} />
            <span className="fs-num text-[11px] text-n-3">{formatScore(row.away_score, row.status)}</span>
          </>
        ) : (
          <Badge variant="stroke">bye</Badge>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {row.round_type === 'secondary' && <Badge variant="stroke">second game</Badge>}
          {row.result === 'tie' && <Badge variant="yellow">tie</Badge>}
          {row.is_overridden && <Badge variant="stroke-purple">✸ commissioner-adjusted</Badge>}
          {row.editable && !editing && (
            <Button variant="stroke" size="sm" onClick={() => setEditing(true)} data-edit-matchup>
              <Icon name="edit" size={13} /> Edit
            </Button>
          )}
        </span>
      </div>
      {editing && <EditMatchupForm leagueId={leagueId} row={row} teams={teams} onClose={() => setEditing(false)} />}
    </div>
  )
}

/** The winner's WEIGHT stays on the wrapper so the link owns only its
 *  underline — the two treatments compose instead of competing. */
function TeamLabel({ leagueId, team, winner }: { leagueId: string; team: TeamRef; winner: boolean }) {
  return (
    <span className={cn('flex items-center gap-1.5', winner && 'font-bold')}>
      <Crest name={team.name} src={null} className="h-5 w-5" fallbackClassName="text-[8px]" />
      <TeamNameLink name={team.name} leagueId={leagueId} teamId={team.id} className="text-ink" />
    </span>
  )
}

/**
 * The manual edit (§11.7 "drag Team A ↔ Team C for Week 7" — as two selects
 * with a tap twin for every drag, the L.D5.1 posture). The reason is always
 * offered and never required (Q66 / F361); a refusal that names the reason
 * (the 500-character bound) still marks the field.
 */
export function EditMatchupForm({
  leagueId,
  row,
  teams,
  onClose,
}: {
  leagueId: string
  row: MatchupCell
  teams: TeamRef[]
  onClose: () => void
}) {
  const edit = useEditMatchup(leagueId)
  const [home, setHome] = useState(row.home.id)
  const [away, setAway] = useState(row.away?.id ?? '')
  const [reason, setReason] = useState('')
  const problem = editFormProblem(row, home, away)
  const refusal = edit.isError ? (edit.error instanceof Error ? edit.error.message : 'The edit was refused.') : null
  const reasonRefused = refusal !== null && /reason/i.test(refusal)
  const applied: EditMatchupResult | null = edit.data ?? null

  if (applied) {
    return (
      <div className="flex flex-col gap-1" data-edit-applied>
        <StatusBanner tone="accent">
          <strong>Matchup edited.</strong> <span className="fs-num">{applied.rows_changed}</span> row
          {applied.rows_changed === 1 ? '' : 's'} changed — the grid re-read the server’s pairings.
        </StatusBanner>
        <p className="text-[11px] font-medium text-n-3" data-system-post>
          Posted to league chat: {applied.system_post}
        </p>
        <span>
          <Button variant="stroke" size="sm" onClick={onClose}>
            Done
          </Button>
        </span>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-n-4 pt-2"
      data-edit-form
      onSubmit={(e) => {
        e.preventDefault()
        if (problem) return
        edit.edit({ matchup_id: row.id, home_team_id: home, away_team_id: away, reason: reason.trim() || null })
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
          Home
          <Select value={home} onValueChange={setHome}>
            <SelectTrigger className="h-btn-md px-2 text-[12px]" data-edit-home>
              <SelectValue placeholder="Home team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
          Away
          <Select value={away} onValueChange={setAway}>
            <SelectTrigger className="h-btn-md px-2 text-[12px]" data-edit-away>
              <SelectValue placeholder="Away team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
        Reason{reasonRefused ? ' (see the refusal below)' : ' (optional — posted to league chat if you give one)'}
        <Input
          className={cn('h-btn-md px-2 text-[12px]', reasonRefused && 'border-negative')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Why this pairing changes"
          aria-invalid={reasonRefused || undefined}
          data-edit-reason
        />
      </label>
      {problem && (
        <p className="text-[11px] font-medium text-n-3" data-edit-problem>
          {problem}
        </p>
      )}
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-2 py-1 text-[12px] font-semibold text-ink">
          {refusal}
        </p>
      )}
      <p className="text-[10px] font-medium text-n-3">
        The displaced teams are re-paired for you so every team still plays once this week.
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="blue" size="sm" disabled={problem !== null || edit.isPending} data-edit-save>
          {edit.isPending ? 'Saving…' : 'Save pairing'}
        </Button>
        <Button type="button" variant="stroke" size="sm" onClick={onClose} disabled={edit.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ScheduleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Schedule" />
      <GridSkeleton />
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-skeleton="schedule-grid">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-sm" />
      ))}
    </div>
  )
}
