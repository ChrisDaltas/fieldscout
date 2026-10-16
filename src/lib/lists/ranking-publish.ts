import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { PostgrestErrorLike } from '@/lib/supabase/postgrest-errors'
import type { Database } from '@/types/database'
import { reorderPlayersSchema } from '@/types/schemas/lists'

/**
 * Publishing a ranking (Chris, 2026-10-15, mobile rulings #33 and #36;
 * migration 190).
 *
 * MOVEMENT (#33): `list_players.previous_position` is recorded by the
 * reorder RPC every ranking publish goes through — the old position of each
 * row it is sent, or NULL for a player THIS publish added. A publish adds
 * players before it orders them, so the caller flags those (`isNew` here,
 * `is_new` on the wire); the RPC reads the old positions itself. Before 190
 * is pushed the RPC simply ignores the flag.
 *
 * SCORING (#36): `lists.scoring_format` is the scoring a ranking was made
 * for. Community filters rankings on it, so this vocabulary is the contract:
 * ppr, half, quarter (0.25 PPR) or standard. Before 190 is pushed the column
 * doesn't exist: the write reports `unsupported` and the publish goes on —
 * a publish is never failed for it.
 */

export const SCORING_FORMATS = ['ppr', 'half', 'quarter', 'standard'] as const
export type ScoringFormat = (typeof SCORING_FORMATS)[number]
export const scoringFormatSchema = z.enum(SCORING_FORMATS)

export function isScoringFormat(value: unknown): value is ScoringFormat {
  return typeof value === 'string' && (SCORING_FORMATS as readonly string[]).includes(value)
}

/** An AI persona's `style_profile.scoring_default` ("PPR", "Half-PPR",
 *  "Standard") as a saved scoring; anything else is not known (null). */
export function personaScoringFormat(value: string | null | undefined): ScoringFormat | null {
  if (value === 'PPR') return 'ppr'
  if (value === 'Half-PPR' || value === 'Half PPR') return 'half'
  if (value === 'Standard') return 'standard'
  return null
}

/** One entry of a publish: the reorder body's entry plus whether this
 *  publish added the player (he then has no previous position). */
export const publishPositionSchema = reorderPlayersSchema.shape.positions.element.extend({
  isNew: z.boolean().optional(),
})
export const publishPositionsSchema = z.array(publishPositionSchema).min(1)
export type PublishPosition = z.infer<typeof publishPositionSchema>

/** The reorder RPC's `p_positions`: snake_case, `is_new` only when set. */
export function rpcPositions(
  positions: readonly PublishPosition[],
): Array<{ player_id: string; position: number; is_new?: true }> {
  return positions.map(({ playerId, position, isNew }) =>
    isNew ? { player_id: playerId, position, is_new: true } : { player_id: playerId, position },
  )
}

/**
 * True when the database answered "there is no such column" for THIS column
 * — its migration not pushed yet. PostgREST says PGRST204 for a write, and
 * Postgres says 42703 for a read. Anchored on the column's name so an
 * unrelated missing column is never mistaken for this one.
 */
export function isMissingColumn(error: PostgrestErrorLike | null | undefined, column: string): boolean {
  if (!error) return false
  if (error.code !== 'PGRST204' && error.code !== '42703') return false
  return new RegExp(`\\b${column}\\b`).test(error.message ?? '')
}

export type ScoringSave = 'saved' | 'unsupported'

/**
 * Save the scoring a ranking was published for. `unsupported` = migration
 * 190 isn't pushed here yet (nothing to save it in). Any other failure
 * throws — including an update that matched no row, which would otherwise
 * read as saved.
 */
export async function saveScoringFormat(
  supabase: SupabaseClient,
  listId: string,
  format: ScoringFormat,
): Promise<ScoringSave> {
  const { data, error } = await supabase.from('lists').update({ scoring_format: format }).eq('id', listId).select('id')
  if (isMissingColumn(error, 'scoring_format')) return 'unsupported'
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The ranking was not found to save its scoring')
  return 'saved'
}

/**
 * Insert a `lists` row that carries `scoring_format`, retrying once without
 * it when the column isn't there yet (migration 190 not pushed) — so a
 * writer never fails for it. Any other error is returned as is.
 */
export async function insertListWithScoring<R extends { error: PostgrestErrorLike | null }>(
  insert: (row: ListInsertRow) => PromiseLike<R>,
  row: ListInsertRow & { scoring_format: ScoringFormat | null },
): Promise<R> {
  const first = await insert(row)
  if (!isMissingColumn(first.error, 'scoring_format')) return first
  const rest: ListInsertRow = { ...row }
  delete rest.scoring_format
  return insert(rest)
}

type ListInsertRow = Database['public']['Tables']['lists']['Insert']
