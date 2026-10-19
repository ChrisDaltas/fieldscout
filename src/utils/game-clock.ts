/**
 * The one game-clock rule for the phone (gap list §4 item 14): where a live
 * NFL game stands, as every row prints it — "Q4 6:50", and "OT 2:31" from
 * the fifth quarter on, never "Q5" (ESPN, Yahoo and Sleeper all print
 * overtime as OT). Team rows, Match rows, the player profile's this-week
 * card and the NFL game screen all call it, so one game reads the same on
 * each of them.
 *
 * Read from the stored `nfl_games` row — the provider's quarter and clock —
 * never a wall clock. A quarter that is not on record (null, or a 0 before
 * the first snap) prints no quarter.
 *
 * A plain `.ts` module so the mobile `*-ops.ts` files (pure and tested) can
 * import it.
 */

/** Overtime: the fifth quarter or later. */
export function isOvertime(quarter: number | null | undefined): boolean {
  return quarter != null && quarter >= 5
}

/** "Q1"–"Q4", "OT", or null when the quarter is not on record. */
export function quarterLabel(quarter: number | null | undefined): string | null {
  if (quarter == null || quarter < 1) return null
  return isOvertime(quarter) ? 'OT' : `Q${quarter}`
}

/**
 * A live game's quarter and clock: "Q4 6:50" / "OT 2:31" / "Q2" / "6:50".
 * Null when neither is on record — the caller prints its own "Live".
 */
export function liveClock(game: { quarter?: number | null; game_clock?: string | null }): string | null {
  const clock = game.game_clock?.trim() || null
  const text = [quarterLabel(game.quarter), clock].filter(Boolean).join(' ')
  return text || null
}
