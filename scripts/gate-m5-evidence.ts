/**
 * gate-m5-evidence.ts — the M5 gate's evidence stage (L.D3.10; PROGRESS F457,
 * R1242). Reads the transacting sim's `--report` JSON files and asserts, BY
 * NAME, what the gate claims — a run's exit code alone is not evidence:
 *
 *   transact <report.json>
 *     The clean transacting run across the settings matrix: GREEN; every
 *     league's script completed (0 aborted); each claim type (faab /
 *     rolling_priority / reverse_standings) resolved a contested player in
 *     >= 1 league; a trade executed under EACH review mode (commissioner /
 *     none / league_vote) plus a reversal; the Ghost completed everywhere it
 *     ran; every invariant population > 0; zero external calls; no problems.
 *
 *   probe <exclusivity|faab-ledger|pool-mirror|claim-privacy> <report.json>
 *     A break-probe run (F457 / R1242): the report must be the probe's own
 *     (`transactions.probe`), RED, and red BY THE NAMED INVARIANT — at least
 *     one failure of exactly that invariant, and NOTHING ELSE (no other
 *     invariant, no run problem). A probe that stopped landing, or a run red
 *     for some unrelated reason, fails here instead of passing as "exit 1".
 *
 * Exit 0 = every assertion held; exit 1 = at least one did not (each printed).
 */
import { readFileSync } from 'node:fs'

import type { SeasonRunReport } from '../src/lib/leagues/sim/sim-types'

const PROBE_INVARIANT: Record<string, string> = {
  exclusivity: 'transaction-exclusivity',
  'faab-ledger': 'faab-ledger',
  'pool-mirror': 'pool-roster-mirror',
  'claim-privacy': 'claim-privacy',
}
/**
 * The SAME fault seen from a second side (D423(11), found by gate run 3): the
 * exclusivity probe re-teams one moved player's roster row; when that player
 * is also in his old team's lineup, the season invariant `exclusivity`
 * ("team X starts P, but the roster owner is Y") names the very same player.
 * That sibling is allowed ONLY when every one of its failures names the
 * probed player — anything else is still a foreign red.
 */
const PROBE_SIBLINGS: Record<string, string[]> = {
  exclusivity: ['exclusivity'],
}
const WAIVER_TYPES = ['faab', 'rolling_priority', 'reverse_standings'] as const

const failures: string[] = []
function check(ok: boolean, what: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`)
  if (!ok) failures.push(what)
}

function load(path: string): SeasonRunReport {
  return JSON.parse(readFileSync(path, 'utf8')) as SeasonRunReport
}

function transact(path: string): void {
  const r = load(path)
  const t = r.transactions
  console.log(`TRANSACT EVIDENCE — ${path} (run ${r.runId}, seed ${r.seed}, ${r.scenario})`)
  check(t !== null, 'the report is a --transact run (transactions block present)')
  if (t === null) return
  check(t.probe === null, `no break probe planted (got ${String(t.probe)})`)
  check(r.green === true, `the run is GREEN (${r.invariantFailures.length} invariant failure(s), ${r.problems.length} problem(s))`)
  for (const f of r.invariantFailures.slice(0, 10)) console.log(`      ${f.invariant}: ${f.leagueLabel} ${f.detail.slice(0, 200)}`)
  for (const p of r.problems.slice(0, 10)) console.log(`      problem: ${p.slice(0, 240)}`)
  check(t.leagues >= WAIVER_TYPES.length, `${t.leagues} transacting league(s) — at least ${WAIVER_TYPES.length}, so every claim type is reachable`)
  check(t.leaguesAborted === 0, `${t.leaguesAborted} league script(s) aborted`)
  for (const w of WAIVER_TYPES) {
    const cell = t.byWaiverType?.[w]
    check(
      cell !== undefined && cell.resolved > 0,
      `claims under waiver_type '${w}': ${cell?.resolved ?? 0} of ${cell?.leagues ?? 0} league(s) resolved a contested player (won ${cell?.won ?? 0} / lost ${cell?.lost ?? 0} / invalid ${cell?.invalid ?? 0})`,
    )
  }
  check(t.trades.commissioner > 0, `a trade executed under commissioner review (${t.trades.commissioner})`)
  check(t.trades.none > 0, `a trade executed with no review (${t.trades.none})`)
  check(t.trades.league_vote > 0, `a trade executed under league vote (${t.trades.league_vote}, ${t.trades.votes} votes)`)
  // 174 (L.D3.16 — Chris 2026-09-30, "Remove reverse"): E11's reversal is gone;
  // the evidence is now that the commissioner's reverse was refused by name.
  check(t.trades.reverseRefused > 0, `the commissioner's reverse was refused by name — 174 (${t.trades.reverseRefused})`)
  check(t.addDrops > 0, `add/drops went through (${t.addDrops})`)
  check(t.commishFaabEdits > 0, `commissioner FAAB edits (${t.commishFaabEdits})`)
  check(t.ghosts.attempted > 0 && t.ghosts.completed === t.ghosts.attempted, `the Ghost completed ${t.ghosts.completed} of ${t.ghosts.attempted}`)
  const p = t.populations
  check(p.exclusivityMoved > 0, `T1 transaction-exclusivity population ${p.exclusivityMoved}`)
  check(
    p.faabTeams > 0 && Object.values(p.faabTerms).every((n) => n > 0),
    `T2 faab-ledger population ${p.faabTeams} franchise(s), terms ${JSON.stringify(p.faabTerms)}`,
  )
  const rostered = p.poolByState.rostered ?? 0
  const other = Object.entries(p.poolByState).filter(([k]) => k !== 'rostered').reduce((n, [, v]) => n + v, 0)
  check(rostered > 0 && other > 0, `T3 pool-roster-mirror population ${JSON.stringify(p.poolByState)}`)
  check(
    p.privacyHiddenPairs > 0 && p.privacyOwnVisible > 0 && p.privacyLostClaims > 0,
    `T4 claim-privacy population ${p.privacyHiddenPairs} hidden / ${p.privacyOwnVisible} own / ${p.privacyLostClaims} lost`,
  )
  const off = r.leagues.filter((l) => !l.allowIllegalLineups)
  check(off.length > 0, `${off.length} allow_illegal_lineups = false league(s) in the matrix`)
  check(
    off.length > 0 && off.every((l) => l.benchedForLegality > 0),
    `every OFF league passed over >= 1 player for §7.3.6 (R1266): ${off.map((l) => `${l.leagueLabel} ${l.benchedForLegality}`).join(' · ')}`,
  )
  check(r.externalCalls === 0, `external calls ${r.externalCalls}`)
  check(r.provenance.foreign === 0, `foreign stat rows ${r.provenance.foreign}`)
  check(!r.problems.some((l) => l.startsWith('TRANSACTION PREMISE')), 'no TRANSACTION PREMISE line')
}

