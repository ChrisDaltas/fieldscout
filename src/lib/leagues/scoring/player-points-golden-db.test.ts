/**
 * player-points-golden-db.test.ts — THE GOLDEN BEFORE / AFTER for M5 task
 * L.D3.11 (migration 158; PROGRESS F405 / D422): no stored team score moves,
 * and the one-time backfill recovers exactly what the worker would have
 * stored. Over the REAL local stack, the REAL worker and the REAL backfill.
 *
 * THE CORPUS: every player line of the REAL recorded Sleeper 2025 week 2
 * (`fixtures/nfl/2025/wk02/sleeper.jsonl.gz`) through ingestion's own
 * `toStatRow`, positions from the local `players` pool (R1156: fewer than 300
 * scorable lines ⇒ the golden refuses to pass). A database WITHOUT the pool
 * (CI: `restore:dev` never runs there) gets the recording's players created
 * for the run from the committed `fixtures/nfl/2025/wk02/player-positions.json`
 * (id → position, 348 players) — only the ids the table lacks, marked by name,
 * and exactly those deleted afterwards; an existing row is never touched, so
 * a restored local pool behaves exactly as before. The guard then still
 * means "the corpus really is scorable". Eight leagues, one per template; in each, the
 * corpus dealt nine starters to a team (slot keys `flex:0..8`), teams paired
 * two by two; the same lines as week 1 and week 2 of a fixture season
 * (2092, its own calendar rows).
 *
 *   G1  THE WORKER: both weeks scored by the real drain; for EVERY team-week
 *       the stored rows add up to the stored score (pending ⇔ NULL).
 *   G2  LEGACY EMULATED: the rows deleted (as a pre-158 week has none); week 1
 *       walked to FINAL; ONE starter's week-1 line corrected after that
 *       (the post-window case — his team is unrecoverable in every league).
 *   G3  THE BACKFILL (dry run, then --apply): the dry run predicts every
 *       verdict the door then returns; `scores_moved = 0` over every stored
 *       score / result cell; every recoverable team-week's rows are
 *       IDENTICAL to what the worker stored in G1; exactly the corrected
 *       starter's teams are `backfill_unrecoverable`; the stored scores
 *       byte-identical before / after (an independent digest).
 *   G4  ONCE: a second run stores nothing.
 *
 * Requires the local stack — D59(5). Fixture hygiene (F199): leagues named
 * `vitest-ppg-*`, the 2092 season's calendar / stats / queue rows removed
 * first and after.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'
import { toStatRow } from '@/lib/sync/ingest-week'

import { parseFixture } from '../stats/fixtures/fixture-format'
import type { ProviderPlayerWeekStats } from '../stats/stats-provider'
import { VirtualClock } from '../time/virtual-clock'
import { backfillPlayerPoints, type BackfillReport } from './player-points-backfill'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-ppg'
const SEASON = 2092
/** Players this run CREATED (a pool-less database — CI); nothing else is ever deleted. */
const CREATED_NAME_PREFIX = 'PPG golden fixture'
const createdPlayerIds: string[] = []
const PER_TEAM = 9
const STAMP = '2092-09-14T20:00:00.000Z'
const LATE = '2092-09-30T12:00:00.000Z'

