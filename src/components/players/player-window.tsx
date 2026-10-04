'use client'

import { useCallback } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { DraftCardActions, GlobalLeaguesExpander, LeagueCardActions } from '@/components/players/player-card-actions'
import { GLOBAL_CARD_CONTEXT, type PlayerCardContext } from '@/components/players/player-card-context'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import {
  BioPanel,
  GameLogPanel,
  StatsPanel,
  WeeklyPointsList,
} from '@/components/players/player-detail-panels'
import { vitalCells } from '@/components/players/player-page-ops'
import { PositionBadge } from '@/components/players/position-badge'
import {
  WindowShell,
  type DetailWindowTab,
} from '@/components/shared/window-shell'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  usePlayerStats,
  type PlayerStatsPlayer,
} from '@/hooks/use-player-stats'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import {
  usePlayerWindowsStore,
  type PlayerWindowState,
} from '@/stores/player-windows-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

interface PlayerWindowProps {
  window: PlayerWindowState
  stackIndex: number
  zIndex: number
  isTop: boolean
}

/**
 * One floating player mini card — Field Scout reskin of the draggable,
 * multi-instance WindowShell. Identity header (drag handle), vitals grid,
 * leagues expander + list actions, then the tab set.
 */
export function PlayerWindow({
  window: win,
  stackIndex,
  zIndex,
  isTop,
}: PlayerWindowProps) {
  const { playerId, listContext, readOnly, context } = win
  const closeWindow = usePlayerWindowsStore((s) => s.close)
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
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
  // The expand arrow opens the player view MODAL (D486(13)) over the page,
  // closing the mini card first (kit behavior). Opened from a league, the
  // modal keeps that league. The page underneath is never navigated.
  const expandLeagueId = context.kind === 'league' ? context.leagueId : null
  const handleExpand = useCallback(() => {
    closeWindow(playerId)
    openPlayerView(playerId, expandLeagueId)
  }, [closeWindow, playerId, openPlayerView, expandLeagueId])

  const tabs: DetailWindowTab[] = data
    ? [
        {
          value: 'overview',
          label: 'Overview',
          content: <WeeklyPointsList data={data} />,
        },
        { value: 'stats', label: 'Stats', content: <StatsPanel data={data} /> },
        {
          value: 'log',
          label: 'Game log',
          content: <GameLogPanel data={data} />,
        },
        { value: 'bio', label: 'Bio', content: <BioPanel player={data.player} /> },
      ]
    : []

  return (
    <WindowShell
      title={data ? data.player.full_name : 'Player details'}
      onClose={handleClose}
      onFocus={handleFocus}
      onExpand={handleExpand}
      expandLabel="Open player view"
      zIndex={zIndex}
      stackIndex={stackIndex}
      initialPosition={savedPosition}
      onPositionChange={handlePositionChange}
      isTop={isTop}
      loading={isLoading}
      error={error ? error.message : null}
      loadingFallback={<PlayerWindowSkeleton />}
      header={data ? <MiniCardHeader player={data.player} /> : null}
      tabs={tabs}
    >
      {data && (
        <>
          <VitalsGrid player={data.player} />
          <LeaguesAndActionsRow
            player={data.player}
            context={context}
            actions={
              <PlayerDetailActions
                player={data.player}
                listContext={listContext}
                readOnly={readOnly}
                onRemoved={handleClose}
              />
            }
          />
        </>
      )}
    </WindowShell>
  )
}

// ---------------------------------------------------------------------------
// Header — square ink-stroked headshot tile, name, position badge + team · bye
// ---------------------------------------------------------------------------

/** Status designation chip (Q / D / O / IR …) after the name, kit-style. */
const STATUS_CHIPS: Record<string, { label: string; tone: 'caution' | 'negative' }> = {
  Questionable: { label: 'Q', tone: 'caution' },
  Doubtful: { label: 'D', tone: 'caution' },
  Out: { label: 'O', tone: 'negative' },
  IR: { label: 'IR', tone: 'negative' },
  PUP: { label: 'PUP', tone: 'negative' },
  Suspended: { label: 'SUS', tone: 'negative' },
  injured: { label: 'IR', tone: 'negative' },
}

