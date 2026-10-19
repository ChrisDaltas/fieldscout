'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  duplicateOrder,
  duplicateScoring,
  duplicatedToast,
  rankedPositions,
  type DuplicateScoring,
} from '@/components/mobile/rankings/duplicate-ops'
import { boardRows, ok, readRankingBoard, writeRankingBoard } from '@/components/mobile/rankings/publish-board'
import { fromDbPos, planPositionsSave, type RankPos } from '@/components/mobile/rankings/rankings-ops'
import { bigBoardKeys } from '@/hooks/use-big-board'
import { listsKeys } from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'

/**
 * Duplicate someone else's ranking as YOUR ranking (Chris, 2026-10-18/19:
 * "If a user dupes some popular ranking it then becomes their own") — the
 * phone's and desktop's one Duplicate on a ranking that isn't yours.
 *
 *   1. read the ranking being copied, fresh (`/api/lists/[id]` — the read
 *      every list detail uses; no AI generation is ever involved);
 *   2. read your board for the same period — the season board, or that
 *      week's, which this read creates if you've never ranked the week (as
 *      the phone's first Publish does);
 *   3. publish the copied order as yours at those positions: the same
 *      requests "Publish" / "Publish updates" make (`publish-board.ts`). The
 *      copy is exact — players of yours at those positions it doesn't rank
 *      leave them — and every other position keeps its place.
 *
 * Scoring (`duplicateScoring`): a board has one scoring for all positions,
 * so yours stays when your board has one; when it has none yet the copy
 * takes the original's.
 *
 * The caller asks first when it would replace a ranking you have
 * (`hasRankingAt`). The outcome is a toast ("Duplicated — it's your ranking
 * now"); once this resolves, your boards have been re-read, so the editor
 * the caller opens next shows the copy, never a cached board.
 */

export interface DuplicateRankingArgs {
  /** The ranking being copied (someone else's list). */
  sourceListId: string
  /** 0 = the season board, else the week. */
  week: number
  /** The positions to copy — null: every position the ranking ranks. */
  positions: readonly RankPos[] | null
}

export interface DuplicateRankingResult {
  listId: string
  week: number
  /** The positions copied, in chip order. */
  positions: RankPos[]
  /** Where to open yours: the position the original leads with. */
  openAt: RankPos
  scoring: DuplicateScoring
  scoringError?: string
}

interface SourceRead {
  scoring_format?: unknown
  players: Array<{ player_id: string; player: { position: string | null } | null }>
}

/** The requests a Duplicate makes (no React): read the ranking, read your
 *  board, publish the copy. Throws on any failed step. */
export async function duplicateRanking({
  sourceListId,
  week,
  positions,
}: DuplicateRankingArgs): Promise<DuplicateRankingResult> {
  const res = await fetch(`/api/lists/${encodeURIComponent(sourceListId)}`)
  await ok(res)
  const source = (await res.json()) as SourceRead
  const copied = positions ? [...positions] : rankedPositions(source.players ?? [])
  const next = duplicateOrder(source.players ?? [], copied)
  // Nothing to copy is a failure, never a "duplicated" that did nothing.
  if (next.length === 0) throw new Error('This ranking has no players to copy')

  const board = await readRankingBoard(week)
  const rows = boardRows(board)
  const plan = planPositionsSave(rows, copied, next)
  // Movement (#33): a player this adds, and everyone at a position where
  // you had no ranking before (a week this read just created counts as
  // none), has no previous position.
  const sourcePos = new Map((source.players ?? []).map((r) => [r.player_id, fromDbPos(r.player?.position)]))
  const hadRanking = new Set(board.created ? [] : rows.map((r) => r.pos))
  const fresh = new Set(plan.add)
  for (const id of next) if (!hadRanking.has(sourcePos.get(id) ?? null)) fresh.add(id)
  const scoring = duplicateScoring(board.list.scoring_format, source.scoring_format)
  const { scoringError } = await writeRankingBoard({
    week,
    listId: board.list.id,
    plan,
    fresh,
    scoringFormat: scoring.format,
  })
  const openAt = sourcePos.get(next[0]!) ?? copied[0]!
  return { listId: board.list.id, week, positions: copied, openAt, scoring, scoringError }
}

export function useDuplicateRanking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: duplicateRanking,
    onSuccess: async (data) => {
      toast(duplicatedToast(data.scoring, data.scoringError))
      // Re-read your boards before the caller opens the editor: it starts
      // from whatever is cached, and must start from the copy.
      await Promise.all([
        qc.refetchQueries({ queryKey: ['mobile-rankings', 'boards'] }),
        qc.refetchQueries({ queryKey: data.week === 0 ? listsKeys.bigBoard() : bigBoardKeys.week(data.week) }),
      ])
    },
    onError: (err) => {
      toast({ title: "Couldn't duplicate this ranking", description: err.message, variant: 'destructive' })
    },
    onSettled: (_data, _err, vars) => {
      // Your season board, your week's board (a list — maybe just made) and
      // Lists all live under the lists keys.
      qc.invalidateQueries({ queryKey: listsKeys.all })
      qc.invalidateQueries({ queryKey: vars.week === 0 ? bigBoardKeys.history() : bigBoardKeys.week(vars.week) })
      qc.invalidateQueries({ queryKey: ['mobile-rankings', 'boards'] })
    },
  })
}
