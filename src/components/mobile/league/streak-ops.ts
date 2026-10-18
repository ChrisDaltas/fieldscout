/**
 * A team's win/loss streak — ONE count for every screen that shows one:
 * the Match card ("2-6 ▼2L"), the Team view's Streak tile ("L2") and
 * Standings ("2-6 · ▼2L"). Gap list #39 (Chris, 2026-10-15): the Match card
 * shows it too, and all three count it the same way. The desktop Matchup
 * page's scoreboard shows it the same way (F566, D530).
 *
 * THE RULE (Chris, 2026-10-16: "count everything if a league is using win
 * vs median, but not if not"): the run of identical results at the end of
 * ALL the team's decided results in the season, oldest to newest.
 *  - Every head-to-head game the team played counts: the regular season,
 *    the playoffs, consolation and third-place games (every
 *    `matchups.round_type`), and the second-opponent game (`secondary`) in
 *    a league that plays one.
 *  - A two-week playoff round (`playoff_weeks_per_round = 2`) is ONE game,
 *    as on ESPN and Yahoo and as the bracket decides it (118 (B)): won
 *    by the most points over both weeks, and only a result once BOTH weeks
 *    are final — each week's own stored W/L/T is bookkeeping. An equal
 *    total is a tie (T), the same as a tied one-week playoff game (118 (A):
 *    the bracket advances the higher seed, the result stays a tie). The
 *    round sits at its second week. Its weeks are found from the rows
 *    themselves: the same two teams in back-to-back weeks of the same
 *    playoff, consolation or third-place game type. In one-week rounds a
 *    pair can't meet twice in a row — the loser leaves that bracket — so
 *    nothing else is ever joined.
 *  - PLUS the result against the League Median for every week the league
 *    scored one (`team_week_results.median_result`). A league without
 *    median scoring stores no median result, so nothing extra is counted.
 *  - Within one week the order is: the main game, then the second-opponent
 *    game, then the median result. So a week won head-to-head but lost to
 *    the median ends on an L.
 *  - A tie is a result of its own, so it ENDS a W or L run; back-to-back
 *    ties are a tie streak ("T2").
 *  - Only a decided result counts: the matchup's STORED result
 *    (`matchups.result`, written with `status = 'final'` when the week
 *    finalizes) and a final results row's median result — never a live
 *    score, so a live or not-yet-final week is not a result yet (a two-week
 *    round's total is read only once both its weeks are final). A bye is
 *    no game.
 *  - One season: when `season` is given, other seasons' results are
 *    ignored (a league's schedule read can hold more than one).
 *
 * No server field carries a streak (m-match.gaps / PROGRESS F566), so this
 * is the one place it is worked out, from the stored results the schedule
 * read (`useSchedule`: the matchups + the median results) already holds.
 */

export type StreakKind = 'W' | 'L' | 'T'

export interface Streak {
  kind: StreakKind
  count: number
}

/** The matchup columns the count reads (`ScheduleMatchup` / `MatchupRow`). */
export interface StreakMatchup {
  season?: number
  week: number
  round_type: string
  status: string
  home_team_id: string
  away_team_id: string | null
  /** Read only to total a two-week playoff round (118 (B)). */
  home_score: number | null
  away_score: number | null
  result: string | null
}

/** The `team_week_results` columns the count reads (`ScheduleMedianResult`). */
export interface StreakMedianResult {
  season?: number
  week: number
  team_id: string
  /** win | loss | tie; NULL when the league scored no median that week. */
  median_result: string | null
  is_final: boolean
}

/** What the count reads — the shape of the schedule read (`LeagueSchedule`). */
export interface StreakSource {
  matchups: readonly StreakMatchup[]
  /** The stored median results; the schedule read always carries them. */
  median_results?: readonly StreakMedianResult[]
}

/** A stored median result as a streak result; anything else is no result. */
function medianKind(result: string | null): StreakKind | null {
  return result === 'win' ? 'W' : result === 'loss' ? 'L' : result === 'tie' ? 'T' : null
}

/** The bracket game types whose rounds can last two weeks (118 (B)). */
const BRACKET_ROUND_TYPES: ReadonlySet<string> = new Set(['playoff', 'consolation', 'third_place'])

/** A game's stored result from `teamId`'s side; null when it has none. */
function storedKind(m: StreakMatchup, teamId: string): StreakKind | null {
  if (m.result === 'tie') return 'T'
  if (m.result !== 'home' && m.result !== 'away') return null
  return (m.result === 'home') === (m.home_team_id === teamId) ? 'W' : 'L'
}

