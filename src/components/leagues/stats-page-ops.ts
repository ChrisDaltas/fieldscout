/**
 * League Stats — the pure half (League UX batch 5, Chris 2026-10-03). The
 * prototype's `StatsTab`: a team's head-to-head record against every
 * opponent, from STORED results only.
 *
 * A game counts once it has a stored result (`matchups.result` — set when
 * the week is scored, or by a commissioner's ruling); a game still being
 * played or not yet played does not. Points for / against are the stored
 * scores; if any counted game is missing a stored score the total is "—",
 * never a partial sum. Every round counts (regular season, second-opponent
 * games and the playoffs), the way ESPN and Yahoo count a head-to-head
 * history. One season exists per league, so there is no season filter.
 */
import type { ScheduleMatchup } from '@/hooks/use-schedule'

export const STATS_TITLE = 'Stats'
export const H2H_TITLE = 'Head to head'
export const NO_GAMES_COPY = 'No games finished yet — head-to-head records start once the first week is scored.'
export const TOTAL_POINTS_COPY = 'This league scores by total points each week, so there are no head-to-head games to count.'
export const NO_TEAM_COPY = 'Pick a team to see its record against every opponent.'
export const SEASON_ONLY_COPY = 'This season only — records from past seasons aren’t kept yet.'

export interface H2HRow {
  opponentId: string
  opponentName: string
  wins: number
  losses: number
  ties: number
  games: number
  /** Null when a counted game has no stored score. */
  pointsFor: number | null
  pointsAgainst: number | null
}

/** One team's record against each opponent, most games first, then name. */
export function headToHead(matchups: readonly ScheduleMatchup[], teamId: string, names: ReadonlyMap<string, string>): H2HRow[] {
  const rows = new Map<string, H2HRow>()
  for (const m of matchups) {
    if (m.result === null || m.away_team_id === null) continue
    const home = m.home_team_id === teamId
    if (!home && m.away_team_id !== teamId) continue
    const opponentId = home ? m.away_team_id : m.home_team_id
    const row =
      rows.get(opponentId) ??
      ({ opponentId, opponentName: names.get(opponentId) ?? 'Unknown team', wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0, pointsAgainst: 0 } satisfies H2HRow)
    row.games += 1
    if (m.result === 'tie') row.ties += 1
    else if ((m.result === 'home') === home) row.wins += 1
    else row.losses += 1
    const mine = home ? m.home_score : m.away_score
    const theirs = home ? m.away_score : m.home_score
    row.pointsFor = row.pointsFor === null || mine === null ? null : round2(row.pointsFor + mine)
    row.pointsAgainst = row.pointsAgainst === null || theirs === null ? null : round2(row.pointsAgainst + theirs)
    rows.set(opponentId, row)
  }
  return [...rows.values()].sort((a, b) => b.games - a.games || a.opponentName.localeCompare(b.opponentName))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** "3–1" or "3–1–1" (ties only when there are any). */
export function recordText(r: Pick<H2HRow, 'wins' | 'losses' | 'ties'>): string {
  return r.ties > 0 ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`
}

/** The whole season's line over every opponent (points null if any is). */
export function overall(rows: readonly H2HRow[]): Omit<H2HRow, 'opponentId' | 'opponentName'> {
  return rows.reduce(
    (acc, r) => ({
      wins: acc.wins + r.wins,
      losses: acc.losses + r.losses,
      ties: acc.ties + r.ties,
      games: acc.games + r.games,
      pointsFor: acc.pointsFor === null || r.pointsFor === null ? null : round2(acc.pointsFor + r.pointsFor),
      pointsAgainst: acc.pointsAgainst === null || r.pointsAgainst === null ? null : round2(acc.pointsAgainst + r.pointsAgainst),
    }),
    { wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0 as number | null, pointsAgainst: 0 as number | null },
  )
}

export function pointsText(n: number | null): string {
  return n === null ? '—' : n.toFixed(2)
}
