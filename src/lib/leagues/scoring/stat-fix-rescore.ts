/**
 * stat-fix-rescore — OUR OWN STAT FIXES re-score final weeks, automatically
 * and quietly, in every league (migration 222; PROGRESS D836–D839; spec
 * v2.16.118, §7.3.3 / §11.4 / §23.4).
 *
 * THE RULINGS (Chris, verbatim):
 *   2026-11-07: "the stats need to be correct. that should be done
 *               automatically, we should not be doing this is as some live
 *               code change."
 *   2026-11-07: "stat and scoring changes are all platform wide by the way,
 *               they are not gated to users or leagues."
 *   2026-11-07: "fixing stats should not go to some user, i'm not following"
 *   2026-11-07: "just update the points as they should be so we can move on."
 *   2026-11-06: "as long as all the players have the right stats and scores
 *               as a result, then the "team" scores do not matter."
 *   Standing: F405 / Q81 / §23.4 — the provider's own late corrections after a
 *   week's window never change a final week. This module keeps that true.
 *
 * A STAT FIX (`stat_fixes` + `stat_fix_lines`, 222) is a record of OUR change:
 * (week, player, stat column, before → after). The quiet fill records one on
 * every --apply; `npm run stat-fix -- record` records one for an engine fix
 * or a backlog. Only a WRITTEN fix is ever applied.
 *
 * WHAT IT PAYS. For each STORED starter row of a final week — the (slot,
 * player) that was actually scored, never `team_lineups.slot_map` — that a
 * fix names:
 *     delta = points(today's line with the fix's keys at AFTER)
 *           − points(today's line with the fix's keys at BEFORE)
 * both through the worker's own `scoreStarter` (the one scorer, §7.3.3 / D33)
 * under that week's frozen rules (`weekScoringRules`), and the new stored
 * points = stored + delta. A provider correction on the same line sits in
 * both terms and cancels, so it is never paid; on the SAME key the fix's
 * after value is what we wrote, and a provider move past it is not ours
 * either. A team's score = Σ its new rows (they ARE the score, F405). A
 * starter on a held game (184) scores nothing either way. A commissioner-
 * overridden team keeps his score (§22.2) and its players still move (Chris
 * 2026-11-06: "as long as all the players have the right stats and scores as
 * a result, then the "team" scores do not matter.").
 *
 * WHERE. `runStatFixPass` runs inside every score-week invocation, beside the
 * 216 close pass: it asks `stat_fix_targets` for the owed (fix, league, week)s
 * — written fix × eligible league × fix week, no receipt — at most
 * `STAT_FIX_PASS_LIMIT` a pass, plans each through `planLeagueWeekFix` and
 * hands it whole to `apply_stat_fix_week`, which checks it against what is
 * stored, writes the scores with their results, the rows (`stat_fix`), the
 * results math, and ONE system receipt — no commissioner-log row, no post, no
 * notification. A receipt is written even when nothing changed, so a done
 * week is never asked again. An ineligible league-week (archived, not in
 * season, bracket built, week not final, last scored after the fix landed —
 * 216's close stamp, else its finalization) is never planned and gets no
 * receipt: it stays owed. DEPLOY BEFORE PUSH: a
 * database without 222 makes the pass a silent no-op, never an error.
 *
 * Time only via `time`; no provider call — the stats are `player_stats`.
 */
import type { Json } from '@/types/database'

import { pageAll } from '@/lib/supabase/page-all'
import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'

import type { TimeProvider } from '../time/time-provider'
import { roundHalfUp } from './calculator'
import { readHeldGames, withoutHeldLines } from './held-games'
import type { ScoringRulesDoc } from './rules-doc'
import {
  normalizePosition,
  type PlayerPointsRow,
  scoreStarter,
  type ScoreWorkerClient,
  STAT_LINE_COLUMNS,
  type StatLineRow,
  weekScoringRules,
} from './score-week-worker'

export const STAT_FIX_DOOR = 'apply_stat_fix_week'
export const STAT_FIX_TARGETS = 'stat_fix_targets'
/** League-weeks one score-week invocation applies at most (the pass runs every minute). */
export const STAT_FIX_PASS_LIMIT = 5

