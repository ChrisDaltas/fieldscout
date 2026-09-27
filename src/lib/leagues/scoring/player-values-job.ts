/**
 * player-values-job — the `league-player-values` job (M6A task L.E1.20;
 * migration 137; PROGRESS Q62 (RULED), F379 second third, D374; spec §12.28
 * + §14's `league-player-values` row). The scoring half lives in
 * `./player-values` (pure); this module is the IO around it.
 *
 * WHY ITS OWN CRON ROUTE (the task let the Builder choose — "its own cron
 * route or a phase of an existing worker"): the values depend on FOUR moving
 * inputs — the weekly lines (136's sync, hourly), `player_stats` (ingestion),
 * each league's roster (add/drop, daily-ish) and snapshot (a commissioner
 * scoring change). As a phase of the projections sync it would inherit that
 * sync's failure (a Sleeper outage would also stop re-valuing rosters and
 * season totals) and couple a stat-lines job to league state; as a phase of
 * the scoring worker it would run every minute for data that moves hourly.
 * A separate hourly route at :50 — ten minutes after the sync lands — keeps
 * each job's failure its own and named.
 *
 * WHAT ONE RUN DOES
 *   1. PLAN from `nfl_weeks` at the injected instant — the SAME planner the
 *      projections sync uses (`planProjectionWeeks`: the current calendar
 *      week and the next; §23.3 — never wall-clock week math), so a week has
 *      values from the moment it has lines, days before its first lock.
 *   2. LEAGUES: every `in_season` / `playoffs` league of the season (not
 *      deleted). For each planned week the league actually PLAYS (a
 *      `league_weeks` row — a league whose schedule is over is named, not
 *      valued).
 *   3. THE SNAPSHOT GATE — the scoring worker's own `assertSnapshotScorable`
 *      on `leagues.scoring_rules_snapshot` (§7.3.3: the frozen snapshot,
 *      never the live `scoring_systems` row): a NULL or corrupt snapshot
 *      QUARANTINES that league by name; its siblings are valued.
 *   4. INPUTS, paged past the 1000-row cap (`pageAll`, exact counts): the
 *      league's ROSTER (the population autopilot chooses from), each
 *      player's position and season line, the week's projection lines, and
 *      his `player_stats` rows for the season's weeks before the week.
 *   5. VALUES through `computePlayerValue` (the canonical scorer only).
 *   6. WRITE (service role): upsert in chunks, each count ASSERTED (a short
 *      write is a named failure, never "done"); then remove the league-week's
 *      rows for players no longer rostered (a dropped player's value is not
 *      left behind), count reported.
 *   7. REPORT loudly. A league-week with no rostered player, or whose values
 *      carry NO usable projection at all (every line absent or stale — the
 *      projections sync is not landing: Sleeper publishes every week up
 *      front, D373(3)), is a FAILURE by name — the rows are still written so
 *      the fallback keys stay current, but the run is not a success. Stale
 *      lines are counted and named per league-week. `ok` is false on any
 *      failure; an empty plan is a failure unless the season is over.
 *
 * Time only via the injected TimeProvider (D3 — this file is under the ESLint
 * time guard); the DB only via `db` (a service-role client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { type PageResponse, pageAll } from '@/lib/supabase/page-all'
import { planProjectionWeeks, readProjectionCalendar, type ProjectionWeekPlan } from '@/lib/sync/weekly-projections'
import type { Database } from '@/types/database'

import type { TimeProvider } from '../time/time-provider'
import { computePlayerValue, type PlayerValueRow } from './player-values'
import type { ScoringRulesDoc } from './rules-doc'
import { assertSnapshotScorable, normalizePosition, STAT_LINE_COLUMNS, type StatLineRow } from './score-week-worker'

export const PLAYER_VALUES_TABLE = 'league_player_values'

type Db = SupabaseClient<Database>

/** `in.(…)` chunk for id lists (URL-safe; the worker's own size). */
const IN_CHUNK = 150
/** Upsert chunk (PostgREST bodies stay small). */
const UPSERT_CHUNK = 500
/** How many ids a warning names before it summarises the rest. */
const NAMED = 10

export interface PlayerValuesDeps {
  db: Db
  time: TimeProvider
}

export interface LeagueWeekValues {
  league_id: string
  week: number
  ok: boolean
  rostered: number
  written: number
  removed: number
  /** Rows with a projected value / a stale line / no line. */
  projected: number
  stale: number
  noLine: number
  /** Rows with season-to-date points (≥ 1 game) / a preseason value. */
  season: number
  preseason: number
  failures: string[]
}

