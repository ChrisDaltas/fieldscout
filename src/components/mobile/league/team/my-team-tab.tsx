'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import {
  buildEditorModel,
  currentWeekOf,
  defaultLineupWeek,
  keptStarters,
  placementFromStored,
  weekEditability,
} from '@/components/leagues/lineup-editor-ops'
import { projectedTotal, starterIdsOf } from '@/components/leagues/my-team-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { problemCopy } from '@/components/leagues/team-page'
import { DEADLINE_PASSED_TITLE, NOT_IN_SEASON_TRADE_COPY } from '@/components/leagues/trades-ops'
import { waiverSeatCopy } from '@/components/leagues/waiver-claims-ops'
import { movesGate } from '@/components/players/player-card-league-ops'
import { MobileLeagueHeader } from '@/components/mobile/league/league/league-header'
import { transactionsHref } from '@/components/mobile/league/league/league-tab-ops'
import { TradeBuilderOverlay } from '@/components/mobile/trades/trade-builder-overlay'
import { MIcon, type MIconName } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import { useLineup } from '@/hooks/use-lineup'
import { useMobileTeamGames } from '@/hooks/use-mobile-team-games'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { useRostersLive } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { useStandings } from '@/hooks/use-standings'
import { toast } from '@/hooks/use-toast'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { CommishSection } from './commish-section'
import { LineupCheckCard } from './lineup-check'
import { LineupSection } from './lineup-section'
import { PendingClaims } from './moves'
import { TeamAvatar } from './team-avatar'
import { lineupCheckRows, summaryLine, teamOrder, type CheckOpponent } from './team-ops'
import { useRowStats } from './use-row-stats'

/**
 * League › Team tab — YOUR team, mobile (handoff League › Team §2.1, T1–T4):
 * the league header, the team card (name, "2-6 · 11th · PF 12th · PA 10th",
 * projected total, quick actions), Starters with "Tap a position to swap
 * players" and the week navigator, the Bench, and the Swap player sheet.
 *
 * Every number is a server read — standings (record / rank / PF / PA ranks),
 * the stored lineup's projected total, the week's games, OPRK, the box read's
 * points. Moves go through the desktop editor's save path (`useLineupMoves`)
 * with its lock and eligibility rules. Quick actions: Schedule, Trade (the
 * builder against this week's opponent; dimmed with its reason while trades
 * are closed) and Moves (the Transactions screen's "My moves"). Your pending
 * waiver claims (desktop team page) sit under the lineup. Not shown (no data
 * in the app): the win-probability meter, rostered / start %, the News tile
 * (its grid cell stays empty).
 *
 * The Lineup check card (gap list §3 #11; not in the handoff — the desktop
 * team page's check) sits above Starters while the week can still change:
 * starters set N/N, injured and bye starters named (the desktop check's
 * rules), and the projected score against this week's opponent — stored
 * projections summed by the Match card's rule, display only.
 *
 * A failed standings read puts "Couldn’t load the standings." with Try
 * again in the card's record line (gap list §3 #14) — a failed read never
 * reads as "No games played yet". The line holds its height through the
 * first load and through a retry ("Trying…").
 */
