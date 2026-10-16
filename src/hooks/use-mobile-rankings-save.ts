'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  fromDbPos,
  planSliceSave,
  publishEntries,
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
 * desktop uses:
 *   1. read the board fresh — the weekly GET creates a week's board the
 *      first time (seeded from your latest ranking, as on desktop), so a new
 *      week — this one or one of the next three — only comes into being
 *      when the user publishes it;
 *   2. drop removed players, bulk-add new ones;
 *   3. write the slice's order into its own slots — the season board through
 *      `/api/big-board/save` (which also records a history snapshot), a week
 *      through the list reorder RPC. Only this position's rows are sent, so
 *      every other position keeps its place and its saved date.
 *
 * Each step throws on a non-OK response — a failed step is never reported
 * as a publish.
 *
 * Step 3 also carries what migration 190 records at publish (Chris,
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

async function ok(res: Response): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { error?: unknown }
  const msg = typeof body.error === 'string' ? body.error : `Request failed with ${res.status}`
  throw new Error(msg)
}

interface BoardRead {
  list: { id: string }
  players: Array<{ player_id: string; position: number; player: { position: string } | null }>
}

async function readBoard(url: string): Promise<BoardRead> {
  const res = await fetch(url)
  await ok(res)
  const body = (await res.json()) as BoardRead
  if (!body?.list?.id) throw new Error('The board did not load')
  return body
}

export interface SaveSliceArgs {
  /** 0 = the season board, else the week. */
  week: number
  pos: RankPos
  /** The position's new order. */
  next: string[]
  /** No ranking existed at this position before: the confirmation toast,
   *  and nobody in this first version has a previous position. */
  isNew: boolean
  /** The scoring chosen in the editor — saved with the ranking. */
  scoring: Scoring
  /** The order is unchanged: save only the scoring, on this board. */
  scoringOnly?: { listId: string }
}

interface OrderWriteBody {
  scoring?: 'saved' | 'unsupported'
  scoringError?: string
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
      const board = await readBoard(week === 0 ? '/api/lists/big-board' : `/api/big-board/week/${week}`)
      const listId = board.list.id
      const plan = planSliceSave(
        board.players.map((r) => ({ playerId: r.player_id, slot: r.position, pos: fromDbPos(r.player?.position) })),
        pos,
        next,
      )
      await Promise.all(
        plan.remove.map((id) =>
          fetch(`/api/lists/${listId}/players/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(ok),
        ),
      )
      if (plan.add.length > 0) {
        await fetch(`/api/lists/${listId}/players/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ player_ids: plan.add }),
        }).then(ok)
      }
      if (plan.positions.length === 0) return { listId }
      const body = JSON.stringify({
        positions: publishEntries(plan.positions, new Set(plan.add), isNew),
        scoringFormat: scoringFormatOf(scoring),
      })
      const res =
        week === 0
          ? await fetch('/api/big-board/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
          : await fetch(`/api/lists/${listId}/players/reorder`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body,
            })
      await ok(res)
      const saved = (await res.json().catch(() => ({}))) as OrderWriteBody
      return { listId, scoringError: saved.scoringError }
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
