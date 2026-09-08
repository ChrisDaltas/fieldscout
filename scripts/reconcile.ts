/**
 * reconcile — §23.2's reconciliation job as a CLI (L.D2.3, PROGRESS D322):
 * the same `reconcileSeason` the daily cron route runs, for an operator, the
 * gates (L.D6.3 / L.D6.4 invoke it by name) and a post-incident check.
 *
 *   npm run reconcile -- <season> [--league <uuid>]...
 *
 * Prints every finding (alerts first) and the counts; EXITS 1 when any
 * ALERT exists (§24.1 "reconciliation drift: 0 cells — page on any"). It
 * never writes anything.
 *
 * Targets whatever `.env.local` names (hosted by default). To run against
 * the local stack, override both variables on the command line:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *     npm run reconcile -- 2026
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import type { Database } from '../src/types/database'
import { reconcileSeason, renderFindings } from '../src/lib/leagues/scoring/reconcile'
import { systemTime } from '../src/lib/leagues/time/time-provider'

config({ path: resolve(process.cwd(), '.env.local') })

function parseArgs(): { season: number; leagueIds: string[] | undefined } {
  const args = process.argv.slice(2)
  const leagueIds: string[] = []
  let season: number | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--league') {
      const id = args[++i]
      if (!id) throw new Error('--league needs a uuid')
      leagueIds.push(id)
    } else if (season === null) {
      season = Number(args[i])
    }
  }
  const resolved = season ?? Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)
  if (!Number.isInteger(resolved) || resolved < 2000 || resolved > 2100) throw new Error(`Invalid season: ${resolved}`)
  return { season: resolved, leagueIds: leagueIds.length > 0 ? leagueIds : undefined }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const { season, leagueIds } = parseArgs()
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  console.log(`reconcile: season ${season} against ${url}${leagueIds ? ` (leagues: ${leagueIds.join(', ')})` : ''}`)
  const report = await reconcileSeason({ time: systemTime, db }, { season, leagueIds })
  for (const line of renderFindings(report)) console.log(line)
  console.log(
    JSON.stringify(
      {
        ran_at: report.ran_at,
        leagues: report.leagues,
        league_weeks: report.league_weeks,
        cells: report.cells,
        excluded_overridden: report.excluded_overridden,
        counts: report.counts,
        alerts: report.alerts,
        warns: report.warns,
        infos: report.infos,
        reason: report.reason,
      },
      null,
      2,
    ),
  )
  if (report.alerts > 0) {
    console.error(`reconcile: ${report.alerts} ALERT(s) — drift is never fixed silently (§23.2); act through the audited paths`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
