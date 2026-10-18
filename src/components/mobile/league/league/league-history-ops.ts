/**
 * League Menu › League history on the phone (handoff m-community G4; gap
 * list §3 #16) — the pure half. This season's head-to-head for one team:
 * its record, points for and points against overall, then against every
 * other team. The screen is `league-history-screen.tsx`.
 *
 * The numbers are the desktop Stats page's own (`headToHead` / `overall`,
 * `stats-page-ops.ts`) over the same schedule read, so the two layouts can
 * never disagree: a game counts once it has a STORED result
 * (`matchups.result` — written when the week finalizes, or by a
 * commissioner's ruling), and its points are the stored scores. Nothing
 * here scores a game. A game still being played, or not played yet, is no
 * result.
 *
 * What the phone adds, per the design: every other team is listed in league
 * order (one not played yet reads 0-0), and the points print with one
 * decimal. Leagues keep one season each, so the season chips hold just this
 * one — all-time history needs leagues that carry over (gap list §2).
 */

import { headToHead, overall, type H2HRow } from '@/components/leagues/stats-page-ops'
import type { ScheduleMatchup } from '@/hooks/use-schedule'

export type HistoryRow = H2HRow

/** The whole line over every opponent (`overall`). */
export type HistoryTotal = ReturnType<typeof overall>

interface HistoryTeam {
  id: string
  name: string
  status: string
}

/**
 * One team's record against every other team this season, in league order
 * (`detail.teams`, oldest first — the order the avatars' colours follow).
 * A team not played yet reads 0-0; a retired team shows only when it was
 * played. Only this season's games count (a schedule read can hold more
 * than one season).
 */
export function historyRows(
  matchups: readonly ScheduleMatchup[],
  teamId: string,
  teams: readonly HistoryTeam[],
  season: number,
): HistoryRow[] {
  const names = new Map(teams.map((t) => [t.id, t.name]))
  const played = new Map(
    headToHead(
      matchups.filter((m) => m.season === season),
      teamId,
      names,
    ).map((r) => [r.opponentId, r]),
  )
  const rows: HistoryRow[] = []
  for (const t of teams) {
    if (t.id === teamId) continue
    const row = played.get(t.id)
    if (row) {
      rows.push(row)
      played.delete(t.id)
    } else if (t.status !== 'retired') {
      rows.push({ opponentId: t.id, opponentName: t.name, wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0, pointsAgainst: 0 })
    }
  }
  // A game against a team the league read doesn't list still counts.
  rows.push(...played.values())
  return rows
}

/** The team's whole season over every opponent. */
export function historyTotal(rows: readonly HistoryRow[]): HistoryTotal {
  return overall(rows)
}

/**
 * The teams whose history you can open, as chips: yours first, then the
 * rest in league order. Retired teams are left out (the desktop picker's
 * rule).
 */
export function historyTeams<T extends HistoryTeam>(teams: readonly T[], myTeamId: string | null): T[] {
  const active = teams.filter((t) => t.status !== 'retired')
  const mine = active.find((t) => t.id === myTeamId)
  return mine ? [mine, ...active.filter((t) => t !== mine)] : active
}

/** The team the address asks for (`?team=`) when it's one of the chips;
 *  otherwise the first chip (yours). Null only for a league with no teams. */
export function historyTeamFromParam(raw: string | null | undefined, teamIds: readonly string[]): string | null {
  if (raw && teamIds.includes(raw)) return raw
  return teamIds[0] ?? null
}

/** The address for the team on screen, keeping any other query. The first
 *  chip (yours) is the bare address. */
export function historySearch(search: string, teamId: string | null, firstTeamId: string | null): string {
  const params = new URLSearchParams(search)
  if (teamId && teamId !== firstTeamId) params.set('team', teamId)
  else params.delete('team')
  const next = params.toString()
  return next ? `?${next}` : ''
}

/** "630.5" — one decimal, no thousands separator (the design); the dash
 *  when there's nothing to add up yet or a counted game has no stored score. */
export function historyPoints(points: number | null, games: number): string {
  return points === null || games === 0 ? '—' : points.toFixed(1)
}

/** "115.7 per game", or nothing when it can't be worked out. */
export function perGameLine(points: number | null, games: number): string | null {
  return points === null || games === 0 ? null : `${(points / games).toFixed(1)} per game`
}

/** The record's colour: green when winning, red when losing, the text
 *  colour when even (the design's W-L rule). */
export function recordToneClass(r: Pick<HistoryRow, 'wins' | 'losses'>): string {
  return r.wins > r.losses ? 'text-m-green' : r.wins < r.losses ? 'text-m-red' : 'text-m-t1'
}

/** "W-L", or "W-L-T" once any game was tied. */
export function recordHeading(total: Pick<HistoryTotal, 'ties'>): string {
  return total.ties > 0 ? 'W-L-T' : 'W-L'
}

/** The record card's sub-line: "2026 season". */
export function seasonLine(season: number): string {
  return `${season} season`
}

/** The League Menu row's value: "Since 2026" (the design's "Since 2023" —
 *  a league's first season is this one). */
export function historyMenuSub(season: number): string {
  return `Since ${season}`
}
