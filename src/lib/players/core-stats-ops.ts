/**
 * The player page's core-stats row (D486(10), Chris 2026-10-04: "the row of
 * core stats in the header: Total fantasy points, avg weekly pts, Projected
 * this week, Positional Rank, overall rank, strength of schedule, BYE Week").
 *
 * Pure: the ranking rule, the per-game average, the basis label and the
 * seven tiles. A value with no real source is "—", never 0.
 */
import { roundHalfUp } from '@/lib/leagues/scoring/calculator'

export const MISSING = '—'

/**
 * Standard competition ranking ("1224"): a player's rank is 1 + the number
 * of players with STRICTLY more points, so ties share a rank and the next
 * rank skips. Players with no points (no games) are unranked — absent from
 * the map. This is how ESPN/Yahoo rank season points.
 */
export function competitionRanks(points: ReadonlyMap<string, number | null>): Map<string, number> {
  const scored = [...points.entries()].filter((e): e is [string, number] => e[1] !== null)
  const sorted = scored.map(([, p]) => p).sort((a, b) => b - a)
  const out = new Map<string, number>()
  for (const [id, p] of scored) {
    // First index holding a value <= p is the count strictly above it.
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] > p) lo = mid + 1
      else hi = mid
    }
    out.set(id, lo + 1)
  }
  return out
}

/** Games played: his stat weeks, never counting his bye week. */
export function gamesPlayed(weeks: readonly number[], byeWeek: number | null): number {
  return weeks.filter((w) => w !== byeWeek).length
}

/** Total ÷ games played (byes excluded). Null when he has no games. */
export function avgPerGame(total: number | null, games: number): number | null {
  if (total === null || games <= 0) return null
  return roundHalfUp(total / games)
}

export type ScoringBasis = { kind: 'league'; league_name: string } | { kind: 'default' }

export function basisLabel(basis: ScoringBasis): string {
  return basis.kind === 'league' ? `${basis.league_name} scoring` : 'Standard scoring'
}

export interface CoreStatsPayload {
  basis: ScoringBasis
  season: number
  week: number | null
  total_points: number | null
  games: number
  avg_points: number | null
  projected_points: number | null
  pos_rank: number | null
  overall_rank: number | null
}

export interface CoreTile {
  key: string
  label: string
  value: string
}

function pts(n: number | null): string {
  return n === null ? MISSING : n.toFixed(1)
}

/** The seven tiles, in Chris's order. `stats` is null while loading/failed
 *  (the point tiles read "—"); SOS and bye come from the player record. */
export function coreTiles(
  stats: CoreStatsPayload | null,
  player: { position: string; sos: number | null; bye_week: number | null },
): CoreTile[] {
  return [
    { key: 'total', label: 'Total pts', value: pts(stats?.total_points ?? null) },
    { key: 'avg', label: 'Avg / week', value: pts(stats?.avg_points ?? null) },
    { key: 'proj', label: 'Proj this wk', value: pts(stats?.projected_points ?? null) },
    { key: 'pos-rank', label: 'Pos rank', value: stats?.pos_rank != null ? `${player.position} ${stats.pos_rank}` : MISSING },
    { key: 'overall-rank', label: 'Overall', value: stats?.overall_rank != null ? `#${stats.overall_rank}` : MISSING },
    { key: 'sos', label: 'SOS', value: player.sos != null ? `${player.sos} of 32` : MISSING },
    { key: 'bye', label: 'Bye', value: player.bye_week != null ? `Wk ${player.bye_week}` : MISSING },
  ]
}
