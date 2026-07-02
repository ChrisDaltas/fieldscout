import type { PersonaStyleProfile } from '@/lib/personas/roster'

/**
 * Ranking-style registry for AI list generation (spec-ai-list-generation.md).
 * Analytical biases are static config; persona styles resolve dynamically
 * against ai_personas in the route.
 */

export interface AnalyticalStyle {
  key: string
  label: string
  description: string
}

export const ANALYTICAL_STYLES: AnalyticalStyle[] = [
  {
    key: 'consensus',
    label: 'Consensus',
    description:
      'Blended expert consensus with no strong bias. Balance projections, ADP, and prior-season production into a level-headed board. Deviate from ADP only with clear statistical justification.',
  },
  {
    key: 'age-prime',
    label: 'Age & Prime',
    description:
      'Favor players aged 24–28 entering or inside their athletic prime. Discount players 30 or older — especially running backs — even when recent production is strong. Youth with proven production wins ties.',
  },
  {
    key: 'last-season-points',
    label: 'Last Season Fantasy Points',
    description:
      'Rank strictly by prior-season total fantasy points in the selected scoring format. Ignore projections, hype, age, and situation changes — last season output is the whole argument.',
  },
  {
    key: 'strength-of-schedule',
    label: 'Strength of Schedule',
    description:
      'Favor players with the most favorable schedule and team situation for the upcoming season. Where explicit schedule data is missing from the packet, lean on team quality and offensive context.',
  },
  {
    key: 'target-share',
    label: 'Target Share / Air Yards',
    description:
      'Favor pass-catchers with elite target volume. Targets and receptions are the strongest signal — rank high-volume WRs and TEs aggressively, discount touchdown-dependent producers with thin volume.',
  },
  {
    key: 'breakout-upside',
    label: 'Breakout Upside',
    description:
      'Favor younger players with ascending usage and opportunity. Prioritize year-two and year-three leaps, rising target/carry trends, and new starting roles over established but capped veterans.',
  },
]

/** Match a client-provided style string by key or label, case-insensitively. */
export function findAnalyticalStyle(style: string): AnalyticalStyle | null {
  const needle = style.trim().toLowerCase()
  return (
    ANALYTICAL_STYLES.find(
      (s) => s.key === needle || s.label.toLowerCase() === needle,
    ) ?? null
  )
}

/** Render a persona's structured style_profile into the {style_description}
 * prompt slot. persona_context (M3 content engine) appends here when it
 * exists — absent context degrades gracefully to this profile alone. */
export function renderStyleDescription(profile: PersonaStyleProfile): string {
  const biases = profile.biases
    .map((b) => `- ${b.type} (weight ${b.weight}): ${b.note}`)
    .join('\n')
  const leans = Object.entries(profile.positional_leans)
    .map(([pos, lean]) => `${pos}: ${lean}`)
    .join(', ')
  return [
    `Voice: ${profile.voice}`,
    `Default scoring lens: ${profile.scoring_default}`,
    `Biases:\n${biases}`,
    `Positional leans: ${leans}`,
    `Signature moves: ${profile.signature_moves.join('; ')}`,
    `Rationale style: ${profile.rationale_style}`,
  ].join('\n')
}
