/**
 * ingest-flags — the PERSISTED half of ingestion's bookkeeping (task L.D2.3;
 * migration 122's `system_flags`; spec §23.2 / §24.1 / E45; PROGRESS D322,
 * discharges F217 and binds F218/R714's orphan escape — F263(e)).
 *
 * Three keys, one table (`system_flags(key, value jsonb, updated_at)` —
 * world-SELECT for the banner; the sync routes write as service_role and
 * 124's `scoring-stall-check` pg_cron job writes as postgres; still no
 * client write policy for any role):
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
 *   `scoring_stalled` — 124's drain stall check, written IN THE DATABASE by
 *     `public.scoring_stall_check()` every minute. Read here only
 *     (`readLiveScoringFlags`), never written from TS: one arm counts
 *     `score_fanout` rows the claim would still take (a queue the client
 *     cannot see), and the other READS the `ingest_poll:` keys above — so
 *     the two schedulers check each other, and a pipeline that goes
 *     completely dark cannot read as healthy.
 *
 * Time: no clock is read here — every instant comes from the poll report
 * (or, for `scoring_stalled`, from the database that wrote it).
 * The writers are `upsert`s that assert their row count (loud emptiness).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'

import type { IngestReport } from './ingest-week'

export type FlagsClient = SupabaseClient<Database>

export const STATS_DEGRADED_KEY = 'stats_degraded'

/** 124's drain stall check — written every minute by the `scoring-stall-check` pg_cron job (`public.scoring_stall_check()`), read by the in-season banner. */
export const SCORING_STALLED_KEY = 'scoring_stalled'

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

/**
 * 124's `scoring_stalled`, written in the database every minute. TWO arms,
 * because a dead scheduler produces an EMPTY queue, not a backed-up one:
 *
 *   * `queue_undrained` — `score_fanout` holds rows `score_fanout_claim`
 *     would still take (its own claimability predicate — a hard-killed
 *     drain's stale `claimed_at` and an elapsed `deferred_until` BOTH
 *     count) that nothing has moved in `threshold_minutes`. The 2026-09-10
 *     incident's signature: 24 rows, six hours, `team_week_results` 0.
 *   * `ingest_stale` — no successful ingestion poll has been recorded in
 *     `ingest_threshold_minutes`. Both of 124's pings share one helper and
 *     one pair of Vault secrets, so they fail TOGETHER; with `sync-live`
 *     dead nothing is ever enqueued and the first arm would read an empty
 *     queue as health.
 *
 * `checked_at` moves every minute whether or not anything is wrong — a
 * FROZEN `checked_at` is the tell that the checker itself stopped (F330).
 * Nothing in the client reads that freshness: the surfaces that would are
 * under a no-clock pin (§23.3 / F226), so the assertion belongs in CI.
 */
export interface ScoringStalledFlag {
  stalled: boolean
  /** Which arm(s) raised it: `queue_undrained`, `ingest_stale`. Empty when it is not raised. */
  reasons: string[]
  /** ARM 1 — `score_fanout` rows the claim would still take, untouched past the threshold. */
  rows: number
  oldest_enqueued_at: string | null
  threshold_minutes: number | null
  /** ARM 2 — no `ingest_poll:<season>:<week>` row has been written inside `ingest_threshold_minutes`. */
  ingest_stale: boolean
  last_ingest_at: string | null
  ingest_threshold_minutes: number | null
  checked_at: string | null
}

/** What the in-season scoring surfaces read in ONE query: both reasons the scores on screen may be behind. */
export interface LiveScoringFlags extends StatsDegradedFlag {
  stall: ScoringStalledFlag
}

const EMPTY_FLAG: StatsDegradedFlag = {
  degraded: false,
  consecutive_failures: 0,
  last_failure_at: null,
  last_success_at: null,
  last_error: null,
  provider: null,
}

const EMPTY_STALL: ScoringStalledFlag = {
  stalled: false,
  reasons: [],
  rows: 0,
  oldest_enqueued_at: null,
  threshold_minutes: null,
  ingest_stale: false,
  last_ingest_at: null,
  ingest_threshold_minutes: null,
  checked_at: null,
}

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Json | undefined>) : {}
}

function str(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function nonNegativeInt(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** One reading of a stored `stats_degraded` value — malformed reads as the empty flag's field, never as a wrong number. */
function parseStatsDegraded(value: Json | null | undefined): StatsDegradedFlag {
  const v = asRecord(value)
  return {
    degraded: v.degraded === true,
    consecutive_failures: nonNegativeInt(v.consecutive_failures) ?? 0,
    last_failure_at: str(v.last_failure_at),
    last_success_at: str(v.last_success_at),
    last_error: str(v.last_error),
    provider: str(v.provider),
  }
}

/** One reading of a stored `scoring_stalled` value (124). A malformed field reads as the empty flag's, never as a wrong number. */
function parseScoringStalled(value: Json | null | undefined): ScoringStalledFlag {
  const v = asRecord(value)
  return {
    stalled: v.stalled === true,
    reasons: Array.isArray(v.reasons) ? v.reasons.filter((r): r is string => typeof r === 'string') : [],
    rows: nonNegativeInt(v.rows) ?? 0,
    oldest_enqueued_at: str(v.oldest_enqueued_at),
    threshold_minutes: nonNegativeInt(v.threshold_minutes),
    ingest_stale: v.ingest_stale === true,
    last_ingest_at: str(v.last_ingest_at),
    ingest_threshold_minutes: nonNegativeInt(v.ingest_threshold_minutes),
    checked_at: str(v.checked_at),
  }
}

/** The persisted flag, or the empty flag when no row exists yet (a fresh deploy). */
export async function readStatsDegraded(db: FlagsClient): Promise<StatsDegradedFlag> {
  const { data, error } = await db.from('system_flags').select('value').eq('key', STATS_DEGRADED_KEY).maybeSingle()
  if (error) throw new Error(`system_flags read (${STATS_DEGRADED_KEY}): ${error.message}`)
  if (!data) return { ...EMPTY_FLAG }
  return parseStatsDegraded(data.value)
}

/**
 * BOTH reasons the scores on an in-season page may be behind, in ONE round
 * trip (the banner polls this every 60 s — a second query per surface would
 * double that for one boolean):
 *
 *   * `stats_degraded` (122) — the PROVIDER stopped answering;
 *   * `scoring_stalled` (124) — the DRAIN stopped running, which is the
 *     2026-09-10 incident and the one nothing could see.
 *
 * A missing row is the empty flag, not an error — a fresh deploy, or a
 * database that has not yet received 124. A read ERROR still throws: "we
 * could not read whether the scores are behind" is not "they are fine".
 */
export async function readLiveScoringFlags(db: FlagsClient): Promise<LiveScoringFlags> {
  const { data, error } = await db.from('system_flags').select('key, value').in('key', [STATS_DEGRADED_KEY, SCORING_STALLED_KEY])
  if (error) throw new Error(`system_flags read (${STATS_DEGRADED_KEY}, ${SCORING_STALLED_KEY}): ${error.message}`)
  const rows = data ?? []
  const degraded = rows.find((r) => r.key === STATS_DEGRADED_KEY)
  const stalled = rows.find((r) => r.key === SCORING_STALLED_KEY)
  return {
    ...(degraded ? parseStatsDegraded(degraded.value) : { ...EMPTY_FLAG }),
    stall: stalled ? parseScoringStalled(stalled.value) : { ...EMPTY_STALL },
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
