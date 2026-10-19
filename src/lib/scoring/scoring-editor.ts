/**
 * The personal scoring builder's model (`/app/settings/scoring`) — shared by
 * the desktop page and the phone screen (gap list §4 item 101), which draw
 * the same groups, values and Scout AI read in their own layouts.
 */
import {
  DEFAULT_SCORING_PRESET,
  getScoringPreset,
  type ScoringPresetId,
  type ScoringRules,
} from '@/lib/scoring/default'
import type { Json } from '@/types/database'

/** The editor is either showing a platform preset or the user's custom system. */
export type ScoringMode = ScoringPresetId | 'custom'

export const CUSTOM_DEFAULT_NAME = 'My custom scoring'

/* ------------------------------ Rule groups ----------------------------- */

export interface StatFieldMeta {
  key: keyof ScoringRules
  label: string
  unit: string
  step: number
}

/** Per-phase grouping of the real ScoringRules shape from lib/scoring. */
export const SCORING_GROUPS: { title: string; fields: StatFieldMeta[] }[] = [
  {
    title: 'Passing',
    fields: [
      { key: 'pass_yards', label: 'Passing yards', unit: 'per yd', step: 0.01 },
      { key: 'pass_tds', label: 'Passing TD', unit: 'per TD', step: 1 },
      { key: 'interceptions', label: 'Interception', unit: 'per INT', step: 1 },
    ],
  },
  {
    title: 'Rushing',
    fields: [
      { key: 'rush_yards', label: 'Rushing yards', unit: 'per yd', step: 0.01 },
      { key: 'rush_tds', label: 'Rushing TD', unit: 'per TD', step: 1 },
    ],
  },
  {
    title: 'Receiving',
    fields: [
      { key: 'receptions', label: 'Reception', unit: 'per rec', step: 0.5 },
      {
        key: 'receiving_yards',
        label: 'Receiving yards',
        unit: 'per yd',
        step: 0.01,
      },
      { key: 'receiving_tds', label: 'Receiving TD', unit: 'per TD', step: 1 },
    ],
  },
  {
    title: 'Miscellaneous',
    fields: [
      { key: 'fumbles_lost', label: 'Fumble lost', unit: 'per fum', step: 1 },
      {
        key: 'two_point_conversions',
        label: '2-pt conversion',
        unit: 'per 2PC',
        step: 1,
      },
    ],
  },
  {
    title: 'Kicking',
    fields: [
      { key: 'fg_made', label: 'Field goal', unit: 'per FG', step: 1 },
      { key: 'fg_made_40_plus', label: 'Field goal 40+', unit: 'per FG', step: 1 },
      { key: 'fg_made_50_plus', label: 'Field goal 50+', unit: 'per FG', step: 1 },
      { key: 'xp_made', label: 'Extra point', unit: 'per XP', step: 1 },
    ],
  },
  {
    title: 'Defense',
    fields: [
      { key: 'def_sacks', label: 'Sack', unit: 'per sack', step: 1 },
      { key: 'def_interceptions', label: 'Interception', unit: 'per INT', step: 1 },
      {
        key: 'def_fumble_recoveries',
        label: 'Fumble recovery',
        unit: 'per FR',
        step: 1,
      },
      { key: 'def_tds', label: 'Defensive TD', unit: 'per TD', step: 1 },
      { key: 'def_safeties', label: 'Safety', unit: 'per safety', step: 1 },
    ],
  },
]

/* -------------------------------- Helpers ------------------------------- */

/** "+0.04", "+4", "-2" — mono-ready, no trailing zeros beyond the data. */
export function formatPoints(value: number): string {
  const text = Number(value.toFixed(2)).toString()
  return value > 0 ? `+${text}` : text
}

/** A value after a − / + press (or any edit): rounded to the cent, so a
 *  0.01 step never drifts into float noise. */
export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Coerce a stored `rules` Json blob into the full ScoringRules shape,
 * falling back to the platform default for any missing/invalid field.
 */
export function parseRules(json: Json | null): ScoringRules {
  const base: ScoringRules = { ...getScoringPreset(DEFAULT_SCORING_PRESET).rules }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const record = json as Record<string, unknown>
    for (const key of Object.keys(base) as (keyof ScoringRules)[]) {
      const value = record[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        base[key] = value
      }
    }
  }
  return base
}

/** A real read on the current values — which position group they push up. */
export function deriveInsight(rules: ScoringRules): { heading: string; body: string } {
  const rec = rules.receptions
  if (rec >= 1) {
    return {
      heading: 'Your settings favor pass catchers',
      body: `${formatPoints(rec)} per reception on top of ${formatPoints(rules.receiving_yards)} per receiving yard rewards target volume — WRs and pass-catching RBs climb this board.`,
    }
  }
  if (rec > 0) {
    return {
      heading: 'Your settings are close to balanced',
      body: `${formatPoints(rec)} per reception splits the difference — rushing and receiving volume score about evenly, so draft the best player available.`,
    }
  }
  if (rules.pass_tds >= 6) {
    return {
      heading: 'Your settings favor QBs',
      body: `${formatPoints(rules.pass_tds)} per passing TD matches rushing scores with zero PPR — elite passers jump the queue in this format.`,
    }
  }
  return {
    heading: 'Your settings favor RBs',
    body: `No points per reception with ${formatPoints(rules.rush_tds)} per rushing TD makes carries king — early-down workhorses outscore possession receivers.`,
  }
}

/** The save route's refusal, in the page's words. */
export function scoringSaveError(body: { error?: string; code?: string } | null): string {
  return body?.code === 'PRO_REQUIRED' ? 'Custom scoring is a Pro feature.' : body?.error || 'Could not save scoring'
}

/* -------------------------------- Copy ---------------------------------- */

export const SYSTEM_NAME_MAX = 60

/** What the System name field shows: your custom name, or the preset's own. */
export function systemNameValue(mode: ScoringMode, name: string): string {
  return mode === 'custom' ? name : getScoringPreset(mode).label
}

export function systemNameHint(mode: ScoringMode): string {
  return mode === 'custom' ? 'Names your custom system across FieldScout.' : 'Platform presets keep their own names.'
}

/** Shown in place of the editing tools when custom scoring is Pro-only
 *  (`CUSTOM_SCORING_PRO_ONLY`; off while the Pro rules are on hold). */
export const PRO_SCORING_UPSELL = {
  heading: 'Custom scoring is a Pro tool.',
  body: 'Every platform preset is yours to use — Pro lets you tune each value and save a system of your own.',
} as const
