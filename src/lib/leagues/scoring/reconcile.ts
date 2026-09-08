/**
 * reconcile — §23.2's reconciliation job (task L.D2.3; spec §23.2 "recompute
 * every league-week team score from raw `player_stats` and assert it
 * matches stored `matchups`/`team_week_results` (excluding overridden
 * cells). Drift ⇒ alert, never silent fix" / §23.4 / §24.1 "reconciliation
 * drift: 0 cells — page on any" / §22.2 / §7.3.3; PROGRESS D322;
 * discharges F238's assertion half, F263(a) and F263(g), and D294's
 * nightly pool-mirror check; F257(c) is NOT here — see the banner's last
 * paragraph).
 *
 * THIS MODULE WRITES NOTHING. Every finding is returned on the report (and
 * the route / CLI print it); a "fix" is a human's act through the audited
 * commissioner paths (M6) or the rebuild RPC (117) — never this job's.
 *
 * ONE IMPLEMENTATION (D33/D57): the recompute is the worker's own exported
 * pipeline — `computeTeamWeek(snapshot, team, starters, stats)` over the
 * WEEK's `team_lineups.slot_map` (F262(d): the franchise whose book the
 * week is), `deliveredLine` → `deriveTierIndicators` → `scorePlayerWeek`,
 * per-player `roundHalfUp` before the team sum (§7.3.3 verbatim). Never a
 * second dot product. Because it recomputes FROM LINEUPS, a correction on a
 * player dropped out of the league after his game (no roster row — the
 * worker's map cannot reach him, F263(a)) IS caught here.
 *
 * WHAT IT CHECKS, and how each finding is classified (severity in brackets;
 * `alert` is §24.1's page — the CLI exits 1 on any):
 *
 *   CALENDAR (season-wide; F228 / F238 / Q37's shape):
 *   * `no_game_rows` [alert] — an `nfl_weeks` row whose `starts_at` is at or
 *     before now + `CALENDAR_LOOKAHEAD_MS` (7 days) has ZERO `nfl_games`
 *     rows: every player in every league locks from the week datum until
 *     rows exist (F228 — the dated go-live gate, alerted a week ahead).
 *   * `all_final_unstamped` [alert] — every in-week game is `final` (116's
 *     rule: a `postponed` game has LEFT the week only when its kickoff is
 *     at or past the next week's `starts_at`) and `last_game_ends_at` is
 *     NULL: the release event was never observed (F238 — the sync-live
 *     poll is the only writer; the operator escape is a service-role
 *     stamp, said in the finding).
 *   * `game_not_final_late` [warn] — a game kicked off more than
 *     `GAME_LATE_MS` (8 h) ago and is still `scheduled`/`live`: the
 *     provider never flipped it (Q37's cancelled game; an outage); the
 *     sync-live plan keeps polling it, this names it.
 *
 *   SCORES (per league in `in_season | playoffs`, per `league_weeks` row in
 *   `live | correction_window | final`; h2h cells are `matchups`
 *   home/away scores per pairing incl. `secondary`/playoff rows,
 *   `total_points` cells are `team_week_results.points`):
 *   * `excluded_overridden` — an `is_overridden` matchup row is never
 *     compared (§22.2/§23.2); counted on the report.
 *   * `drift` [alert] — stored ≠ recomputed (two-decimal equality) with no
 *     benign explanation below. Names league, week, team, stored,
 *     recomputed, and the per-starter breakdown.
 *   * `post_window_correction` [info] — the league week is `final`, stored
 *     ≠ recomputed, and a starter's `player_stats.updated_at` is AFTER the
 *     week's `correction_window_ends_at`: §23.4/D295(b) — a post-window
 *     delta lands in `player_stats` and changes NO league cell by law; it
 *     is the commissioner's flagged event (M6's L.E2 detection), not drift.
 *   * `in_flight` [info] — a starter of the cell still has a `score_fanout`
 *     row for (season, week): the worker has not drained it; the mismatch
 *     is expected. Becomes `stuck_queue` [alert] when that row's
 *     `enqueued_at` is older than `STALE_QUEUE_MS` (1 h) — the worker is
 *     not draining.
 *   * `pending_vs_stored` — recomputed PENDING (E61: an applicable rules
 *     key undelivered) while a number is stored: [alert] on h2h (the door
 *     writes NULL for pending); [warn] on `total_points` (F263(c): the door
 *     keeps a provisional row's last value — the known hole, named).
 *   * `twr_mirror_drift` [alert] — a `final` h2h week whose
 *     `team_week_results.points` ≠ the matchup score for the same team
 *     (117's results are derived from `matchups`; `rebuild_team_week_results`
 *     is the operator's tool, not this job's).
 *   * `no_lineup_row` [warn] — a team on a non-`upcoming` week with no
 *     `team_lineups` row: D293's auto-carry did not materialize; the cell
 *     cannot be recomputed and is said, never assumed 0.
 *   * `lineup_unreadable` [alert] — a `slot_map` that is not an object.
 *   * `snapshot_unscorable` [alert] — the league's frozen snapshot does not
 *     resolve/score (D292's quarantine, seen from here).
 *   * `starter_final_game_no_line` [alert] — F263(g): a starter whose NFL
 *     team played a `final` game this week has NO `player_stats` row. The
 *     worker's "0 by name" (Q42) cannot tell a DNP from a provider gap;
 *     this can (the game is over, the feed said nothing) — alerted, never
 *     zero-filled.
 *
 *   POOL MIRROR (per league; D294 "asserted, not trusted"):
 *   * `pool_mirror_broken` [alert] — a `league_player_pool` row in state
 *     `rostered` with no `league_rosters` row (113 refuses adds on exactly
 *     this), or a `league_rosters` row whose pool row is in a non-`rostered`
 *     state (a rostered player shown as available / locked-as-FA). A roster
 *     row with NO pool row is legal (lazy rows, §12.19) and not a finding.
 *
 * NOT HERE — F257(c) (a bracket blocked longer than one correction window):
 * the `bracket_blocked` verdict is produced only by 118's
 * `playoff_bracket_sync_internal`, a WRITER; a read-only job cannot observe
 * it without invoking the writer. Routed on the ledger (F265): the hourly
 * job persists the verdict to `system_flags` when it next changes.
 *
 * `complete` leagues are out of scope on purpose (§23.2 says in-season;
 * every week of a complete league is `final` and its post-window deltas
 * would be one `post_window_correction` per night forever).
 *
 * Time only via `time` (the D3 fence; the `now` every calendar and queue
 * age comparison uses). Every read pages past the PostgREST cap or is
 * bounded by a league; nothing here trusts a result set at the cap.
 */