/** One bracket game: a single week's stored result, or a two-week round's
 *  result from the total over both weeks (118 (B)) — null until every week
 *  of it is final. Points are summed in hundredths, as the bracket rounds
 *  each week to two decimals, so an exactly equal total stays a tie. */
function bracketGameKind(rows: readonly StreakMatchup[], teamId: string): StreakKind | null {
  if (rows.some((m) => m.status !== 'final')) return null
  if (rows.length === 1) return storedKind(rows[0], teamId)
  let mine = 0
  let theirs = 0
  for (const m of rows) {
    const home = Math.round((m.home_score ?? 0) * 100)
    const away = Math.round((m.away_score ?? 0) * 100)
    mine += m.home_team_id === teamId ? home : away
    theirs += m.home_team_id === teamId ? away : home
  }
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'
}

/** The team's current streak, or null before it has a decided result. */
export function teamStreak(teamId: string, source: StreakSource, season?: number): Streak | null {
  const inSeason = (s: number | undefined) => season === undefined || s === undefined || s === season
  // `slot` orders one week's results: the main game, the second-opponent game, the median.
  const results: Array<{ season: number; week: number; slot: number; kind: StreakKind }> = []
  // Bracket games, keyed by season + game type + the two teams (either side
  // home), so a two-week round's weeks can be joined into one game.
  const bracket = new Map<string, StreakMatchup[]>()
  for (const m of source.matchups) {
    if (!inSeason(m.season) || m.away_team_id === null) continue
    if (m.home_team_id !== teamId && m.away_team_id !== teamId) continue
    if (BRACKET_ROUND_TYPES.has(m.round_type)) {
      const opponent = m.home_team_id === teamId ? m.away_team_id : m.home_team_id
      const key = `${m.season ?? 0}|${m.round_type}|${opponent}`
      bracket.set(key, [...(bracket.get(key) ?? []), m])
      continue
    }
    const kind = m.status === 'final' ? storedKind(m, teamId) : null
    if (kind) results.push({ season: m.season ?? 0, week: m.week, slot: m.round_type === 'secondary' ? 1 : 0, kind })
  }
  for (const rows of bracket.values()) {
    const byWeek = [...rows].sort((a, b) => a.week - b.week)
    // Back-to-back weeks are one round; a gap starts another game.
    let game: StreakMatchup[] = []
    const close = () => {
      const kind = game.length ? bracketGameKind(game, teamId) : null
      const last = game[game.length - 1]
      if (kind && last) results.push({ season: last.season ?? 0, week: last.week, slot: 0, kind })
      game = []
    }
    for (const m of byWeek) {
      if (game.length && m.week !== game[game.length - 1].week + 1) close()
      game.push(m)
    }
    close()
  }
  for (const r of source.median_results ?? []) {
    if (!inSeason(r.season) || !r.is_final || r.team_id !== teamId) continue
    const kind = medianKind(r.median_result)
    if (kind) results.push({ season: r.season ?? 0, week: r.week, slot: 2, kind })
  }
  results.sort((a, b) => a.season - b.season || a.week - b.week || a.slot - b.slot)
  const last = results[results.length - 1]?.kind
  if (!last) return null
  let count = 0
  for (let i = results.length - 1; i >= 0 && results[i].kind === last; i--) count++
  return { kind: last, count }
}

/** "▲8W" / "▼2L" — the Match card and Standings (m-match / m-league:
 *  "▲" before a W run, "▼" before an L run). A tie run has no arrow: "1T". */
export function streakArrowText(s: Streak): string {
  if (s.kind === 'W') return `▲${s.count}W`
  if (s.kind === 'L') return `▼${s.count}L`
  return `${s.count}T`
}

/** "W8" / "L2" / "T1" — the Team view's Streak tile (m-team: "Streak is
 *  shown as W8 / L2; ▲/▼ only appears elsewhere"). */
export function streakTileText(s: Streak): string {
  return `${s.kind}${s.count}`
}

/** A W run's and an L run's text colour. */
export type StreakTone = Readonly<Record<'W' | 'L', string>>

/** The phone's: #07A852 / #FF0028, brightening to #1ED760 / #FF6B6B in phone
 *  dark mode (gap list §4 item 6). */
const PHONE_STREAK_TONE: StreakTone = { W: 'text-m-green', L: 'text-m-red' }

/** The streak's colour: green for a W run, red for an L run; a tie run keeps
 *  the text colour it sits in (`tie`). Desktop's matchup header passes its
 *  own fixed pair — the phone's tokens are for the phone. */
export function streakToneClass(s: Streak, tie: string, tone: StreakTone = PHONE_STREAK_TONE): string {
  return s.kind === 'T' ? tie : tone[s.kind]
}
