/**
 * Strength of schedule, computed entirely from data we already sync:
 * the Sleeper season schedule (sync-bye-weeks source) and player projections
 * (sync-projections). Deliberately simple — a team-level look at how much
 * projected fantasy talent a team lines up against across the season, not a
 * positional matchup model.
 */

export interface ScheduleGame {
  week: number
  home: string
  away: string
}

export interface ProjectedPlayer {
  team: string | null
  projected: number | null
}

/** How many top projected players approximate a team's starting strength.
 *  Roughly a starting lineup's worth of fantasy-relevant players. */
const STRENGTH_TOP_N = 11

/**
 * A team's strength = sum of its top-N players by projected points.
 * Top-N (rather than the full roster) keeps deep benches from inflating a
 * team and missing projections from deflating one.
 */
export function computeTeamStrength(
  players: ProjectedPlayer[],
): Map<string, number> {
  const byTeam = new Map<string, number[]>()
  for (const p of players) {
    if (!p.team || p.projected == null || p.projected <= 0) continue
    let list = byTeam.get(p.team)
    if (!list) {
      list = []
      byTeam.set(p.team, list)
    }
    list.push(p.projected)
  }

  const strength = new Map<string, number>()
  for (const [team, projections] of byTeam) {
    projections.sort((a, b) => b - a)
    const top = projections.slice(0, STRENGTH_TOP_N)
    strength.set(team, top.reduce((sum, v) => sum + v, 0))
  }
  return strength
}

/**
 * Rank every team's schedule 1–32: 1 = easiest (lowest average opponent
 * strength), 32 = hardest. Teams missing from the schedule or without any
 * opponent strength data are omitted rather than guessed.
 */
export function computeSosRanks(
  games: ScheduleGame[],
  strengthByTeam: Map<string, number>,
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

  const avgOpponentStrength: Array<{ team: string; avg: number }> = []
  for (const [team, opponents] of opponentsByTeam) {
    const strengths = opponents
      .map((o) => strengthByTeam.get(o))
      .filter((s): s is number => s != null)
    if (strengths.length === 0) continue
    avgOpponentStrength.push({
      team,
      avg: strengths.reduce((sum, s) => sum + s, 0) / strengths.length,
    })
  }

  avgOpponentStrength.sort((a, b) => a.avg - b.avg)
  const ranks = new Map<string, number>()
  avgOpponentStrength.forEach(({ team }, i) => ranks.set(team, i + 1))
  return ranks
}