import type { Json } from '@/types/database'

import { pageAll, type PageResponse } from '@/lib/supabase/page-all'

import type { TimeProvider } from '../time/time-provider'
import { roundHalfUp } from './calculator'
import type { ScoringRulesDoc } from './rules-doc'
import {
  assertSnapshotScorable,
  computeTeamWeek,
  irKeysOf,
  normalizePosition,
  type ScoreWorkerClient,
  STAT_LINE_COLUMNS,
  type StarterRef,
  startersOf,
  type StatLineRow,
  type TeamWeekScore,
} from './score-week-worker'

// ── Constants ──────────────────────────────────────────────────────────────

/** `no_game_rows` looks this far ahead: F228's gate is BEFORE the week starts. */
export const CALENDAR_LOOKAHEAD_MS = 7 * 24 * 60 * 60_000
/** A game this long past kickoff and still not final is named (Q37's shape). */
export const GAME_LATE_MS = 8 * 60 * 60_000
/** A queue row older than this is not "in flight" — the worker is not draining. */
export const STALE_QUEUE_MS = 60 * 60_000

// ── The report ─────────────────────────────────────────────────────────────

export type FindingKind =
  | 'no_game_rows'
  | 'all_final_unstamped'
  | 'game_not_final_late'
  | 'drift'
  | 'post_window_correction'
  | 'in_flight'
  | 'stuck_queue'
  | 'pending_vs_stored'
  | 'twr_mirror_drift'
  | 'no_lineup_row'
  | 'lineup_unreadable'
  | 'snapshot_unscorable'
  | 'starter_final_game_no_line'
  | 'pool_mirror_broken'

export type Severity = 'alert' | 'warn' | 'info'

