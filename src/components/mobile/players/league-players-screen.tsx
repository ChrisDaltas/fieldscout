'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import { oprkOf, oprkRankedCount, oprkTone, statusTag, type Tone } from '@/components/leagues/my-team-ops'
import { NO_SEAT_COPY, VALUES_PROBLEM_COPY, poolRows, valueCells, valueWeekOf, type PoolPlayerRow } from '@/components/leagues/players-page-ops'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import { tradesHref } from '@/components/leagues/trades-ops'
import { WAIVERS_PAUSED_COPY, windowLine } from '@/components/leagues/waiver-claims-ops'
import { signedDelta } from '@/components/mobile/home/home-ops'
import { MobileLeagueHeader } from '@/components/mobile/league/league/league-header'
import { PlayerMoveSheet, type MoveSheetKind } from '@/components/mobile/player/player-move-sheet'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { acquireLabel, cardLeagueView, type CardLeagueView } from '@/components/players/player-card-league-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { useDefenseSplits } from '@/hooks/use-defense-splits'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeaguePoolLive } from '@/hooks/use-league-pool'
import { useMobileHomeTrending } from '@/hooks/use-mobile-home-trending'
import {
  useMobilePlayerLines,
  useMobilePlayersByIds,
  useMobilePlayersWindow,
  useMobilePlayerUsage,
  useMobilePoolValuesAt,
  useMobileWeekGames,
  type LinesScope,
} from '@/hooks/use-mobile-players-data'
import { LEAGUE_DEFAULTS, useMobilePlayersUI, type LeaguePeriod, type LeagueStatus } from '@/hooks/use-mobile-players-ui'
import { useRostersLive } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { toast } from '@/hooks/use-toast'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { deriveRosterSize } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { ActionCircle, type ActionDoor } from './players-actions'
import { FilterBar, ListHeader, Notice, ProblemState, RowsSkeleton, ShowMore, type FilterPill } from './players-chrome'
import {
  BLANK,
  colNeeds,
  countText,
  gameText,
  NFL_TEAMS,
  num1,
  oprkCell,
  ordinal,
  PAGE,
  POS_OPTIONS,
  posMatches,
  positionsOf,
  shortName,
  sortAfterToggle,
  sortByCell,
  statCells,
  toggleCol,
  weekPointsCell,
  type Cell,
  type ColKey,
  type MPos,
} from './players-ops'
import { ColumnTip, CustomizeSheet } from './players-overlays'
import { TrendingSection, type TrendTile } from './players-trending'
import { PlayersRows, type ViewRow } from './players-views'

/**
 * FieldScout Mobile — League › Players tab (spec m-players): the sticky
 * filter pills (status / period / position / NFL team), the Trending
 * section, the list header, List / Cards / Sheet, the column tip and the
 * Customize stats sheet, and each row's Add / Claim / Drop / Trade — the
 * app's real verbs under the player card's own rules (`cardLeagueView`),
 * confirmed in the mobile profile's own move sheet (`PlayerMoveSheet`).
 *
 * Data (no new backend): the ADP browse window (FLEX / team narrowed
 * server-side) plus EVERY rostered and EVERY on-waivers player (read by id —
 * the pool document names them all, so Waivers and Rostered are complete
 * sets), the rosters and pool documents for who holds whom, the league's
 * scored values (`player-values`), weekly `player_stats` lines, season
 * `player_usage`, the week's games and the defense-vs-position ranks.
 * Trending uses the app's one trend signal (Home's). The Ownership columns
 * (Rost% / +/- / Start%) have no source and are not shown.
 */

const PSTAT: ReadonlyArray<{ value: LeagueStatus; label: string }> = [
  { value: 'all', label: 'All players' },
  { value: 'avail', label: 'Available' },
  { value: 'fa', label: 'Free agents' },
  { value: 'w', label: 'Waivers' },
  { value: 'rost', label: 'Rostered' },
  { value: 'mine', label: 'My team' },
]

const OPRK_TEXT: Record<Tone, string> = {
  positive: 'text-m-green',
  caution: 'text-warn',
  negative: 'text-m-red',
}

