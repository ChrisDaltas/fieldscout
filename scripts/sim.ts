/**
 * League Simulator CLI — M2 task L.B6.1 (delivery plan §4.2; tasks-M2 §6
 * L.B6.1 item 2: "scenarios as code").
 *
 *   npm run sim -- draft  --leagues 25 --clock 30 --seed 42
 *   npm run sim -- draft  --leagues 2 --teams 8 --clock 30
 *   npm run sim -- season --leagues 6 --scenario happy_path --weeks 2 --seed 42
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
 * SEASON MODE (M4 task L.D6.1 — tasks-M4-inseason.md §6; delivery plan §4.2):
 * `season` drafts the same matrix, then drives weeks at machine speed through
 * one named §23.6 scenario — the synthetic provider on a step-driven
 * `VirtualClock`, `p_now` injected into all three job RPCs and the scoring
 * worker — and runs the seven in-season invariants. Extra flags:
 *
 *   --scenario ID      one of the nine §23.6 ids (validated against
 *                      `SCENARIO_IDS`, never a hand-listed copy). Default
 *                      happy_path. ONE SCENARIO PER RUN — `nfl_games` has no
 *                      league column, so a slate belongs to the whole run
 *                      (season-runner.ts's SCOPE note); L.D6.3 runs the
 *                      library as nine stages.
 *   --weeks N          how many of each league's planned regular-season weeks
 *                      to drive (1..18; default 2).
 *   --report PATH      also write the whole typed `SeasonRunReport` there as
 *                      pretty JSON, so a gate transcribes evidence from a
 *                      file rather than from scrollback (F135's lesson).
 *                      OPTIONAL: the gate contract is the exit code plus the
 *                      stdout tokens below, exactly as m1/m2/m3 consume.
 *
 * THERE IS NO `--speed` ON THE SEASON COMMAND, deliberately (recorded —
 * PROGRESS D327). Every instant on this path is INJECTED: `p_now` on the
 * jobs, `deps.time` on the worker and ingestion, `time` on the provider. A
 * wall-paced `VirtualClock` (speed > 0) would make the driver WAIT for
 * virtual time it can simply jump to, which contradicts the task row's own
 * words ("drives weeks at machine speed"), and printing a flag the mechanism
 * ignores is worse than not having one. The same `VirtualClock` supports
 * 1×/4×/64× through `setSpeed`, and every instant here already comes from
 * `clock.now()`, so binding it is ADDITIVE when L.D6.4's real-replay gate
 * needs pacing (tasks-M4 §6 L.D6.4).
 *
 * REPLAY, AND EXACTLY WHAT IT REPRODUCES. `RUN ID` is a pure function of the
 * printed inputs (command, scenario, leagues, teams, clock, weeks, seed,
 * season, scenario-library version) — same inputs, same id — and the printed
 * `REPLAY:` line is the command that reproduces the run. What replays: the
 * plan and every persona DECISION, from `--seed` (plan principle 4). What
 * does NOT: per-submit `action_id` nonces, which `sim-rng.ts:14-20` records
 * as per-run BY DESIGN (they are salted with the run tag exactly so a
 * same-seed re-run cannot replay into a previous run's E2 dedupe rows), and
 * race RESOLUTION, which `runner.ts:34-42` already carves out because it is
 * the system under test. The invariant sweep — not a transcript — is the
 * assertion surface, and that is why. The run also prints its BRIDGE MAP
 * (eighteen §23.6 slots → real player ids), because a replay against a
 * different `players` pool is then visible line by line instead of silently
 * different.
 *
 * Requires the LOCAL Supabase stack (`npx supabase start`, migrations
 * applied) and REFUSES any other URL — the dev scripts' guard, verbatim
 * (`dev-seed-inseason-league.ts:84-87`). `.env.local` points at hosted
 * PRODUCTION; a sim run writes leagues, stat rows and queue rows, so the
 * guard is not a nicety. Exits non-zero on ANY invariant failure,
 * provisioning failure, or cleanup failure (loud — the R285 class).
 */
import { writeFileSync } from 'node:fs'

import { PICK_TIMER_SECONDS } from '../src/lib/leagues/settings/league-settings'
import { runDraftSim } from '../src/lib/leagues/sim/runner'
import { runSeasonSim, seasonReportLines } from '../src/lib/leagues/sim/season-runner'
import {
  SCENARIO_IDS,
  type ScenarioId,
} from '../src/lib/leagues/stats/synthetic/scenario'
import { SCENARIO_LIBRARY_VERSION } from '../src/lib/leagues/stats/synthetic/scenarios'
import { hashString } from '../src/lib/leagues/stats/synthetic/prng'
import { SYNTHETIC_SEASON } from '../src/lib/leagues/sim/synthetic-season'
import {
  LEGAL_TEAM_COUNTS,
  type LegalTeamCount,
  type SimDraftType,
} from '../src/lib/leagues/sim/sim-types'