export interface Finding {
  kind: FindingKind
  severity: Severity
  season: number
  week?: number
  league_id?: string
  team_id?: string
  player_id?: string
  stored?: number | null
  recomputed?: number | null
  /** One line an operator can act on. */
  message: string
  detail?: Json
}

export interface ReconcileReport {
  ran_at: string
  season: number
  /** Leagues in scope (in_season | playoffs of the season, not deleted). */
  leagues: number
  /** League-weeks compared (live | correction_window | final). */
  league_weeks: number
  /** Cells compared (a team's stored score on one week). */
  cells: number
  excluded_overridden: number
  findings: Finding[]
  counts: Partial<Record<FindingKind, number>>
  alerts: number
  warns: number
  infos: number
  /** Why nothing was compared — never an empty success by default. */
  reason: 'no_leagues_in_scope' | 'no_league_weeks_started' | null
}

// ── Pure helpers (unit-tested in reconcile.test.ts) ────────────────────────

const SEVERITY: Record<FindingKind, Severity> = {
  no_game_rows: 'alert',
  all_final_unstamped: 'alert',
  game_not_final_late: 'warn',
  drift: 'alert',
  post_window_correction: 'info',
  in_flight: 'info',
  stuck_queue: 'alert',
  pending_vs_stored: 'alert', // h2h; total_points downgrades to warn (F263(c))
  twr_mirror_drift: 'alert',
  no_lineup_row: 'warn',
  lineup_unreadable: 'alert',
  snapshot_unscorable: 'alert',
  starter_final_game_no_line: 'alert',
  pool_mirror_broken: 'alert',
}

/** Two stored-precision scores are equal when they agree to the cent (both are two-decimal values by law). */
export function sameScore(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(roundHalfUp(a) - roundHalfUp(b)) < 0.005
}

export interface CellContext {
  mode: 'h2h' | 'total_points'
  weekStatus: string
  /** ISO — the week's `nfl_weeks.correction_window_ends_at` (null when the calendar lacks it). */
  windowEndsAt: string | null
  /** ISO per starter — `player_stats.updated_at` for the starters that have a line. */
  starterUpdatedAt: ReadonlyMap<string, string>
  /** ISO per starter — `score_fanout.enqueued_at` for starters still queued. */
  starterQueuedAt: ReadonlyMap<string, string>
  now: Date
}

/**
 * Classify ONE cell: stored vs recomputed under the context. Returns null
 * when the cell agrees. The order is the law's: a benign explanation
 * (in flight; a post-window delta on a final week) is looked for BEFORE
 * drift is declared, and a stuck queue is never benign.
 */
export function classifyCell(stored: number | null, computed: TeamWeekScore, ctx: CellContext): { kind: FindingKind; severity: Severity; explanation: string } | null {
  const recomputed = computed.points
  const starters = computed.starters.map((s) => s.player_id)

  // A queued delta for any starter: the worker has not scored it yet.
  const queued = starters.filter((pid) => ctx.starterQueuedAt.has(pid))
  if (queued.length > 0) {
    const nowMs = ctx.now.getTime()
    const stale = queued.filter((pid) => nowMs - new Date(ctx.starterQueuedAt.get(pid)!).getTime() > STALE_QUEUE_MS)
    if (stale.length > 0) {
      return { kind: 'stuck_queue', severity: SEVERITY.stuck_queue, explanation: `queue rows for ${stale.join(', ')} older than ${STALE_QUEUE_MS / 60_000} min — the worker is not draining` }
    }
    if (!sameScore(stored, recomputed)) {
      return { kind: 'in_flight', severity: SEVERITY.in_flight, explanation: `deltas for ${queued.join(', ')} still queued — the worker has not drained them` }
    }
    return null
  }

  if (sameScore(stored, recomputed)) return null

  if (recomputed === null) {
    const severity: Severity = ctx.mode === 'total_points' ? 'warn' : SEVERITY.pending_vs_stored
    const pending = computed.pending.map((p) => `${p.player_id}: ${p.keys.join('/')}`).join('; ')
    return {
      kind: 'pending_vs_stored',
      severity,
      explanation: `recomputed PENDING (E61 — ${pending}) while ${stored} is stored${ctx.mode === 'total_points' ? ' (F263(c): the door keeps a provisional row’s last value)' : ''}`,
    }
  }

  if (ctx.weekStatus === 'final' && ctx.windowEndsAt !== null) {
    const windowMs = new Date(ctx.windowEndsAt).getTime()
    const late = starters.filter((pid) => {
      const at = ctx.starterUpdatedAt.get(pid)
      return at !== undefined && new Date(at).getTime() > windowMs
    })
    if (late.length > 0) {
      return {
        kind: 'post_window_correction',
        severity: SEVERITY.post_window_correction,
        explanation: `the week is final and ${late.join(', ')} moved after the correction window closed (${new Date(ctx.windowEndsAt).toISOString()}) — not auto-applied by law (§23.4/D295(b)); the commissioner's flagged event (M6 L.E2)`,
      }
    }
  }

  return { kind: 'drift', severity: SEVERITY.drift, explanation: `stored ${stored} ≠ recomputed ${recomputed} from raw player_stats through the frozen snapshot (§23.2)` }
}

