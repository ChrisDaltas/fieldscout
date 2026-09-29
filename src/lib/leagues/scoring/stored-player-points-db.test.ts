/**
 * stored-player-points-db.test.ts — F405 AS RULED, END TO END over the REAL
 * local stack (M5 task L.D3.11, migration 158; PROGRESS F405 / D422; spec
 * §7.3.3 / §7.3.6 / §11.4 / §23.4 v2.16.68). Chris (2026-09-28): "okay lets
 * stay in line with standard platforms" — (1) store each starter's points
 * when a week is scored, so a box score always adds up to its team's score;
 * (2) the stat-correction window runs to the NEXT week's first kickoff;
 * (3) after that the week locks: later corrections update the players' real
 * stats (research), never a locked week's scores, results or points.
 *
 * THE LATE-CORRECTION STORY (its own calendar, season 2091 weeks 1–2 — every
 * instant a literal; a VirtualClock; the REAL worker, the REAL
 * league_week_advance and finalize_matchups; one h2h league, ESPN Standard):
 *   SP1  week 1 LIVE: the worker scores it — T1 14.00 (11.00 + 3.00), T2 4.00
 *        — and stores each starter's points WITH the score; a live box is
 *        computed live.
 *   SP2  the week's last game ends (the real advance job) ⇒ correction
 *        window; the box now reads the STORED rows and they add up.
 *   SP3  INSIDE the window — and AFTER the old Thursday 06:00 ET close — a
 *        correction lands: the week is RE-SCORED (15.00) and its rows with it;
 *        finalize at the old close + 1 h does NOT finalize.
 *   SP4  the real finalize_matchups: at week 2's first kickoff − 1 s nothing;
 *        AT the kickoff the week is final (15.00 v 4.00, home).
 *   SP5  AFTER the window a correction lands: player_stats moves (research is
 *        right: 80 yards), the worker skips the locked week, and the score,
 *        the result, the results rows AND the stored per-player points are
 *        byte-identical; the box still shows 12.00 + 3.00 = 15.00 — adding up
 *        to the final score — beside today's stat line.
 *   SP6  reconcile: no drift; the moved line is `post_window_correction`
 *        [INFO] naming his stored and current points; no warn.
 *   SP7  the lock itself refuses a hand-written change (service role).
 *   SP8  DEPLOY BEFORE PUSH — the three TS paths against a database answering
 *        as a pre-158 one does (the MEASURED PGRST205 for the table; the
 *        119-shaped door report): the worker scores exactly as before and
 *        NAMES `not_stored_pre_158`; the box falls back to the live
 *        computation and says why (200, never a 500); reconcile runs today's
 *        checks and names `player_points_store_missing` once.
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-spp` prefix on players / stats / queue / games,
 * the league by name, the 2091 calendar rows (measured unused); cleanup
 * first and after. Action-id prefix `3b3` (measured free 2026-09-28).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { readBoxScore, type TeamBoxScore } from '../api/box-score-service'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { VirtualClock } from '../time/virtual-clock'
import { type ReconcileReport, reconcileSeason } from './reconcile'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-spp'
const SEASON = 2091
const COMMISH = { email: 'stored-points-commish@fieldscout.test', password: 'pgtap-spp-pass-1', username: 'spp_commish_one' }
const ACTION = { league: '3b300000-0000-4000-8000-000000000001' } as const

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const WR3 = `${PREFIX}-wr3`
const PLAYERS = [
  { id: WR1, full_name: 'SPP Receiver One', position: 'WR', team: 'SPA', status: 'Active' },
  { id: WR2, full_name: 'SPP Receiver Two', position: 'WR', team: 'SPB', status: 'Active' },
  { id: WR3, full_name: 'SPP Receiver Three', position: 'WR', team: 'SPA', status: 'Active' },
]

/** The calendar (literals): week 1's last game ends Tue 04:00Z; its DEFAULT close is Thu 06:00 ET (10:00Z); week 2's first kickoff is Thu 20:15 ET. */
const WEEK1 = { starts: '2091-09-12T04:00:00.000Z', kickoff: '2091-09-14T00:15:00.000Z', lastEnd: '2091-09-18T04:00:00.000Z', defaultClose: '2091-09-20T10:00:00.000Z' }
const WEEK2 = { starts: '2091-09-19T04:00:00.000Z', kickoff: '2091-09-21T00:15:00.000Z', defaultClose: '2091-09-27T10:00:00.000Z' }
const STAMP_LIVE = '2091-09-15T20:00:00.000Z'
const IN_WINDOW_CORRECTION = '2091-09-20T12:00:00.000Z' // Thu 08:00 ET — after the OLD close, before week 2's kickoff
const OLD_CLOSE_PLUS_1H = '2091-09-20T11:00:00.000Z'
const LATE_CORRECTION = '2091-09-22T12:00:00.000Z'

