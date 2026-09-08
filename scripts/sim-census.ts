/**
 * sim-census.ts — F199's standing instrument: what a simulator run can leave
 * behind on the shared local stack, counted (M4 task L.D6.1; F199's owner
 * cell is this task).
 *
 *   npx tsx scripts/sim-census.ts        # exit 0 = clean, exit 1 = residue
 *
 * F199's whole species is a fixture row that OUTLIVES its run and then reads
 * as another suite's data:
 *   * the original sighting — `ac-wire` / `at-wire` / `tk-wire` player rows
 *     surviving an aborted run and winning every later "lowest-ADP available"
 *     assertion in OTHER files, deterministically, until hand-deleted;
 *   * the second vector (D317(7)) — ONE resident `nfl_games` row on the
 *     shared synthetic season reddening 8 cells across 4 files, because
 *     `schedule_window_internal` and the Q29 first-week mapping read games by
 *     `(season, week)`, never by league.
 *
 * The durable fix F199 names is "cleanup-FIRST sweeps by id prefix". The
 * simulator has done that since L.B6.1 for leagues and bot users; L.D6.1
 * extended `cleanupSweep` to the in-season tables AND to the three
 * season-scoped surfaces no league delete cascades to — `score_fanout` (PK
 * `(season, week, player_id)`, FK only to `players`, RLS with zero policies:
 * deleting a league leaves its queue rows), `player_stats`, and `nfl_games`
 * by the `simseason-` prefix — plus the `nfl_weeks` bound reset. This script
 * is the same census the run prints before AND after itself, runnable on its
 * own so "is the stack clean?" is a question with an answer.
 *
 * READ-ONLY. It counts and prints; it deletes nothing. Cleaning is
 * `npm run sim -- season …`'s own `finally` (which sweeps first and last), or
 * the seeder's `--teardown` for the dev fixture.
 *
 * LOCAL ONLY — the dev drivers' guard, verbatim. `.env.local` points at
 * hosted PRODUCTION, and counting there would be harmless but meaningless.
 */
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'
import { censusLine, simCensus } from '../src/lib/leagues/sim/runner'

const URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`refusing: ${URL} is not the local stack (this census is LOCAL ONLY)`)
  process.exit(2)
}

async function main(): Promise<void> {
  const service = createClient<Database>(URL, SERVICE_KEY, { auth: { persistSession: false } })
  const census = await simCensus(service)
  console.log(censusLine(census))
  const dirty = census.filter((cell) => cell.count !== 0)
  if (dirty.length === 0) {
    console.log(`SIM CENSUS: CLEAN — 0 × ${census.length}`)
    return
  }
  console.log(`SIM CENSUS: RESIDUE — ${dirty.length} of ${census.length} cells are non-zero:`)
  for (const cell of dirty) console.log(`  ${cell.what} = ${cell.count}`)
  console.log(
    'Sweep it with a run of its own (`npm run sim -- season --leagues 1 --weeks 1`, whose finally sweeps first and last), ' +
      'or `npx tsx scripts/dev-seed-inseason-league.ts --teardown` for the dev fixture.',
  )
  process.exit(1)
}

main().catch((error) => {
  console.error(`sim-census: fatal — ${(error as Error).message}`)
  process.exit(1)
})
