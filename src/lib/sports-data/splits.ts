/**
 * Implied defensive splits by position, derived from matchup-adjusted weekly
 * projections. The projection model already prices every 2026 opponent into
 * each player-week (Bijan projects higher vs CAR than vs PIT), so the
 * deviation of a week's projection from that player's own weekly average is
 * the model's opinion of the matchup. Aggregated across every player of a
 * position facing a defense, that becomes a forward-looking
 * points-allowed-style split — no last-season stats involved.
 */

import type { ScheduleGame } from './sos'

export interface WeeklyProjectionRow {
  playerId: string
  position: string
  /** The defense this player faces that week. */
  opponent: string
  /** Projected fantasy points for the week (half PPR). */
  points: number
}

export interface MatchupSplit {
  /** 1.0 = neutral; >1 the defense boosts the position, <1 suppresses it. */
  factor: number
  /** Player-weeks behind the factor. */
  sampleWeeks: number
}

/** `${defense}|${position}` → split. */
export type SplitsByDefensePosition = Map<string, MatchupSplit>

export const splitKey = (defense: string, position: string) =>
  `${defense}|${position}`

/**
 * Volume-weighted matchup factors: for each defense × position, the ratio of
 * total projected points scored against that defense to the total those same
 * player-weeks would have produced at each player's own weekly average.
 * Sum-of-points over sum-of-baselines (rather than averaging per-player
 * ratios) keeps near-zero projections from swinging the factor.
 */
export function computeMatchupFactors(
  rows: WeeklyProjectionRow[],
): SplitsByDefensePosition {
  const totals = new Map<string, { sum: number; count: number }>()
  for (const row of rows) {
    if (!row.playerId || row.points == null) continue
    let t = totals.get(row.playerId)
    if (!t) {
      t = { sum: 0, count: 0 }
      totals.set(row.playerId, t)
    }
    t.sum += row.points
    t.count += 1
  }

  const acc = new Map<string, { points: number; baseline: number; weeks: number }>()
  for (const row of rows) {
    if (!row.opponent || !row.position) continue
    const t = totals.get(row.playerId)
    if (!t || t.count === 0) continue
    const baseline = t.sum / t.count
    if (baseline <= 0) continue
    const key = splitKey(row.opponent, row.position)
    let a = acc.get(key)
    if (!a) {
      a = { points: 0, baseline: 0, weeks: 0 }
      acc.set(key, a)
    }
    a.points += row.points
    a.baseline += baseline
    a.weeks += 1
  }

  const splits: SplitsByDefensePosition = new Map()
  for (const [key, a] of acc) {
    if (a.baseline <= 0) continue
    splits.set(key, {
      factor: Math.round((a.points / a.baseline) * 1000) / 1000,
      sampleWeeks: a.weeks,
    })
  }
  return splits
}

/**
 * Rank each defense 1–32 within a position: 1 = most generous matchup
 * (highest factor), 32 = toughest.
 */
export function rankSplits(
  splits: SplitsByDefensePosition,
): Map<string, number> {
  const byPosition = new Map<string, Array<{ defense: string; factor: number }>>()
  for (const [key, split] of splits) {
    const [defense, position] = key.split('|')
    let list = byPosition.get(position)
    if (!list) {
      list = []
      byPosition.set(position, list)
    }
    list.push({ defense, factor: split.factor })
  }

  const ranks = new Map<string, number>()
  for (const [position, list] of byPosition) {
    list.sort((a, b) => b.factor - a.factor)
    list.forEach(({ defense }, i) => ranks.set(splitKey(defense, position), i + 1))
  }
  return ranks
}

/**
 * Positional SOS: for each team × position, average the matchup factor of
 * every scheduled opponent, then rank teams 1–32 within the position
 * (1 = easiest schedule for that position). Teams whose opponents lack
 * splits for a position are omitted rather than guessed.
 */
export function computePositionalSosRanks(
  games: ScheduleGame[],
  splits: SplitsByDefensePosition,
): Map<string, number> {
  const opponentsByTeam = new Map<string, string[]>()
  for (const game of games) {
    if (!game.home || !game.away) continue
    let home = opponentsByTeam.get(game.home)
    if (!home) {
      home = []
      opponentsByTeam.set(game.home, home)
    }
    home.push(game.away)
    let away = opponentsByTeam.get(game.away)
    if (!away) {
      away = []
      opponentsByTeam.set(game.away, away)
    }
    away.push(game.home)
  }

  const positions = new Set<string>()
  for (const key of splits.keys()) positions.add(key.split('|')[1])

  const ranks = new Map<string, number>()
  for (const position of positions) {
    const avgByTeam: Array<{ team: string; avg: number }> = []
    for (const [team, opponents] of opponentsByTeam) {
      const factors = opponents
        .map((o) => splits.get(splitKey(o, position))?.factor)
        .filter((f): f is number => f != null)
      if (factors.length === 0) continue
      avgByTeam.push({
        team,
        avg: factors.reduce((sum, f) => sum + f, 0) / factors.length,
      })
    }
    // Highest average opponent factor = most generous schedule = rank 1.
    avgByTeam.sort((a, b) => b.avg - a.avg)
    avgByTeam.forEach(({ team }, i) => ranks.set(splitKey(team, position), i + 1))
  }
  return ranks
}
