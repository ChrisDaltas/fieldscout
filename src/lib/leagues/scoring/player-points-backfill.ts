/**
 * player-points-backfill — the ONE-TIME backfill of stored per-player points
 * for weeks scored before migration 158 (M5 task L.D3.11 (d); PROGRESS F405
 * as RULED by Chris 2026-09-28 — "okay lets stay in line with standard
 * platforms"; spec §7.3.3 / §23.4 v2.16.68).
 *
 *   npm run backfill:player-points -- --season 2026                       (dry run)
 *   npm run backfill:player-points -- --season 2026 --apply --confirm-target <host>
 *
 * For every scored week (live / correction_window / final) of every league of
 * the season, every team that has NO stored rows yet is recomputed from
 * CURRENT stats under the WEEK's rules (`weekScoringRules`, 144 — never the
 * league's current rules) through the worker's own pipeline
 * (`computeTeamWeek`, one implementation — §7.3.3), slot by slot, and sent to
 * 158's `score_backfill_player_points`, which compares the sum with what is
 * STORED and decides (the database is the authority, never this module):
 *   - open week, sum = stored ⇒ stored (`backfill`);
 *   - open week, sum ≠ stored ⇒ skipped (`open_week_mismatch` — the worker
 *     re-scores an open week and its next write stores the rows WITH the score);
 *   - final week, sum = stored ⇒ stored (`backfill`) — RECOVERABLE: the stats
 *     have not moved since the week was scored, so these are exactly the
 *     points it was scored on;
 *   - final week, sum ≠ stored ⇒ stored, marked `backfill_unrecoverable` — a
 *     correction reached a starter after the week was scored and his old
 *     line was overwritten in place (no history — F268), so the points it was
 *     scored on are NOT recoverable; the rows are the corrected recompute,
 *     and the box score / reconcile say so;
 *   - a team already stored (`already_stored` — ONCE), overridden-only
 *     (`overridden`) or with no stored score (`no_stored_score`) is skipped.
 *
 * THE GOLDEN IS BUILT IN: before an --apply the league-season's stored
 * scores and results (every `matchups` cell / result / status and every
 * `team_week_results` row) are read and digested; after it they are read
 * again, and `scores_moved` counts every cell that changed — it must be 0
 * (the door never writes a score). A dry run predicts each team-week's
 * verdict with the door's own rule and writes nothing.
 *
 * Pre-158 (production at 134 before the push): the store is missing and the
 * run refuses BY NAME — there is nothing to backfill into.
 *
 * Time only via `time` (the report's stamp); no provider call — the stats
 * are `player_stats`, the StatsProvider's store.
 */
import type { Json } from '@/types/database'

import { pageAll } from '@/lib/supabase/page-all'

import type { TimeProvider } from '../time/time-provider'
import { isMissingPlayerPointsStore, PRE_158_SENTENCE, readStoredPlayerPointsForSeason } from './player-points-store'
import type { ScoringRulesDoc } from './rules-doc'
import {
  computeTeamWeek,
  irKeysOf,
  normalizePosition,
  playerPointsRows,
  type PlayerPointsRow,
  type ScoreWorkerClient,
  STAT_LINE_COLUMNS,
  starterSlotsOf,
  type StatLineRow,
  weekScoringRules,
} from './score-week-worker'

export type BackfillVerdict = 'backfill' | 'backfill_unrecoverable' | 'open_week_mismatch' | 'already_stored' | 'overridden' | 'no_stored_score' | 'no_lineup_row'

export interface BackfillCell {
  league_id: string
  week: number
  status: string
  team_id: string
  /** The team's stored score(s) on its non-overridden cells. */
  stored: Array<number | null>
  recomputed: number | null
  verdict: BackfillVerdict
  rows: number
}

export interface BackfillReport {
  ran_at: string
  season: number
  mode: 'dry_run' | 'apply'
  leagues: number
  league_weeks: number
  team_weeks: number
  counts: Partial<Record<BackfillVerdict, number>>
  rows_stored: number
  /** The golden (apply only): stored score / result cells read before and after. */
  score_cells: number
  scores_moved: number
  /** Every team-week that is NOT a plain recoverable store — named. */
  notable: BackfillCell[]
  problems: string[]
  ok: boolean
}

