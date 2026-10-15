'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { teamPageHref } from '@/components/leagues/league-cells'
import { managersByTeam } from '@/components/leagues/league-home-season-ops'
import { POINTS_RACE_COPY } from '@/components/leagues/playoff-bracket-ops'
import {
  PROJECTED_COPY,
  STANDINGS_OVERRIDDEN_LEGEND,
  STANDINGS_OVERRIDDEN_MARK,
  STANDINGS_OVERRIDES_UNKNOWN_COPY,
  formatPoints,
  formatRecord,
  overriddenTitle,
  overriddenWeeksByTeam,
  standingsEmptyCopy,
} from '@/components/leagues/standings-table-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { UsernameLink } from '@/components/shared/username-link'
import type { LeagueDetail } from '@/hooks/use-league'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useScheduleLive } from '@/hooks/use-schedule'
import { useProjectedStandingsLive, useStandingsLive } from '@/hooks/use-standings'
import { cn } from '@/lib/utils'

import { CenteredNote, SkeletonBlocks, StatusLine, TeamAvatar } from './league-bits'
import { commishLogHref, playoffNote, streakOf, teamAvatarClass, waiverCell } from './league-tab-ops'
import { MobileBracket } from './mobile-bracket'

const GRID = 'grid grid-cols-[30px_minmax(0,1fr)_64px_50px] gap-2'

type StandingsView = 'final' | 'projected'
const VIEWS: ReadonlyArray<{ value: StandingsView; label: string }> = [
  { value: 'final', label: 'Final' },
  { value: 'projected', label: 'Projected' },
]

/**
 * League › Standings (handoff m-league §2.3): Rank · Team · Waiver · PF over
 * the server's ranked table (117) — the order, record, FAAB left, waiver
 * priority and points for are the read's. The streak is read from each
 * team's stored final results. A blue 2px rule sits under the last playoff
 * seed (the league's own playoff-team count) and the footer says so. The
 * whole row opens the team (your own: the Team tab); the @manager is the
 * door to that person's profile. Rank movement since last week is not
 * stored anywhere, so the line under the rank is left out.
 *
 * Kept from the app's standings page (CLAUDE.md — restyle, delete nothing),
 * in the mobile language: the Final | Projected switch (118's projected
 * read — every open week counted as if it ended now), the weeks-counted
 * line, and the ✸ beside a team whose matchup score or result a
 * commissioner set (`matchups.is_overridden`), a door to the commissioner
 * log for that team, with its legend; if that flag could not be read, the
 * table says a ✸ may be missing rather than implying there are none.
 */
