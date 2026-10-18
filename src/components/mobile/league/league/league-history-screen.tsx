'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { teamPageHref } from '@/components/leagues/league-cells'
import { managersByTeam } from '@/components/leagues/league-home-season-ops'
import { formatRecord } from '@/components/leagues/standings-table-ops'
import { NO_GAMES_COPY, SEASON_ONLY_COPY, TOTAL_POINTS_COPY } from '@/components/leagues/stats-page-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { teamOrder } from '@/components/mobile/league/team/team-ops'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useScheduleLive } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import { CenteredNote, LeaguePageBar, PageChip, StatusLine, useChipRowInView } from './league-bits'
import {
  historyPoints,
  historyRows,
  historySearch,
  historyTeamFromParam,
  historyTeams,
  historyTotal,
  perGameLine,
  recordHeading,
  recordToneClass,
  seasonLine,
  type HistoryRow,
} from './league-history-ops'

// Opponent · W-L · PF · PA — the handoff's four tracks at 8px gaps.
const GRID = 'grid grid-cols-[minmax(0,1fr)_46px_58px_58px] gap-2'

/**
 * League Menu › League history (handoff m-community G4; gap list §3 #16) —
 * the phone's screen for `/stats`: a 52px bar (blue back chevron, "League
 * history"), the season chip, then one team's season — Record, Points for
 * and Points against cards — and "Head to head": its W-L, PF and PA against
 * every other team, in league order.
 *
 * The same read and numbers as the desktop Stats page (`StatsPage`): the
 * schedule read's STORED results and scores (`league-history-ops`), never a
 * score worked out here. It's your team's history; team chips under the
 * season (yours first, in blue) open any other team's — the desktop page's
 * team picker, kept on the phone. The team rides `?team=` (no navigation),
 * so coming Back from a team you opened lands on the same history.
 *
 * Left out, per gap list §2: the design's Start/sit accuracy card and its
 * All-time and past-season chips — leagues keep one season each, so the
 * Record card takes that row and one line says past seasons aren't kept
 * yet. Each row opens that team; its @manager opens their profile. Back goes
 * to where you came from (the Menu's screen), else the League tab.
 */
export function MobileLeagueHistory({ leagueId }: { leagueId: string }) {
  const detail = useLeague(leagueId)
  const header = <LeaguePageBar leagueId={leagueId} title="League history" />

  if (detail.isPending) {
    return (
      <MobileScreen header={header}>
        <HistorySkeleton />
      </MobileScreen>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <MobileScreen header={header}>
        <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void detail.refetch()} />
      </MobileScreen>
    )
  }
  return (
    <MobileScreen header={header}>
      <HistoryBody leagueId={leagueId} detail={detail.data} />
    </MobileScreen>
  )
}

