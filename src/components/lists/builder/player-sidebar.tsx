'use client'

import { useDraggable } from '@dnd-kit/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PlayerRow, type PlayerRowStat } from '@/components/players/player-row'
import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

import {
  POSITION_FILTERS,
  type BuilderPlayer,
  type Position,
  type StatColumnPrefs,
} from './types'

interface PlayerSidebarProps {
  scoring: 'ppr' | 'standard' | 'half_ppr'
  added: Set<string>
  onAddPlayer: (player: BuilderPlayer) => void
  /**
   * When true, rows are rendered without dnd-kit draggable hooks so the
   * sidebar can be mounted outside a DndContext (e.g. on the list detail
   * page where adding is click-only).
   */
  disableDrag?: boolean
  /**
   * When set, the sidebar is locked to these positions (the user-toggleable
   * position chips are hidden). Used on list detail pages where the parent
   * list has a position filter — e.g. a WR list should only ever surface
   * WRs in its picker.
   */
  lockedPositions?: readonly string[] | null
  /** 'cards' renders a 2-up grid of player tiles instead of rows. */
  layout?: 'rows' | 'cards'
  /**
   * Drops the sidebar's own border/background so it can live inside a
   * floating panel that supplies its own surface.
   */
  frameless?: boolean
}

const TEAM_OPTIONS = Object.keys(NFL_TEAM_COLORS).sort()

/** Radix Select forbids empty-string item values — sentinel for "all". */
const ALL_TEAMS = 'all'

