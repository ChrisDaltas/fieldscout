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
import {
  CHARTED_PLACEHOLDER_KEY,
  SyntheticStatsProvider,
} from '../stats/synthetic/synthetic-stats-provider'
import { VirtualClock } from '../time/virtual-clock'

import { BLOCKING_DESIGNATIONS, simDesignation } from './designations'
import { ingestWeek, type IngestReport } from '@/lib/sync/ingest-week'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'

import { BOT_POOL_SIZE } from './plan'
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
  uncoveredClubs,
  withFullSlate,
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
  /** `settings.allow_illegal_lineups` AS STORED. FALSE is the D299 legality
   *  arm: §7.3.6 refuses a bye/OUT starter at the door, so `seedLineups` has
   *  to seat a lineup the server will actually accept (F286 / D328). */
  allowIllegalLineups: boolean
  /** `leagues.regular_season_weeks` AS STORED — invariant 5's window (R920). */
  regularSeasonWeeks: number
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

/** PostgREST puts an `in.(…)` list in the URI and Kong refuses a long one
 *  (D327(13): ~330 uuids was "URI too long"), so every id list is chunked. */
const LEAGUE_ID_CHUNK = 100

/**
 * Read a whole result set across the run's leagues — CHUNKED by league id and
 * PAGED past PostgREST's `max_rows` (1000, `supabase/config.toml:18`).
 *
 * R919 (PR #273 review). An unpaged read that crosses the cap comes back with
 * `error === null` and a silently truncated body, and BOTH callers here feed
 * consumers that infer lawfulness from ABSENCE — the `stuck_queue` exemption
 * set (a missing player id EXCUSES the alert) and the run's first-week floor.
 * Truncation there can only ever SILENCE a finding, which is exactly the
 * "never let 'nothing happened' mean 'it worked'" class CLAUDE.md records as
 * learned the hard way, and `readProvenance` in this same file already
 * refuses to read a null count as zero. So this pages with an exact count and
 * REFUSES the run loudly unless the pages add up to what the server counted.
 */
