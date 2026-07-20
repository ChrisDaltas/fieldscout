import { NextResponse } from 'next/server'

import { SleeperStatsProvider } from '@/lib/leagues/stats/sleeper-stats-provider'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncLiveStats } from '@/lib/sync/live-stats'

/**
 * In-season live box scores (vercel.json: every 10 minutes). Self-gating —
 * outside the regular season or a game window it returns immediately after
 * one cached schedule read, so the frequent cadence is near-free. During
 * games it upserts the current week's Sleeper stats into player_stats
 * (source 'sleeper'), which the app's live/pace surfaces already consume.
 */

export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

  try {
    const currentWeek = await getCurrentNflWeek()
    // The cron entry point is where real infrastructure is bound to the
    // seam: the sleeper_free provider tier and the wall clock (§23.1; L.A0.2b).
    const summary = await syncLiveStats(
      createAdminClient(),
      new SleeperStatsProvider(systemTime),
      season,
      currentWeek,
      systemTime,
    )
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-live] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