export interface CalendarWeekRow {
  season: number
  week: number
  starts_at: string
  last_game_ends_at: string | null
  correction_window_ends_at: string | null
}

export interface CalendarGameRow {
  id: string
  season: number
  week: number
  kickoff_at: string
  /** 001's column is nullable (DEFAULT 'scheduled'); NULL reads as scheduled. */
  status: string | null
  home_team: string
  away_team: string
}

function gameStatus(g: CalendarGameRow): string {
  return g.status ?? 'scheduled'
}

/** 116's rule: a postponed game has LEFT the week only when its kickoff is at or past the next calendar week's start. */
export function inWeekGames(games: readonly CalendarGameRow[], week: number, nextStartsAt: string | null): CalendarGameRow[] {
  const nextMs = nextStartsAt === null ? null : new Date(nextStartsAt).getTime()
  return games.filter((g) => g.week === week && !(gameStatus(g) === 'postponed' && nextMs !== null && new Date(g.kickoff_at).getTime() >= nextMs))
}

/** The CALENDAR findings (pure over the two tables). */
export function calendarFindings(weeks: readonly CalendarWeekRow[], games: readonly CalendarGameRow[], now: Date): Finding[] {
  const out: Finding[] = []
  const nowMs = now.getTime()
  const sorted = [...weeks].sort((a, b) => a.week - b.week)
  for (const w of sorted) {
    const startsMs = new Date(w.starts_at).getTime()
    if (startsMs > nowMs + CALENDAR_LOOKAHEAD_MS) continue
    const next = sorted.find((n) => n.week > w.week) ?? null
    const inWeek = inWeekGames(games, w.week, next?.starts_at ?? null)
    const rows = games.filter((g) => g.week === w.week)
    if (rows.length === 0) {
      out.push({
        kind: 'no_game_rows',
        severity: SEVERITY.no_game_rows,
        season: w.season,
        week: w.week,
        message: `${w.season} week ${w.week} (starts ${w.starts_at}) has ZERO nfl_games rows — every player locks from the week datum until rows exist (F228; run the nflverse back-fill / let sync-live's sweep land the calendar)`,
      })
      continue
    }
    const allFinal = inWeek.length > 0 && inWeek.every((g) => gameStatus(g) === 'final')
    if (allFinal && w.last_game_ends_at === null) {
      out.push({
        kind: 'all_final_unstamped',
        severity: SEVERITY.all_final_unstamped,
        season: w.season,
        week: w.week,
        message: `${w.season} week ${w.week}: every in-week game is final (${inWeek.length}) but nfl_weeks.last_game_ends_at is NULL — the release was never OBSERVED by a sync-live poll (F238); every player who kicked off stays locked until one runs (operator escape: a service-role stamp)`,
      })
    }
    for (const g of inWeek) {
      const kickMs = new Date(g.kickoff_at).getTime()
      if ((gameStatus(g) === 'scheduled' || gameStatus(g) === 'live') && nowMs - kickMs > GAME_LATE_MS) {
        out.push({
          kind: 'game_not_final_late',
          severity: SEVERITY.game_not_final_late,
          season: w.season,
          week: w.week,
          message: `${w.season} week ${w.week}: game ${g.id} (${g.away_team} @ ${g.home_team}) kicked off ${Math.round((nowMs - kickMs) / 3_600_000)} h ago and is still '${gameStatus(g)}' — never observed final (Q37's shape: a cancelled game, or a provider that never flipped it); sync-live keeps polling it`,
          detail: { game_id: g.id, status: g.status, kickoff_at: g.kickoff_at },
        })
      }
    }
  }
  return out
}