async function pageByLeague<T>(
  leagueIds: readonly string[],
  what: string,
  build: (part: string[], from: number, to: number) => PageResponse<T>,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < leagueIds.length; i += LEAGUE_ID_CHUNK) {
    const part = leagueIds.slice(i, i + LEAGUE_ID_CHUNK)
    const seen: { count: number | null } = { count: null }
    const rows = await pageAll<T>(async (from, to) => {
      const res = await build(part, from, to)
      if (res.count !== null && res.count !== undefined) seen.count = res.count
      return res
    })
    if (seen.count === null) {
      throw new Error(
        `${what}: PostgREST returned no count — refusing to read a possibly-truncated set as complete ` +
          `(${rows.length} rows over ${part.length} leagues)`,
      )
    }
    if (rows.length !== seen.count) {
      throw new Error(
        `${what}: paged ${rows.length} rows but the server counts ${seen.count} — refusing to read a ` +
          `truncated set as complete (PostgREST max_rows = 1000)`,
      )
    }
    out.push(...rows)
  }
  return out
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
    seasonPlanLines: [],
    bridgeLines: [],
    leagues: [],
    scenarioEvidence: { scenario: cfg.scenario, leagues: 0, assertions: [] },
    invariantFailures: [],
    jobs: { advance: 0, lockTick: 0, finalize: 0, scoreBatches: 0, polls: 0 },
    provenance: { statRows: 0, synthetic: 0, foreign: 0 },
    poolRows: 0,
    externalCalls: 0,
    workerErrors: [],
    reconcileSummary: { leagues: 0, cells: 0, counts: {}, alerts: 0, warns: 0, infos: 0 },
    reconcileClassified: [],
    workerNotes: [],
    cleanupSummary: '',
    censusBefore: '',
    censusAfter: '',
    problems: [],
    coverageGaps: seasonCoverageGaps(cfg.scenario),
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
    report.planLines = [...draft.planLines]
    report.seasonPlanLines = [...(draft.seasonPlanLines ?? [])]
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
    // PAGED + CHUNKED (R919): this set's only consumer EXCUSES a `stuck_queue`
    // alert for a player it does not contain, so a truncated read could only
    // ever silence a §22.3 drain failure. See `pageByLeague`'s banner.
    const rosteredRows = await pageByLeague<{ player_id: string }>(
      leagueStates.map((s) => s.leagueId),
      'sweep: rostered-player set',
      (part, from, to) =>
        service
          .from('league_rosters')
          .select('player_id, id', { count: 'exact' })
          .in('league_id', part)
          .order('id')
          .range(from, to),
    )
    const { data: postponedRows, error: postponedError } = await service
      .from('nfl_games')
      .select('id')
      .eq('season', SYNTHETIC_SEASON)
      .eq('status', 'postponed')
    throwIfError(postponedError, 'sweep: postponed games')
    applyReconcileSummary(report, reconcile, {
      drivenWeeks: new Set(driven.weeksDriven),
      rosteredPlayers: new Set(rosteredRows.map((r) => r.player_id)),
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
      )
      const failures = sweepSeasonAudit(audit)
      report.invariantFailures.push(...failures)
      // F300: MEASURE what invariant 4 had to work with. 0 means the
      // pool/roster mirror asserted nothing for this league.
      report.poolRows += audit.pool.length
      const bridgeCounts = audit.rosters.filter((r) => bridgedIds.has(r.player_id)).length
      const startedBridged = new Set<string>()
      for (const lineup of audit.lineups) {
        for (const p of startersOfMap(lineup.slot_map, lineup.ir_keys)) {
          if (bridgedIds.has(p)) startedBridged.add(`${lineup.team_id}:${lineup.week}:${p}`)
        }
      }
      const seating: LeagueSeating = driven.seatingByLeague.get(state.leagueId) ?? {
        seated: 0,
        refused: 0,
        emptySlots: 0,
        emptySlotKeys: {},
        benchedForLegality: 0,
        slotsFilled: 0,
      }
      const result: SeasonLeagueResult = {
        leagueLabel: state.label,
        leagueId: state.leagueId,
        teamCount: state.teamCount,
        scheduleMode: state.scheduleMode,
        allowIllegalLineups: state.allowIllegalLineups,
        lineupsSeated: seating.seated,
        lineupsRefused: seating.refused,
        lineupSlotsFilled: seating.slotsFilled,
        lineupSlotsLeftEmpty: seating.emptySlots,
        lineupEmptySlotKeys: { ...seating.emptySlotKeys },
        benchedForLegality: seating.benchedForLegality,
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
      // F288 / PROGRESS §3 Q45: an EMPTY starting slot is lawful (114:585-588
      // flags it and never blocks), but a run that leaves one has NOT
      // exercised that position's scoring rules for that team — and before
      // L.D6.3 the count was printed and entered nothing, so 71 of 96 filled
      // slots read as a fully seated league. It is a run PROBLEM now, named by
      // slot key: the honest failure mode of a gate whose job is certifying
      // that scoring works is a position it never scored.
      if (result.lineupSlotsLeftEmpty > 0) {
        report.problems.push(
          `${state.label}: ${result.lineupSlotsLeftEmpty} starting slot(s) left EMPTY across the week-1 lineups ` +
            `[${Object.entries(result.lineupEmptySlotKeys)
              .map(([key, n]) => `${key}×${n}`)
              .join(' ')}] — lawful at 114:585-588, but that position's scoring rules go unexercised for those ` +
            `teams. Either the draft cannot reach the position inside its ADP window (personas.ts ` +
            `\`bestForNeed\`/POOL_WINDOW) or a seat spent a pick it needed (F288).`,
        )
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
  // R949 TAKEN (#278 review). `report.workerErrors` was absent from the
  // conjunction below and read by no other failure path: invariant 7
  // (`checkNoWorkerErrors`) reads only `workerErrorsByLeague`, the PER-LEAGUE
  // map, while `absorbBatch` pushes its two BATCH-LEVEL lines — any
  // `batch.problems` line that is not a `LAWFUL_WORKER_NOTE`, and R869/R873's
  // `ack_missed lease_lost=… gone=…`, "the ONE window a stale write can land
  // in. Alert on both sides." — to the run-wide array and to NO league. Those
  // reached scrollback as `WORKER ERRORS: n` and reached nothing that could
  // fail. MEASURED before this change: a report carrying one still passed
  // `gate-m4-evidence.ts` at exit 0 under "all 9 scenarios green".
  //
  // Everything left in this array is already unclassified by construction —
  // `lawfulBracketSkip` and `LAWFUL_WORKER_NOTE` divert the lawful notes into
  // `workerNotes` first. A per-league line therefore now alarms twice (invariant
  // 7 AND here); that is two alarms for one real error, never a false one, and
  // it is the same both-sides posture the `ack_missed` comment asks for.
  // `gate-m4-evidence.ts` names them independently, so a refactor of this
  // function cannot silently un-enforce the class.
  if (report.workerErrors.length > 0) {
    report.problems.push(
      `WORKER ERRORS: ${report.workerErrors.length} unhandled worker error(s) — none of them a lawful ` +
        `note (those are classified into report.workerNotes). First: ${report.workerErrors[0]}`,
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
      // Q42 is OPEN and the §23.6 world publishes lines for EIGHTEEN players.
      // Since D328 the week's slate is COMPLETE (three §23.6 games + filler
      // games for every other club), so every starter has a final game and
      // all but the eighteen have no line, by construction. Counted, never
      // asserted on — this classification must not harden into a reading of
      // Q42, which is why the sweep asserts the worker's REPORT and never the
      // arithmetic consequence of either reading (D327(9)).
      return 'the §23.6 world publishes lines for 18 players — every other starter has a final game and no line, a lawful no_stat_row (Q42 OPEN)'
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
    .select(
      'roster_settings, settings, owner_id, regular_season_weeks, scoring_system_id, scoring_systems(name, is_template)',
    )
    .eq('id', leagueId)
    .single()
  throwIfError(leagueError, `${label}: league shape`)
  // R920: the oracle's window comes from the STORED column, and a missing one
  // is refused rather than defaulted — a wrong window silently changes what
  // invariant 5 compares.
  const regularSeasonWeeks = league!.regular_season_weeks
  if (typeof regularSeasonWeeks !== 'number' || !Number.isInteger(regularSeasonWeeks) || regularSeasonWeeks < 1) {
    throw new Error(
      `${label}: leagues.regular_season_weeks is ${String(regularSeasonWeeks)} — invariant 5's window cannot be derived`,
    )
  }
  const roster = (league!.roster_settings ?? {}) as {
    starting_slots?: Array<{ key: string; eligible: string[]; count: number }>
    ir_slots?: Array<{ key: string }>
  }
  const slots: Array<{ key: string; eligible: string[] }> = []
  for (const slot of roster.starting_slots ?? []) {
    for (let i = 0; i < slot.count; i++) slots.push({ key: `${slot.key}:${i}`, eligible: slot.eligible })
  }
  const settings = (league!.settings ?? {}) as Record<string, unknown>
  // D299's parity-template axis, READ BACK from the row rather than echoed
  // from the plan: `is_template = false` means this league scores through its
  // OWN forked document (§7.3.3.1), which is the arm the matrix draws once.
  const scoring = (league as unknown as {
    scoring_systems?: { name?: string | null; is_template?: boolean | null } | null
  }).scoring_systems
  const scoringName = scoring?.name ?? '(unnamed)'
  const scoringForked = scoring?.is_template === false
  const scheduleMode = settings.schedule_mode === 'total_points' ? 'total_points' : 'h2h'
  // The column's DEFAULT is TRUE (§7.3.6), so only an explicit `false` turns
  // legality enforcement ON — read exactly the way `matrixLine` renders it.
  const allowIllegalLineups = settings.allow_illegal_lineups !== false
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
    allowIllegalLineups,
    regularSeasonWeeks,
    matrixLine:
      `${teamCount} teams · ${scheduleMode} · median ${settings.median_game === true ? 'on' : 'off'} · ` +
      `second ${settings.second_opponent === true ? 'on' : 'off'} · ` +
      `illegal-lineups ${settings.allow_illegal_lineups === false ? 'off' : 'on'} · ` +
      `scoring ${scoringName}${scoringForked ? ' (FORKED §7.3.3.1)' : ''}`,
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
  seatingByLeague: Map<string, LeagueSeating>
  /** The published slate: the scenario's own games plus the filler slate the
   *  week is completed with (F286/D328), for the run banner. */
  slate: { coreGames: number; fillerGames: number; clubs: readonly string[] }
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
  const seatingByLeague = new Map<string, LeagueSeating>()
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
  // PAGED + CHUNKED (R919): a season league holds 12-18 `league_weeks` rows,
  // so the §22.6 100-league gate crosses the 1000-row cap on its own — and a
  // truncated read here would silently move the run's first week.
  const leagueWeekRows = await pageByLeague<{ league_id: string; week: number }>(
    leagueIds,
    'season: league_weeks read',
    (part, from, to) =>
      service
        .from('league_weeks')
        .select('league_id, week, id', { count: 'exact' })
        .in('league_id', part)
        .order('id')
        .range(from, to),
  )
  const firstWeek = Math.min(...leagueWeekRows.map((r) => r.week))
  if (!Number.isFinite(firstWeek)) throw new Error('season: no league_weeks rows — the drafts did not complete')
  const weeksDriven: number[] = []
  for (let w = firstWeek; w < firstWeek + cfg.weeks; w++) {
    if (weekRows.has(w)) weeksDriven.push(w)
  }
  // R920: the oracle's boundary, per league — `v_first + regular_season_weeks
  // − 1` (118:641-643). A week past it is a BRACKET week, which is the only
  // place the door's `no_matchup_row` skip is a lawful note rather than a
  // finding.
  const lastRegularWeek = new Map(leagues.map((l) => [l.leagueId, firstWeek + l.regularSeasonWeeks - 1]))

  // ---- One anchored scenario + one provider per driven week --------------
  // TWO objects, deliberately kept apart (F286 / D328). `anchored` is the
  // CORE §23.6 scenario, re-anchored and bridged: it is what every beat, every
  // timeline instant, every assertion and the week's `close` are computed
  // from, so the filler slate cannot move any of them by construction rather
  // than by convention. `published` is that same scenario plus one filler game
  // for every club the library does not play, and it reaches ONE consumer —
  // the `SyntheticStatsProvider`, i.e. `getSchedule`, i.e. `nfl_games`.
  const anchored = new Map<number, ReturnType<typeof makeScenario>>()
  const published = new Map<number, ReturnType<typeof makeScenario>>()
  let slate = { coreGames: 0, fillerGames: 0, clubs: [] as readonly string[] }
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
    const full = withFullSlate(scenario)
    published.set(week, full.scenario)
    slate = { coreGames: scenario.games.length, fillerGames: full.fillerGameIds.length, clubs: full.clubs }
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
      seatingByLeague: new Map(),
      slate,
      evidence: { scenario: cfg.scenario, leagues: 0, assertions },
      workerNotes: [],
      problems,
    }
  }

  log(`SCENARIO LIBRARY: v${base.version} · season ${SYNTHETIC_SEASON} · weeks ${weeksDriven[0]}..${weeksDriven[weeksDriven.length - 1]} · ${timeline.length} instants`)
  log(
    `PUBLISHED SLATE: ${slate.coreGames} §23.6 game(s) + ${slate.fillerGames} filler game(s) per week — ` +
      `${slate.clubs.length} club(s) play (a club with NO game reads on_bye at §7.3.6 — F286/D328, and ` +
      `seedLineups refuses the run if a league rosters one); the driver's timeline is built from the ` +
      `§23.6 games ALONE`,
  )

  // ---- ONE clock for the whole season (step-driven, monotonic) ----------
  const clock = new VirtualClock(timeline[0]!.at)
  const degradation = new DegradationTracker()
  const providers = new Map<number, SyntheticStatsProvider>()
  // The PUBLISHED scenario — the only place the filler slate is used.
  for (const [week, scenario] of published) providers.set(week, new SyntheticStatsProvider(scenario, clock))
  const lastPollByWeek = new Map<number, string>()
  const lastPollCompletedAt = async (season: number, week: number): Promise<string | null> =>
    season === SYNTHETIC_SEASON ? (lastPollByWeek.get(week) ?? null) : null

  const measured = {
    degradedRaisedAt: null as string | null,
    degradedClearedAt: null as string | null,
    backfillDeltas: 0,
    kickoffBefore: null as string | null,
    kickoffAfter: null as string | null,
    // ── E42, read as a LOCK and not as a schedule datum (Q5/F287-adjacent) ──
    // `flex_move` moves G3 EARLIER. Between the NEW kickoff and the ORIGINAL
    // one there is a window in which the flexed clubs' players are locked
    // under the flexed schedule and would NOT be under the original — so
    // sampling `league_player_pool.locked_until` there asserts the LOCK
    // moved, not merely that `nfl_games.kickoff_at` did. Locks are evaluated
    // from that column at evaluation time (§23.3/D291), never precomputed.
    /** Sampled BEFORE the earlier of the two kickoffs (the discriminator:
     *  a sampler that always says LOCKED would fail here). */
    flexLockBefore: null as string | null,
    /** Sampled INSIDE [new kickoff, original kickoff) — the span in which the
     *  moved schedule locks and the original one would not. */
    flexLockInside: null as string | null,
    flexLockInsideLocked: 0,
    flexLockInsideClubs: 0,
    flexLockBeforeLocked: 0,
    flexLockWindow: null as string | null,
    /** E43: the POSTPONED clubs and a CONTROL club, read from the same oracle
     *  at the same instant — the control is what makes "not locked" evidence
     *  rather than an oracle that answers `false` to everything. */
    postponedLockAt: null as string | null,
    postponedLockDetail: null as string | null,
    /** F289: what §7.3.6 actually reads for the postponed clubs. */
    postponedByeDetail: null as string | null,
    postponedLocked: 0,
    postponedClubs: 0,
    controlLocked: 0,
    controlClubs: 0,
    // ── The two charted arms, measured at league level (F283/Q44) ──────────
    chartedPostInstant: null as string | null,
    chartedSlaInstant: null as string | null,
    /** `player_stats` rows on the week carrying the charted key AFTER the post. */
    chartedAdvancedRows: 0,
    /** The charted arrival's own diff: rows the poll wrote / rows it enqueued. */
    chartedDeltas: 0,
    chartedEnqueued: 0,
    /** Leagues the drain WROTE at or after the charted arrival. A charted key
     *  pays nothing in any shipped template, so this must stay 0. */
    chartedDrainWrites: 0,
    /** Leagues the drain RECOMPUTED at or after the arrival — `written` OR
     *  `no_change`. `no_change` is the outcome a charted delta must produce
     *  (score-week-worker.ts:1041): the worker really ran and the total really
     *  did not move. Zero here would mean the delta never reached the worker,
     *  which is a different (and worse) reading than "changed nothing". */
    chartedDrainRecomputes: 0,
    /** Queue rows the ack DELETED at or after the arrival (the delta drained). */
    chartedDrained: 0,
    /** team_week_results cells compared across the charted instant, and how
     *  many changed VALUE. No rules key pays a charted key, so this must be 0. */
    chartedCellsCompared: 0,
    chartedCellsChanged: 0,
    /** The revision arm: the charted value before and after the +9 revision. */
    chartedValueBefore: null as number | null,
    chartedValueAfter: null as number | null,
    chartedRevisionInWindow: null as boolean | null,
    /** The delta the scenario DECLARES for the revision (§23.6), so the arm
     *  asserts the stored value moved by exactly it, never merely "moved". */
    chartedRevisionDelta: null as number | null,
    postWindowSkips: 0,
    postWindowWrites: 0,
    postWindowWriteDetail: [] as string[],
    /** Post-window writes whose `league_weeks.status` was ALREADY `final` when
     *  read back — a real D295(b) breach, distinct from a write to a week the
     *  door lawfully found still open (§3 Q47). */
    postWindowWroteFinalWeek: 0,
    /**
     * Post-window writes to a week that is NOT final and that the FINALIZE
     * JOB'S OWN oracles cannot explain — no games-not-final hold, no pending
     * cell. F302/§3 Q47: a lawful hold is classifiable BY THE JOB'S REASON;
     * anything else is unexplained and fails the arm rather than being named
     * and waved through.
     */
    postWindowWroteUnexplained: 0,
    /** (leagueId, week) of each post-window write, for the status read-back. */
    postWindowWritePairs: [] as Array<{ leagueId: string; week: number }>,
    inWindowWrites: 0,
    revisionWrites: 0,
    flaggedNoStatRow: 0,
    // R921: WHICH players the worker named, not just how many. The run-wide
    // COUNT is > 0 in every scenario by construction (18 bridged players, a
    // full real draft pool), so it cannot discriminate `mass_inactives` from
    // `happy_path`; the ids can.
    flaggedNoStatRowIds: new Set<string>(),
    // week → the teams the worker RECOMPUTED that week (D328). The
    // observability precondition for the `mass_inactives` arm.
    recomputedTeamsByWeek: new Map<number, Set<string>>(),
    lineupsSet: 0,
    workerNotes: new Map<string, number>(),
  }
  const flexGame = anchored.get(weeksDriven[0]!)!.games.find((g) => g.flexMove !== undefined)
  const postponedGame = anchored.get(weeksDriven[0]!)!.games.find((g) => g.postponement !== undefined)
  // The SLIPPED charted feed, DERIVED (never a hard-coded game id): the one
  // game whose charted post lands after its own SLA. That slip IS `charted_late`'s
  // observable (scenarios.ts:193-198 — the SLA stays Monday, the post moves).
  const chartedLateGame = anchored
    .get(weeksDriven[0]!)!
    .games.find((g) => g.chartedPostAt.getTime() > g.chartedSlaAt.getTime())
  const chartedRevision = anchored.get(weeksDriven[0]!)!.chartedRevisions[0]
  // Which real player ids carry a charted value for the watched arm. The
  // scenario is already ANCHORED, so these are real `players.id`s.
  const chartedWatchIds =
    chartedRevision !== undefined
      ? [chartedRevision.playerId]
      : chartedLateGame === undefined
        ? []
        : anchored
            .get(weeksDriven[0]!)!
            .players.filter((pl) => pl.gameId === chartedLateGame.gameId)
            .map((pl) => pl.playerId)
  measured.chartedRevisionDelta = chartedRevision?.delta ?? null
  const flexClubs = flexGame === undefined ? [] : [flexGame.awayTeam, flexGame.homeTeam]
  const postponedClubs = postponedGame === undefined ? [] : [postponedGame.awayTeam, postponedGame.homeTeam]
  // The CONTROL for E43: a club whose game the scenario does NOT postpone.
  // Without it "the postponed clubs are not locked" is indistinguishable from
  // "the oracle says nothing is ever locked" (CLAUDE.md's four-bug shape).
  const controlGame =
    postponedGame === undefined
      ? undefined
      : anchored.get(weeksDriven[0]!)!.games.find((g) => g.postponement === undefined && g.gameId !== postponedGame.gameId)
  const controlClubs = controlGame === undefined ? [] : [controlGame.awayTeam, controlGame.homeTeam]
  const windowEndsAt = new Map(
    weeksDriven.map((w) => [w, Date.parse(weekRows.get(w)!.correction_window_ends_at!)]),
  )

  const actionRng = deriveStream(cfg.seed, `season:lineups:${deps.runTag}`)
  let seedLineupsAfterPoll = false
  // Set at the charted arrival; every LATER drain of the same week is counted
  // toward it. 122's ack DEFERS a held/not-ready row for a beat (R872), so the
  // recompute a charted delta provokes lands at a LATER instant than the poll
  // that enqueued it — counting only the arrival instant reported 0 writes and
  // would have made the arm a false red (measured 2026-09-08).
  let chartedArrivedAtMs: number | null = null
  let chartedCellsBefore: Map<string, string> | null = null

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

    // ---- The charted arms' BEFORE side (F283/Q44) ------------------------
    // A charted arrival must move `player_stats.advanced` and NOT a league
    // cell: `example_charted_yards` is the registry's only charted-tier key
    // and it is `scoring_surface: 'reserved'` (stat-keys.ts:204), which spec
    // §23.5 (spec:2200) forbids in a format-2 document and 103/104 refuse at
    // the write wall. So the cells are read either side of the instant and
    // the CHANGED count must be 0 — measured, never assumed.
    const isChartedPost =
      chartedLateGame !== undefined &&
      entry.week === weeksDriven[0] &&
      entry.label.includes(`charted posted ${chartedLateGame.gameId}`)
    const isChartedRevision =
      chartedRevision !== undefined &&
      entry.week === weeksDriven[0] &&
      entry.label.includes('charted revision ')
    if (isChartedPost || isChartedRevision) {
      chartedCellsBefore = await readLeagueCells(service, leagueIds, entry.week)
      const before = await readChartedAdvanced(service, chartedWatchIds, entry.week)
      measured.chartedValueBefore =
        chartedRevision === undefined
          ? null
          : (before.valueByPlayer.get(chartedRevision.playerId) ?? null)
      chartedArrivedAtMs = entry.at.getTime()
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
    absorbBatch(batch, pNow, workerErrors, workerErrorsByLeague, noStatRowByLeague, measured, lastRegularWeek)
    const postWindowSeen = measured.postWindowWritePairs.length
    measureCorrectionArms(batch, entry, windowEndsAt, measured)
    // READ BACK the week's own status for every post-window write, at the
    // instant it happened. The door's report cannot answer the question that
    // matters — it says it WROTE, not what the week's status was — and
    // "the door wrote a FINAL week" is a D295(b) breach while "the door wrote
    // a week that is lawfully still open" is §3 Q47's gap. Only the table
    // distinguishes them, and only right now (a later read sees the finalize).
    for (let i = postWindowSeen; i < measured.postWindowWritePairs.length; i++) {
      const pair = measured.postWindowWritePairs[i]!
      const { data: weekRow, error: weekError } = await service
        .from('league_weeks')
        .select('status')
        .eq('league_id', pair.leagueId)
        .eq('week', pair.week)
        .maybeSingle()
      throwIfError(weekError, `post-window write: league_weeks status (${pair.leagueId} week ${pair.week})`)
      const status = String(weekRow?.status ?? '(no row)')
      if (status === 'final') measured.postWindowWroteFinalWeek += 1
      // CLASSIFY the still-open week with the FINALIZE JOB'S OWN REASON, at the
      // same instant, from the same two oracles `finalize_matchups` consults —
      // `week_games_state_internal` (118:2054, guard 1) and
      // `week_results_pending_internal` (118:2074, guard 2). F302's cause is
      // ESTABLISHED and reproducible: both guards `CONTINUE` and leave the week
      // `correction_window` (118:2073, in so many words), and 119:570 admits
      // exactly that status. So a post-window write to a HELD week is the
      // lawful-hold shape §3 Q47 asks Chris to rule on — and one to a week that
      // is neither final nor held is UNEXPLAINED, and fails the arm.
      const hold = status === 'final' ? null : await readFinalizeHold(service, pair.leagueId, pair.week)
      if (status !== 'final' && hold !== null && hold.reason === null) {
        measured.postWindowWroteUnexplained += 1
      }
      measured.postWindowWriteDetail[i] =
        `${measured.postWindowWriteDetail[i]} league_weeks.status=${status}` +
        (hold === null ? '' : ` finalize-hold=${hold.detail}`)
    }

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
      // E42 read as a LOCK, at evaluation time. Between the NEW kickoff and
      // the ORIGINAL one the flexed clubs' players are locked under the moved
      // schedule and would NOT be under the original one — so a sample here
      // asserts the lock followed the kickoff, not merely that the schedule
      // datum changed (§23.3/D291; the postponement arm's read shape).
      const newKickoff = flexGame.flexMove!.newKickoffAt.getTime()
      const originalKickoff = flexGame.kickoffAt.getTime()
      const lo = Math.min(newKickoff, originalKickoff)
      const hi = Math.max(newKickoff, originalKickoff)
      measured.flexLockWindow = `${new Date(lo).toISOString()} .. ${new Date(hi).toISOString()}`
      if (entry.at.getTime() < lo && entry.at.getTime() >= announce) {
        // The LAST pre-window sample wins: nearest to the boundary, and still
        // open under BOTH schedules.
        const locks = await readClubLocks(service, entry.week, flexClubs, pNow)
        measured.flexLockBefore = `${pNow} ${locks.detail}`
        measured.flexLockBeforeLocked = locks.locked
      } else if (entry.at.getTime() >= lo && entry.at.getTime() < hi && measured.flexLockInside === null) {
        const locks = await readClubLocks(service, entry.week, flexClubs, pNow)
        measured.flexLockInside = `${pNow} ${locks.detail}`
        measured.flexLockInsideLocked = locks.locked
        measured.flexLockInsideClubs = locks.clubs
      }
    }

    // E43: the postponed clubs' lock, read from the same oracle as the flexed
    // one, at the first instant at-or-after the ORIGINAL kickoff — the instant
    // at which they WOULD have locked had the game stayed in the week. Read
    // beside a CONTROL game's clubs, which must read LOCKED at that same
    // instant, so "open" is evidence and not an oracle stuck at false.
    if (postponedGame !== undefined && entry.week === weeksDriven[0] && measured.postponedLockAt === null) {
      if (entry.at.getTime() >= postponedGame.kickoffAt.getTime()) {
        const off = await readClubLocks(service, entry.week, postponedClubs, pNow)
        const on = await readClubLocks(service, entry.week, controlClubs, pNow)
        measured.postponedLockAt = pNow
        measured.postponedLockDetail = `postponed[${off.detail}] control[${on.detail}]`
        measured.postponedByeDetail = await readByeState(service, entry.week, postponedClubs, pNow)
        measured.postponedLocked = off.locked
        measured.postponedClubs = off.clubs
        measured.controlLocked = on.locked
        measured.controlClubs = on.clubs
      }
    }

    // ---- The charted arms' AFTER side (F283/Q44) -------------------------
    // Every drain from the charted arrival onward, in the same week (see
    // `chartedArrivedAtMs` — 122's deferral moves the write off the arrival
    // instant). In both charted scenarios the arrival is the LAST stat event
    // of the week, so a write counted here is the charted delta's.
    if (chartedArrivedAtMs !== null && entry.week === weeksDriven[0] && chartedCellsBefore !== null) {
      measured.chartedDrainWrites += batch.leagues.filter(
        (l) => l.week === entry.week && l.outcome === 'written',
      ).length
      measured.chartedDrainRecomputes += batch.leagues.filter(
        (l) => l.week === entry.week && (l.outcome === 'written' || l.outcome === 'no_change'),
      ).length
      measured.chartedDrained += batch.drained
      // Re-compared at EVERY later instant of the same week, not only at the
      // arrival: the recompute the arrival provokes is DEFERRED by a beat
      // (122's ack, R872), so a cell it moved would land after the arrival's
      // own read. The LATEST comparison is what the arm reports.
      const after = await readLeagueCells(service, leagueIds, entry.week)
      const delta = countCellChanges(chartedCellsBefore, after)
      measured.chartedCellsCompared = delta.compared
      measured.chartedCellsChanged = delta.changed
      const advanced = await readChartedAdvanced(service, chartedWatchIds, entry.week)
      measured.chartedAdvancedRows = advanced.rows
      if (isChartedPost || isChartedRevision) {
        measured.chartedDeltas += ingest.stats.deltas
        measured.chartedEnqueued += ingest.stats.enqueued + ingest.stats.restamped
      }
      if (isChartedPost && chartedLateGame !== undefined) {
        measured.chartedPostInstant = pNow
        measured.chartedSlaInstant = chartedLateGame.chartedSlaAt.toISOString()
      }
      if (isChartedRevision && chartedRevision !== undefined) {
        measured.chartedValueAfter = advanced.valueByPlayer.get(chartedRevision.playerId) ?? null
        const closeAt = windowEndsAt.get(entry.week)
        measured.chartedRevisionInWindow =
          closeAt !== undefined && entry.at.getTime() <= closeAt
      }
    }
    if (seedLineupsAfterPoll) {
      // Week 1 only — every later week comes from `lineup_carry_internal` at
      // the advance (D293's auto-carry, which is the path a real league takes
      // and therefore the one worth driving).
      const seated = await seedLineups(service, botClients, leagues, entry.week, actionRng, problems, slate.clubs)
      for (const [leagueId, s] of seated) {
        seatingByLeague.set(leagueId, s)
        measured.lineupsSet += s.seated
      }
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
    seatingByLeague,
    slate,
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
 *
 * `door skipped <team>: no_matchup_row` IN A BRACKET WEEK is on the list for
 * the same reason and NO OTHER (R920, measured on the `--weeks 15` run that
 * proved invariant 5's window fix): migration 119's own doctrine states it —
 * "a team with no row this week (an eliminated playoff seat, a bye-less week
 * — `no_matchup_row`) is NAMED, not an error" (`119:110-112`, D319(3)). A
 * 16-team league with a 6-seat bracket leaves ten teams without a row in
 * every bracket week, so counting those as worker errors made a run driven
 * past the regular season RED on a chain behaving exactly to §7.3.8. It is
 * classified ONLY for weeks past the league's own regular season — the same
 * `v_first + regular_season_weeks − 1` boundary invariant 5 uses — so a
 * missing matchup row inside the regular season is still a real finding.
 */
const LAWFUL_WORKER_NOTE =
  /^(drain scored nothing:|no team starts a mapped player this week|\[[^\]]+\] (no team starts a mapped player this week|league .* (skipped: (week_final|week_not_open|week_not_scheduled)|HELD: week_not_open)))/

/** The door's bracket skip, exactly (119:612 writes the `reason` verbatim). */
const NO_MATCHUP_ROW = /^door skipped [0-9a-f-]{36}: no_matchup_row$/
/** …and its batch-level twin, which carries the league id and week inline. */
const NO_MATCHUP_ROW_PREFIXED = /^\[([0-9a-f-]{36}) wk (\d+)\] door skipped [0-9a-f-]{36}: no_matchup_row$/
const NO_MATCHUP_ROW_NOTE =
  'door skipped <team>: no_matchup_row (a bracket week — an eliminated seat has no row; 119:110-112)'

/**
 * The door's `no_matchup_row` skip, classified — the note when the week is
 * PAST the league's regular season, `null` otherwise (which keeps it a
 * finding). Exported so the classification is falsifiable on its own, with
 * its negative control, rather than only through a 15-week run.
 *
 * `problem` is either the batch-level form (`[<league> wk <n>] door skipped
 * …`), which carries its own league and week, or the per-league form (`door
 * skipped …`), which needs `ctx`.
 */
export function lawfulBracketSkip(
  problem: string,
  lastRegularWeek: ReadonlyMap<string, number>,
  ctx?: { leagueId: string; week: number },
): string | null {
  const past = (leagueId: string, week: number): boolean => {
    const last = lastRegularWeek.get(leagueId)
    return last !== undefined && week > last
  }
  const prefixed = NO_MATCHUP_ROW_PREFIXED.exec(problem)
  if (prefixed !== null) {
    return past(prefixed[1]!, Number(prefixed[2])) ? NO_MATCHUP_ROW_NOTE : null
  }
  if (ctx !== undefined && NO_MATCHUP_ROW.test(problem)) {
    return past(ctx.leagueId, ctx.week) ? NO_MATCHUP_ROW_NOTE : null
  }
  return null
}

function absorbBatch(
  batch: BatchReport,
  pNow: string,
  workerErrors: string[],
  byLeague: Map<string, string[]>,
  noStatRowByLeague: Map<string, number>,
  measured: {
    flaggedNoStatRow: number
    flaggedNoStatRowIds: Set<string>
    recomputedTeamsByWeek: Map<number, Set<string>>
    workerNotes: Map<string, number>
  },
  /** league id → the LAST regular-season week (R920's boundary). */
  lastRegularWeek: ReadonlyMap<string, number>,
): void {
  for (const line of batch.problems) {
    const bracket = lawfulBracketSkip(line, lastRegularWeek)
    if (bracket !== null) {
      measured.workerNotes.set(bracket, (measured.workerNotes.get(bracket) ?? 0) + 1)
      continue
    }
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
      const bracketSkip = lawfulBracketSkip(problem, lastRegularWeek, {
        leagueId: league.league_id,
        week: league.week,
      })
      if (bracketSkip !== null) {
        measured.workerNotes.set(bracketSkip, (measured.workerNotes.get(bracketSkip) ?? 0) + 1)
        continue
      }
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
    // WHICH team-weeks the worker actually recomputed. §22.2 is INCREMENTAL:
    // a team is rescored only when a delta lands for a player it STARTS, and
    // a scratched player emits no line and therefore no delta — so a team
    // whose only bridged starter is scratched is never rescored, and the
    // worker never files a per-starter report that could name him. An
    // assertion over the worker's naming is observable EXACTLY on these
    // teams; see the `mass_inactives` arm (D328 — it corrected R921 here).
    const recomputed = measured.recomputedTeamsByWeek.get(league.week) ?? new Set<string>()
    measured.recomputedTeamsByWeek.set(league.week, recomputed)
    for (const team of league.teams) {
      recomputed.add(team.team_id)
      noStatRows += team.no_stat_row.length
      // R921: keep the ids, so a scenario can assert on ITS OWN scratches.
      for (const playerId of team.no_stat_row) measured.flaggedNoStatRowIds.add(playerId)
    }
    if (noStatRows > 0) {
      measured.flaggedNoStatRow += noStatRows
      noStatRowByLeague.set(league.league_id, (noStatRowByLeague.get(league.league_id) ?? 0) + noStatRows)
    }
  }
}

/**
 * Every seated team's stored week points, keyed `teamId`, across the whole run
 * population. The CHARTED arms compare this either side of a charted arrival:
 * no shipped template pays a charted key (F283/Q44), so a charted delta must
 * move `player_stats.advanced` and NOT a single league cell. Paged and chunked
 * (R919) — a truncated read here could only ever SILENCE a changed cell.
 */
async function readLeagueCells(
  service: Supabase,
  leagueIds: readonly string[],
  week: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // BOTH surfaces, because the two schedule modes score into different tables:
  // `score_write_week_batch` writes `matchups.home_score/away_score` in h2h
  // (119:636-642) and `team_week_results.points` in total_points (119:595-602).
  // Reading only the latter compared EIGHT cells across a six-league run
  // (measured 2026-09-08) — the h2h leagues' live scores were invisible.
  const matchups = await pageByLeague<{
    id: string
    home_score: number | string | null
    away_score: number | string | null
  }>(leagueIds, `week-${week} matchup scores`, (part, from, to) =>
    service
      .from('matchups')
      .select('id, home_score, away_score', { count: 'exact' })
      .in('league_id', part)
      .eq('week', week)
      .range(from, to) as never,
  )
  for (const row of matchups) {
    out.set(`m:${row.id}`, `${row.home_score ?? '(null)'}|${row.away_score ?? '(null)'}`)
  }
  const results = await pageByLeague<{ team_id: string; points: number | string | null }>(
    leagueIds,
    `week-${week} team_week_results points`,
    (part, from, to) =>
      service
        .from('team_week_results')
        .select('team_id, points', { count: 'exact' })
        .in('league_id', part)
        .eq('week', week)
        .range(from, to) as never,
  )
  for (const row of results) out.set(`r:${row.team_id}`, String(row.points ?? '(null)'))
  return out
}

/**
 * §7.3.6's BYE arm, read from the server's own derivation
 * (`lineup_kickoff_internal`, 112:395-427) rather than assumed — F289.
 *
 * The ledger imagined the `postponement` scenario would put its clubs on bye.
 * It does not, and this measures it rather than arguing it: ingest keeps a
 * postponed game's row at (season, week) with `status = 'postponed'` and the
 * kickoff moved out (`IN_WEEK_STATUSES` excludes it from the week BOUNDS,
 * ingest-week.ts:194-200, and 116:311-315 says the game "has LEFT the week"
 * only in the week-state sense), while 112:413-417 resolves the club's kickoff
 * from `nfl_games` by (season, week, club) with NO status filter. So the club
 * still resolves a kickoff and reads `on_bye = FALSE`.
 */
async function readByeState(
  service: Supabase,
  week: number,
  clubs: readonly string[],
  at: string,
): Promise<string> {
  const parts: string[] = []
  for (const club of clubs) {
    const { data, error } = await service.rpc('lineup_kickoff_internal', {
      p_season: SYNTHETIC_SEASON,
      p_week: week,
      p_nfl_team: club,
      p_at: at,
    })
    throwIfError(error, `lineup_kickoff_internal(${club} @ ${at})`)
    const row = (Array.isArray(data) ? data[0] : data) as
      | { on_bye?: boolean; datum_arm?: string }
      | null
      | undefined
    parts.push(`${club} on_bye=${row?.on_bye === true} datum=${row?.datum_arm ?? '(none)'}`)
  }
  return parts.join(' · ')
}

/** Cells present on BOTH sides whose value moved, and how many were compared.
 *  A cell that only exists on one side is NOT a change — the week is still
 *  being written — and is reported as `compared`, never silently folded in. */
function countCellChanges(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): { compared: number; changed: number } {
  let compared = 0
  let changed = 0
  for (const [teamId, value] of before) {
    const now = after.get(teamId)
    if (now === undefined) continue
    compared += 1
    if (now !== value) changed += 1
  }
  return { compared, changed }
}

/**
 * The charted key as `player_stats.advanced` actually holds it for the watched
 * players: how many rows carry it, and (for the single-player revision arm)
 * its value. An ABSENT key is `null` and is distinct from a present 0 — §23.5's
 * pending semantics, which is exactly the distinction the arms read.
 */
async function readChartedAdvanced(
  service: Supabase,
  playerIds: readonly string[],
  week: number,
): Promise<{ rows: number; valueByPlayer: Map<string, number> }> {
  const valueByPlayer = new Map<string, number>()
  if (playerIds.length === 0) return { rows: 0, valueByPlayer }
  const { data, error } = await service
    .from('player_stats')
    .select('player_id, advanced')
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', week)
    .in('player_id', [...playerIds])
  throwIfError(error, `charted advanced read (week ${week})`)
  for (const row of data ?? []) {
    const advanced = (row.advanced ?? {}) as Record<string, unknown>
    const value = advanced[CHARTED_PLACEHOLDER_KEY]
    if (typeof value === 'number' && row.player_id !== null) valueByPlayer.set(row.player_id, value)
  }
  return { rows: valueByPlayer.size, valueByPlayer }
}

/**
 * THE GAME-DAY LOCK, evaluated at an instant — `pool_game_lock_any_internal`
 * (115:283), the very oracle `lineup_lock_tick` (119:780) and
 * `roster_add_drop` both consult. It is read here rather than
 * `league_player_pool.locked_until` on purpose, and the reason is a finding
 * in its own right (F301): **`league_player_pool` is a SPARSE table** — the
 * only writers are `roster_add_drop_internal`'s two INSERTs (113:713/734,
 * 115:646/667), so a league that has never transacted a player has NO pool
 * rows at all. The season sim does no add/drops, so every one of its pool
 * reads returns the empty set, and an assertion of the shape "0 rows still
 * carry a lock" is VACUOUS there — it passes on an empty table. This helper
 * reads the RULE instead, which is what E42/E43 are actually about: locks are
 * EVALUATED from `nfl_games.kickoff_at` at evaluation time, never precomputed
 * (§23.3/D291).
 */
async function readClubLocks(
  service: Supabase,
  week: number,
  clubs: readonly string[],
  at: string,
): Promise<{ clubs: number; locked: number; detail: string }> {
  const results: string[] = []
  let locked = 0
  for (const club of clubs) {
    const { data, error } = await service.rpc('pool_game_lock_any_internal', {
      p_season: SYNTHETIC_SEASON,
      p_current_week: week,
      p_nfl_team: club,
      p_at: at,
    })
    throwIfError(error, `pool_game_lock_any_internal(${club} @ ${at})`)
    const isLocked = ((data ?? {}) as { locked?: boolean }).locked === true
    if (isLocked) locked += 1
    results.push(`${club}=${isLocked ? 'LOCKED' : 'open'}`)
  }
  return { clubs: clubs.length, locked, detail: results.join(' ') }
}

/**
 * WHY A WEEK IS NOT FINAL, ASKED OF THE FINALIZE JOB'S OWN ORACLES (F302 /
 * §3 Q47). `finalize_matchups` holds a week on exactly two guards, and both
 * `CONTINUE` out of the loop leaving the row untouched at `correction_window`
 * (118:2073 says so verbatim: "The week is SKIPPED BY NAME and stays
 * `correction_window`"):
 *   guard 1, 118:2054 — `week_games_state_internal(season, week).all_final`
 *                       false => `games_not_final` (§23.2, partial data);
 *   guard 2, 118:2074 — `week_results_pending_internal(league, season, week)`
 *                       non-NULL => `pending_scores` / `pending_results`
 *                       (E61 — absence is not a score, never coerced to 0.00).
 * The write door tests FINALITY instead (119:566 refuses `final`, 119:570
 * admits `live` or `correction_window`), so a week held on either guard past
 * its own `correction_window_ends_at` is still open at the door. This reads
 * the SAME two oracles rather than mirroring their logic in TS (D289/D33), so
 * the gate reports the job's reason, not the harness's opinion of it.
 */
async function readFinalizeHold(
  service: Supabase,
  leagueId: string,
  week: number,
): Promise<{ reason: string | null; detail: string }> {
  const { data: games, error: gamesError } = await service.rpc('week_games_state_internal', {
    p_season: SYNTHETIC_SEASON,
    p_week: week,
  })
  throwIfError(gamesError, `week_games_state_internal(${SYNTHETIC_SEASON}, ${week})`)
  const g = (Array.isArray(games) ? games[0] : games) as {
    total_games?: number
    final_games?: number
    postponed_games?: number
    open_games?: number
    all_final?: boolean
  } | null
  if (g?.all_final !== true) {
    return {
      reason: 'games_not_final',
      detail:
        `games_not_final (guard 1, 118:2054; ${g?.final_games ?? '?'}/${g?.total_games ?? '?'} final, ` +
        `${g?.postponed_games ?? '?'} postponed, ${g?.open_games ?? '?'} open)`,
    }
  }
  const { data: pending, error: pendingError } = await service.rpc('week_results_pending_internal', {
    p_league_id: leagueId,
    p_season: SYNTHETIC_SEASON,
    p_week: week,
  })
  throwIfError(pendingError, `week_results_pending_internal(${leagueId}, ${week})`)
  const p = (pending ?? null) as { reason?: string } | null
  if (p !== null && typeof p.reason === 'string') {
    return { reason: p.reason, detail: `${p.reason} (guard 2, 118:2074; ${JSON.stringify(p)})` }
  }
  return {
    reason: null,
    detail: 'UNEXPLAINED — neither finalize guard holds this week, yet it is not final',
  }
}

/** The two correction arms, measured from the worker's OWN report. */
function measureCorrectionArms(
  batch: BatchReport,
  entry: TimelineEntry,
  windowEndsAt: ReadonlyMap<number, number>,
  measured: {
    postWindowSkips: number
    postWindowWrites: number
    postWindowWriteDetail: string[]
    postWindowWritePairs: Array<{ leagueId: string; week: number }>
    inWindowWrites: number
    revisionWrites: number
  },
): void {
  const closeAt = windowEndsAt.get(entry.week)
  const past = closeAt !== undefined && entry.at.getTime() > closeAt
  for (const league of batch.leagues) {
    if (league.week !== entry.week) continue
    if (past) {
      if (league.skip_reason === 'week_final') measured.postWindowSkips += 1
      if (league.outcome === 'written') {
        measured.postWindowWrites += 1
        // NAME the league and the instant. At 100 leagues one write in 199
        // outcomes is a finding, and a bare count cannot tell a spec breach
        // from a league that simply had not finalized yet (measured
        // 2026-09-08: exactly that, once).
        measured.postWindowWritePairs.push({ leagueId: league.league_id, week: league.week })
        measured.postWindowWriteDetail.push(
          `${entry.label} @${entry.at.toISOString()} league ${league.league_id} week ${league.week} ` +
            `outcome=${league.outcome} mode=${league.mode} teams=${league.teams.length} ` +
            `door=${JSON.stringify(league.door ?? null)} problems=${JSON.stringify(league.problems)} ` +
            `(window closed ${closeAt === undefined ? '(unknown)' : new Date(closeAt).toISOString()})`,
        )
      }
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
// §7.3.6's blocking designations and the `players.status` bridge moved to
// `./designations` at L.D6.3 so the DRAFT runner's need-aware season personas
// can import them without a module cycle (runner -> season-runner -> runner).
// Re-exported here: every existing importer and every pin is unmoved.
export { BLOCKING_DESIGNATIONS, simDesignation }

/** A roster player as the seating chooser reads him. */
export interface SeatCandidate {
  id: string
  /** The roster vocabulary (DEF is normalised to DST by the caller). */
  position: string
  /** `players.status`, verbatim. */
  status: string | null
}

export interface Seating {
  slotMap: Record<string, string>
  /** Players passed over because §7.3.6 would refuse them by DESIGNATION. */
  benchedForLegality: string[]
  /** Starting slots left EMPTY — lawful (114:585-588 flags an empty slot and
   *  never blocks on it), and named rather than silently absent. */
  emptySlots: string[]
}

/**
 * Choose which rostered players take which starting slots — greedy first fit
 * by eligibility over the roster in the caller's order (best ADP first).
 *
 * NOT a mirror of `lineup_fit_internal`: the SERVER decides the canonical
 * placement and the sim keeps what came back (D327(5)/D289/D33). The one
 * thing this does encode is F286's residual necessary condition: in a league
 * with `allow_illegal_lineups = false`, §7.3.6 refuses a starter carrying an
 * OUT/IR/PUP/NFI/Suspended designation, so those players are passed over and
 * the slot goes to the next eligible man — or stays EMPTY, which is lawful.
 * The OTHER §7.3.6 arm — `on_bye` — is not encoded here on purpose: the run
 * publishes a FULL SLATE (`withFullSlate`), so no club is on bye, and
 * `uncoveredClubs` REFUSES the run loudly if that ever stops being true.
 * Encoding a bye skip here as well would hide exactly that gap.
 *
 * In a league where illegal lineups are ALLOWED nothing is passed over: an
 * OUT starter there is lawful, and seating him is coverage of that arm.
 */
export function chooseStarterSlots(
  roster: readonly SeatCandidate[],
  slots: readonly { key: string; eligible: string[] }[],
  opts: { allowIllegalLineups: boolean },
): Seating {
  const slotMap: Record<string, string> = {}
  const benchedForLegality: string[] = []
  const taken = new Set<string>()
  for (const player of roster) {
    const designation = simDesignation(player.status)
    if (!opts.allowIllegalLineups && designation !== null && BLOCKING_DESIGNATIONS.has(designation)) {
      benchedForLegality.push(`${player.id} (${designation})`)
      continue
    }
    const slot = slots.find((sl) => !taken.has(sl.key) && sl.eligible.includes(player.position))
    if (slot === undefined) continue
    taken.add(slot.key)
    slotMap[slot.key] = player.id
  }
  return {
    slotMap,
    benchedForLegality,
    emptySlots: slots.filter((sl) => !taken.has(sl.key)).map((sl) => sl.key),
  }
}

/** What `seedLineups` measured for ONE league — the honest seating count. */
export interface LeagueSeating {
  /** Teams whose week-1 lineup the server ACCEPTED. */
  seated: number
  /** Teams the server refused (each refusal is also a run `problem`). */
  refused: number
  /** Starting slots left empty across the league's accepted lineups. */
  emptySlots: number
  /** …named by slot key, so an unreachable POSITION is distinguishable from
   *  one odd board (F288). */
  emptySlotKeys: Record<string, number>
  /** Players passed over for a blocking designation (OFF leagues only). */
  benchedForLegality: number
  /** Slots actually filled across the league's accepted lineups. */
  slotsFilled: number
}

async function seedLineups(
  service: Supabase,
  bots: ReadonlyMap<string, Supabase>,
  leagues: LeagueState[],
  week: number,
  actionRng: () => number,
  problems: string[],
  coveredClubs: readonly string[],
): Promise<Map<string, LeagueSeating>> {
  const out = new Map<string, LeagueSeating>()
  for (const league of leagues) {
    const seating: LeagueSeating = {
      seated: 0,
      refused: 0,
      emptySlots: 0,
      emptySlotKeys: {},
      benchedForLegality: 0,
      slotsFilled: 0,
    }
    out.set(league.leagueId, seating)
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
      .select('team_id, player_id, players!inner(position, adp, status, team)')
      .eq('league_id', league.leagueId)
    throwIfError(error, `${league.label}: roster read for lineups`)
    const byTeam = new Map<string, Array<{ id: string; position: string; adp: number | null; status: string | null }>>()
    const rosteredClubs: Array<string | null> = []
    for (const row of rosterRows ?? []) {
      const player = row.players as unknown as {
        position: string
        adp: number | null
        status: string | null
        team: string | null
      }
      rosteredClubs.push(player.team)
      const list = byTeam.get(row.team_id) ?? []
      list.push({
        id: row.player_id,
        position: String(player.position),
        adp: player.adp,
        status: player.status,
      })
      byTeam.set(row.team_id, list)
    }
    // F286's own precondition, checked against what the league ACTUALLY
    // rosters rather than assumed from `NFL_CLUBS`. A rostered player whose
    // club has no game this week is `on_bye = TRUE` at 112:417-422 and is
    // refused by §7.3.6 — the exact failure this task exists to remove — so an
    // uncovered club is a LOUD problem, never a quiet 409 storm.
    const uncovered = uncoveredClubs(rosteredClubs, coveredClubs)
    if (uncovered.length > 0) {
      problems.push(
        `${league.label}: ${uncovered.length} rostered club(s) have no game in the published slate — ` +
          `${uncovered.join(', ')}. §7.3.6 reads every one of their players as on bye (112:417-422). ` +
          `Add the club to NFL_CLUBS (season-scenario.ts) so the week's slate covers it.`,
      )
    }
    for (const team of league.teams) {
      const roster = (byTeam.get(team.id) ?? []).sort(
        (a, b) => (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : 1),
      )
      const seat = chooseStarterSlots(
        roster.map((p) => ({
          id: p.id,
          position: p.position.toUpperCase() === 'DEF' ? 'DST' : p.position.toUpperCase(),
          status: p.status,
        })),
        league.slots,
        { allowIllegalLineups: league.allowIllegalLineups },
      )
      const slotMap = seat.slotMap
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
        seating.refused += 1
        problems.push(
          `${league.label}: set_lineup(team ${team.id}, week ${week}) answered ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`,
        )
        continue
      }
      seating.seated += 1
      seating.slotsFilled += Object.keys(slotMap).length
      seating.emptySlots += seat.emptySlots.length
      for (const key of seat.emptySlots) {
        seating.emptySlotKeys[key] = (seating.emptySlotKeys[key] ?? 0) + 1
      }
      seating.benchedForLegality += seat.benchedForLegality.length
    }
  }
  return out
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
): Promise<SeasonAudit> {
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
    regularSeasonWeeks: state.regularSeasonWeeks,
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
    flexLockBefore: string | null
    flexLockInside: string | null
    flexLockInsideLocked: number
    flexLockInsideClubs: number
    flexLockBeforeLocked: number
    flexLockWindow: string | null
    postponedLockAt: string | null
    postponedLockDetail: string | null
    postponedByeDetail: string | null
    postponedLocked: number
    postponedClubs: number
    controlLocked: number
    controlClubs: number
    postWindowSkips: number
    postWindowWrites: number
    postWindowWriteDetail: readonly string[]
    postWindowWroteFinalWeek: number
    postWindowWroteUnexplained: number
    inWindowWrites: number
    revisionWrites: number
    chartedPostInstant: string | null
    chartedSlaInstant: string | null
    chartedAdvancedRows: number
    chartedDeltas: number
    chartedEnqueued: number
    chartedDrainWrites: number
    chartedDrainRecomputes: number
    chartedDrained: number
    chartedCellsCompared: number
    chartedCellsChanged: number
    chartedValueBefore: number | null
    chartedValueAfter: number | null
    chartedRevisionInWindow: boolean | null
    chartedRevisionDelta: number | null
    flaggedNoStatRow: number
    flaggedNoStatRowIds: ReadonlySet<string>
    /** week → the teams the worker RECOMPUTED (§22.2's incremental rule). */
    recomputedTeamsByWeek: ReadonlyMap<number, Set<string>>
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
    // F287(a) TAKEN. The old form counted rows with `.not('points','is',null)`
    // against a `NOT NULL DEFAULT 0` column — a dead filter — and reported
    // "rows carry a score" for what was only "rows exist". A league whose
    // pool never overlapped the §23.6 world would score every cell 0 and
    // still pass. The predicate now reads the VALUES: enough cells for a
    // seated week, AND at least one of them strictly positive, which cannot
    // happen unless a bridged player actually played for that league.
    const { data: cells, error } = await service
      .from('team_week_results')
      .select('team_id, points')
      .eq('league_id', league.leagueId)
    throwIfError(error, `${league.label}: scored-cell read`)
    const cellRows = cells ?? []
    const values = cellRows.map((r) => Number(r.points ?? 0))
    const positive = values.filter((v) => v > 0).length
    const highest = values.length === 0 ? 0 : Math.max(...values)
    push(
      'scores_written',
      cellRows.length >= league.teamCount && positive > 0,
      `${cellRows.length} team_week_results cells for ${league.teamCount} teams · ${positive} carry a score > 0 · ` +
        `highest ${highest.toFixed(2)}`,
      'at least one full week of cells per league, with at least one strictly positive score ' +
        '(a league that scored every cell 0 never overlapped the §23.6 world and is decorative coverage)',
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
      // Q5 TAKEN. The old form compared `nfl_games.kickoff_at` either side of
      // the announcement and read NO LOCK, while carrying a name that claims
      // one. The task row says LOCKS. So the schedule datum is still read —
      // and so is the lock, at an instant inside [new kickoff, original
      // kickoff), where the flexed clubs' players are locked under the moved
      // schedule and would NOT be under the original. The pool's `locked_until`
      // is 116's maintained VIEW: NULL = not locked (116:306).
      const movedEarlier = game.flexMove!.newKickoffAt.getTime() < game.kickoffAt.getTime()
      push(
        'lock_moved_with_kickoff',
        measured.kickoffBefore !== null &&
          measured.kickoffAfter !== null &&
          measured.kickoffBefore !== measured.kickoffAfter &&
          measured.flexLockInsideClubs > 0 &&
          measured.flexLockInsideLocked === measured.flexLockInsideClubs &&
          measured.flexLockBefore !== null &&
          measured.flexLockBeforeLocked === 0,
        `nfl_games.kickoff_at ${measured.kickoffBefore ?? '(unread)'} → ${measured.kickoffAfter ?? '(unread)'} ` +
          `(${movedEarlier ? 'earlier' : 'later'}); THE LOCK, read from pool_game_lock_any_internal at ` +
          `evaluation time — before the window: ${measured.flexLockBefore ?? '(unsampled)'} · inside ` +
          `${measured.flexLockWindow ?? '(no window)'}: ${measured.flexLockInside ?? '(unsampled)'} ` +
          `(${measured.flexLockInsideLocked}/${measured.flexLockInsideClubs} clubs locked)`,
        `the flexed game's kickoff moves to ${game.flexMove!.newKickoffAt.toISOString()} at the announcement AND ` +
          `the lock FOLLOWS it: its clubs read OPEN before the earlier of the two kickoffs and LOCKED at an ` +
          `instant between them — the span in which the ORIGINAL schedule would still have left them open. ` +
          `Locks are EVALUATED from nfl_games.kickoff_at at evaluation time, never precomputed (E42/§23.3/D291)`,
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
      // R948 TAKEN (#278 review). This read `leagues.some(...)` — the ONE
      // existentially-quantified finalization predicate of the four in this
      // file, while `finalization_unaffected` (provider_outage) and both
      // charted arms are universal (`every` / `=== leagues.length`).
      // `finalize_matchups`' SECOND guard (`week_results_pending_internal`,
      // 118:2074) is PER-LEAGUE, unlike guard 1's global slate check — so a
      // regression that holds 99 of 100 leagues at `correction_window` left one
      // league final and this arm printed `[PASS] … 1/100 leagues finalized`.
      // E43 is the ONE property this scenario exists to certify, and it was
      // certified while broken in 99 leagues. Nothing downstream catches it:
      // `classifyHeldWeeks` only LABELS, the finalize hold lands in a `skipped`
      // array `collectJobFailures` does not read, invariant 5 filters non-final
      // rows out of BOTH sides of its comparison, and `gate-m4-evidence.ts`'s
      // `finals` total feeds a print line and no assertion. MEASURED both ways
      // at the gate's own 100 × 2 × seed 42 before this line changed: with a
      // constructed one-league-final state the old form printed [PASS] 1/100
      // and the run and the evidence stage both exited 0; the form below prints
      // [FAIL] on the same state. If a scenario is ever legitimately EXPECTED
      // to hold some leagues here, state the threshold and the reason in
      // `expected` — do not go back to accepting n >= 1.
      const allFinal = leagues.every((l) => l.weeksFinal.has(firstWeek))
      push(
        'finalized_without_game',
        allFinal,
        `${leagues.filter((l) => l.weeksFinal.has(firstWeek)).length}/${leagues.length} leagues finalized week ${firstWeek}`,
        'the week finalizes with the postponed game excluded (116\'s left-the-week rule)',
      )
      // F301 TAKEN. This arm used to count `league_player_pool` rows carrying a
      // `locked_until` and pass on 0 — but `league_player_pool` is a SPARSE
      // table whose only writers are `roster_add_drop_internal` (113:713/734,
      // 115:646/667), and the season sim does no add/drops, so it is EMPTY for
      // every sim league and the count was 0 by construction. The assertion
      // passed on an empty table and would have passed with the lock rule
      // deleted: "nothing happened" read as "it worked". It now reads the RULE
      // — `pool_game_lock_any_internal`, the oracle 119:780 and 113/115 both
      // consult — at the instant the postponed game WOULD have kicked off, and
      // beside it a CONTROL game's clubs, which must read LOCKED at the same
      // instant so that "open" is evidence rather than an oracle stuck at false.
      push(
        'locks_released',
        measured.postponedLockAt !== null &&
          measured.postponedClubs > 0 &&
          measured.postponedLocked === 0 &&
          measured.controlClubs > 0 &&
          measured.controlLocked === measured.controlClubs,
        `at ${measured.postponedLockAt ?? '(unsampled)'} (the postponed game's ORIGINAL kickoff) ` +
          `${measured.postponedLockDetail ?? '(no sample)'} — ` +
          `${measured.postponedLocked}/${measured.postponedClubs} postponed clubs locked, ` +
          `${measured.controlLocked}/${measured.controlClubs} control clubs locked. ` +
          `§7.3.6's BYE arm, read from lineup_kickoff_internal at the same instant (F289): ` +
          `${measured.postponedByeDetail ?? '(unsampled)'} — a postponed game KEEPS its (season, week) row ` +
          `(only its STATUS and kickoff move), and 112:413-417 resolves the club's kickoff with no status ` +
          `filter, so these clubs are NOT on bye and this scenario does not exercise that arm`,
        'the postponed game does not lock its clubs at the kickoff it no longer has, while a game that DID ' +
          'kick off locks its own (E43; the lock is evaluated from nfl_games.kickoff_at at evaluation time)',
      )
      break
    }
    case 'mass_inactives': {
      // R921: SCOPED to this scenario's own scratches, the way the
      // `postponement` arm two cases above scopes to `bridge.map`. The
      // run-wide `flaggedNoStatRow` count is > 0 in `happy_path` too — the
      // leagues draft the real pool while only the 18 bridged players ever
      // receive lines — so deleting every `inactive` mark from `scenarios.ts`
      // still printed [PASS]. It carried no information about inactive
      // handling and was presented as if it did.
      const scenario = anchored.get(firstWeek)
      // The anchored scenario speaks REAL player ids (the bridge renames
      // them), so these are directly comparable to the worker's report.
      const scratched = new Set(
        (scenario?.players ?? []).filter((p) => p.inactive === true).map((p) => p.playerId),
      )
      // Independent of the worker: which scratched players a run league
      // actually STARTED in the week, read from the stored lineups.
      //
      // SCOPED TO THE TEAMS THE WORKER RECOMPUTED (D328 — this corrects
      // R921). §22.2 is incremental: a team is rescored only when a delta
      // lands for a player it starts, and a scratched player emits no line
      // and so no delta. A team whose only bridged starter is scratched is
      // therefore NEVER rescored, no per-starter report exists for it, and
      // the worker cannot have named anybody on it — asserting over it is
      // asserting over a report that does not exist. Left unscoped the arm
      // was FLAKY, not strict: measured on `main` @ a5b0358 at FOUR leagues
      // (its own largest green configuration) seeds 7 and 13 fail it
      // (`6/7`, `5/6`) while 21, 38 and 101 pass, purely on which team the
      // draft's race resolution put a scratched player on. Scoping restores
      // the arm's teeth where it can see: a scratched starter on a
      // RECOMPUTED team that the worker did NOT name is still a failure, and
      // that is exactly what a provider ignoring `inactive` would produce.
      const recomputed = measured.recomputedTeamsByWeek.get(firstWeek) ?? new Set<string>()
      const startedScratched = new Set<string>()
      const unobservable = new Set<string>()
      for (const league of leagues) {
        const { data: rows, error } = await service
          .from('team_lineups')
          .select('team_id, slot_map')
          .in('team_id', league.teams.map((t) => t.id))
          .eq('season', SYNTHETIC_SEASON)
          .eq('week', firstWeek)
        throwIfError(error, `${league.label}: mass_inactives lineups`)
        for (const row of rows ?? []) {
          const slotMap = (row.slot_map ?? null) as Record<string, string> | null
          for (const playerId of startersOfMap(slotMap, league.irKeys)) {
            if (!scratched.has(playerId)) continue
            if (recomputed.has(row.team_id)) startedScratched.add(playerId)
            else unobservable.add(`${playerId}@${row.team_id}`)
          }
        }
      }
      const named = [...startedScratched].filter((id) => measured.flaggedNoStatRowIds.has(id))
      const notRecomputed =
        unobservable.size === 0
          ? ''
          : `; ${unobservable.size} scratched starter-seat(s) sit on teams the worker never recomputed ` +
            `(§22.2 incremental — no delta landed for any starter of theirs, so no report exists to name them)`
      if (startedScratched.size === 0) {
        // The charted arms' posture: say what could not be observed and why,
        // never a silent green.
        push(
          'zeros_flagged',
          false,
          `not observable: no RECOMPUTED team started any of the ${scratched.size} scratched players in week ${firstWeek} ` +
            `(${measured.flaggedNoStatRow} no_stat_row starters run-wide, none of them a scratch this scenario declared)${notRecomputed}`,
          'at least one RECOMPUTED team starting a scratched bridged player, so the worker\'s naming of it can be observed',
        )
      } else {
        push(
          'zeros_flagged',
          named.length === startedScratched.size,
          `${named.length}/${startedScratched.size} STARTED scratched players on RECOMPUTED teams were named ` +
            `no_stat_row by the worker (of ${scratched.size} scratched; ${measured.flaggedNoStatRow} no_stat_row ` +
            `starters run-wide)${notRecomputed}` +
            (named.length === startedScratched.size
              ? ''
              : ` — UNNAMED: ${[...startedScratched].filter((id) => !measured.flaggedNoStatRowIds.has(id)).join(', ')}`),
          'every scratched starter the worker RECOMPUTED is NAMED by it (auto-sub is off by default — §11.3 is M5, F211)',
        )
      }
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
      // WHAT THIS ASSERTS, and why it is not "zero writes" (§3 Q47 / F302).
      //
      // The measured contract is D295(b): a post-window delta lands in
      // `player_stats` and changes NO league cell. The DOOR is the mechanism:
      // `score_write_week_batch` raises `week_final` for a week whose
      // `league_weeks.status` is `final` (119:566) and ADMITS one that is
      // `live` or `correction_window` (119:570). So an outcome of `written`
      // past the window is, BY CONSTRUCTION, a week the door found NOT final.
      //
      // F302's CAUSE IS ESTABLISHED (L.D6.3 fix round, 2026-09-09) and it is
      // reproducible on demand, not a 1-in-9 mystery. `finalize_matchups`
      // lawfully HOLDS a week on either of two guards and both `CONTINUE`
      // leaving the row at `correction_window` — which is the one status the
      // door treats as open. Demonstrated end to end in a ROLLED-BACK
      // transaction on the 122 chain: a week past its
      // `correction_window_ends_at` with one pending cell was skipped by
      // `finalize_matchups` with its own reason `pending_scores`, stayed
      // `correction_window`, and the door then ACCEPTED a post-window batch
      // that moved `matchups.home_score` NULL -> 123.45. The control (the same
      // week flipped to `final`) was refused by name with `week_final`.
      // §23.4's window is an INSTANT; the door's test is FINALITY; they
      // diverge exactly while a hold is in force, and the spec supplies no
      // rule for that state. That ruling is Chris's (§3 Q47), not this gate's.
      //
      // So the arm asserts the three things that ARE unambiguous, and
      // CLASSIFIES the fourth rather than failing or ignoring it:
      //   1. the door REFUSED by name at least once (`week_final` skips > 0) —
      //      without this a door that had stopped refusing would pass silently;
      //   2. no post-window write landed on a week whose `league_weeks.status`
      //      read back as `final` at that instant — that IS the D295(b) breach;
      //   3. every post-window write to a still-open week is EXPLAINED by the
      //      finalize job's own oracles — `games_not_final` (guard 1) or
      //      `pending_scores`/`pending_results` (guard 2). A write to a week
      //      that is neither final NOR held is unexplained and FAILS: that
      //      would be a week the job should have finalized and did not, which
      //      is a different bug from Q47's gap and must not hide behind it;
      //   4. no cell of a week that HAD gone final changed — invariant 6
      //      (`final-cell-immutable`) run-wide, already part of `report.green`,
      //      so this arm does not duplicate it.
      push(
        'no_league_cell_changed',
        measured.postWindowSkips > 0 &&
          measured.postWindowWroteFinalWeek === 0 &&
          measured.postWindowWroteUnexplained === 0,
        `${measured.postWindowSkips} week_final refusals by the door / ${measured.postWindowWrites} write(s) to a ` +
          `week whose \`league_weeks.status\` was read back as NOT final at that instant ` +
          `(${measured.postWindowWroteFinalWeek} of them were final — a D295(b) breach; ` +
          `${measured.postWindowWroteUnexplained} of them UNEXPLAINED by either finalize guard), ` +
          `after the window closed` +
          (measured.postWindowWriteDetail.length === 0
            ? ''
            : ` — NAMED and CLASSIFIED (§3 Q47): ${measured.postWindowWriteDetail.join(' | ')}`) +
          `. No FINAL week's cell changed: invariant 6 (final-cell-immutable) is clean run-wide.`,
        'a post-window delta lands in player_stats and changes no cell of a FINAL week — the door raises ' +
          'week_final (119:566) for every week that HAS finalized, and any week it finds still open is ' +
          "classified by the finalize job's own hold reason (games_not_final 118:2054 / pending_scores " +
          '118:2074); an unclassifiable one fails (D295(b); the window-vs-finality gap is §3 Q47/F302)',
      )
      break
    }
    // ── The charted arms (F283 → the L.D6.3 ruling; PROGRESS §3 Q44) ───────
    //
    // WHAT IS NOT ASSERTED HERE, AND WHY. The tasks-M4 L.D6.3 row asks for
    // `pending_not_zero` (E61) on the D15 placeholder key. That needs a
    // scoring snapshot that PAYS `example_charted_yards` — and the spec
    // FORBIDS one: the key is the registry's only `tier: 'charted'` entry and
    // carries `scoring_surface: 'reserved'` (stat-keys.ts:204), which §23.5
    // (spec:2200) defines as "never scorable in a format-2 doc,
    // validation-rejected", §7.3.3.1 (spec:341) makes non-editable, and
    // 103's `c_reserved` refuses behind 104's wall on
    // `leagues.scoring_rules_snapshot`. MEASURED on this chain:
    // `scoring_rules_validate({...ESPN Standard, example_charted_yards: 0.1})`
    // answers `Scorable allowlist (§7.3.3.1 guardrail 1):
    // "example_charted_yards" cannot be scored — it is a reserved key
    // (§23.5)`. Its intended consumer, FieldScout Ultra, is a DEFERRED
    // template (spec:2195-2199) and none of the eight shipped templates pays
    // any charted key. F283's cited precedent is not a forked DOCUMENT
    // either: `score-week-worker-db.test.ts:282-295` is `withSnapshotOverlay`,
    // a test-only client interceptor that rewrites what the worker READS
    // while the DB row stays valid (its own comment, :668-673).
    //
    // So a sim-level snapshot overlay would make the gate certify a
    // configuration that cannot exist in production and the spec forbids —
    // the exact thing a gate exists to prevent — while duplicating a proof
    // that already exists at unit (`score-week-worker.test.ts:185-243`) and
    // stack (`score-week-worker-db.test.ts:564,728`) level.
    //
    // WHAT IS ASSERTED is §23.5's OWN league-level promise for a charted
    // arrival, all of it observable and none of it a fiction: the value is
    // INGESTED into `player_stats.advanced`, ENQUEUES a `score_fanout`
    // delta, DRAINS through the real worker, changes NO league cell, and
    // **"finalization timing does not move"**. The hole this leaves is
    // printed, non-failing, on EVERY run (`report.coverageGaps`) and recorded
    // in PROGRESS — never folded into a green.
    case 'charted_late': {
      const finalized = leagues.filter((l) => l.weeksFinal.has(firstWeek)).length
      const slaMs = measured.chartedSlaInstant === null ? null : Date.parse(measured.chartedSlaInstant)
      const postMs = measured.chartedPostInstant === null ? null : Date.parse(measured.chartedPostInstant)
      const slipHours =
        slaMs === null || postMs === null ? null : (postMs - slaMs) / 3_600_000
      push(
        'charted_ingested_no_cell_change',
        postMs !== null &&
          slaMs !== null &&
          postMs > slaMs &&
          measured.chartedAdvancedRows > 0 &&
          measured.chartedDeltas > 0 &&
          measured.chartedEnqueued > 0 &&
          measured.chartedDrained > 0 &&
          measured.chartedDrainRecomputes > 0 &&
          measured.chartedDrainWrites === 0 &&
          measured.chartedCellsCompared > 0 &&
          measured.chartedCellsChanged === 0 &&
          finalized === leagues.length,
        `charted feed posted ${measured.chartedPostInstant ?? '(never)'}, ` +
          `${slipHours === null ? '(unmeasured)' : `${slipHours.toFixed(1)} h`} past its SLA ` +
          `${measured.chartedSlaInstant ?? '(unread)'}; ${measured.chartedAdvancedRows} player_stats row(s) ` +
          `carry \`${CHARTED_PLACEHOLDER_KEY}\` in \`advanced\` after it; the poll saw ${measured.chartedDeltas} ` +
          `delta(s) and enqueued ${measured.chartedEnqueued} score_fanout row(s); the worker DRAINED ` +
          `${measured.chartedDrained} queue row(s) and RECOMPUTED ${measured.chartedDrainRecomputes} ` +
          `league-week(s), of which ${measured.chartedDrainWrites} produced a write (a charted key pays ` +
          `nothing in any shipped template, so the outcome is \`no_change\` — score-week-worker.ts:1041); ` +
          `${measured.chartedCellsChanged} of ` +
          `${measured.chartedCellsCompared} team_week_results cells changed VALUE across the instant; ` +
          `${finalized}/${leagues.length} leagues finalized week ${firstWeek} on their own window`,
        'a late charted arrival lands in player_stats.advanced, enqueues and drains through the real worker, ' +
          'changes NO league cell (no shipped template pays a charted key — §23.5/spec:2200), and does not move ' +
          'finalization timing (§23.5: "Finalization timing does not move"). E55/E57. ' +
          'E61 pending-not-zero at league level is NOT covered here — see report.coverageGaps.',
      )
      break
    }
    case 'charted_revision': {
      const finalized = leagues.filter((l) => l.weeksFinal.has(firstWeek)).length
      const before = measured.chartedValueBefore
      const after = measured.chartedValueAfter
      const expectedDelta = measured.chartedRevisionDelta
      const movedByDelta =
        before !== null && after !== null && expectedDelta !== null && after - before === expectedDelta
      push(
        'charted_revision_recomputed_in_window',
        movedByDelta &&
          measured.chartedRevisionInWindow === true &&
          measured.chartedEnqueued > 0 &&
          measured.chartedDrained > 0 &&
          measured.chartedDrainRecomputes > 0 &&
          measured.chartedDrainWrites === 0 &&
          measured.chartedCellsCompared > 0 &&
          measured.chartedCellsChanged === 0 &&
          finalized === leagues.length,
        `\`${CHARTED_PLACEHOLDER_KEY}\` moved ${before ?? '(absent)'} → ${after ?? '(absent)'} ` +
          `(scenario delta ${expectedDelta ?? '(none)'}) ` +
          `${measured.chartedRevisionInWindow === true ? 'INSIDE' : 'OUTSIDE'} the correction window; ` +
          `the poll enqueued ${measured.chartedEnqueued} score_fanout row(s); the worker DRAINED ` +
          `${measured.chartedDrained} of them and RECOMPUTED ${measured.chartedDrainRecomputes} league-week(s) ` +
          `at or after the revision instant (122 DEFERS a held row by a beat — R872 — so the recompute lands ` +
          `later than the poll that enqueued it), producing ${measured.chartedDrainWrites} write(s); ` +
          `${measured.chartedCellsChanged} of ${measured.chartedCellsCompared} team_week_results cells ` +
          `changed VALUE; ${finalized}/${leagues.length} leagues finalized week ${firstWeek}`,
        'an in-window charted revision moves the stored advanced value by exactly the declared delta, enqueues, ' +
          'is RECOMPUTED by the real worker inside the §23.4 window, and changes no league cell (no shipped ' +
          'template pays a charted key). E56. E61 pending-not-zero is NOT covered — see report.coverageGaps.',
      )
      break
    }
    case 'happy_path':
      break
  }
  return out
}

/**
 * What a season run does NOT assert, and why — ALWAYS printed, NEVER failing,
 * and consumed by L.D6.3's evidence stage so the gate's transcript carries its
 * own holes. A gap that is loud on every run is not a silent fold; a gap that
 * lives only in a PR description is (CLAUDE.md: never let "nothing happened"
 * mean "it worked").
 *
 * Each line: WHAT is not asserted · WHY it cannot be here · WHERE it IS
 * covered · WHAT CLOSES it.
 */
export /**
 * F300 — invariant 4 (pool/roster mirror) ASSERTS NOTHING in a season run, and
 * says so here rather than passing on an empty table. `league_player_pool`'s
 * only writers are `roster_add_drop_internal`'s two INSERTs (113:713/734,
 * 115:646/667); the season harness drives no add/drop traffic, so the table is
 * empty for every sim league and `checkPoolMirror`'s loop iterates nothing —
 * it would return clean with the mirror rule deleted.
 *
 * This string is the WITHDRAWAL OF THE CLAIM, and `gate-m4-evidence.ts`
 * asserts BOTH that it is present on every report AND that `report.poolRows`
 * is 0, so the withdrawal cannot be quietly dropped and the emptiness cannot
 * be quietly converted back into an apparent pass.
 */
const POOL_MIRROR_GAP =
  'INVARIANT 4 (pool/roster mirror, §12.19/D294) IS NOT EXERCISED by a season run and its clean result ' +
  'is VACUOUS, not evidence: `league_player_pool` is written ONLY by `roster_add_drop_internal` ' +
  '(113:713/734, 115:646/667), this harness performs no add/drops, so the table is EMPTY for every sim ' +
  'league (`report.poolRows` — asserted 0 by the evidence stage) and the mirror loop iterates nothing. ' +
  'R950 CORRECTS an earlier clause here that called reconcile\'s `pool_mirror_broken` the one surviving ' +
  'live half: it is DEAD FOR THE SAME REASON — reconcile builds its pool state from the SAME empty table ' +
  'over the SAME seeded leagues (reconcile.ts:645-647), so its first loop iterates nothing and its second ' +
  'never sees a defined state, and a season run cannot emit that finding either. REAL coverage lives ' +
  'elsewhere: the `roster_add_drop` door is walked by pgTAP and by L.D6.2\'s inseason-lock.spec.ts, and ' +
  'mirror coverage itself waits on M5\'s transactions/waivers sim work. F300.'

function seasonCoverageGaps(scenario: ScenarioId): string[] {
  const gaps: string[] = [
    'E32 lineup-edit LOCK REFUSAL (set_lineup at the door) is NOT asserted: `set_lineup` takes no caller ' +
      'clock, its DEFINER wrapper passes the transaction\'s now() (112:1233), and season 2099 lies before ' +
      'every kickoff — so nothing this harness submits is ever locked at submit. Covered by pgTAP ' +
      '(060/062/063) only; the roster_add_drop half is walked by L.D6.2\'s e2e (inseason-lock.spec.ts). ' +
      'F284(a)/F296. Closes when a caller clock reaches the door, or a browser can reach a locked editor.',
    'IN-SEASON TRANSACTIONS and the Remix flow are NOT driven by the season sim: it only ever sees a ' +
      'post-draft pool. Covered by L.D6.2\'s Playwright specs (inseason-week / inseason-lock / ' +
      'inseason-remix), which the gate runs as its own stage. F284(b).',
    POOL_MIRROR_GAP,
    'Q42 (a STARTER with a final game and no stat line) is COUNTED and CLASSIFIED, never asserted on: the ' +
      '§23.6 world publishes lines for eighteen players, so every other starter is a lawful no_stat_row by ' +
      'construction. Asserting either reading would harden an OPEN question (D327(9)).',
  ]
  if (scenario === 'charted_late' || scenario === 'charted_revision') {
    gaps.push(
      'E61 PENDING-NOT-ZERO on the D15 charted placeholder key is NOT asserted at league level. ' +
        '`example_charted_yards` is the registry\'s only `tier: \'charted\'` key and carries ' +
        '`scoring_surface: \'reserved\'` (stat-keys.ts:204); spec §23.5 (spec:2200) makes a reserved key ' +
        '"never scorable in a format-2 doc, validation-rejected" and §7.3.3.1 (spec:341) makes placeholders ' +
        'non-editable; 103\'s `c_reserved` refuses it behind 104\'s wall on `leagues.scoring_rules_snapshot` ' +
        '(MEASURED: scoring_rules_validate({...ESPN Standard, example_charted_yards: 0.1}) -> ' +
        '\'"example_charted_yards" cannot be scored — it is a reserved key (§23.5)\'). None of the eight ' +
        'shipped templates pays a charted key, and the tier\'s intended consumer (FieldScout Ultra) is a ' +
        'DEFERRED template (spec:2195-2199). Covered at UNIT level ' +
        '(score-week-worker.test.ts:185-243) and STACK level (score-week-worker-db.test.ts:564,728) through a ' +
        'test-only snapshot OVERLAY, which is a fiction this gate deliberately refuses to certify. What IS ' +
        'asserted here is §23.5\'s league-level promise — ingested, enqueued, drained, no league cell moved, ' +
        'finalization timing unmoved. CLOSES when an Ultra-class template ships or a charted key is promoted ' +
        'to `scorable` (spec §23.5, deferred). PROGRESS §3 Q44 / F283.',
    )
  }
  if (scenario === 'postponement') {
    gaps.push(
      'A POSTPONED game does NOT put its clubs on bye on this chain, and the run does not pretend it does: ' +
        'ingest keeps the row at (season, week) with status `postponed` and the kickoff moved out (E43), and ' +
        '`lineup_kickoff_internal` (112:413-417) reads `nfl_games` by (season, week, club) with NO status ' +
        'filter — so those players still resolve a kickoff and read `on_bye = FALSE`. The §7.3.6 BYE arm is ' +
        'therefore not exercised by this scenario; it is pinned by pgTAP and by the sweep\'s unit fixtures. ' +
        'F289.',
    )
  }
  return gaps
}

/** The season command's own report lines (the CLI prints these verbatim). */
export function seasonReportLines(report: SeasonRunReport): string[] {
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
    // The seating line is printed for EVERY league and named for the OFF one:
    // a green run whose `allow_illegal_lineups = false` league seated nothing
    // is the decorative outcome F286/D328 exists to prevent, so the number is
    // on the transcript, not inferred from the absence of a 409.
    lines.push(
      `      lineups week 1: ${league.lineupsSeated}/${league.teamCount} seated · ${league.lineupsRefused} refused · ` +
        `${league.lineupSlotsFilled} slots filled / ${league.lineupSlotsLeftEmpty} left empty` +
        (league.lineupSlotsLeftEmpty === 0
          ? ' · '
          : ` [${Object.entries(league.lineupEmptySlotKeys).map(([k, n]) => `${k}×${n}`).join(' ')}] · `) +
        `benched for legality ${league.benchedForLegality}` +
        (league.allowIllegalLineups ? '' : '   <- §7.3.6 ENFORCED (D299 legality arm)'),
    )
  }
  const off = report.leagues.filter((l) => !l.allowIllegalLineups)
  if (off.length > 0) {
    lines.push(
      `LEGALITY ARM (allow_illegal_lineups = false): ${off.length} league(s) — ` +
        off.map((l) => `${l.leagueLabel} ${l.lineupsSeated}/${l.teamCount} lineups seated, ${l.lineupsRefused} refused`).join(' · '),
    )
  }
  lines.push(`WORKER ERRORS: ${report.workerErrors.length}`)
  for (const line of report.workerErrors.slice(0, 10)) lines.push(`  ${line}`)
  lines.push(`WORKER NOTES (named lawful states, not errors — §23.2): ${report.workerNotes.length} kinds`)
  for (const line of report.workerNotes) lines.push(`  ${line}`)
  lines.push(`RECONCILE ALERTS CLASSIFIED AS LAWFUL: ${report.reconcileClassified.length} kinds`)
  for (const line of report.reconcileClassified) lines.push(`  ${line}`)
  lines.push(`COVERAGE GAPS (printed every run, NEVER failing — what this run does NOT assert): ${report.coverageGaps.length}`)
  for (const gap of report.coverageGaps) lines.push(`  - ${gap}`)
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
  return lines
}

/** The nine library ids, re-exported for the CLI's `--scenario` validation. */
export { SCENARIO_IDS }
export type { ScenarioId, SeasonInvariantFailure }
