import { NextResponse } from 'next/server'

import { systemTime } from '@/lib/leagues/time/time-provider'
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
 * a zero-projection or partial week a success. Status: 200 when every
 * planned week landed (or the season is over — named in `plan.reason`), 500
 * otherwise, with every failure named in the body and the log.
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
    const report = await syncWeeklyProjections({ db: createAdminClient(), time: systemTime }, { season })
    for (const w of report.warnings) console.warn('[sync-weekly-projections]', w)
    for (const f of report.failures) console.error('[sync-weekly-projections] FAILURE', f)
    console.log('[sync-weekly-projections]', JSON.stringify({ season, plan: report.plan, counts: report.counts, ok: report.ok }))
    return NextResponse.json(report, { status: report.ok ? 200 : 500 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-weekly-projections] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
