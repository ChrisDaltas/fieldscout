/**
 * Eastern wall time → UTC instant, for the nflverse `gameday` + `gametime`
 * pair (L.D3.1; spec §23.3 — every lock derives from `nfl_games.kickoff_at`,
 * so THIS conversion is what a kickoff-derived lock ultimately reads).
 *
 * nflverse publishes `gametime` as a US/Eastern wall clock ("20:20") with no
 * offset; the offset is −04:00 (EDT) until the first Sunday of November at
 * 02:00 local and −05:00 (EST) after it (2026: Nov 1). The offset is taken
 * from the platform's IANA zone data via `Intl` (`America/New_York`) —
 * NEVER a hard-coded −4/−5, never the process's local zone — so the
 * DST fall-back inside NFL week 8 (Thu Oct 29 EDT → Sun Nov 1 EST) resolves
 * from the zone rules, not from an assumption. The break probe for this
 * task mangles exactly this function.
 *
 * The one ambiguous wall hour (01:00–01:59 on fall-back Sunday, which occurs
 * twice) has never carried an NFL kickoff; it resolves to the FIRST
 * occurrence (EDT). The skipped spring-forward hour (02:00–02:59, second
 * Sunday of March) is outside the season entirely.
 *
 * Only `Date.UTC(...)` / `new Date(<explicit ms>)` are used — no wall-clock
 * read anywhere (the D3 fence covers this file).
 */

const EASTERN = 'America/New_York'

const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Minutes to ADD to an Eastern wall time to reach UTC at `instant`
 *  (240 during EDT, 300 during EST). */
export function easternOffsetMinutesAt(instant: Date): number {
  const parts: Record<string, number> = {}
  for (const part of eastern.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  // The wall clock read back as if it were UTC, minus the true instant, is
  // the zone's offset (negative in the Americas); we return its negation.
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return -Math.round((wallAsUtc - instant.getTime()) / 60_000)
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/

/**
 * `gameday` ("YYYY-MM-DD") + `gametime` ("HH:MM", Eastern) → the UTC instant.
 * Refuses malformed input loudly (a kickoff that cannot be parsed must never
 * become a plausible wrong instant).
 */
export function easternToUtc(gameday: string, gametime: string): Date {
  const d = DAY_RE.exec(gameday)
  const t = TIME_RE.exec(gametime)
  if (!d || !t) throw new Error(`easternToUtc: malformed gameday/gametime "${gameday}" "${gametime}"`)
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59) {
    throw new Error(`easternToUtc: out-of-range gameday/gametime "${gameday}" "${gametime}"`)
  }
  // Treat the wall time as if it were UTC, then shift by the zone's offset
  // at that instant; re-check once because the offset itself can change
  // across the shift (the DST boundary).
  const wallAsUtc = Date.UTC(y, mo - 1, day, h, mi, 0)
  const firstGuess = wallAsUtc + easternOffsetMinutesAt(new Date(wallAsUtc)) * 60_000
  const offset = easternOffsetMinutesAt(new Date(firstGuess))
  const instant = wallAsUtc + offset * 60_000
  // Verify the round trip: the instant must read back as the wall time we
  // were given (this is what makes the ambiguous/skipped hours explicit).
  const back = easternOffsetMinutesAt(new Date(instant))
  if (back !== offset) {
    // The wall time sits inside a transition; prefer the first occurrence.
    return new Date(firstGuess)
  }
  return new Date(instant)
}
