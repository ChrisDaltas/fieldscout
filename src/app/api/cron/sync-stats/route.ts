import { NextResponse } from 'next/server'

import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAuctionValues } from '@/lib/sync/auction'
import { syncByeWeeks } from '@/lib/sync/bye-weeks'
import { syncPlayers } from '@/lib/sync/players'
import { syncProjections } from '@/lib/sync/projections'
import { syncSos } from '@/lib/sync/sos-sync'
import { syncSplits } from '@/lib/sync/splits-sync'
import type { SyncSummary } from '@/lib/sync/types'
import { syncUsage } from '@/lib/sync/usage'

/**
 * Weekly stats pipeline (vercel.json: Tuesday morning, after MNF settles).
 * Two ordered stages with a parallel middle:
 *   1. players (roster/depth) → projections (+ADP, stat lines)
 *   2. auction + byes + usage + splits — mutually independent, run together
 *   3. SOS last (consumes splits + projections)
 * Usage refreshes last season always and adds the current one once games
 * exist; both live in player_usage side by side.
 */

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const season = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)
  const supabase = createAdminClient()
  const currentWeek = await getCurrentNflWeek()

  const results: SyncSummary[] = []
  const failures: string[] = []

  const attempt = async (name: string, run: () => Promise<SyncSummary>) => {
    try {
      results.push(await run())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sync-stats] ${name} failed:`, message)
      failures.push(`${name}: ${message}`)
      // Keep going — later steps still improve on stale data even if one
      // upstream fetch hiccups.
    }
  }

  // Stage 1 — ordered: everything downstream matches against these writes.
  await attempt('players', () => syncPlayers(supabase))
  await attempt('projections', () => syncProjections(supabase, season))

  // Stage 2 — independent, run together. Usage is per-season in
  // player_usage: last season always, plus the current one once games
  // exist; both coexist and the UI season filter picks.
  await Promise.all([
    attempt('auction', () => syncAuctionValues(supabase, season)),
    attempt('bye-weeks', () => syncByeWeeks(supabase, season)),
    attempt('usage-last', () => syncUsage(supabase, season - 1)),
    ...(currentWeek > 0
      ? [attempt('usage-current', () => syncUsage(supabase, season))]
      : []),
    attempt('splits', () => syncSplits(supabase, season)),
  ])

  // Stage 3 — SOS consumes splits + projections.
  await attempt('sos', () => syncSos(supabase, season))

  const status = failures.length === 0 ? 200 : results.length === 0 ? 500 : 207
  return NextResponse.json({ season, currentWeek, results, failures }, { status })
}
