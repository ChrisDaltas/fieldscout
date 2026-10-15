'use client'

import { useMemo } from 'react'

import { MovesCards } from '@/components/mobile/player/profile-leagues'
import {
  careerTable,
  depthChart,
  gameLogTable,
  pastSeasonRules,
  seasonsWithLines,
  type CellKind,
  type StatsTable,
  type TableRow,
} from '@/components/mobile/player/profile-ops'
import type { ScheduleRow } from '@/components/players/player-page-ops'
import { useMobileProfileDepthChart } from '@/hooks/use-mobile-pprofile-depth-chart'
import type { ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import { usePlayerCoreStats } from '@/hooks/use-player-core-stats'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import type { CoreStatsPayload, ScoringChoice } from '@/lib/players/core-stats-ops'
import { cn } from '@/lib/utils'

const COL_W = 46
const STICKY_W = 96

// ---------------------------------------------------------------------------
// Game log (§2.6)
// ---------------------------------------------------------------------------

/**
 * Season chips, then the grouped table. Chips are the current season plus
 * up to two earlier seasons that have stored lines (the prototype's
 * experience-based count, made real). The chosen season is the profile's
 * (`year`) — reset when a profile opens, kept while switching tabs (§3).
 * Fantasy carries Fpts only: weekly Snap % is not stored per week and the
 * weekly position rank is not computed (both gaps).
 */
export function GameLogTab({
  player,
  season,
  year,
  onYear,
  choice,
  core,
  schedule,
  lines,
  linesState,
}: {
  player: PlayerStatsPlayer
  season: number
  year: number
  onYear: (year: number) => void
  choice: ScoringChoice
  core: CoreStatsPayload | null
  schedule: readonly ScheduleRow[]
  lines: readonly ProfileStatLine[]
  linesState: 'loading' | 'error' | 'ready'
}) {
  const years = [season, ...seasonsWithLines(lines, season)].slice(0, 3)
  const table = useMemo(
    () =>
      gameLogTable({
        season: year,
        current: year === season,
        position: player.position,
        lines,
        schedule,
        weekly: core?.weekly ?? [],
        rules: pastSeasonRules(choice),
      }),
    [year, season, player.position, lines, schedule, core, choice],
  )
  return (
    <div data-profile-log>
      <div className="flex gap-1.5 px-4 pb-2.5 pt-[14px]" role="group" aria-label="Season">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={y === year}
            onClick={() => onYear(y)}
            className={cn('flex h-[30px] items-center rounded-pill px-3.5 text-[12px] font-semibold', y === year ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1')}
          >
            {y}
          </button>
        ))}
      </div>
      {linesState === 'error' ? (
        <p className="px-4 py-6 text-center text-[13px] font-medium text-m-t3">Couldn’t load his game log.</p>
      ) : linesState === 'loading' ? (
        <TableSkeleton />
      ) : table.rows.length === 0 ? (
        <p className="px-4 py-[30px] text-center text-[13px] font-medium text-m-t3">No games on file for {year} yet.</p>
      ) : (
        <StatsTableView table={table} />
      )}
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 px-4 pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-6 animate-pulse rounded-[6px] bg-m-b1" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared table (§2.11)
// ---------------------------------------------------------------------------

const CELL: Record<CellKind, string> = {
  plain: 'bg-m-b1 text-m-t1',
  dash: 'bg-m-b1 text-m-t5',
  bye: 'bg-m-b3s',
  good: 'bg-m-gg text-m-tg',
  mid: 'bg-m-go text-m-to',
  bad: 'bg-m-gr text-m-tr',
}

const K2: Record<TableRow['k2Tone'], string> = {
  positive: 'text-m-tg',
  negative: 'text-m-tr',
  caution: 'text-m-to',
  plain: 'text-m-t1',
  muted: 'text-m-t3',
  none: 'text-m-t5',
}

/** The grouped stats table: a sticky 96px first column (k1 + k2), group
 *  labels, 26px column headers, 30px rows of 24px cells. Scrolls sideways. */
export function StatsTableView({ table }: { table: StatsTable }) {
  return (
    <div className="overflow-x-auto scrollbar-none" data-stats-table>
      <div className="inline-flex min-w-full flex-col pr-4">
        <div className="flex items-end">
          <div className="sticky left-0 z-[1] flex-none self-stretch bg-m-b0" style={{ width: STICKY_W }} />
          {table.groups.map((g) => (
            <div key={g.label} className="flex-none whitespace-nowrap px-1 pb-1 text-[11px] font-semibold text-m-t1" style={{ width: g.cols * COL_W }}>
              {g.label}
            </div>
          ))}
        </div>
        <div className="flex h-[26px] items-center border-b border-m-b3">
          <div className="sticky left-0 z-[1] flex h-full flex-none items-center bg-m-b0 pl-4 text-[10px] font-semibold text-m-t3" style={{ width: STICKY_W }}>
            <span className="flex-none" style={{ width: table.k1Width }}>
              {table.k1Label}
            </span>
            <span>{table.k2Label}</span>
          </div>
          {table.cols.map((c, i) => (
            <div key={`${c}-${i}`} className="flex-none whitespace-nowrap text-center text-[10px] font-semibold text-m-t3" style={{ width: COL_W }}>
              {c}
            </div>
          ))}
        </div>
        {table.rows.map((r) => (
          <div key={r.key} className="flex h-[30px] items-center" data-table-row={r.key}>
            <div className="sticky left-0 z-[1] flex h-full flex-none items-center bg-m-b0 pl-4 text-[12px] font-semibold" style={{ width: STICKY_W }}>
              <span className="flex-none text-m-t3" style={{ width: table.k1Width }}>
                {r.k1}
              </span>
              <span className={K2[r.k2Tone]}>{r.k2}</span>
            </div>
            {r.cells.map((c, i) => (
              <div key={i} className="flex-none px-0.5" style={{ width: COL_W }}>
                <div className={cn('flex h-6 items-center justify-center rounded-[6px] text-[12px] font-semibold', CELL[c.kind])}>{c.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History (§2.10)
// ---------------------------------------------------------------------------

/**
 * His moves in the profile's league (every league when the profile has
 * none), then the career table. Its Position rank group carries his
 * current-season rank under ESPN Standard and Full PPR (the core-stats read
 * under each preset — read only once History is open); past-season ranks
 * are not computed, so those cells are dashes (a gap).
 */
export function HistoryTab({
  player,
  season,
  choice,
  core,
  lines,
  linesState,
  movesLeagueIds,
}: {
  player: PlayerStatsPlayer
  season: number
  choice: ScoringChoice
  core: CoreStatsPayload | null
  lines: readonly ProfileStatLine[]
  linesState: 'loading' | 'error' | 'ready'
  /** Null when leagues are gated off — the Transactions section is omitted. */
  movesLeagueIds: string[] | null
}) {
  const std = usePlayerCoreStats(player.id, { kind: 'system', system: 'espn_standard' })
  const ppr = usePlayerCoreStats(player.id, { kind: 'system', system: 'ppr' })
  const stdRank = std.data?.pos_rank ?? null
  const pprRank = ppr.data?.pos_rank ?? null
  const table = useMemo(
    () =>
      careerTable({
        currentSeason: season,
        position: player.position,
        team: player.team,
        lines,
        core,
        rules: pastSeasonRules(choice),
        ranks: { std: stdRank, ppr: pprRank },
      }),
    [season, player.position, player.team, lines, core, choice, stdRank, pprRank],
  )
  return (
    <div data-profile-history>
      <div className="flex flex-col gap-2 px-4 pb-2.5 pt-4">
        {movesLeagueIds && (
          <>
            <span className="text-[15px] font-semibold">Transactions</span>
            <MovesCards playerId={player.id} leagueIds={movesLeagueIds} />
          </>
        )}
        <span className={cn('text-[15px] font-semibold', movesLeagueIds && 'mt-[14px]')}>Career</span>
      </div>
      {linesState === 'error' ? (
        <p className="px-4 py-6 text-center text-[13px] font-medium text-m-t3">Couldn’t load his career stats.</p>
      ) : linesState === 'loading' ? (
        <TableSkeleton />
      ) : (
        <StatsTableView table={table} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team (§2.9)
// ---------------------------------------------------------------------------

const SLOT_TEXT: Record<string, string> = {
  QB: 'text-m-pos-qb',
  RB: 'text-m-pos-rb',
  WR: 'text-m-pos-wr',
  TE: 'text-m-pos-te',
  K: 'text-m-pos-k',
}

/**
 * The team's depth chart from the roster sync's depth order. The
 * prototype's "Team rank" tiles (offense ranks) are left out — no team
 * offense stats are stored (a gap). Depth cells are not tappable (§3).
 */
export function TeamTab({ player }: { player: PlayerStatsPlayer }) {
  const depth = useMobileProfileDepthChart(player.team)
  const rows = useMemo(() => depthChart(depth.data ?? [], player.id, new Date()), [depth.data, player.id])
  const grid = { gridTemplateColumns: '40px repeat(3, minmax(0, 1fr))' }
  return (
    <div className="flex flex-col gap-5 py-4" data-profile-team>
      <div className="flex flex-col gap-2 px-4">
        <span className="text-[15px] font-semibold">Depth chart · {player.team}</span>
        {depth.isError ? (
          <p className="text-[13px] font-medium text-m-t3">Couldn’t load the depth chart.</p>
        ) : depth.isPending ? (
          <div className="h-[200px] animate-pulse rounded-[14px] bg-m-b1" />
        ) : rows.length === 0 ? (
          <p className="py-[30px] text-center text-[13px] font-medium text-m-t3">No depth chart on file for {player.team}.</p>
        ) : (
          <div className="overflow-hidden rounded-[14px] shadow-m-outline" data-depth-chart>
            <div className="grid gap-2 bg-m-b1 px-3 py-2 text-[10px] font-semibold text-m-t3" style={grid}>
              <span>Pos</span>
              <span>Starter</span>
              <span>2nd</span>
              <span>3rd</span>
            </div>
            {rows.map((r) => (
              <div key={r.slot} className="grid items-center gap-2 border-t border-m-b2 px-3 py-2" style={grid} data-depth-slot={r.slot}>
                <span className={cn('text-[12px] font-bold', SLOT_TEXT[r.pos] ?? 'text-m-t1')}>{r.slot}</span>
                {r.cells.map((c, j) =>
                  c ? (
                    <div key={c.playerId} className="flex min-w-0 flex-col">
                      <span className="truncate text-[10px] font-medium leading-3 text-m-t3">{c.first}</span>
                      <span className={cn('truncate text-[13px] font-semibold leading-4', c.self ? 'text-accent' : 'text-m-t1')}>{c.last}</span>
                    </div>
                  ) : (
                    <div key={`empty-${j}`} className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-semibold leading-4 text-m-t5">–</span>
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
