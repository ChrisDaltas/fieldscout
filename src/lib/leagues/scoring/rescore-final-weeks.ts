/**
 * rescore-final-weeks — the ONE-TIME, RULED, AUDITED re-score of FINAL
 * league-weeks (M5 task L.D3.13, migration 161; PROGRESS D425; spec §11.4 /
 * §23.4 v2.16.70).
 *
 * THE RULING (Chris, 2026-09-29, verbatim): "re-score weeks 1 and 2 with the
 * actual yards". D/ST `def_yards_allowed` was NULL when 2026 weeks 1–2 were
 * scored and the pre-143 scoring read it as 0 yards (the top yards-allowed
 * tier — D380 / F390); `sync:reingest` has since filled it. F405's lock (158)
 * is about the provider's late corrections; this is our own ingestion defect,
 * and the ruling supersedes Q69 for those two weeks.
 *
 *   npm run rescore:final-weeks -- --season 2026 --weeks 1-2 --ruled-by <username> \
 *     --reason "<the ruling, quoted>" --why "<plain words for the league>"            (dry run)
 *   …the same… --apply --confirm-target <host>
 *
 * For every league of the season and every requested week that is FINAL,
 * every team on the week is recomputed from CURRENT `player_stats` under the
 * WEEK's rules (`weekScoringRules`, 144 — never the league's current rules)
 * through the worker's own pipeline (`computeTeamWeek` → `playerPointsRows`,
 * one implementation — §7.3.3), from its STORED lineup (`starterSlotsOf`), and
 * sent WHOLE to 161's `admin_rescore_final_week`, which is the authority:
 *   - a league-week whose every stored score already equals its recompute is
 *     NOT sent (`scores_already_correct` — nothing to re-score; the ordinary
 *     `backfill:player-points` stores its lines as recoverable). A second run
 *     after an apply lands here, and says so with the audit row it finds;
 *   - otherwise the door re-writes the non-overridden scores with the result
 *     that goes with them, stores the per-player rows (`rescore`), rebuilds
 *     the week's results through the SAME math finalization uses, writes ONE
 *     audit row, ONE league post and a notification per manager whose result
 *     changed; an overridden cell is the commissioner's number and is kept,
 *     named. A DRY RUN (the default) runs the door's apply and rolls it back,
 *     so the preview IS what an apply does.
 *
 * Falsifiability built in: this module PREDICTS every team's new score and
 * every matchup result that flips from its own recompute, and a door document
 * that disagrees is a problem (exit 1). On --apply every stored score /
 * result cell of the league-season is read before and after (the golden):
 * a cell that moved in a week this run did not re-score is a problem.
 *
 * Pre-161: the door is missing ⇒ refused BY NAME. Time only via `time`;
 * no provider call — the stats are `player_stats`, the StatsProvider's store.
 *
 * RETIRED (migration 164, M5 L.D3.14; PROGRESS F489, D428; spec §11.4
 * v2.16.73): the door was used once, 2026-09-29 (F488 — production weeks
 * 1–2), then retired — 164 REVOKEs EXECUTE from the service role; the
 * function, its ledger and its audit history stay. Every run asks the door
 * first (`probeRescoreDoor` — an all-NULL call the database answers without
 * running a line of it, so nothing can be written) and a retired door is
 * refused BY NAME, pointing at the one migration that would re-grant it.
 */
import { randomUUID } from 'node:crypto'

import type { Json } from '@/types/database'

import { pageAll } from '@/lib/supabase/page-all'

import type { TimeProvider } from '../time/time-provider'
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

export type RescoreVerdict =
  | 'rescored' // applied: the door wrote it
  | 'would_rescore' // dry run: the door's apply, rolled back
  | 'no_changes' // the door found nothing to change (every dimension equal)
  | 'scores_already_correct' // every stored score equals its recompute — not sent
  | 'week_not_final' // an open week is the worker's — not this tool's
  | 'not_scheduled' // the league has no such week
  | 'refused' // a problem stopped this league-week (named in problems)

export interface TeamLine {
  team_id: string
  team_name: string
  /** The team's stored score on each NON-overridden cell it sits in. */
  stored: Array<number | null>
  recomputed: number
  /** recomputed − the first stored cell (null when it has none). */
  delta: number | null
  overridden_cells: number
}

