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
  recordColumns,
  standingsEmptyCopy,
} from '@/components/leagues/standings-table-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { streakArrowText, streakToneClass, teamStreak } from '@/components/mobile/league/streak-ops'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { UsernameLink } from '@/components/shared/username-link'
import type { LeagueDetail } from '@/hooks/use-league'
import { useTeamOnline } from '@/hooks/use-online'
import { usePlayoffBracketLive } from '@/hooks/use-playoff-bracket'
import { useScheduleLive } from '@/hooks/use-schedule'
import { useProjectedStandingsLive, useStandingsLive } from '@/hooks/use-standings'
import { cn } from '@/lib/utils'

import { CenteredNote, SkeletonBlocks, StatusLine, TeamAvatar } from './league-bits'
import { commishLogHref, extraRecords, playoffNote, teamAvatarClass, tiebreakNote, waiverCell } from './league-tab-ops'
import { MobileBracket } from './mobile-bracket'

// Rank · Team · Waiver · PF/PA — the handoff's four columns at 8px gaps.
// Points Against (gap list #40) sits UNDER points for in the last column
// rather than in a fifth one: a fifth track would take ~45px from the team
// name on a 375px phone, cutting the @manager and the extra records.
const GRID = 'grid grid-cols-[30px_minmax(0,1fr)_64px_50px] gap-2'

// Your own row looks like every other row: the handoff draws "No row
// highlight for your own team" (m-league §2.3). It is told apart by its
// blue avatar alone (the handoff's #0088FF "you" avatar).

type StandingsView = 'final' | 'projected'
const VIEWS: ReadonlyArray<{ value: StandingsView; label: string }> = [
  { value: 'final', label: 'Final' },
  { value: 'projected', label: 'Projected' },
]

/**
 * League › Standings (handoff m-league §2.3): Rank · Team · Waiver · PF · PA
 * over the server's ranked table (117) — the order, record, FAAB left, waiver
 * priority, points for and points against (PA under PF, one column) are
 * the read's. The streak is the
 * one shared count (`streak-ops`, gap list #39). A blue 2px rule sits under
 * the last playoff seed (the league's own playoff-team count) and the footer
 * says so. The whole row opens the team (your own: the Team tab); the
 * @manager is the door to that person's profile. Rank movement since last
 * week is not stored anywhere, so the line under the rank is left out.
 *
 * Gap list #40 (Chris, 2026-10-15) on what belongs on the phone: Points
 * Against shows on every row; the vs-median and second-opponent records
 * show under the team's name only in a league that plays those games (its
 * settings — `recordColumns`, the desktop table's rule), each its own
 * unbreakable piece so the line wraps between them rather than cutting one
 * off; one line under the table says how ties are broken, from the
 * league's own tiebreak order; no Win %.
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
  // Who's online (gap list §3 #25): a team's avatar lights up with its manager.
  const teamOnline = useTeamOnline(detail.members)
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const overridden = useMemo(() => (schedule.data ? overriddenWeeksByTeam(schedule.data.matchups) : null), [schedule.data])
  const doc = standings.data
  const playoffTeams = detail.settings.playoff_teams
  const reconnecting = finalStandings.connection === 'reconnecting' || projected.connection === 'reconnecting'
  const anyOverridden = overridden !== null && (doc?.standings ?? []).some((row) => overridden.has(row.team_id))
  const overridesUnknown = schedule.isError && !schedule.data
  const extras = doc ? recordColumns(doc.standings, detail.settings) : { median: false, second: false }
  const tiebreaks = doc ? tiebreakNote(doc.chain, detail.settings.tiebreakers, doc.schedule_mode) : null

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
            <span className="flex flex-col items-end">
              <span>PF</span>
              <span>PA</span>
            </span>
          </div>
          <ol aria-label="Standings">
            {doc.standings.map((row, i) => {
              const manager = managers.get(row.team_id) ?? null
              const streak = schedule.data ? teamStreak(row.team_id, schedule.data, doc.season) : null
              const extraParts = extraRecords(row, extras)
              const cutoff = playoffTeams > 0 && i + 1 === playoffTeams
              const mine = row.team_id === myTeamId
              const adjustedWeeks = overridden?.get(row.team_id) ?? null
              return (
                <li
                  key={row.team_id}
                  className={cn(GRID, 'relative items-center px-1 py-2.5', cutoff ? 'border-b-2 border-accent' : 'border-b border-m-b2')}
                  data-standings-row={row.team_id}
                  data-mine={mine || undefined}
                >
                  <Link
                    href={teamPageHref(leagueId, row.team_id)}
                    aria-label={mine ? `${row.name} — your team` : row.name}
                    className="absolute inset-0"
                  />
                  <span className="flex flex-col items-center">
                    <span className="text-[15px] font-semibold tabular-nums text-m-t1">{row.rank}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-[9px]">
                    <TeamAvatar name={row.name} size={32} className={teamAvatarClass(row.team_id, teamIds, myTeamId)} online={teamOnline(row.team_id)} />
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
                            <span className={streakToneClass(streak, 'text-m-t3')} data-streak={streakArrowText(streak)}>
                              {streakArrowText(streak)}
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
                      {extraParts.length > 0 && (
                        <span className="flex flex-wrap gap-x-1 text-[11px] font-medium tabular-nums text-m-t3" data-extra-records>
                          {extraParts.map((part, k) => (
                            <span key={part} className="whitespace-nowrap" data-extra-record>
                              {k > 0 && '· '}
                              {part}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="text-right text-[12px] font-medium tabular-nums text-m-t3">{waiverCell(row, detail.settings.waiver_type)}</span>
                  <span className="flex flex-col items-end gap-px tabular-nums">
                    <span className="text-[12px] font-semibold text-m-t1" data-pf>
                      {formatPoints(row.points_for)}
                    </span>
                    <span className="text-[11px] font-medium text-m-t3" data-pa>
                      {formatPoints(row.points_against)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
          <p className={cn('px-1 pt-2.5 text-[11px] font-medium text-m-t3', !tiebreaks && 'pb-2.5')}>
            {doc.schedule_mode === 'total_points' ? POINTS_RACE_COPY : playoffNote(playoffTeams)}
          </p>
          {tiebreaks && (
            <p className="px-1 pb-2.5 pt-1 text-[11px] font-medium leading-[1.35] text-m-t3" data-tiebreak-note>
              {tiebreaks}
            </p>
          )}
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
