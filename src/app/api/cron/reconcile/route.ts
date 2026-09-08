import { NextResponse } from 'next/server'

import { reconcileSeason, renderFindings } from '@/lib/leagues/scoring/reconcile'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createTypedAdminClient } from '@/lib/supabase/admin'

/**
 * §23.2's reconciliation job — the cron half (vercel.json: DAILY at 11:15Z,
 * which is after the default correction window closes on Thursdays — 06:00
 * ET is 10:00Z in EDT and 11:00Z in EST — so the Thursday run IS the
 * "at correction-window close" run and every other day is the nightly one;
 * L.D2.3 / PROGRESS D322). Runs `reconcileSeason` (`src/lib/leagues/scoring/
 * reconcile.ts`): recomputes every in-season league-week team score from
 * raw `player_stats` through the frozen snapshot and asserts it matches
 * `matchups` / `team_week_results` (overridden cells excluded), plus the
 * F238 calendar assertions, F263(g)'s "starter in a final game, no line"
 * and D294's pool mirror. DRIFT ⇒ ALERT (`console.error`, one line per
 * finding with `league_id`), NEVER A SILENT FIX — this route writes nothing.
 * The same function is the CLI (`npm run reconcile -- <season>`) the gates
 * invoke.
 */

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

  try {
    const report = await reconcileSeason({ time: systemTime, db: createTypedAdminClient() }, { season })
    for (const line of renderFindings(report)) {
      if (line.startsWith('[ALERT]')) console.error('[reconcile]', line)
      else if (line.startsWith('[WARN]')) console.warn('[reconcile]', line)
      else console.log('[reconcile]', line)
    }
    if (report.reason) console.warn('[reconcile] compared nothing:', report.reason)
    const summary = {
      ran_at: report.ran_at,
      season: report.season,
      leagues: report.leagues,
      league_weeks: report.league_weeks,
      cells: report.cells,
      excluded_overridden: report.excluded_overridden,
      alerts: report.alerts,
      warns: report.warns,
      infos: report.infos,
      counts: report.counts,
      reason: report.reason,
      findings: renderFindings(report),
    }
    console.log('[reconcile]', JSON.stringify({ ...summary, findings: undefined }))
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[reconcile] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
