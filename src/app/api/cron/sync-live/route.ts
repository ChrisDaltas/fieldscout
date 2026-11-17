import { NextResponse } from 'next/server'

import { NflverseProvider, withNflverseCalendar } from '@/lib/leagues/stats/nflverse/nflverse-provider'
import { SleeperStatsProvider } from '@/lib/leagues/stats/sleeper-stats-provider'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createTypedAdminClient } from '@/lib/supabase/admin'
import { parseSweepMode, releaseRoundLease, runLivePollInvocation, takeRoundLease } from '@/lib/sync/live-poll'
import { isCronAuthorized } from '@/lib/auth/cron-secret'

/**
 * In-season live ingestion — the production `sync-live-stats` job (spec §14
 * / §23.2 / §23.3). WOKEN BY THE DATABASE since migration 224 (Chris
 * 2026-11-14 — "why are we looking constantly all the time?", "every 30
 * seconds during games", "once a day on none day games", "once the score is
 * final the game is over"): pg_cron's `sync-live-ping` job runs every 30 s
 * and calls `?sweep=none` ONLY while a game window is open
 * (`public.live_game_window_open` — the HOT rule below, in SQL); the
 * `sync-live-sweep` job calls `?sweep=daily` once a day at 11:00Z. Each
 * invocation does ONE round and exits (`runLivePollInvocation`) — no 20 s
 * sleep loop, because a sleeping function is billed for the wait (the Hobby
 * pause of 2026-11-11). No `sweep` parameter = the pre-224 hourly sweep, the
 * fallback while 124's per-minute ping is still the caller (merge deploys
 * before db push). HISTORY: SCHEDULED EVERY MINUTE BY pg_cron + pg_net,
 * migration 124's `sync-live-ping` job (`SELECT public.cron_ping_route('/api/cron/
 * sync-live')`) — Q43 ANSWERED with its option (c). Vercel Hobby refuses
 * any cron finer than daily at deploy time (PROGRESS R884), and the daily
 * stopgap that stood alone turned a 20-minute miss into a day of stale
 * scores (the 2026-09-10 measurement in 124's banner). THE DAILY
 * `vercel.json` ENTRY (`15 8 * * *`) STAYS FOR NOW, deliberately: it is the
 * only cover between this PR's merge and the manual `db push` +
 * `vault.create_secret` steps that bring the pg_cron path up, and running
 * both costs one extra provider read a day — `ingestWeek` enqueues a DIFF,
 * so a redundant poll finds nothing changed and writes nothing. It comes
 * out in a follow-up once Chris confirms the pings are live (PROGRESS
 * F331). The route stays scheduler-agnostic either way: any caller with
 * `CRON_SECRET` once a minute is the production cadence — 124 supplies that
 * caller by reading the secret from Supabase Vault at call time. Rebound by L.D2.3 (PROGRESS F216) from the pre-M4
 * `syncLiveStats` to L.D2.1's `ingestWeek` through `runLivePollInvocation`
 * (`src/lib/sync/live-poll.ts`):
 *
 *   * the provider is bound HERE and only here (D300): the composite
 *     `withNflverseCalendar(sleeper, nflverse)` — nflverse's kickoffs + ids
 *     (the only way `nfl_games` gets a row on the production path, F11 /
 *     D303(3)) with Sleeper's live status, stat lines and injuries;
 *     `player_stats.source` carries `sleeper+nflverse` (F13);
 *   * the week comes from `nfl_weeks` and `nfl_games`, never wall-clock math
 *     or an external "state" call (§23.3 — F216(b)); the plan is HOT
 *     (one poll per wake) while an in-week game is within 15 min of kickoff
 *     or has kicked off and not been OBSERVED final (the window closes on
 *     observation — R711 — and that observing poll is the ONLY writer of
 *     `nfl_weeks.last_game_ends_at`, F238), a SWEEP when the caller's
 *     `sweep` mode says one is due (schedule refresh; also whenever the
 *     season has no game rows at all — F228), IDLE otherwise (no provider
 *     call);
 *   * `stats_degraded` and the per-week last-poll instant persist in
 *     `system_flags` (122 — F217); the worker's orphan escape reads the
 *     latter.
 *
 * Self-gating and cheap when idle: one two-table read, no provider call.
 * `maxDuration` must exceed the invocation budget (pinned in route.test.ts).
 */

