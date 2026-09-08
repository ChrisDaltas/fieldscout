/**
 * score-week-invoker — the production `score-league-week` invocation (task
 * L.D2.3; spec §14 "every 5–10s in game windows" / §22.2 / §22.3 / §24.1;
 * PROGRESS D322; honours F263(f) — the lease outlives the invoker — and
 * binds F263(e)'s last-poll seam; R873/R874/R875 as LAW: alert on
 * `lease_lost + gone > 0`, the lease ≥ `maxDuration` + a clock-skew
 * margin (pinned in the route's test), `all_leased` informational).
 *
 * WHAT ONE INVOCATION DOES (the scheduler fires it every minute — BUILT and
 * UNSCHEDULED until PROGRESS Q43 picks the scheduler, R884: Vercel Hobby
 * refuses a per-minute cron at deploy time; the 5–10 s cadence §14 asks for
 * is produced INSIDE the invocation):
 *
 *   1. DRAIN — `runScoreWeekBatch(deps, { batchSize, leaseSeconds,
 *      deferSeconds })` (L.D2.2's worker, untouched) with the last-poll
 *      seam bound to `system_flags` (122 — `lastPollCompletedAtReader`).
 *   2. READ THE REPORT — the loud surface (D321(6)):
 *        * ALERT (`console.error`, an operator pages on it — §24.1 "job
 *          failures: any"): `ack_missed.lease_lost + ack_missed.gone > 0`
 *          (the one window a STALE write can land in — R873); `failed > 0`
 *          (a quarantined league-week, D292); `nothing_writable > 0` (the
 *          door wrote nothing where the worker expected to — F259(e)).
 *        * INFO (`console.log`): `all_leased` / `all_deferred` (another
 *          drain in flight — R875; a hold — R872), `no_change`, held rows.
 *      Every line carries `league_id` where one applies (plan §2.3's
 *      structured-log duty).
 *   3. REPEAT while the budget allows: immediately when the claim came back
 *      FULL (`more`), else after `DRAIN_INTERVAL_MS`; STOP early when the
 *      queue is empty AND no game window is hot (the same table-derived
 *      plan `sync-live` uses — `planLivePoll`), so an idle season costs one
 *      claim RPC per minute, not twelve.
 *
 * THE LEASE PRECONDITION (F263(f), R866/R874): `SCORE_WEEK_LEASE_SECONDS`
 * must be ≥ the route's `maxDuration` + `CLOCK_SKEW_SECONDS`. A drain that
 * outlives its lease is re-claimable while alive and its late write is
 * stale for that row; the route's hard timeout bounds every drain it
 * starts, so a lease longer than the timeout plus the skew two instances'
 * clocks can show each other (the claim compares B's `p_now` with A's
 * `claimed_at`) means a LIVE drain is never re-claimed. The route's test
 * pins the inequality against the exported `maxDuration`.
 *
 * Time only via `time` (the D3 fence covers this file); `sleep` injected;
 * the drain and the hot predicate injectable for the loop's tests.
 */

import type { TimeProvider } from '../time/time-provider'
import { type BatchReport, runScoreWeekBatch, type ScoreWorkerClient } from './score-week-worker'

// ── Constants (the route pins them beside `maxDuration`) ───────────────────

/** Vercel `maxDuration` the route exports — the hard timeout every drain runs under. */
export const SCORE_WEEK_MAX_DURATION_SECONDS = 60
/** Two instances' clocks compared (B's p_now vs A's claimed_at) — the margin R874 asks for. */
export const CLOCK_SKEW_SECONDS = 30
/** ≥ maxDuration + skew (F263(f)/R874) — pinned by `route.test.ts`. */
export const SCORE_WEEK_LEASE_SECONDS = 120
/** The in-window drain cadence (§14: 5–10 s). */
export const DRAIN_INTERVAL_MS = 5_000
/** The invocation's own budget; the route's `maxDuration` must exceed it. */
export const SCORE_WEEK_BUDGET_MS = 50_000
export const SCORE_WEEK_BATCH_SIZE = 500
export const SCORE_WEEK_DEFER_SECONDS = 30

// ── Reading a report (pure) ────────────────────────────────────────────────

export interface DrainVerdict {
  alerts: string[]
  infos: string[]
}

