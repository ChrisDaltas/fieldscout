'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import {
  BioPanel,
  GameLogPanel,
  StatsPanel,
} from '@/components/players/player-detail-panels'
import { PositionBadge } from '@/components/players/position-badge'
import {
  WindowShell,
  type DetailWindowTab,
} from '@/components/shared/window-shell'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeagues } from '@/hooks/use-leagues'
import {
  usePlayerStats,
  type PlayerStatsPlayer,
  type PlayerStatsResponse,
} from '@/hooks/use-player-stats'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
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
  const { playerId, listContext, readOnly } = win
  const router = useRouter()
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
  // The expand arrow goes to the same full page the old "Open full page"
  // action navigated to, closing the mini card first (kit behavior).
  const handleExpand = useCallback(() => {
    closeWindow(playerId)
    router.push(`/app/players/${playerId}`)
  }, [closeWindow, playerId, router])

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
  // Auction $ / Pos rank aren't in the stats payload yet — render "—"
  // rather than fabricating values client-side.
  const cells: Array<[string, string]> = [
    ['ADP', formatAdp(player.adp)],
    ['Auction $', player.auction_value != null ? `$${player.auction_value}` : '—'],
    // Objective rank only exists once real points are scored — returns in-season.
    ['Pos rank', '—'],
    ['SOS', player.sos != null ? `${player.sos} of 32` : '—'],
    ['Height', formatHeight(player.height)],
    ['Weight', player.weight != null ? `${player.weight} lb` : '—'],
    ['Age', formatAge(player.birth_date)],
    ['Seasons', String(player.experience_years)],
  ]

  return (
    <div className="grid shrink-0 grid-cols-4">
      {cells.map(([label, value]) => (
        <div
          key={label}
          className="border-b border-r border-n-4 px-2 py-1.5 [&:nth-child(4n)]:border-r-0"
        >
          <p className="truncate text-[11px] font-semibold leading-tight text-n-3">
            {label}
          </p>
          <p className="fs-num mt-0.5 truncate text-[13px] font-extrabold leading-tight">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

function formatAdp(adp: number | null): string {
  if (adp == null) return '—'
  const n = Number(adp)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
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
  return age > 0 ? String(age) : '—'
}

// ---------------------------------------------------------------------------
// Leagues expander + actions row
// ---------------------------------------------------------------------------

/**
 * Per-league availability + the list actions. Wired to the viewer's REAL
 * memberships (`useLeagues`). M1 has leagues but no rosters or drafts yet, so
 * a player is a free agent in every league the viewer is in — the count is
 * the viewer's real league count and the expander lists them as free agents.
 * With no leagues, an honest prompt shows instead; when the leagues release
 * is gated off, only the actions render. Real on-a-team status arrives with
 * rosters in M2.
 */
function LeaguesAndActionsRow({ actions }: { actions: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const leaguesEnabled = featureFlags.leagues
  const { data: leagues, isPending } = useLeagues({ enabled: leaguesEnabled })
  const count = leagues?.length ?? 0
  const showExpander = leaguesEnabled && count > 0

  return (
    <div className="border-b border-n-4 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {leaguesEnabled &&
          (isPending ? (
            <span className="mr-auto py-1 text-[12px] font-semibold text-n-3">
              Checking your leagues…
            </span>
          ) : count > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mr-auto inline-flex items-center gap-1 py-1 text-[12px] font-extrabold text-accent-strong transition-colors hover:text-accent"
            >
              Available in {count} {count === 1 ? 'league' : 'leagues'}
              <Icon
                name="arrow-next"
                size={13}
                className={cn('transition-transform', open && 'rotate-90')}
              />
            </button>
          ) : (
            <span className="mr-auto py-1 text-[12px] font-medium text-n-3">
              Join a league to track availability
            </span>
          ))}
        {/* Downsize the (shared) action buttons to the mini-card scale. */}
        <span className="flex flex-wrap items-center justify-end gap-1.5 [&>a]:h-btn-sm [&>a]:px-2.5 [&>a]:text-[11px] [&>button]:h-btn-sm [&>button]:px-2.5 [&>button]:text-[11px]">
          {actions}
        </span>
      </div>
      {open && showExpander && (
        <div className="pb-1">
          {leagues!.map((lg, i) => (
            <div
              key={lg.id}
              className={cn(
                'flex items-center gap-2 py-1.5',
                i > 0 && 'border-t border-n-4',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-extrabold leading-tight">
                  {lg.name}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold leading-tight text-brand-strong">
                  Free agent
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview — weekly points bar list from the existing game log data
// ---------------------------------------------------------------------------

function WeeklyPointsList({ data }: { data: PlayerStatsResponse }) {
  const rows = data.gameLog
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
