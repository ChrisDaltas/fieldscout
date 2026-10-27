import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Which season a Players table opens on — the one rule (audit desktop-a-1,
 * 2026-10-27: the desktop table still opened on last season in Week 7, and
 * Reset went back to it).
 *
 *   - Once the current season has a real game in it → the current season.
 *   - Before that (preseason) → last season, because the current one has
 *     nothing to show yet. That preseason case is the only reason the desktop
 *     table ever defaulted to last season.
 *
 * `/api/players/builder` answers it as `season.default`, so every table that
 * reads that route can open on — and Reset to — the same season.
 */

export type StatsSeason = 'current' | 'last'

export function defaultStatsSeason(currentSeasonHasGames: boolean): StatsSeason {
  return currentSeasonHasGames ? 'current' : 'last'
}

/** The season a table shows: the viewer's pick, else the default. Reset
 *  clears the pick. Before the read has said (`fallback` null) it is the
 *  current season — the rows aren't in yet, so nothing is shown from it. */
export function shownStatsSeason(pick: StatsSeason | null, fallback: StatsSeason | null): StatsSeason {
  return pick ?? fallback ?? 'current'
}

/**
 * Has the current season had a real game yet? One indexed row
 * (`idx_player_stats_season_week`) across the WHOLE table — never the
 * filtered pool, so a team or position filter can't change the answer.
 * Mock lines don't count: they stand in for games that never happened (the
 * route's projection rule draws the same line).
 *
 * THROWS on a read error — "no row" must mean "no games yet", never "the
 * read failed".
 */
export async function currentSeasonHasGames(supabase: SupabaseClient, season: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('player_stats')
    .select('id')
    .eq('season', season)
    .not('week', 'is', null)
    .or('source.is.null,source.neq.mock')
    .limit(1)
  if (error) throw new Error(`Could not check the ${season} season for games: ${error.message}`)
  return (data?.length ?? 0) > 0
}