// The hard timeout over ONE round. A round is no longer looped, but the daily
// sweep reads several weeks (the current one, the open correction windows,
// TD5's final weeks) and each is a provider read — 60 s keeps the headroom
// the old loop had. Billing follows the time actually used, not this bound.
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sweep = parseSweepMode(new URL(request.url).searchParams.get('sweep'))
  if (sweep === null) {
    return NextResponse.json({ error: 'sweep must be "daily" or "none" (or absent)' }, { status: 400 })
  }


  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

  try {
    const db = createTypedAdminClient()
    // R1823: a game-window round (`none`) takes the round lease first, so two
    // 30-second wakes never overlap. The daily sweep never waits on it — it
    // must not be the round that gets skipped.
    const lease = sweep === 'none' ? await takeRoundLease(db, systemTime) : null
    if (lease?.status === 'held') {
      const skipped = { season, sweep, skipped: 'another game-window round is still running (R1823) — this wake polled nothing; the next one carries on' }
      console.log('[sync-live]', JSON.stringify(skipped))
      return NextResponse.json(skipped)
    }
    if (lease?.status === 'unavailable') console.warn('[sync-live]', lease.reason)
    try {
      // The cron entry point is where real infrastructure is bound to the
      // seam: the sleeper_free tier + nflverse's calendar, and the wall clock
      // (§23.1; D300; F216 as amended by D304).
      const provider = withNflverseCalendar(new SleeperStatsProvider(systemTime), new NflverseProvider(systemTime))
      const report = await runLivePollInvocation({
        db,
        provider,
        time: systemTime,
        season,
        planOptions: { sweep },
      })
      for (const problem of report.problems) console.warn('[sync-live]', problem)
      if (report.flag?.degraded) console.error('[sync-live] ALERT stats_degraded is RAISED (§23.2/E45):', JSON.stringify(report.flag))
      // R1822: a game 8 h past kickoff and still not final no longer holds the
      // game window open — loud on every poll that sees it.
      if (report.stuck_games > 0) {
        console.error(`[sync-live] ALERT ${report.stuck_games} game(s) more than 8 h past kickoff and still not final — no longer polled every 30 s; the daily sweep keeps polling the week (R1822; reconcile names it game_not_final_late)`)
      }
      const summary = {
        season,
        sweep,
        reason: report.reason,
        stuck_games: report.stuck_games,
        rounds: report.rounds.map((r) => ({
          mode: r.plan.mode,
          weeks: r.plan.weeks,
          carried: r.plan.sweepWeeks,
          plan: r.plan.reasons,
          polls: r.polls.map((p) => ({
            week: p.week,
            ok: p.report.ok,
            games: p.report.games,
            weeks: p.report.weeks,
            stats: p.report.stats,
            // M6 L.E2.1: the write path (the 167 door — the only path since F508)
            // and the poll's stat corrections.
            write: p.report.write,
            corrections: p.report.corrections,
            reasons: p.report.reasons,
            degraded: p.flag.degraded,
            consecutive_failures: p.flag.consecutive_failures,
          })),
        })),
        flag: report.flag,
        problems: report.problems,
        started_at: report.started_at,
        finished_at: report.finished_at,
      }
      console.log('[sync-live]', JSON.stringify(summary))
      return NextResponse.json(summary)
    } finally {
      if (lease?.status === 'taken') {
        const failed = await releaseRoundLease(db, systemTime, lease.token)
        if (failed) console.warn('[sync-live]', failed)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-live] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
