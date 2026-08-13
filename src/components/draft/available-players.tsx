'use client'

import { useEffect, useMemo, useState } from 'react'

import { PlayerRow } from '@/components/players/player-row'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useDraftPool, useMyBigBoardRanks } from '@/hooks/use-draft-pool'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import {
  bigBoardRankById,
  decoratePool,
  subtractDrafted,
} from './available-players-ops'

const POSITION_FILTERS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const SEARCH_DEBOUNCE_MS = 250

interface AvailablePlayersProps {
  /** Live (non-undone) picked ids — the C26 by-player_id subtraction. */
  draftedIds: ReadonlySet<string>
  /** Ids already in my queue (Queue button flips to "Queued"). */
  queuedIds: ReadonlySet<string>
  /** My Big Board ranks come from this account (§8.9 default reference). */
  userId: string | undefined
  /** I'm on the clock of a live draft — rows grow the Draft action. */
  canDraft: boolean
  /** A pick submit is in flight — §16.3 "submitting…" treatment. */
  draftSubmitting: boolean
  /** I hold a seat with a queue in this draft. */
  canQueue: boolean
  onDraft: (playerId: string) => void
  onQueue: (playerId: string) => void
  className?: string
}

/**
 * AvailablePlayers (§16.2; §8.5.2) — the searchable/filterable pool, minus
 * drafted BY player_id (C26 — `available-players-ops.ts` carries the pin),
 * with ADP + my-Big-Board-rank columns. E17: `draftedIds` derives from the
 * room's live picks, so every pick broadcast re-runs the pure subtraction —
 * no refetch, the row simply leaves the pool. Search/position narrow
 * SERVER-side (use-draft-pool.ts — the bounded-window honesty note).
 * The list-overlay/only-my-list variants are L.B4.2's (§8.9).
 */
export function AvailablePlayers({
  draftedIds,
  queuedIds,
  userId,
  canDraft,
  draftSubmitting,
  canQueue,
  onDraft,
  onQueue,
  className,
}: AvailablePlayersProps) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchInput])

  const pool = useDraftPool(search, position)
  const bigBoard = useMyBigBoardRanks(userId)

  const rows = useMemo(() => {
    const ranks = bigBoardRankById(bigBoard.data ?? [])
    return decoratePool(subtractDrafted(pool.data ?? [], draftedIds), ranks)
  }, [pool.data, bigBoard.data, draftedIds])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Available players</CardTitle>
        <span className="fs-num text-[10px] font-semibold text-n-3">{rows.length}</span>
      </CardHeader>

      <div className="flex flex-col gap-2 border-b border-n-4 px-card-pad pb-2.5">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search players"
          aria-label="Search available players"
          className="h-8 text-[12px]"
        />
        <Segment aria-label="Position filter" className="w-full">
          <SegmentItem
            active={position === ''}
            onClick={() => setPosition('')}
            className="flex-1"
          >
            All
          </SegmentItem>
          {POSITION_FILTERS.map((pos) => (
            <SegmentItem
              key={pos}
              active={position === pos}
              onClick={() => setPosition(pos)}
              className="flex-1"
            >
              {pos}
            </SegmentItem>
          ))}
        </Segment>
      </div>

      {pool.isPending ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : pool.isError ? (
        <div className="flex flex-col items-start gap-2 p-card-pad">
          <p className="text-[12px] font-medium text-n-3" role="alert">
            The player pool didn&rsquo;t load.
          </p>
          <Button variant="stroke" size="sm" onClick={() => void pool.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-card-pad text-[12px] font-medium text-n-3">
          {search || position
            ? 'No available players match. Loosen the search or filter.'
            : 'Every player in the window is drafted.'}
        </p>
      ) : (
        <div className="max-h-[420px] divide-y divide-n-4 overflow-y-auto">
          {rows.map((player, i) => (
            <PlayerRow
              key={player.id}
              rank={i + 1}
              showRank={false}
              density="compact"
              player={player}
              onOpen={() => openPlayer(player.id)}
              stats={[
                { label: 'ADP', value: player.adp != null ? player.adp.toFixed(1) : '—' },
                {
                  label: 'Board',
                  value: player.bigBoardRank != null ? `#${player.bigBoardRank}` : '—',
                },
              ]}
              trailing={
                <span className="ml-1 flex shrink-0 items-center gap-1">
                  {canQueue && (
                    <Button
                      variant="stroke"
                      size="sm"
                      disabled={queuedIds.has(player.id)}
                      onClick={() => onQueue(player.id)}
                    >
                      {queuedIds.has(player.id) ? 'Queued' : 'Queue'}
                    </Button>
                  )}
                  {canDraft && (
                    <Button
                      variant="green"
                      size="sm"
                      disabled={draftSubmitting}
                      onClick={() => onDraft(player.id)}
                    >
                      {draftSubmitting ? 'Submitting…' : 'Draft'}
                    </Button>
                  )}
                </span>
              }
            />
          ))}
        </div>
      )}
    </Card>
  )
}
