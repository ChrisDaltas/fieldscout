'use client'

import { useEffect, useMemo, useState } from 'react'

import { PlayerRow } from '@/components/players/player-row'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useDraftPool, useMyBigBoardRanks } from '@/hooks/use-draft-pool'
import { useLeagueListPlayers } from '@/hooks/use-league-lists'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import {
  bigBoardRankById,
  decorateOverlay,
  decoratePool,
  onlyOnListRows,
  overlayMaps,
  subtractDrafted,
  type OverlayPoolRow,
  type PoolRow,
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
  /** §8.9 list overlay (L.B4.2) — set from the My Lists panel; the room
   *  owns the selection so panel and pool can never disagree. */
  overlay?: { listId: string; title: string } | null
  onClearOverlay?: () => void
  className?: string
}

/**
 * AvailablePlayers (§16.2; §8.5.2) — the searchable/filterable pool, minus
 * drafted BY player_id (C26 — `available-players-ops.ts` carries the pin),
 * with ADP + my-Big-Board-rank columns. E17: `draftedIds` derives from the
 * room's live picks, so every pick broadcast re-runs the pure subtraction —
 * no refetch, the row simply leaves the pool. Search/position narrow
 * SERVER-side (use-draft-pool.ts — the bounded-window honesty note).
 *
 * L.B4.2 (§8.9): the LIST OVERLAY — a list chosen in the My Lists panel
 * annotates every row with its rank/tier, and "Only this list" filters the
 * pool to the list's own players (built FROM the list, window-independent —
 * see `onlyOnListRows`). The room owns the selection; this card owns only
 * the only-mode toggle, which resets whenever the selection changes.
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
  overlay,
  onClearOverlay,
  className,
}: AvailablePlayersProps) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [onlyOnList, setOnlyOnList] = useState(false)
  const openPlayer = usePlayerWindowsStore((s) => s.open)

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchInput])

  // Clearing (or switching) the overlay drops the only-my-list filter — a
  // filter keyed to a list that is no longer overlaid would lie.
  const overlayListId = overlay?.listId ?? null
  useEffect(() => {
    setOnlyOnList(false)
  }, [overlayListId])

  const pool = useDraftPool(search, position)
  const bigBoard = useMyBigBoardRanks(userId)

  // §8.9 overlay (L.B4.2): the overlaid list's rows in the canonical order
  // (rank = index) + their identities. "Only players on this list" builds
  // FROM the list rather than filtering the bounded window, so a list
  // player outside the ADP window still shows (the honesty note in
  // available-players-ops.ts).
  const overlayRows = useLeagueListPlayers(overlay?.listId)
  const overlayIdentity = usePlayersByIds(
    useMemo(
      () => (overlay && onlyOnList ? (overlayRows.data ?? []).map((r) => r.player_id) : []),
      [overlay, onlyOnList, overlayRows.data],
    ),
  )
  const overlayActive = Boolean(overlay)
  const onlyMode = overlayActive && onlyOnList

  const rows = useMemo<Array<PoolRow | OverlayPoolRow>>(() => {
    const ranks = bigBoardRankById(bigBoard.data ?? [])
    const maps = overlay ? overlayMaps(overlayRows.data ?? []) : null
    if (overlay && maps && onlyOnList) {
      const base = onlyOnListRows(
        overlayRows.data ?? [],
        overlayIdentity.playerById,
        draftedIds,
        search,
        position,
      )
      return decorateOverlay(decoratePool(base, ranks), maps)
    }
    const windowRows = decoratePool(subtractDrafted(pool.data ?? [], draftedIds), ranks)
    return maps ? decorateOverlay(windowRows, maps) : windowRows
  }, [
    pool.data,
    bigBoard.data,
    draftedIds,
    overlay,
    onlyOnList,
    overlayRows.data,
    overlayIdentity.playerById,
    search,
    position,
  ])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Available players</CardTitle>
        {/* The count is the visible ADP window minus drafted, NOT the pool
            total (use-draft-pool's bounded-window honesty note) — labeled so
            it never reads as the table (R269, M2 batch 13). */}
        <span className="fs-num text-[10px] font-semibold text-n-3">{rows.length} shown</span>
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

        {overlay && (
          // §8.9 overlay banner (L.B4.2): which list is on the pool, the
          // "only players on this list" toggle, and clear.
          <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-n-4 bg-page px-2 py-1.5">
            <Icon name="eye" size={12} className="shrink-0 text-n-3" />
            <span className="mr-auto min-w-0 truncate text-[11px] font-semibold">
              {overlay.title}
            </span>
            <Button
              variant={onlyOnList ? 'blue' : 'stroke'}
              size="sm"
              aria-pressed={onlyOnList}
              onClick={() => setOnlyOnList((v) => !v)}
            >
              Only this list
            </Button>
            {onClearOverlay && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Clear the ${overlay.title} overlay`}
                title="Clear overlay"
                onClick={onClearOverlay}
              >
                <Icon name="close" size={13} />
              </Button>
            )}
          </div>
        )}
      </div>

      {(onlyMode ? overlayRows.isPending || overlayIdentity.isPending : pool.isPending) ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (onlyMode ? overlayRows.isError : pool.isError) ? (
        <div className="flex flex-col items-start gap-2 p-card-pad">
          <p className="text-[12px] font-medium text-n-3" role="alert">
            {onlyMode ? 'The overlaid list didn’t load.' : 'The player pool didn’t load.'}
          </p>
          <Button
            variant="stroke"
            size="sm"
            onClick={() => void (onlyMode ? overlayRows.refetch() : pool.refetch())}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-card-pad text-[12px] font-medium text-n-3">
          {search || position
            ? 'No available players match. Loosen the search or filter.'
            : onlyMode
              ? 'Everyone on this list is drafted.'
              : 'Every player in the window is drafted.'}
        </p>
      ) : (
        <div className="max-h-[420px] divide-y divide-n-4 overflow-y-auto">
          {rows.map((player, i) => {
            // Overlay decoration is additive (§8.9): rank/tier from the
            // overlaid list when one is active, else nulls.
            const listRank = 'listRank' in player ? player.listRank : null
            const listTier = 'listTier' in player ? player.listTier : null
            const metaParts = [
              player.team,
              player.bigBoardRank != null ? `Board #${player.bigBoardRank}` : null,
              overlayActive && listTier ? `Tier ${listTier}` : null,
              // With the overlay the single stat column shows the LIST rank
              // (D118(5): one stat column at rail width — clarity over
              // density); ADP stays readable on the meta line.
              overlayActive
                ? `ADP ${player.adp != null ? player.adp.toFixed(1) : '—'}`
                : null,
            ].filter(Boolean)
            return (
            <PlayerRow
              key={player.id}
              rank={i + 1}
              showRank={false}
              density="compact"
              player={player}
              onOpen={() => openPlayer(player.id)}
              meta={metaParts.length > 0 ? metaParts.join(' · ') : undefined}
              stats={
                overlayActive
                  ? [{ label: 'List', value: listRank != null ? `#${listRank}` : '—' }]
                  : [
                      {
                        label: 'ADP',
                        value: player.adp != null ? player.adp.toFixed(1) : '—',
                      },
                    ]
              }
              trailing={
                <span className="ml-1 flex shrink-0 items-center gap-1">
                  {canQueue && (
                    <Button
                      variant="stroke"
                      size="icon-sm"
                      aria-label={
                        queuedIds.has(player.id)
                          ? `${player.full_name} is queued`
                          : `Queue ${player.full_name}`
                      }
                      title={queuedIds.has(player.id) ? 'Queued' : 'Add to queue'}
                      disabled={queuedIds.has(player.id)}
                      onClick={() => onQueue(player.id)}
                    >
                      <Icon name={queuedIds.has(player.id) ? 'check' : 'plus'} size={13} />
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
            )
          })}
        </div>
      )}
    </Card>
  )
}