/** Trending: Home's risers scanned this deep, my own players dropped, up to
 *  8 tiles (spec §2.2). */
const TREND_SCAN = 40
const TREND_TILES = 8

// Instants read in the viewer's own time, the league's time on hover — the
// app's convention (`formatInstantWithDate`, the desktop availability cell).
const kickoffFmt = (iso: string) => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
}
const weekdayFmt = (iso: string) => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(ms))
}

export function LeaguePlayersScreen({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) {
    return (
      <MobileScreen header={<MobileLeagueHeader leagueName="" />}>
        <RowsSkeleton />
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen header={<MobileLeagueHeader leagueName="" />}>
        <ProblemState
          title="Couldn’t load this league."
          detail={league.error instanceof Error ? league.error.message : null}
          onRetry={() => void league.refetch()}
        />
      </MobileScreen>
    )
  }
  return <LeaguePlayersBody key={leagueId} leagueId={leagueId} detail={league.data} />
}

function LeaguePlayersBody({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const router = useRouter()
  const { user } = useAuth()
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const ui = useMobilePlayersUI((s) => s.league)
  const setUi = useMobilePlayersUI((s) => s.setLeague)
  const [menu, setMenu] = useState<string | null>(null)
  const [tip, setTip] = useState<ColKey | null>(null)
  const [customize, setCustomize] = useState(false)
  const [move, setMove] = useState<{ kind: MoveSheetKind; player: PoolPlayer } | null>(null)
  const [shown, setShown] = useState(PAGE)

  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const season = detail.league.season
  const tz = detail.settings.draft.time_zone ?? null

  // Home's "Trending players → See all" lands here with ?status=: the status
  // it names, and Trending expanded (spec §4 "Ways in" 2).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status')
    if (status && PSTAT.some((s) => s.value === status)) setUi({ status: status as LeagueStatus, trendOpen: true })
  }, [setUi])

  const rosters = useRostersLive(leagueId)
  const pool = useLeaguePoolLive(leagueId)
  const schedule = useSchedule(leagueId)
  const weeks = useMemo(() => schedule.data?.weeks ?? [], [schedule.data])
  const week = valueWeekOf(weeks)
  const hasWeek = (w: number) => weeks.some((x) => x.week === w)
  const deadline = useTradeDeadline(leagueId)

  // Period — "Week N · Week N−1 · Season · <last season>" (spec §2.1).
  const periods: Array<{ value: LeaguePeriod; label: string }> = [
    ...(week !== undefined ? [{ value: 'w' as const, label: `Week ${week}` }] : []),
    ...(week !== undefined && hasWeek(week - 1) ? [{ value: 'lw' as const, label: `Week ${week - 1}` }] : []),
    { value: 'season', label: 'Season' },
    { value: 'prior', label: String(season - 1) },
  ]
  const defaultPer: LeaguePeriod = week !== undefined ? 'w' : 'season'
  const per: LeaguePeriod = periods.some((p) => p.value === ui.per) ? ui.per : defaultPer
  const status: LeagueStatus = ui.status === 'mine' && !myTeamId ? 'avail' : ui.status
  const rosteredOnly = status === 'rost' || status === 'mine'
  // Which reads make up the status's universe: the ADP window (free agents
  // can only be browsed), and the complete by-id sets.
  const usesWindow = status === 'all' || status === 'avail' || status === 'fa'
  const usesRostered = status === 'all' || rosteredOnly
  const usesWaivers = status === 'all' || status === 'avail' || status === 'w'
  const team = ui.team === 'All' ? null : ui.team

  const windowQ = useMobilePlayersWindow(positionsOf(ui.pos), team)
  // Every rostered player (the rosters document) and every player on
  // waivers (the pool document's `on_waivers` rows), whatever their ADP.
  const { rosteredIds, waiverIds } = useMemo(() => {
    const held = (rosters.data?.teams ?? []).flatMap((t) => t.roster.map((p) => p.player_id))
    const heldSet = new Set(held)
    const onWaivers = (pool.data ?? []).filter((r) => r.state === 'on_waivers' && r.waivers_until !== null && !heldSet.has(r.player_id)).map((r) => r.player_id)
    return { rosteredIds: held, waiverIds: onWaivers }
  }, [rosters.data, pool.data])
  const rostered = useMobilePlayersByIds(rosteredIds)
  const waivers = useMobilePlayersByIds(waiverIds)

  const filtered: PoolPlayerRow[] = useMemo(() => {
    const byId = new Map<string, PoolPlayer>()
    const keep = (p: PoolPlayer) => posMatches(ui.pos, p.position) && (!team || p.team === team)
    // A by-id read is used only for the ids it is asked for NOW (its
    // placeholder may still hold the previous id set's rows).
    const add = (list: readonly PoolPlayer[] | undefined, only?: ReadonlySet<string>) => {
      for (const p of list ?? []) if (keep(p) && (!only || only.has(p.id))) byId.set(p.id, p)
    }
    if (usesWindow) add(windowQ.data)
    if (usesWaivers) add(waivers.data, new Set(waiverIds))
    if (usesRostered) add(rostered.data, new Set(rosteredIds))
    const universe = [...byId.values()].sort(
      (a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id),
    )
    return poolRows(universe, rosters.data, pool.data ?? [], myTeamId, 'all').filter((r) => {
      const a = r.availability
      switch (status) {
        case 'all':
          return true
        case 'avail':
          return a.kind !== 'rostered'
        case 'fa':
          return a.kind === 'free_agent'
        case 'w':
          return a.kind === 'on_waivers'
        case 'rost':
          return a.kind === 'rostered'
        case 'mine':
          return a.kind === 'rostered' && a.mine
      }
    })
  }, [windowQ.data, waivers.data, rostered.data, waiverIds, rosteredIds, rosters.data, pool.data, myTeamId, status, usesWindow, usesWaivers, usesRostered, ui.pos, team])

  const ids = useMemo(() => filtered.map((r) => r.player.id), [filtered])
  const needs = colNeeds(ui.cols, ui.sort)
  const showsPoints = [...ui.cols, ui.sort].some((k) => k === 'proj' || k === 'avg' || k === 'tot')
  // League points exist for this season only; the prior season reads none.
  const valuesNow = useMobilePoolValuesAt(leagueId, needs.values && per !== 'prior' ? week : undefined, ids)
  const valuesNext = useMobilePoolValuesAt(
    leagueId,
    needs.values && per === 'w' && week !== undefined && hasWeek(week + 1) ? week + 1 : undefined,
    ids,
  )
  const valuesPrev = useMobilePoolValuesAt(leagueId, needs.values && per === 'lw' && week !== undefined ? week - 1 : undefined, ids)
  const linesScope: LinesScope | null = !needs.lines
    ? null
    : per === 'w' && week !== undefined
      ? { season, week }
      : per === 'lw' && week !== undefined
        ? { season, week: week - 1 }
        : per === 'prior'
          ? { season: season - 1 }
          : week !== undefined
            ? { season, beforeWeek: week }
            : { season }
  const lines = useMobilePlayerLines(linesScope, ids)
  const usage = useMobilePlayerUsage(needs.usage ? (per === 'prior' ? season - 1 : season) : undefined, ids)
  const games = useMobileWeekGames(season, week)
  const splits = useDefenseSplits(season)

  // Who manages each team — "@handle" on another roster's row (a username
  // always links to the profile — D462).
  const handleOf = useMemo(() => {
    const byUser = new Map(detail.members.filter((m) => m.user_id).map((m) => [m.user_id!, m.profiles?.username ?? null]))
    return new Map((rosters.data?.teams ?? []).map((t) => [t.team_id, t.manager_user_id ? (byUser.get(t.manager_user_id) ?? null) : null]))
  }, [detail.members, rosters.data])

  /** "{game} " + the tinted OPRK ordinal, or null off the record. */
  const gameOf = (p: PoolPlayer) => {
    const splitRows = splits.data ?? []
    const g = gameText(p.team, games.data ?? [], kickoffFmt)
    const oprk = g?.opp ? oprkOf(splitRows, g.opp, p.position) : null
    const tone = oprk !== null ? oprkTone(oprk, oprkRankedCount(splitRows, p.position)) : null
    return { g, oprk, tone }
  }

  type Built = { row: PoolPlayerRow; view: ViewRow }
  const built: Built[] = useMemo(() => {
    return filtered.map((row) => {
      const p = row.player
      const now = valuesNow.byPlayer.get(p.id)
      const v = valueCells(now)
      // What each period means (spec §5 "What the period filter changes"):
      // Week N / N−1 — that week's projection and points; Season — this
      // week's projection, the points before it; the prior season — no
      // league points at all (a notice says so), box stats only.
      const proj: Cell = per === 'lw' ? num1(valuesPrev.byPlayer.get(p.id)?.projected_points) : per === 'prior' ? BLANK : num1(v.proj)
      const tot: Cell =
        per === 'w' ? weekPointsCell(now, valuesNext.byPlayer.get(p.id)) : per === 'lw' ? weekPointsCell(valuesPrev.byPlayer.get(p.id), now) : per === 'season' ? num1(v.season) : BLANK
      const { g, oprk, tone } = gameOf(p)
      const cells: Partial<Record<ColKey, Cell>> = {
        proj,
        avg: per === 'prior' ? BLANK : num1(v.avg),
        tot,
        oprk: oprkCell(oprk, tone),
        ...statCells(p.position, lines.data?.get(p.id) ?? null, usage.data?.get(p.id) ?? null),
      }
      const gameNode = g ? (
        <>
          {g.text}
          {oprk !== null && tone && (
            <>
              {' '}
              <span className={cn('font-semibold', OPRK_TEXT[tone])}>({ordinal(oprk)})</span>
            </>
          )}
        </>
      ) : null
      const a = row.availability
      const handle = a.kind === 'rostered' && !a.mine ? (handleOf.get(a.teamId) ?? null) : null
      const own =
        a.kind === 'free_agent' ? (
          'Free agent'
        ) : a.kind === 'on_waivers' ? (
          <span title={formatInstantWithDate(a.until, tz).title ?? undefined}>{`Waivers · ${weekdayFmt(a.until)}`}</span>
        ) : a.mine ? (
          'Your team'
        ) : handle ? (
          <span onClick={(e) => e.stopPropagation()}>
            <UsernameLink username={handle} />
          </span>
        ) : (
          a.teamName
        )
      return {
        row,
        view: {
          id: p.id,
          player: p,
          short: shortName(p.full_name, p.position),
          status: statusTag(p.status),
          line2: own,
          line3: gameNode,
          cardLine: gameNode ? (
            <>
              {gameNode} · {own}
            </>
          ) : (
            own
          ),
          cells,
        },
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameOf reads only games.data / splits.data
  }, [filtered, valuesNow.byPlayer, valuesNext.byPlayer, valuesPrev.byPlayer, per, games.data, splits.data, lines.data, usage.data, handleOf, tz])

  const sorted = useMemo(() => sortByCell(built, (b) => b.view.cells[ui.sort] ?? BLANK), [built, ui.sort])
  const filterKey = `${status}|${per}|${ui.pos}|${ui.team}|${ui.sort}`
  useEffect(() => setShown(PAGE), [filterKey])
  const visible = sorted.slice(0, shown)
  const rowById = useMemo(() => new Map(visible.map((b) => [b.view.id, b.row])), [visible])

  // ---- doors ----
  // The card's own derivation decides each door (computed only for the rows
  // and tiles on screen).
  const rosterSize = deriveRosterSize(detail.settings.roster_settings)
  const nextRun = detail.waiver_window?.next_run_at ?? null
  const tradesClosed = tradeDeadlinePassed(deadline.data)
  const viewOf = (player: PoolPlayer): CardLeagueView =>
    cardLeagueView({
      player,
      leagueName: detail.league.name,
      leagueStatus: detail.league.status,
      rosters: rosters.data,
      pool: pool.data ?? [],
      myTeamId,
      rosterSize,
      waiverType: detail.settings.waiver_type,
      waiverWindow: detail.waiver_window ?? null,
      claimsLive: detail.waivers_live !== false,
      tradesClosed,
      minBid: detail.settings.faab_min_bid,
      nextRunLocal: nextRun ? formatInstantWithDate(nextRun, tz).local : null,
      formatInstant: (iso) => formatInstantWithDate(iso, tz).local,
    })

  const say = (reason: string | undefined) => toast({ title: reason ?? 'Not available right now.' })
  const doorFor = (row: PoolPlayerRow): ActionDoor | null => {
    if (!myTeamId) return null
    const player = row.player
    const v = viewOf(player)
    const name = player.full_name
    if (v.kind === 'mine') {
      const reason = v.drop.open ? null : v.drop.reason
      return {
        kind: 'drop',
        closed: reason !== null,
        label: reason !== null ? `Can’t drop ${name} — ${reason}` : `Drop ${name}`,
        onPress: () => (reason === null ? setMove({ kind: 'drop', player }) : say(reason)),
      }
    }
    if (v.kind === 'theirs') {
      const reason = v.trade.open ? null : v.trade.reason
      const teamId = v.teamId
      return {
        kind: 'trade',
        closed: reason !== null,
        label: reason !== null ? `Can’t trade for ${name} — ${reason}` : `Propose a trade for ${name}`,
        onPress: () => (reason === null ? router.push(tradesHref(leagueId, { teamId, playerId: player.id })) : say(reason)),
      }
    }
    if (v.kind === 'available') {
      const acq = v.acquire
      return {
        kind: acq.kind === 'none' ? (row.availability.kind === 'on_waivers' ? 'claim' : 'add') : acq.kind,
        closed: acq.disabled,
        label: acquireLabel(acq.kind, name, acq.disabled ? acq.title : undefined),
        onPress: () => (acq.disabled ? say(acq.title) : setMove({ kind: 'acquire', player })),
      }
    }
    return null
  }
  const renderAction = (vr: ViewRow, size: 28 | 22) => {
    const row = rowById.get(vr.id)
    const door = row ? doorFor(row) : null
    return door ? <ActionCircle door={door} size={size} /> : null
  }

  // ---- Trending (spec §2.2) ----
  const showTrend = (status === 'all' || status === 'avail' || status === 'fa' || status === 'w') && ui.team === 'All'
  const trend = useMobileHomeTrending(TREND_SCAN)
  const trendRows = useMemo(() => {
    const mine = new Set((rosters.data?.teams ?? []).filter((t) => t.team_id === myTeamId).flatMap((t) => t.roster.map((p) => p.player_id)))
    const entries = trend.risers.filter((e) => !mine.has(e.player.id)).slice(0, TREND_TILES)
    const players: PoolPlayer[] = entries.map((e) => ({ ...e.player, adp: null }))
    const rows = new Map(poolRows(players, rosters.data, pool.data ?? [], myTeamId, 'all').map((r) => [r.player.id, r]))
    return entries.flatMap((e) => {
      const row = rows.get(e.player.id)
      return row ? [{ row, delta: e.delta }] : []
    })
  }, [trend.risers, rosters.data, pool.data, myTeamId])
  const trendIds = useMemo(() => trendRows.map((t) => t.row.player.id), [trendRows])
  const trendValues = useMobilePoolValuesAt(leagueId, showTrend ? week : undefined, trendIds)
  const tiles: TrendTile[] = trendRows.map(({ row, delta }) => {
    const p = row.player
    const { g } = gameOf(p)
    const projected = trendValues.byPlayer.get(p.id)?.projected_points
    return {
      id: p.id,
      player: p,
      short: shortName(p.full_name, p.position),
      teamLine: [p.team, g?.text].filter(Boolean).join(' · '),
      delta: { text: signedDelta(delta), up: delta >= 0 },
      proj: week !== undefined && trendValues.isPending ? '…' : num1(projected).text,
      door: doorFor(row),
    }
  })

  // ---- pills ----
  const statusLabel = PSTAT.find((s) => s.value === status)?.label ?? 'Available'
  const pills: FilterPill[] = [
    {
      key: 'status',
      label: status === 'all' ? 'All' : statusLabel,
      on: status !== 'all',
      title: 'Show',
      cols: 2,
      options: PSTAT.filter((s) => s.value !== 'mine' || myTeamId).map((s) => ({ value: s.value, label: s.label })),
      value: status,
      canReset: status !== 'avail',
      onPick: (v) => setUi({ status: v as LeagueStatus }),
      onReset: () => setUi({ status: 'avail' }),
    },
    {
      key: 'per',
      label: periods.find((p) => p.value === per)?.label ?? 'Season',
      on: per !== defaultPer,
      title: 'Stats for',
      cols: 2,
      options: periods,
      value: per,
      canReset: per !== defaultPer,
      onPick: (v) => setUi({ per: v as LeaguePeriod }),
      onReset: () => setUi({ per: LEAGUE_DEFAULTS.per }),
    },
    {
      key: 'pos',
      label: ui.pos === 'All' ? 'Position' : ui.pos,
      on: ui.pos !== 'All',
      title: 'Position',
      cols: 4,
      options: POS_OPTIONS.map((p) => ({ value: p, label: p })),
      value: ui.pos,
      canReset: ui.pos !== 'All',
      onPick: (v) => setUi({ pos: v as MPos }),
      onReset: () => setUi({ pos: 'All' }),
    },
    {
      key: 'team',
      label: ui.team === 'All' ? 'Teams' : ui.team,
      on: ui.team !== 'All',
      title: 'NFL team',
      cols: 4,
      options: [{ value: 'All', label: 'All teams' }, ...NFL_TEAMS.map((t) => ({ value: t, label: t }))],
      value: ui.team,
      canReset: ui.team !== 'All',
      onPick: (v) => setUi({ team: v }),
      onReset: () => setUi({ team: 'All' }),
    },
  ]

  // ---- states ----
  const rostersProblem = rosters.isError && !rosters.data
  const poolProblem = pool.isError && !pool.data
  const windowProblem = usesWindow && windowQ.isError && !windowQ.data
  const byIdProblem =
    (usesRostered && rosteredIds.length > 0 && rostered.isError && !rostered.data) || (usesWaivers && waiverIds.length > 0 && waivers.isError && !waivers.data)
  // A failed schedule read is said out loud: without it there is no week,
  // so Proj, points and games would read "–" as if that were the data.
  const scheduleProblem = schedule.isError && !schedule.data
  const noSchedule = schedule.data !== undefined && weeks.length === 0
  const loading =
    (rosters.isPending && !rosters.data) ||
    (pool.isPending && !pool.data) ||
    (schedule.isPending && !schedule.data) ||
    (usesWindow && windowQ.isPending && !windowQ.data) ||
    (usesRostered && rosteredIds.length > 0 && rostered.isPending && !rostered.data) ||
    (usesWaivers && waiverIds.length > 0 && waivers.isPending && !waivers.data) ||
    valuesNow.isPending ||
    valuesNext.isPending ||
    valuesPrev.isPending ||
    (lines.isPending && lines.isFetching) ||
    (usage.isPending && usage.isFetching)
  // Same period, a changed set of players: the shared rows keep their stats
  // while the rest land — said in the header, not left to read as "–".
  const updating =
    !loading &&
    ((lines.isPlaceholderData && lines.isFetching) ||
      (usage.isPlaceholderData && usage.isFetching) ||
      (usesWindow && windowQ.isPlaceholderData && windowQ.isFetching) ||
      (usesRostered && rostered.isPlaceholderData && rostered.isFetching) ||
      (usesWaivers && waivers.isPlaceholderData && waivers.isFetching))
  const stale = (rosters.isError && rosters.data) || (pool.isError && pool.data)
  const reconnecting = rosters.connection === 'reconnecting' || pool.connection === 'reconnecting'
  const someStatsFailed =
    lines.isError || usage.isError || games.isError || splits.isError || valuesNext.isError || valuesPrev.isError || (showTrend && trendValues.isError)
  const waiverWindow = detail.waiver_window ?? null
  const line = windowLine(waiverWindow, detail.settings, (iso) => formatInstantWithDate(iso, tz).local)
  const truncated = windowQ.full && usesWindow

  const header = (
    <>
      <MobileLeagueHeader leagueName={detail.league.name} leagueId={leagueId} />
      <FilterBar pills={pills} open={menu} onOpenChange={setMenu} />
    </>
  )

  return (
    <MobileScreen header={header}>
      {reconnecting && <Notice>Reconnecting — syncing this league…</Notice>}
      {stale && <Notice tone="caution">{STALE_LEAGUE_COPY}</Notice>}
      {!myTeamId && <Notice>{NO_SEAT_COPY}</Notice>}
      {waiverWindow?.paused && waiverWindow.waivers && <Notice tone="caution">{WAIVERS_PAUSED_COPY}</Notice>}
      {line && line.tone === 'caution' && <Notice tone="caution">{line.text}</Notice>}
      {scheduleProblem && (
        <Notice tone="caution" action={{ label: 'Try again', onClick: () => void schedule.refetch() }}>
          Couldn’t load the league’s schedule — Proj, points and games show “–” until it loads.
        </Notice>
      )}
      {noSchedule && <Notice>No league schedule yet — projections, points and games start once it’s set.</Notice>}
      {valuesNow.isError && (
        <Notice tone="caution" action={{ label: 'Try again', onClick: () => valuesNow.refetch() }}>
          {VALUES_PROBLEM_COPY}
        </Notice>
      )}
      {someStatsFailed && <Notice tone="caution">Some stats couldn’t load — those columns show “–” until they do.</Notice>}
      {per === 'prior' && showsPoints && <Notice>League points aren’t kept for {season - 1} — this period shows box stats only.</Notice>}
      {per === 'w' && week !== undefined && !hasWeek(week + 1) && [...ui.cols, ui.sort].includes('tot') && (
        <Notice>Week {week} is the league’s last scheduled week, so its points (Tot) can’t be shown here.</Notice>
      )}

      {showTrend && rosters.data && pool.data && (
        <TrendingSection
          open={ui.trendOpen}
          onToggle={() => setUi({ trendOpen: !ui.trendOpen })}
          state={trend.isPending ? 'loading' : trend.isError ? 'error' : 'ready'}
          tiles={tiles}
          onOpen={(id) => openPlayerView(id, leagueId)}
          onRetry={() => void trend.refetch()}
        />
      )}

      <ListHeader
        title={status === 'all' ? 'All players' : statusLabel}
        count={loading || rostersProblem || poolProblem || windowProblem || byIdProblem ? null : countText(filtered.length, truncated)}
        updating={updating}
        view={ui.view}
        onView={(view) => setUi({ view })}
        onCustomize={() => setCustomize(true)}
      />

      {rostersProblem ? (
        <ProblemState title="Couldn’t load the rosters." detail={rosters.error instanceof Error ? rosters.error.message : null} onRetry={() => void rosters.refetch()} />
      ) : poolProblem ? (
        <ProblemState title="Couldn’t load the player pool." detail={pool.error instanceof Error ? pool.error.message : null} onRetry={() => void pool.refetch()} />
      ) : windowProblem || byIdProblem ? (
        <ProblemState
          title="Couldn’t load the player list."
          onRetry={() => {
            void windowQ.refetch()
            void rostered.refetch()
            void waivers.refetch()
          }}
        />
      ) : loading ? (
        <RowsSkeleton />
      ) : (
        <>
          <PlayersRows
            view={ui.view}
            rows={visible.map((b) => b.view)}
            cols={ui.cols}
            sort={ui.sort}
            action={myTeamId ? renderAction : undefined}
            onOpen={(row) => openPlayerView(row.id, leagueId)}
            onTip={setTip}
          />
          <ShowMore remaining={sorted.length - visible.length} onMore={() => setShown((n) => n + PAGE)} />
        </>
      )}

      <ColumnTip colKey={tip} surface="league" sort={ui.sort} onSort={(sort) => setUi({ sort })} onClose={() => setTip(null)} />
      <CustomizeSheet
        open={customize}
        onOpenChange={setCustomize}
        surface="league"
        cols={ui.cols}
        onToggle={(key) => {
          const cols = toggleCol(ui.cols, key, 'league')
          setUi({ cols, sort: sortAfterToggle(cols, ui.sort) })
        }}
      />
      {move && (
        <PlayerMoveSheet open onOpenChange={(o) => !o && setMove(null)} kind={move.kind} leagueId={leagueId} player={move.player} />
      )}
    </MobileScreen>
  )
}
