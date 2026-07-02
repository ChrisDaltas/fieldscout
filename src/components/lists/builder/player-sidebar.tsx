'use client'

import { useDraggable } from '@dnd-kit/core'
import { Check, ChevronDown, Plus, Search, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { darkTeamPrimary, getTeamColors, NFL_TEAM_COLORS, teamTintBackground } from '@/lib/nfl-team-colors'
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

    const params = new URLSearchParams({ scoring, limit: '400' })
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
        !frameless && 'border-r border-bg-elevated-2 bg-bg-elevated',
      )}
    >
      <div
        className={cn(
          'space-y-3 p-3',
          !frameless && 'border-b border-bg-elevated-2',
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3">
            <Search className="h-4 w-4 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-text-tertiary transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Player list options"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-bg-elevated-2 bg-bg-elevated-3 text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-56 border-bg-elevated-2 bg-bg-elevated p-3"
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
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
            {POSITION_FILTERS.map((pos) => {
              const active = positions.has(pos)
              return (
                <button
                  key={pos}
                  type="button"
                  onClick={() => togglePosition(pos)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                  )}
                >
                  {pos}
                </button>
              )
            })}
          </div>
        )}

        <div className="relative">
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="h-9 w-full appearance-none rounded-full border border-bg-elevated-2 bg-bg-elevated-3 pl-3 pr-9 text-xs text-foreground focus:border-foreground focus:outline-none"
          >
            <option value="">All teams</option>
            {TEAM_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {/* Custom arrow so its right gap matches the "All teams" left gap. */}
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showAdded}
          onClick={() => setShowAdded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
        >
          <span>Show added players</span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wider',
                showAdded ? 'text-foreground' : 'text-text-tertiary',
              )}
            >
              {showAdded ? 'On' : 'Off'}
            </span>
            <span
              className={cn(
                'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
                showAdded ? 'bg-foreground' : 'bg-bg-elevated-2',
              )}
            >
              <span
                className={cn(
                  'absolute h-3 w-3 rounded-full transition-transform',
                  showAdded ? 'translate-x-3.5 bg-background' : 'translate-x-0.5 bg-foreground',
                )}
              />
            </span>
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <p className="p-3 text-xs text-destructive">{error}</p>
        )}
        {isLoading && players.length === 0 && (
          <div className="space-y-1 p-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded" />
            ))}
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="p-6 text-center text-xs text-text-tertiary">
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
          <ul>
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

        <p className="p-3 text-center text-[10px] text-text-tertiary">
          Showing {filtered.length} of top {players.length} players
        </p>
      </div>
    </aside>
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
  const teamColor = darkTeamPrimary(player.team)
  const tintBg = teamTintBackground(player.team, 0.22)

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
          'group relative flex w-full touch-manipulation flex-col items-center gap-1.5 rounded-lg bg-bg-elevated p-2.5 pt-3 transition-colors',
          added
            ? 'cursor-default opacity-60'
            : 'cursor-grab hover:bg-bg-elevated-3 active:cursor-grabbing',
          isDragging && 'opacity-40',
        )}
      >
        <span
          className={cn(
            'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-opacity',
            added
              ? 'bg-tier-a/90 text-background opacity-100'
              : 'bg-foreground text-background opacity-0 group-hover:opacity-100',
          )}
        >
          {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </span>

        <Avatar
          className="h-12 w-12 shrink-0 border-2"
          style={{ backgroundColor: tintBg, borderColor: teamColor }}
        >
          {player.headshot_url && (
            <AvatarImage
              src={player.headshot_url}
              alt={player.full_name}
              className="h-full w-full object-cover object-top"
            />
          )}
          <AvatarFallback className="text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <span
          className="w-full truncate text-center text-xs font-semibold leading-tight"
          title={player.full_name}
        >
          {player.full_name}
        </span>

        <span className="flex items-center gap-1.5">
          <PositionBadge position={player.position} />
          {player.team && (
            <span className="text-[10px] text-text-secondary">{player.team}</span>
          )}
        </span>

        {player.projected_pts != null && (
          <span className="text-[10px] font-medium tabular-nums text-text-tertiary">
            Proj {player.projected_pts.toFixed(1)}
          </span>
        )}
      </button>
    </li>
  )
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
    <SidebarPlayerRowContent
      player={player}
      added={added}
      statCols={statCols}
      onAdd={onAdd}
      rowProps={{
        ref: setNodeRef,
        style,
        ...attributes,
        ...listeners,
      }}
      extraClassName={cn(
        added ? 'cursor-default' : 'cursor-grab',
        isDragging && 'cursor-grabbing bg-bg-elevated-2 shadow-lg shadow-black/40',
      )}
    />
  )
}

