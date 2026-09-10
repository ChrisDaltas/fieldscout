import { NextResponse } from 'next/server'

import {
  runScoreWeekInvocation,
  SCORE_WEEK_BUDGET_MS,
  SCORE_WEEK_LEASE_SECONDS,
} from '@/lib/leagues/scoring/score-week-invoker'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createTypedAdminClient } from '@/lib/supabase/admin'
import { lastPollCompletedAtReader } from '@/lib/sync/ingest-flags'
import { planLivePoll, readCalendar } from '@/lib/sync/live-poll'

/**
 * The `score-league-week` invoker (spec §14 "every 5–10s in game windows" /
 * §22.2 / §22.3). SCHEDULED EVERY MINUTE BY pg_cron + pg_net, migration
 * 124's `score-week-ping` job (the 5 s cadence is still produced INSIDE the
 * invocation by `runScoreWeekInvocation`, L.D2.3 / PROGRESS D322) — Q43
 * ANSWERED with its option (c). Vercel Hobby refuses any cron finer than
 * daily at deploy time (PROGRESS R884), and the daily stopgap left 24
 * enqueued rows undrained for six hours on 2026-09-10 (124's banner). THE
 * DAILY `vercel.json` ENTRY (`30 8 * * *`) STAYS FOR NOW, deliberately: it
 * is the only cover between merge and the manual `db push` +
 * `vault.create_secret` steps, and running both is safe because
 * `score_fanout_claim` leases 120 s >= `maxDuration` 60 + 30 s skew under
 * `FOR UPDATE SKIP LOCKED`, so two concurrent drains claim disjoint sets
 * (pinned in `score-week-worker-db.test.ts:1107`). It comes out in a
 * follow-up once Chris confirms the pings are live (PROGRESS F331). When
 * THIS drain stops, 124's `scoring-stall-check` job raises
 * `system_flags.scoring_stalled` within ten minutes — and when the PING
 * itself dies, its second arm notices that ingestion stopped, which an empty
 * queue could not. The in-season banner says so either way.
 * Scheduler-agnostic:
 * any caller with `CRON_SECRET` once a minute is the production cadence. Drives L.D2.2's `runScoreWeekBatch` with:
 *
 *   * `leaseSeconds = SCORE_WEEK_LEASE_SECONDS` (120) ≥ `maxDuration` (60)
 *     + the clock-skew margin (30) — F263(f)/R874, pinned in route.test.ts:
 *     a live drain is never re-claimed by an overlapping invocation; a
 *     crashed one's rows return after the lease (121);
 *   * the last-poll seam bound to `system_flags` (122 — F263(e)/F217), so
 *     an orphaned queue row (a crash, then an identical re-poll) is released
 *     instead of held forever;
 *   * ALERTS on `lease_lost + gone > 0` (R873), a quarantined league-week
 *     (D292) and `nothing_writable` (F259(e)) — `console.error` with
 *     `league_id`; `all_leased` / `all_deferred` informational (R875/R872).
 *
 * Self-gating: an empty queue outside a game window ends the invocation
 * after one claim RPC. `maxDuration` must exceed the budget (pinned).
 */

// R885 (#268, orchestrator): Next.js's segment-config parser accepts only a LITERAL here —
// `export const maxDuration = SCORE_WEEK_MAX_DURATION_SECONDS` failed `next build` ("Unknown
// identifier … at maxDuration") and therefore the Vercel deploy, while type-check, lint and
// vitest all passed (F271: CI runs no `next build`). The constant stays the single source of
// truth: route.test.ts pins this literal equal to it.
export const maxDuration = 60

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

  try {
    // Inside the try like the other two routes (R883): a missing service-role
    // key surfaces as this route's own `[score-week] failed:` line.
    const db = createTypedAdminClient()
    const report = await runScoreWeekInvocation({
      db,
      time: systemTime,
      sleep,
      lastPollCompletedAt: lastPollCompletedAtReader(db),
      isHot: async () => {
        const calendar = await readCalendar(db, season)
        return planLivePoll(calendar.games, calendar.weeks, systemTime.now()).mode === 'hot'
      },
      budgetMs: SCORE_WEEK_BUDGET_MS,
      leaseSeconds: SCORE_WEEK_LEASE_SECONDS,
    })
    for (const alert of report.alerts) console.error('[score-week] ALERT', alert)
    for (const info of report.infos) console.log('[score-week]', info)
    const summary = {
      season,
      stopped: report.stopped,
      drains: report.drains.map((d) => ({
        ran_at: d.ran_at,
        claimed: d.claimed,
        drained: d.drained,
        not_ready: d.not_ready,
        held: d.held,
        deferred: d.deferred,
        unmapped: d.unmapped,
        written: d.written,
        no_change: d.no_change,
        nothing_writable: d.nothing_writable,
        failed: d.failed,
        ack_missed: d.ack_missed,
        reason: d.reason,
        leagues: d.leagues.map((l) => ({ league_id: l.league_id, week: l.week, outcome: l.outcome, skip_reason: l.skip_reason, error: l.error })),
        problems: d.problems,
      })),
      alerts: report.alerts,
      infos: report.infos,
      started_at: report.started_at,
      finished_at: report.finished_at,
    }
    console.log('[score-week]', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[score-week] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
