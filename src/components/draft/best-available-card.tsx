'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { BuilderPlayer } from '@/components/lists/builder/types'
import { PlayerRow } from '@/components/players/player-row'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

const POOL_SIZE = 6

interface BuilderResponse {
  players: BuilderPlayer[]
}

/**
 * Real player pool from the players builder feed (read-only), minus the
 * names already on the mock draft board. Highest projection first.
 *
 * Deliberately bounded: this card shows a handful of names, so it does not
 * need the whole pool. 500 (not 200) because a full 12×16 draft removes 192
 * players from the top of the list before this card is empty — and the
 * server orders by projection, so the bound drops the irrelevant tail.
 * Its own React Query key, so it shares no cache with the home shelves.
 */
function useBestAvailable(draftedNames: ReadonlySet<string>) {
  const query = useQuery({
    queryKey: ['draft', 'best-available', 'ppr'],
    queryFn: () =>
      fetch('/api/players/builder?scoring=ppr&limit=500').then(
        (res) => res.json() as Promise<BuilderResponse>,
      ),
    staleTime: 5 * 60 * 1000,
  })

  const pool = useMemo(() => {
    const players = query.data?.players ?? []
    // TODO(live-draft): the draft service will own the available pool; this
    // subtraction-by-name only works against the mock board.
    return players
      .filter((p) => !draftedNames.has(p.full_name))
      .slice(0, POOL_SIZE)
  }, [query.data, draftedNames])

  return { pool, isLoading: query.isLoading, isError: query.isError }
}

interface BestAvailableCardProps {
  /** Full names already off the board (mock board + local sim picks). */
  draftedNames: ReadonlySet<string>
  /** Player ids currently in your queue. */
  queuedIds: ReadonlySet<string>
  onDraft: (player: BuilderPlayer) => void
  onQueue: (player: BuilderPlayer) => void
}

/** Best available — flush PlayerRow list over real player data; the top row
 *  gets the Draft action, the rest queue. */
export function BestAvailableCard({
  draftedNames,
  queuedIds,
  onDraft,
  onQueue,
}: BestAvailableCardProps) {
  const { pool, isLoading, isError } = useBestAvailable(draftedNames)
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Best available</CardTitle>
        {/* TODO(live-draft): position filters over the available pool. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Filter best available"
        >
          <Icon name="filters" size={13} />
        </Button>
      </CardHeader>

      {isLoading ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: POOL_SIZE }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : isError || pool.length === 0 ? (
        <p className="p-card-pad text-[11px] font-medium text-n-3">
          Player pool unavailable right now.
        </p>
      ) : (
        <div className="divide-y divide-n-4">
          {pool.map((player, i) => {
            const queued = queuedIds.has(player.id)
            return (
              <PlayerRow
                key={player.id}
                rank={i + 1}
                showRank={false}
                player={player}
                onOpen={() => openPlayer(player.id)}
                stats={[
                  {
                    label: 'Proj',
                    value:
                      player.projected_pts != null
                        ? player.projected_pts.toFixed(1)
                        : '—',
                  },
                ]}
                trailing={
                  i === 0 ? (
                    <Button
                      variant="green"
                      size="sm"
                      className="ml-1 shrink-0"
                      onClick={() => onDraft(player)}
                    >
                      Draft
                    </Button>
                  ) : (
                    <Button
                      variant="stroke"
                      size="sm"
                      className="ml-1 shrink-0"
                      disabled={queued}
                      onClick={() => onQueue(player)}
                    >
                      {queued ? 'Queued' : 'Queue'}
                    </Button>
                  )
                }
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}
