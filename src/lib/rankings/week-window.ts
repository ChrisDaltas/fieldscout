/**
 * Which weeks can be ranked right now — ONE rule for phone and desktop
 * (Chris, 2026-10-15: "this week + 3 weeks out and rest of season", and
 * desktop "yes" to the same). This week and the next three, capped at the
 * regular season's last week; later weeks are locked until three weeks
 * before. In the offseason (`currentWeek` 0) Week 1 counts as this week.
 */

/** The regular season's last week — nothing is ranked past it. */
export const LAST_REGULAR_WEEK = 18
/** How many weeks past this one can be ranked. */
export const WEEKS_AHEAD = 3

/** This week for ranking purposes (Week 1 in the offseason). */
export function activeWeekOf(currentWeek: number): number {
  return currentWeek === 0 ? 1 : currentWeek
}

/** The furthest week that can be ranked now. */
export function lastRankableWeek(currentWeek: number): number {
  return Math.min(activeWeekOf(currentWeek) + WEEKS_AHEAD, LAST_REGULAR_WEEK)
}

/** A week past the window — shown, but not editable yet. */
export function isWeekLocked(week: number, currentWeek: number): boolean {
  return week > lastRankableWeek(currentWeek)
}

/** When a locked week opens: three weeks before it. */
export function opensInWeek(week: number): number {
  return Math.max(1, week - WEEKS_AHEAD)
}
