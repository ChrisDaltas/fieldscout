'use client'

import { useState } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  GameLogRow,
  PlayerStatsPlayer,
  PlayerStatsResponse,
  SeasonBlock,
  StatTotals,
} from '@/hooks/use-player-stats'
import { cn } from '@/lib/utils'

type View = 'fantasy' | 'nfl'

/** Solid position-color tile backgrounds — position identity, white text. */
const POSITION_TILE_BG: Record<string, string> = {
  QB: 'bg-pos-qb',
  RB: 'bg-pos-rb',
  WR: 'bg-pos-wr',
  TE: 'bg-pos-te',
  K: 'bg-pos-k',
  DEF: 'bg-pos-def',
}

// =============================================================================
// Overview — the headline stat tiles plus the weekly production chart (the
// kit's PlayerPage overview). Season cards live on the Stats tab.
// =============================================================================

export function OverviewPanel({ data }: { data: PlayerStatsResponse }) {
  const { current, last, projection } = data.seasons
  const { player } = data
  const ppg = current.gamesPlayed > 0 ? current.fantasy.ppr / current.gamesPlayed : 0
  const positionTiles = getPositionTiles(current.totals, player.position)

  const tiles: { value: string; label: string }[] = [
    { value: ppg.toFixed(1), label: 'Points per game' },
    { value: current.fantasy.ppr.toFixed(1), label: 'Total points' },
    // ADP isn't synced for every player — fall back to last season's points
    // so the grid never shows a dead tile.
    player.adp != null
      ? { value: Number(player.adp).toFixed(1), label: 'ADP' }
      : { value: last.fantasy.ppr.toFixed(1), label: `${last.season} points` },
    { value: projection.fantasy.ppr.toFixed(0), label: 'Projected points' },
    ...positionTiles,
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            value={tile.value}
            label={tile.label}
            position={player.position}
          />
        ))}
      </div>

      <div className="max-w-[496px]">
        <p className="fs-overline mb-2 text-n-3">Weekly production</p>
        <WeeklyProduction rows={data.gameLog} />
      </div>
    </div>
  )
}

/** Big stat tile — mono value over a quiet label on the position color. */
function StatTile({
  value,
  label,
  position,
}: {
  value: string
  label: string
  position: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 rounded-sm border border-ink p-3',
        POSITION_TILE_BG[position] ?? 'bg-n-4',
      )}
    >
      <p className="fs-num text-[24px] font-extrabold leading-none text-white sm:text-[29px]">
        {value}
      </p>
      <p className="fs-overline text-white/85">{label}</p>
    </div>
  )
}

/**
 * Weekly production bars from the game log — lime for at-or-above the season
 * average, muted grey below it. Same treatment as the mini player card.
 */
