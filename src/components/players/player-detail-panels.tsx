'use client'

import { useState } from 'react'

import type {
  GameLogRow,
  PlayerStatsPlayer,
  PlayerStatsResponse,
  SeasonBlock,
  StatTotals,
} from '@/hooks/use-player-stats'
import { cn } from '@/lib/utils'

type View = 'fantasy' | 'nfl'

/** Solid position-color tile backgrounds (Figma node 476:622 stat tiles). */
const POSITION_TILE_BG: Record<string, string> = {
  QB: 'bg-pos-qb',
  RB: 'bg-pos-rb',
  WR: 'bg-pos-wr',
  TE: 'bg-pos-te',
  K: 'bg-pos-k',
  DEF: 'bg-pos-def',
}

// =============================================================================
// Overview — the "most important stats" disclosure level. The compact modal
// is exactly this: six big position-colored tiles. The expanded modal and
// full page add the season cards below.
// =============================================================================

export function OverviewPanel({
  data,
  expanded,
}: {
  data: PlayerStatsResponse
  expanded: boolean
}) {
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            value={tile.value}
            label={tile.label}
            position={player.position}
          />
        ))}
      </div>

      {expanded && (
        <div className="grid gap-4 pt-2 md:grid-cols-3">
          <SeasonCard
            label={`${current.season} Season`}
            season={current}
            view="fantasy"
            position={player.position}
          />
          <SeasonCard
            label={`${projection.season} Projected`}
            season={projection}
            view="fantasy"
            position={player.position}
            muted
          />
          <SeasonCard
            label={`${last.season} Season`}
            season={last}
            view="fantasy"
            position={player.position}
          />
        </div>
      )}
    </div>
  )
}

/** Big stat tile — bold value over a quiet label on the position color. */
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
        'flex flex-col justify-between gap-3 rounded-xl p-3 sm:p-4',
        POSITION_TILE_BG[position] ?? 'bg-bg-elevated-2',
      )}
    >
      <p className="text-3xl font-bold leading-none tracking-tight text-white sm:text-4xl">
        {value}
      </p>
      <p className="text-xs font-medium text-white/85 sm:text-sm">{label}</p>
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
      <div className="grid gap-4 md:grid-cols-3">
        <SeasonCard
          label={`${current.season} Season`}
          season={current}
          view={view}
          position={position}
        />
        <SeasonCard
          label={`${projection.season} Projected`}
          season={projection}
          view={view}
          position={position}
          muted
        />
        <SeasonCard
          label={`${last.season} Season`}
          season={last}
          view={view}
          position={position}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Game Log — weekly rows with performance-colored fantasy chips
// =============================================================================

