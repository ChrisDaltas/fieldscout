/**
 * `gate-m4-evidence.ts` — the M4 gate's evidence stage (L.D6.3, stage [5/13]).
 *
 * It reads the NINE `sim season --report` JSONs the gate's scenario stages
 * wrote and TRANSCRIBES them: the scenario→assertion map (tasks-M4 §6 L.D6.3
 * item 4, "the scenario→assertion evidence recorded"), the run-wide clauses,
 * the reconciliation summary CLASSIFIED BY REASON, the seating census, the
 * D299 matrix coverage, and the coverage GAPS every run prints.
 *
 * WHY A FILE AND NOT SCROLLBACK. F135's rule binds the whole gate: a
 * full-suite invocation is never piped through a summary-only grep — it is
 * captured and the capture is read. `sim season --report PATH` exists for
 * exactly this, and this stage is the reader.
 *
 * WHY IT RE-DERIVES INSTEAD OF TRUSTING `green`. `report.green` is the run's
 * own verdict and the gate already fails on the run's exit code. This stage
 * asks the question the exit code cannot: *did the run assert what the task
 * row says it must?* A scenario arm that was silently dropped, renamed, or
 * never reached still produces a green run — it just produces one with fewer
 * assertions in it. So the REQUIRED map below is stated here, in this file,
 * and a missing name fails the gate by name. (CLAUDE.md: never let "nothing
 * happened" mean "it worked".)
 *
 * Usage: `npx tsx scripts/gate-m4-evidence.ts .gate-m4/`
 * Exit 0 = every required assertion present and passed; 1 = a named gap.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { SEASON_SCORING_TEMPLATES } from '../src/lib/leagues/sim/plan'
import { SCENARIO_IDS } from '../src/lib/leagues/stats/synthetic/scenario'
import type { SeasonRunReport } from '../src/lib/leagues/sim/sim-types'

/** The gate's own contract with `sim season`: exactly this population. */
const EXPECTED_LEAGUES = 100
const EXPECTED_WEEKS = 2
const EXPECTED_SEED = 42

/**
 * The tasks-M4 §6 L.D6.3 scenario→assertion map (D295), by NAME — the typed
 * union in `sim-types.ts` is the vocabulary and this is the requirement.
 *
 * `scores_written` and `standings_ordered` are required of EVERY scenario:
 * the runner emits them per league before the per-scenario switch, and a
 * scenario stage that produced neither has not scored anything.
 */
const REQUIRED_EVERY: readonly string[] = ['scores_written', 'standings_ordered']
const REQUIRED_BY_SCENARIO: Readonly<Record<string, readonly string[]>> = {
  happy_path: [],
  flex_move: ['lock_moved_with_kickoff'],
  postponement: ['postponed_players_score_zero', 'finalized_without_game', 'locks_released'],
  mass_inactives: ['zeros_flagged'],
  provider_outage: [
    'stats_degraded_raised',
    'stats_degraded_cleared',
    'backfilled',
    'finalization_unaffected',
  ],
  correction_in_window: ['non_final_cells_recomputed'],
  correction_post_window: ['no_league_cell_changed'],
  // F283 / PROGRESS §3 Q44: the task row names `pending_not_zero` (E61) and
  // `recomputed_in_window`. Neither is assertable at league level on this
  // chain without certifying a configuration spec §23.5 forbids, so the two
  // arms assert §23.5's own league-level promise under NEW names and the run
  // prints the gap. The old names stay in the union, unemitted, as the target
  // state — and this map requires the names that ARE emitted, so a silent
  // swap back to the old ones fails here.
  charted_late: ['charted_ingested_no_cell_change'],
  charted_revision: ['charted_revision_recomputed_in_window'],
}

function fail(lines: string[], line: string): void {
  lines.push(line)
}

