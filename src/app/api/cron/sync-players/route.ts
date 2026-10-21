import { NextResponse } from 'next/server'

import { systemTime } from '@/lib/leagues/time/time-provider'
import { cancelHealthyIrClaims } from '@/lib/leagues/waivers/healthy-ir-cancel'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPlayers } from '@/lib/sync/players'

/**
 * The DAILY full player sync (PROGRESS D592; spec §14's `sync-players` row) —
 * `vercel.json`, every day at 15:00 UTC (Hobby allows daily crons). The same
 * `syncPlayers` the Tuesday `sync-stats` pipeline runs first: every
 * fantasy-relevant Sleeper player's team, status, injury fields and depth
 * chart. The hourly `sync-weekly-projections` run keeps injury tags fresh for
 * the players its feed carries; this run covers everything else (a team
 * change, a new signing, a player the projection feed leaves out) every day
 * instead of once a week.
 *
 * Right after it, F693 (Chris 2026-10-21: "No, if the player is no longer IR
 * eligible the claims are cancelled."): `cancelHealthyIrClaims` — migration
 * 205's door cancels the pending claims of every team with a player who
 * isn't IR-eligible in an IR spot (idempotent; one notice per team); its
 * report is `healthyIr` in the body and the log.
 *
 * Status: 200 with the summary; 500 when the sync throws, when the feed
 * mapped ZERO players — an empty Sleeper answer is a failed fetch, never a
 * quiet day (CLAUDE.md: "nothing happened" is not "it worked") — or when the
 * cancel failed (named).
 */

export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = createAdminClient()
    const summary = await syncPlayers(db)
    console.log('[sync-players]', JSON.stringify(summary))
    if ((summary.counts.mapped ?? 0) === 0) {
      const error = 'the Sleeper player feed mapped 0 players — nothing written; read as a failed fetch, not a quiet day'
      console.error('[sync-players] FAILURE', error)
      return NextResponse.json({ ...summary, error }, { status: 500 })
    }
    // F693: after the tags are written.
    const healthyIr = await cancelHealthyIrClaims(db, systemTime)
    for (const w of healthyIr.warnings) console.warn('[sync-players]', w)
    for (const f of healthyIr.failures) console.error('[sync-players] FAILURE', f)
    console.log('[sync-players] healthy-IR claim cancel', JSON.stringify({ deployed: healthyIr.deployed, paused: healthyIr.paused, leaguesChecked: healthyIr.leaguesChecked, cancelled: healthyIr.cancelled, notified: healthyIr.notified, leagues: healthyIr.leagues, why: healthyIr.why }))
    if (!healthyIr.ok) {
      return NextResponse.json({ ...summary, healthyIr, error: healthyIr.failures.join('; ') }, { status: 500 })
    }
    return NextResponse.json({ ...summary, healthyIr }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-players] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
