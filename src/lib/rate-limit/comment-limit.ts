/**
 * The comment limit — Community launch plan C2 (migration 213).
 *
 * THE NUMBER lives in the database (`rate_limit_rule_internal('comment')`:
 * 5 per 60 000 ms, per person, across every list). The insert path enforces
 * it — 213's BEFORE INSERT trigger on `list_comments` refuses a person's 6th
 * comment in a minute with SQLSTATE `PGRST`, which PostgREST answers as HTTP
 * 429 with `Retry-After`, `code: 'rate_limited'`, the reason in plain words
 * and `details: 'retry_after_seconds=<n>'`.
 *
 * This module is everything around that, pure (no clock, no fetch, no env —
 * callers pass `now`):
 *
 *   - the route side: `parseCommentRateLimit` recognises the trigger's
 *     refusal on a supabase-js error and `commentRateLimitedParts` builds the
 *     route's 429 (body + `Retry-After`);
 *   - the comment box side: `commentWaitMs` counts the poster's own comments
 *     from the last minute so Post can be disabled with "You can comment
 *     again in 20s" BEFORE the server refuses, and takes the server's wait
 *     when the server refuses first; `commentWaitCopy` is that line.
 *
 * Before 213 is pushed nothing refuses on the server; the box's own count
 * still holds the same 5-a-minute pace, so the experience is the same.
 */

import { parseRateLimitRefusal, type PostgrestErrorShape } from './rate-limit-refusal'

export type { PostgrestErrorShape }

/** 213's numbers, mirrored for the comment box's count (the server decides). */
export const COMMENT_LIMIT = 5
export const COMMENT_WINDOW_MS = 60_000

export interface CommentRateLimit {
  /** The server's wait, whole seconds (≥ 1). */
  retryAfterSeconds: number
  /** The server's reason, in plain words. */
  message: string
}

/** 213's refusal, or `null` for any other error (the shared reader, with the
 *  comment window as the fallback wait and the comment copy as the fallback words). */
export function parseCommentRateLimit(error: PostgrestErrorShape | null | undefined): CommentRateLimit | null {
  const refusal = parseRateLimitRefusal(error, COMMENT_WINDOW_MS / 1000)
  if (!refusal) return null
  const { retryAfterSeconds, serverMessage } = refusal
  return { retryAfterSeconds, message: serverMessage ?? commentRefusalCopy(retryAfterSeconds) }
}

function secondsWord(seconds: number): string {
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

/** The refusal in plain words when the server's own words are missing. */
export function commentRefusalCopy(seconds: number): string {
  return `You're commenting too fast — you can comment again in ${secondsWord(seconds)}.`
}

export interface CommentRateLimitedBody {
  error: string
  code: 'RATE_LIMITED'
  bucket: 'comment'
  retry_after_seconds: number
}

/** The route's 429 body and its `Retry-After` header value. */
export function commentRateLimitedParts(limit: CommentRateLimit): { body: CommentRateLimitedBody; retryAfter: string } {
  return {
    body: { error: limit.message, code: 'RATE_LIMITED', bucket: 'comment', retry_after_seconds: limit.retryAfterSeconds },
    retryAfter: String(limit.retryAfterSeconds),
  }
}

/**
 * How long until the poster may comment again, in ms (0 = now).
 *
 * `ownCreatedAts` are the poster's own comments' `created_at` (server time)
 * from about the last minute, in any order. The server allows a comment
 * while fewer than 5 of his hits are live — a hit at t counts for
 * [t, t + 60 s) — so with n ≥ 5 live the wait is until the (n − 4)-th oldest
 * leaves. `serverUntil` is the instant the server said to wait until (its
 * refusal's Retry-After), which wins when it is later: the server also
 * counts comments since removed, which the box can no longer read.
 */
export function commentWaitMs(
  ownCreatedAts: readonly string[],
  now: number,
  serverUntil: number | null = null,
): number {
  const live = ownCreatedAts
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t) && t > now - COMMENT_WINDOW_MS && t <= now + COMMENT_WINDOW_MS)
    .sort((a, b) => a - b)
  let wait = 0
  if (live.length >= COMMENT_LIMIT) {
    const freesAt = live[live.length - COMMENT_LIMIT] + COMMENT_WINDOW_MS
    wait = Math.min(COMMENT_WINDOW_MS, Math.max(0, freesAt - now))
  }
  if (serverUntil !== null && Number.isFinite(serverUntil)) wait = Math.max(wait, serverUntil - now)
  return Math.max(0, Math.ceil(wait))
}

/** Whole seconds for the countdown, rounded up (a wait of 0.2 s reads "1s"). */
export function waitSeconds(waitMs: number): number {
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0
}

/** The comment box's line while Post is held. */
export function commentWaitCopy(seconds: number): string {
  return `You can comment again in ${seconds}s`
}
