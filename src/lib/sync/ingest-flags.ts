/**
 * ingest-flags — the PERSISTED half of ingestion's bookkeeping (task L.D2.3;
 * migration 122's `system_flags`; spec §23.2 / §24.1 / E45; PROGRESS D322,
 * discharges F217 and binds F218/R714's orphan escape — F263(e)).
 *
 * Two keys, one table (`system_flags(key, value jsonb, updated_at)` —
 * world-SELECT for the banner, service-role writes only):
 *
 *   `stats_degraded` — §23.2's incident flag as it survives across
 *     serverless invocations. L.D2.1's `DegradationTracker` counts
 *     consecutive failed polls IN PROCESS; a Vercel cron invocation is a
 *     fresh process, so the count is read back in before a poll
 *     (`loadDegradationTracker`) and written out after it
 *     (`persistPollOutcome`) — "after 3 failed polls" then means three
 *     polls, whichever invocations they ran in. The value carries what an
 *     operator (and L.D5.2's "Live stats delayed" banner) needs:
 *     `degraded`, `consecutive_failures`, `last_failure_at`,
 *     `last_success_at`, `last_error`, `provider`.
 *
 *   `ingest_poll:<season>:<week>` — the instant the LAST SUCCESSFUL poll for
 *     (season, week) COMPLETED: `completed_at` = the poll's injected instant
 *     (`IngestReport.polledAt`, the stamp every row it wrote carries). The
 *     worker's readiness seam (`deps.lastPollCompletedAt`, D321(1)) reads
 *     it: a queued row whose stat line is older than its stamp is held
 *     (F218) UNLESS a later poll completed after the stamp and left the
 *     line untouched — then the stored line IS the truth (R714's orphan:
 *     a crash between the queue write and the stats write, followed by an
 *     identical re-poll). Written only after `ingestWeek` returned `ok`
 *     (both writes landed): a crash before this write leaves no escape,
 *     which is the safe direction (the row stays held, never scored stale).
 *
 * Time: no clock is read here — every instant comes from the poll report.
 * The writers are `upsert`s that assert their row count (loud emptiness).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'

import type { IngestReport } from './ingest-week'

export type FlagsClient = SupabaseClient<Database>

export const STATS_DEGRADED_KEY = 'stats_degraded'

export function ingestPollKey(season: number, week: number): string {
  return `ingest_poll:${season}:${week}`
}

export interface StatsDegradedFlag {
  degraded: boolean
  consecutive_failures: number
  last_failure_at: string | null
  last_success_at: string | null
  last_error: string | null
  provider: string | null
}

export interface IngestPollFlag {
  completed_at: string
  provider: string
}

const EMPTY_FLAG: StatsDegradedFlag = {
  degraded: false,
  consecutive_failures: 0,
  last_failure_at: null,
  last_success_at: null,
  last_error: null,
  provider: null,
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Json | undefined>) : {}
}

function str(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

/** The persisted flag, or the empty flag when no row exists yet (a fresh deploy). */
export async function readStatsDegraded(db: FlagsClient): Promise<StatsDegradedFlag> {
  const { data, error } = await db.from('system_flags').select('value').eq('key', STATS_DEGRADED_KEY).maybeSingle()
  if (error) throw new Error(`system_flags read (${STATS_DEGRADED_KEY}): ${error.message}`)
  if (!data) return { ...EMPTY_FLAG }
  const v = asRecord(data.value)
  const failures = typeof v.consecutive_failures === 'number' && Number.isInteger(v.consecutive_failures) && v.consecutive_failures >= 0 ? v.consecutive_failures : 0
  return {
    degraded: v.degraded === true,
    consecutive_failures: failures,
    last_failure_at: str(v.last_failure_at),
    last_success_at: str(v.last_success_at),
    last_error: str(v.last_error),
    provider: str(v.provider),
  }
}

/** A tracker seeded from the persisted count — what a poll starts from. */
export async function loadDegradationTracker(db: FlagsClient): Promise<DegradationTracker> {
  const flag = await readStatsDegraded(db)
  return new DegradationTracker(flag.consecutive_failures)
}

async function upsertFlag(db: FlagsClient, key: string, value: Json, updatedAt: string): Promise<void> {
  const { data, error } = await db.from('system_flags').upsert({ key, value, updated_at: updatedAt }, { onConflict: 'key' }).select('key')
  if (error) throw new Error(`system_flags upsert (${key}): ${error.message}`)
  if ((data ?? []).length !== 1) throw new Error(`system_flags upsert (${key}) wrote ${(data ?? []).length} rows — refusing to call that success`)
}

/**
 * After ONE poll: persist the tracker's count + the outcome under
 * `stats_degraded`, and — only when the poll succeeded — the week's
 * `ingest_poll` key with `completed_at = report.polledAt`. Returns the flag
 * as written.
 */
export async function persistPollOutcome(db: FlagsClient, tracker: DegradationTracker, report: IngestReport): Promise<StatsDegradedFlag> {
  const prior = await readStatsDegraded(db)
  const flag: StatsDegradedFlag = {
    degraded: tracker.degraded,
    consecutive_failures: tracker.consecutiveFailures,
    last_failure_at: report.ok ? prior.last_failure_at : report.polledAt,
    last_success_at: report.ok ? report.polledAt : prior.last_success_at,
    last_error: report.ok ? null : (report.error ?? 'provider poll failed'),
    provider: report.provider,
  }
  await upsertFlag(db, STATS_DEGRADED_KEY, flag as unknown as Json, report.polledAt)
  if (report.ok) {
    const poll: IngestPollFlag = { completed_at: report.polledAt, provider: report.provider }
    await upsertFlag(db, ingestPollKey(report.season, report.week), poll as unknown as Json, report.polledAt)
  }
  return flag
}

/** The persisted last-poll instant for (season, week), or null when no successful poll has completed. */
export async function readLastPollCompletedAt(db: FlagsClient, season: number, week: number): Promise<string | null> {
  const { data, error } = await db.from('system_flags').select('value').eq('key', ingestPollKey(season, week)).maybeSingle()
  if (error) throw new Error(`system_flags read (${ingestPollKey(season, week)}): ${error.message}`)
  if (!data) return null
  return str(asRecord(data.value).completed_at)
}

/** The worker's seam, bound (D321(1) / F263(e)): `deps.lastPollCompletedAt = lastPollCompletedAtReader(db)`. */
export function lastPollCompletedAtReader(db: FlagsClient): (season: number, week: number) => Promise<string | null> {
  return (season, week) => readLastPollCompletedAt(db, season, week)
}