function HistoryBody({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const schedule = useScheduleLive(leagueId)
  const season = detail.league.season
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  const chips = useMemo(() => historyTeams(detail.teams, myTeamId), [detail.teams, myTeamId])
  const chipIds = useMemo(() => chips.map((t) => t.id), [chips])

  const searchParams = useSearchParams()
  const [picked, setPicked] = useState(() => historyTeamFromParam(searchParams?.get('team'), chipIds))
  const teamId = picked && chipIds.includes(picked) ? picked : (chipIds[0] ?? null)
  // The address follows the chip without a navigation (instant, scroll
  // kept), so a reload or coming Back reopens the same team.
  const choose = (next: string) => {
    setPicked(next)
    const search = historySearch(window.location.search, next, chipIds[0] ?? null)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}`)
  }

  // Back from a team opened here: its chip is in view again.
  const teamRow = useChipRowInView<HTMLDivElement>()

  const rows = useMemo(
    () => (teamId && schedule.data ? historyRows(schedule.data.matchups, teamId, detail.teams, season) : []),
    [teamId, schedule.data, detail.teams, season],
  )
  const total = historyTotal(rows)
  const totalPoints = detail.settings.schedule_mode === 'total_points'
  const reconnecting = schedule.connection === 'reconnecting'

  return (
    <div className="pb-8" data-league-history>
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-3 scrollbar-none" role="group" aria-label="Season" data-history-seasons>
        {/* One season per league for now: its chip is the only one, and on. */}
        <PageChip on onClick={() => undefined}>
          {season}
        </PageChip>
      </div>
      {!totalPoints && chips.length > 1 && (
        <div ref={teamRow} className="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-2 scrollbar-none" role="group" aria-label="Teams" data-history-teams>
          {chips.map((t) => (
            <PageChip key={t.id} on={t.id === teamId} mine={t.id === myTeamId} onClick={() => choose(t.id)} className="max-w-[180px]">
              <span className="truncate">{t.name}</span>
            </PageChip>
          ))}
        </div>
      )}
      {(reconnecting || (schedule.isError && schedule.data)) && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {reconnecting && <StatusLine>Reconnecting — syncing this league…</StatusLine>}
          {schedule.isError && schedule.data && <StatusLine>{STALE_LEAGUE_COPY}</StatusLine>}
        </div>
      )}

      {totalPoints ? (
        <CenteredNote message={TOTAL_POINTS_COPY} />
      ) : schedule.isPending ? (
        <BodySkeleton />
      ) : !schedule.data ? (
        <CenteredNote role="alert" message="Couldn’t load the results." action="Try again" onAction={() => void schedule.refetch()} />
      ) : !teamId ? (
        <CenteredNote message="No teams in this league yet." />
      ) : total.games === 0 ? (
        <CenteredNote message={NO_GAMES_COPY} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 px-4 pt-3" data-history-kpis>
            <Kpi label="Record" value={formatRecord(total)} sub={seasonLine(season)} className="col-span-2" />
            <Kpi label="Points for" value={historyPoints(total.pointsFor, total.games)} sub={perGameLine(total.pointsFor, total.games)} />
            <Kpi label="Points against" value={historyPoints(total.pointsAgainst, total.games)} sub={perGameLine(total.pointsAgainst, total.games)} />
          </div>
          <h2 className="px-4 pb-1.5 pt-[22px] text-[15px] font-semibold text-m-t1">Head to head</h2>
          <div className="px-4">
            <div className={cn(GRID, 'border-b border-m-b3 py-1.5 text-[10px] font-semibold text-m-t3')} role="presentation">
              <span>Opponent</span>
              <span className="text-right">{recordHeading(total)}</span>
              <span className="text-right">PF</span>
              <span className="text-right">PA</span>
            </div>
            <ol aria-label="Head to head">
              {rows.map((row) => (
                <H2HLine
                  key={row.opponentId}
                  row={row}
                  leagueId={leagueId}
                  manager={managers.get(row.opponentId) ?? null}
                  teamIds={order}
                  myTeamId={myTeamId}
                />
              ))}
            </ol>
            <p className="pt-3 text-[11px] font-medium leading-[1.35] text-m-t3">{SEASON_ONLY_COPY}</p>
          </div>
        </>
      )}
    </div>
  )
}

/** A G4 card: 11/600 label, 20/700 value, 11/500 sub-line, on b1. */
function Kpi({ label, value, sub, className }: { label: string; value: string; sub: string | null; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-[3px] rounded-[14px] bg-m-b1 p-3', className)} data-history-kpi={label}>
      <span className="text-[11px] font-semibold text-m-t3">{label}</span>
      <span className="text-[20px] font-bold tracking-[-0.02em] text-m-t1">{value}</span>
      {sub && <span className="text-[11px] font-medium text-m-t3">{sub}</span>}
    </div>
  )
}

/** One opponent: the team's avatar, name over @manager, then W-L, PF, PA.
 *  The row opens that team; the @manager is the door to their profile. */
function H2HLine({
  row,
  leagueId,
  manager,
  teamIds,
  myTeamId,
}: {
  row: HistoryRow
  leagueId: string
  manager: string | null
  teamIds: readonly string[]
  myTeamId: string | null
}) {
  return (
    <li className={cn(GRID, 'relative min-h-[46px] items-center border-b border-m-b2')} data-h2h-row={row.opponentId}>
      <Link href={teamPageHref(leagueId, row.opponentId)} aria-label={row.opponentName} className="absolute inset-0" />
      <span className="flex min-w-0 items-center gap-2">
        <TeamAvatar teamId={row.opponentId} name={row.opponentName} teamIds={teamIds} myTeamId={myTeamId} size={26} fontSize={10} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-m-t1">{row.opponentName}</span>
          <span className="truncate text-[10px] font-medium text-m-t3">
            {manager ? <UsernameLink username={manager} className="relative z-[1]" /> : 'No manager'}
          </span>
        </span>
      </span>
      <span className={cn('text-right text-[13px] font-semibold', recordToneClass(row))} data-h2h-record>
        {formatRecord(row)}
      </span>
      <span className="text-right text-[12px] font-medium tabular-nums text-m-t1" data-h2h-pf>
        {historyPoints(row.pointsFor, row.games)}
      </span>
      <span className="text-right text-[12px] font-medium tabular-nums text-m-t3" data-h2h-pa>
        {historyPoints(row.pointsAgainst, row.games)}
      </span>
    </li>
  )
}

function BodySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        <span className="col-span-2 h-[76px] animate-pulse rounded-[14px] bg-m-b1" />
        <span className="h-[76px] animate-pulse rounded-[14px] bg-m-b1" />
        <span className="h-[76px] animate-pulse rounded-[14px] bg-m-b1" />
      </div>
      <div className="px-4 pt-[22px]">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex min-h-[46px] items-center gap-2 border-b border-m-b2">
            <span className="size-[26px] flex-none animate-pulse rounded-full bg-m-b1" />
            <span className="h-4 flex-1 animate-pulse rounded-[6px] bg-m-b1" />
            <span className="h-3 w-24 flex-none animate-pulse rounded-[4px] bg-m-b1" />
          </div>
        ))}
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div data-league-history="loading">
      <div className="flex gap-1.5 overflow-hidden px-4 pb-1 pt-3">
        <span className="h-8 w-[62px] flex-none animate-pulse rounded-pill bg-m-b1" />
      </div>
      <BodySkeleton />
    </div>
  )
}
