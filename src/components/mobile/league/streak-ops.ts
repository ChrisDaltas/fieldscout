/**
 * A team's win/loss streak — ONE count for every phone screen that shows
 * one: the Match card ("2-6 ▼2L"), the Team view's Streak tile ("L2") and
 * Standings ("2-6 · ▼2L"). Gap list #39 (Chris, 2026-10-15): the Match card
 * shows it too, and all three count it the same way.
 *
 * THE RULE (the standard ESPN / Yahoo / Sleeper one): the run of identical
 * results at the end of the team's decided games, oldest to newest.
 *  - A tie is a result of its own, so it ENDS a W or L run; back-to-back
 *    ties are a tie streak ("T2").
 *  - Only a decided game counts: the matchup's STORED result
 *    (`matchups.result`, written with `status = 'final'` when the week
 *    finalizes) — never a score, so a live or not-yet-final week is not a
 *    result yet.
 *  - Which games: the weekly head-to-head game of the regular season
 *    (`round_type = 'regular'` with an opponent). A bye is no game. The
 *    playoffs (and consolation / third-place games), the second-opponent
 *    game (`secondary`) and the League Median game are not in the run — the
 *    streak follows the week's main matchup, like the standings it sits in.
 *  - One season: when `season` is given, other seasons' games are ignored
 *    (a league's schedule read can hold more than one).
 *
 * No server field carries a streak (m-match.gaps / PROGRESS F566), so this
 * is the one place it is worked out, from the stored results the schedule
 * read already holds.
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
  result: string | null
}

/** The team's current streak, or null before it has a decided game. */
export function teamStreak(teamId: string, matchups: readonly StreakMatchup[], season?: number): Streak | null {
  const results = matchups
    .filter(
      (m) =>
        (season === undefined || m.season === undefined || m.season === season) &&
        m.round_type === 'regular' &&
        m.status === 'final' &&
        m.away_team_id !== null &&
        (m.home_team_id === teamId || m.away_team_id === teamId) &&
        (m.result === 'home' || m.result === 'away' || m.result === 'tie'),
    )
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.week - b.week)
    .map((m): StreakKind => (m.result === 'tie' ? 'T' : (m.result === 'home') === (m.home_team_id === teamId) ? 'W' : 'L'))
  const last = results[results.length - 1]
  if (!last) return null
  let count = 0
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) count++
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

/** The streak's colour: green for a W run (#07A852), red for an L run
 *  (#FF0028); a tie run keeps the text colour it sits in (`tie`). */
export function streakToneClass(s: Streak, tie: string): string {
  return s.kind === 'W' ? 'text-positive-strong' : s.kind === 'L' ? 'text-negative-strong' : tie
}