export function MyTeamTab({ leagueId, teamId, detail }: { leagueId: string; teamId: string; detail: LeagueDetail }) {
  const team = detail.teams.find((t) => t.id === teamId)!
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const overrideMode = useOverrideMode(leagueId)
  const enterOverride = useCommishOverrideStore((s) => s.enter)
  const exitOverride = useCommishOverrideStore((s) => s.exit)
  const inOverride = overrideMode && isCommish
  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'

  const schedule = useSchedule(leagueId)
  const weeks = useMemo(() => schedule.data?.weeks ?? [], [schedule.data])
  const currentWeek = currentWeekOf(weeks)
  const [pickedWeek, setPickedWeek] = useState<number | null>(null)
  const week = pickedWeek ?? defaultLineupWeek(weeks)
  const lineupWeek = schedule.data ? week : undefined
  const rosters = useRostersLive(leagueId)
  const rosterTeam = rosters.data?.teams.find((t) => t.team_id === teamId) ?? null
  const roster = useMemo(() => rosterTeam?.roster ?? [], [rosterTeam])
  const lineup = useLineup(teamId, lineupWeek)
  const standings = useStandings(leagueId)
  const kept = useMemo(() => keptStarters(lineup.data?.slot_map, roster), [lineup.data, roster])
  const keptIds = useMemo(() => [...kept.values()], [kept])
  const keptIdentity = usePlayersByIds(keptIds)
  const stats = useRowStats({ leagueId, season: detail.league.season, week: lineupWeek, teamId, playerIds: roster.map((p) => p.player_id), withPoints: true })
  // The Trade tile's opponent: THIS week's (not the week being viewed).
  const thisWeek = defaultLineupWeek(weeks)
  const pairing = (schedule.data?.matchups ?? []).find((m) => m.week === thisWeek && m.away_team_id !== null && (m.home_team_id === teamId || m.away_team_id === teamId)) ?? null
  const oppTeamId = pairing ? (pairing.home_team_id === teamId ? pairing.away_team_id : pairing.home_team_id) : null
  const deadline = useTradeDeadline(leagueId)
  const tradesClosed = tradeDeadlinePassed(deadline.data)
  const editability = weekEditability(weeks, week, currentWeek)
  const movesState = movesGate(detail.league.status)
  const waiverWindow = detail.waiver_window ?? null
  const claimsLive = detail.waivers_live !== false && detail.settings.waiver_type !== 'none_fcfs' && waiverWindow?.waivers !== false
  const [builder, setBuilder] = useState(false)

  // The card's projected total: the SAVED starters (the server's arrangement).
  const saved = useMemo(
    () => buildEditorModel(placementFromStored(lineup.data?.slot_map, roster), roster, detail.settings.roster_settings),
    [lineup.data, roster, detail.settings.roster_settings],
  )
  const proj = projectedTotal(saved.starters.map((r) => r.player?.player_id ?? null), stats.proj)

  // The Lineup check: the viewed week's opponent and their stored lineup.
  // The games and projections are the rows' own reads (same query keys).
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const games = useMobileTeamGames(detail.league.season, lineupWeek)
  const values = useLeaguePlayerValues(leagueId, detail.league.season, lineupWeek)
  const weekPairing = (schedule.data?.matchups ?? []).find((m) => m.week === week && (m.home_team_id === teamId || m.away_team_id === teamId)) ?? null
  const weekOppId = weekPairing && weekPairing.away_team_id !== null ? (weekPairing.home_team_id === teamId ? weekPairing.away_team_id : weekPairing.home_team_id) : null
  const oppLineup = useLineup(weekOppId ?? undefined, weekOppId ? lineupWeek : undefined)
  const checkOpponent: CheckOpponent = !weekPairing
    ? null
    : weekOppId === null
      ? { kind: 'bye' }
      : {
          kind: 'opponent',
          name: detail.teams.find((t) => t.id === weekOppId)?.name ?? 'Opponent',
          starterIds: oppLineup.data === undefined ? null : oppLineup.data === null ? [] : starterIdsOf(oppLineup.data.slot_map, detail.settings.roster_settings.ir_slots),
          error: oppLineup.isError && oppLineup.data === undefined,
        }
  // Only while the week can still change, and — in the playoffs — only for a
  // team still playing this week (the Home alert dot's rule).
  const showCheck = inSeason && editability.state === 'open' && !(detail.league.status === 'playoffs' && weekOppId === null)
  const checkRows = showCheck
    ? lineupCheckRows({
        starters: saved.starters,
        kept,
        week,
        games: games.data ?? [],
        projOf: stats.proj,
        projections: values.isError && !values.data ? 'error' : values.isPending ? 'pending' : 'ready',
        opponent: checkOpponent,
      })
    : null
  const anyProj = saved.starters.some((r) => r.player && stats.proj(r.player.player_id) !== null)
  const summary = standings.data ? summaryLine(standings.data.standings, teamId) : null
  // A failed standings read with nothing cached says so, with Try again —
  // never "No games played yet" (gap list §3 #14). A failed refetch over a
  // table already on screen keeps showing that table. Try again on an
  // errored query with no data puts it back to `pending` (React Query v5),
  // so the retry is read from `errorUpdatedAt`: the problem line stays up,
  // reading "Trying…", until the retry lands — no blank line, no jump.
  const standingsRetrying = !standings.data && standings.isPending && standings.errorUpdatedAt > 0
  const standingsFailed = (standings.isError && !standings.data) || standingsRetrying
  const seat = rosterTeam ? waiverSeatCopy(detail.settings, rosterTeam, true) : null

  const sortedWeeks = useMemo(() => [...new Set(weeks.map((w) => w.week))].sort((a, b) => a - b), [weeks])
  const at = sortedWeeks.indexOf(week)
  const weekNav = {
    prev: at > 0 ? sortedWeeks[at - 1] : null,
    next: at >= 0 && at < sortedWeeks.length - 1 ? sortedWeeks[at + 1] : null,
    onWeek: setPickedWeek,
  }

  // Trades closed → the tile stays, dimmed, and says why (never a dead tap).
  const tradeClosedWhy = !inSeason ? NOT_IN_SEASON_TRADE_COPY : tradesClosed ? DEADLINE_PASSED_TITLE : null
  const actions: Array<{ key: string; icon: MIconName; label: string; href?: string; onClick?: () => void; closed?: boolean }> = [
    { key: 'schedule', icon: 'sched', label: 'Schedule', href: `/app/leagues/${leagueId}/schedule` },
    {
      key: 'trade',
      icon: 'trade',
      label: 'Trade',
      closed: tradeClosedWhy !== null,
      onClick: () => (tradeClosedWhy ? toast({ title: tradeClosedWhy }) : setBuilder(true)),
    },
    { key: 'moves', icon: 'trans', label: 'Moves', href: transactionsHref(leagueId, { mine: true }) },
  ]

  return (
    <MobileScreen header={<MobileLeagueHeader leagueName={detail.league.name} leagueId={leagueId} />}>
      {rosters.connection === 'reconnecting' && <Banner>Reconnecting — syncing this league…</Banner>}
      {((rosters.isError && rosters.data) || (lineup.isError && lineup.data !== undefined)) && <Banner>{STALE_LEAGUE_COPY}</Banner>}
      {inOverride && <Banner tone="green">Commissioner override is on — kickoff locks don’t stop your changes, and every change is logged.</Banner>}

      {/* A. Team summary card */}
      <div className="px-3 pt-3">
        <div className="flex flex-col gap-3 rounded-[18px] bg-m-b1 px-[14px] pb-[10px] pt-[14px]" data-team-card>
          <div className="flex items-center gap-[10px]">
            <TeamAvatar teamId={teamId} name={team.name} teamIds={order} myTeamId={teamId} size={44} fontSize={15} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{team.name}</span>
              {standingsFailed ? (
                <span role="alert" className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-m-t3" data-standings-problem>
                  <span className="truncate">Couldn’t load the standings.</span>
                  <button
                    type="button"
                    onClick={() => void standings.refetch()}
                    disabled={standingsRetrying}
                    className="-my-1.5 flex-none py-1.5 font-semibold text-accent disabled:text-m-t3"
                  >
                    {standingsRetrying ? 'Trying…' : 'Try again'}
                  </button>
                </span>
              ) : (
                // The loading placeholder is a NO-BREAK space: a plain one
                // collapses and the line (and the card under it) loses a row.
                <span className="truncate text-[12px] font-medium text-m-t3 tabular-nums">
                  {summary ?? (standings.isPending ? ' ' : inSeason ? 'No games played yet' : 'Season hasn’t started')}
                </span>
              )}
              {seat && <span className="truncate text-[11px] font-medium text-m-t3">{seat}</span>}
            </div>
            <div className="flex flex-none flex-col items-end">
              <span className="text-[11px] font-medium text-m-t3">Proj</span>
              <span className="text-[15px] font-semibold tabular-nums">{anyProj ? proj.total.toFixed(2) : '–'}</span>
            </div>
          </div>
          {/* Four columns as designed (80px tiles); News has no data, so its
              cell stays empty rather than the others stretching. */}
          <div className="grid grid-cols-4 gap-1.5">
            {actions.map((a) => {
              const inner = (
                <>
                  <MIcon name={a.icon} size={16} stroke={1.6} className="text-m-t1" />
                  <span className="text-[11px] font-semibold">{a.label}</span>
                </>
              )
              const cls = cn('flex h-[52px] flex-col items-center justify-center gap-1 rounded-[12px] bg-m-b0 active:bg-m-b2h', a.closed && 'opacity-40')
              return a.href ? (
                <Link key={a.key} href={a.href} className={cls} data-quick-action={a.key}>
                  {inner}
                </Link>
              ) : (
                <button key={a.key} type="button" onClick={a.onClick} aria-disabled={a.closed || undefined} className={cls} data-quick-action={a.key}>
                  {inner}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {rosters.isPending || schedule.isPending || lineup.isPending ? (
        <div className="flex flex-col gap-2 px-3 pt-[18px]" aria-busy="true" data-skeleton="lineup">
          <div className="mx-1 h-10 w-40 rounded-[10px] bg-m-b1" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-[58px] rounded-[14px] bg-m-b1" />
          ))}
        </div>
      ) : rosters.isError && !rosters.data ? (
        <Problem title="Couldn’t load this roster." detail={problemCopy(rosters.error)} onRetry={() => void rosters.refetch()} />
      ) : lineup.isError && lineup.data === undefined ? (
        <Problem title="Couldn’t load this week’s lineup." detail={lineup.error instanceof Error ? lineup.error.message : 'The lineup read failed.'} onRetry={() => void lineup.refetch()} />
      ) : !rosterTeam ? (
        <Problem title="This team has no roster on record." detail="Every team carries a roster once it is seated — none came back for this one." onRetry={() => void rosters.refetch()} />
      ) : (
        <>
          {checkRows && <LineupCheckCard rows={checkRows} onPlayer={(id) => openPlayer(id, leagueId)} />}
          <LineupSection
            key={`${teamId}:${week}`}
            variant="tab"
            leagueId={leagueId}
            teamId={teamId}
            week={week}
            settings={detail.settings.roster_settings}
            roster={roster}
            stored={lineup.data ?? null}
            currentWeek={currentWeek}
            editability={editability}
            canEdit
            overrideMode={inOverride}
            isCommish={isCommish}
            onOverrideMode={(on) => (on ? enterOverride(leagueId) : exitOverride())}
            stats={stats}
            keptName={(id) => keptIdentity.playerById.get(id)?.full_name ?? null}
            weekNav={weekNav}
            drop={{ closedReason: movesState.open ? null : movesState.reason }}
          />
          {lineup.data === null && editability.state === 'open' && (
            <p className="px-4 pb-4 text-[12px] font-medium text-m-t3" role="status">
              Nothing set for week {week} yet — the week opens with last week’s legal lineup carried over.
            </p>
          )}
        </>
      )}

      <PendingClaims leagueId={leagueId} claimsLive={claimsLive} className="px-4 pb-4" />

      {isCommish && (
        <CommishSection
          className="px-4 pb-6 pt-2"
          leagueId={leagueId}
          detail={detail}
          teamId={teamId}
          teamName={team.name}
          rosterTeam={rosterTeam}
          rosters={rosters.data}
          inOverride={inOverride}
          isOwnTeam
        />
      )}

      {builder && <TradeBuilderOverlay leagueId={leagueId} detail={detail} mode="propose" initialTo={oppTeamId} initialGet={[]} onClose={() => setBuilder(false)} />}
    </MobileScreen>
  )
}

function Banner({ children, tone = 'orange' }: { children: React.ReactNode; tone?: 'orange' | 'green' }) {
  return (
    <p role="status" className={cn('mx-3 mt-3 rounded-[12px] px-3 py-2 text-[12px] font-medium', tone === 'green' ? 'bg-m-gg text-m-tg' : 'bg-m-go text-m-to')}>
      {children}
    </p>
  )
}

function Problem({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="text-[13px] font-medium text-m-t3">{detail}</p>
      <button type="button" onClick={onRetry} className="mt-1 h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
        Retry
      </button>
    </div>
  )
}
