'use client'

import { useMemo, useState } from 'react'

import { TierBadge } from '@/components/lists/tier-badge'
import { PlayerRow } from '@/components/players/player-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAttachList,
  useDetachList,
  useLeagueListPlayers,
  useLeagueLists,
  useMyDraftLists,
  useUpdateLeagueList,
} from '@/hooks/use-league-lists'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'
import type { LeagueDetail } from '@/hooks/use-league'
import { useQueueFromList } from '@/hooks/use-draft-queue'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import {
  bestAvailableFromBoard,
  deriveListsPanelRows,
  fromListToastLine,
  type PanelListRow,
} from './my-lists-panel-ops'

export interface PoolOverlaySelection {
  listId: string
  title: string
}

interface MyListsPanelProps {
  leagueId: string
  draftId: string
  detail: LeagueDetail
  userId: string | null
  /** My seat (a mock's launcher passes the human seat — D103(3)); null =
   *  no queue to load into (spectator / mock non-launcher). */
  queueTeamId: string | null
  /** Live (non-undone) picked ids — E17's prop-flow input. */
  draftedIds: ReadonlySet<string>
  /** I'm on the clock of a live draft (the best-from-board Draft action). */
  canDraft: boolean
  /** The primary action's verb — "Nominate" in an auction room (L.C3.1);
   *  defaults to "Draft". Passed straight through to the pool overlay. */
  primaryActionLabel?: string
  draftSubmitting: boolean
  onDraft: (playerId: string) => void
  onQueue: (playerId: string) => void
  /** The pool overlay's current selection (room state — the pool card reads
   *  the same object, so panel and pool can never disagree). */
  overlay: PoolOverlaySelection | null
  onOverlayChange: (next: PoolOverlaySelection | null) => void
  /** Opens the room-level Add-a-draft-list modal. Lifted to the ROOM on
   *  purpose: the mobile panel lives inside a bottom Sheet, and a Dialog
   *  portal opened from inside a Sheet steals focus and closes both (the
   *  D119(6) nested-dialog lesson) — so the modal always mounts outside. */
  onAddList: () => void
  /** Render the cheat sheet as an in-panel drill-in instead of a side
   *  Sheet — the mobile bottom-sheet variant (same D119(6) reason). */
  inlineCheatSheet?: boolean
  className?: string
}

/**
 * MyListsPanel (§16.2 `my-lists-panel`; §8.9 — M2 task L.B4.2; PROGRESS
 * D122) — the room's draft-references tab beside My Queue: every list the
 * user attached to this league, league-shared lists, and their season Big
 * Board by default. Per row: open as a CHEAT SHEET (side panel), toggle the
 * POOL OVERLAY (rank/tier column + "only players on this list"), LOAD INTO
 * QUEUE (replace) / "Add remaining" (append) via the L.B2.2 route, and —
 * for own rows — set primary board / detach. The §8.9 best-available-from-
 * board helper renders above the rows when a primary board is set.
 *
 * E17 is prop-flow (the D118(4) pattern): `draftedIds` derives from the
 * room's cached live picks, so one pick broadcast moves the helper, the
 * cheat-sheet greys and the overlay in the same render — no refetch.
 */