export interface PlayerValuesReport {
  name: 'league-player-values'
  season: number
  plan: ProjectionWeekPlan
  leagueWeeks: LeagueWeekValues[]
  /** Leagues with no `league_weeks` row for a planned week — named, not valued. */
  notScheduled: Array<{ league_id: string; week: number }>
  counts: { leagues: number; leagueWeeks: number; written: number; removed: number; failedLeagueWeeks: number }
  warnings: string[]
  failures: string[]
  ok: boolean
  computed_at: string
}

interface LeagueRow {
  id: string
  season: number
  scoring_rules_snapshot: unknown
}

interface PlayerRow {
  id: string
  position: string
  projected_stats: unknown
  projections_season: number | null
  projected_pts_ppr: number | null
  projected_pts_standard: number | null
  projected_pts_half_ppr: number | null
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMED)
  const rest = ids.length - shown.length
  return `${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`
}

// ── Reads (each paged or chunk-bounded — the 1000-row cap) ─────────────────

async function readLeagues(db: Db, season: number, only?: readonly string[]): Promise<LeagueRow[]> {
  return pageAll<LeagueRow>((from, to) => {
    let q = db
      .from('leagues')
      .select('id, season, scoring_rules_snapshot', { count: 'exact' })
      .eq('season', season)
      .in('status', ['in_season', 'playoffs'])
      .is('deleted_at', null)
    if (only) q = q.in('id', [...only])
    return q.order('id').range(from, to) as unknown as PageResponse<LeagueRow>
  })
}

async function readLeagueWeeks(db: Db, season: number, weeks: readonly number[], leagueIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const ids of chunk(leagueIds, IN_CHUNK)) {
    const rows = await pageAll<{ league_id: string; week: number }>(
      (from, to) =>
        db
          .from('league_weeks')
          .select('league_id, week', { count: 'exact' })
          .eq('season', season)
          .in('week', [...weeks])
          .in('league_id', ids)
          .order('league_id')
          .order('week')
          .range(from, to) as unknown as PageResponse<{ league_id: string; week: number }>,
    )
    for (const r of rows) out.add(`${r.league_id}:${r.week}`)
  }
  return out
}

async function readRosters(db: Db, leagueIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const ids of chunk(leagueIds, IN_CHUNK)) {
    const rows = await pageAll<{ league_id: string; player_id: string }>(
      (from, to) =>
        db
          .from('league_rosters')
          .select('league_id, player_id', { count: 'exact' })
          .in('league_id', ids)
          .order('league_id')
          .order('player_id')
          .range(from, to) as unknown as PageResponse<{ league_id: string; player_id: string }>,
    )
    for (const r of rows) {
      const list = out.get(r.league_id) ?? []
      list.push(r.player_id)
      out.set(r.league_id, list)
    }
  }
  return out
}

async function readPlayers(db: Db, playerIds: readonly string[]): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = await pageAll<PlayerRow>(
      (from, to) =>
        db
          .from('players')
          .select('id, position, projected_stats, projections_season, projected_pts_ppr, projected_pts_standard, projected_pts_half_ppr', { count: 'exact' })
          .in('id', ids)
          .order('id')
          .range(from, to) as unknown as PageResponse<PlayerRow>,
    )
    for (const r of rows) out.set(r.id, r)
  }
  return out
}

async function readWeeklyLines(
  db: Db,
  season: number,
  weeks: readonly number[],
  playerIds: readonly string[],
): Promise<Map<string, { stats: Record<string, unknown>; fetched_at: string }>> {
  const out = new Map<string, { stats: Record<string, unknown>; fetched_at: string }>()
  type LineRow = { week: number; player_id: string; stats: Record<string, unknown>; fetched_at: string }
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = await pageAll<LineRow>(
      (from, to) =>
        db
          .from('player_weekly_projections')
          .select('week, player_id, stats, fetched_at', { count: 'exact' })
          .eq('season', season)
          .in('week', [...weeks])
          .in('player_id', ids)
          .order('week')
          .order('player_id')
          .range(from, to) as unknown as PageResponse<LineRow>,
    )
    for (const r of rows) out.set(`${r.week}:${r.player_id}`, { stats: r.stats, fetched_at: r.fetched_at })
  }
  return out
}

/** Every `player_stats` line of the season in weeks [1, maxWeekExclusive),
 *  grouped by player — the worker's own column surface (STAT_LINE_COLUMNS). */
