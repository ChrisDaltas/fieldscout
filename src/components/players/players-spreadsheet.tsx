'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AddToListPopover } from '@/components/players/add-to-list-popover'
import {
  PositionBadge,
  POSITION_TAB_ACTIVE,
} from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableHead } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
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
  | 'pts'
  | 'two_point_conversions'
  | 'pass_yards'
  | 'pass_tds'
  | 'interceptions'
  | 'pass_attempts'
  | 'pass_completions'
  | 'sacks_taken'
  | 'rush_attempts'
  | 'rush_yards'
  | 'rush_tds'
  | 'fumbles_lost'
  | 'targets'
  | 'receptions'
  | 'receiving_yards'
  | 'receiving_tds'
  | 'fg_made'
  | 'fg_attempted'
  | 'fg_made_40_plus'
  | 'fg_made_50_plus'
  | 'xp_made'
  | 'xp_attempted'
  | 'def_sacks'
  | 'def_interceptions'
  | 'def_fumble_recoveries'
  | 'def_tds'
  | 'def_safeties'

type GroupKey =
  | 'fantasy'
  | 'passing'
  | 'rushing'
  | 'receiving'
  | 'kicking'
  | 'def_st'

const GROUP_LABELS: Record<GroupKey, string> = {
  fantasy: 'Fantasy points',
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  kicking: 'Kicking',
  def_st: 'Defense',
}

const GROUP_ORDER: GroupKey[] = [
  'fantasy',
  'passing',
  'rushing',
  'receiving',
  'kicking',
  'def_st',
]

interface ColumnDef {
  key: ColumnKey
  /** Short table header — sentence case; stat codes stay caps. */
  label: string
  /** Full name shown in the customize-columns menu. */
  full: string
  group: GroupKey
  /** Season-total field in `stats_current`/`stats_last`. Absent for the
   *  computed fantasy-point columns. */
  statField?: string
  /** Part of the "Advanced stats" toggle set. */
  adv?: boolean
  /** Position-rank direction — false means lower is better (INT, FUM…). */
  higherIsBetter?: boolean
}

