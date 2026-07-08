'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { HomePlayerRow } from '@/components/home/home-player-row'
import type { BuilderPlayer } from '@/components/lists/builder/types'
import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

/**
 * Trending players (package screen 01, right column) — Risers/Fallers tabs
 * over real player data. The trend signal is this-season projection vs last
 * season's actual points (both real, from the builder feed) because no
 * ADP-movement source exists yet.
 *
 * TODO(data): swap the projection-vs-last-year delta for a true ADP / expert
 * draft-rate trend once a market data source is synced. The mock's "$6 /
 * drafted by 92% of experts" columns have no backing data today.
 */

const RELEVANCE_FLOOR_PTS = 50
const MIN_LAST_SEASON_GAMES = 8
const ROWS_PER_TAB = 4

interface HomePlayersResponse {
  players: BuilderPlayer[]
}

/** Same query the pre-reskin home shelves used — cache-compatible on purpose. */
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

interface TrendEntry {
  player: BuilderPlayer
  delta: number
}

function TrendRows({
  entries,
  emptyLabel,
  onOpenPlayer,
}: {
  entries: TrendEntry[]
  emptyLabel: string
  onOpenPlayer: (playerId: string) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="px-[13px] py-3 text-[11px] font-medium text-n-3">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="divide-y divide-n-4">
      {entries.map(({ player, delta }) => {
        const up = delta >= 0
        return (
          <HomePlayerRow
            key={player.id}
            name={player.full_name}
            position={player.position}
            headshotUrl={player.headshot_url}
            onOpen={() => onOpenPlayer(player.id)}
            meta={
              <>
                {player.team ? `${player.team} · ` : ''}proj{' '}
                <span className="fs-num">
                  {(player.projected_pts ?? 0).toFixed(1)}
                </span>
              </>
            }
            right={
              <>
                <div
                  className={`fs-num text-[11px] font-extrabold ${
                    up ? 'text-positive-strong' : 'text-negative-strong'
                  }`}
                >
                  {up ? '+' : ''}
                  {delta.toFixed(1)}
                </div>
                <div className="fs-num text-[9px] font-medium text-n-3">
                  vs last season
                </div>
              </>
            }
          />
        )
      })}
    </div>
  )
}

export function TrendingPlayersCard() {
  const { data, isLoading, isError } = useHomePlayers()
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  const { risers, fallers } = useMemo(() => {
    const candidates: TrendEntry[] = (data?.players ?? [])
      .filter(
        (p) =>
          p.projected_pts !== null &&
          p.projected_pts >= RELEVANCE_FLOOR_PTS &&
          p.last_games >= MIN_LAST_SEASON_GAMES,
      )
      .map((p) => ({ player: p, delta: (p.projected_pts ?? 0) - p.last_pts }))

    const byDeltaDesc = [...candidates].sort((a, b) => b.delta - a.delta)
    return {
      risers: byDeltaDesc.filter((e) => e.delta > 0).slice(0, ROWS_PER_TAB),
      fallers: byDeltaDesc
        .filter((e) => e.delta < 0)
        .reverse()
        .slice(0, ROWS_PER_TAB),
    }
  }, [data])

  return (
    <CollapsibleCard title="Trending players">
      <Tabs defaultValue="risers">
        <div className="flex justify-end border-b border-n-4 px-[13px] py-2">
          <TabsList>
            <TabsTrigger value="risers">Risers</TabsTrigger>
            <TabsTrigger value="fallers">Fallers</TabsTrigger>
          </TabsList>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-[13px]">
            {Array.from({ length: ROWS_PER_TAB }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-[13px] py-8 text-center text-[12px] font-medium text-negative-strong">
            Couldn&apos;t load trending players. Refresh to try again.
          </p>
        ) : (
          <>
            <TabsContent value="risers" className="mt-0">
              <TrendRows
                entries={risers}
                emptyLabel="No risers yet — trends need last-season data."
                onOpenPlayer={openPlayer}
              />
            </TabsContent>
            <TabsContent value="fallers" className="mt-0">
              <TrendRows
                entries={fallers}
                emptyLabel="No fallers yet — trends need last-season data."
                onOpenPlayer={openPlayer}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </CollapsibleCard>
  )
}