async function readSeasonLines(
  db: Db,
  season: number,
  maxWeekExclusive: number,
  playerIds: readonly string[],
): Promise<Map<string, Array<StatLineRow & { week: number }>>> {
  const out = new Map<string, Array<StatLineRow & { week: number }>>()
  if (maxWeekExclusive <= 1) return out
  const select = ['player_id', 'week', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', ')
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = await pageAll<StatLineRow & { week: number }>(
      (from, to) =>
        db
          .from('player_stats')
          .select(select, { count: 'exact' })
          .eq('season', season)
          .gte('week', 1)
          .lt('week', maxWeekExclusive)
          .in('player_id', ids)
          .order('player_id')
          .order('week')
          .range(from, to) as unknown as PageResponse<StatLineRow & { week: number }>,
    )
    for (const r of rows) {
      const list = out.get(r.player_id) ?? []
      list.push(r)
      out.set(r.player_id, list)
    }
  }
  return out
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** A value must already be at §7.3.3's stored precision — refuse a third
 *  decimal rather than let NUMERIC(8,2) round a divergent value (F22's rule). */
function assertTwoDecimals(rows: readonly PlayerValueRow[]): void {
  for (const r of rows) {
    for (const v of [r.projected_points, r.season_points, r.preseason_points]) {
      if (v !== null && Math.round(v * 100) / 100 !== v) {
        throw new Error(`value ${v} for ${r.player_id} (league ${r.league_id}, week ${r.week}) is not at 2dp — refusing to let the column round it`)
      }
    }
  }
}

async function writeLeagueWeek(
  db: Db,
  leagueId: string,
  season: number,
  week: number,
  rows: PlayerValueRow[],
): Promise<{ written: number; removed: number }> {
  assertTwoDecimals(rows)
  let written = 0
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error, count } = await db
      .from(PLAYER_VALUES_TABLE)
      .upsert(part, { onConflict: 'league_id,season,week,player_id', count: 'exact' })
    if (error) throw new Error(`upsert failed: ${error.message}`)
    if (count !== part.length) {
      throw new Error(`upsert wrote ${String(count)} row(s) for ${part.length} sent — refusing to call that done`)
    }
    written += count
  }
  // Rows for players no longer on the roster (every current player was just
  // upserted, so anything else is stale).
  const keep = rows.map((r) => `"${r.player_id.replace(/"/g, '\\"')}"`).join(',')
  const { error, count } = await db
    .from(PLAYER_VALUES_TABLE)
    .delete({ count: 'exact' })
    .eq('league_id', leagueId)
    .eq('season', season)
    .eq('week', week)
    .not('player_id', 'in', `(${keep})`)
  if (error) throw new Error(`stale-row delete failed: ${error.message}`)
  if (count === null || count === undefined) throw new Error('stale-row delete returned no count — refusing to guess what it removed')
  return { written, removed: count }
}

// ── One run ────────────────────────────────────────────────────────────────