export interface StatFixLine {
  week: number
  player_id: string
  /** A `player_stats` column (222's record_stat_fix refuses any other). */
  stat_key: string
  before: number
  after: number
}

/** A stored per-player row as this module reads it. */
export interface StoredRowIn {
  team_id: string
  slot: string
  player_id: string
  points: number
  pending: string[]
  reason: 'scored' | 'no_stat_row'
  source: string
}

// ── The delta (pure; the one scorer) ───────────────────────────────────────

/** Today's line with the fix's keys set to one side of the fix. */
export function lineAt(today: StatLineRow, lines: readonly StatFixLine[], side: 'before' | 'after'): StatLineRow {
  const out: StatLineRow = { ...today }
  for (const line of lines) out[line.stat_key] = side === 'before' ? line.before : line.after
  return out
}

export interface StarterFixDelta {
  player_id: string
  /** The starter's points with the fix's keys at before / at after (each per-player rounded, §7.3.3). */
  before: number
  after: number
  /** after − before: exactly what our change pays. */
  delta: number
  reason: 'scored' | 'no_stat_row'
}

/**
 * What one fix pays one starter under one week's rules: the worker's
 * `scoreStarter` twice over today's line, once with the fix's keys at their
 * before values and once at their after values. Everything else on the line —
 * a provider's late correction included — is in both and cancels.
 */
export function starterFixDelta(
  rules: ScoringRulesDoc,
  playerId: string,
  position: string,
  today: StatLineRow,
  lines: readonly StatFixLine[],
): StarterFixDelta {
  const before = scoreStarter(rules, playerId, position, lineAt(today, lines, 'before'))
  const after = scoreStarter(rules, playerId, position, lineAt(today, lines, 'after'))
  return { player_id: playerId, before: before.points, after: after.points, delta: roundHalfUp(after.points - before.points), reason: after.reason }
}

// ── The plan of one league-week (pure) ─────────────────────────────────────

export interface PlanTeamIn {
  team_id: string
  /** The team's stored score on each NON-overridden cell it sits in (h2h), or its results row (total_points). */
  cells: Array<number | null>
  /** Overridden cells: the commissioner's numbers, kept (§22.2) — his team's ROWS still take our change. */
  overridden_cells: number
  rows: StoredRowIn[]
}

/** One row as the door takes it (158's shape) plus what the plan read and moved. */
export interface PlannedRow extends PlayerPointsRow {
  /** The stored points the plan started from (the door refuses a row that has moved since — `plan_stale`). */
  stored: number
  delta: number
}

export interface PlannedTeam {
  team_id: string
  cells: Array<number | null>
  overridden_cells: number
  /** Σ of the stored rows. */
  stored_sum: number
  /** Σ of the new rows: the score the door writes on every non-overridden cell. */
  points: number
  players: PlannedRow[]
  /** The rows our fix moves — the door writes every one of them, an overridden team's too. */
  changed: PlannedRow[]
  /** ≥ 1 non-overridden cell: the door writes this team's SCORE (and asks it to be Σ its stored rows). */
  writable: boolean
}

export interface WeekPlanIn {
  rules: ScoringRulesDoc
  teams: readonly PlanTeamIn[]
  /** This week's lines of the fix. */
  lines: readonly StatFixLine[]
  /** Today's lines of the fixed starters. */
  stats: ReadonlyMap<string, StatLineRow>
  positions: ReadonlyMap<string, string>
  /** Fixed starters whose line is on a held game (184): they score nothing either way. */
  held: ReadonlySet<string>
}

const cents = (n: number): number => Math.round(n * 100)

/** Σ of two-decimal points, in cents so the total is exact (player-points-store's way). */
function sumPoints(rows: ReadonlyArray<{ points: number }>): number {
  return rows.reduce((acc, r) => acc + cents(r.points), 0) / 100
}

