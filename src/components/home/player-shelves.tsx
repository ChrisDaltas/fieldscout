'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { BuilderPlayer } from '@/components/lists/builder/types'
import { PlayerCard } from '@/components/players/player-card'
import { PlayerCardMenu } from '@/components/players/player-card-menu'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'
import { Skeleton } from '@/components/ui/skeleton'

const POSITION_GROUPS = [
  { label: 'Quarterback', position: 'QB' as const },
  { label: 'Running Back', position: 'RB' as const },
  { label: 'Wide Receiver', position: 'WR' as const },
  { label: 'Flex', position: 'FLEX' as const },
  { label: 'Tight End', position: 'TE' as const },
  { label: 'Defense', position: 'DEF' as const },
  { label: 'Kicker', position: 'K' as const },
] as const

const TILES_PER_SHELF = 12

interface HomePlayersResponse {
  players: BuilderPlayer[]
}

function useHomePlayers() {
  return useQuery({
    queryKey: ['home', 'players', 'ppr'],
    queryFn: () =>
      fetch('/api/players/builder?scoring=ppr&limit=1500').then(
        (res) => res.json() as Promise<HomePlayersResponse>,
      ),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The home page's per-position player lists — one horizontally scrollable
 * shelf per position (QB, RB, WR, Flex, TE, DEF, K), each sorted by projected
 * points. Flex pools RB/WR/TE.
 */
export function PlayerShelves() {
  const { data, isLoading } = useHomePlayers()
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  const byPosition = useMemo(() => {
    const grouped: Record<string, BuilderPlayer[]> = {}
    for (const p of data?.players ?? []) {
      if (!grouped[p.position]) grouped[p.position] = []
      grouped[p.position].push(p)
    }
    // The API already sorts by projected_pts desc.
    return grouped
  }, [data])

  const flexPlayers = useMemo(() => {
    const candidates = [
      ...(byPosition.RB ?? []),
      ...(byPosition.WR ?? []),
      ...(byPosition.TE ?? []),
    ]
    return candidates
      .sort((a, b) => (b.projected_pts ?? -1) - (a.projected_pts ?? -1))
      .slice(0, TILES_PER_SHELF)
  }, [byPosition])

  return (
    <>
      <div className="space-y-8">
        {POSITION_GROUPS.map((group) => {
          const players =
            group.position === 'FLEX'
              ? flexPlayers
              : (byPosition[group.position] ?? []).slice(0, TILES_PER_SHELF)

          // Hide the shelf entirely if data has loaded but the group has no
          // players — better to drop the section than show a blank shelf.
          if (!isLoading && players.length === 0) return null

          return (
            <PlayerShelf
              key={group.position}
              title={group.label}
              players={players}
              isLoading={isLoading}
              seeAllHref={`/app/players?position=${group.position}`}
              onOpenPlayer={openPlayer}
            />
          )
        })}
      </div>
    </>
  )
}

function PlayerShelf({
  title,
  players,
  isLoading,
  seeAllHref,
  onOpenPlayer,
}: {
  title: string
  players: BuilderPlayer[]
  isLoading: boolean
  seeAllHref: string
  onOpenPlayer: (playerId: string) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <a
          href={seeAllHref}
          className="text-xs font-medium text-text-secondary hover:text-foreground"
        >
          See all →
        </a>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none">
        {isLoading && players.length === 0 ? (
          <ul className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="w-40 shrink-0">
                <Skeleton className="h-40 w-full rounded-lg" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex gap-3">
            {players.map((player) => (
              <li key={player.id} className="w-40 shrink-0">
                <PlayerTile player={player} onOpenPlayer={onOpenPlayer} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function PlayerTile({
  player,
  onOpenPlayer,
}: {
  player: BuilderPlayer
  onOpenPlayer: (playerId: string) => void
}) {
  // The shelves aren't a ranked board, so `rank` is unused (showRank=false).
  // Both the whole-card click (onSelect) and the name click (onOpen) open the
  // detail modal, matching the previous bespoke tile's behavior. The hover ⋯
  // menu rides along in the menuSlot.
  return (
    <PlayerCard
      rank={0}
      showRank={false}
      player={player}
      projectedPts={player.projected_pts}
      onOpen={() => onOpenPlayer(player.id)}
      onSelect={() => onOpenPlayer(player.id)}
      className="group cursor-pointer"
      menuSlot={
        <PlayerCardMenu
          playerId={player.id}
          playerName={player.full_name}
          className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        />
      }
    />
  )
}