function probe(name: string, path: string): void {
  const r = load(path)
  const want = PROBE_INVARIANT[name]
  console.log(`PROBE EVIDENCE — --probe ${name} — ${path} (run ${r.runId})`)
  check(want !== undefined, `'${name}' is a known probe (${Object.keys(PROBE_INVARIANT).join(' | ')})`)
  if (want === undefined) return
  check(r.transactions?.probe === name, `the report is the '${name}' probe's own run (transactions.probe = ${String(r.transactions?.probe)})`)
  check(r.green === false, 'the run is RED')
  const by = new Map<string, number>()
  for (const f of r.invariantFailures) by.set(f.invariant, (by.get(f.invariant) ?? 0) + 1)
  check((by.get(want) ?? 0) > 0, `the NAMED invariant '${want}' fired (${by.get(want) ?? 0} failure(s))`)
  // The probed player, from the named invariant's own words ("player <id>: …").
  const probed = new Set(
    r.invariantFailures
      .filter((f) => f.invariant === want)
      .map((f) => /player (\S+?):/.exec(f.detail)?.[1])
      .filter((id): id is string => id !== undefined),
  )
  const siblings = PROBE_SIBLINGS[name] ?? []
  const siblingFailures = r.invariantFailures.filter((f) => siblings.includes(f.invariant))
  const siblingOk = siblingFailures.every((f) => [...probed].some((id) => new RegExp(`\\b${id}\\b`).test(f.detail)))
  if (siblingFailures.length > 0) {
    check(
      siblingOk,
      `the sibling invariant(s) ${siblings.join(', ')} fired only on the probed player ${[...probed].join(', ') || '(none named)'} (${siblingFailures.length} failure(s) — the same fault from the lineup side)`,
    )
  }
  const others = [...by.entries()].filter(([k]) => k !== want && !siblings.includes(k))
  check(others.length === 0, `no OTHER invariant fired (${others.map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'})`)
  check(r.problems.length === 0, `no run problem (${r.problems.length}${r.problems.length > 0 ? `: ${r.problems[0]!.slice(0, 200)}` : ''})`)
  for (const f of r.invariantFailures.filter((x) => x.invariant === want).slice(0, 3)) console.log(`      ${f.invariant}: ${f.detail.slice(0, 220)}`)
}

const [mode, a, b] = process.argv.slice(2)
if (mode === 'transact' && a !== undefined) transact(a)
else if (mode === 'probe' && a !== undefined && b !== undefined) probe(a, b)
else {
  console.error('usage: gate-m5-evidence.ts transact <report.json> | probe <name> <report.json>')
  process.exit(2)
}
if (failures.length > 0) {
  console.log(`EVIDENCE: ${failures.length} assertion(s) FAILED`)
  process.exit(1)
}
console.log('EVIDENCE: every assertion held')
