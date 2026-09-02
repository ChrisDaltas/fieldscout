/**
 * sync:nflverse — the real-calendar back-fill / go-forward sync of
 * `nfl_games` + `nfl_weeks.first_kickoff_at`/`last_game_ends_at` from the
 * nflverse published files (L.D3.1, PROGRESS F11; spec §23.1/§23.3).
 *
 *   npx tsx scripts/sync-nflverse.ts <season> [week]     # week defaults to 1
 *
 * One `ingestWeek` poll with the standalone `NflverseProvider`: the
 * schedule read is season-wide, so ONE run writes every regular-season game
 * carrying a kickoff (diff-aware — a re-run over an unchanged file writes
 * nothing) and maintains the bounds of every calendar week (039's seed).
 * `nflverse` supplies no stat lines, so the poll writes no `player_stats`
 * and enqueues nothing — the report says so. `week` only names the week
 * the poll is FOR (it must exist in `nfl_weeks`, R707) and the week whose
 * official inactives are listed at the end (read-only — no table holds
 * inactives; M5 consumes the feed, C56).
 *
 * Targets whatever `.env.local` names (hosted by default). To run against
 * the local stack, override both variables on the command line:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *     npx tsx scripts/sync-nflverse.ts 2026 1
 *
 * Production's cron binds `withNflverseCalendar(sleeper, nflverse)` instead
 * (L.D2.3 / F216) — this CLI is the ops path for the initial back-fill and
 * for a manual re-sync after a schedule change.
 */
import { DegradationTracker } from '../src/lib/leagues/stats/degradation'
import { NflverseProvider } from '../src/lib/leagues/stats/nflverse/nflverse-provider'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { ingestWeek } from '../src/lib/sync/ingest-week'
import { cliClient, cliSeason, fail } from './_sync-cli'

function weekArg(): number {
  const raw = process.argv[3]
  const week = Number(raw ?? 1)
  if (!Number.isInteger(week) || week < 1 || week > 22) {
    console.error(`Invalid week: ${raw}`)
    process.exit(1)
  }
  return week
}

async function main(): Promise<void> {
  const season = cliSeason()
  const week = weekArg()
  const provider = new NflverseProvider(systemTime)
  const report = await ingestWeek(provider, systemTime, {
    db: cliClient(),
    degradation: new DegradationTracker(),
    season,
    week,
  })
  console.log(JSON.stringify({ ingest: report, nflverse: provider.reports }, null, 2))
  if (!report.ok) {
    console.error(`nflverse poll FAILED: ${report.error}`)
    process.exit(1)
  }

  provider.resetReports()
  const inactives = await provider.getInactives(season, week)
  console.log(
    JSON.stringify(
      {
        inactives: { season, week, games: inactives.length, players: inactives.reduce((n, g) => n + g.playerIds.length, 0) },
        nflverse: provider.reports,
      },
      null,
      2,
    ),
  )
}

main().catch(fail)
