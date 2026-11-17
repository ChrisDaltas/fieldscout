import { NextResponse } from 'next/server'

import { runLeaguePlayerValues } from '@/lib/leagues/scoring/player-values-job'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCronAuthorized } from '@/lib/auth/cron-secret'

/**
 * League-scored player values for autopilot (M6A L.E1.20; migration 137;
 * PROGRESS F379 / D374; spec §14's `league-player-values` row). SCHEDULED
 * ONCE A DAY at 12:50Z by pg_cron + pg_net — `league-player-values-ping`
 * (137; daily since 225 — Chris 2026-11-17: "yes move those to once a day
 * too") (`SELECT public.cron_ping_route('/api/cron/league-player-values')`),
 * 124's vehicle, ten minutes after the projections sync — and again about
 * 50 minutes before each kickoff, ten minutes after the pre-kickoff
 * projections run (225's `pregame-refresh-ping` → `cron_wake_pregame_refresh`). No `vercel.json`
 * entry: Hobby allows daily crons only, and the table this writes arrives
 * with the same `db push` as the job.
 *
 * Values every rostered player of every in_season / playoffs league for the
 * current + next calendar week (from `nfl_weeks` at the injected instant,
 * §23.3) through the canonical scorer under each league's frozen snapshot.
 * Status: 200 when every league-week landed (or the season is over / no
 * league is in season — named in the body), 500 otherwise, with every
 * failure named in the body and the log.
 */

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)
  try {
    // The cron entry point binds real infrastructure: the wall clock (D3).
    const report = await runLeaguePlayerValues({ db: createAdminClient(), time: systemTime }, { season })
    for (const w of report.warnings) console.warn('[league-player-values]', w)
    for (const f of report.failures) console.error('[league-player-values] FAILURE', f)
    console.log('[league-player-values]', JSON.stringify({ season, plan: report.plan, counts: report.counts, ok: report.ok }))
    return NextResponse.json(report, { status: report.ok ? 200 : 500 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[league-player-values] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