export interface MatchupSide {
  home: string
  away: string | null
  home_score: number | null
  away_score: number | null
  result: string | null
}

export interface FlipLine {
  matchup_id: string
  before: MatchupSide
  after: MatchupSide
}

export interface LeagueWeekRescore {
  league_id: string
  league_name: string
  week: number
  status: string | null
  verdict: RescoreVerdict
  teams: TeamLine[]
  scores_changed: number
  flips: FlipLine[]
  overridden: string[]
  results_changed: string[]
  system_post: string | null
  notified: number
  commissioner_action_id: string | null
  prior_rescores: string[]
}

export interface RescoreReport {
  ran_at: string
  season: number
  weeks: number[]
  mode: 'dry_run' | 'apply'
  leagues: number
  league_weeks: LeagueWeekRescore[]
  counts: Partial<Record<RescoreVerdict, number>>
  scores_changed: number
  results_flipped: number
  /** The golden (apply only). */
  score_cells: number
  cells_moved: number
  problems: string[]
  ok: boolean
}

export interface RescoreDeps {
  db: ScoreWorkerClient
  time: TimeProvider
  /** The per-league-week idempotency key (a seam for the tests). */
  newActionId?: () => string
}

export interface RescoreOptions {
  season: number
  weeks: readonly number[]
  apply: boolean
  /** The ruling, quoted — the audit row's reason. */
  reason: string
  /** Plain words for the league: why the week was re-scored. */
  memberNote: string
  /** The profile whose ruling this is. */
  actorId: string
  /** The stack lane's scope seam (D313(2)'s shape). */
  leagueIds?: readonly string[]
}

interface MatchupRow {
  id: string
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
  home_score: number | string | null
  away_score: number | string | null
  result: string | null
  status: string
  is_overridden: boolean
}

interface ResultRow {
  id: string
  team_id: string
  week: number
  points: number | string
  h2h_result: string | null
  median_result: string | null
  second_result: string | null
  is_final: boolean | null
}

