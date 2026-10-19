import { fromDbPos, publishEntries, type BoardRowLite, type SlicePlan } from '@/components/mobile/rankings/rankings-ops'
import type { ScoringFormat } from '@/lib/lists/ranking-publish'

/**
 * The requests a ranking publish makes (Chris, 2026-10-15: on the phone,
 * Publish IS the save) — the ranking editor's "Publish" / "Publish updates"
 * (`useSaveRankingSlice`), through the routes desktop uses:
 *   1. read the board fresh (`readRankingBoard`) — the weekly GET creates a
 *      week's board the first time (seeded from your latest ranking, as on
 *      desktop), so a new week only comes into being when it is published;
 *   2. bulk-add the new players, then drop the removed ones in one bulk
 *      request (`writeRankingBoard`);
 *   3. write the new order into its own slots — the season board through
 *      `/api/big-board/save` (which also records a history snapshot), a week
 *      through the list reorder route — with the scoring the ranking is
 *      published for. Only the edited position's rows are sent, so every
 *      other position keeps its place and its saved date.
 *
 * Each step throws on a non-OK response — a failed step is never reported
 * as a publish. The steps are separate requests (no migration — there is no
 * one-call publish), so they run in the order that loses least when one
 * fails: adds first (a failure there changes nothing), then every removal in
 * ONE request and one statement (`DELETE …/players/bulk` — one call per
 * player could fail half-way), so a failure there leaves extra players on
 * your board, never fewer. The order
 * write comes last because the season board's save records a history
 * snapshot of the board as it stands.
 */

export async function ok(res: Response): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { error?: unknown }
  const msg = typeof body.error === 'string' ? body.error : `Request failed with ${res.status}`
  throw new Error(msg)
}

export interface BoardRead {
  /** `select('*')`: `scoring_format` is the board's saved scoring (null =
   *  none yet; absent before migration 190). */
  list: { id: string; scoring_format?: unknown }
  players: Array<{ player_id: string; position: number; player: { position: string } | null }>
}

/** 0 = the season board, else that week's. */
export async function readRankingBoard(week: number): Promise<BoardRead> {
  const res = await fetch(week === 0 ? '/api/lists/big-board' : `/api/big-board/week/${week}`)
  await ok(res)
  const body = (await res.json()) as BoardRead
  if (!body?.list?.id) throw new Error('The board did not load')
  return body
}

/** A board read's rows as `planSliceSave` takes them. */
export function boardRows(board: BoardRead): BoardRowLite[] {
  return board.players.map((r) => ({ playerId: r.player_id, slot: r.position, pos: fromDbPos(r.player?.position) }))
}

/** `…/players/bulk`'s per-call limit (its body schema's `max`). */
export const BULK_MAX = 500

interface OrderWriteBody {
  scoring?: 'saved' | 'unsupported'
  scoringError?: string
}

/**
 * Steps 2 and 3 on a board just read. `fresh` = the players with no previous
 * position (the ones this publish added, and everyone on a ranking's first
 * publish — #33). A scoring the server failed to save comes back
 * as `scoringError`; it never fails the publish (the order is saved).
 */
export async function writeRankingBoard(args: {
  week: number
  listId: string
  plan: SlicePlan
  fresh: ReadonlySet<string>
  scoringFormat: ScoringFormat
}): Promise<{ scoringError?: string }> {
  const { week, listId, plan, fresh, scoringFormat } = args
  // The bulk route takes up to BULK_MAX players a call; a board past that
  // goes in turns, never in parallel.
  for (const [method, ids] of [
    ['POST', plan.add],
    ['DELETE', plan.remove],
  ] as const) {
    for (let i = 0; i < ids.length; i += BULK_MAX) {
      await fetch(`/api/lists/${listId}/players/bulk`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_ids: ids.slice(i, i + BULK_MAX) }),
      }).then(ok)
    }
  }
  if (plan.positions.length === 0) return {}
  const body = JSON.stringify({ positions: publishEntries(plan.positions, fresh, false), scoringFormat })
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
  return { scoringError: saved.scoringError }
}
