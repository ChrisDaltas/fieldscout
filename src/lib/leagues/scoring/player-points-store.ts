/**
 * player-points-store — the STORED per-player points of a scored week (M5
 * task L.D3.11, migration 158; PROGRESS F405 as RULED by Chris 2026-09-28 —
 * "okay lets stay in line with standard platforms"; spec §7.3.3 / §11.4 /
 * §23.4 v2.16.68).
 *
 * `league_week_player_points` holds one row per (league, season, week, team,
 * SLOT): the starter, his points at the stored precision, the rules keys he
 * is pending on (E61), why (`scored` / `no_stat_row`) and where the row came
 * from (`worker` — written WITH the score by `score_write_week_batch`;
 * `backfill` — recomputed once by 158's backfill and equal to the stored
 * score; `backfill_unrecoverable` — a final week whose stats moved after it
 * was scored, so the rows are the corrected recompute and do NOT add up to
 * the stored score, named as such). A final week's rows never change.
 *
 * DEPLOY BEFORE PUSH. Production is at 134 while merged code deploys at once:
 * against a database without the table, PostgREST answers PGRST205 ("Could
 * not find the table 'public.league_week_player_points' in the schema
 * cache") or Postgres 42P01 — `isMissingPlayerPointsStore` recognises exactly
 * that answer, BY NAME (anchored — R1222's lesson: an unrelated missing object
 * is never mistaken for it), and every reader falls back to today's
 * behaviour and SAYS so. Any other error stays an error.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export const PLAYER_POINTS_TABLE = 'league_week_player_points'

export type StoredPointsSource = 'worker' | 'backfill' | 'backfill_unrecoverable'

export interface StoredPlayerPoints {
  team_id: string
  week: number
  slot: string
  player_id: string
  points: number
  pending: string[]
  reason: 'scored' | 'no_stat_row'
  source: StoredPointsSource
}

interface RawRow {
  team_id: string
  week: number
  slot: string
  player_id: string
  points: number | string
  pending: string[] | null
  reason: string
  source: string
}

export interface ErrorLike {
  code?: string | null
  message?: string | null
}

/**
 * True when `error` is the database saying `league_week_player_points` does
 * not EXIST (a pre-158 database): PGRST205 (PostgREST's schema cache —
 * "Could not find the table 'public.league_week_player_points' in the schema
 * cache", MEASURED) or 42P01 (Postgres — `relation
 * "public.league_week_player_points" does not exist`), anchored on the exact
 * table name between quotes (any schema qualifier — PostgREST names the
 * schema the request was served from).
 *
 * R1257: that answer only ever arrives on a GET. A HEAD request
 * (`head: true`) on a missing table comes back `{ error: null, status: 204 }`
 * from supabase-js (the 404 carries no body to parse — measured on the local
 * stack), so NO pre-158 check may use one.
 */
export function isMissingPlayerPointsStore(error: ErrorLike | null | undefined): boolean {
  if (!error) return false
  if (!['PGRST205', '42P01'].includes(error.code ?? '')) return false
  return /['"](?:[a-z_][a-z0-9_]*\.)?league_week_player_points['"]/.test(error.message ?? '')
}

/** The one sentence every reader says when it falls back (pre-158). */
export const PRE_158_SENTENCE =
  'the database predates migration 158 (no league_week_player_points table) — per-player points are not stored yet, so this read uses the live computation, as before'

export function toStoredRow(r: RawRow): StoredPlayerPoints {
  return {
    team_id: r.team_id,
    week: r.week,
    slot: r.slot,
    player_id: r.player_id,
    points: Number(r.points),
    pending: r.pending ?? [],
    reason: r.reason === 'no_stat_row' ? 'no_stat_row' : 'scored',
    source: r.source === 'backfill' || r.source === 'backfill_unrecoverable' ? r.source : 'worker',
  }
}

export type StoreRead = { available: true; rows: StoredPlayerPoints[] } | { available: false; reason: string }

export const STORED_SELECT = 'team_id, week, slot, player_id, points, pending, reason, source'

/**
 * Every stored row of a league-season (reconcile), paged past the PostgREST
 * cap with the server's own count (rule 10). `{ available: false }` ONLY on
 * the exact pre-158 answer; any other error throws.
 */
export async function readStoredPlayerPointsForSeason(
  db: SupabaseClient<Database>,
  leagueId: string,
  season: number,
): Promise<StoreRead> {
  // Every page is a GET and every page's error is judged with its CODE — the
  // pre-158 answer can arrive on any page (R1257: a HEAD probe hid it, and
  // pageAll re-throws a bare message). Paged past the cap on the server's count.
  const rows: RawRow[] = []
  let total: number | null = null
  for (let from = 0; ; ) {
    const page = await db
      .from(PLAYER_POINTS_TABLE)
      .select(STORED_SELECT, { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', season)
      .order('week')
      .order('team_id')
      .order('slot')
      .range(from, from + 999)
    if (page.error) {
      if (isMissingPlayerPointsStore(page.error)) return { available: false, reason: PRE_158_SENTENCE }
      throw new Error(`${PLAYER_POINTS_TABLE} read: ${page.error.message}`)
    }
    const data = (page.data ?? []) as unknown as RawRow[]
    if (page.count !== null && page.count !== undefined) total = page.count
    rows.push(...data)
    if (data.length === 0 || (total !== null ? rows.length >= total : data.length < 1000)) break
    from += data.length
  }
  return { available: true, rows: rows.map(toStoredRow) }
}

/** Σ of a team-week's stored rows, or null when any row is pending (E61 — the door's NULL). */
export function storedTeamPoints(rows: readonly StoredPlayerPoints[]): number | null {
  if (rows.some((r) => r.pending.length > 0)) return null
  // Two-decimal values: summed in cents so the total is exact (the door checked Σ = the score).
  const cents = rows.reduce((acc, r) => acc + Math.round(r.points * 100), 0)
  return cents / 100
}
