import { z } from 'zod'

// ============================================================================
// persona_context.context JSONB shape (spec-ai-content-engine.md).
// Used both as the Claude structured-output schema for synthesis and as the
// runtime validator wherever a context row is read back.
// ============================================================================

export const personaStanceSchema = z.object({
  player_name: z.string(),
  team: z.string().nullable(),
  stance: z.string(),
  /** 0–1; structured outputs can't range-constrain, clamped server-side. */
  confidence: z.number(),
  source_url: z.string(),
  /** ISO date the stance was observed in the source, when known. */
  observed_at: z.string().nullable(),
})
export type PersonaStance = z.infer<typeof personaStanceSchema>

export const personaMovementSchema = z.object({
  player_name: z.string(),
  direction: z.enum(['up', 'down']),
  note: z.string(),
  source_url: z.string(),
})
export type PersonaMovement = z.infer<typeof personaMovementSchema>

export const personaSourceLogEntrySchema = z.object({
  url: z.string(),
  type: z.string(),
  published_at: z.string().nullable(),
  ingested_at: z.string().nullable(),
})

/** persona_content_items.extracted JSONB shape — structured signals Claude
 * Haiku pulls from one ingested feed item (never verbatim prose). */
export const extractedSignalsSchema = z.object({
  player_takes: z.array(
    z.object({
      player_name: z.string(),
      team: z.string().nullable(),
      stance: z.enum(['up', 'down', 'neutral']),
      summary: z.string(),
      /** 0–1 conviction strength. */
      strength: z.number(),
    }),
  ),
  themes: z.array(z.string()),
  format: z.enum(['PPR', 'Half-PPR', 'Standard']).nullable(),
  kind: z.enum(['rankings_article', 'opinion', 'video', 'podcast']),
})
export type ExtractedSignals = z.infer<typeof extractedSignalsSchema>

export const personaContextSchema = z.object({
  /** ISO date this context was synthesized. */
  as_of: z.string(),
  voice: z.string(),
  current_stances: z.array(personaStanceSchema),
  signature_takes: z.array(z.string()),
  recent_movements: z.array(personaMovementSchema),
  themes_in_play: z.array(z.string()),
  source_log: z.array(personaSourceLogEntrySchema),
})
export type PersonaContext = z.infer<typeof personaContextSchema>
