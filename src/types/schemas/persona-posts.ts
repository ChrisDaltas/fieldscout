import { z } from 'zod'

// ============================================================================
// Post-generation schemas (spec-ai-content-engine.md, Slice C). Structural
// only — business rules (citation grounding, player resolution, parody
// firewall) are enforced server-side after the call.
// ============================================================================

export const generatedPostSchema = z.object({
  /** Persona-voiced post title. Parody name only — never a real analyst. */
  title: z.string(),
  /** One-sentence subtitle. */
  dek: z.string(),
  /** 2–3 paragraph introduction in the persona's voice (markdown). */
  intro_md: z.string(),
  players: z.array(
    z.object({
      rank: z.number().int(),
      player_name: z.string(),
      team: z.string(),
      /** 2–4 sentence justification in the persona's voice (markdown). */
      justification_md: z.string(),
    }),
  ),
  /** Factual claims backed by the provided source material. MUST be empty
   * when no sources were provided — never invented. */
  citations: z.array(
    z.object({
      claim: z.string(),
      source_url: z.string(),
    }),
  ),
})
export type GeneratedPost = z.infer<typeof generatedPostSchema>

/** Shape stored in persona_posts.citations. */
export interface PostCitation {
  claim: string
  source_url: string
  published_at: string | null
}
