/**
 * THE preset scorer — ESPN Standard / Half PPR / Full PPR outside a league
 * (F576, PROGRESS D537).
 *
 * Before this module the app had two "PPR" calculators: the player page's
 * core-stats row scored through the canonical engine and the shipped ESPN
 * templates (D486(11)), while the Stats Center (`/api/players/builder`)
 * scored with the legacy `PPR_SCORING` dot-product in
 * `src/lib/scoring/default.ts`. Same label, different numbers — the legacy
 * one summed a season first (so a D/ST's points-allowed tiers could not be
 * scored per game), had no yards-allowed or 2-pt split, and paid
 * `fg_made × 3` ON TOP of the 40+/50+ bonuses.
 *
 * Now both surfaces call `presetSeasonPoints`: each week's stored line is
 * scored on its own by the canonical engine (`seasonToDate` →
 * `scoreStarter`, §7.3.3 — one namespace, D33) under the shipped ESPN
 * template rules, and the weeks are summed. `preset-scoring.test.ts` pins
 * the parity (both entry points, golden literals).
 */
import { seasonToDate } from '@/lib/leagues/scoring/player-values'
import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import { normalizePosition, STAT_LINE_COLUMNS, type StatLineRow } from '@/lib/leagues/scoring/score-week-worker'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'

/** The preset systems (the player page's dropdown keys). */
export type PresetSystem = 'espn_standard' | 'half_ppr' | 'ppr'

/** The Stats Center's `?scoring=` values → the preset they mean. */
export const PRESET_BY_BUILDER_KEY = {
  standard: 'espn_standard',
  half_ppr: 'half_ppr',
  ppr: 'ppr',
} as const satisfies Record<string, PresetSystem>

/** The preset systems' rules — the shipped ESPN templates (no new rows).
 *  Half PPR is ESPN Standard with 0.5 a catch. */
export function systemRules(system: PresetSystem): ScoringRulesDoc {
  const std = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Standard')
  const ppr = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Full PPR')
  if (!std || !ppr) throw new Error('scoring: the ESPN templates are missing')
  const rules = system === 'espn_standard' ? std.rules : system === 'ppr' ? ppr.rules : { ...std.rules, receptions: 0.5 }
  return rules as unknown as ScoringRulesDoc
}

/**
 * A player's points over the given weekly lines under a preset: each week
 * scored alone, then summed (rounded half-up to 2 dp, §7.3.3). `points` is
 * null with no lines — never a 0.
 */
export function presetSeasonPoints(
  system: PresetSystem,
  playerId: string,
  position: string,
  weeklyRows: readonly StatLineRow[],
): { points: number | null; games: number } {
  return seasonToDate(systemRules(system), playerId, normalizePosition(position), weeklyRows)
}

/** The Stats Center's season number: `presetSeasonPoints` with no lines read
 *  as 0 (its long-standing `current_pts: number` contract — the games count
 *  beside it says "none"). Rounded to 1 dp for display, as before. */
export function builderSeasonPoints(system: PresetSystem, playerId: string, position: string, weeklyRows: readonly StatLineRow[]): number {
  const { points } = presetSeasonPoints(system, playerId, position, weeklyRows)
  return points === null ? 0 : Math.round(points * 10) / 10
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
