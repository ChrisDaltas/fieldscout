/**
 * Cost-control constants for AI features (docs/08-AI-IMPLEMENTATION-PLAN.md §3.4).
 * Per-user limits are enforced server-side against ai_call_log; per-run caps
 * are runaway safety valves for batch/cron jobs.
 */

/** Max "Generate with AI" calls per Pro user per UTC day. */
export const AI_LIST_GENERATION_DAILY_LIMIT = 20

/** Max Ask AI calls per Pro user per UTC day (M6 — reserved now so the cap ships with the route). */
export const ASK_AI_DAILY_LIMIT = 30

/** Max lists generated per persona in a single seed/refresh run. */
export const PERSONA_MAX_LISTS_PER_RUN = 4

/** Max players per generated persona list. */
export const PERSONA_LIST_PLAYER_COUNT = 25

/** Max source URLs fetched per persona per scrape/ingest run (cost valve). */
export const PERSONA_MAX_SCRAPES_PER_RUN = 5
