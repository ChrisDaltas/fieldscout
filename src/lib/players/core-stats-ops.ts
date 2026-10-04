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

/**
 * R1506 — what counts as a game. The stats sync stores a row for any line
 * carrying a mapped box key, and a feed line can carry delivered zeros for
 * a player who never took the field; `player_stats` has no appearance
 * column. So a week is a game only when its line has a NONZERO stat (and is
 * not his bye). And the average divides by COMPLETED weeks only — the
 * still-live current week (and any row still flagged live) counts toward
 * the total but not the average ("avg of completed weeks").
 */
export interface GameWeek {
  week: number
  /** Any nonzero stat on the line. */
  appeared: boolean
  /** The row is still live (its game open), or the week is not yet complete. */
  live: boolean
}

/** Completed games: appeared, not live, not his bye. */
export function completedGames(weeks: readonly GameWeek[], byeWeek: number | null): GameWeek[] {
  return weeks.filter((w) => w.appeared && !w.live && w.week !== byeWeek)
}

/** Completed-weeks points ÷ completed games. Null when he has none. */
export function avgPerGame(total: number | null, games: number): number | null {
  if (total === null || games <= 0) return null
  return roundHalfUp(total / games)
}

// ---------------------------------------------------------------------------
// Scoring choice (Chris 2026-10-04: "we want this to be a dropdown menu so
// the user can decide, by default i would do ESPN standard")
// ---------------------------------------------------------------------------

export const SCORING_SYSTEMS = [
  { key: 'espn_standard', label: 'ESPN Standard' },
  { key: 'half_ppr', label: 'Half PPR' },
  { key: 'ppr', label: 'Full PPR' },
] as const
export type ScoringSystemKey = (typeof SCORING_SYSTEMS)[number]['key']
export const DEFAULT_SCORING_SYSTEM: ScoringSystemKey = 'espn_standard'
export const SCORING_CHOICE_STORAGE_KEY = 'fs.player-core-stats.scoring'

export function isScoringSystemKey(v: string): v is ScoringSystemKey {
  return SCORING_SYSTEMS.some((s) => s.key === v)
}

export function systemLabel(key: ScoringSystemKey): string {
  return SCORING_SYSTEMS.find((s) => s.key === key)!.label
}

/** A dropdown value: a preset system key, or `league:<id>`. */
export type ScoringChoice = { kind: 'system'; system: ScoringSystemKey } | { kind: 'league'; leagueId: string }

export function choiceValue(c: ScoringChoice): string {
  return c.kind === 'system' ? c.system : `league:${c.leagueId}`
}

export function parseChoice(v: string | null | undefined): ScoringChoice | null {
  if (!v) return null
  if (isScoringSystemKey(v)) return { kind: 'system', system: v }
  if (v.startsWith('league:') && v.length > 7) return { kind: 'league', leagueId: v.slice(7) }
  return null
}

export interface ScoringOption {
  value: string
  label: string
}

/** The three presets, then one option per league the viewer is in. */
export function scoringOptions(leagues: readonly { id: string; name: string }[]): ScoringOption[] {
  return [
    ...SCORING_SYSTEMS.map((s) => ({ value: s.key, label: s.label })),
    ...leagues.map((l) => ({ value: `league:${l.id}`, label: l.name })),
  ]
}

/**
 * The selected choice. An explicit user pick this session wins; else
 * `?league=` (when the viewer can read it); else the stored choice when it
 * is still valid (a league they have left is not); else ESPN Standard.
 * `leagues` null = not loaded yet — a stored league choice is held until
 * the list proves it valid or gone.
 */
export function resolveChoice(args: {
  picked: string | null
  leagueParam: string | null
  stored: string | null
  leagues: readonly { id: string }[] | null
}): ScoringChoice {
  const valid = (c: ScoringChoice | null): c is ScoringChoice =>
    c !== null && (c.kind === 'system' || (args.leagues !== null && args.leagues.some((l) => l.id === c.leagueId)))
  const picked = parseChoice(args.picked)
  if (picked && (picked.kind === 'system' || args.leagues === null || valid(picked))) return picked
  if (args.leagueParam) return { kind: 'league', leagueId: args.leagueParam }
  const stored = parseChoice(args.stored)
  if (valid(stored)) return stored
  return { kind: 'system', system: DEFAULT_SCORING_SYSTEM }
}

/** The route's query string for a choice — the query key moves with it. */
export function coreStatsQuery(c: ScoringChoice): string {
  return c.kind === 'league' ? `?league=${encodeURIComponent(c.leagueId)}` : `?scoring=${c.system}`
}

export type ScoringBasis = { kind: 'league'; league_name: string } | { kind: 'system'; system: ScoringSystemKey }

export function basisLabel(basis: ScoringBasis): string {
  return basis.kind === 'league' ? `${basis.league_name} scoring` : `${systemLabel(basis.system)} scoring`
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
