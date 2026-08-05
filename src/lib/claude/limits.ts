/**
 * Cost-control constants for AI features (docs/08-AI-IMPLEMENTATION-PLAN.md §3.4).
 * Per-user limits are enforced server-side against ai_call_log; per-run caps
 * are runaway safety valves for batch/cron jobs.
 */

/**
 * Default "Generate with AI" calls per user per UTC day.
 *
 * COST CONTROL, not a tier: the 2026 launch is free-only (CLAUDE.md), so this
 * cap exists to bound the ANTHROPIC_API_KEY bill and applies identically to
 * every signed-in account. Ruled 3/user/day by Chris (2026-08-05).
 */
export const AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT = 3

/**
 * The effective daily cap, read from the environment at call time so it can be
 * retuned without a code change. Read per call (not a module-level const) so a
 * platform env update takes effect on the next request rather than needing a
 * fresh module evaluation.
 *
 * `AI_LIST_GENERATION_DAILY_LIMIT=0` switches AI generation off entirely.
 * Anything unparseable falls back to the default rather than failing open.
 */
export function aiListGenerationDailyLimit(): number {
  const raw = process.env.AI_LIST_GENERATION_DAILY_LIMIT
  if (raw === undefined || raw.trim() === '') {
    return AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT
  }
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.warn(
      `[limits] Ignoring invalid AI_LIST_GENERATION_DAILY_LIMIT="${raw}" — using ${AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT}.`,
    )
    return AI_LIST_GENERATION_DAILY_LIMIT_DEFAULT
  }
  return parsed
}

/** Max Ask AI calls per user per UTC day (M6 — reserved now so the cap ships with the route). */
export const ASK_AI_DAILY_LIMIT = 30

/** Max lists generated per persona in a single seed/refresh run. */
export const PERSONA_MAX_LISTS_PER_RUN = 4

/** Max players per generated persona list. */
export const PERSONA_LIST_PLAYER_COUNT = 25

/** Max source URLs fetched per persona per scrape/ingest run (cost valve). */
export const PERSONA_MAX_SCRAPES_PER_RUN = 5

/** Max NEW feed items extracted per source per ingest run (cost valve —
 * bounds Haiku spend even when a feed dumps a large backlog). */
export const INGEST_MAX_ITEMS_PER_SOURCE = 5

/** Max persona posts generated per content-engine run (cost + review-load
 * valve — the full personas × themes grid drains across runs). */
export const PERSONA_MAX_POSTS_PER_RUN = 10
