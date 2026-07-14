'use client'

import { useDraggable } from '@dnd-kit/core'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { AddToListPopover } from '@/components/players/add-to-list-popover'
import { PlayerRow } from '@/components/players/player-row'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import type { PlayerSearchResult } from '@/components/players/player-search'
import type { BuilderPlayer } from '@/components/lists/builder/types'

const RAIL_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
type RailPosition = (typeof RAIL_POSITIONS)[number]

type AvailabilityPool = 'rostered' | 'free-agents'

interface RailPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  projected_pts: number | null
}

// TODO(live-draft): the rostered ⇄ free-agent split and FAAB averages are
// deterministic mocks — league rosters don't exist yet. Replace both with
// real league data when rosters land.
function idHash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}
const mockIsRostered = (id: string) => idHash(id) % 5 < 2
const mockFaabAvg = (id: string) => (idHash(id) % 28) + 2

/**
 * Players data — real players through the existing routes only:
 * `/api/players/search` when the user types a query, `/api/players/builder`
 * (top projected players) for the browse state.
 */
function useRailPlayers(query: string, position: RailPosition | null) {
  return useQuery({
    queryKey: ['rail-players', query, position],
    queryFn: async (): Promise<RailPlayer[]> => {
      if (query) {
        const params = new URLSearchParams({ q: query, limit: '30' })
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
          projected_pts: null,
        }))
      }
      const params = new URLSearchParams({ scoring: 'ppr', limit: '120' })
      if (position) params.set('positions', position)
      const res = await fetch(`/api/players/builder?${params}`)
      if (!res.ok) throw new Error(`Players failed (${res.status})`)
      const body = (await res.json()) as { players: BuilderPlayer[] }
      return (body.players ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        position: p.position,
        team: p.team,
        headshot_url: p.headshot_url,
        status: p.status,
        projected_pts: p.projected_pts,
      }))
    },
    staleTime: 60_000,
  })
}

interface RailPlayerRowProps {
  player: RailPlayer
  faabAvg: number
  onBid: () => void
}

/**
 * One rail row — the existing PlayerRow (restyled via className only) with an
 * actions strip below. The whole block registers as a dnd-kit draggable with
 * the app-wide `kind: 'players'` payload, so rows drop onto sidebar lists and
 * tier zones exactly like the players browser (requires the rail to be
 * mounted inside AppDndContext).
 */
function RailPlayerRow({ player, faabAvg, onBid }: RailPlayerRowProps) {
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
        projected_pts: player.projected_pts,
      },
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab touch-manipulation border-b border-n-4 transition-colors duration-200 ease-linear hover:bg-n-4 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <PlayerRow
        rank={0}
        showRank={false}
        density="compact"
        player={player}
        className="h-10 rounded-none px-3 hover:bg-transparent hover:ring-0"
      />
      {/* Buttons must not start a drag — stop the pointer before dnd-kit. */}
      <div
        className="flex items-center gap-1.5 px-3 pb-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <AddToListPopover
          playerIds={[player.id]}
          playerName={player.full_name}
          align="end"
        />
        <Button variant="stroke" size="sm" onClick={onBid}>
          Bid FAAB
        </Button>
        <span className="fs-num ml-auto text-[10px] font-bold text-n-3">
          {faabAvg}% avg
        </span>
      </div>
    </div>
  )
}

interface PlayersPanelProps {
  onClose: () => void
}

/**
 * Players tool — search + position filters over real player data, with a
 * mocked "On rosters ⇄ Free agents" availability split (league rosters are a
 * live-draft feature). Rows drag into lists via the app DndContext; Add opens
 * the existing add-to-list popover; Bid FAAB is a stub.
 */
export function PlayersPanel({ onClose }: PlayersPanelProps) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [position, setPosition] = useState<RailPosition | null>(null)
  const [pool, setPool] = useState<AvailabilityPool>('free-agents')

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  const { data: players = [], isLoading, isError } = useRailPlayers(debounced, position)

  const rows = players.filter(
    (p) => mockIsRostered(p.id) === (pool === 'rostered'),
  )

  // TODO(live-draft): replace stub with the real FAAB bid flow.
  const bidStub = (player: RailPlayer) =>
    toast({
      title: 'FAAB bids are not live yet',
      description: `${player.full_name} — bidding arrives with league rosters.`,
    })

  return (
    <RailPanelShell title="Players" onClose={onClose}>
      <div className="shrink-0 space-y-2 border-b border-ink p-3">
        <div className="relative">
          <Icon
            name="search"
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-3"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            className="h-[29px] w-full rounded-sm border border-ink bg-white pl-7 pr-2.5 text-[11px] font-medium text-ink outline-none transition-colors duration-200 ease-linear placeholder:text-n-3 focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {RAIL_POSITIONS.map((pos) => (
            <FilterChip
              key={pos}
              pressed={position === pos}
              onPressedChange={(on) => setPosition(on ? pos : null)}
            >
              {pos}
            </FilterChip>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <FilterChip
            pressed={pool === 'rostered'}
            onPressedChange={() => setPool('rostered')}
          >
            On rosters
          </FilterChip>
          <FilterChip
            pressed={pool === 'free-agents'}
            onPressedChange={() => setPool('free-agents')}
          >
            Free agents
          </FilterChip>
        </div>

        <p className="text-[10px] font-medium leading-snug text-n-3">
          Roster split is mocked until league rosters go live. Drag a row onto
          a list, or use Add.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading && (
          <div className="space-y-2.5 p-3">
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
        )}

        {isError && (
          <p className="px-4 py-8 text-center text-[11px] font-medium text-n-3">
            Could not load players. Try again in a moment.
          </p>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Badge variant="stroke">
              {pool === 'rostered' ? 'On rosters' : 'Free agents'}
            </Badge>
            <p className="text-[11px] font-medium text-n-3">
              No players match. Adjust the filters or search.
            </p>
          </div>
        )}

        {!isLoading &&
          !isError &&
          rows.map((player) => (
            <RailPlayerRow
              key={player.id}
              player={player}
              faabAvg={mockFaabAvg(player.id)}
              onBid={() => bidStub(player)}
            />
          ))}
      </div>
    </RailPanelShell>
  )
}