export function GameLogPanel({ data }: { data: PlayerStatsResponse }) {
  const [view, setView] = useState<View>('fantasy')
  const rows = data.gameLog
  const { current } = data.seasons
  const ppg = current.gamesPlayed > 0 ? current.fantasy.ppr / current.gamesPlayed : 0
  const position = data.player.position

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-bg-elevated-2 bg-bg-elevated p-6 text-center text-sm text-text-secondary">
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
 * green for a hit week, red for a bust, amber in between (reference design
 * colors weekly cells the same way).
 */
function performanceChip(ppr: number, ppg: number): string {
  if (ppg <= 0) return 'bg-bg-elevated-2 text-foreground'
  const ratio = ppr / ppg
  if (ratio >= 1.15) return 'bg-tier-a/15 text-tier-a'
  if (ratio <= 0.6) return 'bg-tier-f/15 text-tier-f'
  return 'bg-tier-c/15 text-tier-c'
}

function FantasyGameLog({ rows, ppg }: { rows: GameLogRow[]; ppg: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-bg-elevated-2">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated-2 text-text-tertiary">
          <tr>
            <Th>Wk</Th>
            <Th align="right">PPR</Th>
            <Th align="right">Std</Th>
            <Th align="right">Source</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.week} className="border-t border-bg-elevated-2">
              <Td>Week {row.week}</Td>
              <Td align="right">
                <span
                  className={cn(
                    'inline-block min-w-[3rem] rounded-md px-2 py-0.5 text-right font-mono font-semibold tabular-nums',
                    performanceChip(row.fantasy.ppr, ppg),
                  )}
                >
                  {row.fantasy.ppr.toFixed(1)}
                </span>
              </Td>
              <Td align="right" mono>
                {row.fantasy.standard.toFixed(1)}
              </Td>
              <Td align="right">
                <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                  {row.source === 'mock' ? 'preview' : (row.source ?? 'live')}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NflGameLog({ rows, position }: { rows: GameLogRow[]; position: string }) {
  const cols = positionColumns(position)
  return (
    <div className="overflow-x-auto rounded-md border border-bg-elevated-2">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated-2 text-text-tertiary">
          <tr>
            <Th>Wk</Th>
            {cols.map((c) => (
              <Th key={c.label} align="right">
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.week} className="border-t border-bg-elevated-2">
              <Td>Week {row.week}</Td>
              {cols.map((c) => (
                <Td key={c.label} align="right" mono>
                  {c.render(row.stats)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
    { label: 'Weight', value: player.weight != null ? `${player.weight} lbs` : '—' },
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
      label: 'Bye Week',
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
        'rounded-lg border border-bg-elevated-2 bg-bg-elevated p-4',
        muted && 'border-dashed',
      )}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          {label}
        </p>
        {season.basis === 'last_season' && (
          <span className="text-[10px] text-text-tertiary">
            basis: {season.season - 1}
          </span>
        )}
      </div>
      {view === 'fantasy' ? (
        <FantasyBlock season={season} />
      ) : (
        <NflBlock totals={season.totals} position={position} />
      )}
      <p className="mt-3 text-[10px] text-text-tertiary">
        {season.gamesPlayed} game{season.gamesPlayed === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function FantasyBlock({ season }: { season: SeasonBlock }) {
  const ppg = season.gamesPlayed > 0 ? season.fantasy.ppr / season.gamesPlayed : 0
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums text-foreground">
          {season.fantasy.ppr.toFixed(1)}
        </span>
        <span className="text-xs text-text-secondary">PPR</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Standard" value={season.fantasy.standard.toFixed(1)} />
        <Stat label="PPR / G" value={ppg.toFixed(1)} />
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
      { label: 'Pass Yds', value: totals.pass_yards },
      { label: 'Pass TD', value: totals.pass_tds },
      { label: 'INT', value: totals.interceptions },
      { label: 'Comp / Att', value: null },
      { label: 'Rush Yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
    ]
  }
  if (position === 'RB') {
    return [
      { label: 'Rush Att', value: totals.rush_attempts },
      { label: 'Rush Yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
      { label: 'Tgt', value: totals.targets },
      { label: 'Rec', value: totals.receptions },
      { label: 'Rec Yds', value: totals.receiving_yards },
    ]
  }
  if (position === 'WR' || position === 'TE') {
    return [
      { label: 'Tgt', value: totals.targets },
      { label: 'Rec', value: totals.receptions },
      { label: 'Rec Yds', value: totals.receiving_yards },
      { label: 'Rec TD', value: totals.receiving_tds },
      { label: 'Rush Yds', value: totals.rush_yards },
      { label: 'Rush TD', value: totals.rush_tds },
    ]
  }
  if (position === 'K') {
    return [
      { label: 'FG Made', value: totals.fg_made },
      { label: 'FG Att', value: totals.fg_attempted },
      { label: 'XP Made', value: totals.xp_made },
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
    <div className="grid grid-cols-2 gap-2">
      {fields.map((field) => (
        <Stat
          key={field.label}
          label={field.label}
          value={
            field.label === 'Comp / Att'
              ? `${totals.pass_completions ?? 0} / ${totals.pass_attempts ?? 0}`
              : Number(field.value ?? 0).toLocaleString()
          }
        />
      ))}
    </div>
  )
}

export function Stat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-md bg-bg-elevated-2 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex h-7 items-center rounded-full border border-bg-elevated-2 bg-bg-elevated-3 p-0.5 text-[11px] font-semibold">
      <ToggleSegment active={view === 'fantasy'} onClick={() => onChange('fantasy')}>
        Fantasy
      </ToggleSegment>
      <ToggleSegment active={view === 'nfl'} onClick={() => onChange('nfl')}>
        NFL
      </ToggleSegment>
    </div>
  )
}

function ToggleSegment({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-text-secondary hover:text-foreground',
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
 * Weekly NFL stat columns by position — mirrors the reference design's
 * Logs table (passing detail incl. CMP% and sacks for QBs, rushing +
 * receiving splits for skill positions).
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
      { label: 'Rush Yd', render: (s) => num(s.rush_yards) },
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
      { label: 'Rec Yd', render: (s) => num(s.receiving_yards) },
      { label: 'Rec TD', render: (s) => num(s.receiving_tds) },
    ]
  }
  if (position === 'WR' || position === 'TE') {
    return [
      { label: 'Tgt', render: (s) => num(s.targets) },
      { label: 'Rec', render: (s) => num(s.receptions) },
      { label: 'Yd', render: (s) => num(s.receiving_yards) },
      { label: 'TD', render: (s) => num(s.receiving_tds) },
      { label: 'Rush Yd', render: (s) => num(s.rush_yards) },
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

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  mono = false,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td
      className={cn(
        'px-3 py-2',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono tabular-nums',
      )}
    >
      {children}
    </td>
  )
}