/**
 * Every team of the week at stored + our change, slot by slot. A problem stops
 * the league-week (it is never half fixed): a writable team whose stored score
 * is not the sum of its stored rows (`rows_drift` — what was scored is not
 * known, so a delta can't be added to it), a pending row in a final week, a
 * fixed starter the players table or today's stats don't have.
 */
export function planWeekFix(input: WeekPlanIn): { teams: PlannedTeam[]; problems: string[] } {
  const byPlayer = new Map<string, StatFixLine[]>()
  for (const line of input.lines) byPlayer.set(line.player_id, [...(byPlayer.get(line.player_id) ?? []), line])
  const problems: string[] = []
  const teams: PlannedTeam[] = []
  for (const team of [...input.teams].sort((a, b) => (a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0))) {
    const rows = [...team.rows].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
    const storedSum = sumPoints(rows)
    const writable = team.cells.length > 0
    if (rows.some((r) => r.pending.length > 0)) problems.push(`team ${team.team_id}: a stored row is pending in a final week — a final week never stores pending`)
    if (writable) {
      for (const cell of team.cells) {
        if (cell === null || cents(cell) !== cents(storedSum)) {
          problems.push(
            `team ${team.team_id}: rows_drift — its stored score ${cell === null ? 'blank' : cell.toFixed(2)} is not the sum of its stored rows (${rows.length === 0 ? 'none' : storedSum.toFixed(2)}); a fix adds our change to what was scored, and that is not known here`,
          )
        }
      }
    }
    const players: PlannedRow[] = []
    for (const row of rows) {
      const lines = byPlayer.get(row.player_id)
      const keep: PlannedRow = { slot: row.slot, player_id: row.player_id, points: row.points, pending: row.pending, reason: row.reason, stored: row.points, delta: 0 }
      if (lines === undefined || input.held.has(row.player_id)) {
        players.push(keep)
        continue
      }
      const position = input.positions.get(row.player_id)
      const today = input.stats.get(row.player_id)
      if (position === undefined) {
        problems.push(`team ${team.team_id}: starter ${row.player_id} (${row.slot}) is not in players — his fix can't be scored`)
        players.push(keep)
        continue
      }
      if (today === undefined) {
        problems.push(`team ${team.team_id}: starter ${row.player_id} (${row.slot}) has no stat line today, but the fix names him — refusing to read a fix onto nothing`)
        players.push(keep)
        continue
      }
      const d = starterFixDelta(input.rules, row.player_id, position, today, lines)
      if (d.delta === 0) {
        players.push(keep)
        continue
      }
      players.push({ ...keep, points: roundHalfUp(row.points + d.delta), reason: d.reason, delta: d.delta })
    }
    const points = sumPoints(players)
    teams.push({
      team_id: team.team_id,
      cells: team.cells,
      overridden_cells: team.overridden_cells,
      stored_sum: storedSum,
      points,
      players,
      changed: players.filter((p) => p.delta !== 0),
      writable,
    })
  }
  return { teams, problems }
}

// ── The plan of one league-week (IO) ───────────────────────────────────────

export interface WeekFixPlan {
  league_id: string
  league_name: string
  season: number
  week: number
  schedule_mode: 'h2h' | 'total_points'
  /** Set when the league-week can't be fixed here, by name (nothing planned). */
  ineligible: string | null
  teams: PlannedTeam[]
  problems: string[]
}

interface MatchupRow {
  id: string
  home_team_id: string
  away_team_id: string | null
  home_score: number | string | null
  away_score: number | string | null
  is_overridden: boolean
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null) throw new Error(`${what}: no data`)
  return result.data
}

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))

/**
 * Reads one league-week as it was scored and plans `lines` (this week's) onto
 * it. The eligibility read here only saves a pointless plan — the door decides
 * (`stat_fix_targets` already picked the owed ones for the pass). `landedAt`
 * (the CLI's `plan --landed-at`: lines not yet recorded, so the door has no
 * landing to check) names a week last scored after it as not eligible, the
 * door's own `week_scored_after_fix` reading.
 */
