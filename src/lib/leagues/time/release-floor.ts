/**
 * Q50(a)'s RELEASE FLOOR: Tuesday 00:00 WALL CLOCK in `America/Los_Angeles`.
 *
 * Chris, 2026-09-09: *"players release when every game in the week has
 * finished, never before Tuesday 00:00 Pacific"* — and the floor is Pacific
 * *"as people experience it"*, so the ABSOLUTE instant shifts by an hour when
 * daylight saving ends. That shift lands INSIDE the season: the 2026
 * fall-back is Sunday 2026-11-01, and week 8's slate (Thu Oct 29 → Mon Nov 2)
 * straddles it. Week 7's floor is 07:00Z and week 8's is 08:00Z, an hour
 * apart in absolute terms, purely from the zone rules. A hard-coded `07:00Z`
 * releases week 8 an hour EARLY (a ruling violation) and a hard-coded
 * `08:00Z` releases week 7 an hour LATE. Neither is written here: the offset
 * comes from the platform's IANA zone data via `Intl`, exactly as
 * `stats/nflverse/eastern-time.ts` already does for `America/New_York`.
 *
 * THE ANCHOR IS THE WEEK, NEVER A KICKOFF. The floor is derived from
 * `nfl_weeks.starts_at` (Wednesday 00:00 ET, 039:34-36 — seeded reference
 * data, `NOT NULL`), so it is a CONSTANT of the week. This is what makes
 * Chris's weather-delay case work: *"it might not play until Tuesday… we
 * would basically want it to be as soon as the game has ended since we are
 * past the normal unlock time."* A game postponed INTO Tuesday finishes past
 * a floor that has already elapsed, so release is immediate. Anchoring on the
 * LAST KICKOFF instead would compute the FOLLOWING Tuesday and hold every
 * player an extra week — the trap this file exists to avoid.
 *
 * The CEILING (Wednesday 00:00 Pacific) is deliberately NOT here. Q50(c)
 * defers it: its consequences are waivers (M5) and a notification (M8).
 *
 * PURE — no clock is read anywhere. `Intl` with an explicit `timeZone` reads
 * zone data, not the wall clock, and only `Date.UTC(...)` / `new Date(<ms>)`
 * appear, so the D3 time fence over `src/lib/leagues/**` (.eslintrc.json:5)
 * covers this file with nothing to exempt.
 */

import { wallClockAt, weekdayOf, zoneOffsetMinutesAt, zonedWallToUtc } from './zoned-time'

const PACIFIC = 'America/Los_Angeles'

/** Minutes to ADD to a Pacific wall time to reach UTC at `instant`
 *  (420 during PDT, 480 during PST). Since L.D2.7 a thin wrapper over the
 *  ONE IANA implementation, `zoned-time.ts` (the waiver schedule reads the
 *  same code in the league's own zone). */
export function pacificOffsetMinutesAt(instant: Date): number {
  return zoneOffsetMinutesAt(PACIFIC, instant)
}

/**
 * Pacific wall-clock Y/M/D 00:00 → the UTC instant. `day` may overflow its
 * month (`Date.UTC` normalizes). Both US transitions happen at 02:00 local,
 * so midnight is never a skipped or repeated wall hour; `zonedWallToUtc`'s
 * DST arms (PostgreSQL's rule) are defensive here, load-bearing for the
 * waiver schedule.
 */
function pacificMidnightUtc(year: number, month: number, day: number): Date {
  return zonedWallToUtc(PACIFIC, year, month, day, 0, 0)
}

const TUESDAY = 2

/**
 * The first Tuesday 00:00 `America/Los_Angeles` STRICTLY AFTER `after`.
 *
 * Strictness is load-bearing. `nfl_weeks.starts_at` is Wednesday 00:00 ET,
 * which RENDERS as Tuesday 20:00–21:00 Pacific — so a `>=` comparison would
 * return that same Tuesday's midnight, a "floor" three hours BEFORE the
 * week's own games. With `>`, an anchor that is already exactly Tuesday
 * 00:00 Pacific advances a full seven days.
 */
export function nextPacificTuesdayMidnight(after: Date): Date {
  const w = wallClockAt(PACIFIC, after)
  // The weekday ARITHMETICALLY, from the Pacific calendar date — never
  // parsed out of a locale string, whose spelling is ICU-version dependent.
  const dow = weekdayOf(w.year, w.month, w.day)
  const delta = (TUESDAY - dow + 7) % 7
  const candidate = pacificMidnightUtc(w.year, w.month, w.day + delta)
  if (candidate.getTime() > after.getTime()) return candidate
  return pacificMidnightUtc(w.year, w.month, w.day + delta + 7)
}

/**
 * The week's RELEASE FLOOR — the earliest instant at which Q50 permits the
 * week's players to unlock. Derived from the week's calendar row and nothing
 * else (see the anchor note in the file banner).
 *
 * Refuses an unparseable `starts_at` loudly: a floor that silently became
 * `Invalid Date` would collapse to the observation instant and quietly
 * un-build the ruling — the "plausible wrong result" CLAUDE.md forbids.
 */
export function weekReleaseFloor(weekStartsAt: string): Date {
  const startsAt = new Date(weekStartsAt)
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error(`weekReleaseFloor: unparseable nfl_weeks.starts_at "${weekStartsAt}"`)
  }
  return nextPacificTuesdayMidnight(startsAt)
}
