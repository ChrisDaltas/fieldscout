/**
 * held-games.ts — M8 TD7 / Q100 (migration 184; review R1547): a game an
 * operator marked moved OUT of the week or CANCELLED scores 0 for that week
 * — the FieldScout line says "its players score 0". A stat line on such a
 * game is dropped before scoring, so the player reads as NO STAT LINE (the
 * worker's own "scores 0" state — never pending).
 *
 * Matching a line to its game: by `player_stats.game_id` when the line names
 * one; production's Sleeper lines carry NULL (PROGRESS F468(a)), so a
 * NULL-game line falls back to the player's CURRENT NFL team playing in a
 * held game of that week. The fallback is wrong only for a player traded
 * mid-week after playing for another team (filed, F589).
 *
 * The reader uses `select('*')`: `operator_hold` exists only from 184, and a
 * database before the push answers "nothing held" (TD9 — deploy before push).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export interface HeldGames {
  gameIds: ReadonlySet<string>
  teams: ReadonlySet<string>
}

export const NO_HELD_GAMES: HeldGames = { gameIds: new Set(), teams: new Set() }

/** The holds that zero a game's players: out of the week, cancelled. */
export function isZeroingHold(hold: unknown): boolean {
  return hold === 'out_of_week' || hold === 'cancelled'
}

export async function readHeldGames(db: SupabaseClient<Database>, season: number, week: number): Promise<HeldGames> {
  const { data, error } = await db.from('nfl_games').select('*').eq('season', season).eq('week', week)
  if (error) throw new Error(`nfl_games read (held games, ${season} week ${week}) failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; home_team: string; away_team: string; operator_hold?: string | null }>
  // A week has ≤ 16 games; a result AT the cap is never trusted (rule 10).
  if (rows.length >= 1000) throw new Error(`nfl_games read for ${season} week ${week} returned ${rows.length} rows — at the PostgREST cap, refusing to trust it`)
  const gameIds = new Set<string>()
  const teams = new Set<string>()
  for (const g of rows) {
    if (!isZeroingHold(g.operator_hold)) continue
    gameIds.add(g.id)
    teams.add(g.home_team)
    teams.add(g.away_team)
  }
  return { gameIds, teams }
}

/** Is this line on a held game? `teamOf` gives the player's current NFL team. */
export function onHeldGame(
  line: object,
  playerId: string,
  held: HeldGames,
  teamOf: (playerId: string) => string | null | undefined,
): boolean {
  if (held.gameIds.size === 0) return false
  const raw = (line as { game_id?: unknown }).game_id
  const gameId = typeof raw === 'string' && raw !== '' ? raw : null
  if (gameId !== null) return held.gameIds.has(gameId)
  const team = teamOf(playerId)
  return team !== null && team !== undefined && held.teams.has(team)
}

/** The lines minus every line on a held game; `dropped` names the players. */
export function withoutHeldLines<T extends object>(
  lines: ReadonlyMap<string, T>,
  held: HeldGames,
  teamOf: (playerId: string) => string | null | undefined,
): { kept: Map<string, T>; dropped: string[] } {
  const kept = new Map<string, T>()
  const dropped: string[] = []
  for (const [pid, line] of lines) {
    if (onHeldGame(line, pid, held, teamOf)) dropped.push(pid)
    else kept.set(pid, line)
  }
  return { kept, dropped: dropped.sort() }
}
