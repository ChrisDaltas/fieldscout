/**
 * THE preset scorer: ESPN Standard, Half PPR, Quarter PPR and Full PPR outside
 * a league (F576 / D537; K0 finished the job and retired the legacy calculator).
 *
 * Every stats surface scores through here: each stored game on its own, by the
 * canonical engine (`scoreStarter`, §7.3.3, one namespace, D33), under the
 * shipped ESPN template rules, then the games are summed. A season is never
 * scored as one summed line for K or D/ST, because tiers only exist per game:
 * Cowboys 2026 weeks 5 and 6 score −2 + 5 = 3, not −6 as one line.
 *
 * `presetLine` is the one stats-only step in front of the engine. It lives here
 * and not in `deliveredLine` or ingest because those feed league scores, which
 * K0's ruling doesn't cover. League scoring is untouched, so league kicker
 * points still read the stored short-FG and missed-FG columns, which nothing
 * writes (F402). Chris rules on that separately (F870).
 *
 * - K: `fg_0_39` and `fg_missed` are worked out from the columns ingest does
 *   store (`fg_made`, `fg_attempted`, and the 40–49 and 50+ buckets). If the
 *   feed is fixed later these equal the stored values, so nothing double-counts.
 * - D/ST: a line missing points allowed or yards allowed is REFUSED, never
 *   scored. NULL points allowed would otherwise read as a +5 shutout. A stored
 *   0 with real yards is a real shutout (Sleeper omits it; F401, migration 143).
 * - Offense: a `two_point_conversions` total above its splits goes on `pass_2pt`,
 *   for older rows that hold only the total.
 *
 * A refused game is not a game: it adds no points and no game count anywhere. A
 * column missing from the SELECT (`undefined`) throws, so a wrong read fails
 * loudly and can never pay a quiet +5.
 *
 * Still short of ESPN's table, on purpose (they need storage or a league
 * ruling): blocked kicks and return TDs are not stored, a 60+ yard FG pays 5
 * rather than 6, and an engine kicker scope scores kicking stats only, so a
 * kicker's rushing yards score nothing (Brandon Aubrey 2025 wk15: 14 vs ESPN's
 * 14.6). Filed for Chris as F871.
 */
import { roundHalfUp } from '@/lib/leagues/scoring/calculator'
import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import { normalizePosition, scoreStarter, STAT_LINE_COLUMNS, type StatLineRow } from '@/lib/leagues/scoring/score-week-worker'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'

/** The preset systems (the player page's dropdown keys). */
export type PresetSystem = 'espn_standard' | 'half_ppr' | 'quarter_ppr' | 'ppr'

/** The Stats Center's `?scoring=` values → the preset they mean. */
export const PRESET_BY_BUILDER_KEY = {
  standard: 'espn_standard',
  half_ppr: 'half_ppr',
  ppr: 'ppr',
} as const satisfies Record<string, PresetSystem>

const RULES_BY_SYSTEM = new Map<PresetSystem, ScoringRulesDoc>()

/** The preset systems' rules: the shipped ESPN templates (no new rows). Half
 *  and Quarter PPR are ESPN Standard with 0.5 or 0.25 a catch. */
export function systemRules(system: PresetSystem): ScoringRulesDoc {
  const known = RULES_BY_SYSTEM.get(system)
  if (known) return known
  const std = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Standard')
  const ppr = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Full PPR')
  if (!std || !ppr) throw new Error('scoring: the ESPN templates are missing')
  const rules = (
    system === 'espn_standard'
      ? std.rules
      : system === 'ppr'
        ? ppr.rules
        : { ...std.rules, receptions: system === 'quarter_ppr' ? 0.25 : 0.5 }
  ) as unknown as ScoringRulesDoc
  RULES_BY_SYSTEM.set(system, rules)
  return rules
}

/** The columns a preset line needs: the engine's surface plus the summed
 *  two-point total the offense fill reads. Every preset SELECT uses this. */
export const PRESET_LINE_COLUMNS: readonly string[] = [...new Set([...STAT_LINE_COLUMNS, 'two_point_conversions'])]

export const PRESET_LINE_SELECT = ['player_id', 'season', 'week', 'source', ...PRESET_LINE_COLUMNS].join(', ')

const OFFENSE_POSITIONS: ReadonlySet<string> = new Set(['QB', 'RB', 'WR', 'TE'])

/** QB, RB, WR or TE. Takes the feed's or the scoring document's spelling. */
export function isOffensePosition(position: string): boolean {
  return OFFENSE_POSITIONS.has(normalizePosition(position))
}

/** Half-up to 1 decimal: the rounding every displayed points number uses, so a
 *  Quarter PPR 104.55 reads 104.6 on every surface (exact for any 2 dp value). */
export function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

type RawLine = Record<string, unknown>

const count = (line: RawLine, column: string) => Number(line[column] ?? 0)

/** `undefined` means the SELECT left a column out: loud, never a quiet 0. */
function requireColumns(position: string, line: RawLine, columns: readonly string[]) {
  for (const column of columns) {
    if (line[column] === undefined) throw new Error(`preset scoring: a ${position} line was read without ${column}`)
  }
}

const KICKER_REQUIRED = ['fg_made', 'fg_attempted', 'fg_made_40_plus', 'fg_made_50_plus', 'xp_made', 'xp_attempted'] as const
const DST_REQUIRED = ['def_points_allowed', 'def_yards_allowed'] as const