export async function runLeaguePlayerValues(
  deps: PlayerValuesDeps,
  /** `weeks` overrides the plan (an explicit re-value); `leagueIds` scopes
   *  the run to those leagues (an operator's one-league re-value, and the
   *  stack suite's isolation from other suites on the synthetic season). */
  opts: { season: number; weeks?: number[]; leagueIds?: string[] },
): Promise<PlayerValuesReport> {
  const { db, time } = deps
  const now = time.now()
  const calendar = await readProjectionCalendar(db, opts.season)
  const inCalendar = new Set(calendar.map((w) => w.week))

  let plan: ProjectionWeekPlan
  const missing = (opts.weeks ?? []).filter((w) => !inCalendar.has(w))
  if (opts.weeks && opts.weeks.length > 0) {
    plan = {
      weeks: opts.weeks.filter((w) => inCalendar.has(w)),
      currentWeek: null,
      reason: `explicit week(s) ${opts.weeks.join(', ')}${missing.length ? ` — NOT in nfl_weeks for ${opts.season}: ${missing.join(', ')}` : ''}`,
      seasonComplete: false,
    }
  } else {
    plan = planProjectionWeeks(calendar, now)
  }

  const report: PlayerValuesReport = {
    name: 'league-player-values',
    season: opts.season,
    plan,
    leagueWeeks: [],
    notScheduled: [],
    counts: { leagues: 0, leagueWeeks: 0, written: 0, removed: 0, failedLeagueWeeks: 0 },
    warnings: [],
    failures: [],
    ok: true,
    computed_at: now.toISOString(),
  }
  for (const w of missing) {
    report.failures.push(`week ${w}: not in nfl_weeks for season ${opts.season} — the calendar decides which weeks exist (§23.3); nothing valued`)
  }
  if (plan.weeks.length === 0) {
    if (!plan.seasonComplete && report.failures.length === 0) report.failures.push(`nothing planned: ${plan.reason}`)
    return finish(report)
  }

  const leagues = await readLeagues(db, opts.season, opts.leagueIds)
  report.counts.leagues = leagues.length
  if (leagues.length === 0) {
    // A named idle (before any league's draft completes), not a failure:
    // there is no league-week to value.
    report.warnings.push(`no in_season / playoffs league for season ${opts.season} — nothing to value`)
    return finish(report)
  }

  const scheduled = await readLeagueWeeks(db, opts.season, plan.weeks, leagues.map((l) => l.id))
  const rosters = await readRosters(db, leagues.map((l) => l.id))
  const allPlayers = [...new Set([...rosters.values()].flat())].sort()
  const players = await readPlayers(db, allPlayers)
  const lines = await readWeeklyLines(db, opts.season, plan.weeks, allPlayers)
  const seasonLines = await readSeasonLines(db, opts.season, Math.max(...plan.weeks), allPlayers)

  for (const league of leagues) {
    const weeks = plan.weeks.filter((w) => scheduled.has(`${league.id}:${w}`))
    for (const w of plan.weeks) if (!weeks.includes(w)) report.notScheduled.push({ league_id: league.id, week: w })
    if (weeks.length === 0) continue

    // (3) The snapshot gate — the worker's own (D292's quarantine posture).
    let snapshot: ScoringRulesDoc
    try {
      assertSnapshotScorable(league.scoring_rules_snapshot)
      snapshot = league.scoring_rules_snapshot
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const cause = message.startsWith('snapshot_missing') ? message : `snapshot_corrupt: ${message}`
      for (const week of weeks) report.leagueWeeks.push(emptyLeagueWeek(league.id, week, [`league ${league.id} week ${week}: ${cause} — nothing valued for this league`]))
      continue
    }

    const roster = rosters.get(league.id) ?? []
    for (const week of weeks) {
      const lw = emptyLeagueWeek(league.id, week, [])
      lw.rostered = roster.length
      if (roster.length === 0) {
        lw.ok = false
        lw.failures.push(`league ${league.id} week ${week}: no rostered player — no values (an in-season league with an empty roster is not a quiet success)`)
        report.leagueWeeks.push(lw)
        continue
      }
      const rows: PlayerValueRow[] = []
      const noPlayer: string[] = []
      const stale: string[] = []
      for (const playerId of roster) {
        const p = players.get(playerId)
        if (!p) {
          noPlayer.push(playerId)
          continue
        }
        const line = lines.get(`${week}:${playerId}`) ?? null
        const row = computePlayerValue(
          snapshot,
          { league_id: league.id, season: opts.season, week, now },
          {
            player_id: playerId,
            position: normalizePosition(p.position),
            weekly: line,
            seasonRows: (seasonLines.get(playerId) ?? []).filter((r) => r.week < week),
            preseason: {
              projected_stats: p.projected_stats,
              projections_season: p.projections_season,
              projected: p.projected_pts_ppr !== null || p.projected_pts_standard !== null || p.projected_pts_half_ppr !== null,
            },
          },
        )
        if (row.projected_missing === 'stale_line') stale.push(playerId)
        rows.push(row)
      }
      if (noPlayer.length > 0) {
        // A roster row's player is FK-bound to `players`; reaching here means a
        // read went wrong — never value around it silently.
        lw.failures.push(`league ${league.id} week ${week}: ${noPlayer.length} rostered player(s) not returned by the players read: ${named(noPlayer)}`)
      }
      lw.projected = rows.filter((r) => r.projected_points !== null).length
      lw.stale = stale.length
      lw.noLine = rows.filter((r) => r.projected_missing === 'no_line').length
      lw.season = rows.filter((r) => r.season_points !== null).length
      lw.preseason = rows.filter((r) => r.preseason_points !== null).length
      if (stale.length > 0) {
        report.warnings.push(`league ${league.id} week ${week}: ${stale.length} projection line(s) older than the freshness bound — treated as absent: ${named(stale)}`)
      }
      if (rows.length > 0 && lw.projected === 0) {
        lw.failures.push(
          `league ${league.id} week ${week}: NO usable weekly projection for any of ${rows.length} rostered player(s) (${lw.stale} stale, ${lw.noLine} no line) — the projections sync is not landing; values written with their fallback keys only`,
        )
      }
      if (rows.length > 0) {
        try {
          const written = await writeLeagueWeek(db, league.id, opts.season, week, rows)
          lw.written = written.written
          lw.removed = written.removed
        } catch (err) {
          lw.failures.push(`league ${league.id} week ${week}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      lw.ok = lw.failures.length === 0
      report.leagueWeeks.push(lw)
    }
  }
  return finish(report)
}

function emptyLeagueWeek(leagueId: string, week: number, failures: string[]): LeagueWeekValues {
  return {
    league_id: leagueId,
    week,
    ok: failures.length === 0,
    rostered: 0,
    written: 0,
    removed: 0,
    projected: 0,
    stale: 0,
    noLine: 0,
    season: 0,
    preseason: 0,
    failures,
  }
}

function finish(report: PlayerValuesReport): PlayerValuesReport {
  for (const lw of report.leagueWeeks) {
    report.counts.leagueWeeks++
    report.counts.written += lw.written
    report.counts.removed += lw.removed
    if (!lw.ok) {
      report.counts.failedLeagueWeeks++
      report.failures.push(...lw.failures)
    }
  }
  report.ok = report.failures.length === 0
  return report
}
