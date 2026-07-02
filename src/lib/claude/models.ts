/**
 * Pinned Claude model IDs, tiered by job (see docs/08-AI-IMPLEMENTATION-PLAN.md §3.1).
 * Upgrades are one-line changes here — never inline a model string elsewhere.
 */

/** High-volume extraction (content-engine ingestion: page → structured signals). */
export const CLAUDE_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

/** User-facing generation (List Generation, Ask AI, persona rationales, context synthesis). */
export const CLAUDE_GENERATION_MODEL = 'claude-sonnet-5'

/** Highest-stakes editorial prose (auto-published persona posts, if/when trusted). */
export const CLAUDE_EDITORIAL_MODEL = 'claude-opus-4-8'

export type ClaudeModel =
  | typeof CLAUDE_EXTRACTION_MODEL
  | typeof CLAUDE_GENERATION_MODEL
  | typeof CLAUDE_EDITORIAL_MODEL
