import { NextResponse } from 'next/server'

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
    const summary = await syncLiveStats(createAdminClient(), season, currentWeek)
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-live] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
