'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'

import { formatKickoff } from '@/components/leagues/lineup-editor-ops'
import { scoreCell, splitRows, teamName } from '@/components/leagues/matchup-view-ops'
import { CenteredNote, SkeletonBlocks, StatusLine, useChipRowInView } from '@/components/mobile/league/league/league-bits'
import { sideScore, sidesOf } from '@/components/mobile/league/match/match-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'
import { useMatchupsLive } from '@/hooks/use-matchups'
import { useMobileTeamGames, type MobileWeekGame } from '@/hooks/use-mobile-team-games'
import { useNflGameBox } from '@/hooks/use-nfl-game-box'
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { boxGroups, emptyBoxCopy, gameIdFromSegment, gameStatus, listedByCurrentTeam, nflGameHref, scoreText, type BoxGroup, type GameStatus, type NflGameRow } from './game-ops'

/**
 * The NFL game screen (gap list §3 #17; handoff m-match §2.3 "Live game
 * feed", single game, Box score), opened from a starter's game line on the
 * Match and Team tabs.
 *
 * Top to bottom, as the handoff draws it: the 52px bar (Back, then your
 * matchup's two stored scores), the game picker (every game of that NFL
 * week, this one ringed), the game header (team tiles, scores, the stored
 * quarter and clock or Final or kickoff), then the box score's player
 * groups — Passing, Rushing, Receiving, plus Kicking and Defense so a K or
 * D/ST starter's game shows his line. A row opens that player.
 *
 * Every number is stored: `nfl_games` for the game, `player_stats` for the
 * lines, the matchup's stored scores for the strip. Left out because
 * nothing sends them (gap list §2): Play by play (and so the Play by play /
 * Box score toggle and the My players card), the win bar, TV network,
 * records, possession, the field strip and the Team stats table.
 *
 * Switching games in the picker keeps the bar and the picker (and its
 * scroll) on screen: the last game's data stays while the next one loads
 * (`keepPreviousData`), the picker rings the game asked for, and only the
 * body shows as loading. That needs the screen to stay mounted, which a
 * page under `[gameId]` doesn't (Next remounts it per id) — so the route
 * renders it from `games/layout.tsx`, through `NflGameRouteScreen`.
 */
export function NflGameScreen({ leagueId, gameId }: { leagueId: string; gameId: string }) {
  const box = useNflGameBox(gameId)
  const league = useLeague(leagueId)
  const goBack = useGoBack()
  // While the next game loads this is still the last one: the bar and the
  // picker stay week-scoped and right; the body waits for the game asked for.
  const game = box.data?.game ?? null
  // The game just tapped in the picker, until the URL catches up — so the
  // ring moves and the body shows loading on the tap itself.
  const [pick, setPick] = useState<{ from: string; to: string } | null>(null)
  const picked = pick && pick.from === gameId && pick.to !== gameId ? pick.to : null
  const switching = box.isPlaceholderData || picked !== null
  const loading = box.isPending || switching
  const tz = league.data?.settings.draft.time_zone ?? null
  const status = game ? gameStatus(game, formatKickoff(game.kickoff_at, tz).local) : null

  return (
    <MobileScreen
      header={
        <div className="px-3">
          <div className="flex h-[52px] items-center gap-2">
            <RoundNavButton kind="back" onClick={() => goBack(`/app/leagues/${leagueId}/matchup`)} />
            <div className="min-w-0 flex-1">{game && <TopStrip leagueId={leagueId} game={game} pending={switching} />}</div>
            <span className="w-9 flex-none" aria-hidden />
          </div>
          {game && <GamePicker leagueId={leagueId} ringedId={picked ?? gameId} game={game} tz={tz} onPicked={(to) => setPick({ from: gameId, to })} />}
        </div>
      }
    >
      <div className="border-t border-m-b3 leading-[normal] tabular-nums" data-nfl-game={gameId}>
        {loading ? (
          <div className="px-3.5 pt-3.5" data-skeleton="game">
            <SkeletonBlocks count={5} className="h-11" />
          </div>
        ) : !box.data ? (
          <CenteredNote role="alert" message="Couldn’t load this game." action="Try again" onAction={() => void box.refetch()} />
        ) : !game || !status ? (
          <CenteredNote message="Couldn’t find this game." action="Back to Match" href={`/app/leagues/${leagueId}/matchup`} />
        ) : (
          <>
            {/* A live re-poll that failed keeps the last read on screen, and says so. */}
            {box.isError && (
              <div className="px-3.5 pt-3">
                <StatusLine tone="caution">Couldn’t refresh this game — showing the last update.</StatusLine>
              </div>
            )}
            <GameHeader game={game} status={status} tz={tz} />
            <BoxScore
              leagueId={leagueId}
              groups={boxGroups(game, box.data.players, box.data.lines)}
              status={status}
              byCurrentTeam={listedByCurrentTeam(game, status, box.data.players, box.data.lines)}
            />
          </>
        )}
      </div>
    </MobileScreen>
  )
}

