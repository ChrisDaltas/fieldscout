/**
 * sim-census.ts — what a SIMULATOR RUN can leave behind on the shared local
 * stack, counted (M4 task L.D6.1).
 *
 *   npx tsx scripts/sim-census.ts        # exit 0 = clean, exit 1 = residue
 *
 * ── EXACTLY WHAT IT COUNTS (R922 — say the scope, don't imply a wider one) ──
 * The nine cells of `simCensus` (`src/lib/leagues/sim/runner.ts`), all of them
 * matched by the SIM's own name/id prefixes or by the synthetic season:
 *   * `leagues` / `profiles` by the sim's name prefixes;
 *   * `teams` / `matchups` / `team_week_results` under those league ids;
 *   * `nfl_games` with the `simseason-` id prefix, `player_stats` and
 *     `score_fanout` on season 2099, and the two live-updated `nfl_weeks`
 *     bound columns on that season.
 * `cleanupSweep` is the durable fix F199 names ("cleanup-FIRST sweeps by id
 * prefix") applied to that set, and this script is the same census the run
 * prints before AND after itself, runnable on its own.
 *
 * ── WHAT IT DOES **NOT** COUNT, and therefore what CLEAN does not mean ──────
 * F199's own two measured vectors are only PARTLY inside this scope, and the
 * script would print CLEAN with either of them resident:
 *   * the ORIGINAL sighting — `ac-wire` / `at-wire` / `tk-wire` `players`
 *     rows surviving an aborted `npm run test` and winning every later
 *     "lowest-ADP available" assertion in OTHER files until hand-deleted.
 *     There is NO `players` cell here at all, and the sim seeds no players,
 *     so a sim run neither creates nor clears these.
 *   * the RESIDENT dev fixture's half of the second vector (D317(7)) — the
 *     `dev-ld5*` `nfl_games` rows on season 2099 that reddened 8 cells across
 *     4 files. `schedule_window_internal` and the Q29 first-week mapping read
 *     games by `(season, week)`, never by league, so those rows poison other
 *     suites exactly as before; the `nfl_games` cell here is filtered to the
 *     `simseason-` prefix and does not see them.
 * CLEAN therefore means "this sim run left nothing behind", NOT "the stack is
 * clean". The remedies for the other half are `dev-seed-inseason-league.ts
 * --teardown` and a hand-sweep of the wire fixtures; owning them durably is
 * F199's still-open half — the row is re-opened for exactly these two (R922).
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