// ── DB shapes ──────────────────────────────────────────────────────────────

interface LeagueRow {
  id: string
  name: string
  status: string
  season: number
  settings: Json
  roster_settings: Json
  scoring_rules_snapshot: Json
}

interface LeagueWeekRow {
  week: number
  status: string
}

interface MatchupRow {
  id: string
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
  home_score: number | string | null
  away_score: number | string | null
  status: string
  is_overridden: boolean
}

interface ResultRow {
  team_id: string
  week: number
  points: number | string
  is_final: boolean
}

interface LineupRow {
  team_id: string
  week: number
  slot_map: Json
}

interface PlayerRow {
  id: string
  position: string
  team: string | null
}

interface QueueRow {
  week: number
  player_id: string
  enqueued_at: string
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null) throw new Error(`${what}: no data`)
  return result.data
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const IN_CHUNK = 150

function num(value: number | string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function modeOf(settings: Json): 'h2h' | 'total_points' {
  const mode = (settings as { schedule_mode?: unknown } | null)?.schedule_mode
  return mode === 'total_points' ? 'total_points' : 'h2h'
}

// ── Reads ──────────────────────────────────────────────────────────────────

async function readCalendarRows(db: ScoreWorkerClient, season: number): Promise<{ weeks: CalendarWeekRow[]; games: CalendarGameRow[] }> {
  const weeks = must(
    await db.from('nfl_weeks').select('season, week, starts_at, last_game_ends_at, correction_window_ends_at').eq('season', season).order('week'),
    'nfl_weeks read',
  ) as CalendarWeekRow[]
  const games = await pageAll<CalendarGameRow>((from, to) =>
    db.from('nfl_games').select('id, season, week, kickoff_at, status, home_team, away_team', { count: 'exact' }).eq('season', season).order('id').range(from, to),
  )
  return { weeks, games }
}

async function readLeagues(db: ScoreWorkerClient, season: number, scope: readonly string[] | null): Promise<LeagueRow[]> {
  return pageAll<LeagueRow>((from, to) => {
    let q = db
      .from('leagues')
      .select('id, name, status, season, settings, roster_settings, scoring_rules_snapshot', { count: 'exact' })
      .eq('season', season)
      .in('status', ['in_season', 'playoffs'])
      .is('deleted_at', null)
    if (scope) q = q.in('id', [...scope])
    return q.order('id').range(from, to) as unknown as PageResponse<LeagueRow>
  })
}

async function readStatLines(db: ScoreWorkerClient, season: number, week: number, playerIds: readonly string[]): Promise<Map<string, StatLineRow>> {
  const select = ['player_id', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', ')
  const out = new Map<string, StatLineRow>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = must(
      (await db.from('player_stats').select(select).eq('season', season).eq('week', week).in('player_id', ids)) as unknown as {
        data: StatLineRow[] | null
        error: { message: string } | null
      },
      'player_stats read',
    )
    if (rows.length >= 1000) throw new Error(`player_stats read returned ${rows.length} rows for a ${ids.length}-id chunk — at the PostgREST cap, refusing to trust it`)
    for (const row of rows) out.set(row.player_id, row)
  }
  return out
}

async function readPlayers(db: ScoreWorkerClient, ids: readonly string[]): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>()
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = must(await db.from('players').select('id, position, team').in('id', part), 'players read')
    for (const row of rows) out.set(row.id, { id: row.id, position: normalizePosition(row.position), team: row.team })
  }
  return out
}

async function readQueue(db: ScoreWorkerClient, season: number): Promise<QueueRow[]> {
  return pageAll<QueueRow>((from, to) =>
    db.from('score_fanout').select('week, player_id, enqueued_at', { count: 'exact' }).eq('season', season).order('week').order('player_id').range(from, to),
  )
}

// ── The job ────────────────────────────────────────────────────────────────

export interface ReconcileDeps {
  time: TimeProvider
  db: ScoreWorkerClient
}

export interface ReconcileOptions {
  season: number
  /** The stack lane's scope seam (D313(2)'s shape): only these leagues' cells; the calendar checks stay season-wide. */
  leagueIds?: readonly string[]
}