/** The loud surface, classified (R873 / R875 / F259(e) / D292). */
export function classifyDrain(report: BatchReport): DrainVerdict {
  const alerts: string[] = []
  const infos: string[] = []
  const stale = report.ack_missed.lease_lost + report.ack_missed.gone
  if (stale > 0) {
    alerts.push(
      `STALE-WRITE WINDOW: lease_lost ${report.ack_missed.lease_lost} + gone ${report.ack_missed.gone} = ${stale} row(s) re-claimed by another drain while this one was in flight (F263(f)/R873) — the drain outlived its lease; raise SCORE_WEEK_LEASE_SECONDS or cut the batch`,
    )
  }
  for (const entry of report.leagues) {
    if (entry.outcome === 'failed') {
      alerts.push(`league_id=${entry.league_id} week=${entry.week} QUARANTINED: ${entry.error ?? 'unknown'} (D292 — nothing written for it)`)
    } else if (entry.outcome === 'nothing_writable') {
      alerts.push(`league_id=${entry.league_id} week=${entry.week} the door wrote NOTHING where a score was expected (F259(e))`)
    } else if (entry.outcome === 'held') {
      infos.push(`league_id=${entry.league_id} week=${entry.week} held: ${entry.skip_reason}`)
    } else if (entry.outcome === 'skipped' && entry.skip_reason) {
      infos.push(`league_id=${entry.league_id} week=${entry.week} skipped: ${entry.skip_reason}`)
    }
  }
  if (report.reason === 'all_leased' || report.reason === 'all_deferred') {
    infos.push(`drain claimed nothing: ${report.reason} (R875 — informational)`)
  }
  if (report.ack_missed.restamped > 0) {
    infos.push(`${report.ack_missed.restamped} row(s) re-stamped mid-drain — released; the next drain scores the newer line (D321(2))`)
  }
  if (report.deferred > 0) infos.push(`${report.deferred} held row(s) deferred (R872)`)
  return { alerts, infos }
}

// ── The invocation ─────────────────────────────────────────────────────────

export interface ScoreWeekInvokerDeps {
  db: ScoreWorkerClient
  time: TimeProvider
  sleep: (ms: number) => Promise<void>
  /** F263(e): the persisted last-poll surface (122) — `lastPollCompletedAtReader(db)` in production. */
  lastPollCompletedAt: (season: number, week: number) => Promise<string | null>
  /** Is a game window open? (`planLivePoll(...).mode === 'hot'` in production.) Decides whether an empty queue ends the invocation. */
  isHot: () => Promise<boolean>
  budgetMs?: number
  /** Injectable for the loop's tests; production passes nothing (runScoreWeekBatch). */
  drain?: typeof runScoreWeekBatch
  leaseSeconds?: number
  batchSize?: number
  deferSeconds?: number
}

export interface ScoreWeekInvocationReport {
  started_at: string
  finished_at: string
  drains: BatchReport[]
  alerts: string[]
  infos: string[]
  /** Why the invocation stopped. */
  stopped: 'budget' | 'queue_empty_idle' | null
}

export async function runScoreWeekInvocation(deps: ScoreWeekInvokerDeps): Promise<ScoreWeekInvocationReport> {
  const budgetMs = deps.budgetMs ?? SCORE_WEEK_BUDGET_MS
  const drain = deps.drain ?? runScoreWeekBatch
  const leaseSeconds = deps.leaseSeconds ?? SCORE_WEEK_LEASE_SECONDS
  const startedMs = deps.time.now().getTime()
  const report: ScoreWeekInvocationReport = {
    started_at: new Date(startedMs).toISOString(),
    finished_at: new Date(startedMs).toISOString(),
    drains: [],
    alerts: [],
    infos: [],
    stopped: null,
  }

  for (;;) {
    const batch = await drain(
      { time: deps.time, db: deps.db, lastPollCompletedAt: deps.lastPollCompletedAt },
      { batchSize: deps.batchSize ?? SCORE_WEEK_BATCH_SIZE, leaseSeconds, deferSeconds: deps.deferSeconds ?? SCORE_WEEK_DEFER_SECONDS },
    )
    report.drains.push(batch)
    const verdict = classifyDrain(batch)
    report.alerts.push(...verdict.alerts)
    report.infos.push(...verdict.infos)

    if (batch.reason === 'queue_empty' && !(await deps.isHot())) {
      report.stopped = 'queue_empty_idle'
      break
    }
    const waitMs = batch.more ? 0 : DRAIN_INTERVAL_MS
    const elapsed = deps.time.now().getTime() - startedMs
    if (elapsed + waitMs + DRAIN_INTERVAL_MS > budgetMs) {
      report.stopped = 'budget'
      break
    }
    if (waitMs > 0) await deps.sleep(waitMs)
  }

  report.finished_at = deps.time.now().toISOString()
  return report
}
