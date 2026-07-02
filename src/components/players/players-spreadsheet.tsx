'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Search, Settings, X } from 'lucide-react'

import { AddToListPopover } from '@/components/players/add-to-list-popover'
import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { darkTeamPrimary, NFL_TEAM_COLORS, teamTintBackground } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

interface PlayerRow {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  projected_pts: number | null
  stats_last: Record<string, number>
  stats_current: Record<string, number>
}

type ColumnKey =
  | 'projected'
  | 'last_pts'
  | 'pass_yards'
  | 'pass_tds'
  | 'interceptions'
  | 'pass_attempts'
  | 'pass_completions'
  | 'rush_attempts'
  | 'rush_yards'
  | 'rush_tds'
  | 'targets'
  | 'receptions'
  | 'receiving_yards'
  | 'receiving_tds'
  | 'fumbles_lost'
  | 'def_sacks'
  | 'def_interceptions'
  | 'def_fumble_recoveries'
  | 'def_tds'
  | 'def_safeties'
  | 'fg_made'
  | 'fg_attempted'
  | 'xp_made'

type GroupKey = 'fantasy' | 'passing' | 'rushing' | 'receiving' | 'def_st'

const GROUP_LABELS: Record<GroupKey, string> = {
  fantasy: 'Fantasy Points',
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  def_st: 'Defense & Special Teams',
}

const GROUP_ORDER: GroupKey[] = ['fantasy', 'passing', 'rushing', 'receiving', 'def_st']

interface ColumnDef {
  key: ColumnKey
  label: string
  group: GroupKey
  align?: 'right'
  statField?: keyof PlayerRow['stats_last']
  sortBy:
    | { kind: 'projected' }
    | { kind: 'last_pts' }
    | { kind: 'stat'; field: keyof PlayerRow['stats_last'] }
}

const COLUMNS: ColumnDef[] = [
  // Fantasy Points
  { key: 'projected', label: 'Proj', group: 'fantasy', align: 'right', sortBy: { kind: 'projected' } },
  { key: 'last_pts', label: '2025 PTS', group: 'fantasy', align: 'right', sortBy: { kind: 'last_pts' } },
  // Passing
  { key: 'pass_yards', label: 'Pass Y', group: 'passing', align: 'right', statField: 'pass_yards', sortBy: { kind: 'stat', field: 'pass_yards' } },
  { key: 'pass_tds', label: 'Pass TD', group: 'passing', align: 'right', statField: 'pass_tds', sortBy: { kind: 'stat', field: 'pass_tds' } },
  { key: 'interceptions', label: 'INT', group: 'passing', align: 'right', statField: 'interceptions', sortBy: { kind: 'stat', field: 'interceptions' } },
  { key: 'pass_attempts', label: 'Pass Att', group: 'passing', align: 'right', statField: 'pass_attempts', sortBy: { kind: 'stat', field: 'pass_attempts' } },
  { key: 'pass_completions', label: 'Comp', group: 'passing', align: 'right', statField: 'pass_completions', sortBy: { kind: 'stat', field: 'pass_completions' } },
  // Rushing
  { key: 'rush_attempts', label: 'Rush Att', group: 'rushing', align: 'right', statField: 'rush_attempts', sortBy: { kind: 'stat', field: 'rush_attempts' } },
  { key: 'rush_yards', label: 'Rush Y', group: 'rushing', align: 'right', statField: 'rush_yards', sortBy: { kind: 'stat', field: 'rush_yards' } },
  { key: 'rush_tds', label: 'Rush TD', group: 'rushing', align: 'right', statField: 'rush_tds', sortBy: { kind: 'stat', field: 'rush_tds' } },
  { key: 'fumbles_lost', label: 'FUM', group: 'rushing', align: 'right', statField: 'fumbles_lost', sortBy: { kind: 'stat', field: 'fumbles_lost' } },
  // Receiving
  { key: 'targets', label: 'Tgt', group: 'receiving', align: 'right', statField: 'targets', sortBy: { kind: 'stat', field: 'targets' } },
  { key: 'receptions', label: 'Rec', group: 'receiving', align: 'right', statField: 'receptions', sortBy: { kind: 'stat', field: 'receptions' } },
  { key: 'receiving_yards', label: 'Rec Y', group: 'receiving', align: 'right', statField: 'receiving_yards', sortBy: { kind: 'stat', field: 'receiving_yards' } },
  { key: 'receiving_tds', label: 'Rec TD', group: 'receiving', align: 'right', statField: 'receiving_tds', sortBy: { kind: 'stat', field: 'receiving_tds' } },
  // Defense & Special Teams
  { key: 'def_sacks', label: 'Sacks', group: 'def_st', align: 'right', statField: 'def_sacks', sortBy: { kind: 'stat', field: 'def_sacks' } },
  { key: 'def_interceptions', label: 'D INT', group: 'def_st', align: 'right', statField: 'def_interceptions', sortBy: { kind: 'stat', field: 'def_interceptions' } },
  { key: 'def_fumble_recoveries', label: 'D FR', group: 'def_st', align: 'right', statField: 'def_fumble_recoveries', sortBy: { kind: 'stat', field: 'def_fumble_recoveries' } },
  { key: 'def_tds', label: 'D TD', group: 'def_st', align: 'right', statField: 'def_tds', sortBy: { kind: 'stat', field: 'def_tds' } },
  { key: 'def_safeties', label: 'Safety', group: 'def_st', align: 'right', statField: 'def_safeties', sortBy: { kind: 'stat', field: 'def_safeties' } },
  { key: 'fg_made', label: 'FGM', group: 'def_st', align: 'right', statField: 'fg_made', sortBy: { kind: 'stat', field: 'fg_made' } },
  { key: 'fg_attempted', label: 'FGA', group: 'def_st', align: 'right', statField: 'fg_attempted', sortBy: { kind: 'stat', field: 'fg_attempted' } },
  { key: 'xp_made', label: 'XPM', group: 'def_st', align: 'right', statField: 'xp_made', sortBy: { kind: 'stat', field: 'xp_made' } },
]

