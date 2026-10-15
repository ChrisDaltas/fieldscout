'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { fromDbPos, planSliceSave, type RankPos } from '@/components/mobile/rankings/rankings-ops'
import { bigBoardKeys } from '@/hooks/use-big-board'
import { listsKeys } from '@/hooks/use-lists'

/**
 * Save one position's slice of a board from the mobile ranking editor,
 * through the routes desktop uses:
 *   1. read the board fresh — the weekly GET creates a week's board the
 *      first time (seeded from your latest ranking, as on desktop), so a new
 *      week only comes into being when the user saves it;
 *   2. drop removed players, bulk-add new ones;
 *   3. write the slice's order into its own slots — the season board through
 *      `/api/big-board/save` (which also records a history snapshot), a week
 *      through the list reorder RPC. Only this position's rows are sent, so
 *      every other position keeps its place and its saved date.
 *
 * Each step throws on a non-OK response — a failed step is never reported
 * as a save.
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
}

export function useSaveRankingSlice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ week, pos, next }: SaveSliceArgs): Promise<{ listId: string }> => {
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
      if (plan.positions.length > 0) {
        if (week === 0) {
          await fetch('/api/big-board/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ positions: plan.positions }),
          }).then(ok)
        } else {
          await fetch(`/api/lists/${listId}/players/reorder`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ positions: plan.positions }),
          }).then(ok)
        }
      }
      return { listId }
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