/** The route's screen: the game id from the URL (`[gameId]`), read here
 *  because `games/layout.tsx` sits above that segment. */
export function NflGameRouteScreen({ leagueId }: { leagueId: string }) {
  const raw: unknown = useParams<{ gameId: string }>()?.gameId
  if (typeof raw !== 'string' || raw === '') return null
  return <NflGameScreen leagueId={leagueId} gameId={gameIdFromSegment(raw)} />
}

// ---------------------------------------------------------------------------
// The bar — your matchup's stored scores (the handoff's strip), else the game
// ---------------------------------------------------------------------------

function TopStrip({ leagueId, game, pending }: { leagueId: string; game: NflGameRow; pending: boolean }) {
  const { user } = useAuth()
  const league = useLeague(leagueId)
  const myTeamId = league.data?.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  // The league's week IS the NFL week (one season, one numbering) — only a
  // game of the league's own season has a matchup to show.
  const sameSeason = league.data?.league.season === game.season
  // The matchup strip is the week's, so it holds while the next game of
  // that week loads; the game's own title waits for that game.
  const title = pending ? '\u00a0' : `${game.away_team} @ ${game.home_team}`
  if (!myTeamId || !sameSeason) return <GameTitle title={title} />
  return <MatchStrip leagueId={leagueId} week={game.week} myTeamId={myTeamId} title={title} />
}

function GameTitle({ title }: { title: string }) {
  return <p className="truncate text-center text-[16px] font-semibold text-m-t1">{title}</p>
}

