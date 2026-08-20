'use client'

import { useEffect, useMemo, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useDraftDndMarks, useToggleDndMark } from '@/hooks/use-draft-dnd'
import {
  useAuctionPlayersByIds,
  useAuctionPool,
  useLeagueScoringFamily,
} from '@/hooks/use-draft-pool'
import { useFavoritePlayerIds } from '@/hooks/use-favorites'
import { useLeagueListPlayers } from '@/hooks/use-league-lists'
import type { DraftPickSummary } from '@/hooks/use-draft'
import { cn } from '@/lib/utils'
import { useAuctionColumnsStore } from '@/stores/auction-columns-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import {
  availableColumns,
  columnsAreDefault,
  columnValue,
  COLUMN_GROUP_LABELS,
  decorateRows,
  EMPTY_COPY,
  emptyReason,
  FAILURE_COPY,
  failureReason,
  filterRows,
  formatColumnValue,
  mergeSources,
  splitGroupAvailability,
  tablePending,
  visibleColumns,
  type AuctionColumn,
  type AuctionPlayerRow,
} from './auction-player-table-ops'
import { useDockPanelClose } from './draft-dock-panel'

const POSITION_FILTERS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const SEARCH_DEBOUNCE_MS = 250

interface AuctionPlayerTableProps {
  leagueId: string
  draftId: string
  userId: string | undefined
  /** Every pick row the room holds (undone included — the ops layer drops
   *  them per E4); prices and winners come from here. */
  picks: readonly DraftPickSummary[]
  teamNameById: ReadonlyMap<string, string>
  /** Ids already in my Targets — the add action flips to "In Targets". */
  queuedIds: ReadonlySet<string>
  onQueue: (playerId: string) => void
  /** It is my nomination turn on a live auction (the room derives it —
   *  exactly when `draft_nominate` would accept). */
  canNominate: boolean
  /** SELECTS the player into the board zone's composer; the amount is part
   *  of §8.6.2's action, so nothing is sent from here. */
  onNominate: (playerId: string) => void
  /** A nominate/bid submit is in flight — §16.3's "submitting…" state. */
  submitting: boolean
  /** §7.3.5's `regular_season_weeks` — the weekly-average divisor. */
  regularSeasonWeeks: number
  /** §8.9 list overlay, owned by the room so the Lists panel and this
   *  table can never disagree about which list is on the pool. */
  overlay?: { listId: string; title: string } | null
  onClearOverlay?: () => void
  className?: string
}

/**
 * The auction player table — M3 task L.C3.3 (spec §16.2
 * `auction-player-table.tsx`; §16.4's v2.10 player-table callout, whose
 * column / filter / row-action list is THE CONTRACT; §16.5.4's required
 * states; §12.24 for the marks; tasks-M3 C43; PROGRESS D194).
 *
 * ## Where it lives
 *
 * This is the dock's **Players panel** in an auction room — the table IS
 * the panel body, not a second list inside it. The v2.12 redesign gave the
 * room a bottom dock and a full-width board (§16.4's layout contract), and
 * tasks-M3's L.C3.3 amendment moved the table's host accordingly: *"it
 * mounts as a dock panel … the Builder's call recorded at build time"*.
 * Two lists of the same players in one panel would be exactly the density
 * the redesign exists to remove, and this table is a strict superset of
 * what `available-players` offers an auction (its filters, its Targets
 * action and its Nominate verb are all here) — so a snake room keeps
 * `AvailablePlayers` and an auction room gets this. The board zone is
 * untouched: the nomination centrepiece and the team columns stay
 * `auction-block`'s (D191(1)).
 *
 * ## What it does NOT decide
 *
 * Every derived number here is a DISPLAY MIRROR (`$/pt`, `Pts/wk`), the
 * same posture `auction-budget.ts` holds for money: no submit is gated on
 * one, no handler reads one. Nominate does not write — it selects the
 * player into the block's composer, because the opening bid is part of the
 * §8.6.2 action and is capped by max bid; the write is `useNominate`, and
 * it is never optimistic (§15.6). Add-to-Targets and the DND toggle ARE
 * optimistic, on private prep state only (the `draft_queues` idiom).
 *
 * ## Do-Not-Draft is a LABEL (§12.24, C42 — ruled 2026-08-16)
 *
 * Marking a player greys the row, strikes the name and shows a DND chip.
 * It removes nobody from the pool, changes no ordering, and — the ruled
 * part — **the engine never reads the table**: autopick, the Targets
 * fallback and system nominations ignore marks entirely. The skip
 * behaviour was offered and explicitly declined; do not re-propose it.
 * `auction-player-table.test.ts` sweeps every migration and the engine's
 * TypeScript for a reader.
 *
 * ## Windows and honesty
 *
 * The browse rows are the same bounded ADP window the pool uses, so the
 * three filters that must reach OUTSIDE it — Show Drafted, Favorites, and
 * §8.9's "Only this list" — feed their ids into one by-id read
 * (`useAuctionPlayersByIds`) and merge. That is the "exactly 1000 rows"
 * rule applied to a filter: a filter that claims a SET has to reach all of
 * it, not just the part that happened to be on screen.
 */
