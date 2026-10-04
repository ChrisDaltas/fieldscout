'use client'

import { useDraggable } from '@dnd-kit/core'
import { useMutationState, useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { Crest } from '@/components/leagues/league-cells'
import { moveReadout, poolRows, valueCells, valueWeekOf, type PoolPlayerRow } from '@/components/leagues/players-page-ops'
import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { RailPickup } from '@/components/players/player-card-actions'
import { GLOBAL_CARD_CONTEXT, leagueCardContext, type PlayerCardContext } from '@/components/players/player-card-context'
import { PlayerFace, PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { FilterChip } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/use-auth'
import { useDraftPool } from '@/hooks/use-draft-pool'
import { useLeague } from '@/hooks/use-league'
import { useLeaguePool } from '@/hooks/use-league-pool'
import { useLeagues } from '@/hooks/use-leagues'
import { usePoolValues } from '@/hooks/use-pool-values'
import { useRosters } from '@/hooks/use-rosters'
import { useSchedule } from '@/hooks/use-schedule'
import { addDropKeys, type AddDropResult } from '@/hooks/use-transactions'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

import type { PlayerSearchResult } from '@/components/players/player-search'

import {
  addsGoToLine,
  leagueIdFromPath,
  ownerTooltip,
  poolSwitchLabel,
  RAIL_POSITIONS,
  railMetaLine,
  type RailPosition,
} from './players-panel-ops'

/** Plain-words states shared by both lists. */
function RailMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[11px] font-medium text-n-3" data-rail-message>{children}</p>
}

function RailSkeleton() {
  return (
    <div className="space-y-2.5 p-3" aria-label="Loading players">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="h-6 w-6 rounded-sm" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * One rail row's draggable shell — the app-wide `kind: 'players'` payload,
 * so a row still drops onto sidebar lists / tier zones (AppDndContext). The
 * My Team lineup runs its own nested DndContext, so a rail row cannot drop
 * there (D483 — skipped, the + is the way to add).
 */
function DraggableRow({ player, children }: { player: PoolPlayer; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `rail-player:${player.id}`,
    data: {
      kind: 'players',
      playerIds: [player.id],
      label: player.full_name,
      player: {
        id: player.id,
        full_name: player.full_name,
        position: player.position,
        team: player.team,
        headshot_url: player.headshot_url,
        projected_pts: null,
      },
    },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'flex cursor-grab touch-manipulation flex-wrap items-center gap-x-2 border-b border-n-4 px-3 py-1.5 transition-colors duration-200 ease-linear hover:bg-n-4 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      data-rail-row={player.id}
    >
      {children}
    </div>
  )
}

/** Headshot + name (both open the card) over badge + meta. */
function RowIdentity({ player, meta, context }: { player: PoolPlayer; meta: string; context: PlayerCardContext }) {
  return (
    <>
      <PlayerFace
        playerId={player.id}
        name={player.full_name}
        position={player.position}
        team={player.team}
        headshotUrl={player.headshot_url}
        context={context}
        size={26}
      />
      <span className="min-w-0 flex-1">
        <PlayerLink playerId={player.id} name={player.full_name} context={context} className="block text-[12px] font-bold leading-tight" />
        <span className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge position={player.position} />
          <span className="fs-num truncate text-[10px] font-semibold text-n-3" data-rail-meta>
            {meta}
          </span>
        </span>
      </span>
    </>
  )
}

// ---------------------------------------------------------------------------
// League-scoped list
// ---------------------------------------------------------------------------

export function LeaguePlayersList({
  leagueId,
  query,
  position,
  onRosters,
}: {
  leagueId: string
  query: string
  position: RailPosition | null
  onRosters: boolean
}) {
  const { user } = useAuth()
  const league = useLeague(leagueId)
  const rosters = useRosters(leagueId)
  const pool = useLeaguePool(leagueId)
  const players = useDraftPool(query, position ?? '')
  const schedule = useSchedule(leagueId)
  const week = valueWeekOf(schedule.data?.weeks ?? [])
  const ids = useMemo(() => (players.data ?? []).map((p) => p.id), [players.data])
  const values = usePoolValues(leagueId, week, ids)

  const detail = league.data
  const myTeamId = detail?.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const rows: PoolPlayerRow[] = useMemo(
    () => poolRows(players.data ?? [], rosters.data, pool.data ?? [], myTeamId, onRosters ? 'rostered' : 'free_agents'),
    [players.data, rosters.data, pool.data, myTeamId, onRosters],
  )
  const managerOf = useMemo(() => {
    const byTeam = new Map<string, string>()
    for (const m of detail?.members ?? []) if (m.team_id && m.profiles?.username) byTeam.set(m.team_id, m.profiles.username)
    return byTeam
  }, [detail])
  const myTeamName = rosters.data?.teams.find((t) => t.team_id === myTeamId)?.name ?? null
  // The latest add sent from THIS panel (the row that sent it has left the
  // free-agent list by the time it answers): adds that succeed after the
  // list mounted, read from the mutation cache — no clock.
  const adds = useMutationState({
    filters: { mutationKey: addDropKeys.all(leagueId), status: 'success' },
    select: (m) => m.state.data as AddDropResult | undefined,
  })
  const [addsAtMount] = useState(adds.length)
  const latest = adds.length > addsAtMount ? adds[adds.length - 1] : undefined
  const lastAdded = latest?.add ? moveReadout(latest, (iso) => iso).headline : null
  const context = leagueCardContext(leagueId)

  if (league.isPending || rosters.isPending || pool.isPending || players.isPending) return <RailSkeleton />
  if (league.isError || rosters.isError || pool.isError || players.isError || !detail) {
    return <RailMessage>Couldn’t load this league’s players. Try again in a moment.</RailMessage>
  }
  const addsTo = addsGoToLine(myTeamName)
  const valuesFor = (id: string) => (week !== undefined && !values.isError ? valueCells(values.byPlayer.get(id)) : null)

  return (
    <TooltipProvider delayDuration={200}>
      <p className="border-b border-n-4 px-3 py-1.5 text-[10px] font-bold text-n-3" data-rail-adds-to>
        {addsTo ?? 'You don’t manage a team in this league — research only.'}
      </p>
      {lastAdded && (
        <p className="border-b border-n-4 bg-positive-soft px-3 py-1.5 text-[11px] font-semibold text-positive-strong" role="status" data-card-result>
          {lastAdded}.
        </p>
      )}
      {rows.length === 0 && (
        <RailMessage>{query ? 'No players match that search.' : onRosters ? 'No league-owned players match.' : 'No free agents match.'}</RailMessage>
      )}
      {rows.map((row) => {
        const a = row.availability
        const v = valuesFor(row.player.id)
        if (a.kind === 'rostered') {
          const manager = managerOf.get(a.teamId) ?? null
          const crest = rosters.data?.teams.find((t) => t.team_id === a.teamId)
          return (
            <DraggableRow key={row.player.id} player={row.player}>
              <RowIdentity player={row.player} meta={railMetaLine(row.player.team, v, { season: false })} context={context} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} aria-label={ownerTooltip(a.teamName, manager)} data-rail-owner={a.teamId}>
                    <Crest name={crest?.name ?? a.teamName} src={null} className="h-6 w-6" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">{ownerTooltip(a.teamName, manager)}</TooltipContent>
              </Tooltip>
            </DraggableRow>
          )
        }
        return (
          <DraggableRow key={row.player.id} player={row.player}>
            <RowIdentity player={row.player} meta={railMetaLine(row.player.team, v)} context={context} />
            {/* The card's own + flow (D481 / D483) — buttons never start a drag. */}
            <span className="contents" onPointerDown={(e) => e.stopPropagation()}>
              <RailPickup player={row.player} leagueId={leagueId} />
            </span>
          </DraggableRow>
        )
      })}
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Research list (no league)
// ---------------------------------------------------------------------------

function useResearchPlayers(query: string, position: RailPosition | null) {
  return useQuery({
    queryKey: ['rail-players', query, position],
    queryFn: async (): Promise<PoolPlayer[]> => {
      if (query) {
        const params = new URLSearchParams({ q: query, limit: '50' })
        if (position) params.set('position', position)
        const res = await fetch(`/api/players/search?${params}`)
        if (!res.ok) throw new Error(`Search failed (${res.status})`)
        const body = (await res.json()) as { results: PlayerSearchResult[] }
        return (body.results ?? []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          position: p.position,
          team: p.team,
          headshot_url: p.headshot_url,
          status: p.status,
          adp: null,
        }))
      }
      // A bounded browse shelf; typing searches the whole pool server-side.
      const params = new URLSearchParams({ scoring: 'ppr', limit: '120' })
      if (position) params.set('positions', position)
      const res = await fetch(`/api/players/builder?${params}`)
      if (!res.ok) throw new Error(`Players failed (${res.status})`)
      const body = (await res.json()) as { players: Array<PoolPlayer & { projected_pts: number | null }> }
      return (body.players ?? []).map((p) => ({ ...p, adp: null }))
    },
    staleTime: 60_000,
  })
}

export function ResearchPlayersList({ query, position }: { query: string; position: RailPosition | null }) {
  const { data = [], isLoading, isError } = useResearchPlayers(query, position)
  if (isLoading) return <RailSkeleton />
  if (isError) return <RailMessage>Couldn’t load players. Try again in a moment.</RailMessage>
  if (data.length === 0) return <RailMessage>{query ? 'No players match that search.' : 'No players match these filters.'}</RailMessage>
  return (
    <>
      {data.map((p) => (
        <DraggableRow key={p.id} player={p}>
          <RowIdentity player={p} meta={railMetaLine(p.team, null)} context={GLOBAL_CARD_CONTEXT} />
        </DraggableRow>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

interface PlayersPanelProps {
  onClose: () => void
  /** Test seam: the page's path (else the router's). */
  pathname?: string
}

/**
 * Players tool (D483, built to the prototype's ResearchRail): search,
 * position chips and the "On rosters" switch over a league's pool. On a
 * league page it is scoped to that league; elsewhere a picker chooses one of
 * your leagues; with no leagues it is a plain research list (no +). A free
 * agent's + is the player card's own pickup flow (D481).
 */
export function PlayersPanel({ onClose, pathname: pathOverride }: PlayersPanelProps) {
  const routePath = usePathname()
  const pageLeague = leagueIdFromPath(pathOverride ?? routePath)
  const leagues = useLeagues({ enabled: featureFlags.leagues && !pageLeague })
  const [picked, setPicked] = useState<string | null>(null)
  const myLeagues = featureFlags.leagues ? (leagues.data ?? []) : []
  const pickedLeague = picked && myLeagues.some((l) => l.id === picked) ? picked : (myLeagues[0]?.id ?? null)
  const leagueId = featureFlags.leagues ? (pageLeague ?? pickedLeague) : null

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [position, setPosition] = useState<RailPosition | null>(null)
  const [onRosters, setOnRosters] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  const resolvingLeagues = featureFlags.leagues && !pageLeague && leagues.isPending

  return (
    <RailPanelShell title="Players" onClose={onClose}>
      <div className="shrink-0 space-y-2 border-b border-ink p-3">
        {!pageLeague && myLeagues.length > 0 && (
          <label className="flex items-center gap-2 text-[10px] font-bold text-n-3">
            League
            <select
              value={pickedLeague ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              className="h-btn-md min-w-0 flex-1 rounded-sm border border-ink bg-white px-2 text-[11px] font-semibold text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              data-rail-league-pick
            >
              {myLeagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="relative">
          <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players…"
            aria-label="Search players"
            className="h-btn-md w-full rounded-sm border border-ink bg-white pl-7 pr-2.5 text-[11px] font-medium text-ink outline-none transition-colors duration-200 ease-linear placeholder:text-n-3 focus:border-accent"
          />
        </div>

        {/* All is pressed when no position is chosen (null). */}
        <div className="flex flex-wrap gap-1">
          <FilterChip pressed={position === null} onPressedChange={() => setPosition(null)}>
            All
          </FilterChip>
          {RAIL_POSITIONS.map((pos) => (
            <FilterChip key={pos} pressed={position === pos} onPressedChange={(on) => setPosition(on ? pos : null)}>
              {pos}
            </FilterChip>
          ))}
        </div>

        {leagueId && (
          <label className="flex items-center gap-2 text-[11px] font-bold text-ink">
            <Switch checked={onRosters} onCheckedChange={setOnRosters} aria-label="On rosters" data-rail-switch />
            On rosters
            <span className="ml-auto text-[10px] font-semibold text-n-3" data-rail-switch-label>
              {poolSwitchLabel(onRosters)}
            </span>
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-rail-scroll>
        {resolvingLeagues ? (
          <RailSkeleton />
        ) : leagueId ? (
          <LeaguePlayersList key={leagueId} leagueId={leagueId} query={debounced} position={position} onRosters={onRosters} />
        ) : (
          <ResearchPlayersList query={debounced} position={position} />
        )}
      </div>
    </RailPanelShell>
  )
}
