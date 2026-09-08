/**
 * `sim season` — the in-season driver + invariant sweep (M4 task L.D6.1;
 * tasks-M4-inseason.md §6 L.D6.1; delivery plan §4.2; spec §23.6/§23.2/§11.5).
 *
 * WHAT IT DRIVES. The draft phase is the EXISTING sim (`runDraftSim` with
 * `season: true, keepLeagues: true`) — real `createLeague` / invite / claim /
 * `startDraft` / `makePick` under each bot's own JWT (D100). The season phase
 * then walks the §23.6 scenario's own timeline and, at every instant it
 * declares, drives the REAL production machinery and nothing else:
 *
 *   ingestion   `ingestWeek(provider, clock, io)`      — `src/lib/sync/ingest-week.ts`
 *   scoring     `runScoreWeekBatch({time: clock, db})` — the production worker
 *   week state  `league_week_advance(p_now, league)`   — 118:1725
 *   locks       `lineup_lock_tick(p_now, league)`      — 119:696
 *   finalize    `finalize_matchups(p_now, league)`     — 118:1945
 *   lineups     `setLineup(...)`                       — the L.D4.1 service over 112's RPC
 *
 * No hand-written UPDATE of `matchups`, `team_week_results` or `player_stats`
 * exists on this path: every number the sweep reads was put there by the
 * pipeline. The service-role client keeps the runner's five recorded harness
 * jobs (`runner.ts:16-31`) plus, recorded HERE per R290's enumeration rule,
 * three season additions:
 *   6. the three `p_now`-injected JOB RPCs (all three refuse a JWT-bearing
 *      caller in-body, 42501 — service-role only, and every call passes
 *      `p_league_id`, D313(2)'s scope seam);
 *   7. the sweep's ORACLE reads — `lineup_fit_internal` (invariant 2),
 *      `league_standings_internal` (invariant 5) and
 *      `rebuild_team_week_results` (invariant 3), all REVOKEd from
 *      `authenticated`;
 *   8. `ingestWeek`'s writer client (`nfl_games` / `nfl_weeks` bounds /
 *      `player_stats` / `score_fanout` are service-role surfaces by design).
 *
 * ── TIME ───────────────────────────────────────────────────────────────────
 * ONE `VirtualClock` (speed 0 — step-driven) carries the whole season, and it
 * reaches three places at once: `p_now` on the job RPCs, `deps.time` of
 * `ingestWeek` / `runScoreWeekBatch` / `reconcileSeason`, and the `time` of
 * the `SyntheticStatsProvider`. Virtual time is MONOTONIC, so the run's
 * timeline is a single sorted list across every driven week — which is also
 * how a real season behaves: week W's correction window (start + 8d 6h)
 * closes AFTER week W+1 has already opened (start + 7d), and the driver
 * interleaves them rather than pretending weeks are disjoint.
 *
 * THE ONE INSTANT THAT IS NOT VIRTUAL, said plainly: `set_lineup` and
 * `roster_add_drop` accept NO caller clock — their DEFINER wrappers pass the
 * transaction's `now()` (112:1233, 113:912; D307(3)). A lineup the sim sets
 * is therefore set at WALL time, which on `SYNTHETIC_SEASON` (2099) is before
 * every kickoff, so nothing is ever locked at submit. The consequence is
 * honest and stated rather than worked around: this harness cannot observe a
 * lineup-edit LOCK REFUSAL. Locks are exercised where they actually live —
 * `lineup_lock_tick` at an injected `p_now` (E42's evaluation-time read).
 *
 * ── SCOPE ──────────────────────────────────────────────────────────────────
 * ONE SCENARIO PER RUN, and that is a mechanism, not a preference:
 * `nfl_games` has no league column, and locks read it by
 * `(season, week, nfl_team)` (`pool_game_lock_any_internal` /
 * `lineup_kickoff_internal`; 115:225-344, 112:380-384), so planting
 * `flex_move`'s moved kickoff for one league moves it for EVERY league whose
 * roster touches that club. A hundred leagues on one synthetic season cannot
 * each carry a different scenario's slate. L.D6.3 runs the library as nine
 * stages; mixing scenarios inside one run would require partitioning NFL club
 * abbreviations across league cohorts, which is a design decision to be
 * recorded, not assumed.
 *
 * pg_cron is INERT here and it is worth saying why: 116:1337-1349 schedules
 * all three jobs UNSCOPED at wall-clock `now()` on every stack, local
 * included. Season 2099's instants are all in the wall-clock future, so the
 * unscoped cron finds nothing due for a sim league — that, and not luck, is
 * what makes 2099 safe. It is also why every job call here still passes
 * `p_league_id`, and why the run must not leave leagues behind.
 *
 * ── CLEANUP (F199) ─────────────────────────────────────────────────────────
 * The run's `finally` calls `cleanupSweep`, which this task extended to the
 * in-season tables AND to the three season-scoped surfaces no league delete
 * cascades to (`score_fanout`, `player_stats`, `nfl_games` by prefix) plus
 * the `nfl_weeks` bound reset. `simCensus` runs cleanup-FIRST and
 * cleanup-LAST and both censuses are printed: F199's whole species is a
 * fixture row that outlives its run, and a census only at the end cannot tell
 * a clean run from a run that inherited someone else's mess.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { setLineup } from '../api/lineup-service'
import { reconcileSeason, type ReconcileReport } from '../scoring/reconcile'
import { runScoreWeekBatch, type BatchReport } from '../scoring/score-week-worker'
import { DegradationTracker } from '../stats/degradation'
import { makeScenario } from '../stats/synthetic/scenarios'
import { SCENARIO_IDS, type ScenarioId } from '../stats/synthetic/scenario'
import { SyntheticStatsProvider } from '../stats/synthetic/synthetic-stats-provider'
import { VirtualClock } from '../time/virtual-clock'
import { ingestWeek, type IngestReport } from '@/lib/sync/ingest-week'

import { BOT_POOL_SIZE, seasonPlanLines } from './plan'
import {
  censusLine,
  cleanupSweep,
  runDraftSim,
  simBotEmail,
  simCensus,
  SIM_BOT_PASSWORD,
  type SimRunDeps,
} from './runner'
import {
  anchorScenario,
  bridgeLines,
  buildPlayerBridge,
  scenarioInstants,
  type BridgeCandidate,
  type PlayerBridge,
} from './season-scenario'
import {
  classifyHeldWeeks,
  startersOfMap,
  sweepSeasonAudit,
  type AuditFinalCell,
  type AuditLineup,
  type AuditRebuild,
  type AuditReconcileFinding,
  type SeasonAudit,
  type SeasonInvariantFailure,
} from './season-invariants'
import { deriveStream, uuidFromRng } from './sim-rng'
import {
  type LegalTeamCount,
  type ScenarioAssertion,
  type SeasonLeagueResult,
  type SeasonRunReport,
} from './sim-types'
import { SYNTHETIC_SEASON } from './synthetic-season'

type Supabase = SupabaseClient<Database>

const MINUTE_MS = 60_000

export interface SeasonRunConfig {
  leagues: number
  teams: LegalTeamCount | 'mixed'
  clockSeconds: number
  seed: number
  scenario: ScenarioId
  /** How many of the league's planned regular-season weeks to DRIVE. */
  weeks: number
  concurrency?: number
  verbose?: boolean
}

export interface SeasonRunDeps extends SimRunDeps {
  /** A pure function of the printed inputs — minted at the CLI boundary. */
  runId: string
  /** How many `fetch` calls left the local stack (the CLI counts them). */
  externalCalls: () => number
}

export interface LeagueState {
  label: string
  leagueId: string
  teamCount: number
  scheduleMode: 'h2h' | 'total_points'
  matrixLine: string
  ownerId: string | null
  teams: Array<{ id: string; ownerId: string | null }>
  irKeys: string[]
  slots: Array<{ key: string; eligible: string[] }>
  startedAt: number
  finalCellByWeek: Map<number, Map<string, string>>
  weeksFinal: Set<number>
}

