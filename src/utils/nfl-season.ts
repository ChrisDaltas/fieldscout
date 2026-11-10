/**
 * Where the NFL calendar is right now — for display copy only (the public
 * landing page's week labels and seasonal wording). League logic never uses
 * this: leagues read time and weeks through their own providers.
 *
 * The regular season's Week 1 opens the Tuesday after Labor Day (kickoff is
 * that Thursday) and each week runs Tuesday → Monday, Eastern time.
 */

export type NflPhase = 'preseason' | 'regular' | 'postseason' | 'offseason'

export interface NflSeason {
  phase: NflPhase
  /** Regular-season week 1–18 while `phase` is 'regular'; otherwise null. */
  week: number | null
}

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY
const REGULAR_WEEKS = 18
/** Wild card through the Super Bowl, with its idle week. */
const POSTSEASON_WEEKS = 5
/** Fixed UTC−5: the week turns over at about midnight Eastern on Tuesday. */
const EASTERN_OFFSET = 5 * 60 * 60 * 1000

/** Start of Week 1 (Tuesday 00:00 Eastern) for the season that begins in `year`. */
function weekOneStart(year: number): number {
  const sept1 = new Date(Date.UTC(year, 8, 1)).getUTCDay() // 0 = Sunday
  const laborDay = 1 + ((8 - sept1) % 7) // first Monday of September
  return Date.UTC(year, 8, laborDay + 1) + EASTERN_OFFSET
}

export function nflSeason(now: Date): NflSeason {
  const t = now.getTime()
  const year = now.getUTCFullYear()

  // January and February belong to the season that started the year before.
  for (const seasonYear of [year, year - 1]) {
    const start = weekOneStart(seasonYear)
    if (t < start) continue
    const week = Math.floor((t - start) / WEEK) + 1
    if (week <= REGULAR_WEEKS) return { phase: 'regular', week }
    if (week <= REGULAR_WEEKS + POSTSEASON_WEEKS) return { phase: 'postseason', week: null }
    break
  }

  // Training camp and preseason games: August up to Week 1.
  const preseasonStart = Date.UTC(year, 7, 1) + EASTERN_OFFSET
  if (t >= preseasonStart && t < weekOneStart(year)) return { phase: 'preseason', week: null }
  return { phase: 'offseason', week: null }
}
