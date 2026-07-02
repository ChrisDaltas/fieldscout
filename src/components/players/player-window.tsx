'use client'

import { useCallback, useState } from 'react'

import {
  BioPanel,
  GameLogPanel,
  OverviewPanel,
  StatsPanel,
} from '@/components/players/player-detail-panels'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import { PlayerDetailHeader } from '@/components/players/player-detail-header'
import {
  WindowShell,
  type DetailWindowTab,
} from '@/components/shared/window-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlayerStats } from '@/hooks/use-player-stats'
import {
  usePlayerWindowsStore,
  type PlayerWindowState,
} from '@/stores/player-windows-store'

interface PlayerWindowProps {
  window: PlayerWindowState
  stackIndex: number
  zIndex: number
  isTop: boolean
}

/**
 * One floating player detail window. Same header / actions / tabbed content as
 * the old modal, but rendered in the draggable, multi-instance WindowShell.
 */
export function PlayerWindow({
  window: win,
  stackIndex,
  zIndex,
  isTop,
}: PlayerWindowProps) {
  const { playerId, listContext, readOnly } = win
  const [expanded, setExpanded] = useState(false)
  const closeWindow = usePlayerWindowsStore((s) => s.close)
  const focusWindow = usePlayerWindowsStore((s) => s.focus)
  const setPosition = usePlayerWindowsStore((s) => s.setPosition)
  const savedPosition = usePlayerWindowsStore((s) => s.positions[playerId])
  const { data, isLoading, error } = usePlayerStats(playerId)

  const handleClose = useCallback(
    () => closeWindow(playerId),
    [closeWindow, playerId],
  )
  const handleFocus = useCallback(
    () => focusWindow(playerId),
    [focusWindow, playerId],
  )
  const handlePositionChange = useCallback(
    (pos: { x: number; y: number }) => setPosition(playerId, pos),
    [setPosition, playerId],
  )

  const tabs: DetailWindowTab[] = data
    ? [
        {
          value: 'overview',
          label: 'Overview',
          content: <OverviewPanel data={data} expanded={expanded} />,
        },
        { value: 'stats', label: 'Stats', content: <StatsPanel data={data} /> },
        {
          value: 'log',
          label: 'Game Log',
          content: <GameLogPanel data={data} />,
        },
        { value: 'bio', label: 'Bio', content: <BioPanel player={data.player} /> },
      ]
    : []

  return (
    <WindowShell
      title={data ? data.player.full_name : 'Player details'}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onClose={handleClose}
      onFocus={handleFocus}
      zIndex={zIndex}
      stackIndex={stackIndex}
      initialPosition={savedPosition}
      onPositionChange={handlePositionChange}
      isTop={isTop}
      loading={isLoading}
      error={error ? error.message : null}
      loadingFallback={<PlayerWindowSkeleton />}
      header={
        data ? (
          <PlayerDetailHeader
            player={data.player}
            size={expanded ? 'expanded' : 'compact'}
          />
        ) : null
      }
      actions={
        data ? (
          <PlayerDetailActions
            player={data.player}
            listContext={listContext}
            readOnly={readOnly}
            onRemoved={handleClose}
          />
        ) : null
      }
      tabs={tabs}
    />
  )
}

function PlayerWindowSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-9 w-48 rounded-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
