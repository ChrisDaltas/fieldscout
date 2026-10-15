'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { currentWeekOf, defaultLineupWeek, keptStarters, weekEditability } from '@/components/leagues/lineup-editor-ops'
import { problemCopy } from '@/components/leagues/team-page'
import { transactionsHref } from '@/components/mobile/league/league/league-tab-ops'
import { MobileOverrideStrip } from '@/components/mobile/league/override-strip'
import { MOverlay, MOverlayScroll } from '@/components/mobile/trades/m-overlay'
import { TradeBuilderOverlay } from '@/components/mobile/trades/trade-builder-overlay'
import { managerOf } from '@/components/mobile/trades/trades-mobile-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLineup } from '@/hooks/use-lineup'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { useRostersLive } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandings } from '@/hooks/use-standings'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import { CommishSection } from './commish-section'
import { LineupSection } from './lineup-section'
import { MoveRowView, useTeamMoves } from './moves'
import { TeamAvatar } from './team-avatar'
import { ord, recentMoveRows, recordText, streakOf, teamOrder } from './team-ops'
import { useRowStats } from './use-row-stats'

/**
 * Team view — another team, full screen (handoff League › Team §2.3, V1–V4):
 * back chevron; the team's avatar, name and "@manager · league"; Record /
 * Rank / Points for / Streak; Message and Propose trade; this week's
 * starters and bench with projections; Recent moves with See all.
 *
 * Real reads: standings (record, rank, PF), the schedule's decided weeks
 * (streak), the rosters + this week's stored lineup, projections, the
 * activity feed (moves). Propose trade opens the builder over this view —
 * only toward a team with a manager, in season, before the deadline (the
 * desktop team page's door). See all opens the league's Transactions screen
 * filtered to this team. No Message button: direct messages have no backend,
 * so the app can't open a conversation with the manager. A commissioner
 * keeps his team tools here (override mode lets him set this lineup with
 * the same swap sheet).
 */
