/**
 * Room fetch-path honesty — the pure model behind the draft room's
 * "is what I'm rendering still true?" question (M3 task L.C3.1, PROGRESS
 * **F56's room half**; spec §16.5.4's required states, §16.3's
 * latency-resilience, §16.4's v2.12 banner-surface rule).
 *
 * **F56, restated.** The first `test:gate:m2` attempt watched a LIVE manager
 * room fall back to the scheduled-lobby surface — F56's own words: *"the
 * settings-countdown branch renders when the room's draft data is absent"*.
 * That branch is honest for exactly one league state (a scheduled league
 * whose drafts row the tick has not created yet — D94) and is a LIE for
 * every other reason the draft data can be absent, and the room could not
 * tell the two apart: an absent draft rendered a countdown whether the
 * fetch had answered "there is no draft" or had simply stopped answering.
 * That is the CLAUDE.md shape verbatim — *"never let 'nothing happened' mean
 * 'it worked'"*: assert the REASON for the emptiness, never infer it.
 *
 * **The decision (F56's room half, recorded at PROGRESS D191).** An absent
 * draft is only honest when the fetch that failed to produce one is HEALTHY.
 * Two rules, both encoded below and neither of them a heuristic:
 *
 *  1. `absentDraftIsHonest(health)` gates every no-draft branch (the D94
 *     lobby, the post-draft recap pointer, the "no draft yet" empty). A
 *     degraded or failed fetch renders the §16.5.4 error-with-retry surface
 *     instead — the room says "I could not read this", never "there is
 *     nothing here".
 *  2. A room that HOLDS last-good data and cannot refresh it keeps
 *     rendering that data behind a banner (§16.5.4's *degraded — banner +
 *     last-good data, never wrong numbers*) rather than being replaced by
 *     an error card. One transient refetch failure should not evict a live
 *     draft room; a persistent one must not be silent.
 *
 * **N mirrors the subscribe path deliberately.** `FIRST_JOIN_FAILURES_FOR_BANNER`
 * (R263, `use-draft-ops.ts`) is 2 for a stated reason — the first failure is
 * routinely a transient boot/token race the retry heals invisibly, and
 * flashing a banner there is noise; a SECOND consecutive failure means the
 * retry did not heal it. The fetch path has exactly the same shape (React
 * Query retries with backoff and resets `failureCount` on success), so it
 * takes the same threshold, from the same constant, rather than inventing a
 * second number that would drift.
 *
 * The gate-side half of F56 — a bounded stack-health settle between the sim
 * and E2E stages — is **not** here: it stays L.C6.1's, per the row's own
 * two-way routing.
 *
 * Pure: no React, no client, no wall-clock read.
 */

import { FIRST_JOIN_FAILURES_FOR_BANNER } from '@/hooks/use-draft-ops'

/** N consecutive failed fetches before the room admits its fetch gap —
 *  the SAME constant the subscribe path uses (R263), not a second number. */
export const FETCH_FAILURES_FOR_BANNER = FIRST_JOIN_FAILURES_FOR_BANNER

export type FetchHealth =
  /** Answering. Absent data means absent data. */
  | 'ok'
  /** Not answering, but we hold last-good data: render it behind the banner. */
  | 'degraded'
  /** Not answering and we hold nothing: there is nothing honest to render. */
  | 'failed'

export interface QueryHealthInput {
  /** React Query's consecutive-failure count (reset to 0 on success) — the
   *  same "consecutive failures since the last good answer" semantics
   *  `use-draft.ts` keeps by hand for joins. */
  failureCount: number
  /** The query is in its error state (retries exhausted). */
  isError: boolean
  /** A previous fetch succeeded and its result is still cached. */
  hasData: boolean
}

/**
 * One query's honesty state. A query that is failing but has NOT yet crossed
 * the threshold reads `ok` **only while it holds data** — with nothing
 * cached there is nothing to be optimistic about, so the first failure of a
 * dataless query already counts (the room shows its skeleton until React
 * Query gives up, and the error surface after).
 */
export function queryHealth(input: QueryHealthInput): FetchHealth {
  if (!input.hasData) {
    return input.isError || input.failureCount >= FETCH_FAILURES_FOR_BANNER ? 'failed' : 'ok'
  }
  return input.isError || input.failureCount >= FETCH_FAILURES_FOR_BANNER ? 'degraded' : 'ok'
}

/** The room's health is the WORST of the queries it renders from — a room
 *  whose league detail is fine but whose draft state is stale is a degraded
 *  room, because the draft is the thing on screen. */
export function worstHealth(...states: readonly FetchHealth[]): FetchHealth {
  if (states.includes('failed')) return 'failed'
  if (states.includes('degraded')) return 'degraded'
  return 'ok'
}

/**
 * **Rule 1.** May the room render one of its no-draft branches (the D94
 * scheduled lobby, the post-draft recap pointer, the "no draft yet" empty)?
 * Only when the fetch that produced the absence is healthy. This is the
 * single line F56's room half turns on.
 */
export function absentDraftIsHonest(health: FetchHealth): boolean {
  return health === 'ok'
}

/** The §16.5.4 degraded copy lives in the shared banner catalog beside
 *  `RECONNECTING_COPY` (`status-banners.tsx` — one state, one spelling; and
 *  a `.tsx` import would break this module's vitest load under
 *  `jsx: "preserve"`, the D178(1) reason `draft-options-ops.ts` is a `.ts`).
 *
 *  The title/body of the fetch-failure surface that REPLACES a no-draft
 *  branch under rule 1. Deliberately not the generic "no draft here" copy:
 *  the user is told the room could not read, and given the retry. */
export const FETCH_FAILED_TITLE = "Couldn't read this draft."
export const FETCH_FAILED_BODY =
  "The room asked for the draft and didn't get an answer, so it won't guess that there isn't one. Retry, or head back to the league."