export async function reconcileSeason(deps: ReconcileDeps, opts: ReconcileOptions): Promise<ReconcileReport> {
  const { db } = deps
  const now = deps.time.now()
  const season = opts.season
  const findings: Finding[] = []
  const report: ReconcileReport = {
    ran_at: now.toISOString(),
    season,
    leagues: 0,
    league_weeks: 0,
    cells: 0,
    excluded_overridden: 0,
    findings,
    counts: {},
    alerts: 0,
    warns: 0,
    infos: 0,
    reason: null,
  }

  // CALENDAR (season-wide, F228 / F238 / Q37's shape).
  const calendar = await readCalendarRows(db, season)
  findings.push(...calendarFindings(calendar.weeks, calendar.games, now))
  const weekByNumber = new Map(calendar.weeks.map((w) => [w.week, w]))
  const finalGamesByTeam = new Map<number, Set<string>>()
  for (const g of calendar.games) {
    if (gameStatus(g) !== 'final') continue
    let set = finalGamesByTeam.get(g.week)
    if (!set) {
      set = new Set()
      finalGamesByTeam.set(g.week, set)
    }
    set.add(g.home_team)
    set.add(g.away_team)
  }

  // THE QUEUE (season-wide; per-week, per-player stamps).
  const queue = await readQueue(db, season)
  const queuedByWeek = new Map<number, Map<string, string>>()
  for (const q of queue) {
    let m = queuedByWeek.get(q.week)
    if (!m) {
      m = new Map()
      queuedByWeek.set(q.week, m)
    }
    m.set(q.player_id, q.enqueued_at)
  }

  // LEAGUES in scope.
  const leagues = await readLeagues(db, season, opts.leagueIds ?? null)
  report.leagues = leagues.length
  if (leagues.length === 0) report.reason = 'no_leagues_in_scope'

  for (const league of leagues) {
    const mode = modeOf(league.settings)
    const irKeys = irKeysOf(league.roster_settings)

    // The snapshot gate (D292, seen from here).
    let snapshot: ScoringRulesDoc | null = null
    try {
      assertSnapshotScorable(league.scoring_rules_snapshot)
      snapshot = league.scoring_rules_snapshot
    } catch (err) {
      findings.push({
        kind: 'snapshot_unscorable',
        severity: SEVERITY.snapshot_unscorable,
        season,
        league_id: league.id,
        message: `league_id=${league.id} (${league.name}): the frozen scoring snapshot does not resolve/score — ${err instanceof Error ? err.message : String(err)} (D292: the worker quarantines this league; nothing here can be recomputed)`,
      })
    }

    const weeks = must(await db.from('league_weeks').select('week, status').eq('league_id', league.id).eq('season', season).order('week'), 'league_weeks read') as LeagueWeekRow[]
    const started = weeks.filter((w) => w.status === 'live' || w.status === 'correction_window' || w.status === 'final')
    report.league_weeks += started.length

    // POOL MIRROR (D294).
    const rosters = must(await db.from('league_rosters').select('player_id, team_id').eq('league_id', league.id), 'league_rosters read')
    const pool = must(await db.from('league_player_pool').select('player_id, state').eq('league_id', league.id), 'league_player_pool read')
    const rostered = new Map(rosters.map((r) => [r.player_id, r.team_id]))
    const poolState = new Map(pool.map((p) => [p.player_id, p.state]))
    for (const [pid, state] of poolState) {
      if (state === 'rostered' && !rostered.has(pid)) {
        findings.push({
          kind: 'pool_mirror_broken',
          severity: SEVERITY.pool_mirror_broken,
          season,
          league_id: league.id,
          player_id: pid,
          message: `league_id=${league.id}: league_player_pool says ${pid} is rostered but league_rosters has no row — the mirror is broken (D294; 113's add path refuses on this until repaired)`,
        })
      }
    }
    for (const [pid, teamId] of rostered) {
      const state = poolState.get(pid)
      if (state !== undefined && state !== 'rostered') {
        findings.push({
          kind: 'pool_mirror_broken',
          severity: SEVERITY.pool_mirror_broken,
          season,
          league_id: league.id,
          team_id: teamId,
          player_id: pid,
          message: `league_id=${league.id}: ${pid} is on team ${teamId}'s roster but league_player_pool says '${state}' — the mirror is broken (D294)`,
        })
      }
    }

    if (snapshot === null || started.length === 0) continue

    const teams = must(await db.from('teams').select('id').eq('league_id', league.id), 'teams read').map((t) => t.id)
    const lineups: LineupRow[] = []
    for (const part of chunk(teams, IN_CHUNK)) {
      const rows = must(await db.from('team_lineups').select('team_id, week, slot_map').eq('season', season).in('team_id', part), 'team_lineups read')
      lineups.push(...rows)
    }
    const lineupByTeamWeek = new Map(lineups.map((l) => [`${l.team_id}:${l.week}`, l]))
    const matchups = must(
      await db.from('matchups').select('id, week, round_type, home_team_id, away_team_id, home_score, away_score, status, is_overridden').eq('league_id', league.id).eq('season', season),
      'matchups read',
    ) as MatchupRow[]
    const results = must(await db.from('team_week_results').select('team_id, week, points, is_final').eq('league_id', league.id).eq('season', season), 'team_week_results read') as ResultRow[]

    for (const lw of started) {
      const week = lw.week
      const calWeek = weekByNumber.get(week) ?? null
      const queuedAt = queuedByWeek.get(week) ?? new Map<string, string>()

      // The cells: who is compared this week, and what is stored for them.
      const cells: Array<{ team_id: string; stored: number | null; source: string }> = []
      if (mode === 'h2h') {
        for (const m of matchups.filter((x) => x.week === week)) {
          if (m.is_overridden) {
            report.excluded_overridden += 1
            continue
          }
          cells.push({ team_id: m.home_team_id, stored: num(m.home_score), source: `matchup ${m.id} (${m.round_type}) home` })
          if (m.away_team_id !== null) cells.push({ team_id: m.away_team_id, stored: num(m.away_score), source: `matchup ${m.id} (${m.round_type}) away` })
        }
      } else {
        for (const r of results.filter((x) => x.week === week)) {
          cells.push({ team_id: r.team_id, stored: num(r.points), source: 'team_week_results' })
        }
      }
      if (cells.length === 0) continue

      // Starters of every compared team through the WEEK's lineup.
      const startersByTeam = new Map<string, string[]>()
      const teamIds = [...new Set(cells.map((c) => c.team_id))]
      for (const teamId of teamIds) {
        const row = lineupByTeamWeek.get(`${teamId}:${week}`)
        if (!row) {
          findings.push({
            kind: 'no_lineup_row',
            severity: SEVERITY.no_lineup_row,
            season,
            week,
            league_id: league.id,
            team_id: teamId,
            message: `league_id=${league.id} week ${week}: team ${teamId} has no team_lineups row (D293's auto-carry did not materialize) — its cell cannot be recomputed and is NOT assumed`,
          })
          continue
        }
        const starters = startersOf(row.slot_map, irKeys)
        if (starters === null) {
          findings.push({
            kind: 'lineup_unreadable',
            severity: SEVERITY.lineup_unreadable,
            season,
            week,
            league_id: league.id,
            team_id: teamId,
            message: `league_id=${league.id} week ${week}: team ${teamId}'s team_lineups.slot_map is not an object — unreadable, not recomputed`,
          })
          continue
        }
        startersByTeam.set(teamId, starters)
      }
      const starterIds = [...new Set([...startersByTeam.values()].flat())]
      const [stats, players] = await Promise.all([readStatLines(db, season, week, starterIds), readPlayers(db, starterIds)])
      const updatedAt = new Map<string, string>()
      for (const [pid, row] of stats) updatedAt.set(pid, row.updated_at)
      const ctx: CellContext = {
        mode,
        weekStatus: lw.status,
        windowEndsAt: calWeek?.correction_window_ends_at ?? null,
        starterUpdatedAt: updatedAt,
        starterQueuedAt: queuedAt,
        now,
      }
      const finalTeams = finalGamesByTeam.get(week) ?? new Set<string>()
      const computedByTeam = new Map<string, TeamWeekScore>()

      for (const cell of cells) {
        const starters = startersByTeam.get(cell.team_id)
        if (!starters) continue
        report.cells += 1
        let computed = computedByTeam.get(cell.team_id)
        if (!computed) {
          const refs: StarterRef[] = []
          let unknown: string | null = null
          for (const pid of starters) {
            const p = players.get(pid)
            if (!p) {
              unknown = pid
              break
            }
            refs.push({ player_id: pid, position: p.position })
          }
          if (unknown !== null) {
            findings.push({
              kind: 'lineup_unreadable',
              severity: SEVERITY.lineup_unreadable,
              season,
              week,
              league_id: league.id,
              team_id: cell.team_id,
              player_id: unknown,
              message: `league_id=${league.id} week ${week}: team ${cell.team_id} starts ${unknown}, a player the players table does not know — not recomputed`,
            })
            continue
          }
          computed = computeTeamWeek(snapshot, cell.team_id, refs, stats)
          computedByTeam.set(cell.team_id, computed)

          // F263(g): a starter of a FINAL game with no line.
          for (const s of computed.starters) {
            if (s.reason !== 'no_stat_row') continue
            const team = players.get(s.player_id)?.team ?? null
            if (team !== null && finalTeams.has(team)) {
              findings.push({
                kind: 'starter_final_game_no_line',
                severity: SEVERITY.starter_final_game_no_line,
                season,
                week,
                league_id: league.id,
                team_id: cell.team_id,
                player_id: s.player_id,
                message: `league_id=${league.id} week ${week}: starter ${s.player_id} (${team}) is in a FINAL game and has NO player_stats row — a DNP or a provider gap; the worker scored him 0 by name (Q42) and cannot tell which (F263(g)) — never zero-fill, check the feed`,
              })
            }
          }
        }
        const verdict = classifyCell(cell.stored, computed, ctx)
        if (verdict) {
          findings.push({
            kind: verdict.kind,
            severity: verdict.severity,
            season,
            week,
            league_id: league.id,
            team_id: cell.team_id,
            stored: cell.stored,
            recomputed: computed.points,
            message: `league_id=${league.id} (${league.name}) week ${week} team ${cell.team_id} [${cell.source}]: ${verdict.explanation}`,
            detail: {
              starters: computed.starters.map((s) => ({ player_id: s.player_id, position: s.position, points: s.points, reason: s.reason, pending: s.pending })),
            } as unknown as Json,
          })
        }
      }

      // A final h2h week: the derived results mirror the matchup scores.
      if (mode === 'h2h' && lw.status === 'final') {
        const scoreByTeam = new Map<string, number | null>()
        for (const m of matchups.filter((x) => x.week === week && x.round_type !== 'secondary')) {
          scoreByTeam.set(m.home_team_id, num(m.home_score))
          if (m.away_team_id !== null) scoreByTeam.set(m.away_team_id, num(m.away_score))
        }
        for (const r of results.filter((x) => x.week === week)) {
          const matchup = scoreByTeam.get(r.team_id)
          if (matchup === undefined) continue
          if (!sameScore(num(r.points), matchup)) {
            findings.push({
              kind: 'twr_mirror_drift',
              severity: SEVERITY.twr_mirror_drift,
              season,
              week,
              league_id: league.id,
              team_id: r.team_id,
              stored: num(r.points),
              recomputed: matchup,
              message: `league_id=${league.id} week ${week} team ${r.team_id}: team_week_results.points ${num(r.points)} ≠ the matchup score ${matchup} on a final week (117's derived results drifted from matchups — rebuild_team_week_results is the operator's tool, never this job's)`,
            })
          }
        }
      }
    }
  }

  if (report.reason === null && report.league_weeks === 0) report.reason = 'no_league_weeks_started'
  for (const f of findings) {
    report.counts[f.kind] = (report.counts[f.kind] ?? 0) + 1
    if (f.severity === 'alert') report.alerts += 1
    else if (f.severity === 'warn') report.warns += 1
    else report.infos += 1
  }
  return report
}

/** One line per finding, the alerts first — what the route logs and the CLI prints. */
export function renderFindings(report: ReconcileReport): string[] {
  const order: Record<Severity, number> = { alert: 0, warn: 1, info: 2 }
  return [...report.findings]
    .sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind))
    .map((f) => `[${f.severity.toUpperCase()}] ${f.kind}: ${f.message}`)
}