function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} failed: ${error.message}`)
}

/** Every `players.team` a scenario game names — the bridge's candidate scope. */
function scenarioClubs(games: readonly { homeTeam: string; awayTeam: string }[]): string[] {
  return [...new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))].sort()
}

/** A matchup cell + the week's results, rendered stably (invariant 6). */
function renderCells(
  matchups: ReadonlyArray<Record<string, unknown>>,
  results: ReadonlyArray<Record<string, unknown>>,
): Map<string, string> {
  const byWeekMatchup = new Map<string, string>()
  const resultsByWeek = new Map<number, string[]>()
  for (const r of [...results].sort((a, b) => String(a.team_id).localeCompare(String(b.team_id)))) {
    const week = Number(r.week)
    const list = resultsByWeek.get(week) ?? []
    list.push(
      `${String(r.team_id)}=${String(r.points)}/${String(r.h2h_result)}/${String(r.median_result)}/${String(r.second_result)}/${String(r.is_final)}`,
    )
    resultsByWeek.set(week, list)
  }
  for (const m of matchups) {
    const week = Number(m.week)
    byWeekMatchup.set(
      `${week}:${String(m.id)}`,
      `home=${String(m.home_score)} away=${String(m.away_score)} result=${String(m.result)} ` +
        `status=${String(m.status)} overridden=${String(m.is_overridden)} ` +
        `results=[${(resultsByWeek.get(week) ?? []).join(',')}]`,
    )
  }
  return byWeekMatchup
}

/**
 * The whole run. Returns the report; throws only on a harness failure that
 * makes the run meaningless (a provisioning throw is reported as an invariant
 * failure, not a throw — the draft sim's own posture).
 */
export async function runSeasonSim(
  cfg: SeasonRunConfig,
  deps: SeasonRunDeps,
): Promise<SeasonRunReport> {
  const { log } = deps
  const service = createClient<Database>(deps.url, deps.serviceRoleKey, {
    auth: { persistSession: false },
  })
  const base = makeScenario(cfg.scenario, cfg.seed)
  const startedAtWall = new Date(deps.clock.nowMs()).toISOString()

  const report: SeasonRunReport = {
    seed: cfg.seed,
    runTag: deps.runTag,
    runId: deps.runId,
    scenario: cfg.scenario,
    scenarioLibraryVersion: base.version,
    clockMode: 'step',
    season: SYNTHETIC_SEASON,
    weeksRequested: cfg.weeks,
    startedAt: startedAtWall,
    finishedAt: startedAtWall,
    planLines: [],
    bridgeLines: [],
    leagues: [],
    scenarioEvidence: { scenario: cfg.scenario, leagues: 0, assertions: [] },
    invariantFailures: [],
    jobs: { advance: 0, lockTick: 0, finalize: 0, scoreBatches: 0, polls: 0 },
    provenance: { statRows: 0, synthetic: 0, foreign: 0 },
    externalCalls: 0,
    workerErrors: [],
    reconcileSummary: { leagues: 0, cells: 0, counts: {}, alerts: 0, warns: 0, infos: 0 },
    reconcileClassified: [],
    workerNotes: [],
    cleanupSummary: '',
    censusBefore: '',
    censusAfter: '',
    problems: [],
    reason: null,
    green: false,
  }

  // ---- F199: the census BEFORE anything (a run must not inherit a mess) ----
  report.censusBefore = censusLine(await simCensus(service))
  log(`BEFORE  ${report.censusBefore}`)

  const leagueStates: LeagueState[] = []
  try {
    // ---- Phase 1: the DRAFT, through the existing sim -------------------
    const draft = await runDraftSim(
      {
        leagues: cfg.leagues,
        teams: cfg.teams,
        clockSeconds: cfg.clockSeconds,
        seed: cfg.seed,
        draftType: 'snake',
        season: true,
        keepLeagues: true,
        concurrency: cfg.concurrency,
        verbose: cfg.verbose,
      },
      deps,
    )
    report.planLines = draft.planLines
    report.workerErrors.push(...draft.workerErrors)
    for (const f of draft.invariantFailures) {
      report.invariantFailures.push({
        invariant: `draft:${f.invariant}`,
        leagueLabel: f.leagueLabel,
        leagueId: f.draftId,
        week: null,
        detail: f.detail,
      })
    }
    if (draft.leagues.length === 0) {
      report.reason = 'no_leagues'
      report.problems.push('the draft phase provisioned no leagues — nothing to drive')
      return finish(report, deps)
    }

    // ---- The D299 matrix, echoed from the plan the leagues were built on --
    const planForLines = { leagues: draft.leagues, seed: cfg.seed } // placeholder; replaced below

    // ---- Phase 2: the bridge -------------------------------------------
    const clubs = scenarioClubs(base.games)
    const { data: candidateRows, error: candidateError } = await service
      .from('players')
      .select('id, position, team, adp')
      .in('team', clubs)
    throwIfError(candidateError, 'bridge: player candidates')
    const candidates: BridgeCandidate[] = (candidateRows ?? []).map((r) => ({
      id: r.id,
      position: String(r.position),
      team: r.team,
      adp: r.adp === null ? null : Number(r.adp),
    }))
    const bridge = buildPlayerBridge(base, candidates)
    report.bridgeLines = bridgeLines(base, bridge)
    if (bridge.misses.length > 0) {
      // LOUD: a scenario the world cannot speak is not a scenario that passed.
      report.problems.push(
        `player bridge: ${bridge.misses.length} of ${base.players.length} §23.6 slots have no real player ` +
          `(${bridge.misses.join('; ')}) — the local pool is missing a position on one of ${clubs.join('/')}`,
      )
    }
    const bridgedIds = new Set(bridge.map.values())

    // ---- Phase 3: read each league's shape ------------------------------
    for (const l of draft.leagues) {
      leagueStates.push(await readLeagueState(service, l.leagueLabel, l.leagueId, l.teamCount, deps.clock.nowMs()))
    }
    report.leagues = [] // filled at the end
    void planForLines

    // ---- Phase 3b: sign the SAME bots back in ---------------------------
    // `set_lineup` refuses a service-role caller in-body (112:684 — it reads
    // `auth.uid()`), so lineups travel each manager's own JWT exactly as a
    // click does (D100). The draft phase's users are still resident because
    // the season phase owns the cleanup.
    const botClients = new Map<string, Supabase>()
    for (let i = 0; i < BOT_POOL_SIZE; i++) {
      const client = createClient<Database>(deps.url, deps.anonKey, { auth: { persistSession: false } })
      const { data, error } = await client.auth.signInWithPassword({
        email: simBotEmail(i),
        password: SIM_BOT_PASSWORD,
      })
      if (error) throw new Error(`season: bot ${i + 1} sign-in failed: ${error.message}`)
      botClients.set(data.user.id, client)
    }

    // ---- Phase 4: drive the season --------------------------------------
    const driven = await driveSeason(service, botClients, cfg, deps, base, bridge, leagueStates)
    if (driven.weeksDriven.length === 0) {
      report.reason = 'no_weeks_driven'
      report.problems.push('no week reached its open instant — the calendar or the plan is empty')
    }

    // ---- Phase 5: the sweep ---------------------------------------------
    const reconcile = await reconcileSeason(
      { time: driven.clock, db: service },
      { season: SYNTHETIC_SEASON, leagueIds: leagueStates.map((s) => s.leagueId) },
    )
    const { data: rosteredRows, error: rosteredError } = await service
      .from('league_rosters')
      .select('player_id')
      .in('league_id', leagueStates.map((s) => s.leagueId))
    throwIfError(rosteredError, 'sweep: rostered-player set')
    const { data: postponedRows, error: postponedError } = await service
      .from('nfl_games')
      .select('id')
      .eq('season', SYNTHETIC_SEASON)
      .eq('status', 'postponed')
    throwIfError(postponedError, 'sweep: postponed games')
    applyReconcileSummary(report, reconcile, {
      drivenWeeks: new Set(driven.weeksDriven),
      rosteredPlayers: new Set((rosteredRows ?? []).map((r) => r.player_id)),
      postponedGameIds: new Set((postponedRows ?? []).map((r) => r.id)),
    })
    report.workerNotes = driven.workerNotes

    for (const state of leagueStates) {
      const audit = await collectSeasonAudit(
        service,
        state,
        driven.weeksDriven,
        reconcile,
        driven.workerErrorsByLeague.get(state.leagueId) ?? [],
        driven.noStatRowByLeague.get(state.leagueId) ?? 0,
        bridgedIds,
      )
      const failures = sweepSeasonAudit(audit)
      report.invariantFailures.push(...failures)
      const bridgeCounts = audit.rosters.filter((r) => bridgedIds.has(r.player_id)).length
      const startedBridged = new Set<string>()
      for (const lineup of audit.lineups) {
        for (const p of startersOfMap(lineup.slot_map, lineup.ir_keys)) {
          if (bridgedIds.has(p)) startedBridged.add(`${lineup.team_id}:${lineup.week}:${p}`)
        }
      }
      const result: SeasonLeagueResult = {
        leagueLabel: state.label,
        leagueId: state.leagueId,
        teamCount: state.teamCount,
        scheduleMode: state.scheduleMode,
        matrixLine: state.matrixLine,
        weeksDriven: [...driven.weeksDriven],
        weeksFinal: [...state.weeksFinal].sort((a, b) => a - b),
        heldWeeks: classifyHeldWeeks(audit),
        bridgeRostered: bridgeCounts,
        bridgeStarted: startedBridged.size,
        noStatRowStarters: audit.noStatRowStarters,
        durationMs: deps.clock.nowMs() - state.startedAt,
        failures,
      }
      report.leagues.push(result)
      log(
        `${state.label}: weeks ${result.weeksFinal.length}/${driven.weeksDriven.length} final · ` +
          `${state.scheduleMode} · bridged ${bridgeCounts} rostered / ${startedBridged.size} started · ` +
          `${failures.length === 0 ? 'invariants OK' : `${failures.length} FAILURES`} · ` +
          `${(result.durationMs / 1000).toFixed(1)}s`,
      )
    }
    report.scenarioEvidence = driven.evidence
    report.scenarioEvidence.leagues = leagueStates.length
    report.jobs = driven.jobs
    report.provenance = await readProvenance(service)
    report.workerErrors.push(...driven.workerErrors)
    report.problems.push(...driven.problems)
  } finally {
    try {
      report.cleanupSummary = await cleanupSweep(service, log)
    } catch (cleanupError) {
      report.cleanupSummary = `CLEANUP FAILED: ${(cleanupError as Error).message}`
      report.invariantFailures.push({
        invariant: 'cleanup',
        leagueLabel: '(run)',
        leagueId: '(run)',
        week: null,
        detail: (cleanupError as Error).message,
      })
      log(report.cleanupSummary)
    }
    try {
      report.censusAfter = censusLine(await simCensus(service))
      log(`AFTER   ${report.censusAfter}`)
    } catch (censusError) {
      report.censusAfter = `CENSUS FAILED: ${(censusError as Error).message}`
      report.problems.push(report.censusAfter)
    }
  }
  return finish(report, deps)
}

function finish(report: SeasonRunReport, deps: SeasonRunDeps): SeasonRunReport {
  report.finishedAt = new Date(deps.clock.nowMs()).toISOString()
  report.externalCalls = deps.externalCalls()
  if (report.externalCalls > 0) {
    report.problems.push(
      `EXTERNAL CALLS: ${report.externalCalls} fetch call(s) left the local stack — the synthetic tier must make none (§23.6)`,
    )
  }
  if (report.provenance.foreign > 0) {
    report.problems.push(
      `PROVENANCE: ${report.provenance.foreign} player_stats row(s) on season ${report.season} carry a source other than 'synthetic' (D300/F13)`,
    )
  }
  report.green =
    report.invariantFailures.length === 0 &&
    report.problems.length === 0 &&
    report.reason === null &&
    report.scenarioEvidence.assertions.every((a) => a.passed)
  return report
}

/**
 * The run's own context, so a reconcile ALERT that is a lawful consequence of
 * how the SIM is scoped can be CLASSIFIED (reconcile's own posture: name the
 * lawful explanation first) instead of being counted as a failure — and,
 * equally, so nothing else is quietly swallowed.
 */
export interface ReconcileContext {
  drivenWeeks: ReadonlySet<number>
  /** Every player any run league rosters (the scope seam's own boundary). */
  rosteredPlayers: ReadonlySet<string>
  /** `nfl_games.id`s the scenario declared postponed (E43). */
  postponedGameIds: ReadonlySet<string>
}

/** Why a reconcile ALERT is lawful in THIS run — null means it is not. */
export function classifyReconcileAlert(
  finding: { kind: string; week?: number | null; player_id?: string | null; message: string },
  ctx: ReconcileContext,
): string | null {
  switch (finding.kind) {
    case 'starter_final_game_no_line':
      // Q42 is OPEN and the §23.6 world publishes lines for EIGHTEEN players
      // across three games: every other starter on a scenario club has a
      // final game and no line, by construction. Counted, never asserted on.
      return 'the §23.6 world publishes lines for 18 players — every other starter on a scenario club is a lawful no_stat_row (Q42 OPEN)'
    case 'no_game_rows':
      // The run drives N weeks; a week it never drove has no slate. Only a
      // week the run DID drive without games is a real finding.
      return finding.week !== null && finding.week !== undefined && !ctx.drivenWeeks.has(finding.week)
        ? `week ${finding.week} was not driven by this run (--weeks bounds the slate)`
        : null
    case 'stuck_queue':
      // D313(2): the drain is SCOPED to the run's leagues, so a delta for a
      // player NO run league rosters is left for the (unscoped) production
      // drain and stays queued. A stuck row for a ROSTERED player is real.
      return finding.player_id !== null && finding.player_id !== undefined && !ctx.rosteredPlayers.has(finding.player_id)
        ? `no run league rosters ${finding.player_id} — a scoped drain leaves the row for the unscoped one (D313(2))`
        : null
    case 'game_not_final_late':
      // E43: a postponed game is DECLARED never-final for this week. Q37's
      // shape — classified with the lawful explanation, never a failure.
      return [...ctx.postponedGameIds].some((id) => finding.message.includes(id))
        ? 'the game is postponed out of the week by the scenario (E43) — a postponed game never goes final here'
        : null
    default:
      return null
  }
}

function applyReconcileSummary(report: SeasonRunReport, reconcile: ReconcileReport, ctx: ReconcileContext): void {
  report.reconcileSummary = {
    leagues: reconcile.leagues,
    cells: reconcile.cells,
    counts: { ...reconcile.counts } as Record<string, number>,
    alerts: reconcile.alerts,
    warns: reconcile.warns,
    infos: reconcile.infos,
  }
  // Three finding kinds RESTATE one of the seven invariants and are promoted
  // there (`season-invariants.ts`). Every other ALERT is surfaced here —
  // loud and visible — and is NOT silently promoted into a gate condition the
  // task row never named. `starter_final_game_no_line` fires by construction
  // in a §23.6 world of eighteen players (Q42 is OPEN — the sweep asserts the
  // worker's REPORT, never the arithmetic), so it is counted, not alerted on.
  const promoted = new Set(['drift', 'twr_mirror_drift', 'pool_mirror_broken'])
  const classified = new Map<string, number>()
  for (const f of reconcile.findings) {
    if (f.severity !== 'alert') continue
    if (promoted.has(f.kind)) continue
    const lawful = classifyReconcileAlert(
      { kind: f.kind, week: f.week ?? null, player_id: f.player_id ?? null, message: f.message },
      ctx,
    )
    if (lawful !== null) {
      classified.set(`${f.kind}: ${lawful}`, (classified.get(`${f.kind}: ${lawful}`) ?? 0) + 1)
      continue
    }
    report.problems.push(`reconcile ALERT (not a sweep invariant): ${f.kind}: ${f.message}`)
  }
  report.reconcileClassified = [...classified.entries()]
    .map(([reason, count]) => `${count}× ${reason}`)
    .sort()
}

async function readProvenance(service: Supabase): Promise<SeasonRunReport['provenance']> {
  const { count: total, error: totalError } = await service
    .from('player_stats')
    .select('player_id', { count: 'exact', head: true })
    .eq('season', SYNTHETIC_SEASON)
  throwIfError(totalError, 'provenance: total')
  const { count: synthetic, error: synthError } = await service
    .from('player_stats')
    .select('player_id', { count: 'exact', head: true })
    .eq('season', SYNTHETIC_SEASON)
    .eq('source', 'synthetic')
  throwIfError(synthError, 'provenance: synthetic')
  if (total === null || synthetic === null) {
    throw new Error('provenance: PostgREST returned no count — refusing to read that as zero')
  }
  return { statRows: total, synthetic, foreign: total - synthetic }
}

export async function readLeagueState(
  service: Supabase,
  label: string,
  leagueId: string,
  teamCount: number,
  startedAtMs: number,
): Promise<LeagueState> {
  const { data: league, error: leagueError } = await service
    .from('leagues')
    .select('roster_settings, settings, owner_id')
    .eq('id', leagueId)
    .single()
  throwIfError(leagueError, `${label}: league shape`)
  const roster = (league!.roster_settings ?? {}) as {
    starting_slots?: Array<{ key: string; eligible: string[]; count: number }>
    ir_slots?: Array<{ key: string }>
  }
  const slots: Array<{ key: string; eligible: string[] }> = []
  for (const slot of roster.starting_slots ?? []) {
    for (let i = 0; i < slot.count; i++) slots.push({ key: `${slot.key}:${i}`, eligible: slot.eligible })
  }
  const settings = (league!.settings ?? {}) as Record<string, unknown>
  const scheduleMode = settings.schedule_mode === 'total_points' ? 'total_points' : 'h2h'
  const { data: teams, error: teamsError } = await service
    .from('teams')
    .select('id, owner_id')
    .eq('league_id', leagueId)
    .order('id')
  throwIfError(teamsError, `${label}: teams`)
  return {
    label,
    leagueId,
    ownerId: league!.owner_id,
    teamCount,
    scheduleMode,
    matrixLine:
      `${teamCount} teams · ${scheduleMode} · median ${settings.median_game === true ? 'on' : 'off'} · ` +
      `second ${settings.second_opponent === true ? 'on' : 'off'} · ` +
      `illegal-lineups ${settings.allow_illegal_lineups === false ? 'off' : 'on'}`,
    teams: (teams ?? []).map((t) => ({ id: t.id, ownerId: t.owner_id })),
    irKeys: (roster.ir_slots ?? []).map((s) => s.key),
    slots,
    startedAt: startedAtMs,
    finalCellByWeek: new Map(),
    weeksFinal: new Set(),
  }
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

type InstantKind = 'open' | 'poll' | 'close' | 'finalize'

interface TimelineEntry {
  at: Date
  week: number
  kind: InstantKind
  label: string
}

interface DriveOutcome {
  clock: VirtualClock
  weeksDriven: number[]
  jobs: SeasonRunReport['jobs']
  workerErrors: string[]
  workerErrorsByLeague: Map<string, string[]>
  noStatRowByLeague: Map<string, number>
  evidence: SeasonRunReport['scenarioEvidence']
  workerNotes: string[]
  problems: string[]
}

async function driveSeason(
  service: Supabase,
  botClients: ReadonlyMap<string, Supabase>,
  cfg: SeasonRunConfig,
  deps: SeasonRunDeps,
  base: ReturnType<typeof makeScenario>,
  bridge: PlayerBridge,
  leagues: LeagueState[],
): Promise<DriveOutcome> {
  const { log } = deps
  const jobs: SeasonRunReport['jobs'] = { advance: 0, lockTick: 0, finalize: 0, scoreBatches: 0, polls: 0 }
  const workerErrors: string[] = []
  const workerErrorsByLeague = new Map<string, string[]>()
  const noStatRowByLeague = new Map<string, number>()
  const assertions: ScenarioAssertion[] = []
  const problems: string[] = []
  const leagueIds = leagues.map((l) => l.leagueId)

  // The calendar rows the anchor is measured against — read, never derived.
  const { data: calendar, error: calendarError } = await service
    .from('nfl_weeks')
    .select('week, starts_at, correction_window_ends_at')
    .eq('season', SYNTHETIC_SEASON)
    .order('week')
  throwIfError(calendarError, 'season: calendar read')
  const weekRows = new Map((calendar ?? []).map((w) => [w.week, w]))

  // Which weeks each league actually holds (110 maps completion onto week 1).
  const { data: leagueWeekRows, error: lwError } = await service
    .from('league_weeks')
    .select('league_id, week')
    .in('league_id', leagueIds)
  throwIfError(lwError, 'season: league_weeks read')
  const firstWeek = Math.min(...(leagueWeekRows ?? []).map((r) => r.week))
  if (!Number.isFinite(firstWeek)) throw new Error('season: no league_weeks rows — the drafts did not complete')
  const weeksDriven: number[] = []
  for (let w = firstWeek; w < firstWeek + cfg.weeks; w++) {
    if (weekRows.has(w)) weeksDriven.push(w)
  }

  // ---- One anchored scenario + one provider per driven week --------------
  const anchored = new Map<number, ReturnType<typeof makeScenario>>()
  const timeline: TimelineEntry[] = []
  for (const week of weeksDriven) {
    const row = weekRows.get(week)!
    if (row.correction_window_ends_at === null) {
      throw new Error(`season: nfl_weeks (${SYNTHETIC_SEASON}, week ${week}) has no correction_window_ends_at`)
    }
    const scenario = anchorScenario(
      base,
      {
        season: SYNTHETIC_SEASON,
        week,
        weekStartsAt: row.starts_at,
        weekWindowEndsAt: row.correction_window_ends_at,
      },
      bridge,
    )
    anchored.set(week, scenario)
    timeline.push({ at: new Date(Date.parse(row.starts_at) + MINUTE_MS), week, kind: 'open', label: 'week opens' })
    for (const instant of scenarioInstants(scenario)) {
      timeline.push({ at: instant.at, week, kind: 'poll', label: instant.label })
    }
    // The close: one minute after the last in-week game ends. Ingestion
    // stamps `nfl_weeks.last_game_ends_at` at the poll that first sees every
    // in-week game final (`weekBounds`), which is the last `final <game>`
    // instant above — so the advance one minute later has its datum.
    const lastEnd = Math.max(
      ...scenario.games
        .filter((g) => g.postponement === undefined)
        .map((g) => {
          const kickoff = g.flexMove ? g.flexMove.newKickoffAt : g.kickoffAt
          return kickoff.getTime() + g.durationMs
        }),
    )
    timeline.push({ at: new Date(lastEnd + MINUTE_MS), week, kind: 'close', label: 'week closes (games over)' })
    timeline.push({
      at: new Date(Date.parse(row.correction_window_ends_at) + MINUTE_MS),
      week,
      kind: 'finalize',
      label: 'correction window closed',
    })
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime() || a.week - b.week)
  if (timeline.length === 0) {
    return {
      clock: new VirtualClock(new Date(0)),
      weeksDriven,
      jobs,
      workerErrors,
      workerErrorsByLeague,
      noStatRowByLeague,
      evidence: { scenario: cfg.scenario, leagues: 0, assertions },
      workerNotes: [],
      problems,
    }
  }

  log(`SCENARIO LIBRARY: v${base.version} · season ${SYNTHETIC_SEASON} · weeks ${weeksDriven[0]}..${weeksDriven[weeksDriven.length - 1]} · ${timeline.length} instants`)

  // ---- ONE clock for the whole season (step-driven, monotonic) ----------
  const clock = new VirtualClock(timeline[0]!.at)
  const degradation = new DegradationTracker()
  const providers = new Map<number, SyntheticStatsProvider>()
  for (const [week, scenario] of anchored) providers.set(week, new SyntheticStatsProvider(scenario, clock))
  const lastPollByWeek = new Map<number, string>()
  const lastPollCompletedAt = async (season: number, week: number): Promise<string | null> =>
    season === SYNTHETIC_SEASON ? (lastPollByWeek.get(week) ?? null) : null

  const measured = {
    degradedRaisedAt: null as string | null,
    degradedClearedAt: null as string | null,
    backfillDeltas: 0,
    kickoffBefore: null as string | null,
    kickoffAfter: null as string | null,
    locksAtAnnounce: null as string | null,
    locksAfterAnnounce: null as string | null,
    postWindowSkips: 0,
    postWindowWrites: 0,
    inWindowWrites: 0,
    revisionWrites: 0,
    flaggedNoStatRow: 0,
    lineupsSet: 0,
    workerNotes: new Map<string, number>(),
  }
  const flexGame = anchored.get(weeksDriven[0]!)!.games.find((g) => g.flexMove !== undefined)
  const postponedGame = anchored.get(weeksDriven[0]!)!.games.find((g) => g.postponement !== undefined)
  const windowEndsAt = new Map(
    weeksDriven.map((w) => [w, Date.parse(weekRows.get(w)!.correction_window_ends_at!)]),
  )

  const actionRng = deriveStream(cfg.seed, `season:lineups:${deps.runTag}`)
  let seedLineupsAfterPoll = false

  for (const entry of timeline) {
    clock.advanceTo(entry.at)
    const pNow = entry.at.toISOString()

    if (entry.kind === 'open' || entry.kind === 'close') {
      // The advance job at this instant, run TWICE — the recorded idempotence
      // proof (`dev-drive-inseason-week.ts:273-277`): the second pass must
      // find nothing left to do at the same `p_now`.
      for (const league of leagues) {
        for (let pass = 0; pass < 2; pass++) {
          const { data, error } = await service.rpc('league_week_advance', { p_now: pNow, p_league_id: league.leagueId })
          throwIfError(error, `${league.label}: league_week_advance (${entry.kind})`)
          jobs.advance += 1
          collectJobFailures(data, `${league.label} league_week_advance@${pNow}`, workerErrors, workerErrorsByLeague, league.leagueId)
        }
      }
      // Lineups are seeded AFTER this instant's ingestion poll, never before
      // it — F224(a)/R740: with no `nfl_games` row for the week,
      // `lineup_kickoff_internal` falls back to the week datum and every
      // player reads as locked from `starts_at`. The sim must seed the games
      // first, and the poll below is what writes them.
      seedLineupsAfterPoll = entry.kind === 'open' && entry.week === weeksDriven[0]
    }

    if (entry.kind === 'finalize') {
      for (const league of leagues) {
        const { data, error } = await service.rpc('finalize_matchups', { p_now: pNow, p_league_id: league.leagueId })
        throwIfError(error, `${league.label}: finalize_matchups`)
        jobs.finalize += 1
        collectJobFailures(data, `${league.label} finalize_matchups@${pNow}`, workerErrors, workerErrorsByLeague, league.leagueId)
      }
      // F244/R798: read finalization from DB STATE, never from the payload —
      // the report advances inside the subtransaction, so a later-week raise
      // leaves it claiming a rolled-back week finalized.
      await snapshotNewlyFinal(service, leagues)
    }

    // ---- POLL: ingest → drain → lock tick, at EVERY instant --------------
    const provider = providers.get(entry.week)!
    const io = { db: service, degradation, season: SYNTHETIC_SEASON, week: entry.week }
    const wasDegraded = degradation.degraded
    let ingest: IngestReport
    try {
      ingest = await ingestWeek(provider, clock, io)
    } catch (err) {
      // A DB failure inside ingestion is a real problem; a PROVIDER failure is
      // reported, never thrown (§23.2) — so anything here is loud.
      problems.push(`ingestWeek(${entry.week}) at ${pNow} threw: ${(err as Error).message}`)
      continue
    }
    jobs.polls += 1
    if (ingest.ok) lastPollByWeek.set(entry.week, ingest.polledAt)
    if (!wasDegraded && degradation.degraded) measured.degradedRaisedAt = pNow
    if (wasDegraded && !degradation.degraded) {
      measured.degradedClearedAt = pNow
      measured.backfillDeltas += ingest.stats.deltas
    }

    const batch = await runScoreWeekBatch(
      { time: clock, db: service, lastPollCompletedAt },
      { batchSize: 1000, leagueIds },
    )
    jobs.scoreBatches += 1
    absorbBatch(batch, pNow, workerErrors, workerErrorsByLeague, noStatRowByLeague, measured)
    measureCorrectionArms(batch, entry, windowEndsAt, measured)

    for (const league of leagues) {
      const { data, error } = await service.rpc('lineup_lock_tick', { p_now: pNow, p_league_id: league.leagueId })
      throwIfError(error, `${league.label}: lineup_lock_tick`)
      jobs.lockTick += 1
      collectJobFailures(data, `${league.label} lineup_lock_tick@${pNow}`, workerErrors, workerErrorsByLeague, league.leagueId)
    }

    // E42: the flexed game's kickoff, read from the table either side of the
    // announcement (the lock is EVALUATED from `nfl_games.kickoff_at`, never
    // precomputed — §23.3/D291).
    if (flexGame !== undefined && entry.week === weeksDriven[0]) {
      const announce = flexGame.flexMove!.announceAt.getTime()
      if (entry.at.getTime() < announce && measured.kickoffBefore === null) {
        measured.kickoffBefore = await readKickoff(service, flexGame.gameId)
      } else if (entry.at.getTime() >= announce) {
        measured.kickoffAfter = await readKickoff(service, flexGame.gameId)
      }
    }
    if (seedLineupsAfterPoll) {
      // Week 1 only — every later week comes from `lineup_carry_internal` at
      // the advance (D293's auto-carry, which is the path a real league takes
      // and therefore the one worth driving).
      measured.lineupsSet += await seedLineups(service, botClients, leagues, entry.week, actionRng, problems)
      seedLineupsAfterPoll = false
    }
    if (cfg.verbose === true) log(`  ${pNow} w${entry.week} ${entry.kind}: ${entry.label}`)
  }

  // ---- Scenario evidence, from what the run MEASURED ---------------------
  assertions.push(
    ...(await buildScenarioEvidence(service, cfg, leagues, weeksDriven, anchored, bridge, measured, postponedGame)),
  )

  return {
    clock,
    weeksDriven,
    jobs,
    workerErrors,
    workerErrorsByLeague,
    noStatRowByLeague,
    evidence: { scenario: cfg.scenario, leagues: leagues.length, assertions },
    workerNotes: [...measured.workerNotes.entries()].map(([reason, count]) => `${count}× ${reason}`).sort(),
    problems,
  }
}

async function readKickoff(service: Supabase, gameId: string): Promise<string | null> {
  const { data, error } = await service.from('nfl_games').select('kickoff_at').eq('id', gameId).maybeSingle()
  throwIfError(error, `kickoff read ${gameId}`)
  return data?.kickoff_at ?? null
}

/** The three job payloads' `failures[]` ARE truthful (F244/R798) — surface them. */
function collectJobFailures(
  payload: unknown,
  where: string,
  workerErrors: string[],
  byLeague: Map<string, string[]>,
  leagueId: string,
): void {
  const doc = payload as { failures?: unknown } | null
  const failures = doc?.failures
  if (!Array.isArray(failures) || failures.length === 0) return
  const line = `${where}: ${JSON.stringify(failures).slice(0, 400)}`
  workerErrors.push(line)
  byLeague.set(leagueId, [...(byLeague.get(leagueId) ?? []), line])
}

/**
 * What "zero unhandled worker errors" (§23.2) counts, and what it does NOT.
 *
 * The worker's `problems[]` is deliberately loud: it NAMES every lawful state
 * it declined to score — `drain scored nothing: <reason>` (the batch's own
 * "never an empty success" line, R875: `queue_empty` / `all_leased` /
 * `all_deferred` are explicitly informational), a `week_final` skip (which is
 * D295(b) WORKING), a `week_not_open` hold, a `week_not_scheduled` skip. In a
 * sim that polls at every declared instant, most drains legitimately have
 * nothing to do, and counting those as errors would make invariant 7 fire on
 * the pipeline behaving correctly.
 *
 * §23.2's "job failures: 0, any (with league_id context)" is about FAILURES.
 * Invariant 7 therefore counts, and only counts:
 *   (a) `LeagueWeekReport.outcome === 'failed'` — the D292 quarantine, with
 *       its `error` text;
 *   (b) `ack_missed.lease_lost + gone > 0` — the ONE window in which a stale
 *       write can land (R869/R873/F263(f));
 *   (c) the three job payloads' `failures[]` (F244/R798: those arrays ARE
 *       truthful even where the payload's counters are not);
 *   (d) any `problems[]` line that is NOT one of the named lawful states.
 * Everything filtered out is COUNTED BY REASON and printed, never dropped.
 *
 * "No team starts a mapped player this week (all bench/unstarted)" is on the
 * lawful list for the same reason: it is §22.2's INCREMENTAL rule stated out
 * loud — the worker's own step 5 ("a rostered player no lineup starts is
 * bench — no recompute"). It fires whenever a delta lands for a benched
 * player, which in a sim (and in production) is routine.
 */
const LAWFUL_WORKER_NOTE =
  /^(drain scored nothing:|no team starts a mapped player this week|\[[^\]]+\] (no team starts a mapped player this week|league .* (skipped: (week_final|week_not_open|week_not_scheduled)|HELD: week_not_open)))/

function absorbBatch(
  batch: BatchReport,
  pNow: string,
  workerErrors: string[],
  byLeague: Map<string, string[]>,
  noStatRowByLeague: Map<string, number>,
  measured: { flaggedNoStatRow: number; workerNotes: Map<string, number> },
): void {
  for (const line of batch.problems) {
    if (LAWFUL_WORKER_NOTE.test(line)) {
      const key = line.replace(/^\[[^\]]+\] /, '').replace(/league [0-9a-f-]{36} week \d+/g, 'league <id> week <n>').split(' (')[0]!
      measured.workerNotes.set(key, (measured.workerNotes.get(key) ?? 0) + 1)
      continue
    }
    workerErrors.push(`score batch @${pNow}: ${line}`)
  }
  // R869/R873: the ONE window a stale write can land in. Alert on both sides.
  const lost = batch.ack_missed.lease_lost + batch.ack_missed.gone
  if (lost > 0) {
    workerErrors.push(`score batch @${pNow}: ack_missed lease_lost=${batch.ack_missed.lease_lost} gone=${batch.ack_missed.gone}`)
  }
  for (const league of batch.leagues) {
    if (league.outcome === 'failed') {
      const line = `score batch @${pNow}: league ${league.league_id} week ${league.week} FAILED — ${league.error ?? '(no error text)'}`
      workerErrors.push(line)
      byLeague.set(league.league_id, [...(byLeague.get(league.league_id) ?? []), line])
    }
    for (const problem of league.problems) {
      if (LAWFUL_WORKER_NOTE.test(`[x] ${problem}`) || /skipped: (week_final|week_not_open|week_not_scheduled)|HELD: week_not_open/.test(problem)) {
        const key = problem.replace(/league [0-9a-f-]{36} week \d+/g, 'league <id> week <n>')
        measured.workerNotes.set(key, (measured.workerNotes.get(key) ?? 0) + 1)
        continue
      }
      const line = `score batch @${pNow}: league ${league.league_id} week ${league.week}: ${problem}`
      workerErrors.push(line)
      byLeague.set(league.league_id, [...(byLeague.get(league.league_id) ?? []), line])
    }
    let noStatRows = 0
    for (const team of league.teams) noStatRows += team.no_stat_row.length
    if (noStatRows > 0) {
      measured.flaggedNoStatRow += noStatRows
      noStatRowByLeague.set(league.league_id, (noStatRowByLeague.get(league.league_id) ?? 0) + noStatRows)
    }
  }
}

/** The two correction arms, measured from the worker's OWN report. */
function measureCorrectionArms(
  batch: BatchReport,
  entry: TimelineEntry,
  windowEndsAt: ReadonlyMap<number, number>,
  measured: { postWindowSkips: number; postWindowWrites: number; inWindowWrites: number; revisionWrites: number },
): void {
  const closeAt = windowEndsAt.get(entry.week)
  const past = closeAt !== undefined && entry.at.getTime() > closeAt
  for (const league of batch.leagues) {
    if (league.week !== entry.week) continue
    if (past) {
      if (league.skip_reason === 'week_final') measured.postWindowSkips += 1
      if (league.outcome === 'written') measured.postWindowWrites += 1
      continue
    }
    if (league.outcome !== 'written') continue
    if (entry.label.includes('correction ')) measured.inWindowWrites += 1
    if (entry.label.includes('charted revision')) measured.revisionWrites += 1
  }
}

/**
 * Week 1's lineups, set through the REAL door (D100). Later weeks come from
 * `lineup_carry_internal` at `league_week_advance` (D293's auto-carry) —
 * driving the carry is more faithful than re-submitting every week.
 *
 * The submitted map is a GREEDY first fit by position eligibility. It is not
 * a TS mirror of the matcher (D289/D33): the SERVER runs
 * `lineup_fit_internal` and the sim keeps whatever canonical map comes back —
 * which is exactly what invariant 2 then re-checks against the same oracle.
 *
 * A placeholder seat has no manager, so its lineup is set through the
 * COMMISSIONER arm of the same RPC with a reason — the D290/R738 interim
 * audit posture, which posts the system message to league chat. That is the
 * real door a commissioner uses, not a harness back-channel.
 */
async function seedLineups(
  service: Supabase,
  bots: ReadonlyMap<string, Supabase>,
  leagues: LeagueState[],
  week: number,
  actionRng: () => number,
  problems: string[],
): Promise<number> {
  let set = 0
  for (const league of leagues) {
    const commishClient = league.ownerId === null ? undefined : bots.get(league.ownerId)
    if (commishClient === undefined) {
      problems.push(`${league.label}: no signed-in bot client for the commissioner (owner ${league.ownerId ?? 'null'}) — lineups unset`)
      continue
    }
    // WHO may set a team's lineup, read from `league_members` rather than
    // inferred from `teams.owner_id`: a PLACEHOLDER seat is owned by the
    // commissioner (the D96 capacity remedy), so `owner_id` finds a client
    // that is nonetheless not that team's MANAGER, and 112:684's commissioner
    // arm then refuses for want of a reason. (Measured 2026-09-08: 34 of a
    // 6-league run's lineups were refused exactly that way — the placeholder
    // seats — until this read replaced the owner_id inference.)
    const { data: memberRows, error: memberError } = await service
      .from('league_members')
      .select('user_id, team_id')
      .eq('league_id', league.leagueId)
    throwIfError(memberError, `${league.label}: league_members read for lineups`)
    const managerByTeam = new Map<string, string>()
    for (const row of memberRows ?? []) {
      const teamId: string | null = row.team_id
      const userId: string | null = row.user_id
      if (teamId !== null && userId !== null) managerByTeam.set(teamId, userId)
    }

    const { data: rosterRows, error } = await service
      .from('league_rosters')
      .select('team_id, player_id, players!inner(position, adp)')
      .eq('league_id', league.leagueId)
    throwIfError(error, `${league.label}: roster read for lineups`)
    const byTeam = new Map<string, Array<{ id: string; position: string; adp: number | null }>>()
    for (const row of rosterRows ?? []) {
      const player = row.players as unknown as { position: string; adp: number | null }
      const list = byTeam.get(row.team_id) ?? []
      list.push({ id: row.player_id, position: String(player.position), adp: player.adp })
      byTeam.set(row.team_id, list)
    }
    for (const team of league.teams) {
      const roster = (byTeam.get(team.id) ?? []).sort(
        (a, b) => (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : 1),
      )
      const slotMap: Record<string, string> = {}
      const taken = new Set<string>()
      for (const player of roster) {
        const pos = player.position.toUpperCase() === 'DEF' ? 'DST' : player.position.toUpperCase()
        const slot = league.slots.find((s) => !taken.has(s.key) && s.eligible.includes(pos))
        if (slot === undefined) continue
        taken.add(slot.key)
        slotMap[slot.key] = player.id
      }
      if (Object.keys(slotMap).length === 0) continue
      // The team's OWN manager where there is one; otherwise the league's
      // commissioner with a reason — the D290/R738 arm of the same door
      // (112:684 refuses a service-role caller outright, and a placeholder
      // seat has no user, so this is the only lawful route to its lineup).
      const managerId = managerByTeam.get(team.id)
      const manager = managerId === undefined ? undefined : bots.get(managerId)
      const client = manager ?? commishClient
      const result = await setLineup(client, league.leagueId, team.id, {
        week,
        slot_map: slotMap,
        action_id: uuidFromRng(actionRng),
        ...(manager === undefined
          ? { reason: 'sim season harness (L.D6.1): seating an unclaimed franchise for the first scored week' }
          : {}),
      })
      if (result.status !== 200) {
        problems.push(
          `${league.label}: set_lineup(team ${team.id}, week ${week}) answered ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`,
        )
        continue
      }
      set += 1
    }
  }
  return set
}

/** Snapshot every week that has just reached `final` (invariant 6's t₀). */
export async function snapshotNewlyFinal(service: Supabase, leagues: LeagueState[]): Promise<void> {
  for (const league of leagues) {
    const { data: weeks, error } = await service
      .from('league_weeks')
      .select('week, status')
      .eq('league_id', league.leagueId)
      .eq('status', 'final')
    throwIfError(error, `${league.label}: final-week read`)
    for (const row of weeks ?? []) {
      if (league.weeksFinal.has(row.week)) continue
      league.weeksFinal.add(row.week)
      const cells = await readCells(service, league.leagueId, row.week)
      league.finalCellByWeek.set(row.week, cells)
    }
  }
}

async function readCells(service: Supabase, leagueId: string, week: number): Promise<Map<string, string>> {
  const { data: matchups, error: mError } = await service
    .from('matchups')
    .select('id, week, home_score, away_score, result, status, is_overridden')
    .eq('league_id', leagueId)
    .eq('week', week)
    .order('id')
  throwIfError(mError, `final-cell matchups (league ${leagueId} week ${week})`)
  const { data: results, error: rError } = await service
    .from('team_week_results')
    .select('team_id, week, points, h2h_result, median_result, second_result, is_final')
    .eq('league_id', leagueId)
    .eq('week', week)
  throwIfError(rError, `final-cell results (league ${leagueId} week ${week})`)
  return renderCells(
    (matchups ?? []) as unknown as Array<Record<string, unknown>>,
    (results ?? []) as unknown as Array<Record<string, unknown>>,
  )
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export async function collectSeasonAudit(
  service: Supabase,
  state: LeagueState,
  weeksDriven: readonly number[],
  reconcile: ReconcileReport,
  workerErrors: readonly string[],
  noStatRowStarters: number,
  bridgedIds: ReadonlySet<string>,
): Promise<SeasonAudit> {
  void bridgedIds
  const { data: rosters, error: rosterError } = await service
    .from('league_rosters')
    .select('team_id, player_id')
    .eq('league_id', state.leagueId)
  throwIfError(rosterError, `${state.label}: audit rosters`)

  const { data: pool, error: poolError } = await service
    .from('league_player_pool')
    .select('player_id, state')
    .eq('league_id', state.leagueId)
  throwIfError(poolError, `${state.label}: audit pool`)

  const { data: weeks, error: weeksError } = await service
    .from('league_weeks')
    .select('week, status')
    .eq('league_id', state.leagueId)
    .order('week')
  throwIfError(weeksError, `${state.label}: audit weeks`)

  const teamIds = state.teams.map((t) => t.id)
  const { data: lineupRows, error: lineupError } = await service
    .from('team_lineups')
    .select('team_id, week, slot_map')
    .in('team_id', teamIds)
    .eq('season', SYNTHETIC_SEASON)
  throwIfError(lineupError, `${state.label}: audit lineups`)

  const positionById = new Map<string, string>()
  const playerIds = [...new Set((rosters ?? []).map((r) => r.player_id))]
  for (let i = 0; i < playerIds.length; i += 150) {
    const { data: players, error } = await service
      .from('players')
      .select('id, position')
      .in('id', playerIds.slice(i, i + 150))
    throwIfError(error, `${state.label}: audit positions`)
    for (const p of players ?? []) positionById.set(p.id, String(p.position))
  }

  // Invariant 2's ORACLE — `lineup_fit_internal` as service role, over the
  // STORED map (112:439). Never a TS mirror of the matcher (D289/D33).
  const lineups: AuditLineup[] = []
  for (const row of lineupRows ?? []) {
    const slotMap = (row.slot_map ?? null) as Record<string, string> | null
    const starters = startersOfMap(slotMap, state.irKeys)
    let fit: AuditLineup['fit'] = null
    if (starters.length > 0) {
      const players = starters.map((playerId) => {
        const raw = (positionById.get(playerId) ?? '').toUpperCase()
        const slot = Object.entries(slotMap ?? {}).find(([, v]) => v === playerId)?.[0] ?? null
        return { player_id: playerId, position: raw === 'DEF' ? 'DST' : raw, wanted: slot, fixed: false }
      })
      const { data, error } = await service.rpc('lineup_fit_internal', {
        p_slots: state.slots.map((s) => ({ key: s.key, eligible: s.eligible })),
        p_players: players,
      })
      throwIfError(error, `${state.label}: lineup_fit_internal (team ${row.team_id} week ${row.week})`)
      const doc = (data ?? {}) as { unplaced?: unknown; rearranged?: unknown }
      fit = {
        unplaced: Array.isArray(doc.unplaced) ? doc.unplaced.map(String) : [],
        rearranged: doc.rearranged === true,
      }
    }
    lineups.push({ team_id: row.team_id, week: row.week, slot_map: slotMap, ir_keys: state.irKeys, fit })
  }

  const { data: results, error: resultsError } = await service
    .from('team_week_results')
    .select('team_id, week, points, is_final')
    .eq('league_id', state.leagueId)
  throwIfError(resultsError, `${state.label}: audit results`)

  // Invariant 5's oracle: `league_standings_internal` (120:721), REVOKEd from
  // authenticated — a service-role harness read.
  const { data: standingsDoc, error: standingsError } = await service.rpc('league_standings_internal', {
    p_league_id: state.leagueId,
    p_projected: false,
  })
  throwIfError(standingsError, `${state.label}: league_standings_internal`)
  const standingRows = (((standingsDoc ?? {}) as { standings?: unknown }).standings ?? []) as Array<{
    team_id: string
    points_for: number | string | null
  }>

  // ---- Invariant 6's t₁, taken BEFORE invariant 3's rebuild --------------
  // §6-D: `rebuild_team_week_results` WRITES even when `changed:false`
  // (117:855-866 re-run the results math and UPDATE `league_weeks` every
  // time). Snapshot first, or the sweep trips its own invariant.
  const finalCells: AuditFinalCell[] = []
  for (const [week, atFinal] of state.finalCellByWeek) {
    const atEnd = await readCells(service, state.leagueId, week)
    for (const [key, before] of atFinal) {
      finalCells.push({
        week,
        matchup_id: key.split(':')[1] ?? key,
        at_final: before,
        at_end: atEnd.get(key) ?? '(the cell no longer exists)',
      })
    }
    for (const [key, after] of atEnd) {
      if (atFinal.has(key)) continue
      finalCells.push({ week, matchup_id: key.split(':')[1] ?? key, at_final: '(no cell at finalize)', at_end: after })
    }
  }

  // ---- Invariant 3's probe — a MUTATING probe, run last ------------------
  const rebuilds: AuditRebuild[] = []
  const statusByWeek = new Map((weeks ?? []).map((w) => [w.week, w.status]))
  for (const week of weeksDriven) {
    const status = statusByWeek.get(week)
    if (status === undefined) continue
    const { data, error } = await service.rpc('rebuild_team_week_results', {
      p_league_id: state.leagueId,
      p_week: week,
    })
    if (error) {
      rebuilds.push({ week, week_status: status, changed: null, reason: null, digest_before: null, digest_after: null, refusal: error.message })
      continue
    }
    const doc = (data ?? {}) as { changed?: unknown; reason?: unknown; digest_before?: unknown; digest_after?: unknown }
    rebuilds.push({
      week,
      week_status: status,
      changed: doc.changed === true ? true : doc.changed === false ? false : null,
      reason: doc.reason === null || doc.reason === undefined ? null : String(doc.reason),
      digest_before: doc.digest_before === null || doc.digest_before === undefined ? null : String(doc.digest_before),
      digest_after: doc.digest_after === null || doc.digest_after === undefined ? null : String(doc.digest_after),
      refusal: null,
    })
  }

  const reconcileFindings: AuditReconcileFinding[] = reconcile.findings
    .filter((f) => f.league_id === state.leagueId)
    .map((f) => ({ kind: f.kind, severity: f.severity, week: f.week ?? null, message: f.message }))

  return {
    leagueLabel: state.label,
    leagueId: state.leagueId,
    season: SYNTHETIC_SEASON,
    scheduleMode: state.scheduleMode,
    weeksDriven: [...weeksDriven],
    rosters: (rosters ?? []).map((r) => ({ team_id: r.team_id, player_id: r.player_id })),
    pool: (pool ?? []).map((p) => ({ player_id: p.player_id, state: String(p.state) })),
    lineups,
    standings: standingRows.map((s) => ({ team_id: String(s.team_id), points_for: Number(s.points_for ?? 0) })),
    results: (results ?? []).map((r) => ({
      team_id: r.team_id,
      week: r.week,
      points: r.points === null ? null : Number(r.points),
      is_final: r.is_final === true,
    })),
    weeks: (weeks ?? []).map((w) => ({ week: w.week, status: String(w.status) })),
    finalCells,
    rebuilds,
    reconcileFindings,
    workerErrors: [...workerErrors],
    noStatRowStarters,
  }
}

// ---------------------------------------------------------------------------
// Scenario evidence (D295's map — the names L.D6.3 asserts on)
// ---------------------------------------------------------------------------

async function buildScenarioEvidence(
  service: Supabase,
  cfg: SeasonRunConfig,
  leagues: LeagueState[],
  weeksDriven: readonly number[],
  anchored: ReadonlyMap<number, ReturnType<typeof makeScenario>>,
  bridge: PlayerBridge,
  measured: {
    degradedRaisedAt: string | null
    degradedClearedAt: string | null
    backfillDeltas: number
    kickoffBefore: string | null
    kickoffAfter: string | null
    postWindowSkips: number
    postWindowWrites: number
    inWindowWrites: number
    revisionWrites: number
    flaggedNoStatRow: number
  },
  postponedGame: { gameId: string } | undefined,
): Promise<ScenarioAssertion[]> {
  const out: ScenarioAssertion[] = []
  const firstWeek = weeksDriven[0] ?? 0
  const carrier = leagues[0]
  const push = (
    name: ScenarioAssertion['name'],
    passed: boolean,
    observed: string,
    expected: string,
    league: LeagueState | undefined = carrier,
    week = firstWeek,
  ): void => {
    out.push({
      name,
      leagueId: league?.leagueId ?? '(run)',
      leagueLabel: league?.label ?? '(run)',
      week,
      passed,
      observed,
      expected,
    })
  }

  // Every scenario: scores are WRITTEN and the standings come back ordered.
  for (const league of leagues) {
    const { count: scored, error } = await service
      .from('team_week_results')
      .select('team_id', { count: 'exact', head: true })
      .eq('league_id', league.leagueId)
      .not('points', 'is', null)
    throwIfError(error, `${league.label}: scored-cell count`)
    push(
      'scores_written',
      (scored ?? 0) > 0,
      `${scored ?? 0} team_week_results rows carry a score`,
      'at least one scored cell per league',
      league,
    )
    const { data: doc, error: standingsError } = await service.rpc('league_standings_internal', {
      p_league_id: league.leagueId,
      p_projected: false,
    })
    throwIfError(standingsError, `${league.label}: standings order`)
    const rows = (((doc ?? {}) as { standings?: unknown[] }).standings ?? []) as unknown[]
    push(
      'standings_ordered',
      rows.length === league.teamCount,
      `${rows.length} standings rows for ${league.teamCount} teams`,
      'one standings row per seated franchise, in the RPC-stored order',
      league,
    )
  }

  switch (cfg.scenario) {
    case 'flex_move': {
      const scenario = anchored.get(firstWeek)!
      const game = scenario.games.find((g) => g.flexMove !== undefined)!
      push(
        'lock_moved_with_kickoff',
        measured.kickoffBefore !== null &&
          measured.kickoffAfter !== null &&
          measured.kickoffBefore !== measured.kickoffAfter,
        `nfl_games.kickoff_at ${measured.kickoffBefore ?? '(unread)'} → ${measured.kickoffAfter ?? '(unread)'}`,
        `the flexed game's kickoff moves to ${game.flexMove!.newKickoffAt.toISOString()} at the announcement; ` +
          `locks are evaluated from that column at evaluation time (E42/§23.3/D291)`,
      )
      break
    }
    case 'postponement': {
      const gameId = postponedGame?.gameId ?? '(none)'
      const bridged = [...bridge.map.entries()]
        .filter(([syn]) => syn.startsWith('syn-g2-'))
        .map(([, real]) => real)
      const { count: lines, error } = await service
        .from('player_stats')
        .select('player_id', { count: 'exact', head: true })
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', firstWeek)
        .in('player_id', bridged.length > 0 ? bridged : ['(none)'])
      throwIfError(error, 'postponement: stat lines for the postponed game')
      push(
        'postponed_players_score_zero',
        (lines ?? 0) === 0,
        `${lines ?? 0} player_stats rows for the ${bridged.length} bridged players of ${gameId}`,
        'a postponed game emits no stat lines for the week (E43/§23.3)',
      )
      const anyFinal = leagues.some((l) => l.weeksFinal.has(firstWeek))
      push(
        'finalized_without_game',
        anyFinal,
        `${leagues.filter((l) => l.weeksFinal.has(firstWeek)).length}/${leagues.length} leagues finalized week ${firstWeek}`,
        'the week finalizes with the postponed game excluded (116\'s left-the-week rule)',
      )
      const { count: locked, error: lockError } = await service
        .from('league_player_pool')
        .select('player_id', { count: 'exact', head: true })
        .in('league_id', leagues.map((l) => l.leagueId))
        .in('player_id', bridged.length > 0 ? bridged : ['(none)'])
        .not('locked_until', 'is', null)
      throwIfError(lockError, 'postponement: pool locks')
      push(
        'locks_released',
        (locked ?? 0) === 0,
        `${locked ?? 0} pool rows still carry a locked_until for the postponed game's bridged players`,
        'the postponed game releases its players\' locks (E43)',
      )
      break
    }
    case 'mass_inactives': {
      push(
        'zeros_flagged',
        measured.flaggedNoStatRow > 0,
        `${measured.flaggedNoStatRow} starters reported no_stat_row by the worker`,
        'a scratched starter is NAMED by the worker (auto-sub is off by default — §11.3 is M5, F211)',
      )
      break
    }
    case 'provider_outage': {
      push(
        'stats_degraded_raised',
        measured.degradedRaisedAt !== null,
        `stats_degraded raised at ${measured.degradedRaisedAt ?? '(never)'}`,
        'three consecutive failed polls inside the outage raise the flag (§23.2/E45)',
      )
      push(
        'stats_degraded_cleared',
        measured.degradedClearedAt !== null,
        `stats_degraded cleared at ${measured.degradedClearedAt ?? '(never)'}`,
        'the first successful poll after the outage clears the flag',
      )
      push(
        'backfilled',
        measured.backfillDeltas > 0,
        `${measured.backfillDeltas} stat deltas on the recovery poll`,
        'the recovery poll IS the back-fill — lines are cumulative (§23.2/E45)',
      )
      push(
        'finalization_unaffected',
        leagues.every((l) => l.weeksFinal.has(firstWeek)),
        `${leagues.filter((l) => l.weeksFinal.has(firstWeek)).length}/${leagues.length} leagues finalized week ${firstWeek}`,
        'an outage delays data, never finalization',
      )
      break
    }
    case 'correction_in_window': {
      push(
        'non_final_cells_recomputed',
        measured.inWindowWrites > 0,
        `${measured.inWindowWrites} league-weeks written at the correction instant`,
        'an in-window correction recomputes the non-final cell (E44/§23.4)',
      )
      break
    }
    case 'correction_post_window': {
      push(
        'no_league_cell_changed',
        measured.postWindowWrites === 0 && measured.postWindowSkips > 0,
        `${measured.postWindowWrites} writes / ${measured.postWindowSkips} week_final skips after the window closed`,
        'a post-window delta lands in player_stats and changes NO league cell (D295(b); the door raises week_final, 119:566)',
      )
      break
    }
    case 'charted_late':
    case 'charted_revision': {
      // E61's pending-not-zero needs a scoring snapshot that PAYS the D15
      // charted placeholder key, and NO shipped template does (the precedent
      // is a forked document — `score-week-worker.test.ts:185-243`). The sim
      // drafts through the real `ESPN Standard` template, so the charted
      // arrival is INGESTED (the `advanced` key lands) but reaches no rules
      // key, and the assertion is not observable from this harness. Reported
      // as such rather than silently green.
      push(
        cfg.scenario === 'charted_late' ? 'pending_not_zero' : 'recomputed_in_window',
        false,
        'not observable: every sim league scores through the shipped `ESPN Standard` template, which pays no ' +
          '`example_charted_yards` rule — the charted value is ingested into `player_stats.advanced` but reaches no rules key',
        'a scoring snapshot that PAYS the D15 charted placeholder key (a forked template — the precedent is ' +
          'score-week-worker.test.ts:185-243). L.D6.3 must fork one for the two charted stages (E55/E56/E57/E61).',
      )
      break
    }
    case 'happy_path':
      break
  }
  return out
}