/** ESPN Standard for a WR: 0.1 / receiving yard, 6 / TD. */
const LINES_LIVE = { [WR1]: { receptions: 5, receiving_yards: 50, receiving_tds: 1 }, [WR3]: { receptions: 2, receiving_yards: 30 }, [WR2]: { receptions: 3, receiving_yards: 40 } } // 11 + 3 = 14 · 4

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(new Date(STAMP_LIVE))

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', `${PREFIX}-%`), 'cleanup player_stats')
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

let leagueId: string
let t1: string
let t2: string
let matchupId: string
let commishClient: SupabaseClient<Database>

async function plant(lines: Record<string, Record<string, number>>, stamp: string): Promise<void> {
  const rows = Object.entries(lines).map(([player_id, columns]) => ({
    player_id,
    season: SEASON,
    week: 1,
    stat_type: 'weekly',
    updated_at: stamp,
    advanced: {},
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    ...columns,
  }))
  await must(service.from('player_stats').upsert(rows, { onConflict: 'player_id,season,week' }).select('player_id'), 'plant')
  await must(
    service
      .from('score_fanout')
      .upsert(rows.map((r) => ({ season: SEASON, week: 1, player_id: r.player_id, enqueued_at: stamp, deferred_until: null })), { onConflict: 'season,week,player_id', ignoreDuplicates: false })
      .select('player_id'),
    'enqueue',
  )
}