export function TeamView({ leagueId, teamId, detail }: { leagueId: string; teamId: string; detail: LeagueDetail }) {
  const router = useRouter()
  const { user } = useAuth()
  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push(`/app/leagues/${leagueId}`)
  }
  const team = detail.teams.find((t) => t.id === teamId)!
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const overrideMode = useOverrideMode(leagueId)
  const enterOverride = useCommishOverrideStore((s) => s.enter)
  const exitOverride = useCommishOverrideStore((s) => s.exit)
  const inOverride = overrideMode && isCommish
  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'

  const standings = useStandings(leagueId)
  const schedule = useSchedule(leagueId)
  const weeks = useMemo(() => schedule.data?.weeks ?? [], [schedule.data])
  const currentWeek = currentWeekOf(weeks)
  const [pickedWeek, setPickedWeek] = useState<number | null>(null)
  const week = pickedWeek ?? defaultLineupWeek(weeks)
  const rosters = useRostersLive(leagueId)
  const rosterTeam = rosters.data?.teams.find((t) => t.team_id === teamId) ?? null
  const lineup = useLineup(teamId, schedule.data ? week : undefined)
  const roster = useMemo(() => rosterTeam?.roster ?? [], [rosterTeam])
  const keptIds = useMemo(() => [...keptStarters(lineup.data?.slot_map, roster).values()], [lineup.data, roster])
  const keptIdentity = usePlayersByIds(keptIds)
  const stats = useRowStats({
    leagueId,
    season: detail.league.season,
    week: schedule.data ? week : undefined,
    teamId,
    playerIds: roster.map((p) => p.player_id),
    withPoints: false,
  })
  const moves = useTeamMoves(leagueId, teamId)
  const recent = useMemo(() => recentMoveRows(moves.items, 3), [moves.items])
  // Fewer than three completed moves in the pages read so far, and older
  // pages exist → read on before saying how many there are.
  const needMore = recent.count < 3 && moves.hasNextPage === true
  const { fetchNextPage, isFetchingNextPage, isError: movesError } = moves
  useEffect(() => {
    if (needMore && !isFetchingNextPage && !movesError) void fetchNextPage()
  }, [needMore, isFetchingNextPage, movesError, fetchNextPage])
  const deadline = useTradeDeadline(leagueId)
  const tradesClosed = tradeDeadlinePassed(deadline.data)
  const [builder, setBuilder] = useState(false)

  const mgr = managerOf(detail, teamId)
  const row = standings.data?.standings.find((r) => r.team_id === teamId) ?? null
  const streak = streakOf(schedule.data?.matchups ?? [], teamId)
  const canPropose = myTeamId !== null && myTeamId !== teamId && inSeason && !tradesClosed && rosterTeam !== null && rosterTeam.status !== 'retired' && rosterTeam.manager_user_id !== null
  const editability = weekEditability(weeks, week, currentWeek)
  // The handoff's team view shows this week only; a commissioner in override
  // mode can step weeks to fix one (the desktop page's week picker).
  const sortedWeeks = [...new Set(weeks.map((w) => w.week))].sort((a, b) => a - b)
  const at = sortedWeeks.indexOf(week)
  const weekNav = inOverride
    ? { prev: at > 0 ? sortedWeeks[at - 1] : null, next: at >= 0 && at < sortedWeeks.length - 1 ? sortedWeeks[at + 1] : null, onWeek: setPickedWeek }
    : undefined

  const tiles: Array<{ label: string; value: string; cls: string }> = [
    { label: 'Record', value: row ? recordText(row) : '–', cls: 'text-m-t1' },
    { label: 'Rank', value: row ? ord(row.rank) : '–', cls: 'text-m-t1' },
    { label: 'Points for', value: row ? row.points_for.toFixed(2) : '–', cls: 'text-m-t1' },
    {
      label: 'Streak',
      value: streak?.text ?? '–',
      cls: streak?.kind === 'W' ? 'text-positive-strong' : streak?.kind === 'L' ? 'text-negative-strong' : 'text-m-t1',
    },
  ]

  return (
    <MOverlay label={team.name} onClose={back}>
      <div className="flex h-[52px] flex-none items-center px-3">
        <button type="button" onClick={back} aria-label="Back" className="flex size-9 items-center justify-center rounded-full text-m-t1 active:bg-m-b2">
          <MIcon name="back" size={18} stroke={2} />
        </button>
      </div>
      <MobileOverrideStrip leagueId={leagueId} className="mb-1.5 flex-none" />
      <MOverlayScroll className="px-4 pb-7">
        <div className="flex items-center gap-[14px]">
          <TeamAvatar teamId={teamId} name={team.name} teamIds={order} myTeamId={myTeamId} size={64} fontSize={24} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="truncate text-[22px] font-bold tracking-[-0.02em]">{team.name}</h1>
            <p className="truncate text-[13px] font-medium text-m-t3">
              {mgr ? <UsernameLink username={mgr} className="font-medium" /> : 'No manager'} · {detail.league.name}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-m-b1 p-[10px]">
              <span className={cn('whitespace-nowrap text-[15px] font-bold tabular-nums', t.cls)}>{t.value}</span>
              <span className="whitespace-nowrap text-[10px] font-medium text-m-t3">{t.label}</span>
            </div>
          ))}
        </div>

        {canPropose && (
          <div className="mt-[14px] grid grid-cols-1 gap-2">
            <button type="button" onClick={() => setBuilder(true)} className="flex h-11 items-center justify-center gap-[7px] rounded-pill bg-accent text-[14px] font-semibold text-white" data-propose-trade>
              <MIcon name="trade" size={15} stroke={1.8} />
              Propose trade
            </button>
          </div>
        )}

        {rosters.isPending || schedule.isPending || lineup.isPending ? (
          <div className="mt-[22px] flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[50px] rounded-[14px] bg-m-b1" />
            ))}
          </div>
        ) : (rosters.isError && !rosters.data) || (lineup.isError && lineup.data === undefined) ? (
          <div className="mt-[22px] flex flex-col items-center gap-3 py-6 text-center" role="alert">
            <p className="text-[14px] font-medium text-m-t3">{problemCopy(rosters.error ?? lineup.error)}</p>
            <button type="button" onClick={() => void (rosters.isError ? rosters.refetch() : lineup.refetch())} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
              Retry
            </button>
          </div>
        ) : !rosterTeam ? (
          <p className="mt-[22px] text-[13px] font-medium text-m-t3">This team has no roster on record.</p>
        ) : (
          <LineupSection
            key={`${teamId}:${week}`}
            variant="view"
            leagueId={leagueId}
            teamId={teamId}
            week={week}
            settings={detail.settings.roster_settings}
            roster={roster}
            stored={lineup.data ?? null}
            currentWeek={currentWeek}
            editability={editability}
            canEdit={inOverride}
            overrideMode={inOverride}
            isCommish={isCommish}
            onOverrideMode={(on) => (on ? enterOverride(leagueId) : exitOverride())}
            stats={stats}
            keptName={(id) => keptIdentity.playerById.get(id)?.full_name ?? null}
            weekNav={weekNav}
          />
        )}

        <div className="mt-[22px] flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Recent moves</h2>
          <Link href={transactionsHref(leagueId, { team: teamId })} className="text-[13px] font-semibold text-accent" data-see-all-moves>
            See all
          </Link>
        </div>
        {moves.isError && recent.rows.length === 0 ? (
          <div className="flex items-center gap-3 py-[10px]" role="alert">
            <p className="min-w-0 flex-1 text-[13px] font-medium text-m-t3">Couldn’t load this team’s moves.</p>
            <button type="button" onClick={() => void moves.refetch()} className="h-8 flex-none rounded-pill bg-m-b2 px-3 text-[13px] font-semibold">
              Retry
            </button>
          </div>
        ) : moves.isPending || (needMore && !moves.isError) ? (
          recent.rows.length > 0 ? (
            recent.rows.map((r) => <MoveRowView key={r.id} row={r} leagueId={leagueId} />)
          ) : (
            <div className="mt-2 h-10 rounded-[14px] bg-m-b1" aria-busy="true" />
          )
        ) : recent.rows.length === 0 ? (
          <p className="py-[10px] text-[13px] font-medium text-m-t3">No moves this season</p>
        ) : (
          recent.rows.map((r) => <MoveRowView key={r.id} row={r} leagueId={leagueId} />)
        )}

        {isCommish && (
          <CommishSection
            className="mt-[22px]"
            leagueId={leagueId}
            detail={detail}
            teamId={teamId}
            teamName={team.name}
            rosterTeam={rosterTeam}
            rosters={rosters.data}
            inOverride={inOverride}
            isOwnTeam={false}
          />
        )}
      </MOverlayScroll>

      {builder && <TradeBuilderOverlay leagueId={leagueId} detail={detail} mode="propose" initialTo={teamId} initialGet={[]} onClose={() => setBuilder(false)} />}
    </MOverlay>
  )
}