function WeeklyProduction({ rows }: { rows: GameLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="border border-n-4 p-3 text-center text-[12px] font-semibold text-n-3">
        No games logged yet for the current season.
      </p>
    )
  }

  const total = rows.reduce((sum, row) => sum + row.fantasy.ppr, 0)
  const avg = total / rows.length
  const max = Math.max(...rows.map((row) => row.fantasy.ppr))

  return (
    <div>
      <p className="mb-2.5 text-[11px] font-semibold text-n-3">
        <span className="fs-num text-[15px] font-extrabold text-ink">
          {avg.toFixed(1)}
        </span>{' '}
        avg per week ·{' '}
        <span className="fs-num text-[15px] font-extrabold text-ink">
          {Math.round(total)}
        </span>{' '}
        total
      </p>
      <div className="flex flex-col gap-1">
        {rows.map((row) => {
          const pts = row.fantasy.ppr
          const width = max > 0 ? (pts / max) * 100 : 0
          return (
            <div key={row.week} className="flex items-center gap-2">
              <span className="fs-num w-9 shrink-0 text-[11px] font-bold text-n-3">
                Wk {row.week}
              </span>
              <span className="h-3.5 min-w-0 flex-1 bg-n-4">
                {width > 0 && (
                  <span
                    className={cn(
                      'block h-full border border-ink',
                      pts >= avg ? 'bg-brand' : 'bg-n-3/40',
                    )}
                    style={{ width: `${width}%` }}
                  />
                )}
              </span>
              <span className="fs-num w-10 shrink-0 text-right text-[12px] font-extrabold">
                {pts.toFixed(1)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The two position-defining counting stats for the tile grid. */
function getPositionTiles(
  totals: StatTotals,
  position: string,
): { value: string; label: string }[] {
  const n = (v: number | null | undefined) => Number(v ?? 0).toLocaleString()
  if (position === 'QB') {
    return [
      { value: n(totals.pass_yards), label: 'Passing yards' },
      { value: n(totals.pass_tds), label: 'Passing TDs' },
    ]
  }
  if (position === 'RB') {
    return [
      { value: n(totals.rush_yards), label: 'Rushing yards' },
      { value: n(totals.rush_tds), label: 'Rushing TDs' },
    ]
  }
  if (position === 'WR' || position === 'TE') {
    return [
      { value: n(totals.receiving_yards), label: 'Receiving yards' },
      { value: n(totals.receptions), label: 'Receptions' },
    ]
  }
  if (position === 'K') {
    return [
      { value: n(totals.fg_made), label: 'Field goals' },
      { value: n(totals.xp_made), label: 'Extra points' },
    ]
  }
  return [
    { value: n(totals.def_sacks), label: 'Sacks' },
    { value: n(totals.def_interceptions), label: 'Interceptions' },
  ]
}

// =============================================================================
// Stats — the three season cards with a Fantasy / NFL toggle
// =============================================================================

export function StatsPanel({ data }: { data: PlayerStatsResponse }) {
  const [view, setView] = useState<View>('fantasy')
  const { current, last, projection } = data.seasons
  const position = data.player.position

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SeasonCard
          label={`${current.season} season`}
          season={current}
          view={view}
          position={position}
        />
        <SeasonCard
          label={`${projection.season} projected`}
          season={projection}
          view={view}
          position={position}
          muted
        />
        <SeasonCard
          label={`${last.season} season`}
          season={last}
          view={view}
          position={position}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Game log — weekly rows with performance-colored fantasy chips
// =============================================================================

export function GameLogPanel({ data }: { data: PlayerStatsResponse }) {
  const [view, setView] = useState<View>('fantasy')
  const rows = data.gameLog
  const { current } = data.seasons
  const ppg = current.gamesPlayed > 0 ? current.fantasy.ppr / current.gamesPlayed : 0
  const position = data.player.position

  if (rows.length === 0) {
    return (
      <p className="rounded-sm border border-n-4 p-5 text-center text-[12px] font-semibold text-n-3">
        No game log yet for the current season.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === 'fantasy' ? (
        <FantasyGameLog rows={rows} ppg={ppg} />
      ) : (
        <NflGameLog rows={rows} position={position} />
      )}
    </div>
  )
}

/**
 * Color a weekly fantasy score relative to the player's own season average —
 * positive for a hit week, negative for a bust, caution in between (football
 * semantic fills, ink text).
 */
function performanceChip(ppr: number, ppg: number): string {
  if (ppg <= 0) return 'bg-n-4'
  const ratio = ppr / ppg
  if (ratio >= 1.15) return 'bg-positive'
  if (ratio <= 0.6) return 'bg-negative'
  return 'bg-caution'
}

function FantasyGameLog({ rows, ppg }: { rows: GameLogRow[]; ppg: number }) {
  return (
    <div className="rounded-sm border border-ink">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Wk</TableHead>
            <TableHead className="text-right">PPR</TableHead>
            <TableHead className="text-right">Std</TableHead>
            <TableHead className="text-right">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.week}>
              <TableCell className="fs-num font-bold">Wk {row.week}</TableCell>
              <TableCell className="text-right">
                <span
                  className={cn(
                    'fs-num inline-block min-w-[3rem] rounded-sm border border-ink px-1.5 py-px text-right text-[12px] font-bold text-ink',
                    performanceChip(row.fantasy.ppr, ppg),
                  )}
                >
                  {row.fantasy.ppr.toFixed(1)}
                </span>
              </TableCell>
              <TableCell className="fs-num text-right">
                {row.fantasy.standard.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                <span className="fs-overline text-n-3">
                  {row.source === 'mock' ? 'preview' : (row.source ?? 'live')}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NflGameLog({ rows, position }: { rows: GameLogRow[]; position: string }) {
  const cols = positionColumns(position)
  return (
    <div className="rounded-sm border border-ink">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Wk</TableHead>
            {cols.map((c) => (
              <TableHead key={c.label} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.week}>
              <TableCell className="fs-num font-bold">Wk {row.week}</TableCell>
              {cols.map((c) => (
                <TableCell key={c.label} className="fs-num text-right">
                  {c.render(row.stats)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// =============================================================================
// Bio
// =============================================================================

export function BioPanel({ player }: { player: PlayerStatsPlayer }) {
  // No draft data ≠ undrafted in this dataset — show "—" rather than guessing.
  const draft =
    player.draft_year != null
      ? `${player.draft_year}${
          player.draft_round != null
            ? ` · Rd ${player.draft_round}${
                player.draft_pick != null ? `, Pick ${player.draft_pick}` : ''
              }`
            : ''
        }`
      : '—'

  const facts: { label: string; value: string }[] = [
    { label: 'Height', value: formatHeight(player.height) },
    { label: 'Weight', value: player.weight != null ? `${player.weight} lb` : '—' },
    { label: 'Age', value: formatAge(player.birth_date) },
    { label: 'College', value: player.college ?? '—' },
    { label: 'Drafted', value: draft },
    {
      label: 'Experience',
      value:
        player.experience_years > 0 ? `${player.experience_years} yr` : 'Rookie',
    },
    {
      label: 'Jersey',
      value: player.jersey_number != null ? `#${player.jersey_number}` : '—',
    },
    { label: 'Status', value: player.status ?? '—' },
    {
      label: 'Bye week',
      value: player.bye_week != null ? `Week ${player.bye_week}` : '—',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {facts.map((f) => (
        <Stat key={f.label} label={f.label} value={f.value} />
      ))}
    </div>
  )
}

/** The sync stores height as total inches in a string (e.g. "74" → 6'2"). */
function formatHeight(height: string | null): string {
  if (!height) return '—'
  const inches = Number(height)
  if (!Number.isFinite(inches) || inches <= 0) return height
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

function formatAge(birthDate: string | null): string {
  if (!birthDate) return '—'
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return '—'
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  if (beforeBirthday) age -= 1
  return String(age)
}

// =============================================================================
// Shared building blocks
// =============================================================================

export function SeasonCard({
  label,
  season,
  view,
  position,
  muted,
}: {
  label: string
  season: SeasonBlock
  view: View
  position: string
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-sm border bg-white p-3.5',
        // Projected card takes the quieter grey border; real seasons get ink.
        muted ? 'border-n-3' : 'border-ink',
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="fs-overline text-n-3">{label}</p>
        {season.basis === 'last_season' && (
          <span className="fs-num text-[10px] font-medium text-n-3">
            basis: {season.season - 1}
          </span>
        )}
        {season.basis === 'projections' && (
          <span className="fs-num text-[10px] font-medium text-n-3">
            basis: projections
          </span>
        )}
      </div>
      {view === 'fantasy' ? (
        <FantasyBlock season={season} />
      ) : (
        <NflBlock totals={season.totals} position={position} />
      )}
      <p className="mt-3 text-[10px] font-medium text-n-3">
        <span className="fs-num">{season.gamesPlayed}</span> game
        {season.gamesPlayed === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function FantasyBlock({ season }: { season: SeasonBlock }) {
  const ppg = season.gamesPlayed > 0 ? season.fantasy.ppr / season.gamesPlayed : 0
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="fs-num text-[24px] font-extrabold leading-none text-ink">
          {season.fantasy.ppr.toFixed(1)}
        </span>
        <span className="text-[11px] font-semibold text-n-3">PPR</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Standard" value={season.fantasy.standard.toFixed(1)} />
        <Stat label="PPR / game" value={ppg.toFixed(1)} />
      </div>
    </div>
  )
}

interface StatField {
  label: string
  value: number | null | undefined
}

function getNflFields(totals: StatTotals, position: string): StatField[] {
  if (position === 'QB') {
    return [
      { label: 'Pass yds', value: totals.pass_yards },
      { label: 'Pass TD', value: totals.pass_tds },
      { label: 'INT', value: totals.interceptions },
      { label: 'Comp / att', value: null },
      { label: 'Rush yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
    ]
  }
  if (position === 'RB') {
    return [
      { label: 'Rush att', value: totals.rush_attempts },
      { label: 'Rush yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
      { label: 'Tgt', value: totals.targets },
      { label: 'Rec', value: totals.receptions },
      { label: 'Rec yds', value: totals.receiving_yards },
    ]
  }
  if (position === 'WR' || position === 'TE') {
    return [
      { label: 'Tgt', value: totals.targets },
      { label: 'Rec', value: totals.receptions },
      { label: 'Rec yds', value: totals.receiving_yards },
      { label: 'Rec TD', value: totals.receiving_tds },
      { label: 'Rush yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
    ]
  }
  if (position === 'K') {
    return [
      { label: 'FG made', value: totals.fg_made },
      { label: 'FG att', value: totals.fg_attempted },
      { label: 'XP made', value: totals.xp_made },
    ]
  }
  // DEF
  return [
    { label: 'Sacks', value: totals.def_sacks },
    { label: 'INT', value: totals.def_interceptions },
    { label: 'TD', value: totals.def_tds },
  ]
}

function NflBlock({ totals, position }: { totals: StatTotals; position: string }) {
  const fields = getNflFields(totals, position)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {fields.map((field) => (
        <Stat
          key={field.label}
          label={field.label}
          value={
            field.label === 'Comp / att'
              ? `${totals.pass_completions ?? 0} / ${totals.pass_attempts ?? 0}`
              : Number(field.value ?? 0).toLocaleString()
          }
        />
      ))}
    </div>
  )
}

/** Hairline stat cell — overline label over a mono value. */
export function Stat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-sm border border-n-4 px-2 py-1.5">
      <p className="fs-overline truncate text-n-3">{label}</p>
      <p className="fs-num text-[13px] font-extrabold">{value}</p>
    </div>
  )
}

/** Fantasy / NFL segmented toggle — boxed segments, accent fill when active. */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex overflow-hidden rounded-sm border border-ink">
      <ToggleSegment active={view === 'fantasy'} onClick={() => onChange('fantasy')}>
        Fantasy
      </ToggleSegment>
      <ToggleSegment
        active={view === 'nfl'}
        onClick={() => onChange('nfl')}
        className="border-l border-ink"
      >
        NFL
      </ToggleSegment>
    </div>
  )
}

function ToggleSegment({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-btn-sm px-3 text-[11px] font-extrabold leading-none transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-white text-ink hover:bg-n-4',
        className,
      )}
    >
      {children}
    </button>
  )
}

interface LogColumn {
  label: string
  render: (stats: StatTotals) => string
}

const num = (v: number | null | undefined) => Number(v ?? 0).toLocaleString()

/**
 * Weekly NFL stat columns by position — passing detail incl. CMP% and sacks
 * for QBs, rushing + receiving splits for skill positions.
 */
function positionColumns(position: string): LogColumn[] {
  if (position === 'QB') {
    return [
      { label: 'Att', render: (s) => num(s.pass_attempts) },
      { label: 'Yd', render: (s) => num(s.pass_yards) },
      { label: 'TD', render: (s) => num(s.pass_tds) },
      {
        label: 'Cmp%',
        render: (s) => {
          const att = Number(s.pass_attempts ?? 0)
          if (att === 0) return '—'
          return `${((Number(s.pass_completions ?? 0) / att) * 100).toFixed(1)}%`
        },
      },
      { label: 'INT', render: (s) => num(s.interceptions) },
      { label: 'Sack', render: (s) => num(s.sacks_taken) },
      { label: 'Car', render: (s) => num(s.rush_attempts) },
      { label: 'Rush yd', render: (s) => num(s.rush_yards) },
      { label: 'Rush TD', render: (s) => num(s.rush_tds) },
    ]
  }
  if (position === 'RB') {
    return [
      { label: 'Car', render: (s) => num(s.rush_attempts) },
      { label: 'Yd', render: (s) => num(s.rush_yards) },
      { label: 'TD', render: (s) => num(s.rush_tds) },
      { label: 'Tgt', render: (s) => num(s.targets) },
      { label: 'Rec', render: (s) => num(s.receptions) },
      { label: 'Rec yd', render: (s) => num(s.receiving_yards) },
      { label: 'Rec TD', render: (s) => num(s.receiving_tds) },
    ]
  }
  if (position === 'WR' || position === 'TE') {
    return [
      { label: 'Tgt', render: (s) => num(s.targets) },
      { label: 'Rec', render: (s) => num(s.receptions) },
      { label: 'Yd', render: (s) => num(s.receiving_yards) },
      { label: 'TD', render: (s) => num(s.receiving_tds) },
      { label: 'Rush yd', render: (s) => num(s.rush_yards) },
      { label: 'Rush TD', render: (s) => num(s.rush_tds) },
    ]
  }
  if (position === 'K') {
    return [
      { label: 'FGM', render: (s) => num(s.fg_made) },
      { label: 'FGA', render: (s) => num(s.fg_attempted) },
      { label: 'XPM', render: (s) => num(s.xp_made) },
    ]
  }
  return [
    { label: 'Sk', render: (s) => num(s.def_sacks) },
    { label: 'INT', render: (s) => num(s.def_interceptions) },
    { label: 'TD', render: (s) => num(s.def_tds) },
  ]
}