/** What the door returns (161) — the parts this module reads. */
export interface RescoreDoorDoc {
  league_id: string
  season: number
  week: number
  dry_run: boolean
  action_id: string | null
  commissioner_action_id: string | null
  no_changes: boolean
  team_scores: Array<{ team_id: string; team_name: string; stored: Array<number | null>; recomputed: number; score_changed: boolean }>
  scores_changed: number
  matchups: Array<{
    matchup_id?: string
    home_team_id?: string
    away_team_id?: string | null
    home_team_name?: string
    away_team_name?: string | null
    before: unknown
    after: unknown
    changed: boolean
    result_changed?: boolean
  }>
  overridden: Array<{ matchup_id: string; home_team_name: string; away_team_name: string | null; home_score: number | null; away_score: number | null }>
  results_changed: Array<{ team_id: string; team_name: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>
  flips: RescoreDoorDoc['matchups']
  system_post: string | null
  notified: unknown[]
  prior_rescores: Array<{ id: string; created_at: string }>
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

export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Two-decimal equality (numeric equality is scale-blind in SQL; this is its TS twin). */
export function same(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.round(a * 100) === Math.round(b * 100)
}

/** E38 — 117's `matchup_result_internal`, in TS: two decimals, a tie is a tie, a bye has none. */
export function matchupResultOf(home: number | null, away: number | null, awayTeamId: string | null): 'home' | 'away' | 'tie' | null {
  if (awayTeamId === null) return null
  const h = Math.round((home ?? 0) * 100)
  const a = Math.round((away ?? 0) * 100)
  return h > a ? 'home' : h < a ? 'away' : 'tie'
}

const two = (n: number | null): string => (n === null ? '—' : n.toFixed(2))

/** "Team 8 95.90–95.75 over chris's Team" — or "A 95.75–95.75 tie with B". */
export function sideSentence(s: MatchupSide): string {
  if (s.away === null) return `${s.home} ${two(s.home_score)} (bye)`
  if (s.result === 'tie') return `${s.home} ${two(s.home_score)}–${two(s.away_score)} tie with ${s.away}`
  if (s.result === 'away') return `${s.away} ${two(s.away_score)}–${two(s.home_score)} over ${s.home}`
  if (s.result === 'home') return `${s.home} ${two(s.home_score)}–${two(s.away_score)} over ${s.away}`
  return `${s.home} ${two(s.home_score)}–${two(s.away_score)} ${s.away} (no result)`
}

export function flipSentence(f: FlipLine): string {
  return `${sideSentence(f.before)} → ${sideSentence(f.after)}`
}

/** The predicted flips of an h2h week: every NON-overridden row whose E38 result moves under the recompute. */
export function predictFlips(
  rows: readonly MatchupRow[],
  recomputed: ReadonlyMap<string, number>,
  names: ReadonlyMap<string, string>,
): FlipLine[] {
  const out: FlipLine[] = []
  for (const m of [...rows].sort((a, b) => (a.round_type + a.id < b.round_type + b.id ? -1 : 1))) {
    if (m.is_overridden) continue
    const home = recomputed.get(m.home_team_id) ?? null
    const away = m.away_team_id === null ? num(m.away_score) : (recomputed.get(m.away_team_id) ?? null)
    const result = matchupResultOf(home, away, m.away_team_id)
    if (result === m.result) continue
    const homeName = names.get(m.home_team_id) ?? m.home_team_id
    const awayName = m.away_team_id === null ? null : (names.get(m.away_team_id) ?? m.away_team_id)
    out.push({
      matchup_id: m.id,
      before: { home: homeName, away: awayName, home_score: num(m.home_score), away_score: num(m.away_score), result: m.result },
      after: { home: homeName, away: awayName, home_score: home, away_score: away, result },
    })
  }
  return out
}

/** The league-season's stored scores and results — the golden's two reads (keys carry the week). */
async function readCells(db: ScoreWorkerClient, leagueId: string, season: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const matchups = await pageAll<MatchupRow>((from, to) =>
    db
      .from('matchups')
      .select('id, week, round_type, home_team_id, away_team_id, home_score, away_score, result, status, is_overridden', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', season)
      .order('id')
      .range(from, to),
  )
  for (const m of matchups) out.set(`${m.week}|m:${m.id}`, JSON.stringify([num(m.home_score), num(m.away_score), m.result, m.status, m.is_overridden]))
  const results = await pageAll<ResultRow>((from, to) =>
    db
      .from('team_week_results')
      .select('id, team_id, week, points, h2h_result, median_result, second_result, is_final', { count: 'exact' })
      .eq('league_id', leagueId)
      .eq('season', season)
      .order('id')
      .range(from, to),
  )
  for (const r of results) out.set(`${r.week}|r:${r.team_id}`, JSON.stringify([num(r.points), r.h2h_result, r.median_result, r.second_result, r.is_final]))
  const weeks = must(await db.from('league_weeks').select('week, status, median_score').eq('league_id', leagueId).eq('season', season), 'league_weeks read (golden)')
  for (const w of weeks) out.set(`${w.week}|w`, JSON.stringify([w.status, num(w.median_score)]))
  return out
}

function isMissingDoor(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === 'PGRST202' && /admin_rescore_final_week/.test(error.message ?? '')
}

export const PRE_161_SENTENCE = 'the database predates migration 161 (no admin_rescore_final_week) — push 161 first; nothing was re-scored'

/** 164 (F489): the database's own refusal of a caller that holds no EXECUTE — the retired door. */
function isRetiredDoor(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === '42501' && /permission denied for function admin_rescore_final_week/.test(error.message ?? '')
}

export const RETIRED_SENTENCE =
  'the re-score door admin_rescore_final_week is RETIRED — migration 164 (supabase/migrations/164_m5_cleanup.sql §4, PROGRESS F489) revoked it after its one use on 2026-09-29 (F488); nothing was re-scored. To re-score a final week again, on a NEW recorded ruling, first add a migration that grants it back: GRANT EXECUTE ON FUNCTION public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean) TO service_role'

/**
 * Asks the door whether this run may use it, writing nothing: an all-NULL
 * call. An open door answers with its own shape refusal (22023, "… are
 * required") before it reads or locks anything; a retired one is refused by
 * the database (42501) before a line of it runs; a missing one is PGRST202.
 * Anything else is refused too — never read as "open".
 */
export async function probeRescoreDoor(db: ScoreWorkerClient): Promise<void> {
  const { error } = await db.rpc('admin_rescore_final_week', {
    p_league_id: null,
    p_week: null,
    p_teams: null,
    p_reason: null,
    p_member_note: null,
    p_actor_id: null,
    p_action_id: null,
    p_dry_run: true,
  } as never)
  if (!error) throw new Error('rescore refused: the door answered an all-NULL probe with a document — refusing to trust it; nothing was re-scored')
  if (isMissingDoor(error)) throw new Error(`rescore refused: ${PRE_161_SENTENCE}`)
  if (isRetiredDoor(error)) throw new Error(`rescore refused: ${RETIRED_SENTENCE}`)
  if (error.code === '22023' && /are required/.test(error.message ?? '')) return
  throw new Error(`rescore refused: the door probe got an unexpected answer (${error.code ?? 'no code'}: ${error.message ?? ''}) — nothing was re-scored`)
}

export async function rescoreFinalWeeks(deps: RescoreDeps, opts: RescoreOptions): Promise<RescoreReport> {
  const { db } = deps
  const newActionId = deps.newActionId ?? randomUUID
  const report: RescoreReport = {
    ran_at: deps.time.now().toISOString(),
    season: opts.season,
    weeks: [...opts.weeks],
    mode: opts.apply ? 'apply' : 'dry_run',
    leagues: 0,
    league_weeks: [],
    counts: {},
    scores_changed: 0,
    results_flipped: 0,
    score_cells: 0,
    cells_moved: 0,
    problems: [],
    ok: true,
  }
  const problem = (line: string) => {
    report.problems.push(line)
    report.ok = false
  }
  const record = (lw: LeagueWeekRescore) => {
    report.league_weeks.push(lw)
    report.counts[lw.verdict] = (report.counts[lw.verdict] ?? 0) + 1
  }
  if (opts.weeks.length === 0) throw new Error('rescore: no weeks requested')
  if (opts.reason.trim() === '' || opts.memberNote.trim() === '') throw new Error('rescore: --reason (the ruling) and --why (plain words for the league) are both required')
  await probeRescoreDoor(db) // 164 (F489): a retired or missing door is refused BY NAME before anything is read

  let leagueQuery = db
    .from('leagues')
    .select('id, name, season, status, settings, roster_settings, scoring_rules_snapshot')
    .eq('season', opts.season)
    .in('status', ['in_season', 'playoffs', 'complete'])
    .is('deleted_at', null)
  if (opts.leagueIds) leagueQuery = leagueQuery.in('id', [...opts.leagueIds])
  const leagues = must(await leagueQuery.order('id'), 'leagues read')
  if (leagues.length >= 1000) throw new Error('leagues read returned 1000 rows — at the PostgREST cap, refusing to trust it')
  report.leagues = leagues.length

  for (const league of leagues) {
    const mode = (league.settings as { schedule_mode?: unknown } | null)?.schedule_mode === 'total_points' ? 'total_points' : 'h2h'
    const weeks = must(
      await db.from('league_weeks').select('week, status, scoring_rules_snapshot').eq('league_id', league.id).eq('season', opts.season).in('week', [...opts.weeks]).order('week'),
      'league_weeks read',
    )
    const teams = must(await db.from('teams').select('id, name').eq('league_id', league.id), 'teams read')
    const names = new Map(teams.map((t) => [t.id, t.name]))
    const lineups: Array<{ team_id: string; week: number; slot_map: Json | null }> = []
    for (const part of chunk(teams.map((t) => t.id), IN_CHUNK)) {
      lineups.push(...must(await db.from('team_lineups').select('team_id, week, slot_map').eq('season', opts.season).in('week', [...opts.weeks]).in('team_id', part), 'team_lineups read'))
    }
    const lineupBy = new Map(lineups.map((l) => [`${l.team_id}:${l.week}`, l]))
    const matchups = await pageAll<MatchupRow>((from, to) =>
      db
        .from('matchups')
        .select('id, week, round_type, home_team_id, away_team_id, home_score, away_score, result, status, is_overridden', { count: 'exact' })
        .eq('league_id', league.id)
        .eq('season', opts.season)
        .in('week', [...opts.weeks])
        .order('id')
        .range(from, to),
    )
    const results = must(
      await db.from('team_week_results').select('id, team_id, week, points, h2h_result, median_result, second_result, is_final').eq('league_id', league.id).eq('season', opts.season).in('week', [...opts.weeks]),
      'team_week_results read',
    ) as ResultRow[]
    const irKeys = irKeysOf(league.roster_settings)
    const before = opts.apply ? await readCells(db, league.id, opts.season) : null
    const rescoredWeeks = new Set<number>()

    for (const week of opts.weeks) {
      const base: LeagueWeekRescore = {
        league_id: league.id,
        league_name: league.name,
        week,
        status: null,
        verdict: 'refused',
        teams: [],
        scores_changed: 0,
        flips: [],
        overridden: [],
        results_changed: [],
        system_post: null,
        notified: 0,
        commissioner_action_id: null,
        prior_rescores: [],
      }
      const lw = weeks.find((w) => w.week === week)
      if (!lw) {
        record({ ...base, verdict: 'not_scheduled' })
        continue
      }
      base.status = lw.status
      if (lw.status !== 'final') {
        record({ ...base, verdict: 'week_not_final' })
        continue
      }
      const where = `league ${league.name} (${league.id}) week ${week}`
      let rules: ScoringRulesDoc
      try {
        rules = weekScoringRules(lw, league.scoring_rules_snapshot)
      } catch (err) {
        problem(`${where}: its stored rules do not score — ${err instanceof Error ? err.message : String(err)}; not re-scored`)
        record(base)
        continue
      }

      // The week's teams and their stored cells (overridden cells are the commissioner's — counted, never compared).
      const weekMatchups = matchups.filter((m) => m.week === week)
      const cells = new Map<string, { stored: Array<number | null>; overridden: number }>()
      const touch = (teamId: string) => {
        let c = cells.get(teamId)
        if (!c) cells.set(teamId, (c = { stored: [], overridden: 0 }))
        return c
      }
      if (mode === 'h2h') {
        for (const m of weekMatchups) {
          for (const [teamId, score] of [[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]] as const) {
            if (teamId === null) continue
            const c = touch(teamId)
            if (m.is_overridden) c.overridden += 1
            else c.stored.push(num(score))
          }
          if (m.is_overridden) base.overridden.push(`${names.get(m.home_team_id) ?? m.home_team_id} vs ${m.away_team_id ? (names.get(m.away_team_id) ?? m.away_team_id) : 'BYE'} (kept at ${two(num(m.home_score))}–${two(num(m.away_score))})`)
        }
      } else {
        for (const r of results.filter((x) => x.week === week)) touch(r.team_id).stored.push(num(r.points))
      }
      if (cells.size === 0) {
        problem(`${where}: final, but no stored score for any team — nothing to re-score from`)
        record(base)
        continue
      }

      // Recompute every team, slot by slot, from its stored lineup.
      const plan: Array<{ teamId: string; slots: Array<{ slot: string; player_id: string }> }> = []
      let broken = false
      for (const teamId of [...cells.keys()].sort()) {
        const row = lineupBy.get(`${teamId}:${week}`)
        const slots = row ? starterSlotsOf(row.slot_map, irKeys) : null
        if (slots === null) {
          problem(`${where}: team ${names.get(teamId) ?? teamId} has no stored lineup — the week cannot be re-scored whole`)
          broken = true
          continue
        }
        plan.push({ teamId, slots })
      }
      if (broken) {
        record(base)
        continue
      }
      const ids = [...new Set(plan.flatMap((p) => p.slots.map((s) => s.player_id)))]
      const positions = new Map<string, string>()
      const stats = new Map<string, StatLineRow>()
      for (const part of chunk(ids, IN_CHUNK)) {
        for (const p of must(await db.from('players').select('id, position').in('id', part), 'players read')) positions.set(p.id, normalizePosition(p.position))
        const lines = must(
          (await db
            .from('player_stats')
            .select(['player_id', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', '))
            .eq('season', opts.season)
            .eq('week', week)
            .in('player_id', part)) as unknown as { data: StatLineRow[] | null; error: { message: string } | null },
          'player_stats read',
        )
        for (const l of lines) stats.set(l.player_id, l)
      }

      const payload: Array<{ team_id: string; points: number; players: PlayerPointsRow[] }> = []
      const recomputed = new Map<string, number>()
      for (const p of plan) {
        const unknown = p.slots.find((s) => !positions.has(s.player_id))
        if (unknown) {
          problem(`${where}: team ${names.get(p.teamId) ?? p.teamId} starts ${unknown.player_id}, a player the players table does not know`)
          broken = true
          continue
        }
        const team = computeTeamWeek(rules, p.teamId, p.slots.map((s) => ({ player_id: s.player_id, position: positions.get(s.player_id)! })), stats)
        if (team.points === null) {
          problem(`${where}: team ${names.get(p.teamId) ?? p.teamId} recomputes PENDING (${team.pending.map((x) => `${x.player_id}: ${x.keys.join('/')}`).join('; ')}) — a final week is never re-scored to pending`)
          broken = true
          continue
        }
        recomputed.set(p.teamId, team.points)
        payload.push({ team_id: p.teamId, points: team.points, players: playerPointsRows(p.slots, team) })
        const c = cells.get(p.teamId)!
        const first = c.stored[0] ?? null
        base.teams.push({
          team_id: p.teamId,
          team_name: names.get(p.teamId) ?? p.teamId,
          stored: c.stored,
          recomputed: team.points,
          delta: first === null ? null : Math.round((team.points - first) * 100) / 100,
          overridden_cells: c.overridden,
        })
      }
      if (broken) {
        record(base)
        continue
      }
      base.teams.sort((a, b) => a.team_name.localeCompare(b.team_name) || a.team_id.localeCompare(b.team_id))
      base.scores_changed = base.teams.filter((t) => t.stored.some((s) => !same(s, t.recomputed))).length
      const predicted = mode === 'h2h' ? predictFlips(weekMatchups, recomputed, names) : []

      const prior = must(
        await db
          .from('commissioner_actions')
          .select('id, created_at')
          .eq('league_id', league.id)
          .eq('action_type', 'rescore_final_week')
          .eq('metadata->>season', String(opts.season))
          .eq('metadata->>week', String(week))
          .order('created_at'),
        'commissioner_actions read',
      )
      base.prior_rescores = prior.map((a) => `${a.id} (${a.created_at})`)

      if (base.scores_changed === 0) {
        // Detected BY VALUE: every stored score is its recompute. Nothing is sent.
        record({ ...base, verdict: 'scores_already_correct' })
        continue
      }

      const actionId = opts.apply ? newActionId() : null
      const { data, error } = await db.rpc('admin_rescore_final_week', {
        p_league_id: league.id,
        p_week: week,
        p_teams: payload as unknown as Json,
        p_reason: opts.reason,
        p_member_note: opts.memberNote,
        p_actor_id: opts.actorId,
        p_action_id: actionId as string,
        p_dry_run: !opts.apply,
      })
      if (error) {
        if (isMissingDoor(error)) throw new Error(`rescore refused: ${PRE_161_SENTENCE}`)
        if (isRetiredDoor(error)) throw new Error(`rescore refused: ${RETIRED_SENTENCE}`)
        problem(`${where}: admin_rescore_final_week refused — ${error.message}`)
        record(base)
        continue
      }
      const doc = data as unknown as RescoreDoorDoc
      // F65(b): the document must answer THIS request.
      if (doc.league_id !== league.id || doc.week !== week || doc.dry_run !== !opts.apply || (opts.apply && doc.action_id !== actionId)) {
        problem(`${where}: the door answered for league ${doc.league_id} week ${doc.week} (dry_run ${doc.dry_run}, action ${doc.action_id}) — not this request`)
        record(base)
        continue
      }
      // The door's numbers must be this module's prediction (one calculator, two readers).
      for (const t of doc.team_scores) {
        const mine = recomputed.get(t.team_id)
        if (mine === undefined || !same(mine, num(t.recomputed))) problem(`${where}: the door recorded ${t.team_name} at ${t.recomputed}, this run computed ${mine}`)
      }
      const doorFlips = (doc.flips ?? []).map((f) => f.matchup_id).sort()
      const myFlips = predicted.map((f) => f.matchup_id).sort()
      if (JSON.stringify(doorFlips) !== JSON.stringify(myFlips)) problem(`${where}: the door flipped [${doorFlips.join(', ')}] where this run predicted [${myFlips.join(', ')}]`)

      base.flips = predicted
      base.system_post = doc.system_post
      base.notified = Array.isArray(doc.notified) ? doc.notified.length : 0
      base.commissioner_action_id = doc.commissioner_action_id
      base.results_changed = (doc.results_changed ?? []).map((c) => {
        const b = c.before ?? {}
        const a = c.after ?? {}
        const parts: string[] = []
        for (const key of ['h2h_result', 'second_result', 'median_result'] as const) {
          if (b[key] !== a[key]) parts.push(`${key.replace('_result', '')} ${String(b[key] ?? '—')} → ${String(a[key] ?? '—')}`)
        }
        return `${c.team_name}: ${parts.join(', ')}`
      })
      const verdict: RescoreVerdict = doc.no_changes ? 'no_changes' : opts.apply ? 'rescored' : 'would_rescore'
      if (verdict === 'rescored') rescoredWeeks.add(week)
      report.scores_changed += doc.no_changes ? 0 : base.scores_changed
      report.results_flipped += doc.no_changes ? 0 : predicted.length
      record({ ...base, verdict })
    }

    if (before !== null) {
      const after = await readCells(db, league.id, opts.season)
      report.score_cells += before.size
      for (const k of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(k) === after.get(k)) continue
        report.cells_moved += 1
        const week = Number(k.split('|')[0])
        if (!rescoredWeeks.has(week)) {
          problem(`GOLDEN BROKEN — league ${league.id}: cell ${k} moved (${before.get(k)} → ${after.get(k)}) in a week this run did not re-score`)
        }
      }
    }
  }
  return report
}

/** One line per fact, for the CLI (the dry run's output is the review artefact). */
export function renderRescore(report: RescoreReport): string[] {
  const lines = [
    `season ${report.season} · ${report.mode} · weeks ${report.weeks.join(', ')} · leagues ${report.leagues} · team scores changing ${report.scores_changed} · results flipping ${report.results_flipped}`,
    `verdicts: ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`,
  ]
  if (report.mode === 'apply') lines.push(`golden: ${report.score_cells} stored score/result/week cells read before and after — ${report.cells_moved} moved, every one in a re-scored week unless a PROBLEM line says otherwise`)
  for (const lw of report.league_weeks) {
    lines.push(`league ${lw.league_name} (${lw.league_id}) week ${lw.week} (${lw.status ?? 'not scheduled'}): ${lw.verdict}${lw.commissioner_action_id ? ` — audit ${lw.commissioner_action_id}` : ''}${lw.prior_rescores.length > 0 ? ` — earlier re-score(s): ${lw.prior_rescores.join(', ')}` : ''}`)
    for (const t of lw.teams) {
      const stored = t.stored.map((s) => two(s)).join('/') || '(overridden only)'
      const delta = t.delta === null ? '' : ` (${t.delta > 0 ? '+' : t.delta < 0 ? '−' : '±'}${Math.abs(t.delta).toFixed(2)})`
      lines.push(`  ${t.team_name}: ${stored} → ${two(t.recomputed)}${delta}${t.overridden_cells > 0 ? ` · ${t.overridden_cells} overridden cell(s) kept` : ''}`)
    }
    for (const f of lw.flips) lines.push(`  RESULT FLIPS: ${flipSentence(f)}`)
    for (const r of lw.results_changed) lines.push(`  result changed — ${r}`)
    for (const o of lw.overridden) lines.push(`  overridden (kept): ${o}`)
    if (lw.system_post) lines.push(`  league post: ${lw.system_post}`)
    if (lw.verdict === 'rescored' || lw.verdict === 'would_rescore') lines.push(`  notifications: ${lw.notified}`)
  }
  for (const p of report.problems) lines.push(`PROBLEM: ${p}`)
  return lines
}
