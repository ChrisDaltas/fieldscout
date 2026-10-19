'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { boardRows, readRankingBoard, writeRankingBoard } from '@/components/mobile/rankings/publish-board'
import {
  planSliceSave,
  publishedToast,
  scoringFormatOf,
  type RankPos,
  type Scoring,
} from '@/components/mobile/rankings/rankings-ops'
import { bigBoardKeys } from '@/hooks/use-big-board'
import { listsKeys } from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'
import { saveScoringFormat } from '@/lib/lists/ranking-publish'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Publish one position's slice of a board from the mobile ranking editor.
 * On the phone, Publish IS the save (Chris, 2026-10-15: no "save without
 * publishing"; a saved ranking is the one that counts), through the routes
 * desktop uses — the requests in `publish-board.ts`, which Duplicate makes
 * too: read the board fresh (a week's board is created by its first
 * publish), bulk-add new players and bulk-drop removed ones, then write this
 * position's order into its own slots. Each step throws on a non-OK
 * response — a failed step is never reported as a publish.
 *
 * The order write also carries what migration 190 records at publish (Chris,
 * 2026-10-15): the players with no previous position (`isNew` — the ones
 * this publish ADDED, and everyone on a ranking's first publish; the server
 * records everyone else's for the movement arrows, #33) and the scoring the
 * ranking was made for (#36). Before 190 is pushed the server ignores the
 * first and reports the second as `unsupported`; neither ever fails a
 * publish. A scoring that the server tried and failed to save is said in the
 * confirmation toast.
 *
 * A publish that changes ONLY the scoring (`scoringOnly`) saves just that,
 * on the board (owner RLS, `saveScoringFormat`): it never re-sends the order,
 * which would reset every player's previous position to his current slot and
 * wipe the arrows. It can't happen before 190 is pushed (the editor offers
 * it only where the board read carries the column); if the column is
 * missing anyway, it fails loudly rather than reporting a publish.
 */

export interface SaveSliceArgs {
  /** 0 = the season board, else the week. */
  week: number
  pos: RankPos
  /** The position's new order. */
  next: string[]
  /** No ranking existed at this position before: the confirmation toast,
   *  and nobody in this first version has a previous position. */
  isNew: boolean
  /** The ranking's scoring in the editor — picked there, else its saved
   *  one, else Half PPR (`rankingScoring`) — saved with the ranking. */
  scoring: Scoring
  /** The order is unchanged: save only the scoring, on this board. */
  scoringOnly?: { listId: string }
}

export function useSaveRankingSlice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      week,
      pos,
      next,
      isNew,
      scoring,
      scoringOnly,
    }: SaveSliceArgs): Promise<{ listId: string; scoringError?: string }> => {
      if (scoringOnly) {
        const saved = await saveScoringFormat(createBrowserClient(), scoringOnly.listId, scoringFormatOf(scoring))
        if (saved === 'unsupported') throw new Error("A ranking's scoring can't be saved yet")
        return { listId: scoringOnly.listId }
      }
      const board = await readRankingBoard(week)
      const listId = board.list.id
      const plan = planSliceSave(boardRows(board), pos, next)
      // A ranking's first publish: nobody in it has a previous position.
      const fresh = new Set(isNew ? plan.positions.map((p) => p.playerId) : plan.add)
      const { scoringError } = await writeRankingBoard({
        week,
        listId,
        plan,
        fresh,
        scoringFormat: scoringFormatOf(scoring),
      })
      return { listId, scoringError }
    },
    // The outcome is reported here, not in the caller's `mutate` callbacks:
    // these still run if the editor has unmounted by the time the steps
    // finish, so a publish — or a failed step after a partial one — is
    // never silent.
    onSuccess: (data, vars) => {
      toast(
        data.scoringError
          ? { title: publishedToast(vars.isNew), description: `Its scoring wasn't saved: ${data.scoringError}` }
          : { title: publishedToast(vars.isNew) },
      )
    },
    onError: (err) => {
      toast({ title: "Couldn't publish", description: err.message, variant: 'destructive' })
    },
    onSettled: (data, _err, vars) => {
      if (vars.week === 0) {
        qc.invalidateQueries({ queryKey: listsKeys.bigBoard() })
        qc.invalidateQueries({ queryKey: bigBoardKeys.history() })
      } else {
        qc.invalidateQueries({ queryKey: bigBoardKeys.week(vars.week) })
      }
      if (data) qc.invalidateQueries({ queryKey: listsKeys.detail(data.listId) })
      qc.invalidateQueries({ queryKey: ['mobile-rankings', 'boards'] })
    },
  })
}
