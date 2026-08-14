/**
 * League Simulator CLI — M2 task L.B6.1 (delivery plan §4.2; tasks-M2 §6
 * L.B6.1 item 2: "scenarios as code").
 *
 *   npm run sim -- draft --leagues 25 --clock 30 --seed 42
 *   npm run sim -- draft --leagues 2 --teams 8 --clock 30
 *
 * THIS FILE IS THE INJECTION BOUNDARY (deliberately outside the
 * `src/lib/leagues/**` determinism guard): wall time, timers, and the
 * fallback seed enter here and NOWHERE else — everything under
 * `src/lib/leagues/sim/` is pure orchestration over the injected clock and
 * seeded streams. Every run PRINTS ITS SEED; `--seed K` replays the plan
 * and every persona decision exactly (plan principle 4).
 *
 * Flags:
 *   --leagues N        number of concurrent leagues (default 25)
 *   --teams X          fixed size 8|10|12|14|16, or 'mixed' (default) —
 *                      mixed guarantees ≥1 sixteen-team league
 *   --clock S          pick clock seconds; must be a §7.3.8 catalog value
 *                      (30|45|60|90|120|...; default 30 — short clocks +
 *                      service-role rewinds keep wall-clock sane)
 *   --seed K           replay seed (default: derived from wall clock HERE)
 *   --concurrency W    global HTTP semaphore width (default 16 — recorded
 *                      pacing choice, the D118(9) polite-neighbor rule)
 *   --verbose          per-league progress lines
 *
 * Requires the LOCAL Supabase stack (`npx supabase start`, migrations
 * applied). Exits non-zero on ANY invariant failure, provisioning failure,
 * or cleanup failure (loud — the R285 class).
 */
import { PICK_TIMER_SECONDS } from '../src/lib/leagues/settings/league-settings'
import { runDraftSim } from '../src/lib/leagues/sim/runner'
import { LEGAL_TEAM_COUNTS, type LegalTeamCount } from '../src/lib/leagues/sim/sim-types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv.find((a) => !a.startsWith('--'))
  if (command !== 'draft') {
    console.error(`Unknown sim command '${command ?? ''}' — the M2 scenario is: sim draft`)
    console.error('Usage: npm run sim -- draft --leagues 25 --clock 30 [--teams mixed|8..16] [--seed K]')
    process.exit(2)
  }

  const leagues = Number(flagValue(argv, 'leagues') ?? 25)
  if (!Number.isInteger(leagues) || leagues < 1 || leagues > 100) {
    console.error(`--leagues must be an integer 1..100 (got ${flagValue(argv, 'leagues')})`)
    process.exit(2)
  }
  const teamsRaw = flagValue(argv, 'teams') ?? 'mixed'
  const teams: LegalTeamCount | 'mixed' =
    teamsRaw === 'mixed' ? 'mixed' : (Number(teamsRaw) as LegalTeamCount)
  if (teams !== 'mixed' && !LEGAL_TEAM_COUNTS.includes(teams)) {
    console.error(`--teams must be one of ${LEGAL_TEAM_COUNTS.join('|')} or 'mixed' (got ${teamsRaw})`)
    process.exit(2)
  }
  const clockSeconds = Number(flagValue(argv, 'clock') ?? 30)
  if (!PICK_TIMER_SECONDS.includes(clockSeconds as (typeof PICK_TIMER_SECONDS)[number]) || clockSeconds === 0) {
    console.error(
      `--clock must be a non-zero §7.3.8 catalog value (${PICK_TIMER_SECONDS.filter((s) => s > 0).join('|')}) — got ${clockSeconds}`,
    )
    process.exit(2)
  }
  // The ONE ambient-entropy read of the sim (boundary-only): the fallback
  // seed and the per-run tag.
  const seed = Number(flagValue(argv, 'seed') ?? Date.now() % 2_147_483_647)
  if (!Number.isInteger(seed)) {
    console.error(`--seed must be an integer (got ${flagValue(argv, 'seed')})`)
    process.exit(2)
  }
  const concurrency = Number(flagValue(argv, 'concurrency') ?? 16)
  const verbose = argv.includes('--verbose')
  const runTag = Date.now().toString(36)

  const report = await runDraftSim(
    { leagues, teams, clockSeconds, seed, concurrency, verbose },
    {
      clock: {
        nowMs: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      runTag,
      log: (line) => console.log(line),
      url: LOCAL_URL,
      anonKey: LOCAL_ANON_KEY,
      serviceRoleKey: LOCAL_SERVICE_ROLE_KEY,
    },
  )

  console.log('')
  console.log('================ SIM RESULT ================')
  console.log(`SEED: ${report.seed}`)
  const totalPicks = report.leagues.reduce((sum, l) => sum + l.totalPicks, 0)
  console.log(
    `LEAGUES: ${report.leagues.length}/${leagues} completed provisioning+draft · ${totalPicks} total picks`,
  )
  console.log(
    `CHAOS: ${report.replayVerified} E2 double-tap replays verified identical · ${report.expectedRefusals} expected refusals (E1/wrong-turn)`,
  )
  if (report.f54Incidents.length > 0) {
    console.log(`F54 REPRODUCTIONS: ${report.f54Incidents.length}`)
    for (const inc of report.f54Incidents) {
      console.log(
        `  ${inc.leagueLabel} draft=${inc.draftId} seat=${inc.teamId} duplicate ranks [${inc.duplicateRanks.join(', ')}]`,
      )
      console.log(`    submitted A: [${inc.submittedA.join(', ')}]`)
      console.log(`    submitted B: [${inc.submittedB.join(', ')}]`)
      console.log(
        `    settled rows: ${inc.rows.map((r) => `${r.rank}:${r.player_id}`).join(' · ')}`,
      )
    }
  } else {
    console.log('F54 REPRODUCTIONS: none this run (the interleave window is real but narrow)')
  }
  if (report.workerErrors.length > 0) {
    console.log(`WORKER ERRORS (${report.workerErrors.length}):`)
    for (const err of report.workerErrors.slice(0, 10)) console.log(`  ${err}`)
  }
  console.log(report.cleanupSummary)
  if (report.invariantFailures.length === 0) {
    console.log(`INVARIANT SWEEP: 0 failures across ${report.leagues.length} drafts`)
    console.log('RESULT: GREEN')
  } else {
    console.log(`INVARIANT SWEEP: ${report.invariantFailures.length} FAILURES`)
    for (const f of report.invariantFailures) {
      console.log(`  [${f.invariant}] ${f.leagueLabel} (draft ${f.draftId}): ${f.detail}`)
    }
    console.log('RESULT: RED')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`sim: fatal — ${(error as Error).message}`)
  process.exit(1)
})