const COLUMNS: ColumnDef[] = [
  // Fantasy points
  { key: 'projected', label: 'Proj', full: 'Projected points', group: 'fantasy' },
  { key: 'pts', label: 'Points', full: 'Fantasy points', group: 'fantasy' },
  { key: 'two_point_conversions', label: '2PT', full: '2-point conversions', group: 'fantasy', statField: 'two_point_conversions', adv: true },
  // Passing
  { key: 'pass_yards', label: 'Yds', full: 'Passing yards', group: 'passing', statField: 'pass_yards' },
  { key: 'pass_tds', label: 'TD', full: 'Passing touchdowns', group: 'passing', statField: 'pass_tds' },
  { key: 'interceptions', label: 'INT', full: 'Interceptions thrown', group: 'passing', statField: 'interceptions', higherIsBetter: false },
  { key: 'pass_attempts', label: 'Att', full: 'Pass attempts', group: 'passing', statField: 'pass_attempts', adv: true },
  { key: 'pass_completions', label: 'Comp', full: 'Completions', group: 'passing', statField: 'pass_completions', adv: true },
  { key: 'sacks_taken', label: 'Sacked', full: 'Sacks taken', group: 'passing', statField: 'sacks_taken', adv: true, higherIsBetter: false },
  // Rushing
  { key: 'rush_attempts', label: 'Att', full: 'Rush attempts', group: 'rushing', statField: 'rush_attempts' },
  { key: 'rush_yards', label: 'Yds', full: 'Rushing yards', group: 'rushing', statField: 'rush_yards' },
  { key: 'rush_tds', label: 'TD', full: 'Rushing touchdowns', group: 'rushing', statField: 'rush_tds' },
  { key: 'fumbles_lost', label: 'FUM', full: 'Fumbles lost', group: 'rushing', statField: 'fumbles_lost', higherIsBetter: false },
  // Receiving
  { key: 'targets', label: 'Tgt', full: 'Targets', group: 'receiving', statField: 'targets' },
  { key: 'receptions', label: 'Rec', full: 'Receptions', group: 'receiving', statField: 'receptions' },
  { key: 'receiving_yards', label: 'Yds', full: 'Receiving yards', group: 'receiving', statField: 'receiving_yards' },
  { key: 'receiving_tds', label: 'TD', full: 'Receiving touchdowns', group: 'receiving', statField: 'receiving_tds' },
  // Kicking
  { key: 'fg_made', label: 'FGM', full: 'Field goals made', group: 'kicking', statField: 'fg_made' },
  { key: 'fg_attempted', label: 'FGA', full: 'Field goals attempted', group: 'kicking', statField: 'fg_attempted' },
  { key: 'fg_made_40_plus', label: 'FG 40+', full: 'Field goals 40+ yards', group: 'kicking', statField: 'fg_made_40_plus', adv: true },
  { key: 'fg_made_50_plus', label: 'FG 50+', full: 'Field goals 50+ yards', group: 'kicking', statField: 'fg_made_50_plus', adv: true },
  { key: 'xp_made', label: 'XPM', full: 'Extra points made', group: 'kicking', statField: 'xp_made' },
  { key: 'xp_attempted', label: 'XPA', full: 'Extra points attempted', group: 'kicking', statField: 'xp_attempted', adv: true },
  // Defense & special teams
  { key: 'def_sacks', label: 'Sacks', full: 'Sacks', group: 'def_st', statField: 'def_sacks' },
  { key: 'def_interceptions', label: 'INT', full: 'Interceptions', group: 'def_st', statField: 'def_interceptions' },
  { key: 'def_fumble_recoveries', label: 'FR', full: 'Fumble recoveries', group: 'def_st', statField: 'def_fumble_recoveries' },
  { key: 'def_tds', label: 'TD', full: 'Defensive touchdowns', group: 'def_st', statField: 'def_tds' },
  { key: 'def_safeties', label: 'Safety', full: 'Safeties', group: 'def_st', statField: 'def_safeties' },
]

const ADV_KEYS = COLUMNS.filter((c) => c.adv).map((c) => c.key)