function MatchStrip({ leagueId, week, myTeamId, title }: { leagueId: string; week: number; myTeamId: string; title: string }) {
  const matchups = useMatchupsLive(leagueId, week)
  const doc = matchups.data
  const row = doc ? (splitRows(doc.matchups).primary.find((m) => m.home_team_id === myTeamId || m.away_team_id === myTeamId) ?? null) : null
  const sides = row ? sidesOf(row, myTeamId) : null
  if (!doc || !row || !sides?.b) return <GameTitle title={title} />
  const side = (teamId: string, mirror: boolean) => {
    const score = scoreCell(sideScore(row, teamId), row.status)
    return (
      <div className={cn('flex min-w-0 flex-col', !mirror && 'items-end')} data-strip-team={teamId}>
        <span className="max-w-full truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{teamName(doc, teamId)}</span>
        <span className={cn('text-[16px] font-semibold', score.pending ? 'text-m-t3' : 'text-m-t1')} title={score.title ?? undefined}>
          {score.text}
        </span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)] items-center gap-2" data-match-strip={row.id}>
      {side(sides.a, false)}
      {/* The handoff's win bar needs a win-probability model (gap list §2). */}
      <span className="text-center text-[11px] font-semibold text-m-t3">vs</span>
      {side(sides.b, true)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The game picker — every game of the week, this one ringed
// ---------------------------------------------------------------------------

/** `game` is the week's source (the last game while the next loads — same
 *  week); `ringedId` is the game asked for, and the one ringed. */
function GamePicker({
  leagueId,
  ringedId,
  game,
  tz,
  onPicked,
}: {
  leagueId: string
  ringedId: string
  game: NflGameRow
  tz: string | null
  onPicked: (gameId: string) => void
}) {
  const router = useRouter()
  const games = useMobileTeamGames(game.season, game.week)
  const rows = games.data ?? []
  // Re-run once the week's games arrive — the row isn't there before.
  const ref = useChipRowInView<HTMLDivElement>(`${ringedId}:${rows.length}`)
  // One game is the header below — a picker of one picks nothing.
  if (rows.length < 2) return <div className="h-1" />
  return (
    <div ref={ref} className="scrollbar-none -mx-3 flex gap-2 overflow-x-auto px-3 pb-3 pt-1" data-game-picker>
      {rows.map((g) => (
        <PickerCard
          key={g.id}
          game={g}
          on={g.id === ringedId}
          tz={tz}
          // Replace, not push: Back still goes to where the game was opened.
          onPick={() => {
            onPicked(g.id)
            router.replace(nflGameHref(leagueId, g.id), { scroll: false })
          }}
        />
      ))}
    </div>
  )
}

function PickerCard({ game, on, tz, onPick }: { game: MobileWeekGame; on: boolean; tz: string | null; onPick: () => void }) {
  const status = gameStatus(game, formatKickoff(game.kickoff_at, tz).local)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={cn('flex w-[130px] flex-none flex-col gap-1.5 rounded-[14px] px-3 py-2.5 text-left', on ? 'bg-m-gb ring-[1.5px] ring-inset ring-accent' : 'bg-m-b1')}
      data-picker-game={game.id}
    >
      <span className="flex items-center justify-between gap-1.5 text-[13px] font-semibold text-m-t1">
        <span className="whitespace-nowrap">{game.away_team}</span>
        <span>{scoreText(status, game.away_score)}</span>
      </span>
      <span className="flex items-center justify-between gap-1.5 text-[13px] font-semibold text-m-t1">
        <span className="whitespace-nowrap">{game.home_team}</span>
        <span>{scoreText(status, game.home_score)}</span>
      </span>
      <span className={cn('truncate whitespace-nowrap text-[11px] font-medium', status.state === 'live' ? 'text-negative-strong' : 'text-m-t3')}>{status.text}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// The game header — tiles, scores, the stored state
// ---------------------------------------------------------------------------

function TeamTile({ team }: { team: string }) {
  const color = NFL_TEAM_COLORS[team]?.primary
  return (
    <span
      className={cn('flex size-[34px] flex-none items-center justify-center rounded-[10px] text-[11px] font-semibold text-white', !color && 'bg-m-ink')}
      // A team colour is data (the app's NFL team colour table), not a theme value.
      style={color ? { backgroundColor: color } : undefined}
    >
      {team}
    </span>
  )
}

function GameHeader({ game, status, tz }: { game: NflGameRow; status: GameStatus; tz: string | null }) {
  const away = scoreText(status, game.away_score)
  const home = scoreText(status, game.home_score)
  const title = status.state === 'scheduled' ? (formatKickoff(game.kickoff_at, tz).title ?? undefined) : undefined
  return (
    <div className="flex flex-col gap-3 border-b border-m-b2 px-3.5 pb-2.5 pt-3.5" data-game-header data-game-state={status.state}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
        <div className="flex items-center gap-2" data-game-side="away">
          <TeamTile team={game.away_team} />
          {away && <span className="text-[24px] font-semibold tracking-[-0.02em]">{away}</span>}
        </div>
        <span
          className={cn('flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold', status.state === 'live' ? 'text-negative-strong' : 'text-m-t3')}
          title={title}
          data-game-status
        >
          {status.state === 'live' && <span className="size-1.5 rounded-full bg-negative-strong" aria-hidden />}
          {status.text}
        </span>
        <div className="flex items-center justify-end gap-2" data-game-side="home">
          {home && <span className="text-[24px] font-semibold tracking-[-0.02em]">{home}</span>}
          <TeamTile team={game.home_team} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The box score — one table per group (handoff §2.3 5)
// ---------------------------------------------------------------------------

/** "minmax(0,1fr) 44px…" — one 44px column per stat (literal for Tailwind). */
const GRID: Record<number, string> = {
  2: 'grid-cols-[minmax(0,1fr)_repeat(2,44px)]',
  3: 'grid-cols-[minmax(0,1fr)_repeat(3,44px)]',
  4: 'grid-cols-[minmax(0,1fr)_repeat(4,44px)]',
}

function BoxScore({ leagueId, groups, status, byCurrentTeam }: { leagueId: string; groups: BoxGroup[]; status: GameStatus; byCurrentTeam: boolean }) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  return (
    <section className="flex flex-col gap-[18px] px-3.5 pb-5 pt-3" aria-labelledby="nfl-game-box" data-box-score>
      <h2 id="nfl-game-box" className="sr-only">
        Box score
      </h2>
      {groups.length === 0 ? (
        <p className="py-8 text-center text-[14px] font-medium text-m-t3" data-empty="box">
          {emptyBoxCopy(status)}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={g.title} className="flex flex-col" data-box-group={g.key}>
            {/* The header row is what sighted readers scan; each row's own
                label names its columns for a screen reader. */}
            <div aria-hidden className={cn('grid gap-1.5 border-b border-m-b3 py-1.5 text-[11px] font-semibold text-m-t3', GRID[g.cols.length])}>
              <span className="text-left">{g.title}</span>
              {g.cols.map((c) => (
                <span key={c} className="text-right">
                  {c}
                </span>
              ))}
            </div>
            {g.rows.map((r) => (
              <button
                key={r.playerId}
                type="button"
                aria-label={r.label}
                onClick={() => openPlayer(r.playerId, leagueId)}
                className={cn('grid w-full items-center gap-1.5 border-b border-m-b2 py-2 text-left active:bg-m-b1', GRID[g.cols.length])}
                data-box-row={r.playerId}
              >
                <span className="truncate whitespace-nowrap text-[13px] font-semibold text-m-t1">{r.name}</span>
                {r.cells.map((c, i) => (
                  <span key={i} className="truncate whitespace-nowrap text-right text-[13px] font-medium text-m-t2">
                    {c}
                  </span>
                ))}
              </button>
            ))}
          </section>
        ))
      )}
      {/* The lines carry no team, so a player who has since changed teams
          would show under the wrong game (`lineInGame`) — say how it's built. */}
      {groups.length > 0 && byCurrentTeam && (
        <p className="text-[11px] font-medium text-m-t3" data-box-note="current-team">
          Players are listed by their current team.
        </p>
      )}
    </section>
  )
}
