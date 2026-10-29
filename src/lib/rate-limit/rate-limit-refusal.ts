/**
 * A database rate-limit refusal, read off a supabase-js / PostgREST error.
 *
 * Every per-person limit the database enforces answers the same way —
 * 213's comment guard (5 a minute) and 214's `report_content` (10 reports an
 * hour): SQLSTATE `PGRST` carrying PostgREST's envelope, so the request gets
 * HTTP 429 with `Retry-After`, and the error carries `code: 'rate_limited'`,
 * the reason in plain words as `message`, and `details:
 * 'retry_after_seconds=<n>'`.
 *
 * Pure (no clock, no fetch): callers turn it into their own copy and wait.
 */

/** The fields a supabase-js / PostgREST error carries. */
export interface PostgrestErrorShape {
  code?: string | null
  message?: string | null
  details?: string | null
}

export interface RateLimitRefusal {
  /** The server's wait, whole seconds (≥ 1). */
  retryAfterSeconds: number
  /** The server's reason in plain words, or `null` when it sent none. */
  serverMessage: string | null
}

/**
 * The limit's refusal, or `null` for any other error. A refusal whose wait
 * can't be read holds for `fallbackSeconds` (the limit's whole window) —
 * never zero, so a refused person is never told to retry at once.
 */
export function parseRateLimitRefusal(
  error: PostgrestErrorShape | null | undefined,
  fallbackSeconds: number,
): RateLimitRefusal | null {
  if (!error || error.code !== 'rate_limited') return null
  const match = /retry_after_seconds=(\d+)/.exec(error.details ?? '')
  const seconds = match ? Number(match[1]) : NaN
  const retryAfterSeconds = Number.isFinite(seconds) && seconds >= 1 ? Math.ceil(seconds) : fallbackSeconds
  return { retryAfterSeconds, serverMessage: error.message?.trim() || null }
}