export function StandingsSegment({
  leagueId,
  detail,
  myTeamId,
  showBracket,
  onCloseBracket,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  /** `?tab=playoffs` — the bracket ("if the playoffs started today" all season) over the table. */
  showBracket: boolean
  onCloseBracket?: () => void
}) {
  const [view, setView] = useState<StandingsView>('final')
  const finalStandings = useStandingsLive(leagueId)
  const projected = useProjectedStandingsLive(leagueId, view === 'projected')
  const standings = view === 'projected' ? projected : finalStandings
  const schedule = useScheduleLive(leagueId)
  const bracket = usePlayoffBracketLive(leagueId, showBracket)
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const overridden = useMemo(() => (schedule.data ? overriddenWeeksByTeam(schedule.data.matchups) : null), [schedule.data])
  const doc = standings.data
  const playoffTeams = detail.settings.playoff_teams
  const reconnecting = finalStandings.connection === 'reconnecting' || projected.connection === 'reconnecting'
  const anyOverridden = overridden !== null && (doc?.standings ?? []).some((row) => overridden.has(row.team_id))
  const overridesUnknown = schedule.isError && !schedule.data

  return (
    <div className="flex flex-col px-3 pb-5 pt-2" data-standings-segment>
      {(reconnecting || (standings.isError && doc)) && (
        <div className="flex flex-col gap-2 pb-2">
          {reconnecting && <StatusLine>Reconnecting — syncing this league…</StatusLine>}
          {standings.isError && doc && <StatusLine>{STALE_LEAGUE_COPY}</StatusLine>}
        </div>
      )}

      {showBracket && (
        <div className="flex flex-col gap-2 pb-4">
          <div className="flex items-center justify-between gap-3 px-1 pt-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Playoffs</h2>
            {onCloseBracket && (
              <button type="button" onClick={onCloseBracket} className="text-[13px] font-semibold text-accent">
                Hide
              </button>
            )}
          </div>
          <MobileBracket
            doc={bracket.data}
            pending={bracket.isPending}
            problem={bracket.isError}
            onRetry={() => void bracket.refetch()}
            teamNames={teamNames}
            teamIds={teamIds}
            myTeamId={myTeamId}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-1 pb-1.5 pt-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-m-t3" data-weeks-counted>
          {doc ? (
            <>
              <span className="tabular-nums">{doc.weeks_final}</span> week{doc.weeks_final === 1 ? '' : 's'} final
              {doc.projected && (
                <>
                  {' · '}
                  <span className="tabular-nums">{doc.weeks_projected}</span> projected
                </>
              )}
            </>
          ) : null}
        </span>
        <MSegmented
          options={VIEWS}
          value={view}
          onChange={setView}
          label="Standings view"
          className="w-[164px] flex-none gap-0 rounded-pill p-[3px]"
          itemClassName="h-6 rounded-pill text-[12px] font-semibold text-m-t1 transition-none"
          shadow="m-seg-3"
        />
      </div>
      {view === 'projected' && <p className="px-1 pb-2 text-[11px] font-medium leading-[1.35] text-m-t3">{PROJECTED_COPY}</p>}

      {standings.isPending ? (
        <SkeletonBlocks count={8} className="h-[44px]" />
      ) : !doc ? (
        <CenteredNote role="alert" message="Couldn’t load the standings." action="Try again" onAction={() => void standings.refetch()} />
      ) : (
        <>
          {standingsEmptyCopy(doc) && <p className="px-1 pb-2 text-[12px] font-medium text-m-t3">{standingsEmptyCopy(doc)}</p>}
          <div className={cn(GRID, 'border-b border-m-b3 px-1 py-2 text-[11px] font-medium text-m-t3')} role="presentation">
            <span>Rank</span>
            <span>Team</span>
            <span className="text-right">Waiver</span>
            <span className="text-right">PF</span>
          </div>
          <ol aria-label="Standings">
            {doc.standings.map((row, i) => {
              const manager = managers.get(row.team_id) ?? null
              const streak = schedule.data ? streakOf(row.team_id, schedule.data.matchups) : null
              const cutoff = playoffTeams > 0 && i + 1 === playoffTeams
              const adjustedWeeks = overridden?.get(row.team_id) ?? null
              return (
                <li
                  key={row.team_id}
                  className={cn(GRID, 'relative items-center px-1 py-2.5', cutoff ? 'border-b-2 border-accent' : 'border-b border-m-b2')}
                  data-standings-row={row.team_id}
                >
                  <Link
                    href={teamPageHref(leagueId, row.team_id)}
                    aria-label={row.team_id === myTeamId ? `${row.name} — your team` : row.name}
                    className="absolute inset-0"
                  />
                  <span className="flex flex-col items-center">
                    <span className="text-[15px] font-semibold tabular-nums text-m-t1">{row.rank}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-[9px]">
                    <TeamAvatar name={row.name} size={32} className={teamAvatarClass(row.team_id, teamIds, myTeamId)} />
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-[13.5px] font-semibold text-m-t1">{row.name}</span>
                        {adjustedWeeks && (
                          <Link
                            href={commishLogHref(leagueId, { team: row.team_id })}
                            className="relative z-[1] flex-none text-[12px] font-semibold text-m-pos-wr"
                            title={overriddenTitle(adjustedWeeks)}
                            data-overridden={adjustedWeeks.join(',')}
                          >
                            <span aria-hidden="true">{STANDINGS_OVERRIDDEN_MARK}</span>
                            <span className="sr-only">{overriddenTitle(adjustedWeeks)}</span>
                          </Link>
                        )}
                      </span>
                      <span className="truncate whitespace-nowrap text-[11px] font-medium text-m-t3">
                        <span className="tabular-nums">{formatRecord(row)}</span>
                        {streak && (
                          <>
                            {' · '}
                            <span
                              className={cn(
                                streak.tone === 'win' ? 'text-positive-strong' : streak.tone === 'loss' ? 'text-negative-strong' : 'text-m-t3',
                              )}
                            >
                              {streak.text}
                            </span>
                          </>
                        )}
                        {manager && (
                          <>
                            {' · '}
                            <UsernameLink username={manager} className="relative z-[1]" />
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="text-right text-[12px] font-medium tabular-nums text-m-t3">{waiverCell(row, detail.settings.waiver_type)}</span>
                  <span className="text-right text-[12px] font-semibold tabular-nums text-m-t1">{formatPoints(row.points_for)}</span>
                </li>
              )
            })}
          </ol>
          <p className="px-1 py-2.5 text-[11px] font-medium text-m-t3">
            {doc.schedule_mode === 'total_points' ? POINTS_RACE_COPY : playoffNote(playoffTeams)}
          </p>
          {overridesUnknown && (
            <p role="status" className="px-1 pb-2 text-[11px] font-semibold text-m-t1" data-overrides-unknown>
              {STANDINGS_OVERRIDES_UNKNOWN_COPY}
            </p>
          )}
          {anyOverridden && (
            <p className="px-1 pb-2 text-[11px] font-medium leading-[1.35] text-m-t3" data-overridden-legend>
              {STANDINGS_OVERRIDDEN_LEGEND}
            </p>
          )}
        </>
      )}
    </div>
  )
}
