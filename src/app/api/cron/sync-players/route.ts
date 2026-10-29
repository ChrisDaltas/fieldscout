import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { syncPlayers } from '@/lib/sync/players'
import { isCronAuthorized } from '@/lib/auth/cron-secret'

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
 * Status: 200 with the summary; 500 when the sync throws, or when the feed
 * mapped ZERO players — an empty Sleeper answer is a failed fetch, never a
 * quiet day (CLAUDE.md: "nothing happened" is not "it worked").
 */

export const maxDuration = 120

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await syncPlayers(createAdminClient())
    console.log('[sync-players]', JSON.stringify(summary))
    if ((summary.counts.mapped ?? 0) === 0) {
      const error = 'the Sleeper player feed mapped 0 players — nothing written; read as a failed fetch, not a quiet day'
      console.error('[sync-players] FAILURE', error)
      return NextResponse.json({ ...summary, error }, { status: 500 })
    }
    return NextResponse.json(summary, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-players] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