export async function planLeagueWeekFix(
  db: ScoreWorkerClient,
  leagueId: string,
  week: number,
  lines: readonly StatFixLine[],
  landedAt?: string,
): Promise<WeekFixPlan> {
  const read = await db.from('leagues').select('id, name, season, status, deleted_at, settings, scoring_rules_snapshot').eq('id', leagueId).maybeSingle()
  if (read.error) throw new Error(`league ${leagueId} read: ${read.error.message}`)
  if (read.data === null) throw new Error(`league ${leagueId} read: no such league`)
  const league = read.data
  const mode = (league.settings as { schedule_mode?: unknown } | null)?.schedule_mode === 'total_points' ? 'total_points' : 'h2h'
  const plan: WeekFixPlan = { league_id: league.id, league_name: league.name, season: league.season, week, schedule_mode: mode, ineligible: null, teams: [], problems: [] }
  if (league.deleted_at !== null) return { ...plan, ineligible: 'league_archived' }
  if (league.status !== 'in_season') return { ...plan, ineligible: `league_not_in_season (${league.status})` }
  // The door's order: a built bracket was seeded from the standings a fix would move.
  const bracket = must(
    await db.from('matchups').select('id').eq('league_id', leagueId).eq('season', league.season).in('round_type', ['playoff', 'consolation', 'third_place']).limit(1),
    'bracket read',
  )
  if (bracket.length > 0) return { ...plan, ineligible: 'bracket_built' }
  const lw = await db
    .from('league_weeks')
    .select('week, status, scoring_rules_snapshot, scored_at, finalized_at')
    .eq('league_id', leagueId)
    .eq('season', league.season)
    .eq('week', week)
    .maybeSingle()
  if (lw.error) throw new Error(`league_weeks read: ${lw.error.message}`)
  if (lw.data === null) return { ...plan, ineligible: 'week_not_scheduled' }
  if (lw.data.status !== 'final') return { ...plan, ineligible: `week_not_final (${lw.data.status})` }
  // The door's last gate (222): when the week's scores were last computed — 216's close stamp, else its finalization.
  const lastScored = lw.data.scored_at ?? lw.data.finalized_at
  if (landedAt !== undefined && lastScored !== null && Date.parse(lastScored) > Date.parse(landedAt)) {
    return { ...plan, ineligible: `week_scored_after_fix (last scored ${lastScored}, after the fix landed ${landedAt}: scored with it already)` }
  }
  let rules: ScoringRulesDoc
  try {
    rules = weekScoringRules(lw.data, league.scoring_rules_snapshot)
  } catch (err) {
    return { ...plan, problems: [`its stored rules do not score — ${err instanceof Error ? err.message : String(err)}`] }
  }

  // The week's teams and their stored cells (an overridden cell is the commissioner's — counted, never compared).
  const cells = new Map<string, { cells: Array<number | null>; overridden: number }>()
  const touch = (teamId: string) => {
    let c = cells.get(teamId)
    if (!c) cells.set(teamId, (c = { cells: [], overridden: 0 }))
    return c
  }
  if (mode === 'h2h') {
    const matchups = must(
      await db.from('matchups').select('id, home_team_id, away_team_id, home_score, away_score, is_overridden').eq('league_id', leagueId).eq('season', league.season).eq('week', week),
      'matchups read',
    ) as MatchupRow[]
    for (const m of matchups) {
      for (const [teamId, score] of [[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]] as const) {
        if (teamId === null) continue
        const c = touch(teamId)
        if (m.is_overridden) c.overridden += 1
        else c.cells.push(num(score))
      }
    }
  } else {
    const results = must(await db.from('team_week_results').select('team_id, points').eq('league_id', leagueId).eq('season', league.season).eq('week', week), 'team_week_results read')
    for (const r of results) touch(r.team_id).cells.push(num(r.points))
  }
  if (cells.size === 0) return { ...plan, problems: ['final, but no stored score for any team — nothing to fix'] }

  const stored = await pageAll<{ team_id: string; slot: string; player_id: string; points: number | string; pending: string[] | null; reason: string; source: string }>((from, to) =>
    db
      .from('league_week_player_points')
      .select('team_id, slot, player_id, points, pending, reason, source', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', league.season)
      .eq('week', week)
      .order('team_id')
      .order('slot')
      .range(from, to),
  )
  const rowsBy = new Map<string, StoredRowIn[]>()
  for (const r of stored) {
    const row: StoredRowIn = { team_id: r.team_id, slot: r.slot, player_id: r.player_id, points: Number(r.points), pending: r.pending ?? [], reason: r.reason === 'no_stat_row' ? 'no_stat_row' : 'scored', source: r.source }
    rowsBy.set(r.team_id, [...(rowsBy.get(r.team_id) ?? []), row])
  }

  // Only the fixed STARTERS are read: a fix on a bench player changes no score.
  const weekLines = lines.filter((l) => l.week === week)
  const fixedStarters = [...new Set(stored.map((r) => r.player_id).filter((id) => weekLines.some((l) => l.player_id === id)))].sort()
  const positions = new Map<string, string>()
  const teamsOf = new Map<string, string | null>()
  const stats = new Map<string, StatLineRow>()
  if (fixedStarters.length > 0) {
    for (const p of must(await db.from('players').select('id, position, team').in('id', fixedStarters), 'players read')) {
      positions.set(p.id, normalizePosition(p.position))
      teamsOf.set(p.id, p.team)
    }
    const today = must(
      (await db
        .from('player_stats')
        .select(['player_id', 'updated_at', 'advanced', 'game_id', ...STAT_LINE_COLUMNS].join(', '))
        .eq('season', league.season)
        .eq('week', week)
        .in('player_id', fixedStarters)) as unknown as { data: StatLineRow[] | null; error: { message: string } | null },
      'player_stats read',
    )
    for (const l of today) stats.set(l.player_id, l)
  }
  // M8 TD7 / R1551 (184): a line on a game an operator marked out of the week never scores, fix or no fix.
  const heldGames = fixedStarters.length > 0 ? await readHeldGames(db, league.season, week) : null
  const held = new Set(heldGames ? withoutHeldLines(stats, heldGames, (id) => teamsOf.get(id)).dropped : [])

  const planned = planWeekFix({
    rules,
    teams: [...cells.entries()].map(([teamId, c]) => ({ team_id: teamId, cells: c.cells, overridden_cells: c.overridden, rows: rowsBy.get(teamId) ?? [] })),
    lines: weekLines,
    stats,
    positions,
    held,
  })
  return { ...plan, teams: planned.teams, problems: planned.problems }
}

// ── The door ───────────────────────────────────────────────────────────────

/** What 222's door returns — the parts this module reads. */
export interface StatFixDoorDoc {
  fix_id: string | null
  league_id: string
  season: number
  week: number
  dry_run: boolean
  receipt_id: string | null
  replayed: boolean
  no_changes: boolean
  team_scores: Array<{ team_id: string; stored: Array<number | null>; recomputed: number; score_changed: boolean }>
  scores_changed: number
  players_changed: number
  results_changed: Array<{ team_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>
  flips: Array<{ matchup_id: string }>
  median_score_before: number | null
  median_score_after: number | null
}

export type WeekFixVerdict =
  | 'applied' // the door wrote it (a receipt)
  | 'would_apply' // dry run: the door's apply, rolled back
  | 'no_changes' // nothing in the week moves (a receipt on apply)
  | 'already_applied' // a receipt for (fix, league, week) exists: replayed
  | 'ineligible' // not planned: archived / not in season / week not final …
  | 'refused' // the door refused it by name, or the plan named a problem

export interface WeekFixOutcome {
  plan: WeekFixPlan
  verdict: WeekFixVerdict
  doc: StatFixDoorDoc | null
  /** Why it was refused (the door's words, or the plan's problems). */
  refusal: string | null
  problems: string[]
}

/** The payload the door takes: every team of the week, every stored row. */
export function doorTeams(plan: WeekFixPlan): Json {
  return plan.teams.map((t) => ({
    team_id: t.team_id,
    points: t.points,
    players: t.players.map((p) => ({ slot: p.slot, player_id: p.player_id, points: p.points, pending: p.pending, reason: p.reason, stored: p.stored })),
  })) as unknown as Json
}

/**
 * Rows the door should write: every row our fix moves, on every team — a
 * commissioner-overridden one's too (his score stays; Chris 2026-11-06: "as
 * long as all the players have the right stats and scores as a result, then
 * the "team" scores do not matter.").
 */
export function plannedRowWrites(plan: WeekFixPlan): number {
  return plan.teams.reduce((n, t) => n + t.changed.length, 0)
}

/**
 * Plans one league-week and hands it to the door (apply or dry run). `fixId`
 * null is a dry run of lines not yet recorded (the CLI's `plan`). A door that
 * answers for another request, or with numbers this plan did not compute, is a
 * problem (one calculator, two readers — 161's F65(b) / prediction checks).
 * Throws only when the door is MISSING (the caller's deploy-before-push arm) or
 * on a transport error.
 */
export async function fixLeagueWeek(
  db: ScoreWorkerClient,
  target: { fixId: string | null; leagueId: string; week: number; lines: readonly StatFixLine[]; landedAt?: string },
  apply: boolean,
): Promise<WeekFixOutcome> {
  const plan = await planLeagueWeekFix(db, target.leagueId, target.week, target.lines, target.landedAt)
  const out: WeekFixOutcome = { plan, verdict: 'ineligible', doc: null, refusal: plan.ineligible, problems: [] }
  if (plan.ineligible !== null) return out
  if (plan.problems.length > 0) return { ...out, verdict: 'refused', refusal: plan.problems.join('; '), problems: plan.problems }

  const { data, error } = await db.rpc(STAT_FIX_DOOR, {
    p_fix_id: target.fixId as string,
    p_league_id: target.leagueId,
    p_week: target.week,
    p_teams: doorTeams(plan),
    p_dry_run: !apply,
  })
  if (error) {
    if (isMissingSchemaObject(error, [STAT_FIX_DOOR])) throw new Error(`stat fix: ${PRE_222_SENTENCE}`)
    return { ...out, verdict: 'refused', refusal: error.message, problems: [`${STAT_FIX_DOOR} refused — ${error.message}`] }
  }
  const doc = data as unknown as StatFixDoorDoc
  if (doc.replayed) return { ...out, verdict: 'already_applied', doc }
  const where = `league ${target.leagueId} week ${target.week}`
  const problems: string[] = []
  // F65(b): the document must answer THIS request.
  if (doc.league_id !== target.leagueId || doc.week !== target.week || doc.fix_id !== target.fixId || doc.dry_run !== !apply) {
    problems.push(`${where}: the door answered for league ${doc.league_id} week ${doc.week} (fix ${doc.fix_id}, dry_run ${doc.dry_run}) — not this request`)
  }
  // The door's numbers must be this plan's.
  const mine = new Map(plan.teams.map((t) => [t.team_id, t.points]))
  for (const t of doc.team_scores ?? []) {
    const p = mine.get(t.team_id)
    if (p === undefined || cents(p) !== cents(Number(t.recomputed))) problems.push(`${where}: the door recorded team ${t.team_id} at ${t.recomputed}, this plan computed ${p}`)
  }
  if (doc.players_changed !== plannedRowWrites(plan)) problems.push(`${where}: the door writes ${doc.players_changed} player row(s), this plan moved ${plannedRowWrites(plan)}`)
  const verdict: WeekFixVerdict = doc.no_changes ? 'no_changes' : apply ? 'applied' : 'would_apply'
  return { ...out, verdict, doc, refusal: null, problems }
}

export const PRE_222_SENTENCE =
  'the database predates migration 222 (no apply_stat_fix_week / stat_fix_targets / record_stat_fix) — push 222 first; nothing was fixed'

// ── The pass (score-week invocation) ───────────────────────────────────────

export interface StatFixPassEntry {
  fix_id: string
  league_id: string
  week: number
  verdict: WeekFixVerdict
  players_changed: number
  scores_changed: number
  results_changed: number
  refusal: string | null
}

export interface StatFixPassReport {
  ran_at: string
  /** False: the database predates 222 — a silent no-op (deploy before push). */
  available: boolean
  weeks: StatFixPassEntry[]
  applied: number
  problems: string[]
}

/**
 * The stat-fix pass: every owed (fix, league, week) `stat_fix_targets` names —
 * in random order, at most `limit` — planned and applied. A league-week the
 * door refuses stays owed (no receipt) and is named as a problem; the next
 * pass tries again. Throws only on a transport error or an unexpected answer
 * from the targets read (the invoker turns that into one alert and carries
 * on); a database without 222 is `available: false` and nothing else.
 */
export async function runStatFixPass(
  deps: { db: ScoreWorkerClient; time: TimeProvider },
  opts: { limit?: number; leagueIds?: readonly string[] } = {},
): Promise<StatFixPassReport> {
  const { db, time } = deps
  const report: StatFixPassReport = { ran_at: time.now().toISOString(), available: true, weeks: [], applied: 0, problems: [] }
  const asked = await db.rpc(STAT_FIX_TARGETS, {
    p_owed_only: true,
    p_limit: opts.limit ?? STAT_FIX_PASS_LIMIT,
    ...(opts.leagueIds ? { p_league_ids: [...opts.leagueIds] } : {}),
  })
  if (asked.error) {
    if (isMissingSchemaObject(asked.error, [STAT_FIX_TARGETS])) {
      report.available = false
      return report
    }
    throw new Error(`${STAT_FIX_TARGETS}: ${asked.error.message}`)
  }
  const linesByFix = new Map<string, StatFixLine[]>()
  for (const target of asked.data ?? []) {
    let lines = linesByFix.get(target.fix_id)
    if (lines === undefined) {
      lines = await readFixLines(db, target.fix_id)
      linesByFix.set(target.fix_id, lines)
    }
    let outcome: WeekFixOutcome
    try {
      outcome = await fixLeagueWeek(db, { fixId: target.fix_id, leagueId: target.league_id, week: target.week, lines }, true)
    } catch (err) {
      if (err instanceof Error && err.message === `stat fix: ${PRE_222_SENTENCE}`) {
        report.available = false
        return report
      }
      throw err
    }
    const doc = outcome.doc
    report.weeks.push({
      fix_id: target.fix_id,
      league_id: target.league_id,
      week: target.week,
      verdict: outcome.verdict,
      players_changed: doc?.players_changed ?? 0,
      scores_changed: doc?.scores_changed ?? 0,
      results_changed: doc?.results_changed?.length ?? 0,
      refusal: outcome.refusal,
    })
    if (outcome.verdict === 'applied' || outcome.verdict === 'no_changes') report.applied += 1
    for (const p of outcome.problems) report.problems.push(`fix ${target.fix_id} league_id=${target.league_id} week ${target.week}: ${p}`)
    if (outcome.verdict === 'ineligible') {
      // stat_fix_targets said owed and the read says not: the two disagree — never quiet.
      report.problems.push(`fix ${target.fix_id} league_id=${target.league_id} week ${target.week}: named owed, but ${outcome.refusal} — not applied, still owed`)
    }
  }
  return report
}

/** A fix's lines, every week (zero-policy table: the service role's read). */
export async function readFixLines(db: ScoreWorkerClient, fixId: string): Promise<StatFixLine[]> {
  const rows = await pageAll<{ week: number; player_id: string; stat_key: string; before_value: number | string; after_value: number | string }>((from, to) =>
    db
      .from('stat_fix_lines')
      .select('week, player_id, stat_key, before_value, after_value', { count: 'exact' })
      .eq('fix_id', fixId)
      .order('week')
      .order('player_id')
      .order('stat_key')
      .range(from, to),
  )
  if (rows.length === 0) throw new Error(`stat fix ${fixId} has no lines — a written fix always has some (record_stat_fix refuses none)`)
  return rows.map((r) => ({ week: r.week, player_id: r.player_id, stat_key: r.stat_key, before: Number(r.before_value), after: Number(r.after_value) }))
}
