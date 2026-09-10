'use client'

import { useQuery } from '@tanstack/react-query'

import { readLiveScoringFlags, STATS_DEGRADED_KEY, type LiveScoringFlags } from '@/lib/sync/ingest-flags'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * The two §23.2 reasons the scores on screen may be behind, as the UI reads
 * them — M4 task L.D5.2 (spec §16.5.4 "Live stats delayed" banner; §23.2/E45
 * "never wrong numbers, just honest staleness"; migration 122
 * `system_flags`; PROGRESS D322(1), ledger F217's banner-read half),
 * EXTENDED by migration 124:
 *
 *   * `stats_degraded` — the PROVIDER has failed three polls in a row;
 *   * `scoring_stalled` — the score-week DRAIN is not running, so stats have
 *     landed but no score was recomputed from them. This is the 2026-09-10
 *     incident (24 queue rows, 0 claimed, 0 deferred, six hours, no
 *     `team_week_results`), and until 124 nothing on any surface said so.
 *
 * Both raise the SAME banner, because the sentence a manager needs is the
 * same either way — "scores show the last update we received" is exactly
 * true in both cases, and the remedy (wait) is identical. The operator
 * distinguishes them from the flag values, not from the copy.
 *
 * READ: a direct RLS SELECT of `system_flags` (world-SELECT — 122 says
 * "the 'Live stats delayed' banner" is why) through the ONE parser the
 * writers use (`readLiveScoringFlags`, `ingest-flags.ts`) — one shape, one
 * reading of a malformed value, ONE round trip for both keys. No row yet
 * (a fresh deploy, or a database that has not yet received 124) is the
 * empty flag, not an error.
 *
 * FRESHNESS: nothing broadcasts `system_flags` (it is not on the
 * `league:<id>` topic and adding a name there is an F-row — D296's list is
 * closed), so this is a POLL: `STATS_DEGRADED_POLL_MS` while a page that
 * mounts it is visible (React Query's `refetchIntervalInBackground` default
 * keeps a hidden tab quiet — the F252 poll's shape). The banner therefore
 * lags the flag by at most one interval, which is honest staleness about
 * honest staleness; the numbers on the page are never touched by it.
 *
 * A failed read renders NO banner rather than a wrong one: the flag is an
 * annotation on the scores, and "we could not read whether stats are
 * delayed" is not "stats are delayed". The scores' own surfaces carry their
 * own degraded state (`StaleDataBanner`).
 */

export const STATS_DEGRADED_POLL_MS = 60_000

export const statsDegradedKeys = {
  flag: () => ['system-flags', STATS_DEGRADED_KEY] as const,
}

export function useStatsDegraded(options: { enabled?: boolean } = {}) {
  return useQuery<LiveScoringFlags>({
    queryKey: statsDegradedKeys.flag(),
    enabled: options.enabled ?? true,
    queryFn: () => readLiveScoringFlags(createBrowserClient()),
    refetchInterval: STATS_DEGRADED_POLL_MS,
  })
}

export type LiveScoringDelayReason = 'provider' | 'drain' | 'ingest'

/**
 * The banner's three questions, answered from one flag object: should it
 * show, what instant does it name, and which of §23.2's reasons it is.
 * PURE, and — deliberately — CLOCKLESS.
 *
 * Order is by how much it explains. The PROVIDER incident wins the instant
 * when several are up: `last_success_at` is the older, more honest number
 * (the stall's `oldest_enqueued_at` cannot precede the poll that enqueued
 * it). Between 124's own two arms the QUEUE wins, because a counted row is
 * a more specific fact than an absence.
 *
 * NO FRESHNESS ARM HERE, and that is a ruling rather than an oversight. A
 * frozen `scoring_stalled.checked_at` IS the tell that the checker itself
 * died (F330), and reading it that way would need a wall-clock sample in
 * this hook and in both callers — which is exactly what
 * `matchup-view.render.test.ts` and `league-home-season.render.test.ts` pin
 * against BY NAME over `matchup-view.tsx`, `matchup-view-ops.ts`,
 * `status-banners.tsx`, `use-box-score.ts` and this file ("no clock
 * (§23.3 / F226) in the view, the ops or the hooks"). Measured: adding it
 * reds both cells. The freshness assertion belongs where a clock is
 * sanctioned and where it can still run when the database's own scheduler
 * is dead — the CI step F330(a) already names, which becomes correct the
 * day after 124 reaches production.
 */
export function liveScoringDelay(flags: LiveScoringFlags | undefined): { delayed: boolean; since: string | null; reason: LiveScoringDelayReason | null } {
  if (!flags) return { delayed: false, since: null, reason: null }
  if (flags.degraded) return { delayed: true, since: flags.last_success_at, reason: 'provider' }
  if (flags.stall.stalled) {
    // `oldest_enqueued_at` is null exactly when the queue arm did not fire,
    // and then the honest instant is the last ingestion we recorded.
    return {
      delayed: true,
      since: flags.stall.oldest_enqueued_at ?? flags.stall.last_ingest_at,
      reason: flags.stall.rows > 0 ? 'drain' : 'ingest',
    }
  }
  return { delayed: false, since: null, reason: null }
}