interface MatchupRow {
  id: string
  week: number
  home_team_id: string
  away_team_id: string | null
  home_score: number | string | null
  away_score: number | string | null
  result: string | null
  status: string
  is_overridden: boolean
}

interface ResultRow {
  team_id: string
  week: number
  points: number | string
  h2h_result: string | null
  median_result: string | null
  second_result: string | null
  is_final: boolean | null
}

const IN_CHUNK = 150

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null) throw new Error(`${what}: no data`)
  return result.data
}

function num(value: number | string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function same(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.round(a * 100) === Math.round(b * 100)
}

/** The league-season's stored scores and results, as one canonical map (the golden's two reads). */
async function readScoreCells(db: ScoreWorkerClient, leagueId: string, season: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const matchups = await pageAll<MatchupRow>((from, to) =>
    db
      .from('matchups')
      .select('id, week, home_team_id, away_team_id, home_score, away_score, result, status, is_overridden', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', season)
      .order('id')
      .range(from, to),
  )
  for (const m of matchups) {
    out.set(`m:${m.id}`, JSON.stringify([num(m.home_score), num(m.away_score), m.result, m.status, m.is_overridden]))
  }
  const results = await pageAll<ResultRow & { id: string }>((from, to) =>
    db
      .from('team_week_results')
      .select('id, team_id, week, points, h2h_result, median_result, second_result, is_final', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', season)
      .order('id')
      .range(from, to),
  )
  for (const r of results) {
    out.set(`r:${r.team_id}:${r.week}`, JSON.stringify([num(r.points), r.h2h_result, r.median_result, r.second_result, r.is_final]))
  }
  return out
}

export interface BackfillDeps {
  db: ScoreWorkerClient
  time: TimeProvider
}

export interface BackfillOptions {
  season: number
  apply: boolean
  /** The stack lane's scope seam (D313(2)'s shape). */
  leagueIds?: readonly string[]
}

export async function backfillPlayerPoints(deps: BackfillDeps, opts: BackfillOptions): Promise<BackfillReport> {
  const { db } = deps
  const report: BackfillReport = {
    ran_at: deps.time.now().toISOString(),
    season: opts.season,
    mode: opts.apply ? 'apply' : 'dry_run',
    leagues: 0,
    league_weeks: 0,
    team_weeks: 0,
    counts: {},
    rows_stored: 0,
    score_cells: 0,
    scores_moved: 0,
    notable: [],
    problems: [],
    ok: true,
  }
  const count = (v: BackfillVerdict) => {
    report.counts[v] = (report.counts[v] ?? 0) + 1
  }

  let leagueQuery = db
    .from('leagues')
    .select('id, season, settings, roster_settings, scoring_rules_snapshot')
    .eq('season', opts.season)
    .in('status', ['in_season', 'playoffs', 'complete'])
    .is('deleted_at', null)
  if (opts.leagueIds) leagueQuery = leagueQuery.in('id', [...opts.leagueIds])
  const leagues = must(await leagueQuery.order('id'), 'leagues read')
  if (leagues.length >= 1000) throw new Error('leagues read returned 1000 rows — at the PostgREST cap, refusing to trust it')
  report.leagues = leagues.length

  for (const league of leagues) {
    const mode = (league.settings as { schedule_mode?: unknown } | null)?.schedule_mode === 'total_points' ? 'total_points' : 'h2h'
    const stored = await readStoredPlayerPointsForSeason(db, league.id, opts.season)
    if (!stored.available) throw new Error(`backfill refused: ${PRE_158_SENTENCE}`)
    const storedTeams = new Set(stored.rows.map((r) => `${r.team_id}:${r.week}`))

    const weeks = must(
      await db.from('league_weeks').select('week, status, scoring_rules_snapshot').eq('league_id', league.id).eq('season', opts.season).in('status', ['live', 'correction_window', 'final']).order('week'),
      'league_weeks read',
    )
    if (weeks.length === 0) continue

    const teams = must(await db.from('teams').select('id').eq('league_id', league.id), 'teams read').map((t) => t.id)
    const lineups: Array<{ team_id: string; week: number; slot_map: Json }> = []
    for (const part of chunk(teams, IN_CHUNK)) {
      lineups.push(...must(await db.from('team_lineups').select('team_id, week, slot_map').eq('season', opts.season).in('team_id', part), 'team_lineups read'))
    }
    const lineupBy = new Map(lineups.map((l) => [`${l.team_id}:${l.week}`, l]))
    const matchups = await pageAll<MatchupRow>((from, to) =>
      db
        .from('matchups')
        .select('id, week, home_team_id, away_team_id, home_score, away_score, result, status, is_overridden', { count: 'exact' })
        .eq('league_id', league.id)
        .eq('season', opts.season)
        .order('id')
        .range(from, to),
    )
    const results = must(await db.from('team_week_results').select('team_id, week, points, h2h_result, median_result, second_result, is_final').eq('league_id', league.id).eq('season', opts.season), 'team_week_results read') as ResultRow[]
    const irKeys = irKeysOf(league.roster_settings)

    const before = opts.apply ? await readScoreCells(db, league.id, opts.season) : null

    for (const lw of weeks) {
      let rules: ScoringRulesDoc
      try {
        rules = weekScoringRules(lw, league.scoring_rules_snapshot)
      } catch (err) {
        report.problems.push(`league ${league.id} week ${lw.week}: its stored rules do not score — ${err instanceof Error ? err.message : String(err)}; the week is not backfilled`)
        report.ok = false
        continue
      }
      report.league_weeks += 1

      // The teams with a stored score this week.
      const cellsByTeam = new Map<string, { stored: Array<number | null>; overridden: number }>()
      const touch = (teamId: string) => {
        let c = cellsByTeam.get(teamId)
        if (!c) {
          c = { stored: [], overridden: 0 }
          cellsByTeam.set(teamId, c)
        }
        return c
      }
      if (mode === 'h2h') {
        for (const m of matchups.filter((x) => x.week === lw.week)) {
          for (const [teamId, score] of [[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]] as const) {
            if (teamId === null) continue
            const c = touch(teamId)
            if (m.is_overridden) c.overridden += 1
            else c.stored.push(num(score))
          }
        }
      } else {
        for (const r of results.filter((x) => x.week === lw.week)) touch(r.team_id).stored.push(num(r.points))
      }

      // Recompute every not-yet-stored team slot by slot.
      const pending: Array<{ teamId: string; slots: Array<{ slot: string; player_id: string }> }> = []
      for (const teamId of [...cellsByTeam.keys()].sort()) {
        report.team_weeks += 1
        if (storedTeams.has(`${teamId}:${lw.week}`)) {
          count('already_stored')
          continue
        }
        const row = lineupBy.get(`${teamId}:${lw.week}`)
        const slots = row ? starterSlotsOf(row.slot_map, irKeys) : null
        if (slots === null) {
          count('no_lineup_row')
          report.notable.push({ league_id: league.id, week: lw.week, status: lw.status, team_id: teamId, stored: cellsByTeam.get(teamId)!.stored, recomputed: null, verdict: 'no_lineup_row', rows: 0 })
          continue
        }
        pending.push({ teamId, slots })
      }
      if (pending.length === 0) continue

      const ids = [...new Set(pending.flatMap((p) => p.slots.map((s) => s.player_id)))]
      const positions = new Map<string, string>()
      const stats = new Map<string, StatLineRow>()
      for (const part of chunk(ids, IN_CHUNK)) {
        for (const p of must(await db.from('players').select('id, position').in('id', part), 'players read')) positions.set(p.id, normalizePosition(p.position))
        const lines = must(
          (await db
            .from('player_stats')
            .select(['player_id', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', '))
            .eq('season', opts.season)
            .eq('week', lw.week)
            .in('player_id', part)) as unknown as { data: StatLineRow[] | null; error: { message: string } | null },
          'player_stats read',
        )
        for (const l of lines) stats.set(l.player_id, l)
      }

      const payload: Array<{ team_id: string; points: number | null; players: PlayerPointsRow[] }> = []
      const predicted = new Map<string, BackfillCell>()
      for (const p of pending) {
        const unknown = p.slots.find((s) => !positions.has(s.player_id))
        if (unknown) {
          report.problems.push(`league ${league.id} week ${lw.week} team ${p.teamId}: starts ${unknown.player_id}, a player the players table does not know — not backfilled`)
          report.ok = false
          continue
        }
        const team = computeTeamWeek(rules, p.teamId, p.slots.map((s) => ({ player_id: s.player_id, position: positions.get(s.player_id)! })), stats)
        const players = playerPointsRows(p.slots, team)
        const cells = cellsByTeam.get(p.teamId)!
        let verdict: BackfillVerdict
        if (cells.stored.length === 0) verdict = cells.overridden > 0 ? 'overridden' : 'no_stored_score'
        else if (cells.stored.every((s) => same(s, team.points))) verdict = 'backfill'
        else verdict = lw.status === 'final' ? 'backfill_unrecoverable' : 'open_week_mismatch'
        predicted.set(p.teamId, { league_id: league.id, week: lw.week, status: lw.status, team_id: p.teamId, stored: cells.stored, recomputed: team.points, verdict, rows: players.length })
        payload.push({ team_id: p.teamId, points: team.points, players })
      }
      if (payload.length === 0) continue

      if (!opts.apply) {
        for (const cell of predicted.values()) {
          count(cell.verdict)
          if (cell.verdict !== 'backfill') report.notable.push(cell)
        }
        continue
      }

      const { data, error } = await db.rpc('score_backfill_player_points', { p_league_id: league.id, p_week: lw.week, p_teams: payload as unknown as Json })
      if (error) {
        if (isMissingPlayerPointsStore(error) || (error.code === 'PGRST202' && /score_backfill_player_points/.test(error.message))) {
          throw new Error(`backfill refused: ${PRE_158_SENTENCE}`)
        }
        throw new Error(`score_backfill_player_points (${league.id} week ${lw.week}): ${error.message}`)
      }
      const door = data as unknown as {
        written: Array<{ team_id: string; source: 'backfill' | 'backfill_unrecoverable'; rows: number }>
        skipped: Array<{ team_id: string; reason: BackfillVerdict }>
        rows: number
      }
      report.rows_stored += door.rows
      for (const w of door.written) {
        const cell = { ...predicted.get(w.team_id)!, verdict: w.source, rows: w.rows }
        count(w.source)
        if (predicted.get(w.team_id)?.verdict !== w.source) {
          report.problems.push(`league ${league.id} week ${lw.week} team ${w.team_id}: the door stored '${w.source}' where this run predicted '${predicted.get(w.team_id)?.verdict}'`)
          report.ok = false
        }
        if (w.source !== 'backfill') report.notable.push(cell)
      }
      for (const s of door.skipped) {
        const cell = { ...predicted.get(s.team_id)!, verdict: s.reason, rows: 0 }
        count(s.reason)
        if (predicted.get(s.team_id)?.verdict !== s.reason && s.reason !== 'already_stored') {
          report.problems.push(`league ${league.id} week ${lw.week} team ${s.team_id}: the door skipped it as '${s.reason}' where this run predicted '${predicted.get(s.team_id)?.verdict}'`)
          report.ok = false
        }
        report.notable.push(cell)
      }
    }

    if (before !== null) {
      const after = await readScoreCells(db, league.id, opts.season)
      report.score_cells += before.size
      const keys = new Set([...before.keys(), ...after.keys()])
      for (const k of keys) {
        if (before.get(k) !== after.get(k)) {
          report.scores_moved += 1
          report.problems.push(`GOLDEN BROKEN — league ${league.id}: stored cell ${k} moved during the backfill (${before.get(k)} → ${after.get(k)}); the backfill must never move a score`)
          report.ok = false
        }
      }
    }
  }
  return report
}

/** One line per fact, for the CLI. */
export function renderBackfill(report: BackfillReport): string[] {
  const lines = [
    `season ${report.season} · ${report.mode} · leagues ${report.leagues} · scored league-weeks ${report.league_weeks} · team-weeks ${report.team_weeks}`,
    `verdicts: ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'} · rows stored ${report.rows_stored}`,
  ]
  if (report.mode === 'apply') lines.push(`golden: ${report.score_cells} stored score/result cells read before and after — ${report.scores_moved} moved`)
  for (const c of report.notable) {
    lines.push(`  ${c.verdict}: league ${c.league_id} week ${c.week} (${c.status}) team ${c.team_id} — stored ${JSON.stringify(c.stored)}, recomputed ${c.recomputed}`)
  }
  for (const p of report.problems) lines.push(`PROBLEM: ${p}`)
  return lines
}