const db = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(new Date(STAMP))

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  await must(db.from('score_fanout').delete().eq('season', SEASON), 'cleanup queue')
  await must(db.from('player_stats').delete().eq('season', SEASON), 'cleanup stats')
  const { data: stale } = await db.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((r) => r.id)
  if (ids.length > 0) {
    const { data: teams } = await db.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    for (let i = 0; i < teamIds.length; i += 150) await must(db.from('team_lineups').delete().in('team_id', teamIds.slice(i, i + 150)), 'cleanup lineups')
    for (const table of ['team_week_results', 'matchups', 'league_weeks', 'league_rosters'] as const) {
      await must(db.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(db.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(db.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(db.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  // Only the rows this suite created (tracked this run, or marked by name by a run that died before its cleanup).
  for (let i = 0; i < createdPlayerIds.length; i += 150) await must(db.from('players').delete().in('id', createdPlayerIds.slice(i, i + 150)), 'cleanup created players')
  await must(db.from('players').delete().like('full_name', `${CREATED_NAME_PREFIX}%`), 'cleanup marked players')
}

interface CorpusLine {
  id: string
  columns: Record<string, number | null>
  advanced: Record<string, number>
}

const corpus: CorpusLine[] = []
const leagueIds: string[] = []
const teamsByLeague = new Map<string, string[]>()

async function digest(): Promise<string> {
  const m = await must(db.from('matchups').select('id, home_score, away_score, result, status, is_overridden').in('league_id', leagueIds).order('id'), 'digest matchups')
  const r = await must(db.from('team_week_results').select('team_id, week, points, h2h_result, is_final').in('league_id', leagueIds).order('team_id').order('week'), 'digest results')
  return JSON.stringify([m, r])
}

type Row = { league_id: string; week: number; team_id: string; slot: string; player_id: string; points: number; pending: string[]; reason: string; source: string }
async function allRows(): Promise<Row[]> {
  const out: Row[] = []
  for (const leagueId of leagueIds) {
    for (let from = 0; ; from += 1000) {
      const page = await must(
        db.from('league_week_player_points').select('league_id, week, team_id, slot, player_id, points, pending, reason, source').eq('league_id', leagueId).order('week').order('team_id').order('slot').range(from, from + 999),
        'rows',
      )
      out.push(...((page ?? []) as unknown as Row[]).map((r) => ({ ...r, points: Number(r.points) })))
      if ((page ?? []).length < 1000) break
    }
  }
  return out
}

const key = (r: Row) => `${r.league_id}:${r.week}:${r.team_id}:${r.slot}`
const cells = (r: Row) => JSON.stringify([r.player_id, r.points, r.pending, r.reason])

beforeAll(async () => {
  await cleanup()
  const recording = parseFixture(gunzipSync(readFileSync('fixtures/nfl/2025/wk02/sleeper.jsonl.gz')).toString('utf8'))
  const lines = recording.entries.find((e) => e.method === 'getWeekStats')!.body as ProviderPlayerWeekStats[]
  const known = new Set<string>()
  const ids = [...new Set(lines.map((l) => l.playerId))]
  for (let i = 0; i < ids.length; i += 150) {
    for (const p of (await must(db.from('players').select('id').in('id', ids.slice(i, i + 150)), 'players')) ?? []) known.add(p.id)
  }
  // A pool-less database (CI): create the recording's players it lacks, from the committed positions.
  const positions = (JSON.parse(readFileSync('fixtures/nfl/2025/wk02/player-positions.json', 'utf8')) as { positions: Record<string, string> }).positions
  const knownBefore = known.size
  const missing = ids.filter((id) => !known.has(id) && positions[id] !== undefined)
  for (let i = 0; i < missing.length; i += 150) {
    const rows = missing.slice(i, i + 150).map((id) => ({ id, full_name: `${CREATED_NAME_PREFIX} ${id}`, position: positions[id]!, status: 'Active' }))
    await must(db.from('players').insert(rows).select('id'), 'create fixture players')
    for (const r of rows) {
      known.add(r.id)
      createdPlayerIds.push(r.id)
    }
  }
  console.log(`golden pool: ${ids.length} recorded players — ${knownBefore} already in players (untouched), ${missing.length} created for this run, ${ids.length - knownBefore - missing.length} in neither (not scored)`)
  for (const l of [...lines].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
    if (!known.has(l.playerId)) continue
    const { row } = toStatRow(l, { gameStatus: new Map(), anyGameOpen: false, providerName: 'sleeper' })
    if (!row) continue
    corpus.push({ id: l.playerId, columns: row.columns, advanced: row.advanced })
  }
  if (corpus.length < 300) throw new Error(`golden: only ${corpus.length} scorable lines — run \`RESTORE_SCOPE=draft npm run restore:dev\` first (R1156)`)
  const teamCount = Math.floor(corpus.length / PER_TEAM / 2) * 2

  await must(
    db.from('nfl_weeks').insert([
      { season: SEASON, week: 1, starts_at: '2092-09-10T04:00:00.000Z', correction_window_ends_at: '2092-09-18T10:00:00.000Z' },
      { season: SEASON, week: 2, starts_at: '2092-09-17T04:00:00.000Z', correction_window_ends_at: '2092-09-25T10:00:00.000Z' },
    ]),
    'calendar',
  )
  for (const week of [1, 2]) {
    const rows = corpus.map((c) => ({ player_id: c.id, season: SEASON, week, stat_type: 'weekly', updated_at: STAMP, advanced: c.advanced, ...c.columns }))
    for (let i = 0; i < rows.length; i += 200) await must(db.from('player_stats').insert(rows.slice(i, i + 200) as never).select('player_id'), `stats wk ${week}`)
  }

  const owner = (await must(db.from('profiles').select('id').limit(1).single(), 'owner'))!.id
  const templates = (await must(db.from('scoring_systems').select('id, name, rules').eq('is_template', true).order('name'), 'templates'))!
  expect(templates.length).toBe(8)
  for (const t of templates) {
    const league = (await must(
      db
        .from('leagues')
        .insert({
          owner_id: owner,
          name: `${PREFIX}-${t.name}`,
          season: SEASON,
          status: 'in_season',
          playoff_teams: 0,
          scoring_system_id: t.id,
          scoring_rules_snapshot: t.rules as Json,
          settings: { schedule_mode: 'h2h' } as Json,
          roster_settings: { starting_slots: [{ key: 'flex', label: 'FLEX', eligible: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], count: PER_TEAM }], bench: 0, ir_slots: [], swap_spots: 0 } as Json,
        })
        .select('id')
        .single(),
      `league ${t.name}`,
    ))!.id
    leagueIds.push(league)
    const teams = (await must(db.from('teams').insert(Array.from({ length: teamCount }, (_, i) => ({ owner_id: owner, name: `PPG ${i + 1}`, league_id: league }))).select('id'), 'teams'))!.map((x) => x.id)
    teamsByLeague.set(league, teams)
    await must(db.from('league_weeks').insert([{ league_id: league, season: SEASON, week: 1, status: 'live' }, { league_id: league, season: SEASON, week: 2, status: 'live' }]), 'weeks')
    const pairs = []
    for (let i = 0; i < teams.length; i += 2) {
      for (const week of [1, 2]) pairs.push({ league_id: league, season: SEASON, week, round_type: 'regular', home_team_id: teams[i], away_team_id: teams[i + 1], status: 'live' })
    }
    await must(db.from('matchups').insert(pairs), 'matchups')
    const rosters = teams.flatMap((team, i) => corpus.slice(i * PER_TEAM, (i + 1) * PER_TEAM).map((c) => ({ league_id: league, team_id: team, player_id: c.id })))
    for (let i = 0; i < rosters.length; i += 500) await must(db.from('league_rosters').insert(rosters.slice(i, i + 500)), 'rosters')
    const lineups = teams.flatMap((team, i) => {
      const slot_map = Object.fromEntries(corpus.slice(i * PER_TEAM, (i + 1) * PER_TEAM).map((c, j) => [`flex:${j}`, c.id]))
      return [1, 2].map((week) => ({ team_id: team, season: SEASON, week, starters: [], bench: [], slot_map }))
    })
    for (let i = 0; i < lineups.length; i += 200) await must(db.from('team_lineups').insert(lineups.slice(i, i + 200)), 'lineups')
  }
  const queue = [1, 2].flatMap((week) => corpus.map((c) => ({ season: SEASON, week, player_id: c.id, enqueued_at: STAMP, deferred_until: null })))
  for (let i = 0; i < queue.length; i += 500) await must(db.from('score_fanout').upsert(queue.slice(i, i + 500), { onConflict: 'season,week,player_id' }).select('player_id'), 'queue')
}, 180_000)

afterAll(cleanup, 120_000)

describe('THE GOLDEN — stored per-player points: the worker, the backfill, no score moves', () => {
  let workerRows: Row[] = []
  let before = ''
  let corrected = ''

  it('G1 THE WORKER scores both weeks of all eight templates and, for EVERY team-week, the stored rows add up to the stored score (pending ⇔ NULL)', async () => {
    for (let guard = 0; guard < 10; guard++) {
      const batch = await runScoreWeekBatch({ time: clock, db }, { batchSize: 1000, leagueIds })
      expect(batch.failed).toBe(0)
      if (batch.claimed === 0 || !batch.more) break
    }
    // Every delta of a DEALT player drained; the few corpus lines dealt to no team (the remainder of
    // the deal) map to no league in scope and are left for the unscoped drain — counted, not assumed.
    const teamsTotal = [...teamsByLeague.values()][0].length
    const undealt = corpus.length - teamsTotal * PER_TEAM
    const left = await db.from('score_fanout').select('player_id', { count: 'exact', head: true }).eq('season', SEASON)
    expect([left.error, left.count]).toEqual([null, undealt * 2])
    workerRows = await allRows()
    const teams = [...teamsByLeague.values()].reduce((n, t) => n + t.length, 0)
    expect(workerRows.length).toBe(teams * 2 * PER_TEAM)
    const matchups = await must(db.from('matchups').select('week, home_team_id, away_team_id, home_score, away_score').in('league_id', leagueIds), 'matchups')
    const stored = new Map<string, number | null>()
    for (const m of matchups!) {
      stored.set(`${m.week}:${m.home_team_id}`, m.home_score === null ? null : Number(m.home_score))
      stored.set(`${m.week}:${m.away_team_id}`, m.away_score === null ? null : Number(m.away_score))
    }
    const byTeamWeek = new Map<string, Row[]>()
    for (const r of workerRows) byTeamWeek.set(`${r.week}:${r.team_id}`, [...(byTeamWeek.get(`${r.week}:${r.team_id}`) ?? []), r])
    let mismatches = 0
    let pendingTeams = 0
    for (const [k, rows] of byTeamWeek) {
      const pending = rows.some((r) => r.pending.length > 0)
      const sum = Math.round(rows.reduce((a, r) => a + r.points * 100, 0)) / 100
      const s = stored.get(k)
      if (pending) {
        pendingTeams += 1
        if (s !== null) mismatches += 1
      } else if (s === null || s === undefined || Math.round(s * 100) !== Math.round(sum * 100)) mismatches += 1
    }
    expect(byTeamWeek.size).toBe(teams * 2)
    expect(mismatches).toBe(0)
    console.log(`G1: ${corpus.length} lines × 8 templates · ${teams} teams × 2 weeks = ${byTeamWeek.size} team-weeks · ${workerRows.length} rows · ${pendingTeams} pending team-weeks · 0 mismatches`)
  }, 300_000)

  it('G2 LEGACY EMULATED: the rows deleted (a pre-158 week has none), week 1 walked to FINAL, one starter corrected after that', async () => {
    for (const leagueId of leagueIds) await must(db.from('league_week_player_points').delete().eq('league_id', leagueId), 'delete rows')
    expect((await allRows()).length).toBe(0)
    for (const leagueId of leagueIds) {
      for (const status of ['correction_window', 'final']) await must(db.from('league_weeks').update({ status }).eq('league_id', leagueId).eq('week', 1), `week 1 → ${status}`)
      await must(db.from('league_weeks').update({ status: 'correction_window' }).eq('league_id', leagueId).eq('week', 2), 'week 2 → correction_window')
    }
    // A receiver with yards in week 1: +10 yards after the week locked (every template pays receiving yards).
    const wr = corpus.find((c) => (c.columns.receiving_yards ?? 0) > 20)!
    corrected = wr.id
    await must(db.from('player_stats').update({ receiving_yards: Number(wr.columns.receiving_yards) + 10, updated_at: LATE }).eq('player_id', wr.id).eq('season', SEASON).eq('week', 1).select('player_id'), 'late correction')
    before = await digest()
  })

  let dry: BackfillReport
  let applied: BackfillReport
  it('G3 THE BACKFILL: the dry run predicts what the door returns; scores_moved 0; every recoverable team-week IDENTICAL to the worker; exactly the corrected starter’s teams unrecoverable; the scores byte-identical', async () => {
    dry = await backfillPlayerPoints({ db, time: clock }, { season: SEASON, apply: false, leagueIds })
    expect((await allRows()).length).toBe(0) // a dry run writes nothing
    applied = await backfillPlayerPoints({ db, time: clock }, { season: SEASON, apply: true, leagueIds })
    expect(applied.problems).toEqual([])
    expect(applied.ok).toBe(true)
    expect(applied.scores_moved).toBe(0)
    expect(applied.counts).toEqual(dry.counts)
    const teams = [...teamsByLeague.values()].reduce((n, t) => n + t.length, 0)
    expect(applied.counts).toEqual({ backfill: teams * 2 - 8, backfill_unrecoverable: 8 })
    expect(applied.rows_stored).toBe(teams * 2 * PER_TEAM)
    const rows = await allRows()
    const workerBy = new Map(workerRows.map((r) => [key(r), r]))
    const unrecoverableTeams = new Set(rows.filter((r) => r.source === 'backfill_unrecoverable').map((r) => r.team_id))
    expect(unrecoverableTeams.size).toBe(8)
    let identical = 0
    let differ = 0
    for (const r of rows) {
      const w = workerBy.get(key(r))!
      if (cells(r) === cells(w)) identical += 1
      else {
        differ += 1
        expect(r.player_id).toBe(corrected) // the ONLY moved line is the corrected starter's
        expect(r.source).toBe('backfill_unrecoverable')
      }
    }
    expect(differ).toBe(8)
    expect(identical).toBe(rows.length - 8)
    expect(await digest()).toBe(before)
    console.log(`G3: ${applied.score_cells} stored score/result cells read before and after — ${applied.scores_moved} moved · ${rows.length} rows stored · ${identical} identical to the worker · ${differ} (the corrected starter, 8 leagues) recomputed and marked unrecoverable`)
  }, 300_000)

  it('G4 ONCE: a second run stores nothing and moves nothing', async () => {
    const again = await backfillPlayerPoints({ db, time: clock }, { season: SEASON, apply: true, leagueIds })
    const teams = [...teamsByLeague.values()].reduce((n, t) => n + t.length, 0)
    expect([again.rows_stored, again.scores_moved, again.counts]).toEqual([0, 0, { already_stored: teams * 2 }])
    expect(await digest()).toBe(before)
  }, 300_000)
})
