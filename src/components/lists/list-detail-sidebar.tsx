'use client'

import { useEffect, useState } from 'react'

import { PlayerSidebar } from '@/components/lists/builder/player-sidebar'
import type { BuilderPlayer } from '@/components/lists/builder/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { darkTeamPrimary, teamTintBackground } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

// The list detail page needs this sidebar to function (it's how players get
// added to the list), so it's never fully hidden — only `full` or `condensed`.
type SidebarMode = 'full' | 'condensed'

const STORAGE_KEY = 'list-detail-sidebar-mode'

function readStoredMode(): SidebarMode {
  if (typeof window === 'undefined') return 'full'
  const v = window.localStorage.getItem(STORAGE_KEY)
  // Old values (including the deprecated 'hidden') fall back to 'full'.
  return v === 'condensed' ? 'condensed' : 'full'
}

/**
 * Maps a list's position_filter to the set of player positions the picker
 * should show. FLEX expands to RB/WR/TE; null/empty means no restriction.
 */
function expandPositionFilter(
  positionFilter: string | null | undefined,
): readonly string[] | null {
  if (!positionFilter) return null
  const upper = positionFilter.toUpperCase()
  if (upper === 'FLEX') return ['RB', 'WR', 'TE']
  if (
    upper === 'QB' ||
    upper === 'RB' ||
    upper === 'WR' ||
    upper === 'TE' ||
    upper === 'K' ||
    upper === 'DEF'
  ) {
    return [upper]
  }
  return null
}

interface ListDetailSidebarProps {
  scoring: 'ppr' | 'standard' | 'half_ppr'
  added: Set<string>
  onAddPlayer: (playerId: string) => void
  /**
   * Locks the player picker to the parent list's position filter. A WR list
   * only surfaces WRs; a FLEX list shows RBs/WRs/TEs; null = all positions.
   */
  positionFilter?: string | null
}

export function ListDetailSidebar({
  scoring,
  added,
  onAddPlayer,
  positionFilter,
}: ListDetailSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>('full')
  const lockedPositions = expandPositionFilter(positionFilter)

  // Hydrate from localStorage after mount — SSR-safe.
  useEffect(() => {
    setMode(readStoredMode())
  }, [])

  const setModeAndPersist = (next: SidebarMode) => {
    setMode(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  // White panel on a 1px ink border — same surface language as the cards.
  const panelClass =
    'flex h-full shrink-0 flex-col overflow-hidden rounded-sm border border-ink bg-white'

  if (mode === 'condensed') {
    return (
      <div className={cn(panelClass, 'w-[88px]')}>
        <SidebarModeBar
          mode={mode}
          onModeChange={setModeAndPersist}
        />
        <CondensedPlayerList
          scoring={scoring}
          added={added}
          onAddPlayer={onAddPlayer}
          lockedPositions={lockedPositions}
        />
      </div>
    )
  }

  // 'full'
  return (
    <div className={cn(panelClass, 'w-[360px]')}>
      <SidebarModeBar mode={mode} onModeChange={setModeAndPersist} />
      <div className="min-h-0 flex-1">
        <PlayerSidebar
          scoring={scoring}
          added={added}
          onAddPlayer={(p) => onAddPlayer(p.id)}
          disableDrag
          lockedPositions={lockedPositions}
          layout="cards"
          frameless
        />
      </div>
    </div>
  )
}

function SidebarModeBar({
  mode,
  onModeChange,
}: {
  mode: SidebarMode
  onModeChange: (next: SidebarMode) => void
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-1 border-b border-ink px-3 py-2',
        mode === 'condensed' && 'justify-center',
      )}
    >
      {mode === 'full' && (
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-n-3">
          Players
        </span>
      )}
      <button
        type="button"
        aria-label={mode === 'full' ? 'Minimize to condensed' : 'Expand to full sidebar'}
        title={mode === 'full' ? 'Minimize' : 'Expand'}
        onClick={() => onModeChange(mode === 'full' ? 'condensed' : 'full')}
        className="flex h-7 w-7 items-center justify-center rounded-sm text-ink transition-colors hover:bg-n-4"
      >
        <Icon name={mode === 'full' ? 'arrow-next' : 'arrow-prev'} size={13} />
      </button>
    </div>
  )
}

interface CondensedPlayerListProps {
  scoring: 'ppr' | 'standard' | 'half_ppr'
  added: Set<string>
  onAddPlayer: (playerId: string) => void
  lockedPositions?: readonly string[] | null
}

function CondensedPlayerList({
  scoring,
  added,
  onAddPlayer,
  lockedPositions,
}: CondensedPlayerListProps) {
  const [players, setPlayers] = useState<BuilderPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const positionsKey =
    lockedPositions && lockedPositions.length > 0
      ? lockedPositions.join(',')
      : ''

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ scoring, limit: '100' })
    if (positionsKey) params.set('positions', positionsKey)
    fetch(`/api/players/builder?${params}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<{ players: BuilderPlayer[] }>)
      .then((data) => {
        setPlayers(data.players ?? [])
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoading(false)
      })
    return () => controller.abort()
  }, [scoring, positionsKey])

  return (
    <div className="flex-1 overflow-y-auto">
      {loading && (
        <div className="space-y-1 px-2 py-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-14" />
          ))}
        </div>
      )}
      <ul className="px-1">
        {players.map((player) => {
          const isAdded = added.has(player.id)
          const teamColor = darkTeamPrimary(player.team)
          const tintBg = teamTintBackground(player.team, 0.22)
          const initials = player.full_name
            .split(' ')
            .map((n) => n[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')

          return (
            <li key={player.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAdded) onAddPlayer(player.id)
                    }}
                    disabled={isAdded}
                    aria-label={
                      isAdded
                        ? `${player.full_name} already added`
                        : `Add ${player.full_name}`
                    }
                    className={cn(
                      'group relative flex w-full items-center justify-center rounded-sm px-2 py-2.5 transition-colors hover:bg-n-4',
                      isAdded && 'cursor-default',
                    )}
                  >
                    <Avatar
                      className="h-14 w-14 border-2"
                      style={{
                        backgroundColor: tintBg,
                        borderColor: teamColor,
                      }}
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
                      className={cn(
                        'absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border border-ink transition-opacity',
                        isAdded
                          ? 'bg-positive text-ink opacity-100'
                          : 'bg-ink text-white opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <Icon name={isAdded ? 'check' : 'plus'} size={10} />
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="max-w-[220px]">
                  <p className="truncate text-sm font-bold">
                    {player.full_name}
                  </p>
                  <p className="truncate text-xs font-medium text-white/70">
                    {[player.position, player.team].filter(Boolean).join(' · ')}
                    {player.projected_pts != null &&
                      ` · Proj ${player.projected_pts.toFixed(1)}`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
