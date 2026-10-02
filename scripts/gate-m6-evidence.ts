/**
 * `gate-m6-evidence.ts` — the M6 gate's sim evidence stage (L.E1.37, [4.2]).
 *
 * Reads the two `sim season --report` JSONs the M6 gate's correction stages
 * wrote (`correction_in_window.json`, `correction_post_window.json`) and
 * asks what the exit code cannot: did each run assert what tasks-M6 §6
 * L.E1.37 says it must?
 *   - the correction scenario's own arms, BY NAME (L.E2.6 — D468):
 *       correction_in_window   → non_final_cells_recomputed + correction_recorded_in_window
 *       correction_post_window → no_league_cell_changed + correction_research_only_after_lock
 *     plus `scores_written` / `standings_ordered` (every scenario);
 *   - ONE lawful commissioner override per run (D345 / L.E1.14 — F373's
 *     licence unchanged: the correction RECORDS TD6 writes are not
 *     overrides, and are never counted as one here);
 *   - zero real data (externalCalls 0, no foreign stat rows), no problem,
 *     no invariant failure, no worker error, a clean post-run census.
 * A missing name fails by name (the R951 posture of gate-m4-evidence).
 *
 * Usage: `npx tsx scripts/gate-m6-evidence.ts .gate-m6/`
 * Exit 0 = every required assertion present and passed; 1 = a named gap.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SeasonRunReport } from '../src/lib/leagues/sim/sim-types'

const EXPECTED_LEAGUES = 24
const EXPECTED_WEEKS = 2
const EXPECTED_SEED = 42

const REQUIRED_EVERY = ['scores_written', 'standings_ordered'] as const
const REQUIRED: Readonly<Record<string, readonly string[]>> = {
  correction_in_window: ['non_final_cells_recomputed', 'correction_recorded_in_window'],
  correction_post_window: ['no_league_cell_changed', 'correction_research_only_after_lock'],
}

function main(): void {
  const dir = process.argv[2]
  if (dir === undefined) {
    console.error('usage: npx tsx scripts/gate-m6-evidence.ts <report-dir>')
    process.exit(2)
  }
  const problems: string[] = []
  console.log('======================================================================')
  console.log('  M6 SIM EVIDENCE — the correction scenarios + one override per run')
  console.log('======================================================================')

  for (const [scenario, arms] of Object.entries(REQUIRED)) {
    const path = join(dir, `${scenario}.json`)
    if (!existsSync(path)) {
      problems.push(`MISSING REPORT: ${path}`)
      continue
    }
    const r = JSON.parse(readFileSync(path, 'utf8')) as SeasonRunReport
    console.log('')
    console.log(`── ${scenario} — run ${r.runId} · seed ${r.seed} · ${r.leagues.length} leagues × ${r.weeksRequested} weeks`)
    if (r.scenario !== scenario) problems.push(`${scenario}: the report names scenario '${r.scenario}'`)
    if (r.leagues.length !== EXPECTED_LEAGUES) problems.push(`${scenario}: ${r.leagues.length} leagues, the gate runs ${EXPECTED_LEAGUES}`)
    if (r.weeksRequested !== EXPECTED_WEEKS) problems.push(`${scenario}: ${r.weeksRequested} weeks, the gate runs ${EXPECTED_WEEKS}`)
    if (r.seed !== EXPECTED_SEED) problems.push(`${scenario}: seed ${r.seed}, the gate runs ${EXPECTED_SEED}`)
    if (r.green !== true) problems.push(`${scenario}: report.green is false`)
    if (r.reason !== null) problems.push(`${scenario}: reason '${r.reason}'`)
    if (r.invariantFailures.length > 0) problems.push(`${scenario}: ${r.invariantFailures.length} invariant failure(s)`)
    if (r.problems.length > 0) problems.push(`${scenario}: ${r.problems.length} problem(s) — first: ${r.problems[0]}`)
    if (r.workerErrors.length > 0) problems.push(`${scenario}: ${r.workerErrors.length} worker error(s) — first: ${r.workerErrors[0]}`)
    if (r.externalCalls !== 0) problems.push(`${scenario}: ${r.externalCalls} external fetch call(s)`)
    if (r.provenance.foreign !== 0) problems.push(`${scenario}: ${r.provenance.foreign} foreign-source stat row(s)`)
    if (r.provenance.statRows === 0) problems.push(`${scenario}: ZERO player_stats rows written`)
    console.log(`   ZERO REAL DATA: externalCalls ${r.externalCalls} · ${r.provenance.statRows} stat rows, ${r.provenance.foreign} foreign`)

    const o = r.lawfulOverride
    console.log(`   COMMISSIONER OVERRIDE (D345, one per run): ${o === null || o === undefined ? 'NONE' : `${o.leagueLabel} w${o.week} — receipt ${o.commissionerActionId} — ${o.detail}`}`)
    if (o === null || o === undefined) problems.push(`${scenario}: no lawful commissioner override was injected`)

    const byName = new Map<string, { pass: number; fail: number; sample: string }>()
    for (const a of r.scenarioEvidence.assertions) {
      const cell = byName.get(a.name) ?? { pass: 0, fail: 0, sample: '' }
      if (a.passed) cell.pass += 1
      else cell.fail += 1
      if (cell.sample === '' || !a.passed) cell.sample = `${a.leagueLabel} w${a.week}: ${a.observed}`
      byName.set(a.name, cell)
    }
    const required = new Set<string>([...REQUIRED_EVERY, ...arms])
    console.log('   ASSERTIONS:')
    for (const [name, cell] of [...byName.entries()].sort()) {
      const req = required.has(name) ? ' [REQUIRED]' : ''
      console.log(`     [${cell.fail === 0 ? 'PASS' : 'FAIL'}] ${name} ×${cell.pass + cell.fail}${req} — ${cell.sample}`)
      if (cell.fail > 0) problems.push(`${scenario}: ${cell.fail} failing '${name}' assertion(s)`)
    }
    for (const name of required) {
      if (!byName.has(name)) problems.push(`${scenario}: REQUIRED assertion '${name}' was never emitted`)
    }
    console.log(`   COVERAGE GAPS (printed, never failing): ${r.coverageGaps.length}`)
    for (const gap of r.coverageGaps) console.log(`     - ${gap}`)
    console.log(`   CENSUS after: ${r.censusAfter}`)
    if (!r.censusAfter.includes('leagues=0')) problems.push(`${scenario}: the post-run census is not clean — ${r.censusAfter}`)
  }

  console.log('')
  console.log('======================================================================')
  if (problems.length > 0) {
    console.log(`  M6 SIM EVIDENCE — ${problems.length} GAP(S)`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log('  M6 SIM EVIDENCE — both correction scenarios green, every required arm present,')
  console.log('  one commissioner override per run')
  console.log('======================================================================')
}

main()