function main(): void {
  const dir = process.argv[2]
  if (dir === undefined) {
    console.error('usage: npx tsx scripts/gate-m4-evidence.ts <report-dir>')
    process.exit(2)
  }
  const problems: string[] = []
  const reports = new Map<string, SeasonRunReport>()

  for (const scenario of SCENARIO_IDS) {
    const path = join(dir, `${scenario}.json`)
    if (!existsSync(path)) {
      fail(problems, `MISSING REPORT: ${path} — scenario '${scenario}' produced no --report file`)
      continue
    }
    const report = JSON.parse(readFileSync(path, 'utf8')) as SeasonRunReport
    reports.set(scenario, report)
  }

  console.log('======================================================================')
  console.log('  M4 SYNTHETIC EVIDENCE — the nine §23.6 scenarios, transcribed')
  console.log('======================================================================')

  for (const scenario of SCENARIO_IDS) {
    const report = reports.get(scenario)
    if (report === undefined) continue
    console.log('')
    console.log(
      `── ${scenario} — run ${report.runId} · seed ${report.seed} · library v${report.scenarioLibraryVersion} · ` +
        `${report.leagues.length} leagues × ${report.weeksRequested} weeks`,
    )

    // ---- The run's own shape (the gate's contract, not the run's opinion) --
    if (report.scenario !== scenario) {
      fail(problems, `${scenario}: the report names scenario '${report.scenario}'`)
    }
    if (report.leagues.length !== EXPECTED_LEAGUES) {
      fail(problems, `${scenario}: ${report.leagues.length} leagues, the gate runs ${EXPECTED_LEAGUES}`)
    }
    if (report.weeksRequested !== EXPECTED_WEEKS) {
      fail(problems, `${scenario}: ${report.weeksRequested} weeks requested, the gate runs ${EXPECTED_WEEKS}`)
    }
    if (report.seed !== EXPECTED_SEED) {
      fail(problems, `${scenario}: seed ${report.seed}, the gate runs ${EXPECTED_SEED}`)
    }
    if (report.green !== true) fail(problems, `${scenario}: report.green is false`)
    if (report.reason !== null) fail(problems, `${scenario}: reason '${report.reason}'`)
    if (report.invariantFailures.length > 0) {
      fail(problems, `${scenario}: ${report.invariantFailures.length} invariant failure(s)`)
    }
    if (report.problems.length > 0) fail(problems, `${scenario}: ${report.problems.length} problem(s)`)

    // ---- The run-wide clauses of the task row ------------------------------
    console.log(
      `   ZERO REAL DATA: externalCalls ${report.externalCalls} · player_stats ${report.provenance.statRows} ` +
        `rows on season ${report.season} — ${report.provenance.synthetic} source='synthetic', ` +
        `${report.provenance.foreign} foreign (D300/F13)`,
    )
    if (report.externalCalls !== 0) {
      fail(problems, `${scenario}: ${report.externalCalls} external fetch call(s) — the synthetic tier makes none (§23.6)`)
    }
    if (report.provenance.foreign !== 0) {
      fail(problems, `${scenario}: ${report.provenance.foreign} foreign-source stat row(s)`)
    }
    if (report.provenance.statRows === 0) {
      fail(problems, `${scenario}: ZERO player_stats rows written — a run that ingested nothing cannot have scored anything`)
    }

    // ---- Item 2: reconciliation over the whole seeded population -----------
    // The in-run `reconcileSeason` runs over `leagueStates.map(s => s.leagueId)`
    // — every seeded league, at the only moment the population exists (the
    // run's `finally` sweeps it). ALERTS are read by CLASSIFIED REASON, never
    // as a raw total: at this scale `starter_final_game_no_line` alone is
    // thousands, and all of them lawful by construction (F285/Q42).
    console.log(
      `   RECONCILE (in-run, whole seeded population): ${report.reconcileSummary.cells} cells over ` +
        `${report.reconcileSummary.leagues} leagues — ${report.reconcileSummary.alerts} alerts / ` +
        `${report.reconcileSummary.warns} warns / ${report.reconcileSummary.infos} infos`,
    )
    for (const line of report.reconcileClassified) console.log(`     CLASSIFIED LAWFUL · ${line}`)
    if (report.reconcileSummary.leagues !== report.leagues.length) {
      fail(
        problems,
        `${scenario}: reconcile covered ${report.reconcileSummary.leagues} leagues but the run seeded ` +
          `${report.leagues.length} — item 2 requires the WHOLE seeded population`,
      )
    }
    if (report.reconcileSummary.cells === 0) {
      fail(problems, `${scenario}: reconcile examined ZERO cells — an empty pass is not a clean pass`)
    }

    // ---- Seating census (F288) --------------------------------------------
    const emptySlots = report.leagues.reduce((n, l) => n + l.lineupSlotsLeftEmpty, 0)
    const filled = report.leagues.reduce((n, l) => n + l.lineupSlotsFilled, 0)
    const seated = report.leagues.reduce((n, l) => n + l.lineupsSeated, 0)
    const refused = report.leagues.reduce((n, l) => n + l.lineupsRefused, 0)
    const teams = report.leagues.reduce((n, l) => n + l.teamCount, 0)
    const finals = report.leagues.reduce((n, l) => n + l.weeksFinal.length, 0)
    console.log(
      `   SEATING: ${seated}/${teams} week-1 lineups seated · ${refused} refused · ${filled} starting slots ` +
        `filled / ${emptySlots} left empty · ${finals} league-weeks reached 'final'`,
    )
    if (refused !== 0) fail(problems, `${scenario}: ${refused} lineup(s) refused by the server`)
    if (emptySlots !== 0) fail(problems, `${scenario}: ${emptySlots} starting slot(s) left empty (F288)`)
    if (seated !== teams) fail(problems, `${scenario}: ${seated} of ${teams} franchises seated a week-1 lineup`)

    // ---- D299 matrix coverage ---------------------------------------------
    const modes = new Set(report.leagues.map((l) => l.scheduleMode))
    const offLeagues = report.leagues.filter((l) => !l.allowIllegalLineups)
    // READ BACK from `leagues.scoring_system_id` -> `scoring_systems`, not
    // echoed from the plan: `matrixLine` is what the ROW holds.
    const scoringNames = report.leagues.map((l) => {
      const m = /scoring (.+?)(?: \(FORKED §7\.3\.3\.1\))?$/.exec(l.matrixLine)
      return m === null ? '(unparsed)' : m[1]!.trim()
    })
    // A FORKED league's row points at its OWN document, whose name the RPC
    // mints ("<league> Custom") — so shipped-template coverage is counted over
    // the SHIPPED names only, and the fork is counted separately.
    const templates = new Set(scoringNames.filter((n) => SEASON_SCORING_TEMPLATES.includes(n)))
    const forked = report.leagues.filter((l) => l.matrixLine.includes('FORKED')).length
    console.log(
      `   D299 MATRIX: schedule_mode {${[...modes].sort().join(', ')}} · ` +
        `allow_illegal_lineups OFF in ${offLeagues.length} league(s) · ` +
        `${templates.size}/${SEASON_SCORING_TEMPLATES.length} shipped scoring templates ` +
        `{${[...templates].sort().join(', ')}} · ` +
        `${forked} §7.3.3.1 custom-fork league(s)`,
    )
    if (modes.size < 2) fail(problems, `${scenario}: the matrix drew only one schedule_mode`)
    if (offLeagues.length === 0) {
      fail(problems, `${scenario}: no allow_illegal_lineups = false league — §7.3.6 was policed nowhere`)
    }
    for (const off of offLeagues) {
      if (off.lineupsSeated === 0) {
        fail(problems, `${scenario}: the OFF league ${off.leagueLabel} seated NOTHING — decorative coverage (D267/F286)`)
      }
    }
    if (templates.size < SEASON_SCORING_TEMPLATES.length) {
      fail(
        problems,
        `${scenario}: only ${templates.size} of ${SEASON_SCORING_TEMPLATES.length} shipped scoring templates ` +
          `drawn — the D299 parity-template axis wants EVERY one at n >= 8 leagues`,
      )
    }
    if (forked !== 1) {
      fail(problems, `${scenario}: ${forked} custom-fork league(s) — D299's §7.3.3.1 arm wants exactly one`)
    }

    // ---- THE SCENARIO→ASSERTION MAP (task item 4) --------------------------
    const required = new Set([...REQUIRED_EVERY, ...(REQUIRED_BY_SCENARIO[scenario] ?? [])])
    const byName = new Map<string, { pass: number; fail: number; sample: string }>()
    for (const a of report.scenarioEvidence.assertions) {
      const cell = byName.get(a.name) ?? { pass: 0, fail: 0, sample: '' }
      if (a.passed) cell.pass += 1
      else cell.fail += 1
      if (cell.sample === '' || !a.passed) cell.sample = `${a.leagueLabel} w${a.week}: ${a.observed}`
      byName.set(a.name, cell)
    }
    console.log('   ASSERTIONS:')
    for (const [name, cell] of [...byName.entries()].sort()) {
      const mark = cell.fail === 0 ? 'PASS' : 'FAIL'
      const req = required.has(name) ? ' [REQUIRED]' : ''
      console.log(`     [${mark}] ${name} ×${cell.pass + cell.fail}${req} — ${cell.sample}`)
      if (cell.fail > 0) fail(problems, `${scenario}: ${cell.fail} failing '${name}' assertion(s)`)
    }
    for (const name of required) {
      if (!byName.has(name)) {
        fail(
          problems,
          `${scenario}: the D295 map REQUIRES assertion '${name}' and the run emitted none — a dropped or ` +
            `renamed arm produces a green run with fewer assertions in it`,
        )
      }
    }

    // ---- The coverage gaps, printed (never failing) ------------------------
    console.log(`   COVERAGE GAPS (printed, never failing): ${report.coverageGaps.length}`)
    for (const gap of report.coverageGaps) console.log(`     - ${gap}`)

    console.log(`   CENSUS before: ${report.censusBefore}`)
    console.log(`   CENSUS after:  ${report.censusAfter}`)
    if (!report.censusAfter.includes('leagues=0')) {
      fail(problems, `${scenario}: the post-run census is not clean — ${report.censusAfter}`)
    }
  }

  console.log('')
  console.log('======================================================================')
  if (problems.length > 0) {
    console.log(`  M4 SYNTHETIC EVIDENCE — ${problems.length} GAP(S)`)
    console.log('======================================================================')
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log(
    `  M4 SYNTHETIC EVIDENCE — all ${SCENARIO_IDS.length} scenarios green, every D295 assertion present`,
  )
  console.log('======================================================================')
}

main()
