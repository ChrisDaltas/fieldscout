import { z } from 'zod'

// ============================================================================
// AI list generation schemas (spec-ai-list-generation.md).
// The Claude-facing schema is structural only (structured outputs don't
// support string/number constraints); business rules — exactly N players,
// real players only, IR exclusion — are enforced server-side after the call.
// ============================================================================

export const AI_POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'K',
  'DEF',
  'Overall',
] as const
export type AiPosition = (typeof AI_POSITIONS)[number]

export const AI_SCORING_FORMATS = ['Standard', 'PPR', 'Half-PPR'] as const
export type AiScoringFormat = (typeof AI_SCORING_FORMATS)[number]

export const AI_PLAYER_COUNTS = [5, 10, 15, 25, 50] as const
export type AiPlayerCount = (typeof AI_PLAYER_COUNTS)[number]

/** Analytical ranking-style keys (registry lives in src/lib/claude/styles.ts).
 * Defined here because they're part of the API contract. */
export const ANALYTICAL_STYLE_KEYS = [
  'consensus',
  'age-prime',
  'last-season-points',
  'strength-of-schedule',
  'target-share',
  'breakout-upside',
] as const
export type AnalyticalStyleKey = (typeof ANALYTICAL_STYLE_KEYS)[number]

/** One weighted ranking priority: 3 = most important, 1 = least. */
export const styleWeightSchema = z.object({
  key: z.enum(ANALYTICAL_STYLE_KEYS),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})
export type StyleWeight = z.infer<typeof styleWeightSchema>

/** Request body for POST /api/lists/generate. Persona (AI expert) and
 * weighted ranking styles are independent and BOTH optional — neither
 * present means a plain consensus board. */
export const generateListRequestSchema = z.object({
  position: z.enum(AI_POSITIONS),
  scoring: z.enum(AI_SCORING_FORMATS),
  player_count: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(25),
    z.literal(50),
  ]),
  /** Active persona username (or display name) whose voice/stances ground the list. */
  persona: z.string().trim().min(1).max(80).optional(),
  /** Weighted analytical priorities; duplicate keys are deduped server-side. */
  style_weights: z
    .array(styleWeightSchema)
    .max(ANALYTICAL_STYLE_KEYS.length * 2)
    .optional(),
})
export type GenerateListRequest = z.infer<typeof generateListRequestSchema>

/** What Claude produces. player_id is deliberately absent — model-produced
 * IDs are never trusted; names resolve against the real player pool
 * server-side (plan §5.6). */
export const generatedPlayerSchema = z.object({
  rank: z.number().int(),
  player_name: z.string(),
  team: z.string(),
  rationale: z.string(),
})
export type GeneratedPlayer = z.infer<typeof generatedPlayerSchema>

export const generatedListSchema = z.object({
  players: z.array(generatedPlayerSchema),
  style_note: z.string(),
})
export type GeneratedList = z.infer<typeof generatedListSchema>

/** What the route returns to the client after server-side ID resolution. */
export interface ResolvedGeneratedPlayer {
  rank: number
  player_id: string
  player_name: string
  team: string
  rationale: string
}

export interface GenerateListResponse {
  position: AiPosition
  scoring: AiScoringFormat
  style: string
  player_count: number
  players: ResolvedGeneratedPlayer[]
  style_note: string
  /** Names Claude produced that could not be resolved to real players (dropped). */
  unresolved: string[]
}
