'use client'

import { useQuery } from '@tanstack/react-query'

import { readStatsDegraded, STATS_DEGRADED_KEY, type StatsDegradedFlag } from '@/lib/sync/ingest-flags'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * The §23.2 `stats_degraded` incident flag as the UI reads it — M4 task
 * L.D5.2 (spec §16.5.4 "Live stats delayed" banner; §23.2/E45 "never wrong
 * numbers, just honest staleness"; migration 122 `system_flags`; PROGRESS
 * D322(1), ledger F217's banner-read half).
 *
 * READ: a direct RLS SELECT of `system_flags` (world-SELECT — 122 says
 * "the 'Live stats delayed' banner" is why) through the ONE parser the
 * sync route writes with (`readStatsDegraded`, `ingest-flags.ts`) — one
 * shape, one reading of a malformed value. No row yet (a fresh deploy) is
 * the empty flag, not an error.
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
  return useQuery<StatsDegradedFlag>({
    queryKey: statsDegradedKeys.flag(),
    enabled: options.enabled ?? true,
    queryFn: () => readStatsDegraded(createBrowserClient()),
    refetchInterval: STATS_DEGRADED_POLL_MS,
  })
}
