import { NextResponse } from 'next/server'

import { systemTime } from '@/lib/leagues/time/time-provider'
import { cancelHealthyIrClaims } from '@/lib/leagues/waivers/healthy-ir-cancel'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncWeeklyProjections } from '@/lib/sync/weekly-projections'

/**
 * THIS WEEK's projected stat lines (M6A L.E1.19; migration 136; PROGRESS
 * F379 / D373; spec §14's `sync-weekly-projections` row). SCHEDULED HOURLY
 * at :40 by pg_cron + pg_net — migration 136's `sync-weekly-projections-ping`
 * (`SELECT public.cron_ping_route('/api/cron/sync-weekly-projections')`),
 * 124's vehicle. No `vercel.json` entry: Hobby allows daily crons only, and
 * the table this writes arrives with the same `db push` as the job.
 *
 * Plans the current + next calendar week from `nfl_weeks` at the injected
 * instant (§23.3), fetches Sleeper's weekly projections, and refuses to call
 * a zero-projection or partial week a success. The same run keeps
 * `players`' injury tags fresh from the feed's `player.injury_*` (PROGRESS
 * D592 — the Tuesday player sync alone left a cleared player tagged all
 * week); every change is in `injuryChanges` and the counts. Right after it,
 * F693 (Chris 2026-10-21: "No, if the player is no longer IR eligible the
 * claims are cancelled."): `cancelHealthyIrClaims` — migration 205's door
 * cancels the pending claims of every team with a player who isn't
 * IR-eligible in an IR spot, as soon as we know (idempotent; one notice per
 * team); its report is `healthyIr` in the body and the log. Status: 200 when
 * every planned week landed (or the season is over — named in
 * `plan.reason`) and the cancel answered, 500 otherwise, with every failure
 * named in the body and the log.
 */

export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)
  try {
    // The cron entry point binds real infrastructure: the wall clock (D3)
    // and the plain Sleeper fetch (the module's default).
    const db = createAdminClient()
    const report = await syncWeeklyProjections({ db, time: systemTime }, { season })
    // F693: after the injury tags are written, whatever the projections did.
    const healthyIr = await cancelHealthyIrClaims(db, systemTime)
    for (const w of [...report.warnings, ...healthyIr.warnings]) console.warn('[sync-weekly-projections]', w)
    for (const f of [...report.failures, ...healthyIr.failures]) console.error('[sync-weekly-projections] FAILURE', f)
    const ok = report.ok && healthyIr.ok
    console.log(
      '[sync-weekly-projections]',
      JSON.stringify({
        season,
        plan: report.plan,
        counts: report.counts,
        injuryChanges: report.injuryChanges,
        healthyIr: { deployed: healthyIr.deployed, paused: healthyIr.paused, leaguesChecked: healthyIr.leaguesChecked, cancelled: healthyIr.cancelled, notified: healthyIr.notified, leagues: healthyIr.leagues, why: healthyIr.why },
        ok,
      }),
    )
    return NextResponse.json({ ...report, healthyIr, ok }, { status: ok ? 200 : 500 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-weekly-projections] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