const DEFAULT_VISIBLE: ColumnKey[] = [
  'projected',
  'pts',
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
const POSITION_LABELS: Record<PositionFilter, string> = {
  All: 'All',
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'D/ST',
}

type ScoringKey = 'ppr' | 'half_ppr' | 'standard'
const SCORING_OPTIONS: Array<{ id: ScoringKey; label: string }> = [
  { id: 'ppr', label: 'PPR' },
  { id: 'half_ppr', label: 'Half-PPR' },
  { id: 'standard', label: 'Standard' },
]

/** Which season's totals feed the stat cells. `last` matches the pre-Week-1
 *  default the spreadsheet has always shown. */
type SeasonKey = 'current' | 'last'

const TEAM_OPTIONS = Object.keys(NFL_TEAM_COLORS).sort()
const RECENT_KEY = 'fieldscout.player-search.recent'
const MAX_RECENT_SEARCHES = 5
const DEFAULT_AUTOCOMPLETE_LIMIT = 7

type SortKey = 'projected' | 'pts' | { stat: string }

interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface PlayersSpreadsheetProps {
  initialPosition?: PositionFilter
}

/** Ordinal for position-rank chips: 1st, 2nd, 3rd, 4th… */
function ord(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const rem10 = n % 10
  if (rem10 === 1) return `${n}st`
  if (rem10 === 2) return `${n}nd`
  if (rem10 === 3) return `${n}rd`
  return `${n}th`
}

export function PlayersSpreadsheet({ initialPosition = 'All' }: PlayersSpreadsheetProps) {
  const [position, setPosition] = useState<PositionFilter>(initialPosition)
  const [team, setTeam] = useState<string>('')
  const [scoring, setScoring] = useState<ScoringKey>('ppr')
  const [season, setSeason] = useState<SeasonKey>('last')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE),
  )
  const [advanced, setAdvanced] = useState(false)
  const [showRank, setShowRank] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'projected', dir: 'desc' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<PlayerRow[]>([])
  const [seasons, setSeasons] = useState<{ current: number; last: number }>({
    current: 2026,
    last: 2025,
  })
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

    const params = new URLSearchParams({ scoring, limit: '1500' })
    if (position !== 'All') params.set('positions', position)
    if (team) params.set('teams', team)

    fetch(`/api/players/builder?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Players failed (${res.status})`)
        return res.json() as Promise<{
          players: PlayerRow[]
          season?: { current: number; last: number }
        }>
      })
      .then((data) => {
        setRows(data.players ?? [])
        if (data.season) setSeasons(data.season)
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [position, team, scoring])

  const statsOf = (row: PlayerRow) =>
    season === 'current' ? row.stats_current : row.stats_last
  const ptsOf = (row: PlayerRow) =>
    season === 'current' ? row.current_pts : row.last_pts

  const columnValue = (row: PlayerRow, col: ColumnDef): number | null => {
    if (col.key === 'projected') return row.projected_pts
    if (col.key === 'pts') return ptsOf(row)
    return Number(statsOf(row)[col.statField ?? ''] ?? 0)
  }

  const filteredRows = useMemo(() => {
    const q = debounced.toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.full_name.toLowerCase().includes(q))
  }, [rows, debounced])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    const dir = sort.dir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      const av = sortValue(a, sort.key, season)
      const bv = sortValue(b, sort.key, season)
      return (av - bv) * dir
    })
    return copy
  }, [filteredRows, sort, season])

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols],
  )

  // Contiguous runs of the same group become spanning header bands
  // (Fantasy points · Passing · Rushing …), ESPN-style.
  const bands = useMemo(() => {
    const out: { group: GroupKey; count: number }[] = []
    for (const c of visibleColumns) {
      const last = out[out.length - 1]
      if (last && last.group === c.group) last.count += 1
      else out.push({ group: c.group, count: 1 })
    }
    return out
  }, [visibleColumns])

  // Position ranks per stat, computed from the fetched rows (the payload has
  // every player for the current filters, so ranks are derived client-side —
  // there is no server-side rank field).
  const rankIndex = useMemo(() => {
    if (!showRank) return null
    const index = new Map<ColumnKey, Map<string, number>>()
    for (const col of visibleColumns) {
      const byPos = new Map<string, { id: string; v: number }[]>()
      for (const row of rows) {
        const v = columnValue(row, col)
        if (v == null || v === 0) continue
        let bucket = byPos.get(row.position)
        if (!bucket) {
          bucket = []
          byPos.set(row.position, bucket)
        }
        bucket.push({ id: row.id, v })
      }
      const colMap = new Map<string, number>()
      const asc = col.higherIsBetter === false
      for (const bucket of byPos.values()) {
        bucket.sort((a, b) => (asc ? a.v - b.v : b.v - a.v))
        bucket.forEach((entry, i) => colMap.set(entry.id, i + 1))
      }
      index.set(col.key, colMap)
    }
    return index
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRank, rows, visibleColumns, season])

  const toggleColumn = (key: ColumnKey) => {
    setVisibleCols((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAdvanced = (on: boolean) => {
    setAdvanced(on)
    setVisibleCols((cur) => {
      const next = new Set(cur)
      for (const key of ADV_KEYS) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const resetColumns = () => {
    setVisibleCols(new Set(DEFAULT_VISIBLE))
    setAdvanced(false)
  }

  const resetFilters = () => {
    setQuery('')
    setPosition('All')
    setTeam('')
    setScoring('ppr')
    setSeason('last')
  }

  const handleSort = (col: ColumnDef) => {
    const key: SortKey = col.statField ? { stat: col.statField } : (col.key as 'projected' | 'pts')
    const sameKey = sortKeyEquals(sort.key, key)
    setSort({
      key,
      dir: sameKey ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'desc',
    })
  }

  const sortKeyForColumn = (col: ColumnDef): SortKey =>
    col.statField ? { stat: col.statField } : (col.key as 'projected' | 'pts')

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

  const selectedNames = useMemo(() => {
    if (selected.size === 0) return []
    const map = new Map(rows.map((r) => [r.id, r.full_name]))
    return Array.from(selected).map((id) => map.get(id) ?? id)
  }, [selected, rows])

  const seasonLabel = season === 'current' ? seasons.current : seasons.last
  const ptsHeader = `${seasonLabel} points`

  return (
    <div className="space-y-4">
      <SelectionBar
        count={selected.size}
        names={selectedNames}
        playerIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
      />

      {error && (
        <p className="rounded-sm border border-negative bg-negative-soft p-3 text-[13px] font-semibold text-negative-strong">
          {error}
        </p>
      )}

      <Card>
        {/* Row 0 — search */}
        <div className="border-b border-n-4 px-4 py-2.5">
          <SearchAutocomplete
            query={query}
            onQueryChange={setQuery}
            allRows={rows}
          />
        </div>

        {/* Row 1 — positions + table controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-n-4 px-4 py-3">
          <Tabs
            value={position}
            onValueChange={(v) => setPosition(v as PositionFilter)}
          >
            <TabsList>
              {POSITION_FILTERS.map((p) => (
                <TabsTrigger key={p} value={p} className={POSITION_TAB_ACTIVE[p]}>
                  {POSITION_LABELS[p]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={advanced} onCheckedChange={toggleAdvanced} />
              <span className="text-[12px] font-bold">Advanced stats</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={showRank} onCheckedChange={setShowRank} />
              <span className="text-[12px] font-bold">Show rank</span>
            </label>
            <CustomizePopover
              visible={visibleCols}
              onToggle={toggleColumn}
              onReset={resetColumns}
            />
          </div>
        </div>

        {/* Row 2 — labeled filters + reset + result count */}
        <div className="flex flex-wrap items-end gap-3 border-b border-ink px-4 py-2.5">
          <div className="w-[130px]">
            <div className="mb-1 text-[10px] font-medium text-n-3">Pro team</div>
            <Select
              value={team || 'all'}
              onValueChange={(v) => setTeam(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-btn-md px-2.5 text-[12px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[12px]">
                  All teams
                </SelectItem>
                {TEAM_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t} className="text-[12px]">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[124px]">
            <div className="mb-1 text-[10px] font-medium text-n-3">Scoring</div>
            <Select
              value={scoring}
              onValueChange={(v) => setScoring(v as ScoringKey)}
            >
              <SelectTrigger className="h-btn-md px-2.5 text-[12px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCORING_OPTIONS.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-[12px]">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[104px]">
            <div className="mb-1 text-[10px] font-medium text-n-3">Season</div>
            <Select
              value={season}
              onValueChange={(v) => setSeason(v as SeasonKey)}
            >
              <SelectTrigger className="h-btn-md px-2.5 text-[12px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current" className="text-[12px]">
                  {String(seasons.current)}
                </SelectItem>
                <SelectItem value="last" className="text-[12px]">
                  {String(seasons.last)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="md" onClick={resetFilters}>
            Reset
          </Button>
          <span className="fs-num ml-auto pb-1.5 text-[12px] font-bold text-n-3">
            {sortedRows.length} players · {seasonLabel} season
          </span>
        </div>

        {/* Table */}
        <div className="max-h-[calc(100dvh-15rem)] overflow-auto overscroll-contain">
          {/* border-separate (not the ui/table root's border-collapse) so the
              sticky header + lead columns keep their borders while scrolling. */}
          <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                {/* One empty band cell spans the 4 sticky lead columns. */}
                <th
                  colSpan={4}
                  className="sticky left-0 z-[11] border-b border-n-4 bg-white"
                />
                {bands.map((b, i) => (
                  <th
                    key={`${b.group}:${i}`}
                    colSpan={b.count}
                    className={cn(
                      'fs-overline whitespace-nowrap border-b border-n-4 bg-white px-3 pb-0.5 pt-1.5 text-center text-n-3',
                      i > 0 && 'border-l border-n-4',
                    )}
                  >
                    {GROUP_LABELS[b.group]}
                  </th>
                ))}
              </tr>
              <tr>
                <StickyTh width="36px">
                  <span className="flex items-center justify-center">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all players"
                    />
                  </span>
                </StickyTh>
                <StickyTh leftOffset="36px" width="48px">
                  <span className="sr-only">Add to list</span>
                </StickyTh>
                <StickyTh leftOffset="84px" width="40px" align="right">
                  #
                </StickyTh>
                <StickyTh leftOffset="124px" width="240px">
                  Player
                </StickyTh>
                {visibleColumns.map((c, i) => {
                  const prev = i > 0 ? visibleColumns[i - 1] : undefined
                  const startsGroup = !prev || prev.group !== c.group
                  return (
                    <SortableTh
                      key={c.key}
                      column={c}
                      label={c.key === 'pts' ? ptsHeader : c.label}
                      active={sortKeyEquals(sort.key, sortKeyForColumn(c))}
                      dir={sort.dir}
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
                  <td colSpan={visibleColumns.length + 4} className="p-3">
                    <div className="space-y-1">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && sortedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 4}
                    className="p-7 text-center text-[13px] font-semibold text-n-3"
                  >
                    {debounced
                      ? `No players match "${debounced}".`
                      : 'No players match these filters.'}
                  </td>
                </tr>
              )}
              {sortedRows.map((row, i) => (
                <PlayerTableRow
                  key={row.id}
                  rank={i + 1}
                  row={row}
                  visibleColumns={visibleColumns}
                  columnValue={columnValue}
                  rankIndex={rankIndex}
                  sortKey={sort.key}
                  selected={selected.has(row.id)}
                  onToggleSelect={() => toggleSelected(row.id)}
                  onOpenPlayer={() => openPlayer(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ink px-4 py-2">
          <span className="fs-num text-[11px] font-semibold text-n-3">
            Showing {sortedRows.length} of {rows.length} players
          </span>
          <span className="text-[11px] font-medium text-n-3">
            Scroll horizontally for more columns
          </span>
        </div>
      </Card>
    </div>
  )
}

function sortValue(row: PlayerRow, key: SortKey, season: SeasonKey): number {
  if (typeof key === 'object' && 'stat' in key) {
    const stats = season === 'current' ? row.stats_current : row.stats_last
    return Number(stats[key.stat] ?? 0)
  }
  switch (key) {
    case 'projected':
      // Sort missing projections to the bottom — never confuse "no
      // projection" with "0 projected points".
      return row.projected_pts ?? -Infinity
    case 'pts':
      return season === 'current' ? row.current_pts : row.last_pts
    default:
      return 0
  }
}

function sortKeyEquals(a: SortKey, b: SortKey): boolean {
  if (typeof a === 'object' && typeof b === 'object') {
    return a.stat === b.stat
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
  const primaryName = count === 1 ? names[0] : `${count} players`
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-ink bg-white p-3">
      <AddToListPopover
        playerIds={playerIds}
        playerName={primaryName}
        triggerVariant="primary"
      />
      <span className="text-[13px] font-medium text-n-3">
        <span className="fs-num font-bold text-ink">{count}</span> player
        {count === 1 ? '' : 's'} selected
      </span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  )
}

function PlayerTableRow({
  rank,
  row,
  visibleColumns,
  columnValue,
  rankIndex,
  sortKey,
  selected,
  onToggleSelect,
  onOpenPlayer,
}: {
  rank: number
  row: PlayerRow
  visibleColumns: ColumnDef[]
  columnValue: (row: PlayerRow, col: ColumnDef) => number | null
  rankIndex: Map<ColumnKey, Map<string, number>> | null
  sortKey: SortKey
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

  return (
    <tr
      className={cn(
        'group transition-colors hover:bg-accent-soft',
        selected && 'bg-accent-soft',
      )}
    >
      <StickyTd width="36px" highlight={selected}>
        <span className="flex items-center justify-center">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select ${row.full_name}`}
          />
        </span>
      </StickyTd>
      <StickyTd leftOffset="36px" width="48px" highlight={selected}>
        <span className="flex items-center justify-center">
          <AddToListPopover
            playerIds={[row.id]}
            playerName={row.full_name}
            align="start"
          />
        </span>
      </StickyTd>
      <StickyTd leftOffset="84px" width="40px" align="right" highlight={selected}>
        <span className="fs-num text-[11px] font-semibold text-n-3">{rank}</span>
      </StickyTd>
      <StickyTd leftOffset="124px" width="240px" highlight={selected}>
        <div className="flex items-center gap-2.5">
          <Avatar className="h-6 w-6">
            {row.headshot_url && (
              <AvatarImage
                src={row.headshot_url}
                alt={row.full_name}
                className="h-full w-full object-cover object-top"
              />
            )}
            <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onOpenPlayer}
              className="block max-w-full truncate text-left text-[13px] font-extrabold leading-tight hover:underline hover:decoration-2 hover:underline-offset-2 focus:outline-none focus-visible:underline"
            >
              {row.full_name}
            </button>
            <div className="mt-0.5 flex items-center gap-1.5">
              <PositionBadge position={row.position} />
              {row.team && (
                <span className="text-[11px] font-semibold text-n-3">
                  {row.team}
                </span>
              )}
            </div>
          </div>
        </div>
      </StickyTd>
      {visibleColumns.map((c, i) => {
        const prev = i > 0 ? visibleColumns[i - 1] : undefined
        const startsGroup = !prev || prev.group !== c.group
        const value = columnValue(row, c)
        const posRank = rankIndex?.get(c.key)?.get(row.id) ?? null
        return (
          <StatCell
            key={c.key}
            column={c}
            value={value}
            posRank={posRank}
            position={row.position}
            groupBoundary={startsGroup}
            sorted={sortKeyEquals(
              sortKey,
              c.statField ? { stat: c.statField } : (c.key as 'projected' | 'pts'),
            )}
          />
        )
      })}
    </tr>
  )
}

function StatCell({
  column,
  value,
  posRank,
  position,
  groupBoundary,
  sorted,
}: {
  column: ColumnDef
  value: number | null
  posRank: number | null
  position: string
  groupBoundary?: boolean
  sorted?: boolean
}) {
  const cellClass = cn(
    'whitespace-nowrap border-b border-n-4 text-right',
    groupBoundary && 'border-l border-n-4',
    sorted && 'bg-accent-soft/30',
  )

  // Missing projection / zero counting stat both read as an em dash — we
  // never fabricate a number (see aggregate-fantasy.ts for the rule).
  const empty =
    value == null || (column.key !== 'projected' && column.key !== 'pts' && value === 0)
  if (empty) {
    return (
      <TableCell className={cellClass}>
        <span className="fs-num text-n-3">—</span>
      </TableCell>
    )
  }

  const text =
    column.key === 'projected'
      ? value.toFixed(1)
      : column.key === 'pts'
        ? value.toFixed(0)
        : value.toLocaleString()

  return (
    <TableCell className={cellClass}>
      <span className="fs-num text-[13px] font-bold">{text}</span>
      {posRank != null && (
        <div className="fs-num text-[9px] font-medium leading-tight text-n-3">
          {ord(posRank)} {position}
        </div>
      )}
    </TableCell>
  )
}

function SortableTh({
  column,
  label,
  active,
  dir,
  onSort,
  groupBoundary,
}: {
  column: ColumnDef
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onSort: () => void
  groupBoundary?: boolean
}) {
  return (
    <TableHead
      className={cn(
        'whitespace-nowrap border-b border-ink bg-white text-right align-bottom',
        groupBoundary && 'border-l border-n-4',
        active && 'bg-accent-soft text-accent-strong',
      )}
      aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        onClick={onSort}
        title={column.full}
        className={cn(
          'inline-flex w-full items-center justify-end gap-1 transition-colors hover:text-ink',
          active && 'text-accent-strong hover:text-accent-strong',
        )}
      >
        <span>{label}</span>
        {active && (
          <Icon
            name="arrow-bottom"
            size={12}
            className={cn(dir === 'asc' && 'rotate-180')}
          />
        )}
      </button>
    </TableHead>
  )
}

function CustomizePopover({
  visible,
  onToggle,
  onReset,
}: {
  visible: Set<ColumnKey>
  onToggle: (key: ColumnKey) => void
  onReset: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="stroke" size="sm">
          <Icon name="setup" size={13} /> Customize
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[480px] w-64 overflow-y-auto p-0">
        <div className="flex items-center justify-between gap-2 border-b border-n-4 px-3 py-2">
          <span className="fs-overline text-n-3">Show columns</span>
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-bold text-ink transition-colors hover:text-accent"
          >
            Reset columns
          </button>
        </div>
        <div className="py-1">
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <div className="fs-overline px-3 pb-0.5 pt-2 text-accent-strong">
                {GROUP_LABELS[group]}
              </div>
              {COLUMNS.filter((c) => c.group === group).map((c) => {
                const checked = visible.has(c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => onToggle(c.key)}
                    className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] font-medium transition-colors hover:bg-accent-soft"
                  >
                    {/* Static check tile (the ui/checkbox recipe) — a real
                        Checkbox here would nest a button inside a button. */}
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                        checked
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-ink bg-white',
                      )}
                    >
                      {checked && <Icon name="check" size={12} />}
                    </span>
                    <span>{c.full}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
    <div ref={containerRef} className="relative max-w-[272px]">
      <div className="flex h-btn-md items-center gap-2 rounded-sm border border-ink bg-white px-2.5 transition-colors focus-within:border-accent">
        <Icon name="search" size={13} className="text-n-3" />
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
          placeholder="Search players…"
          className="h-full flex-1 bg-transparent text-[12px] font-bold text-ink outline-none placeholder:text-n-3"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="text-n-3 transition-colors hover:text-ink"
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-sm border border-ink bg-white shadow-hard-4">
          {showingRecents && (
            <div>
              <p className="fs-overline border-b border-n-4 px-3 py-2 text-n-3">
                Recent searches
              </p>
              <ul className="py-1">
                {recents.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => {
                        onQueryChange(r)
                        setOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium transition-colors hover:bg-accent-soft"
                    >
                      <Icon name="search" size={12} className="text-n-3" />
                      <span>{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!showingRecents && suggestions && suggestions.length > 0 && (
            <ul className="py-1">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/players/${p.id}`}
                    onClick={() => {
                      persistRecent(query.trim() || p.full_name)
                      setOpen(false)
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-bold transition-colors hover:bg-accent-soft"
                  >
                    <span className="truncate">{p.full_name}</span>
                    <span className="ml-auto text-[10px] font-semibold text-n-3">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!showingRecents && (!suggestions || suggestions.length === 0) && (
            <p className="px-3 py-3 text-center text-[12px] font-medium text-n-3">
              No matches.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Sticky lead header cell — opaque so scrolled columns slide beneath it. */
function StickyTh({
  children,
  align = 'left',
  width,
  leftOffset,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  leftOffset?: string
}) {
  return (
    <TableHead
      style={{ width, position: 'sticky', left: leftOffset ?? 0, zIndex: 11 }}
      className={cn(
        'border-b border-ink bg-white align-bottom',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </TableHead>
  )
}

/** Sticky lead body cell — its own fill must follow the row hover/selection
 *  because a transparent sticky cell would show columns sliding beneath. */
function StickyTd({
  children,
  align = 'left',
  width,
  leftOffset,
  highlight,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  leftOffset?: string
  highlight?: boolean
}) {
  return (
    <TableCell
      style={{ width, position: 'sticky', left: leftOffset ?? 0, zIndex: 5 }}
      className={cn(
        'border-b border-n-4 transition-colors group-hover:bg-accent-soft',
        highlight ? 'bg-accent-soft' : 'bg-white',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </TableCell>
  )
}
