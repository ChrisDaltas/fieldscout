/**
 * The values the scoring settings editor shows, not a scorer. Every stats
 * surface scores through `src/lib/players/preset-scoring.ts` (the canonical
 * engine and the shipped ESPN templates). K0 deleted the calculator that used
 * to read these; `one-scorer-rule.test.ts` keeps it from coming back.
 *
 * `StatRow` and `sumStatRows` stay for raw box totals, which are never points.
 */

export interface ScoringRules {
  pass_yards: number
  pass_tds: number
  interceptions: number
  rush_yards: number
  rush_tds: number
  receptions: number
  receiving_yards: number
  receiving_tds: number
  fumbles_lost: number
  two_point_conversions: number
  fg_made: number
  fg_made_40_plus: number
  fg_made_50_plus: number
  xp_made: number
  def_sacks: number
  def_interceptions: number
  def_fumble_recoveries: number
  def_tds: number
  def_safeties: number
}

export const STANDARD_SCORING: ScoringRules = {
  pass_yards: 0.04,
  pass_tds: 4,
  interceptions: -2,
  rush_yards: 0.1,
  rush_tds: 6,
  receptions: 0,
  receiving_yards: 0.1,
  receiving_tds: 6,
  fumbles_lost: -2,
  two_point_conversions: 2,
  fg_made: 3,
  fg_made_40_plus: 4,
  fg_made_50_plus: 5,
  xp_made: 1,
  def_sacks: 1,
  def_interceptions: 2,
  def_fumble_recoveries: 2,
  def_tds: 6,
  def_safeties: 2,
}

export const HALF_PPR_SCORING: ScoringRules = {
  ...STANDARD_SCORING,
  receptions: 0.5,
}

/** Quarter-point PPR (0.25 per catch) — the phone's list stat scoring choice
 *  (Chris, 2026-10-15). Not a preset users pick for a list's own scoring. */
export const QUARTER_PPR_SCORING: ScoringRules = {
  ...STANDARD_SCORING,
  receptions: 0.25,
}

export const PPR_SCORING: ScoringRules = {
  ...STANDARD_SCORING,
  receptions: 1,
}

export const TE_PREMIUM_SCORING: ScoringRules = {
  ...PPR_SCORING,
  // V1: TE premium adds +0.5/rec on top of full PPR. The +0.5 only applies
  // when computed against TE players — handle in the call site if needed.
}

/**
 * Platform-default scoring presets users can pick from when building a list,
 * matching the set called out in PRD F7.
 */
export type ScoringPresetId =
  | 'espn_ppr'
  | 'espn_standard'
  | 'yahoo_ppr'
  | 'yahoo_standard'
  | 'half_ppr'
  | 'sleeper_ppr'
  | 'sleeper_standard'
  | 'te_premium'

export interface ScoringPreset {
  id: ScoringPresetId
  label: string
  rules: ScoringRules
}

export const SCORING_PRESETS: ScoringPreset[] = [
  { id: 'espn_ppr', label: 'ESPN PPR', rules: PPR_SCORING },
  { id: 'espn_standard', label: 'ESPN Standard', rules: STANDARD_SCORING },
  { id: 'yahoo_ppr', label: 'Yahoo PPR', rules: PPR_SCORING },
  { id: 'yahoo_standard', label: 'Yahoo Standard', rules: STANDARD_SCORING },
  { id: 'half_ppr', label: 'Half-PPR', rules: HALF_PPR_SCORING },
  { id: 'sleeper_ppr', label: 'Sleeper PPR', rules: PPR_SCORING },
  { id: 'sleeper_standard', label: 'Sleeper Standard', rules: STANDARD_SCORING },
  { id: 'te_premium', label: 'TE Premium', rules: TE_PREMIUM_SCORING },
]

export const DEFAULT_SCORING_PRESET: ScoringPresetId = 'espn_ppr'

export function getScoringPreset(id: ScoringPresetId | string | null | undefined): ScoringPreset {
  return SCORING_PRESETS.find((p) => p.id === id) ?? SCORING_PRESETS[0]
}

export interface StatRow {
  pass_yards?: number | null
  pass_tds?: number | null
  interceptions?: number | null
  rush_yards?: number | null
  rush_tds?: number | null
  receptions?: number | null
  receiving_yards?: number | null
  receiving_tds?: number | null
  fumbles_lost?: number | null
  two_point_conversions?: number | null
  return_td?: number | null
  fumble_recovery_td?: number | null
  fg_made?: number | null
  fg_made_40_plus?: number | null
  fg_made_50_plus?: number | null
  xp_made?: number | null
  def_sacks?: number | null
  def_interceptions?: number | null
  def_fumble_recoveries?: number | null
  def_tds?: number | null
  def_safeties?: number | null
}

const STAT_FIELDS: (keyof StatRow)[] = [
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_yards',
  'rush_tds',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fumbles_lost',
  'two_point_conversions',
  'return_td',
  'fumble_recovery_td',
  'fg_made',
  'fg_made_40_plus',
  'fg_made_50_plus',
  'xp_made',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
  'def_safeties',
]

export function sumStatRows(rows: StatRow[]): StatRow {
  const total: Record<string, number> = {}
  for (const k of STAT_FIELDS) total[k] = 0
  for (const row of rows) {
    for (const k of STAT_FIELDS) {
      total[k] += Number(row[k] ?? 0)
    }
  }
  return total as StatRow
}