/** Every flag the CLI understands. Anything else `--*` is REFUSED — the
 *  silent-ignore gap tasks-M3 §2 recorded closes here (L.C4.1 item 1): a
 *  typo'd flag must never quietly run the default matrix. */
const DRAFT_FLAGS = new Set([
  'type',
  'leagues',
  'teams',
  'clock',
  'seed',
  'concurrency',
  'verbose',
])
/** The season command's own set — the `draft` path is NOT loosened by it. */
const SEASON_FLAGS = new Set([
  'leagues',
  'teams',
  'clock',
  'seed',
  'concurrency',
  'verbose',
  'scenario',
  'weeks',
  'report',
])
const KNOWN_FLAGS = new Set([...DRAFT_FLAGS, ...SEASON_FLAGS])
const VALUE_FLAGS = new Set([
  'type',
  'leagues',
  'teams',
  'clock',
  'seed',
  'concurrency',
  'scenario',
  'weeks',
  'report',
])

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
// LOCAL ONLY — the dev drivers' guard, verbatim
// (`dev-seed-inseason-league.ts:84-87` / `dev-drive-inseason-week.ts:60-63`).
// A sim run creates leagues and writes `player_stats` / `score_fanout` /
// `nfl_games`; pointed at the hosted project (which is what `.env.local`
// holds) that is production data. This file had no guard before L.D6.1.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(LOCAL_URL)) {
  console.error(`refusing: ${LOCAL_URL} is not the local stack (the simulator is LOCAL ONLY)`)
  process.exit(2)
}
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
  // Flag hygiene FIRST (L.C4.1: unknown flags are refused, never ignored).
  // Also refuses stray positionals beyond the one command word — a value
  // that lost its `--flag` would otherwise vanish the same silent way.
  const positionals: string[] = []
  const usedFlags: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const name = arg.slice(2)
      usedFlags.push(name)
      if (!KNOWN_FLAGS.has(name)) {
        console.error(`Unknown flag --${name} — known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(' ')}`)
        process.exit(2)
      }
      if (VALUE_FLAGS.has(name)) {
        const value = argv[i + 1]
        if (value === undefined || value.startsWith('--')) {
          console.error(`--${name} needs a value`)
          process.exit(2)
        }
        i += 1
      }
    } else {
      positionals.push(arg)
    }
  }
  const command = positionals[0]
  if ((command !== 'draft' && command !== 'season') || positionals.length > 1) {
    console.error(`Unknown sim command '${positionals.join(' ')}' — the commands are: sim draft | sim season`)
    console.error(
      'Usage: npm run sim -- draft [--type snake|auction] --leagues 25 --clock 30 [--teams mixed|8..16] [--seed K]',
    )
    console.error(
      '       npm run sim -- season --leagues 6 --scenario happy_path [--weeks 2] [--teams mixed|8..16] [--seed K] [--report PATH]',
    )
    process.exit(2)
  }
  // Per-command flag hygiene: a flag that belongs to the OTHER command is
  // refused here rather than silently ignored (the L.C4.1 rule, applied per
  // command so the `draft` path is not loosened by the season additions).
  const allowed = command === 'draft' ? DRAFT_FLAGS : SEASON_FLAGS
  for (const name of usedFlags) {
    if (allowed.has(name)) continue
    console.error(
      `--${name} is not a flag of 'sim ${command}' — its flags are: ${[...allowed].map((f) => `--${f}`).join(' ')}`,
    )
    process.exit(2)
  }

  const typeRaw = command === 'season' ? 'snake' : (flagValue(argv, 'type') ?? 'snake')
  if (typeRaw !== 'snake' && typeRaw !== 'auction') {
    console.error(`--type must be 'snake' or 'auction' (got ${typeRaw})`)
    process.exit(2)
  }
  const draftType: SimDraftType = typeRaw

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
  if (draftType === 'auction') {
    // In auction mode --clock is the NOMINATION clock (§7.3.8's
    // `auction_nomination_seconds` band, 10..120); the bid clock is pinned
    // at the catalog max inside the runner (live-cron discipline).
    if (!Number.isInteger(clockSeconds) || clockSeconds < 10 || clockSeconds > 120) {
      console.error(`--clock (auction nomination seconds) must be an integer 10..120 — got ${clockSeconds}`)
      process.exit(2)
    }
  } else if (
    !PICK_TIMER_SECONDS.includes(clockSeconds as (typeof PICK_TIMER_SECONDS)[number]) ||
    clockSeconds === 0
  ) {
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

  if (command === 'season') {
    const scenarioRaw = flagValue(argv, 'scenario') ?? 'happy_path'
    if (!(SCENARIO_IDS as readonly string[]).includes(scenarioRaw)) {
      console.error(`--scenario must be one of ${SCENARIO_IDS.join('|')} (got ${scenarioRaw})`)
      process.exit(2)
    }
    const scenario = scenarioRaw as ScenarioId
    const weeks = Number(flagValue(argv, 'weeks') ?? 2)
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 18) {
      console.error(`--weeks must be an integer 1..18 (got ${flagValue(argv, 'weeks')})`)
      process.exit(2)
    }
    const reportPath = flagValue(argv, 'report')

    // The run id: a pure function of the PRINTED inputs. See the banner for
    // exactly what a replay reproduces (decision streams) and what it does
    // not (per-submit action-id nonces, race resolution).
    const runIdSource =
      `v1|season|scenario=${scenario}|leagues=${leagues}|teams=${teamsRaw}|clock=${clockSeconds}` +
      `|weeks=${weeks}|seed=${seed}|season=${SYNTHETIC_SEASON}|lib=${SCENARIO_LIBRARY_VERSION}`
    const runId = (hashString(runIdSource) >>> 0).toString(16).padStart(8, '0')

    // EXTERNAL CALLS: measured, not stubbed. Every `fetch` this process makes
    // is counted, and any host other than the local stack is a violation
    // (§23.6 "zero external calls"). A stub would also break supabase-js,
    // which is how the sim reaches the stack at all.
    let external = 0
    const realFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = ((input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (!url.startsWith(LOCAL_URL)) external += 1
      return realFetch(input, init)
    }) as typeof globalThis.fetch

    console.log(`SIM SEED: ${seed}`)
    console.log(`RUN ID: ${runId}  (a pure function of: ${runIdSource})`)
    console.log(
      `REPLAY: npm run sim -- season --leagues ${leagues}` +
        `${teams === 'mixed' ? '' : ` --teams ${teams}`} --clock ${clockSeconds} --scenario ${scenario} --weeks ${weeks} --seed ${seed}`,
    )
    console.log(
      '        (replays the plan and every persona DECISION; per-submit action_id nonces and race resolution are ' +
        'per-run BY DESIGN — sim-rng.ts:14-20, runner.ts:34-42)',
    )

    const seasonReport = await runSeasonSim(
      { leagues, teams, clockSeconds, seed, scenario, weeks, concurrency, verbose },
      {
        clock: {
          nowMs: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        runTag,
        runId,
        log: (line) => console.log(line),
        url: LOCAL_URL,
        anonKey: LOCAL_ANON_KEY,
        serviceRoleKey: LOCAL_SERVICE_ROLE_KEY,
        externalCalls: () => external,
      },
    )
    console.log('')
    console.log('BRIDGE (§23.6 slot → real player):')
    for (const line of seasonReport.bridgeLines) console.log(`  ${line}`)
    for (const line of seasonReportLines(seasonReport)) console.log(line)
    if (reportPath !== undefined) {
      writeFileSync(reportPath, `${JSON.stringify(seasonReport, null, 2)}\n`, 'utf8')
      console.log(`REPORT: ${reportPath}`)
    }
    if (!seasonReport.green) process.exit(1)
    return
  }

  const report = await runDraftSim(
    { leagues, teams, clockSeconds, seed, concurrency, verbose, draftType },
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
  if (report.auction !== undefined) {
    const a = report.auction
    console.log(
      `AUCTION: ${a.solvencyChecks} live solvency checks · ${a.instantAwards} §8.6.9 instant awards (nominate-path observed; tick-path instants are invisible to this counter — the deterministic §8.6.9 pin is WORLD E of the DB property suite) · ` +
        `anti-snipe ${a.antiSnipeObserved}/${a.antiSnipeStaged} staged snipes re-floored`,
    )
    console.log(
      `COMMISH: ${a.budgetEditReplaysVerified} E69 idempotent budget-edit replays · ` +
        `${a.refusedEditsVerified} E28 refusals (nothing changed) · ${a.reversalsApplied} won bids reversed`,
    )
    console.log(
      `ILLEGALS REFUSED: ${a.staleBidRefusals} stale-identity bids (F64) · ${a.overMaxRefusals} over-max bids (E5)`,
    )
  }
  if (report.f54Total > 0) {
    // The TRUE total; detail rows are capped in the runner (R288 — the cap
    // must never wear the total's name).
    const capNote =
      report.f54Total > report.f54Incidents.length
        ? ` (evidence detail capped at ${report.f54Incidents.length} rows below)`
        : ''
    console.log(`F54 REPRODUCTIONS: ${report.f54Total}${capNote}`)
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
    // Post-082 wording (R300): the pre-fix hedge ("the interleave window is
    // real but narrow") described the raw delete→insert era — 082's RPC now
    // serializes replaces per seat, so zero is the designed outcome, not luck.
    console.log("F54 REPRODUCTIONS: 0 (082's RPC serializes replaces per seat)")
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