const DEFAULT_VISIBLE: ColumnKey[] = [
  'projected',
  'last_pts',
  'pass_yards',
  'pass_tds',
  'rush_yards',
  'rush_tds',
  'receptions',
  'receiving_yards',
  'receiving_tds',
]

const POSITION_FILTERS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type PositionFilter = (typeof POSITION_FILTERS)[number]

const TEAM_OPTIONS = Object.keys(NFL_TEAM_COLORS).sort()
const RECENT_KEY = 'fieldscout.player-search.recent'
const MAX_RECENT_SEARCHES = 5
const DEFAULT_AUTOCOMPLETE_LIMIT = 7

type SortKey =
  | 'projected'
  | 'name'
  | 'last_pts'
  | { stat: string }

interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface PlayersSpreadsheetProps {
  initialPosition?: PositionFilter
}

export function PlayersSpreadsheet({ initialPosition = 'All' }: PlayersSpreadsheetProps) {
  const [position, setPosition] = useState<PositionFilter>(initialPosition)
  const [team, setTeam] = useState<string>('')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE),
  )
  const [sort, setSort] = useState<SortState>({ key: 'projected', dir: 'desc' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<PlayerRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setError(null)
    setSelected(new Set())

    const params = new URLSearchParams({ scoring: 'ppr', limit: '1500' })
    if (position !== 'All') params.set('positions', position)
    if (team) params.set('teams', team)

    fetch(`/api/players/builder?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Players failed (${res.status})`)
        return res.json() as Promise<{ players: PlayerRow[] }>
      })
      .then((data) => {
        setRows(data.players ?? [])
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [position, team])

  const filteredRows = useMemo(() => {
    const q = debounced.toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.full_name.toLowerCase().includes(q))
  }, [rows, debounced])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    const dir = sort.dir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir
      }
      return (Number(av) - Number(bv)) * dir
    })
    return copy
  }, [filteredRows, sort])

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols],
  )

  const toggleColumn = (key: ColumnKey) => {
    setVisibleCols((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSort = (col: ColumnDef) => {
    const key: SortKey =
      col.sortBy.kind === 'stat'
        ? { stat: col.sortBy.field as string }
        : col.sortBy.kind
    const sameKey = sortKeyEquals(sort.key, key)
    setSort({
      key,
      dir: sameKey ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'desc',
    })
  }

  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected =
    sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id))
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(sortedRows.map((r) => r.id)))
  }

  const showSkeletons = isLoading && rows.length === 0
  const skeletonRows = useMemo(
    () =>
      Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded" />
      )),
    [],
  )

  const selectedNames = useMemo(() => {
    if (selected.size === 0) return []
    const map = new Map(rows.map((r) => [r.id, r.full_name]))
    return Array.from(selected).map((id) => map.get(id) ?? id)
  }, [selected, rows])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Players</h1>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SearchAutocomplete
          query={query}
          onQueryChange={setQuery}
          allRows={rows}
        />
        <TeamFilterPopover team={team} onChange={setTeam} />
        <div className="flex flex-wrap gap-1">
          {POSITION_FILTERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(p)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                position === p
                  ? 'bg-foreground text-background'
                  : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <ColumnsPopover visible={visibleCols} onToggle={toggleColumn} />
      </div>

      <SelectionBar
        count={selected.size}
        names={selectedNames}
        playerIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
      />

      {error && (
        <p className="rounded-md border border-bg-elevated-2 bg-bg-elevated p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-bg-elevated-2 bg-bg-elevated">
        <div className="max-h-[calc(100dvh-15rem)] overflow-auto overscroll-contain">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-bg-elevated">
              <GroupHeaderRow visibleColumns={visibleColumns} />
              <tr>
                <Th sticky width="36px">
                  <span className="flex items-center justify-center">
                    <Checkbox checked={allSelected} onChange={toggleSelectAll} />
                  </span>
                </Th>
                <Th sticky leftOffset="36px" width="48px">
                  <span className="sr-only">Add to list</span>
                </Th>
                <Th sticky leftOffset="84px" width="40px" align="right">
                  #
                </Th>
                <Th sticky leftOffset="124px" width="240px">
                  Player
                </Th>
                {visibleColumns.map((c, i) => {
                  const prev = i > 0 ? visibleColumns[i - 1] : undefined
                  const startsGroup = !prev || prev.group !== c.group
                  return (
                    <SortableTh
                      key={c.key}
                      column={c}
                      sort={sort}
                      onSort={() => handleSort(c)}
                      groupBoundary={startsGroup}
                    />
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {showSkeletons && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 4}
                    className="space-y-1 p-3"
                  >
                    <div className="space-y-1">{skeletonRows}</div>
                  </td>
                </tr>
              )}
              {!isLoading && sortedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 4}
                    className="p-6 text-center text-sm text-text-tertiary"
                  >
                    {debounced ? `No players match "${debounced}".` : 'No players.'}
                  </td>
                </tr>
              )}
              {sortedRows.map((row, i) => (
                <PlayerTableRow
                  key={row.id}
                  rank={i + 1}
                  row={row}
                  visibleColumns={visibleColumns}
                  selected={selected.has(row.id)}
                  onToggleSelect={() => toggleSelected(row.id)}
                  onOpenPlayer={() => openPlayer(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[10px] text-text-tertiary">
        Showing {sortedRows.length} of {rows.length} players · scroll horizontally
        for more columns
      </p>
    </div>
  )
}

function sortValue(row: PlayerRow, key: SortKey): number | string {
  if (typeof key === 'object' && 'stat' in key) {
    return Number(row.stats_last[key.stat as keyof PlayerRow['stats_last']] ?? 0)
  }
  switch (key) {
    case 'projected':
      // Sort missing projections to the bottom — never confuse "no
      // projection" with "0 projected points".
      return row.projected_pts ?? -Infinity
    case 'last_pts':
      return row.last_pts
    case 'name':
      return row.full_name
    default:
      return 0
  }
}

function sortKeyEquals(a: SortKey, b: SortKey): boolean {
  if (typeof a === 'object' && typeof b === 'object') {
    return 'stat' in a && 'stat' in b && a.stat === b.stat
  }
  return a === b
}

function SelectionBar({
  count,
  names,
  playerIds,
  onClear,
}: {
  count: number
  names: string[]
  playerIds: string[]
  onClear: () => void
}) {
  if (count === 0) return null
  const primaryName =
    count === 1 ? names[0] : `${count} players`
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bg-elevated-3 bg-bg-elevated p-3">
      <AddToListPopover
        playerIds={playerIds}
        playerName={primaryName}
        triggerVariant="primary"
      />
      <span className="text-sm text-text-secondary">
        <span className="font-mono font-bold tabular-nums text-foreground">
          {count}
        </span>{' '}
        player{count === 1 ? '' : 's'} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-text-tertiary transition-colors hover:text-foreground"
      >
        Clear selection
      </button>
    </div>
  )
}

function PlayerTableRow({
  rank,
  row,
  visibleColumns,
  selected,
  onToggleSelect,
  onOpenPlayer,
}: {
  rank: number
  row: PlayerRow
  visibleColumns: ColumnDef[]
  selected: boolean
  onToggleSelect: () => void
  onOpenPlayer: () => void
}) {
  const initials = row.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  const teamColor = darkTeamPrimary(row.team)
  const tintBg = teamTintBackground(row.team, 0.22)

  return (
    <tr
      className={cn(
        'group border-t border-bg-elevated-2 transition-colors hover:bg-bg-elevated-2',
        selected && 'bg-bg-elevated-2',
      )}
    >
      <Td sticky width="36px">
        <span className="flex items-center justify-center">
          <Checkbox checked={selected} onChange={onToggleSelect} />
        </span>
      </Td>
      <Td sticky leftOffset="36px" width="48px">
        <span className="flex items-center justify-center">
          <AddToListPopover
            playerIds={[row.id]}
            playerName={row.full_name}
            align="start"
          />
        </span>
      </Td>
      <Td sticky leftOffset="84px" width="40px" align="right" mono>
        <span className="text-text-secondary">{rank}</span>
      </Td>
      <Td sticky leftOffset="124px" width="240px">
        <button
          type="button"
          onClick={onOpenPlayer}
          className="group/name flex w-full items-center gap-3 text-left"
        >
          <Avatar
            className="h-11 w-11 shrink-0 border-2"
            style={{ backgroundColor: tintBg, borderColor: teamColor }}
          >
            {row.headshot_url && (
              <AvatarImage
                src={row.headshot_url}
                alt={row.full_name}
                className="h-full w-full object-cover object-top"
              />
            )}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight group-hover/name:underline">
              {row.full_name}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <PositionBadge position={row.position} />
              {row.team && (
                <span className="text-[11px] text-text-secondary">
                  {row.team}
                </span>
              )}
            </div>
          </div>
        </button>
      </Td>
      {visibleColumns.map((c, i) => {
        const prev = i > 0 ? visibleColumns[i - 1] : undefined
        const startsGroup = !prev || prev.group !== c.group
        return (
          <Cell key={c.key} column={c} row={row} groupBoundary={startsGroup} />
        )
      })}
    </tr>
  )
}

function Cell({
  column,
  row,
  groupBoundary,
}: {
  column: ColumnDef
  row: PlayerRow
  groupBoundary?: boolean
}) {
  if (column.key === 'projected') {
    return (
      <Td align="right" mono groupBoundary={groupBoundary}>
        <span className="font-semibold text-foreground">
          {typeof row.projected_pts === 'number'
            ? row.projected_pts.toFixed(0)
            : '—'}
        </span>
      </Td>
    )
  }
  if (column.key === 'last_pts') {
    return (
      <Td align="right" mono groupBoundary={groupBoundary}>
        {row.last_pts.toFixed(0)}
      </Td>
    )
  }
  if (column.statField) {
    const value = Number(row.stats_last[column.statField] ?? 0)
    return (
      <Td align="right" mono groupBoundary={groupBoundary}>
        {value === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          value.toLocaleString()
        )}
      </Td>
    )
  }
  return <Td groupBoundary={groupBoundary}>—</Td>
}

function GroupHeaderRow({ visibleColumns }: { visibleColumns: ColumnDef[] }) {
  // Group consecutive columns by their `group` so we can colspan a single
  // header cell across each section (Fantasy Points, Passing, …).
  const groups: { group: GroupKey; count: number }[] = []
  for (const c of visibleColumns) {
    const last = groups[groups.length - 1]
    if (last && last.group === c.group) last.count += 1
    else groups.push({ group: c.group, count: 1 })
  }

  return (
    <tr>
      {/* The 4 sticky leading columns (select / drag / # / Player) live below
          this row, so we leave a single empty colspanned cell for them. */}
      <th
        className="border-b border-bg-elevated-2 bg-bg-elevated"
        colSpan={4}
        style={{ position: 'sticky', left: 0, zIndex: 11 }}
      />
      {groups.map((g, i) => (
        <th
          key={`${g.group}:${i}`}
          colSpan={g.count}
          className={cn(
            'border-b border-bg-elevated-2 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-text-secondary',
            i > 0 && 'border-l border-bg-elevated-2',
          )}
        >
          {GROUP_LABELS[g.group]}
        </th>
      ))}
      <th
        className="border-b border-l border-bg-elevated-2 bg-bg-elevated"
        style={{ position: 'sticky', right: 0, zIndex: 11, width: '56px' }}
      />
    </tr>
  )
}

function SortableTh({
  column,
  sort,
  onSort,
  groupBoundary,
}: {
  column: ColumnDef
  sort: SortState
  onSort: () => void
  groupBoundary?: boolean
}) {
  const sortKey: SortKey =
    column.sortBy.kind === 'stat'
      ? { stat: column.sortBy.field as string }
      : column.sortBy.kind
  const active = sortKeyEquals(sort.key, sortKey)
  return (
    <th
      className={cn(
        'border-b border-bg-elevated-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary',
        column.align === 'right' ? 'text-right' : 'text-left',
        groupBoundary && 'border-l border-bg-elevated-2',
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          column.align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        <span>{column.label}</span>
        {active &&
          (sort.dir === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          ))}
      </button>
    </th>
  )
}

function TeamFilterPopover({
  team,
  onChange,
}: {
  team: string
  onChange: (team: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const teams = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return TEAM_OPTIONS
    return TEAM_OPTIONS.filter((t) => t.toLowerCase().includes(q))
  }, [search])

  const select = (value: string) => {
    onChange(value)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter by team"
          className="flex h-9 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <span className={cn(team && 'text-foreground')}>
            {team || 'All teams'}
          </span>
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 border-bg-elevated-2 bg-bg-elevated p-0"
      >
        <div className="border-b border-bg-elevated-2 px-2 py-1.5">
          <div className="flex h-7 items-center gap-2 rounded-full bg-bg-elevated-3 px-3">
            <Search className="h-3.5 w-3.5 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a team…"
              className="h-full flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-text-tertiary"
            />
          </div>
        </div>
        <ul className="max-h-60 overflow-y-auto p-1">
          <li>
            <button
              type="button"
              onClick={() => select('')}
              className="flex w-full items-center justify-between gap-2 rounded-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-bg-elevated-2"
            >
              <span className="text-foreground">All teams</span>
              {team === '' && <Check className="h-3.5 w-3.5 text-foreground" />}
            </button>
          </li>
          {teams.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => select(t)}
                className="flex w-full items-center justify-between gap-2 rounded-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-bg-elevated-2"
              >
                <span className="text-foreground">{t}</span>
                {team === t && <Check className="h-3.5 w-3.5 text-foreground" />}
              </button>
            </li>
          ))}
          {teams.length === 0 && (
            <li className="px-3 py-3 text-center text-[11px] text-text-tertiary">
              No matching teams.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function ColumnsPopover({
  visible,
  onToggle,
}: {
  visible: Set<ColumnKey>
  onToggle: (key: ColumnKey) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Customize columns"
          className="flex h-9 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Customize
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 border-bg-elevated-2 bg-bg-elevated p-3"
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          Columns
        </p>
        {GROUP_ORDER.map((group) => (
          <ColumnGroup
            key={group}
            label={GROUP_LABELS[group]}
            columns={COLUMNS.filter((c) => c.group === group)}
            visible={visible}
            onToggle={onToggle}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function ColumnGroup({
  label,
  columns,
  visible,
  onToggle,
}: {
  label: string
  columns: ColumnDef[]
  visible: Set<ColumnKey>
  onToggle: (key: ColumnKey) => void
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      <ul className="space-y-0.5">
        {columns.map((c) => {
          const checked = visible.has(c.key)
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onToggle(c.key)}
                className="flex w-full items-center justify-between gap-2 rounded-full px-2 py-1 text-left text-xs transition-colors hover:bg-bg-elevated-2"
              >
                <span className="text-foreground">{c.label}</span>
                <Checkbox checked={checked} onChange={() => onToggle(c.key)} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
        checked
          ? 'border-foreground bg-foreground text-background'
          : 'border-bg-elevated-3',
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
          <path
            d="M2 6L5 9L10 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

function SearchAutocomplete({
  query,
  onQueryChange,
  allRows,
}: {
  query: string
  onQueryChange: (v: string) => void
  allRows: PlayerRow[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(RECENT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setRecents(
            parsed
              .filter((s) => typeof s === 'string')
              .slice(0, MAX_RECENT_SEARCHES),
          )
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open])

  const persistRecent = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setRecents((cur) => {
      const next = [trimmed, ...cur.filter((r) => r !== trimmed)].slice(
        0,
        MAX_RECENT_SEARCHES,
      )
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const showingRecents = query.trim().length === 0 && recents.length > 0

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) {
      if (recents.length > 0) return null
      return allRows
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .slice(0, DEFAULT_AUTOCOMPLETE_LIMIT)
    }
    return allRows
      .filter((p) => p.full_name.toLowerCase().includes(q))
      .slice(0, DEFAULT_AUTOCOMPLETE_LIMIT)
  }, [query, recents.length, allRows])

  return (
    <div ref={containerRef} className="relative">
      <div className="flex h-9 w-[180px] items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 transition-colors focus-within:border-foreground">
        <Search className="h-4 w-4 text-text-tertiary" />
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              persistRecent(query.trim())
              setOpen(false)
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          onBlur={() => {
            if (query.trim()) persistRecent(query.trim())
          }}
          placeholder="Search…"
          className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="text-text-tertiary transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-bg-elevated-2 bg-bg-elevated shadow-lg">
          {showingRecents && (
            <div>
              <p className="border-b border-bg-elevated-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Recent searches
              </p>
              <ul className="p-1">
                {recents.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => {
                        onQueryChange(r)
                        setOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-bg-elevated-2"
                    >
                      <Search className="h-3.5 w-3.5 text-text-tertiary" />
                      <span>{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!showingRecents && suggestions && suggestions.length > 0 && (
            <ul className="p-1">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/players/${p.id}`}
                    onClick={() => {
                      persistRecent(query.trim() || p.full_name)
                      setOpen(false)
                    }}
                    className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-bg-elevated-2"
                  >
                    <span className="truncate">{p.full_name}</span>
                    <span className="ml-auto text-[10px] text-text-tertiary">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!showingRecents && (!suggestions || suggestions.length === 0) && (
            <p className="px-3 py-3 text-center text-xs text-text-tertiary">
              No matches.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Th({
  children,
  align = 'left',
  width,
  sticky,
  leftOffset,
  stickyRight,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  sticky?: boolean
  leftOffset?: string
  stickyRight?: boolean
}) {
  const style: React.CSSProperties = {}
  if (width) style.width = width
  if (sticky) {
    style.position = 'sticky'
    style.left = leftOffset ?? 0
    style.zIndex = 11
    style.background = 'hsl(var(--bg-elevated))'
  }
  if (stickyRight) {
    style.position = 'sticky'
    style.right = 0
    style.zIndex = 11
    style.background = 'hsl(var(--bg-elevated))'
  }
  return (
    <th
      style={style}
      className={cn(
        'border-b border-bg-elevated-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary',
        align === 'right' ? 'text-right' : 'text-left',
        stickyRight && 'border-l border-bg-elevated-2',
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  width,
  sticky,
  leftOffset,
  stickyRight,
  mono,
  groupBoundary,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  sticky?: boolean
  leftOffset?: string
  stickyRight?: boolean
  mono?: boolean
  groupBoundary?: boolean
}) {
  const style: React.CSSProperties = {}
  if (width) style.width = width
  if (sticky) {
    style.position = 'sticky'
    style.left = leftOffset ?? 0
    style.zIndex = 5
    style.background = 'inherit'
  }
  if (stickyRight) {
    style.position = 'sticky'
    style.right = 0
    style.zIndex = 5
    style.background = 'inherit'
  }
  return (
    <td
      style={style}
      className={cn(
        'px-3 py-2',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono tabular-nums',
        groupBoundary && 'border-l border-bg-elevated-2',
        stickyRight && 'border-l border-bg-elevated-2',
      )}
    >
      {children}
    </td>
  )
}