export function MyListsPanel({
  leagueId,
  draftId,
  detail,
  userId,
  queueTeamId,
  draftedIds,
  canDraft,
  primaryActionLabel = 'Draft',
  draftSubmitting,
  onDraft,
  onQueue,
  overlay,
  onOverlayChange,
  onAddList,
  inlineCheatSheet = false,
  className,
}: MyListsPanelProps) {
  const lists = useLeagueLists(leagueId)
  const myLists = useMyDraftLists(userId ?? undefined)
  const updateList = useUpdateLeagueList(leagueId)
  const detach = useDetachList(leagueId)
  const attach = useAttachList(leagueId)
  const fromList = useQueueFromList(leagueId, draftId, queueTeamId ?? '')
  const [cheatSheet, setCheatSheet] = useState<{ listId: string; title: string } | null>(null)

  const usernameByUserId = useMemo(
    () =>
      new Map(
        detail.members
          .filter((m) => m.user_id && m.profiles?.username)
          .map((m) => [m.user_id as string, m.profiles!.username]),
      ),
    [detail.members],
  )

  const bigBoard = useMemo(() => {
    const board = (myLists.data ?? []).find((list) => list.is_big_board === true)
    return board
      ? { id: board.id, title: board.title, player_count: board.player_count }
      : null
  }, [myLists.data])

  const rows = useMemo(
    () => deriveListsPanelRows(lists.data ?? [], userId, bigBoard, usernameByUserId),
    [lists.data, userId, bigBoard, usernameByUserId],
  )

  // §8.9 best-available-from-my-board: the PRIMARY board's top not-drafted
  // player (board-based on purpose — see best-available-card.tsx's note).
  const primaryRow = rows.find((row) => row.isMine && row.isPrimary && !row.dangling) ?? null
  const primaryPlayers = useLeagueListPlayers(primaryRow?.listId)
  const bestId = useMemo(
    () =>
      bestAvailableFromBoard(
        (primaryPlayers.data ?? []).map((row) => row.player_id),
        draftedIds,
      ),
    [primaryPlayers.data, draftedIds],
  )
  const { playerById: bestById } = usePlayersByIds(
    useMemo(() => (bestId ? [bestId] : []), [bestId]),
  )
  const bestPlayer = bestId ? bestById.get(bestId) : undefined

  const loadIntoQueue = (row: PanelListRow, mode: 'replace' | 'append') => {
    if (!queueTeamId || fromList.isPending) return
    fromList.mutate(
      { listId: row.listId, mode },
      {
        onSuccess: (result) => toast({ title: fromListToastLine(mode, result) }),
        onError: (error) => {
          toast({
            title: 'Targets not updated',
            description:
              error instanceof LeagueActionError ? error.message : 'Please try again.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  const setPrimary = (row: PanelListRow) => {
    if (!row.leagueListId) return
    updateList.mutate(
      { leagueListId: row.leagueListId, is_primary_board: true },
      {
        onSuccess: () =>
          toast({ title: `“${row.title}” is now your primary board for this league.` }),
        onError: (error) =>
          toast({
            title: 'Primary board not set',
            description:
              error instanceof LeagueActionError ? error.message : 'Please try again.',
            variant: 'destructive',
          }),
      },
    )
  }

  const detachRow = (row: PanelListRow) => {
    if (!row.leagueListId) return
    if (overlay?.listId === row.listId) onOverlayChange(null)
    detach.mutate(row.leagueListId, {
      onSuccess: () => toast({ title: `“${row.title}” detached — the list itself is untouched.` }),
    })
  }

  const attachBigBoard = (row: PanelListRow) => {
    attach.mutate(
      { list_id: row.listId },
      {
        onSuccess: () => toast({ title: `“${row.title}” attached to this league.` }),
        onError: (error) =>
          toast({
            title: 'Attach failed',
            description:
              error instanceof LeagueActionError ? error.message : 'Please try again.',
            variant: 'destructive',
          }),
      },
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>My lists</CardTitle>
        <span className="fs-num text-[10px] font-semibold text-n-3">{rows.length}</span>
      </CardHeader>

      {lists.isPending || myLists.isPending ? (
        <div className="flex flex-col gap-2 p-card-pad">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : lists.isError ? (
        <div className="flex flex-col items-start gap-2 p-card-pad">
          <p className="text-[12px] font-medium text-n-3" role="alert">
            Your lists didn&rsquo;t load.
          </p>
          <Button variant="stroke" size="sm" onClick={() => void lists.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2 p-card-pad">
          <p className="text-[12px] font-medium text-n-3">
            No lists here yet. Attach one and your prep is one tap away on the
            clock — a primary board even feeds your autopick.
          </p>
          <Button variant="stroke" size="sm" onClick={onAddList}>
            <Icon name="list" size={13} />
            Add a draft list
          </Button>
        </div>
      ) : inlineCheatSheet && cheatSheet ? (
        // Mobile drill-in (the D119(6) no-nested-portal variant): the cheat
        // sheet replaces the rows inside the same surface.
        <div className="flex flex-col gap-2 p-card-pad pt-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to my lists"
              onClick={() => setCheatSheet(null)}
            >
              <Icon name="arrow-prev" size={13} />
            </Button>
            <span className="truncate text-[12px] font-bold">{cheatSheet.title}</span>
          </div>
          <CheatSheetBody
            listId={cheatSheet.listId}
            draftedIds={draftedIds}
            canQueue={Boolean(queueTeamId)}
            onQueue={onQueue}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-card-pad pt-0">
          {primaryRow && bestPlayer && (
            // §8.9's optional helper: highest-ranked still-available from
            // the primary board; E17 keeps it honest as picks land.
            <div className="flex items-center gap-2 rounded-sm border border-n-4 bg-page px-2 py-1.5">
              <Icon name="star" size={12} className="shrink-0 text-accent" />
              <span className="mr-auto min-w-0 truncate text-[11px] font-semibold">
                Best on your board:{' '}
                <span className="font-extrabold">{bestPlayer.full_name}</span>{' '}
                <span className="text-n-3">
                  {bestPlayer.position}
                  {bestPlayer.team ? ` · ${bestPlayer.team}` : ''}
                </span>
              </span>
              {queueTeamId && (
                <Button
                  variant="stroke"
                  size="icon-sm"
                  aria-label={`Add ${bestPlayer.full_name} to Targets`}
                  title="Add to Targets"
                  onClick={() => onQueue(bestPlayer.id)}
                >
                  <Icon name="plus" size={13} />
                </Button>
              )}
              {canDraft && (
                <Button
                  variant="green"
                  size="sm"
                  disabled={draftSubmitting}
                  onClick={() => onDraft(bestPlayer.id)}
                >
                  {draftSubmitting ? 'Submitting…' : primaryActionLabel}
                </Button>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li
                key={row.key}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm border px-2 py-1.5',
                  overlay?.listId === row.listId ? 'border-ink bg-accent-soft' : 'border-n-4',
                )}
              >
                <button
                  type="button"
                  className="mr-auto min-w-0 text-left"
                  title="Open cheat sheet"
                  onClick={() =>
                    row.dangling ? undefined : setCheatSheet({ listId: row.listId, title: row.title })
                  }
                >
                  <span
                    className={cn(
                      'block truncate text-[12px] font-bold',
                      row.dangling && 'text-n-3',
                    )}
                  >
                    {row.title}
                  </span>
                  <span className="block truncate text-[10px] font-medium text-n-3">
                    {row.dangling
                      ? 'Deleted by its owner — detach to clear it'
                      : [
                          row.playerCount != null ? `${row.playerCount} players` : null,
                          row.ownerLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                  </span>
                </button>

                {row.isPrimary && <Badge variant="green">Primary</Badge>}
                {row.isShared && !row.isPrimary && <Badge variant="stroke">Shared</Badge>}
                {row.isBigBoard && !row.attached && <Badge variant="stroke">Big Board</Badge>}

                {!row.dangling && (
                  <>
                    <Button
                      variant="stroke"
                      size="icon-sm"
                      aria-label={
                        overlay?.listId === row.listId
                          ? `Clear the pool overlay of ${row.title}`
                          : `Overlay ${row.title} on the player pool`
                      }
                      aria-pressed={overlay?.listId === row.listId}
                      title={overlay?.listId === row.listId ? 'Clear overlay' : 'Overlay on pool'}
                      onClick={() =>
                        onOverlayChange(
                          overlay?.listId === row.listId
                            ? null
                            : { listId: row.listId, title: row.title },
                        )
                      }
                    >
                      <Icon name="eye" size={13} />
                    </Button>
                    {queueTeamId && row.attached && (
                      // §8.9 one-tap load (replace) — the dots menu carries
                      // "Add remaining" (append). Unattached rows (the Big
                      // Board default) attach first: the from-list route
                      // requires an attachment (no-leak 404 otherwise).
                      <Button
                        variant="stroke"
                        size="icon-sm"
                        aria-label={`Load ${row.title} into my Targets`}
                        title="Load into Targets"
                        disabled={fromList.isPending}
                        onClick={() => loadIntoQueue(row, 'replace')}
                      >
                        <Icon name="download" size={13} />
                      </Button>
                    )}
                  </>
                )}

                {(row.isMine || !row.attached) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Options for ${row.title}`}>
                        <Icon name="dots" size={13} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[196px]">
                      {!row.attached && (
                        <DropdownMenuItem onSelect={() => attachBigBoard(row)}>
                          <Icon name="cup" size={13} />
                          Attach to this league
                        </DropdownMenuItem>
                      )}
                      {row.attached && !row.dangling && queueTeamId && (
                        <DropdownMenuItem onSelect={() => loadIntoQueue(row, 'append')}>
                          <Icon name="plus" size={13} />
                          Add remaining to Targets
                        </DropdownMenuItem>
                      )}
                      {row.attached && !row.dangling && row.isMine && !row.isPrimary && (
                        <DropdownMenuItem onSelect={() => setPrimary(row)}>
                          <Icon name="star" size={13} />
                          Set as primary board
                        </DropdownMenuItem>
                      )}
                      {row.attached && row.isMine && (
                        <DropdownMenuItem variant="destructive" onSelect={() => detachRow(row)}>
                          <Icon name="remove" size={13} />
                          Detach from league
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>

          <Button variant="ghost" size="sm" className="w-fit" onClick={onAddList}>
            <Icon name="plus" size={13} />
            Add a draft list
          </Button>
        </div>
      )}

      {!inlineCheatSheet && cheatSheet && (
        <ListCheatSheet
          listId={cheatSheet.listId}
          title={cheatSheet.title}
          draftedIds={draftedIds}
          canQueue={Boolean(queueTeamId)}
          onQueue={onQueue}
          onClose={() => setCheatSheet(null)}
        />
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Cheat sheet — §8.9 "open any attached list (ranked, with tiers) in a side
// panel while drafting"
// ---------------------------------------------------------------------------

function ListCheatSheet({
  listId,
  title,
  draftedIds,
  canQueue,
  onQueue,
  onClose,
}: {
  listId: string
  title: string
  draftedIds: ReadonlySet<string>
  canQueue: boolean
  onQueue: (playerId: string) => void
  onClose: () => void
}) {
  return (
    // The Sheet is a true overlay (dialogs/sheets keep the shared primitive's
    // overlay treatment — CLAUDE.md's elevation exception; nothing custom here).
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[340px] flex-col gap-3 overflow-y-auto sm:max-w-[340px]"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <CheatSheetBody
          listId={listId}
          draftedIds={draftedIds}
          canQueue={canQueue}
          onQueue={onQueue}
        />
      </SheetContent>
    </Sheet>
  )
}

/** The cheat-sheet rows — shared by the desktop side Sheet and the mobile
 *  in-panel drill-in (one implementation, two hosts). */
function CheatSheetBody({
  listId,
  draftedIds,
  canQueue,
  onQueue,
}: {
  listId: string
  draftedIds: ReadonlySet<string>
  canQueue: boolean
  onQueue: (playerId: string) => void
}) {
  const rows = useLeagueListPlayers(listId)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const { playerById, isPending: identityPending } = usePlayersByIds(
    useMemo(() => (rows.data ?? []).map((row) => row.player_id), [rows.data]),
  )

  if (rows.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (rows.isError) {
    return (
      <p className="text-[12px] font-medium text-n-3" role="alert">
        This list didn&rsquo;t load.
      </p>
    )
  }
  if ((rows.data ?? []).length === 0) {
    return <p className="text-[12px] font-medium text-n-3">This list has no players.</p>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {(rows.data ?? []).map((row, index) => {
        const player = playerById.get(row.player_id)
        const drafted = draftedIds.has(row.player_id)
        if (!player) {
          return (
            <li key={`${row.player_id}-${index}`}>
              {identityPending ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex h-10 items-center rounded-sm border border-n-4 px-2 text-[11px] font-medium text-n-3">
                  Unknown player ({row.player_id})
                </div>
              )}
            </li>
          )
        }
        const notes = row.notes?.trim()
        return (
          // E17: drafted rows grey with a chip — the cheat sheet stays
          // honest as the room's picks land.
          <li key={`${row.player_id}-${index}`} className={cn(drafted && 'opacity-50')}>
            <PlayerRow
              rank={index + 1}
              player={player}
              density="compact"
              onOpen={() => openPlayer(player.id)}
              nameBadge={
                drafted ? (
                  <Badge variant="stroke" className="shrink-0">
                    Drafted
                  </Badge>
                ) : undefined
              }
              trailing={
                <span className="ml-1 flex shrink-0 items-center gap-1">
                  {row.tier && <TierBadge tier={row.tier} className="h-5 w-5 text-[10px]" />}
                  {canQueue && !drafted && (
                    <Button
                      variant="stroke"
                      size="icon-sm"
                      aria-label={`Add ${player.full_name} to Targets`}
                      title="Add to Targets"
                      onClick={() => onQueue(player.id)}
                    >
                      <Icon name="plus" size={13} />
                    </Button>
                  )}
                </span>
              }
            />
            {/* §16.2's v2.10 cheat-sheet note (L.C3.1 item 7). The ruled use
                case is cost prep — "$8 max" — which is the note an auction
                manager writes and then needs at the exact moment the player
                is nominated. A row with NO note renders nothing at all: an
                empty note affordance on every row would be chrome that
                costs vertical space and says nothing (§16.5.4's designed-
                empty rule is about designed copy, not blank containers). */}
            {notes && (
              <p className="mt-0.5 border-l-2 border-accent pl-2 text-[11px] font-semibold text-n-3">
                {notes}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