/** A scorable line for `position` (already normalized), or `null` to refuse the
 *  game. Idempotent: preparing a prepared line changes nothing. */
function presetLine(position: string, line: RawLine): RawLine | null {
  if (position === 'K') {
    requireColumns(position, line, KICKER_REQUIRED)
    const made = count(line, 'fg_made')
    const attempted = count(line, 'fg_attempted')
    // Nothing kicked at all: an empty row (the historical loader leaves these), not a 0-point game.
    if (made === 0 && attempted === 0 && count(line, 'xp_made') === 0 && count(line, 'xp_attempted') === 0) return null
    const short = made - count(line, 'fg_made_40_plus') - count(line, 'fg_made_50_plus')
    const missed = attempted - made
    if (short < 0 || missed < 0) return null
    return { ...line, fg_0_39: short, fg_missed: missed }
  }
  if (position === 'DST') {
    requireColumns(position, line, DST_REQUIRED)
    const { def_points_allowed: pointsAllowed, def_yards_allowed: yardsAllowed } = line
    if (pointsAllowed === null || yardsAllowed === null) return null
    if (!Number.isInteger(Number(pointsAllowed)) || !Number.isInteger(Number(yardsAllowed))) return null
    return Number(pointsAllowed) < 0 ? null : line
  }
  if (OFFENSE_POSITIONS.has(position)) {
    const unsplit = count(line, 'two_point_conversions') - count(line, 'pass_2pt') - count(line, 'rush_2pt') - count(line, 'rec_2pt')
    return unsplit > 0 ? { ...line, pass_2pt: count(line, 'pass_2pt') + unsplit } : line
  }
  return null
}

/** The prepared lines, refused games dropped. Run this BEFORE counting games or
 *  slicing frames, so a game count always means scored games. */
export function presetLines<T extends object>(position: string, rows: readonly T[]): T[] {
  if (rows.length === 0) return []
  const normalized = normalizePosition(position)
  const out: T[] = []
  for (const row of rows) {
    const line = presetLine(normalized, row as RawLine)
    if (line !== null) out.push(line as T)
  }
  return out
}

/** One game's points at engine precision (2 dp), or `null` when the game is
 *  refused or the engine reports a stat still pending. */
export function presetGamePoints(system: PresetSystem, position: string, row: object): number | null {
  const normalized = normalizePosition(position)
  const line = presetLine(normalized, row as RawLine)
  if (line === null) return null
  const score = scoreStarter(systemRules(system), '', normalized, line as unknown as StatLineRow)
  return score.pending.length > 0 ? null : score.points
}

/**
 * Points over the given lines: each game scored alone, then summed (half-up to
 * 2 dp, §7.3.3). `games` counts scored games only. `points` is null with no
 * scored game, never a 0.
 */
export function presetSeasonPoints(
  system: PresetSystem,
  position: string,
  rows: readonly object[],
): { points: number | null; games: number } {
  let sum = 0
  let games = 0
  for (const row of rows) {
    const points = presetGamePoints(system, position, row)
    if (points === null) continue
    sum += points
    games += 1
  }
  return { points: games === 0 ? null : roundHalfUp(sum), games }
}

/** The number a surface shows, at 1 dp. With no scored game an offensive player
 *  reads 0 (the games count beside it says "none"), and a K or D/ST reads null,
 *  which every surface prints as a dash. */
export function presetSeasonDisplay(system: PresetSystem, position: string, rows: readonly object[]): number | null {
  const { points } = presetSeasonPoints(system, position, rows)
  if (points === null) return isOffensePosition(position) ? 0 : null
  return roundOneDecimal(points)
}

/**
 * The only function that scores a summed line, at 1 dp. OFFENSE ONLY: a catch or
 * a yard is worth the same summed or not, but K and D/ST tiers exist per game, so
 * asking for one of those throws. Used for a season pace line, a season-long
 * projection line and a pool's season totals.
 */
export function presetTotalsPoints(system: PresetSystem, position: string, totals: object): number {
  const normalized = normalizePosition(position)
  if (!OFFENSE_POSITIONS.has(normalized)) throw new Error(`preset scoring: a summed ${normalized} line can't be scored, its tiers are per game`)
  const line = presetLine(normalized, totals as RawLine) as RawLine
  return roundOneDecimal(scoreStarter(systemRules(system), '', normalized, line as unknown as StatLineRow).points)
}

/** The columns the Stats Center reads per week: the raw totals it shows and
 *  the canonical scoring surface the engine scores. */
export const BUILDER_TOTAL_COLUMNS = [
  'pass_attempts', 'pass_completions', 'pass_yards', 'pass_tds', 'interceptions', 'sacks_taken',
  'rush_attempts', 'rush_yards', 'rush_tds', 'fumbles_lost',
  'targets', 'receptions', 'receiving_yards', 'receiving_tds',
  'fg_made', 'fg_attempted', 'fg_made_40_plus', 'fg_made_50_plus', 'xp_made', 'xp_attempted',
  'def_sacks', 'def_interceptions', 'def_fumble_recoveries', 'def_tds', 'def_safeties',
  'two_point_conversions',
]
export const BUILDER_STATS_SELECT = [
  'player_id',
  'season',
  'week',
  'source',
  'updated_at',
  'advanced',
  ...new Set([...BUILDER_TOTAL_COLUMNS, ...STAT_LINE_COLUMNS]),
].join(', ')
