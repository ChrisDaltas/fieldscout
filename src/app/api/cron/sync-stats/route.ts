import { NextResponse } from 'next/server'

import { getCurrentNflWeek } from '@/lib/sports-data/nfl-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncByeWeeks } from '@/lib/sync/bye-weeks'
import { syncPlayers } from '@/lib/sync/players'
import { syncProjections } from '@/lib/sync/projections'
import { syncSos } from '@/lib/sync/sos-sync'
import { syncSplits } from '@/lib/sync/splits-sync'
import type { SyncSummary } from '@/lib/sync/types'
import { syncUsage } from '@/lib/sync/usage'

/**
 * Weekly stats pipeline (vercel.json: Tuesday morning, after MNF settles).
 * Order matters — later steps consume earlier steps' writes:
 *   players (roster/depth) → projections (+ADP, stat lines) → byes →
 *   usage (snap % / target share) → splits (positional matchups) → SOS.
 * Usage reads last season pre-draft and the current season once games exist.
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
  const usageSeason = currentWeek > 0 ? season : season - 1

  const results: SyncSummary[] = []
  const failures: string[] = []
  const steps: Array<[string, () => Promise<SyncSummary>]> = [
    ['players', () => syncPlayers(supabase)],
    ['projections', () => syncProjections(supabase, season)],
    ['bye-weeks', () => syncByeWeeks(supabase, season)],
    ['usage', () => syncUsage(supabase, usageSeason)],
    ['splits', () => syncSplits(supabase, season)],
    ['sos', () => syncSos(supabase, season)],
  ]

  for (const [name, run] of steps) {
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

  const status = failures.length === 0 ? 200 : results.length === 0 ? 500 : 207
  return NextResponse.json({ season, currentWeek, results, failures }, { status })
}
