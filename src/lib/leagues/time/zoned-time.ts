/**
 * The ONE implementation of IANA wall-clock arithmetic for league time
 * (M5 task L.D2.7 — "one implementation of the Pacific/IANA math"; spec
 * §16.4 "stored with an explicit IANA zone", §7.3.4 v2.16.57).
 *
 * Two league rules are stated in a WALL CLOCK, not in UTC:
 *   - Q50's release floor — Tuesday 00:00 in `America/Los_Angeles`
 *     (`release-floor.ts`, which now calls this file);
 *   - Q70's waiver schedule — "waivers run at 9:00 AM" / "free agency opens
 *     Sunday 6:00 AM", in the league's own zone (`waiver-schedule.ts`).
 * Both must survive the 2026-11-01 fall-back inside the season, so the
 * offset always comes from the platform's IANA zone data via `Intl` — never
 * a hard-coded `-07:00` / `-08:00`.
 *
 * THE SQL TWIN IS POSTGRES ITSELF. Migration 149 turns a local date + time
 * into an instant with `(date + time) AT TIME ZONE zone`, and this file
 * reproduces PostgreSQL's resolution of the two DST edge cases exactly
 * (PostgreSQL docs, "Handling of Invalid or Ambiguous Timestamps";
 * `DetermineTimeZoneOffset`):
 *   - a wall time that does not exist (the spring-forward gap, e.g.
 *     2027-03-14 02:30 America/Los_Angeles) is read with the offset in force
 *     BEFORE the transition — so it lands one hour later on the new clock
 *     (03:30 PDT);
 *   - a wall time that happens twice (the fall-back overlap, e.g.
 *     2026-11-01 01:30 America/Los_Angeles) is read with the offset in force
 *     AFTER the transition — the LATER of the two instants (01:30 PST).
 * pgTAP 097 pins both edges against the database, and `waiver-schedule.test.ts`
 * pins the same literals here, so the two can never drift apart quietly.
 *
 * PURE — no clock is read. `Intl` with an explicit `timeZone` reads zone
 * data, not the wall clock; only `Date.UTC(...)` / `new Date(<ms>)` appear,
 * so the D3 time fence over `src/lib/leagues/**` covers this file.
 */

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    // Throws RangeError for a zone the platform does not know — loud, never
    // a silent fallback to UTC.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, f)
  }
  return f
}

/** A wall-clock reading in some zone, as numbers (month 1–12). */
export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** The wall clock of `zone` at `instant`. */
export function wallClockAt(zone: string, instant: Date): WallClock {
  const parts: Record<string, number> = {}
  for (const part of formatterFor(zone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** Minutes to ADD to `zone`'s wall time to reach UTC at `instant`
 *  (420 during PDT, 480 during PST, 240 during EDT). */
export function zoneOffsetMinutesAt(zone: string, instant: Date): number {
  const w = wallClockAt(zone, instant)
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return -Math.round((wallAsUtc - instant.getTime()) / MINUTE_MS)
}

/** The weekday of a calendar date, 0 = Sunday … 6 = Saturday — computed
 *  arithmetically, never parsed from a locale string (ICU-dependent). */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * `zone`'s wall-clock Y/M/D h:m (seconds 0) → the UTC instant, resolved the
 * way PostgreSQL resolves `timestamp AT TIME ZONE zone` (see the banner).
 * `day` may overflow its month — `Date.UTC` normalizes (Oct 34 → Nov 3), so
 * callers step through days by arithmetic alone.
 *
 * Every real zone changes offset at most once within a day either side of a
 * wall time, so the offsets a day before and a day after bracket the two
 * interpretations.
 */
export function zonedWallToUtc(zone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const before = zoneOffsetMinutesAt(zone, new Date(wallAsUtc - DAY_MS))
  const after = zoneOffsetMinutesAt(zone, new Date(wallAsUtc + DAY_MS))
  const candBefore = wallAsUtc + before * MINUTE_MS
  if (before === after) return new Date(candBefore)
  const candAfter = wallAsUtc + after * MINUTE_MS
  const beforeValid = zoneOffsetMinutesAt(zone, new Date(candBefore)) === before
  const afterValid = zoneOffsetMinutesAt(zone, new Date(candAfter)) === after
  if (beforeValid && afterValid) return new Date(candAfter) // overlap: PostgreSQL takes the LATER instant
  if (afterValid) return new Date(candAfter)
  if (beforeValid) return new Date(candBefore)
  return new Date(candBefore) // gap: PostgreSQL reads it with the offset in force BEFORE the transition
}
