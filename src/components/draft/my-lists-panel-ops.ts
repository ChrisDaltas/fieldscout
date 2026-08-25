/**
 * My-Lists-panel derivations — pure ops for `my-lists-panel.tsx` (M2 task
 * L.B4.2; spec §8.9 all bullets, §16.2 my-lists-panel, E17; PROGRESS D122).
 *
 * E17 flows through arguments: `draftedIds` derives from the room's cached
 * live picks, so every pick broadcast re-runs these pure derivations — the
 * best-available helper, cheat-sheet greys and overlay all move on the same
 * broadcast with zero refetch.
 */
import type { LeagueListWithList } from '@/lib/leagues/api/league-lists-service'

export interface PanelListRow {
  /** Stable render key: the attachment id, or 'big-board' for the
   *  unattached Big Board row. */
  key: string
  listId: string
  /** Null for the unattached Big Board (it has no attachment to manage). */
  leagueListId: string | null
  title: string
  playerCount: number | null
  isMine: boolean
  /** `@username` when a shared row belongs to a fellow member. */
  ownerLabel: string | null
  isPrimary: boolean
  isShared: boolean
  isBigBoard: boolean
  attached: boolean
  /** Embed null — the list is gone (soft-deleted). Owner-only by the R130
   *  GET filter; this arm is the belt: render an honest label + Detach,
   *  never a normal-looking list. */
  dangling: boolean
}

/**
 * §8.9's panel contents, in order: my attached lists (primary first), then
 * league-shared lists from fellow members, then my season Big Board (the
 * "by default" row — appended only when it isn't already attached; an
 * attached Big Board is flagged on its attachment row instead, never
 * duplicated).
 */
export function deriveListsPanelRows(
  attached: readonly LeagueListWithList[],
  viewerId: string | null,
  bigBoard: { id: string; title: string; player_count: number | null } | null,
  usernameByUserId: ReadonlyMap<string, string>,
): PanelListRow[] {
  const toRow = (row: LeagueListWithList): PanelListRow => {
    const mine = row.owner_id === viewerId
    const username = usernameByUserId.get(row.owner_id)
    return {
      key: row.id,
      listId: row.list_id,
      leagueListId: row.id,
      title: row.lists?.title ?? 'List no longer available',
      playerCount: row.lists?.player_count ?? null,
      isMine: mine,
      ownerLabel: mine ? null : username ? `@${username}` : 'League member',
      isPrimary: row.is_primary_board === true,
      isShared: row.shared_with_league === true,
      isBigBoard: bigBoard !== null && row.list_id === bigBoard.id,
      attached: true,
      dangling: row.lists === null,
    }
  }

  // R130 belt: a null-embed row renders only for its owner even if a
  // future read path stops filtering (the GET is the enforced layer).
  const visible = attached.filter((row) => row.lists !== null || row.owner_id === viewerId)
  const mine = visible.filter((row) => row.owner_id === viewerId).map(toRow)
  mine.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  const shared = visible.filter((row) => row.owner_id !== viewerId).map(toRow)

  const rows = [...mine, ...shared]
  if (bigBoard && !rows.some((row) => row.listId === bigBoard.id)) {
    rows.push({
      key: 'big-board',
      listId: bigBoard.id,
      leagueListId: null,
      title: bigBoard.title,
      playerCount: bigBoard.player_count,
      isMine: true,
      ownerLabel: null,
      isPrimary: false,
      isShared: false,
      isBigBoard: true,
      attached: false,
      dangling: false,
    })
  }
  return rows
}

/**
 * **THE STANDALONE PRACTICE ROOM'S ROWS — MP.6c / ledger F122.**
 *
 * §8.9's panel is written as a LEAGUE surface: *"every list the user
 * attached to this league, any league-shared lists"*. A practice draft has
 * no league, so there are no attachments and no fellow members to share
 * anything — the question *"which lists does the panel offer?"* had no
 * answer and MP.6b filed it rather than let the first Builder invent one.
 *
 * **THE ANSWER: the caller's OWN lists, Big Board included, and nothing
 * else** — the same OWNERSHIP predicate MP.6b gave the server (spec erratum
 * v2.16.3: the standalone `queue-from-list` arm scopes by owner, and refuses
 * a public list somebody else owns even though it is readable). The panel
 * therefore cannot offer what the verb would refuse, which is D110(1)'s
 * rule; and it needs no new read — `useMyDraftLists` is the query the panel
 * already ran for the Big Board row.
 *
 * Every row is `attached: false` because nothing IS attached — the flag is
 * about a `league_lists` row, and there are none — but each is loadable,
 * because loadable standalone means "yours". `isPrimary` is false on every
 * row and stays false: a primary board is an ATTACHMENT flag
 * (`league_lists.is_primary_board`, `uniq_primary_board_per_member`), so a
 * standalone room has no primary board and does not render §8.9's
 * best-available helper. That is an absence with a cause, not a gap.
 */
export function standaloneListRows(
  myLists: ReadonlyArray<{
    id: string
    title: string
    player_count: number | null
    is_big_board: boolean | null
  }>,
): PanelListRow[] {
  const rows = myLists.map((list) => ({
    key: list.id,
    listId: list.id,
    leagueListId: null,
    title: list.title,
    playerCount: list.player_count,
    isMine: true,
    ownerLabel: null,
    isPrimary: false,
    isShared: false,
    isBigBoard: list.is_big_board === true,
    attached: false,
    dangling: false,
  }))
  // The Big Board first: it is the one list §8.9 calls out by name, and the
  // league arm's ordering puts the user's own most-load-bearing row on top.
  rows.sort((a, b) => Number(b.isBigBoard) - Number(a.isBigBoard))
  return rows
}

/** §8.9 "best available from my board": the highest-ranked (first in list
 *  order) player not yet drafted; null when the board is exhausted. */
export function bestAvailableFromBoard(
  orderedPlayerIds: readonly string[],
  draftedIds: ReadonlySet<string>,
): string | null {
  for (const playerId of orderedPlayerIds) {
    if (!draftedIds.has(playerId)) return playerId
  }
  return null
}

/** The load-into-queue toast (the D113(5) response made human). */
export function fromListToastLine(
  mode: 'replace' | 'append',
  result: { added: number; skipped_drafted: number; skipped_queued?: number },
): string {
  const skips = [
    result.skipped_drafted > 0 ? `${result.skipped_drafted} already drafted` : null,
    (result.skipped_queued ?? 0) > 0 ? `${result.skipped_queued} already targeted` : null,
  ].filter((part): part is string => part !== null)
  const base =
    mode === 'replace'
      ? `Targets loaded — ${result.added} ${result.added === 1 ? 'player' : 'players'}`
      : `${result.added} ${result.added === 1 ? 'player' : 'players'} added to your Targets`
  return skips.length > 0 ? `${base} (${skips.join(', ')} skipped).` : `${base}.`
}
