import {
  RANK_POSITIONS,
  dbPos,
  fromDbPos,
  rankingTitle,
  weekStatus,
  type RankPos,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import type { ListPlayerWithPlayer, ListWithTags } from '@/hooks/use-lists'
import type { ImportListPlayer } from '@/hooks/use-mobile-lists-import-players'
import { poolPositions } from '@/hooks/use-mobile-lists-pool'
import type { MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import { hasTiers } from '@/lib/lists/ranking-mode'
import { isTierKey } from '@/types/schemas/lists'

import type { ImportPick } from './lists-model'

/**
 * FieldScout Mobile — what Import a ranking offers (lr-lists §2.6; gap list
 * §3 #5): the user's own rankings and their other lists. The design's Scout
 * AI and Experts sources come later (they need rankings the app doesn't
 * store yet). Pure: no React, no fetches.
 */

export interface ImportOption {
  key: string
  kind: 'ranking' | 'list'
  label: string
  /** The list the import reads: the list itself, or the ranking's board. */
  listId: string
  /** A ranking is one position's slice of its board; null = the whole list. */
  pos: RankPos | null
  /** The players it holds, once known (null while a list's are loading). */
  picks: ImportPick[] | null
  /** Its own player count, for the line while `picks` loads. */
  total: number
  /** The line's second part when nothing is skipped: a ranking's status
   *  (Published / Finalized), a list's tier count. */
  extra: string | null
  /** The list itself, for its cover (lists only). */
  list?: ListWithTags
}

/**
 * The user's rankings, as My rankings shows them: one per position on each
 * board ("Rest of season · RB", "Week 5 · WR"), the season board first and
 * then the weeks, latest first. Only positions the list's group takes are
 * offered — a QB list is offered QB rankings.
 */
export function rankingImportOptions(
  boards: MyRankingBoards,
  currentWeek: number,
  positionFilter: string | null | undefined,
): ImportOption[] {
  const allowed = poolPositions(positionFilter)
  const ordered = [...(boards.season ? [boards.season] : []), ...[...boards.weeks].sort((a, b) => b.week - a.week)]
  return ordered.flatMap((board) => {
    const type: RankType = board.week === 0 ? 'season' : `w${board.week}`
    const status = weekStatus(type, currentWeek) === 'past' ? 'Finalized' : 'Published'
    const byPos = new Map<RankPos, ImportPick[]>()
    for (const row of board.players) {
      const pos = fromDbPos(row.player.position)
      if (!pos) continue
      const picks = byPos.get(pos) ?? []
      picks.push({ player_id: row.player_id, position: row.player.position })
      byPos.set(pos, picks)
    }
    return RANK_POSITIONS.flatMap((pos): ImportOption[] => {
      const picks = byPos.get(pos)
      if (!picks || picks.length === 0) return []
      if (allowed && !allowed.includes(dbPos(pos))) return []
      return [
        {
          key: `ranking:${board.listId}:${pos}`,
          kind: 'ranking',
          label: rankingTitle(type, pos, currentWeek),
          listId: board.listId,
          pos,
          picks,
          total: picks.length,
          extra: status,
        },
      ]
    })
  })
}

/**
 * The user's other lists, in the Lists grid's order (Favorites first). The
 * list being edited isn't one, nor is anyone else's saved list, and an empty
 * list has nothing to bring in.
 */
export function listImportOptions(
  lists: readonly ListWithTags[],
  players: ReadonlyMap<string, readonly ImportListPlayer[]> | undefined,
  currentListId: string,
): ImportOption[] {
  const own = lists.filter((list) => !list.owner && list.id !== currentListId && !list.is_big_board)
  own.sort((a, b) => Number(Boolean(b.is_favorites)) - Number(Boolean(a.is_favorites)))
  return own.flatMap((list): ImportOption[] => {
    const rows = players?.get(list.id) ?? null
    const total = rows ? rows.length : (list.player_count ?? 0)
    if (total === 0) return []
    const tiers = rows && hasTiers(list.ranking_mode) ? new Set(rows.map((row) => row.tier).filter(isTierKey)).size : 0
    return [
      {
        key: `list:${list.id}`,
        kind: 'list',
        label: list.title,
        listId: list.id,
        pos: null,
        picks: rows ? rows.map((row) => ({ player_id: row.player_id, position: row.position })) : null,
        total,
        extra: tiers >= 2 ? `${tiers} tiers` : null,
        list,
      },
    ]
  })
}

/**
 * The players an option brings in, from its list as read in full: a
 * ranking's position only, and whether its tiers carry over (a list showing
 * tiers; rankings store none).
 */
export function importSourceOf(
  option: Pick<ImportOption, 'kind' | 'pos'>,
  players: readonly ListPlayerWithPlayer[],
  rankingMode: string | null | undefined,
): { entries: ListPlayerWithPlayer[]; sourceTiers: boolean } {
  if (option.kind === 'ranking') {
    return {
      entries: players.filter((entry) => fromDbPos(entry.player.position) === option.pos),
      sourceTiers: false,
    }
  }
  return { entries: [...players], sourceTiers: hasTiers(rankingMode) }
}