function SidebarPlayerRowStatic({
  player,
  added,
  statCols,
  onAdd,
}: SidebarPlayerRowProps) {
  return (
    <SidebarPlayerRowContent
      player={player}
      added={added}
      statCols={statCols}
      onAdd={onAdd}
    />
  )
}

interface SidebarPlayerRowContentProps extends SidebarPlayerRowProps {
  rowProps?: React.HTMLAttributes<HTMLLIElement> & {
    ref?: React.Ref<HTMLLIElement>
  }
  extraClassName?: string
}

function SidebarPlayerRowContent({
  player,
  added,
  statCols,
  onAdd,
  rowProps,
  extraClassName,
}: SidebarPlayerRowContentProps) {
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  const teamColor = darkTeamPrimary(player.team)
  const tintBg = teamTintBackground(player.team, 0.22)

  return (
    <li
      {...rowProps}
      className={cn(
        'group flex items-center gap-2 border-b border-bg-elevated-2/50 px-3 py-2 transition-colors hover:bg-bg-elevated-2',
        extraClassName,
      )}
    >
      <Avatar
        className="h-8 w-8 shrink-0 border-2"
        style={{ backgroundColor: tintBg, borderColor: teamColor }}
      >
        {player.headshot_url && (
          <AvatarImage
            src={player.headshot_url}
            alt={player.full_name}
            className="h-full w-full object-cover object-top"
          />
        )}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight">
          {player.full_name}
        </p>
        <div className="flex items-center gap-1">
          <PositionBadge position={player.position} />
          {player.team && (
            <span className="text-[10px] text-text-secondary">{player.team}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-right text-[11px] tabular-nums">
        <StatPill label="Proj" value={player.projected_pts} accent />
        {statCols.current && (
          <StatPill label="2026" value={player.current_pts} hideZero />
        )}
        {statCols.last && <StatPill label="2025" value={player.last_pts} hideZero />}
      </div>

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          if (!added) onAdd()
        }}
        disabled={added}
        aria-label={added ? 'Already added' : 'Add to list'}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
          added
            ? 'cursor-default bg-tier-a/15 text-tier-a'
            : 'bg-bg-elevated-3 text-text-secondary hover:bg-foreground hover:text-background',
        )}
      >
        {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>
    </li>
  )
}

function StatPill({
  label,
  value,
  accent,
  hideZero,
}: {
  label: string
  value: number | null
  accent?: boolean
  hideZero?: boolean
}) {
  if (value === null) {
    return (
      <span className="flex w-12 flex-col items-end leading-tight">
        <span className="text-[8px] uppercase tracking-wider text-text-tertiary">
          {label}
        </span>
        <span className="text-text-tertiary">—</span>
      </span>
    )
  }
  if (hideZero && value === 0) return <span className="w-12" />
  return (
    <span className="flex w-12 flex-col items-end leading-tight">
      <span className="text-[8px] uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
      <span
        className={cn('font-semibold', accent ? 'text-foreground' : 'text-foreground')}
      >
        {value.toFixed(0)}
      </span>
    </span>
  )
}

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
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex w-full items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs hover:bg-bg-elevated-2 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="min-w-0">
          <p className="text-foreground">{label}</p>
          {description && (
            <p className="text-[10px] text-text-tertiary">{description}</p>
          )}
        </div>
        <span
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
            checked ? 'bg-foreground' : 'bg-bg-elevated-3',
          )}
        >
          <span
            className={cn(
              'absolute h-3 w-3 rounded-full transition-all',
              checked
                ? 'translate-x-3.5 bg-background'
                : 'translate-x-0.5 bg-foreground',
            )}
          />
        </span>
      </button>
    </li>
  )
}