function MiniCardHeader({ player }: { player: PlayerStatsPlayer }) {
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const status = player.status ? STATUS_CHIPS[player.status] : undefined

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="h-9 w-9">
        <PlayerAvatarImage player={player} alt={player.full_name} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[16px] font-extrabold leading-tight">
          <span className="truncate">{player.full_name}</span>
          {status && (
            <span
              title={
                [player.injury_body_part, player.injury_notes]
                  .filter(Boolean)
                  .join(' — ') || undefined
              }
              className={cn(
                'inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[10px] font-extrabold leading-none',
                status.tone === 'caution' ? 'bg-caution' : 'bg-negative',
              )}
            >
              {status.label}
              {player.injury_body_part && (
                <span className="ml-1 font-bold opacity-80">
                  — {player.injury_body_part}
                </span>
              )}
            </span>
          )}
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <PositionBadge position={player.position} className="rounded-sm" />
          <span className="truncate text-[11px] font-bold text-n-3">
            {player.team ?? 'FA'}
            {player.bye_week != null ? ` · Bye ${player.bye_week}` : ''}
          </span>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vitals — hairline-celled grid under the header
// ---------------------------------------------------------------------------

function VitalsGrid({ player }: { player: PlayerStatsPlayer }) {
  // The card keeps every cell (a "—" where there is no source); the full
  // page omits them. One cell builder for both (player-page-ops).
  const cells = vitalCells(player, new Date())

  return (
    <div className="grid shrink-0 grid-cols-4">
      {cells.map(({ label, value }) => (
        <div
          key={label}
          className="border-b border-r border-n-4 px-2 py-1.5 [&:nth-child(4n)]:border-r-0"
        >
          <p className="truncate text-[11px] font-semibold leading-tight text-n-3">
            {label}
          </p>
          <p className="fs-num mt-0.5 truncate text-[13px] font-extrabold leading-tight">
            {value ?? '—'}
          </p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leagues expander + actions row
// ---------------------------------------------------------------------------

/**
 * The actions block (League UX batch 2 — the prototype's PlayerCard): what
 * the card can DO depends on where it was opened.
 *
 * - From a league page: where he is in that league and the one move that
 *   fits — Add / Claim / FAAB bid, Drop, or Propose trade
 *   (`LeagueCardActions`, each closed door with its reason).
 * - From the draft room: Queue (the seat's Targets).
 * - Anywhere else: the viewer's leagues, each with where he is there and a
 *   door into that league's card (`GlobalLeaguesExpander`).
 *
 * The list actions (Add to list, More) ride along in every context. With
 * the leagues release gated off, only they render.
 */
function LeaguesAndActionsRow({
  player,
  context,
  actions,
}: {
  player: PlayerStatsPlayer
  context: PlayerCardContext
  actions: React.ReactNode
}) {
  const leaguesEnabled = featureFlags.leagues
  const pool: PoolPlayer = {
    id: player.id,
    full_name: player.full_name,
    position: player.position,
    team: player.team,
    adp: player.adp,
    headshot_url: player.headshot_url,
    status: player.status,
  }
  const setContext = usePlayerWindowsStore((s) => s.setContext)

  return (
    <div className="flex flex-col gap-1.5 border-b border-n-4 px-3 py-2" data-card-actions={context.kind}>
      {leaguesEnabled && context.kind === 'league' && (
        <>
          <LeagueCardActions player={pool} leagueId={context.leagueId} />
          <button
            type="button"
            onClick={() => setContext(player.id, GLOBAL_CARD_CONTEXT)}
            className="self-start text-[11px] font-bold text-n-3 underline decoration-transparent underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
            data-card-all-leagues
          >
            See all my leagues
          </button>
        </>
      )}
      {leaguesEnabled && context.kind === 'global' && <GlobalLeaguesExpander player={pool} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {context.kind === 'draft' && <DraftCardActions playerId={player.id} context={context} />}
        {/* Downsize the (shared) action buttons to the mini-card scale. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 [&>a]:h-btn-sm [&>a]:px-2.5 [&>a]:text-[11px] [&>button]:h-btn-sm [&>button]:px-2.5 [&>button]:text-[11px]">
          {actions}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PlayerWindowSkeleton() {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-9 w-9" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}