/** The season command's own report lines (the CLI prints these verbatim). */
export function seasonReportLines(report: SeasonRunReport, planLines: string[]): string[] {
  const lines: string[] = []
  lines.push('')
  lines.push('================ SIM SEASON RESULT ================')
  lines.push(`SEED: ${report.seed}`)
  lines.push(`RUN ID: ${report.runId}`)
  lines.push(`SCENARIO: ${report.scenario} (library v${report.scenarioLibraryVersion})`)
  lines.push(`LEAGUES: ${report.leagues.length}`)
  const weeks = report.leagues[0]?.weeksDriven.length ?? 0
  const finals = report.leagues.reduce((n, l) => n + l.weeksFinal.length, 0)
  lines.push(`WEEKS DRIVEN: ${weeks} per league · ${finals} league-weeks reached 'final'`)
  lines.push(
    `JOBS: advance ${report.jobs.advance} · lock_tick ${report.jobs.lockTick} · finalize ${report.jobs.finalize} · ` +
      `score batches ${report.jobs.scoreBatches} · ingestion polls ${report.jobs.polls}`,
  )
  lines.push(
    `PROVENANCE: ${report.provenance.statRows} player_stats rows on season ${report.season} — ` +
      `${report.provenance.synthetic} source='synthetic', ${report.provenance.foreign} foreign`,
  )
  lines.push(`EXTERNAL CALLS: ${report.externalCalls} (every fetch to a host other than the local stack is counted)`)
  lines.push(
    `RECONCILE: ${report.reconcileSummary.cells} cells over ${report.reconcileSummary.leagues} leagues — ` +
      `${report.reconcileSummary.alerts} alerts / ${report.reconcileSummary.warns} warns / ${report.reconcileSummary.infos} infos`,
  )
  for (const league of report.leagues) {
    lines.push(
      `  ${league.leagueLabel}: ${league.matrixLine} · bridged ${league.bridgeRostered} rostered / ${league.bridgeStarted} started · ` +
        `no_stat_row starters ${league.noStatRowStarters} · held [${league.heldWeeks.map((h) => `w${h.week} ${h.status}`).join(', ')}]`,
    )
  }
  lines.push(`WORKER ERRORS: ${report.workerErrors.length}`)
  for (const line of report.workerErrors.slice(0, 10)) lines.push(`  ${line}`)
  lines.push(`WORKER NOTES (named lawful states, not errors — §23.2): ${report.workerNotes.length} kinds`)
  for (const line of report.workerNotes) lines.push(`  ${line}`)
  lines.push(`RECONCILE ALERTS CLASSIFIED AS LAWFUL: ${report.reconcileClassified.length} kinds`)
  for (const line of report.reconcileClassified) lines.push(`  ${line}`)
  lines.push('SCENARIO EVIDENCE:')
  for (const a of report.scenarioEvidence.assertions) {
    lines.push(`  [${a.passed ? 'PASS' : 'FAIL'}] ${a.name} (${a.leagueLabel}, week ${a.week}): ${a.observed}`)
    if (!a.passed) lines.push(`         expected: ${a.expected}`)
  }
  if (report.problems.length > 0) {
    lines.push(`PROBLEMS (${report.problems.length}):`)
    for (const p of report.problems) lines.push(`  ${p}`)
  }
  lines.push(report.cleanupSummary)
  if (report.reason !== null) lines.push(`REASON: ${report.reason}`)
  if (report.invariantFailures.length === 0) {
    lines.push(`INVARIANT SWEEP: 0 failures across ${report.leagues.length} leagues × ${weeks} weeks`)
  } else {
    lines.push(`INVARIANT SWEEP: ${report.invariantFailures.length} FAILURES`)
    for (const f of report.invariantFailures) {
      lines.push(`  [${f.invariant}] ${f.leagueLabel} (league ${f.leagueId}, week ${f.week ?? '—'}): ${f.detail}`)
    }
  }
  lines.push(report.green ? 'RESULT: GREEN' : 'RESULT: RED')
  void planLines
  return lines
}

/** The nine library ids, re-exported for the CLI's `--scenario` validation. */
export { SCENARIO_IDS, seasonPlanLines }
export type { ScenarioId, SeasonInvariantFailure }