export function PlayerSidebar({
  scoring,
  added,
  onAddPlayer,
  disableDrag = false,
  lockedPositions,
  layout = 'rows',
  frameless = false,
}: PlayerSidebarProps) {
  const [query, setQuery] = useState('')
  const [positions, setPositions] = useState<Set<Position>>(new Set())
  const [team, setTeam] = useState<string>('')
  const [statCols, setStatCols] = useState<StatColumnPrefs>({
    current: true,
    last: true,
  })
  const [showAdded, setShowAdded] = useState(true)

  const [players, setPlayers] = useState<BuilderPlayer[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isLocked = Boolean(lockedPositions && lockedPositions.length > 0)

  // Fetch from server when scoring or position/team filters change.
  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setError(null)

    // Full active pool (~1000). The sidebar search filters client-side over
    // this fetch, so any smaller limit makes the excluded players unfindable.
    const params = new URLSearchParams({ scoring, limit: '1500' })
    const effectivePositions =
      lockedPositions && lockedPositions.length > 0
        ? Array.from(lockedPositions)
        : positions.size > 0
          ? Array.from(positions)
          : null
    if (effectivePositions) params.set('positions', effectivePositions.join(','))
    if (team) params.set('teams', team)

    fetch(`/api/players/builder?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Players failed (${res.status})`)
        return res.json() as Promise<{ players: BuilderPlayer[] }>
      })
      .then((data) => {
        setPlayers(data.players ?? [])
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [scoring, positions, team, lockedPositions])

  const filtered = useMemo(() => {
    let result = players
    const q = query.trim().toLowerCase()
    if (q) result = result.filter((p) => p.full_name.toLowerCase().includes(q))
    if (!showAdded) result = result.filter((p) => !added.has(p.id))
    return result
  }, [players, query, showAdded, added])

  const togglePosition = (pos: Position) => {
    setPositions((cur) => {
      const next = new Set(cur)
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      return next
    })
  }

  return (
    <aside
      className={cn(
        'flex h-full w-full flex-col',
        !frameless && 'rounded-sm border border-ink bg-white',
      )}
    >
      <div
        className={cn('space-y-2.5 p-3', !frameless && 'border-b border-ink')}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-btn-md flex-1 items-center gap-1.5 rounded-sm border border-ink bg-white px-2.5 transition-colors focus-within:border-accent">
            <Icon name="search" size={13} className="shrink-0 text-n-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] font-medium text-ink outline-none placeholder:text-n-3"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 text-n-3 transition-colors hover:text-ink"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="stroke"
                size="icon-md"
                aria-label="Player list options"
              >
                <Icon name="setup" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-3">
              <p className="mb-2 text-[12px] font-bold text-ink">
                Stat columns
              </p>
              <ul className="space-y-1">
                <ToggleRow
                  label="Projected total"
                  description="Always shown"
                  checked
                  disabled
                  onChange={() => {}}
                />
                <ToggleRow
                  label="Current season pts"
                  checked={statCols.current}
                  onChange={(v) => setStatCols((s) => ({ ...s, current: v }))}
                />
                <ToggleRow
                  label="Last season pts"
                  checked={statCols.last}
                  onChange={(v) => setStatCols((s) => ({ ...s, last: v }))}
                />
              </ul>
            </PopoverContent>
          </Popover>
        </div>

        {!isLocked && (
          <div className="flex flex-wrap gap-1.5">
            {POSITION_FILTERS.map((pos) => (
              <FilterChip
                key={pos}
                pressed={positions.has(pos)}
                onPressedChange={() => togglePosition(pos)}
                className="px-2"
              >
                {pos}
              </FilterChip>
            ))}
          </div>
        )}

        <Select
          value={team || ALL_TEAMS}
          onValueChange={(v) => setTeam(v === ALL_TEAMS ? '' : v)}
        >
          <SelectTrigger
            aria-label="Filter by team"
            className="h-btn-md px-2.5 text-[12px] font-bold"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TEAMS}>All teams</SelectItem>
            {TEAM_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm border border-ink bg-white px-2.5 py-1.5">
          <span className="text-[12px] font-bold text-ink">
            Show added players
          </span>
          <Switch checked={showAdded} onCheckedChange={setShowAdded} />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <p className="m-3 rounded-sm border border-negative-strong bg-negative-soft p-2.5 text-[12px] font-medium text-ink">
            {error}
          </p>
        )}
        {isLoading && players.length === 0 && (
          <div className="space-y-1 p-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="p-6 text-center text-[12px] font-medium text-n-3">
            No players match these filters.
          </p>
        )}

        {layout === 'cards' ? (
          <ul className="grid grid-cols-2 gap-2 p-3 pt-1">
            {filtered.map((player) => (
              <SidebarPlayerCard
                key={player.id}
                player={player}
                added={added.has(player.id)}
                onAdd={() => onAddPlayer(player)}
              />
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-n-4">
            {filtered.map((player) => {
              const isAdded = added.has(player.id)
              const Row = disableDrag ? SidebarPlayerRowStatic : SidebarPlayerRow
              return (
                <Row
                  key={player.id}
                  player={player}
                  added={isAdded}
                  statCols={statCols}
                  onAdd={() => onAddPlayer(player)}
                />
              )
            })}
          </ul>
        )}

        <p className="fs-num p-3 text-center text-[10px] font-semibold text-n-3">
          Showing {filtered.length} of top {players.length} players
        </p>
      </div>
    </aside>
  )
}

/** Checkbox row for the stat-column popover — accent-blue checkbox per the
 *  control recipes; the always-on projected column renders disabled. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <li>
      <label
        className={cn(
          'flex items-center justify-between gap-3 rounded-sm px-1 py-1 transition-colors',
          disabled ? 'cursor-default' : 'cursor-pointer hover:bg-n-4/60',
        )}
      >
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-ink">
            {label}
          </span>
          {description && (
            <span className="block text-[10px] font-medium text-n-3">
              {description}
            </span>
          )}
        </span>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v === true)}
        />
      </label>
    </li>
  )
}

interface SidebarPlayerRowProps {
  player: BuilderPlayer
  added: boolean
  statCols: StatColumnPrefs
  onAdd: () => void
}

/**
 * Card tile for the list-detail player picker — click anywhere on the card
 * to add the player, or drag it onto the list (or a sidebar-nav list). The
 * drag registers with the app-level DndContext using the global
 * `kind: 'players'` payload; the moving preview is the AppDndContext
 * DragOverlay chip, so the card itself never leaves the panel.
 */
function SidebarPlayerCard({
  player,
  added,
  onAdd,
}: {
  player: BuilderPlayer
  added: boolean
  onAdd: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-card:${player.id}`,
    data: {
      kind: 'players',
      playerIds: [player.id],
      label: player.full_name,
      // Full player so the DragOverlay can render a real PlayerCard preview.
      player,
    },
    disabled: added,
  })

  // The card is both click-to-add and a drag source — swallow the click
  // that some browsers fire right after a completed drag so the drop
  // handler's add isn't doubled by onClick.
  const wasDragging = useRef(false)
  if (isDragging) wasDragging.current = true

  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => {
          if (wasDragging.current) {
            wasDragging.current = false
            return
          }
          if (!added) onAdd()
        }}
        disabled={added}
        aria-label={
          added ? `${player.full_name} already added` : `Add ${player.full_name}`
        }
        className={cn(
          'group relative flex w-full touch-manipulation flex-col items-center gap-1.5 rounded-sm border border-ink bg-white p-2.5 pt-3 transition-all',
          added
            ? 'cursor-default bg-n-4/60'
            : 'cursor-grab hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4 active:cursor-grabbing',
          isDragging && 'opacity-40',
        )}
      >
        <span
          className={cn(
            'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm border border-ink transition-opacity',
            added
              ? 'bg-positive text-ink opacity-100'
              : 'bg-accent text-white opacity-0 group-hover:opacity-100',
          )}
        >
          <Icon name={added ? 'check' : 'plus'} size={11} />
        </span>

        <Avatar className="h-12 w-12 shrink-0">
          {player.headshot_url && (
            <AvatarImage
              src={player.headshot_url}
              alt={player.full_name}
              className="h-full w-full object-cover object-top"
            />
          )}
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>

        <span
          className="w-full truncate text-center text-[12px] font-extrabold leading-tight text-ink"
          title={player.full_name}
        >
          {player.full_name}
        </span>

        <span className="flex items-center gap-1.5">
          <PositionBadge position={player.position} size="sm" />
          {player.team && (
            <span className="text-[10px] font-semibold text-n-3">
              {player.team}
            </span>
          )}
        </span>

        {player.projected_pts != null && (
          <span className="fs-num text-[10px] font-semibold text-n-3">
            Proj {player.projected_pts.toFixed(1)}
          </span>
        )}
      </button>
    </li>
  )
}

/** Stat cells for the row layout — zeros/nulls render as an em dash so the
 *  mono columns stay aligned across rows. */
function rowStats(player: BuilderPlayer, statCols: StatColumnPrefs): PlayerRowStat[] {
  const fmt = (value: number | null, hideZero = false) =>
    value == null || (hideZero && value === 0) ? '—' : value.toFixed(0)
  const stats: PlayerRowStat[] = [
    { label: 'Proj', value: fmt(player.projected_pts) },
  ]
  if (statCols.current) stats.push({ label: '2026', value: fmt(player.current_pts, true) })
  if (statCols.last) stats.push({ label: '2025', value: fmt(player.last_pts, true) })
  return stats
}

function SidebarPlayerRow({ player, added, statCols, onAdd }: SidebarPlayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sidebar:${player.id}`,
    data: { kind: 'sidebar-player', player },
    disabled: added,
  })

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : {}

  return (
    <li ref={setNodeRef} style={style} className="relative">
      <PlayerRow
        rank={0}
        showRank={false}
        density="compact"
        player={player}
        draggable={!added}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        stats={rowStats(player, statCols)}
        trailing={<AddButton player={player} added={added} onAdd={onAdd} />}
      />
    </li>
  )
}

function SidebarPlayerRowStatic({
  player,
  added,
  statCols,
  onAdd,
}: SidebarPlayerRowProps) {
  return (
    <li>
      <PlayerRow
        rank={0}
        showRank={false}
        density="compact"
        player={player}
        stats={rowStats(player, statCols)}
        trailing={<AddButton player={player} added={added} onAdd={onAdd} />}
      />
    </li>
  )
}

function AddButton({
  player,
  added,
  onAdd,
}: {
  player: BuilderPlayer
  added: boolean
  onAdd: () => void
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (!added) onAdd()
      }}
      disabled={added}
      aria-label={added ? `${player.full_name} already added` : `Add ${player.full_name}`}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink transition-colors',
        added
          ? 'cursor-default border-positive bg-positive-soft text-ink'
          : 'bg-white text-ink hover:bg-ink hover:text-white',
      )}
    >
      <Icon name={added ? 'check' : 'plus'} size={12} />
    </button>
  )
}