export function AuctionPlayerTable({
  leagueId,
  draftId,
  userId,
  picks,
  teamNameById,
  queuedIds,
  onQueue,
  canNominate,
  onNominate,
  submitting,
  regularSeasonWeeks,
  overlay,
  onClearOverlay,
  className,
}: AuctionPlayerTableProps) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showDrafted, setShowDrafted] = useState(false)
  const [onlyOnList, setOnlyOnList] = useState(false)
  const [customizerOpen, setCustomizerOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const closeDockPanel = useDockPanelClose()

  /**
   * SELECT → SUBMIT IS ONE GESTURE (R446, D196).
   *
   * Nominate does not write — it selects the player into the auction
   * block's composer, where the opening bid is chosen (§8.6.2). But this
   * table IS the dock's Players panel, and the open panel is a fixed-height
   * overlay ABOVE the board (D151: `min(60vh, 640px)`), which covers the
   * composer's "Nominate at $N" submit at 1280×800, 1366×768 and 1440×810 —
   * measured, with no page scroll to recover it and a 30s nomination clock
   * running. So selecting a player dismisses the panel that was hiding the
   * control the selection just armed.
   *
   * The dismissal reaches the dock through the in-panel close context, not
   * through a prop on `DraftDock` — see `draft-dock-panel.ts` for why that
   * distinction is D119(6)'s and not cosmetic.
   */
  const handleNominateFromRow = (playerId: string) => {
    onNominate(playerId)
    closeDockPanel?.()
  }

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchInput])

  // A filter keyed to a list that is no longer overlaid would lie (the
  // `available-players` rule, kept).
  const overlayListId = overlay?.listId ?? null
  useEffect(() => {
    setOnlyOnList(false)
  }, [overlayListId])

  const visible = useAuctionColumnsStore((s) => s.visible)
  const toggleColumn = useAuctionColumnsStore((s) => s.toggle)
  const resetColumns = useAuctionColumnsStore((s) => s.reset)

  const pool = useAuctionPool(search, position)
  const favorites = useFavoritePlayerIds()
  const dnd = useDraftDndMarks(draftId)
  const toggleDnd = useToggleDndMark(draftId, userId)
  const scoring = useLeagueScoringFamily(leagueId)
  const overlayRows = useLeagueListPlayers(overlay?.listId)

  const favoriteIds = useMemo(() => favorites.data ?? new Set<string>(), [favorites.data])
  const dndIds = useMemo(() => new Set(dnd.data ?? []), [dnd.data])
  const overlayIds = useMemo(
    () => new Set((overlayRows.data ?? []).map((row) => row.player_id)),
    [overlayRows.data],
  )

  // "Only this list" is a filter BUILT FROM the overlaid list, so it is
  // meaningful only while a list is actually overlaid — the
  // `available-players` `onlyMode` idiom, kept. It also keeps the button's
  // state from outliving its list by one frame while the effect above
  // clears it (`useLeagueListPlayers` is DISABLED without a list, so a
  // stale-true `onlyOnList` would read as "pending forever").
  const onlyMode = overlayListId !== null && onlyOnList

  // Live (non-undone) picks — the drafted set and the price/winner facts.
  const draftedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const pick of picks) if (!pick.is_undone) ids.add(pick.player_id)
    return ids
  }, [picks])

  // The window-independent ids: whatever an active filter promises to
  // reach. Empty when every filter is a plain narrowing of the window, so
  // the second read never fires in the default view.
  const extraIds = useMemo(() => {
    const ids: string[] = []
    if (showDrafted) ids.push(...draftedIds)
    if (favoritesOnly) ids.push(...favoriteIds)
    if (onlyMode) ids.push(...overlayIds)
    return ids
  }, [showDrafted, draftedIds, favoritesOnly, favoriteIds, onlyMode, overlayIds])
  const extras = useAuctionPlayersByIds(extraIds)

  const rows = useMemo<AuctionPlayerRow[]>(
    () =>
      decorateRows({
        players: mergeSources(pool.data ?? [], extras.data ?? []),
        picks,
        family: scoring.family,
        regularSeasonWeeks,
        dndIds,
        queuedIds,
        favoriteIds,
      }),
    [
      pool.data,
      extras.data,
      picks,
      scoring.family,
      regularSeasonWeeks,
      dndIds,
      queuedIds,
      favoriteIds,
    ],
  )

  const availability = useMemo(() => splitGroupAvailability(rows), [rows])
  const columns = useMemo(
    () => visibleColumns(new Set(visible), availability),
    [visible, availability],
  )
  const offerable = useMemo(() => availableColumns(availability), [availability])

  const shown = useMemo(
    () =>
      filterRows({
        rows,
        search,
        position,
        favoritesOnly,
        showDrafted,
        onlyListIds: onlyMode ? overlayIds : null,
      }),
    [rows, search, position, favoritesOnly, showDrafted, onlyMode, overlayIds],
  )

  // EVERY read this table consumes reaches one of these two gates, so no
  // unsettled or failed source can reach the empty state and have its
  // silence rendered as a designed sentence (R444's enumeration; the pure
  // bodies carry the reasoning and the R283 disabled-query gate).
  const loading = tablePending({
    poolPending: pool.isPending,
    extrasPending: extras.isPending,
    extraIdCount: extraIds.length,
    favoritesOnly,
    favoritesPending: favorites.isPending,
    onlyMode,
    overlayPending: overlayRows.isPending,
  })
  const failure = failureReason({
    poolError: pool.isError,
    extrasError: extras.isError,
    extraIdCount: extraIds.length,
    favoritesOnly,
    favoritesError: favorites.isError,
    onlyMode,
    overlayError: overlayRows.isError,
  })

  const groups = useMemo(() => {
    const byGroup = new Map<AuctionColumn['group'], AuctionColumn[]>()
    for (const column of offerable) {
      const list = byGroup.get(column.group) ?? []
      list.push(column)
      byGroup.set(column.group, list)
    }
    return Array.from(byGroup.entries())
  }, [offerable])

  return (
    <div className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      {/* ---- Filters (§16.4: position · text search · Favorites) ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search players"
            aria-label="Search available players"
            className="h-8 min-w-[140px] flex-1 text-[12px]"
          />
          <Button
            variant={favoritesOnly ? 'blue' : 'stroke'}
            size="sm"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Icon name="star" size={13} />
            Favorites
          </Button>
          <Button
            variant={showDrafted ? 'blue' : 'stroke'}
            size="sm"
            aria-pressed={showDrafted}
            onClick={() => setShowDrafted((v) => !v)}
          >
            Show drafted
          </Button>
          <Button
            variant="stroke"
            size="sm"
            aria-expanded={customizerOpen}
            onClick={() => setCustomizerOpen((v) => !v)}
          >
            <Icon name="table" size={13} />
            Columns
          </Button>
        </div>

        <Segment aria-label="Position filter" className="w-full">
          <SegmentItem active={position === ''} onClick={() => setPosition('')} className="flex-1">
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
          // §8.9's overlay banner, carried over from the pool so attaching a
          // list still reaches the auction room's player browser (L.B4.2).
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

        {customizerOpen && (
          // §16.4's "add/remove stat columns + a Reset-to-default". An
          // INLINE disclosure rather than a popover: the dock is non-modal
          // by decision (D150), and a portalled menu with its own focus
          // scope inside it is the shape D119(6) warns about. Only columns
          // the C43 gate allows are offered — an option that can only
          // produce an empty column is the same lie as the column.
          <div className="flex flex-col gap-2 rounded-sm border border-n-4 bg-page p-2">
            {groups.map(([group, cols]) => (
              <div key={group} className="flex flex-wrap items-center gap-1">
                <span className="fs-overline mr-1 w-16 shrink-0 text-[9px] text-n-3">
                  {COLUMN_GROUP_LABELS[group]}
                </span>
                {cols.map((column) => {
                  const on = visible.includes(column.key)
                  return (
                    <Button
                      key={column.key}
                      variant={on ? 'blue' : 'stroke'}
                      size="sm"
                      aria-pressed={on}
                      aria-label={`${on ? 'Hide' : 'Show'} ${column.full}`}
                      onClick={() => toggleColumn(column.key)}
                    >
                      {column.full}
                    </Button>
                  )
                })}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                variant="stroke"
                size="sm"
                disabled={columnsAreDefault(visible)}
                onClick={() => resetColumns()}
              >
                <Icon name="reset" size={13} />
                Reset columns
              </Button>
              {/* C43: a gated-shut split group is ABSENT, not empty — so
                  the absence is said out loud here instead of leaving nine
                  columns nobody can find. The sentence disappears by
                  itself when the projections sync starts carrying the
                  keys, because it is keyed off the same gate. */}
              {!Object.values(availability).some(Boolean) && (
                <span className="text-[11px] font-medium text-n-3">
                  Rushing, receiving and passing splits appear once projections carry them.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- §16.5.4 states: skeleton · error-with-retry · empty ---- */}
      {loading ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : failure !== null ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[12px] font-medium text-n-3" role="alert">
            {FAILURE_COPY[failure]}
          </p>
          <Button
            variant="stroke"
            size="sm"
            onClick={() => {
              void pool.refetch()
              if (extraIds.length > 0) void extras.refetch()
              if (favoritesOnly) void favorites.refetch()
              if (onlyMode) void overlayRows.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-[12px] font-medium text-n-3">
          {
            EMPTY_COPY[
              emptyReason({
                totalRows: rows.length,
                search,
                position,
                favoritesOnly,
                favoritesCount: favoriteIds.size,
                onlyList: onlyMode,
                onlyListCount: overlayIds.size,
              })
            ]
          }
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="fs-num text-[10px] font-semibold text-n-3">
              {shown.length} shown
            </span>
            {dnd.isError && (
              // The marks are a LABEL, so a failed read degrades rather
              // than blocks — but silently missing labels would let a
              // manager bid on a player they had ruled out. §16.5.4's
              // degraded posture: keep rendering, say what is missing.
              <span className="text-[10px] font-medium text-n-3">
                Do-not-draft labels didn’t load
              </span>
            )}
            {scoring.family === null && !scoring.isPending && (
              // §16.5.4 degraded: last-good data, never wrong numbers. The
              // league's scoring rules did not resolve, so the projection
              // columns stay empty and say why rather than guessing a
              // family (see `useLeagueScoringFamily`).
              //
              // SETTLED only (R444's sweep): while the read is in flight
              // the family is also null, and "not readable" would be the
              // same untrue-reason defect the empty states carry — a
              // sentence about a read that has not finished. This one
              // DEGRADES rather than blocks, so it waits rather than
              // joining `loading`: the pool's 300 rows must not be held
              // hostage to the scoring read.
              <span className="text-[10px] font-medium text-n-3">
                Scoring not readable — projections hidden
              </span>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 px-1" />
                <TableHead className="px-1.5 lg:px-2">Player</TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={cn(
                      'px-1.5 text-right lg:px-2',
                      column.essential ? null : 'hidden lg:table-cell',
                    )}
                    title={column.full}
                  >
                    {column.label}
                  </TableHead>
                ))}
                <TableHead className="px-1.5 text-right lg:px-2">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => {
                const expanded = expandedId === row.id
                return (
                  <AuctionPlayerRows
                    key={row.id}
                    row={row}
                    columns={columns}
                    offerable={offerable}
                    expanded={expanded}
                    onToggleExpand={() => setExpandedId(expanded ? null : row.id)}
                    onOpenPlayer={() => openPlayer(row.id)}
                    teamNameById={teamNameById}
                    canNominate={canNominate}
                    onNominate={handleNominateFromRow}
                    onQueue={onQueue}
                    onToggleDnd={() =>
                      toggleDnd.mutate({ playerId: row.id, marked: row.dnd })
                    }
                    dndDisabled={!userId}
                    submitting={submitting}
                  />
                )
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}

interface RowProps {
  row: AuctionPlayerRow
  columns: readonly AuctionColumn[]
  offerable: readonly AuctionColumn[]
  expanded: boolean
  onToggleExpand: () => void
  onOpenPlayer: () => void
  teamNameById: ReadonlyMap<string, string>
  canNominate: boolean
  onNominate: (playerId: string) => void
  onQueue: (playerId: string) => void
  onToggleDnd: () => void
  dndDisabled: boolean
  submitting: boolean
}

/**
 * One player: the row, plus its expansion when open (§16.4's
 * "expandable/collapsible", now per-ROW inside the panel — tasks-M3's
 * L.C3.3 amendment). The expansion is where the §16.4 mobile density rule
 * lands: at 375 only the essential columns render in the table and the
 * rest are one tap away here, so the customizer's picks are never lost to
 * the viewport, only relocated.
 */
function AuctionPlayerRows({
  row,
  columns,
  offerable,
  expanded,
  onToggleExpand,
  onOpenPlayer,
  teamNameById,
  canNominate,
  onNominate,
  onQueue,
  onToggleDnd,
  dndDisabled,
  submitting,
}: RowProps) {
  const winner = row.wonByTeamId ? teamNameById.get(row.wonByTeamId) : null
  return (
    <>
      <TableRow
        className={cn(
          // Drafted rows stay in place, greyed, carrying their price — the
          // §16.4 toggle's whole point. DND greys and strikes; it removes
          // nothing (C42: display-only).
          row.drafted && 'bg-n-4/40 text-n-3',
          row.dnd && !row.drafted && 'text-n-3',
        )}
      >
        <TableCell className="px-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.full_name}`}
            onClick={onToggleExpand}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size={13} />
          </Button>
        </TableCell>

        <TableCell className="px-1.5 lg:px-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <PositionBadge position={row.position} />
            <button
              type="button"
              onClick={onOpenPlayer}
              className={cn(
                'min-w-0 truncate text-left text-[12px] font-bold hover:text-accent',
                row.dnd && 'line-through',
              )}
            >
              {row.full_name}
            </button>
            {row.dnd && (
              <span className="fs-overline shrink-0 rounded-sm border border-ink px-1 text-[8px]">
                DND
              </span>
            )}
            {row.drafted && (
              <span className="fs-num shrink-0 text-[10px] font-semibold">
                ${row.price ?? 0}
                {winner ? ` · ${winner}` : ''}
              </span>
            )}
          </span>
        </TableCell>

        {columns.map((column) => (
          <TableCell
            key={column.key}
            className={cn(
              'fs-num px-1.5 text-right text-[12px] lg:px-2',
              column.essential ? null : 'hidden lg:table-cell',
            )}
          >
            {formatColumnValue(columnValue(row, column), column.key)}
          </TableCell>
        ))}

        <TableCell className="px-1.5 lg:px-2">
          <span className="flex items-center justify-end gap-1">
            <Button
              variant="stroke"
              size="icon-sm"
              aria-label={
                row.queued ? `${row.full_name} is in your Targets` : `Add ${row.full_name} to Targets`
              }
              title={row.queued ? 'In Targets' : 'Add to Targets'}
              disabled={row.queued || row.drafted}
              onClick={() => onQueue(row.id)}
            >
              <Icon name={row.queued ? 'check' : 'plus'} size={13} />
            </Button>
            <Button
              variant={row.dnd ? 'dark' : 'stroke'}
              size="icon-sm"
              aria-pressed={row.dnd}
              aria-label={
                row.dnd
                  ? `Remove the do-not-draft label from ${row.full_name}`
                  : `Label ${row.full_name} do not draft`
              }
              title={row.dnd ? 'Do not draft — remove label' : 'Do not draft'}
              disabled={dndDisabled}
              onClick={onToggleDnd}
            >
              <Icon name="remove" size={13} />
            </Button>
            {canNominate && !row.drafted && (
              <Button variant="green" size="sm" disabled={submitting} onClick={() => onNominate(row.id)}>
                {submitting ? 'Submitting…' : 'Nominate'}
              </Button>
            )}
          </span>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns.length + 3} className="px-1.5 pb-3 lg:px-2">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {offerable.map((column) => (
                <div key={column.key} className="flex items-baseline justify-between gap-2">
                  <dt className="truncate text-[11px] font-medium text-n-3">{column.full}</dt>
                  <dd className="fs-num shrink-0 text-[12px] font-bold">
                    {formatColumnValue(columnValue(row, column), column.key)}
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-[11px] font-medium text-n-3">NFL team</dt>
                <dd className="shrink-0 text-[12px] font-bold">{row.team ?? '—'}</dd>
              </div>
              {row.drafted && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="truncate text-[11px] font-medium text-n-3">Won by</dt>
                  <dd className="fs-num shrink-0 text-[12px] font-bold">
                    ${row.price ?? 0}
                    {winner ? ` · ${winner}` : ''}
                  </dd>
                </div>
              )}
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
