/**
 * Sync THIS WEEK's projected stat lines from Sleeper into
 * player_weekly_projections (M6A L.E1.19; migration 136; PROGRESS F379/D373).
 * Production runs the same code hourly via /api/cron/sync-weekly-projections
 * (pg_cron `sync-weekly-projections-ping`).
 *
 *   npx tsx scripts/sync-weekly-projections.ts            # $NEXT_PUBLIC_NFL_SEASON, weeks planned from nfl_weeks at now
 *   npx tsx scripts/sync-weekly-projections.ts 2026       # explicit season, planned weeks
 *   npx tsx scripts/sync-weekly-projections.ts 2026 4 5   # explicit season + week(s)
 *
 * ⚠ `.env.local` points at the HOSTED project. To run against the LOCAL stack,
 * set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and the local
 * SUPABASE_SERVICE_ROLE_KEY in the environment — dotenv never overrides a
 * variable that is already set.
 *
 * Exit 1 on any failure (a zero-projection week, a partial response, a
 * failed write) — never a quiet success.
 */
import { cliClient, cliSeason, fail } from './_sync-cli'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { syncWeeklyProjections } from '../src/lib/sync/weekly-projections'

const weeks = process.argv.slice(3).map((arg) => {
  const n = Number(arg)
  if (!Number.isInteger(n) || n < 1 || n > 25) {
    console.error(`Invalid week: ${arg}`)
    process.exit(1)
  }
  return n
})

syncWeeklyProjections({ db: cliClient(), time: systemTime }, { season: cliSeason(), weeks: weeks.length ? weeks : undefined })
  .then((report) => {
    console.log(`Plan [${report.season}]: ${report.plan.reason}`)
    for (const w of report.weeks) {
      const pos = w.perPosition
        ? Object.entries(w.perPosition).map(([p, c]) => `${p} ${c.projected}/${c.rows}`).join(' ')
        : 'not fetched'
      console.log(
        `  week ${w.week} ${w.ok ? 'OK  ' : 'FAIL'} projected=${w.projected} stored=${w.stored} removed=${w.removed} unknownPlayer=${w.unknown} duplicates=${w.duplicates} [projected/rows: ${pos}]`,
      )
    }
    const counts = Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`Done [${report.name}] ${counts}`)
    for (const w of report.warnings) console.warn(`  warning: ${w}`)
    for (const f of report.failures) console.error(`  FAILURE: ${f}`)
    if (!report.ok) process.exit(1)
  })
  .catch(fail)