function drain(db: SupabaseClient<Database> = service) {
  return runScoreWeekBatch({ time: clock, db }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function scores(): Promise<string> {
  const m = await must(service.from('matchups').select('home_score, away_score, status, result').eq('id', matchupId).single(), 'matchup')
  return `${Number(m!.home_score).toFixed(2)}/${Number(m!.away_score).toFixed(2)} ${m!.status} ${m!.result ?? '-'}`
}

async function storedRows(): Promise<string> {
  const rows = await must(
    service.from('league_week_player_points').select('team_id, slot, player_id, points, source').eq('league_id', leagueId).order('team_id').order('slot'),
    'stored rows',
  )
  return (rows ?? [])
    .map((r) => `${r.team_id === t1 ? 'T1' : 'T2'}/${r.slot}=${Number(r.points).toFixed(2)}:${r.source}`)
    .sort()
    .join(' ')
}

async function box(team: string, client: SupabaseClient<Database> = commishClient): Promise<TeamBoxScore> {
  const result = await readBoxScore(client, leagueId, { week: '1', team })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body as unknown as TeamBoxScore
}

function boxSummary(b: TeamBoxScore): string {
  return `${b.points_source} ${b.points} [${b.starters.filter((s) => s.player).map((s) => `${s.slot}=${s.points}`).join(', ')}]`
}

function reconcile(db: SupabaseClient<Database> = service): Promise<ReconcileReport> {
  return reconcileSeason({ time: clock, db }, { season: SEASON, leagueIds: [leagueId] })
}

async function weekStatus(): Promise<string> {
  return (await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', 1).single(), 'week'))!.status
}

/** A client that answers as a pre-158 database does: the MEASURED PGRST205 for the table, and 119's report (no `player_points`). */
function pre158(real: SupabaseClient<Database>): SupabaseClient<Database> {
  const missing = { data: null, error: { code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.league_week_player_points' in the schema cache" }, count: null, status: 404, statusText: 'Not Found' }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'limit', 'is']) builder[m] = () => builder
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(missing).then(resolve)
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => (table === 'league_week_player_points' ? builder : target.from(table as never))
      }
      if (prop === 'rpc') {
        return async (fn: string, args: Record<string, unknown>) => {
          const result = (await target.rpc(fn as never, args as never)) as unknown as { data: unknown; error: unknown }
          if (fn === 'score_write_week_batch' && result.data && typeof result.data === 'object') {
            const door119 = { ...(result.data as Record<string, unknown>) }
            delete door119.player_points // 119's report never carries it
            return { ...result, data: door119 }
          }
          return result
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as SupabaseClient<Database>
}

beforeAll(async () => {
  await cleanup()
  // The calendar: week 1 inserted with its default close; week 2's first kickoff moves it (158's trigger).
  await must(
    service.from('nfl_weeks').insert([
      { season: SEASON, week: 1, starts_at: WEEK1.starts, first_kickoff_at: WEEK1.kickoff, last_game_ends_at: WEEK1.lastEnd, correction_window_ends_at: WEEK1.defaultClose },
      { season: SEASON, week: 2, starts_at: WEEK2.starts, first_kickoff_at: WEEK2.kickoff, last_game_ends_at: null, correction_window_ends_at: WEEK2.defaultClose },
    ]),
    'nfl_weeks',
  )
  await must(
    service.from('nfl_games').insert([{ id: `${PREFIX}-g1`, season: SEASON, week: 1, home_team: 'SPA', away_team: 'SPB', kickoff_at: WEEK1.kickoff, status: 'final' }]),
    'nfl_games',
  )
  const { data: created, error: userError } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  const commishId = created.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: 'SPP One',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  t2 = (await must(service.from('teams').insert({ owner_id: commishId, name: 'SPP Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  // No bracket: this league's finalize runs 118's sync, and a bracket is not this suite's subject.
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json, playoff_teams: 0 }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  matchupId = (await must(
    service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id').single(),
    'matchup',
  ))!.id
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: t1, player_id: WR1 },
    { league_id: leagueId, team_id: t1, player_id: WR3 },
    { league_id: leagueId, team_id: t2, player_id: WR2 },
  ]), 'rosters')
  await must(
    service.from('team_lineups').insert([
      { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR1, 'wr:1': WR3 } },
      { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
    ]),
    'lineups',
  )
}, 60_000)

afterAll(cleanup)

describe('F405 as ruled: stored per-player points + the next-week-kickoff window + the lock, end to end', () => {
  it('SP0 (premise) the calendar: week 2’s first kickoff IS week 1’s window end (Thu 20:15 ET) — the default Thursday 06:00 ET kept beside it', async () => {
    const w = await must(service.from('nfl_weeks').select('correction_window_ends_at, correction_window_default_ends_at').eq('season', SEASON).eq('week', 1).single(), 'week 1')
    expect([new Date(w!.correction_window_ends_at!).toISOString(), new Date(w!.correction_window_default_ends_at!).toISOString()]).toEqual([WEEK2.kickoff, WEEK1.defaultClose])
  })

  it('SP1 week 1 LIVE: the real worker scores 14.00 v 4.00 and STORES each starter’s points with the score; the live box is computed live', async () => {
    await plant(LINES_LIVE, STAMP_LIVE)
    const batch = await drain()
    expect(batch.written).toBe(1)
    const entry = batch.leagues.find((l) => l.league_id === leagueId)!
    expect(entry.player_points).toBe('stored')
    expect(entry.door?.player_points).toEqual({ teams_sent: 2, teams_written: 2, rows_written: 3, rows_removed: 0 })
    expect(await scores()).toBe('14.00/4.00 live -')
    expect(await storedRows()).toBe('T1/wr:0=11.00:worker T1/wr:1=3.00:worker T2/wr:0=4.00:worker')
    expect(boxSummary(await box(t1))).toBe('live 14 [wr:0=11, wr:1=3]')
  })

  it('SP2 the last game ends (the REAL league_week_advance) ⇒ correction window; the box now reads the STORED rows and they add up to the score', async () => {
    clock.advanceTo(new Date(WEEK1.lastEnd))
    const { error } = await service.rpc('league_week_advance', { p_now: WEEK1.lastEnd, p_league_id: leagueId })
    expect(error).toBeNull()
    expect(await weekStatus()).toBe('correction_window')
    const b = await box(t1)
    expect([boxSummary(b), b.stored_source, b.stored_note]).toEqual(['stored 14 [wr:0=11, wr:1=3]', 'worker', null])
  })

  it('SP3 INSIDE the window — after the OLD Thursday 06:00 ET close — a correction RE-SCORES the week (15.00) and its rows; finalize at the old close + 1 h does not finalize', async () => {
    clock.advanceTo(new Date(IN_WINDOW_CORRECTION))
    await plant({ [WR1]: { receptions: 5, receiving_yards: 60, receiving_tds: 1 } }, IN_WINDOW_CORRECTION)
    const batch = await drain()
    expect(batch.written).toBe(1)
    expect(await scores()).toBe('15.00/4.00 live -')
    expect(await storedRows()).toBe('T1/wr:0=12.00:worker T1/wr:1=3.00:worker T2/wr:0=4.00:worker')
    expect(boxSummary(await box(t1))).toBe('stored 15 [wr:0=12, wr:1=3]')
    const { error } = await service.rpc('finalize_matchups', { p_now: OLD_CLOSE_PLUS_1H, p_league_id: leagueId })
    expect(error).toBeNull()
    expect(await weekStatus()).toBe('correction_window')
  })

  it('SP4 the REAL finalize_matchups: one second before week 2’s first kickoff the week is still open; AT the kickoff it is FINAL (15.00 v 4.00, home)', async () => {
    const before = new Date(Date.parse(WEEK2.kickoff) - 1000).toISOString()
    expect((await service.rpc('finalize_matchups', { p_now: before, p_league_id: leagueId })).error).toBeNull()
    expect(await weekStatus()).toBe('correction_window')
    clock.advanceTo(new Date(WEEK2.kickoff))
    expect((await service.rpc('finalize_matchups', { p_now: WEEK2.kickoff, p_league_id: leagueId })).error).toBeNull()
    expect(await weekStatus()).toBe('final')
    expect(await scores()).toBe('15.00/4.00 final home')
  })

  let resultsBefore = ''
  it('SP5 AFTER the window a correction lands: research moves (player_stats 80 yds), the locked week does not — score, result, results rows and stored points byte-identical; the box still adds up (12 + 3 = 15) beside today’s line', async () => {
    resultsBefore = JSON.stringify(await must(service.from('team_week_results').select('team_id, points, h2h_result, is_final').eq('league_id', leagueId).order('team_id'), 'results before'))
    const storedBefore = await storedRows()
    clock.advanceTo(new Date(LATE_CORRECTION))
    await plant({ [WR1]: { receptions: 6, receiving_yards: 80, receiving_tds: 1 } }, LATE_CORRECTION)
    const batch = await drain()
    expect(batch.written).toBe(0)
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    const research = await must(service.from('player_stats').select('receiving_yards').eq('player_id', WR1).eq('season', SEASON).eq('week', 1).single(), 'research')
    expect(Number(research!.receiving_yards)).toBe(80)
    expect(await scores()).toBe('15.00/4.00 final home')
    expect(await storedRows()).toBe(storedBefore)
    expect(JSON.stringify(await must(service.from('team_week_results').select('team_id, points, h2h_result, is_final').eq('league_id', leagueId).order('team_id'), 'results after'))).toBe(resultsBefore)
    const b = await box(t1)
    expect(boxSummary(b)).toBe('stored 15 [wr:0=12, wr:1=3]')
    expect(b.starters.find((s) => s.slot === 'wr:0')!.line?.receiving_yards).toBe(80) // the stat LINE is today's (research)
  })

  it('SP6 reconcile: NO drift, NO warn for the league — the moved line is post_window_correction [info], naming his stored 12 and today’s 14', async () => {
    const report = await reconcile()
    const mine = report.findings.filter((f) => f.league_id === leagueId)
    expect(mine.filter((f) => f.severity !== 'info')).toEqual([])
    const late = mine.filter((f) => f.kind === 'post_window_correction')
    expect(late.map((f) => [f.week, f.team_id, f.severity, f.stored, f.recomputed])).toEqual([[1, t1, 'info', 15, 15]])
    expect(late[0].message).toContain(`${WR1} (wr:0) stored 12, today's stats 14`)
  })

  it('SP7 THE LOCK: a hand-written change to the locked week’s stored points is refused by the table itself (service role)', async () => {
    const { error } = await service.from('league_week_player_points').update({ points: 14 }).eq('league_id', leagueId).eq('slot', 'wr:0').eq('team_id', t1)
    expect(error?.message).toContain('week_locked')
    expect(await storedRows()).toBe('T1/wr:0=12.00:worker T1/wr:1=3.00:worker T2/wr:0=4.00:worker')
  })

  it('SP8 DEPLOY BEFORE PUSH — against a pre-158 answer the worker scores as before and names it, the box falls back to live (200, says why), reconcile runs today’s checks and names the missing store once', async () => {
    // The box, on the locked week, with the MEASURED PGRST205: live computation from today's stats (the pre-158 behaviour), named.
    const b = await box(t1, pre158(commishClient))
    expect([b.points_source, b.points, b.stored_note]).toEqual(['live', 17, 'the database predates migration 158 (no league_week_player_points table) — per-player points are not stored yet, so this read uses the live computation, as before'])
    // Reconcile: the store read answers PGRST205 ⇒ one info, and the final week goes back to the pre-158 arm (the warn it always gave).
    const report = await reconcile(pre158(service))
    const mine = report.findings.filter((f) => f.league_id === leagueId || f.kind === 'player_points_store_missing')
    expect(mine.filter((f) => f.kind === 'player_points_store_missing').map((f) => f.severity)).toEqual(['info'])
    expect(mine.filter((f) => f.kind === 'post_window_correction').map((f) => [f.severity, f.stored, f.recomputed])).toEqual([['warn', 15, 17]])
    // The worker against a 119-shaped report: a correction in an OPEN week (reopen week 1 through the audited arm is M6's —
    // so open week 2 here) is scored exactly as before and the missing storage NAMED.
    await must(service.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', 2), 'week 2 live')
    const m2 = (await must(service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 2, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id').single(), 'matchup wk 2'))!.id
    await must(service.from('team_lineups').insert([
      { team_id: t1, season: SEASON, week: 2, starters: [], bench: [], slot_map: { 'wr:0': WR1 } },
      { team_id: t2, season: SEASON, week: 2, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
    ]), 'lineups wk 2')
    await must(service.from('player_stats').upsert([{ player_id: WR1, season: SEASON, week: 2, stat_type: 'weekly', updated_at: LATE_CORRECTION, advanced: {}, receptions: 1, receiving_yards: 20, receiving_tds: 0 }], { onConflict: 'player_id,season,week' }).select('player_id'), 'wk2 stats')
    await must(service.from('score_fanout').upsert([{ season: SEASON, week: 2, player_id: WR1, enqueued_at: LATE_CORRECTION, deferred_until: null }], { onConflict: 'season,week,player_id', ignoreDuplicates: false }).select('player_id'), 'wk2 enqueue')
    const batch = await drain(pre158(service))
    const entry = batch.leagues.find((l) => l.league_id === leagueId && l.week === 2)!
    expect([entry.outcome, entry.player_points]).toEqual(['written', 'not_stored_pre_158'])
    expect(entry.problems).toContain('per-player points NOT stored: score_write_week_batch answered without a player_points report — the database predates migration 158 (it ignores `players`); the team scores are written exactly as before and box scores stay live until 158 is pushed')
    const m = await must(service.from('matchups').select('home_score').eq('id', m2).single(), 'wk2 score')
    expect(Number(m!.home_score)).toBe(2)
  })
})
