/**
 * stat-fix-rescore-db.test.ts — OUR OWN STAT FIXES re-score final weeks,
 * automatically and quietly, over the REAL local stack (migration 222;
 * PROGRESS D836–D839; spec v2.16.118). Chris 2026-11-07, verbatim: "the
 * stats need to be correct. that should be done automatically, we should not
 * be doing this is as some live code change." / "fixing stats should not go
 * to some user, i'm not following" / "just update the points as they should
 * be so we can move on."
 *
 * Its own calendar (season 2075 — no other stack suite names it), the REAL
 * worker, league_week_advance, the close stamp and finalize_matchups; two h2h
 * leagues on ESPN Standard, the same four players, the same week:
 *   SF0  PREMISE — week 1 scored while the feed map left a kicker's short
 *        field goal empty (fg_0_39 0): One 13.00 v Two 14.50, Two wins, final.
 *        Then OUR fix lands (fg_0_39 0 → 1, written quietly — no queue row)
 *        and is recorded and written; then the PROVIDER corrects Two's
 *        receiver (125 → 175 yards) AND One's own kicker (a 4th PAT) after the
 *        window; and A's commissioner edits One's final-week lineup (a bench
 *        kicker in K1's slot — 201: the score does not follow). League B is
 *        archived.
 *   SF1  the CLI's plan (read-only, the door's own dry run): A would move One's
 *        kicker 3.00 → 6.00 (+3.00) and its score 13.00 → 16.00; B is named
 *        not eligible (archived); NOTHING is written or recorded. Given a
 *        landing before A's close stamp, A's week is named scored after it.
 *   SF2  THE PASS applies A: the kicker's row is stored + 3 (stat_fix), Two's
 *        receiver keeps what was scored (the provider's correction is NOT
 *        paid), each score is Σ its rows, the result flips with the score
 *        (One wins 16.00–14.50), the results are rebuilt — and QUIETLY: no
 *        commissioner-log row, no league post, no notification. One receipt.
 *   SF3  a second pass is a no-op: nothing owed, nothing written.
 *   SF4  the archived league was skipped and is STILL OWED: restored, the next
 *        pass applies it the same way; `status` (paged) reads applied 2, owed 0.
 *   SF5  the provider's own path is unchanged: a queued delta on the final
 *        week is consumed `week_final` and moves nothing (F405 / Q81).
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-sfx` prefix on players / stats / queue / games,
 * the leagues by name, the 2075 calendar rows, the 2075 stat fixes; cleanup
 * first and after (a league's receipts go with it; a fix applied nowhere may
 * then be withdrawn). Action-id prefix `3e5` (free by a repo grep).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { VirtualClock } from '../time/virtual-clock'
import { runScoreWeekBatch } from './score-week-worker'
import { runStatFixCli } from './stat-fix-cli'
import { runStatFixPass } from './stat-fix-rescore'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-sfx'
const SEASON = 2075
const COMMISH = { email: 'stat-fix-commish@fieldscout.test', password: 'pgtap-sfx-pass-1', username: 'sfx_commish_one' }
const MANAGER = { email: 'stat-fix-manager@fieldscout.test', password: 'pgtap-sfx-pass-2', username: 'sfx_manager_two' }

const K1 = `${PREFIX}-k1`
const WR1 = `${PREFIX}-wr1`
const K2 = `${PREFIX}-k2`
const WR2 = `${PREFIX}-wr2`
const K3 = `${PREFIX}-k3`
const PLAYERS = [
  { id: K1, full_name: 'SFX Kicker One', position: 'K', team: 'SFA', status: 'Active' },
  { id: WR1, full_name: 'SFX Receiver One', position: 'WR', team: 'SFA', status: 'Active' },
  { id: K2, full_name: 'SFX Kicker Two', position: 'K', team: 'SFB', status: 'Active' },
  { id: WR2, full_name: 'SFX Receiver Two', position: 'WR', team: 'SFB', status: 'Active' },
  { id: K3, full_name: 'SFX Kicker Bench', position: 'K', team: 'SFB', status: 'Active' },
]

/** The calendar (literals). Week 1's window ends at week 2's first kickoff (158). */
const WEEK1 = { starts: '2075-09-10T04:00:00.000Z', kickoff: '2075-09-12T00:15:00.000Z', lastEnd: '2075-09-16T04:00:00.000Z', defaultClose: '2075-09-18T10:00:00.000Z' }
const WEEK2 = { starts: '2075-09-17T04:00:00.000Z', kickoff: '2075-09-19T00:15:00.000Z', defaultClose: '2075-09-25T10:00:00.000Z' }
const STAMP_LIVE = '2075-09-13T20:00:00.000Z'
const LANDED = '2075-09-30T12:00:00.000Z'
const LATE = '2075-10-01T12:00:00.000Z'

/**
 * ESPN Standard, hand-computed: a PAT 1, a short field goal 3, a WR 0.1 a
 * receiving yard. One: K1 3 PATs (the short field goal unread) 3 + WR1 100
 * yards 10 = 13.00; Two: K2 2 PATs 2 + WR2 125 yards 12.50 = 14.50. With our
 * fix One's kicker is 6 ⇒ 16.00 — One wins. The provider's late 175 yards
 * would make Two 19.50 and keep Two winning, and its late 4th PAT would make
 * One's kicker 7: neither may be paid. The bench kicker the commissioner put in
 * One's slot after the week was final scores nothing here: the lineup is the
 * stored rows (what was scored), never slot_map.
 */
const REASON = 'the short field goals the feed map left empty (test fixture)'

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
    // An archived league refuses every write (212): restore it first so the teardown can run.
    await must(service.from('leagues').update({ deleted_at: null }).in('id', ids).not('deleted_at', 'is', null), 'cleanup restore')
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    // league_week_player_points / stat_fix_rescores / commissioner_actions ride the cascades.
    for (const table of ['transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  // A fix applied nowhere may be withdrawn (its lines go with it) — 222's one exit.
  await must(service.from('stat_fixes').delete().eq('season', SEASON), 'cleanup stat_fixes')
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
  await deleteUserByUsername(MANAGER.username)
}

interface Fixture {
  leagueId: string
  t1: string
  t2: string
  matchupId: string
}
const L: Record<'A' | 'B', Fixture> = {} as Record<'A' | 'B', Fixture>
let commishId: string
let managerId: string
let commishClient: SupabaseClient<Database>
let fixId: string

async function plant(lines: Record<string, Record<string, number>>, stamp: string, enqueue: boolean): Promise<void> {
  const rows = Object.entries(lines).map(([player_id, columns]) => ({ player_id, season: SEASON, week: 1, stat_type: 'weekly', updated_at: stamp, advanced: {}, ...columns }))
  await must(service.from('player_stats').upsert(rows, { onConflict: 'player_id,season,week' }).select('player_id'), 'plant')
  if (!enqueue) return
  await must(
    service
      .from('score_fanout')
      .upsert(rows.map((r) => ({ season: SEASON, week: 1, player_id: r.player_id, enqueued_at: stamp, deferred_until: null })), { onConflict: 'season,week,player_id', ignoreDuplicates: false })
      .select('player_id'),
    'enqueue',
  )
}

async function buildLeague(name: string, actionId: string): Promise<Fixture> {
  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-${name}`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: `SFX ${name} One`,
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  const leagueId = (league as { league_id: string }).league_id
  const t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  const t2 = (await must(service.from('teams').insert({ owner_id: managerId, name: `SFX ${name} Two`, league_id: leagueId }).select('id').single(), 'team two'))!.id
  await must(service.from('league_members').insert({ league_id: leagueId, user_id: managerId, team_id: t2, role: 'manager', is_placeholder: false }), 'manager seat')
  // No bracket: a bracket is not this suite's subject (the door refuses one by name — pgTAP 171 E4).
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json, playoff_teams: 0 }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  const matchupId = (await must(
    service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id').single(),
    'matchup',
  ))!.id
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: t1, player_id: K1 }, { league_id: leagueId, team_id: t1, player_id: WR1 },
    { league_id: leagueId, team_id: t2, player_id: K2 }, { league_id: leagueId, team_id: t2, player_id: WR2 },
    { league_id: leagueId, team_id: t1, player_id: K3 },
  ]), 'rosters')
  await must(service.from('team_lineups').insert([
    { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'k:0': K1, 'wr:0': WR1 } },
    { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'k:0': K2, 'wr:0': WR2 } },
  ]), 'lineups')
  return { leagueId, t1, t2, matchupId }
}

async function finalizeWeek1(f: Fixture): Promise<void> {
  if ((await service.rpc('league_week_advance', { p_now: WEEK1.lastEnd, p_league_id: f.leagueId })).error) throw new Error('advance')
  // 216 (F863): the close stamp, by hand — the worker already wrote every team's score and rows.
  const digest = await service.rpc('league_week_scores_digest_internal', { p_league_id: f.leagueId, p_season: SEASON, p_week: 1 })
  if (digest.error) throw new Error(`digest: ${digest.error.message}`)
  const stamped = await service.rpc('league_week_close_stamp', { p_league_id: f.leagueId, p_week: 1, p_digest: digest.data as string, p_scores: [], p_now: WEEK2.kickoff })
  if (stamped.error) throw new Error(`stamp: ${stamped.error.message}`)
  if ((await service.rpc('finalize_matchups', { p_now: WEEK2.kickoff, p_league_id: f.leagueId })).error) throw new Error('finalize')
}

async function scores(f: Fixture): Promise<string> {
  const m = await must(service.from('matchups').select('home_score, away_score, status, result').eq('id', f.matchupId).single(), 'matchup')
  return `${Number(m!.home_score).toFixed(2)}/${Number(m!.away_score).toFixed(2)} ${m!.status} ${m!.result ?? '-'}`
}

async function results(f: Fixture): Promise<string> {
  const rows = await must(service.from('team_week_results').select('team_id, points, h2h_result, is_final').eq('league_id', f.leagueId).eq('week', 1), 'results')
  return (rows ?? []).map((r) => `${r.team_id === f.t1 ? 'One' : 'Two'}=${Number(r.points).toFixed(2)}:${r.h2h_result}:${r.is_final}`).sort().join(' ')
}

async function storedRows(f: Fixture): Promise<string> {
  const rows = await must(service.from('league_week_player_points').select('team_id, slot, points, source').eq('league_id', f.leagueId).eq('week', 1), 'stored rows')
  return (rows ?? []).map((r) => `${r.team_id === f.t1 ? 'One' : 'Two'}/${r.slot}=${Number(r.points).toFixed(2)}:${r.source}`).sort().join(' ')
}

/** Σ of each team's stored rows = its stored score — the rows ARE the score (F405). */
async function rowsAreTheScore(f: Fixture): Promise<boolean> {
  const rows = await must(service.from('league_week_player_points').select('team_id, points').eq('league_id', f.leagueId).eq('week', 1), 'rows')
  const m = await must(service.from('matchups').select('home_score, away_score').eq('id', f.matchupId).single(), 'matchup')
  const sum = (team: string) => (rows ?? []).filter((r) => r.team_id === team).reduce((acc, r) => acc + Math.round(Number(r.points) * 100), 0)
  return sum(f.t1) === Math.round(Number(m!.home_score) * 100) && sum(f.t2) === Math.round(Number(m!.away_score) * 100)
}

/** What a member could be told: commissioner-log rows, league posts, notifications. */
async function noise(f: Fixture): Promise<string> {
  const audit = await must(service.from('commissioner_actions').select('id').eq('league_id', f.leagueId), 'audit')
  const posts = await must(service.from('league_chat').select('id').eq('league_id', f.leagueId), 'posts')
  const notes = await must(service.from('notifications').select('id').in('user_id', [commishId, managerId]), 'notifications')
  return `audit ${audit!.length} · posts ${posts!.length} · notifications ${notes!.length}`
}

async function receipts(f: Fixture): Promise<number> {
  return (await must(service.from('stat_fix_rescores').select('id').eq('league_id', f.leagueId), 'receipts'))!.length
}

async function states(): Promise<string> {
  const rows = await must(service.rpc('stat_fix_targets', { p_owed_only: false, p_limit: 1, p_league_ids: [L.A.leagueId, L.B.leagueId] }), 'targets')
  return (rows ?? []).filter((r) => r.fix_id === fixId).map((r) => `${r.league_id === L.A.leagueId ? 'A' : 'B'}:${r.week}:${r.state}`).sort().join(' ')
}

function pass() {
  return runStatFixPass({ db: service, time: clock }, { leagueIds: [L.A.leagueId, L.B.leagueId] })
}

beforeAll(async () => {
  await cleanup()
  await must(
    service.from('nfl_weeks').insert([
      { season: SEASON, week: 1, starts_at: WEEK1.starts, first_kickoff_at: WEEK1.kickoff, last_game_ends_at: WEEK1.lastEnd, correction_window_ends_at: WEEK1.defaultClose },
      { season: SEASON, week: 2, starts_at: WEEK2.starts, first_kickoff_at: WEEK2.kickoff, last_game_ends_at: null, correction_window_ends_at: WEEK2.defaultClose },
    ]),
    'nfl_weeks',
  )
  await must(service.from('nfl_games').insert([{ id: `${PREFIX}-g1`, season: SEASON, week: 1, home_team: 'SFA', away_team: 'SFB', kickoff_at: WEEK1.kickoff, status: 'final' }]), 'nfl_games')
  const made = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (made.error) throw new Error(`createUser: ${made.error.message}`)
  commishId = made.data.user.id
  const made2 = await service.auth.admin.createUser({ email: MANAGER.email, password: MANAGER.password, email_confirm: true, user_metadata: { username: MANAGER.username } })
  if (made2.error) throw new Error(`createUser: ${made2.error.message}`)
  managerId = made2.data.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')
  L.A = await buildLeague('A', '3e500000-0000-4000-8000-000000000001')
  L.B = await buildLeague('B', '3e500000-0000-4000-8000-000000000002')

  // (1) Scored through the REAL worker while the map left the short field goal empty.
  await plant({ [K1]: { xp_made: 3, xp_attempted: 3, fg_made: 1, fg_attempted: 1, fg_0_39: 0 }, [WR1]: { receiving_yards: 100 }, [K2]: { xp_made: 2, xp_attempted: 2 }, [WR2]: { receiving_yards: 125 } }, STAMP_LIVE, true)
  const batch = await runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [L.A.leagueId, L.B.leagueId] })
  if (batch.written !== 2) throw new Error(`premise: the worker wrote ${batch.written} league-weeks, expected 2 — ${JSON.stringify(batch.problems)}`)
  // (2) The REAL advance, close stamp and finalize: final at week 2's first kickoff.
  clock.advanceTo(new Date(WEEK2.kickoff))
  await finalizeWeek1(L.A)
  await finalizeWeek1(L.B)
  // (3) OUR FIX lands — written as the quiet fill writes it: the column, no queue row, no event.
  clock.advanceTo(new Date(LANDED))
  await plant({ [K1]: { xp_made: 3, xp_attempted: 3, fg_made: 1, fg_attempted: 1, fg_0_39: 1 } }, LANDED, false)
  fixId = (await must(
    service.rpc('record_stat_fix', { p_season: SEASON, p_reason: REASON, p_lines: [{ week: 1, player_id: K1, stat_key: 'fg_0_39', before: 0, after: 1 }] as unknown as Json, p_landed_at: LANDED }),
    'record',
  )) as string
  await must(service.rpc('mark_stat_fix_written', { p_fix_id: fixId }), 'mark written')
  // (4) THE PROVIDER corrects Two's receiver and One's own kicker after the window — never to be paid (F405 / Q81).
  clock.advanceTo(new Date(LATE))
  await plant({ [WR2]: { receiving_yards: 175 }, [K1]: { xp_made: 4, xp_attempted: 4, fg_made: 1, fg_attempted: 1, fg_0_39: 1 } }, LATE, false)
  // (4b) A's commissioner edits One's FINAL week lineup (201 allows it; the score does not follow): K3 in K1's slot.
  await must(service.from('team_lineups').update({ slot_map: { 'k:0': K3, 'wr:0': WR1 } }).eq('team_id', L.A.t1).eq('week', 1).select('team_id'), 'commissioner edit after final')
  // (5) League B is archived.
  await must(service.from('leagues').update({ deleted_at: LATE }).eq('id', L.B.leagueId), 'archive B')
}, 90_000)

afterAll(cleanup)

describe('222 — our own stat fix re-scores final weeks, automatically and quietly, end to end', () => {
  let quietA: string
  let quietB: string

  it('SF0 PREMISE — final as first scored (One 13.00 v Two 14.50, Two wins); the fix written; A owed, B archived; slot_map no longer what was scored', async () => {
    expect(await scores(L.A)).toBe('13.00/14.50 final away')
    const map = await must(service.from('team_lineups').select('slot_map').eq('team_id', L.A.t1).eq('week', 1).single(), 'slot_map')
    expect(map!.slot_map).toEqual({ 'k:0': K3, 'wr:0': WR1 })
    expect(await results(L.A)).toBe('One=13.00:loss:true Two=14.50:win:true')
    expect(await storedRows(L.A)).toBe('One/k:0=3.00:worker One/wr:0=10.00:worker Two/k:0=2.00:worker Two/wr:0=12.50:worker')
    expect(await states()).toBe('A:1:owed B:1:league_archived')
    quietA = await noise(L.A)
    quietB = await noise(L.B)
  })

  it('SF1 the CLI plan (read-only, the door’s dry run): A’s kicker 3.00 → 6.00, its score 13.00 → 16.00; B named not eligible; NOTHING written or recorded', async () => {
    const out: string[] = []
    const err: string[] = []
    const fixesBefore = (await must(service.from('stat_fixes').select('id').eq('season', SEASON), 'fixes'))!.length
    const code = await runStatFixCli(['plan', '--file', 'lines.json'], {
      supabaseUrl: LOCAL_URL,
      connect: () => ({ db: service, time: clock }),
      readFile: () => JSON.stringify({ season: SEASON, lines: [{ week: 1, player_id: K1, stat_key: 'fg_0_39', before: 0, after: 1 }] }),
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    })
    expect([code, err]).toEqual([0, []])
    expect(out[0]).toBe('target: 127.0.0.1:54321')
    expect(out).toContain(`league ${PREFIX}-A (${L.A.leagueId}) week 1: would_apply — 1 player row(s), 1 team score(s), 2 result(s) move`)
    expect(out).toContain(`  team ${L.A.t1} k:0 SFX Kicker One (${K1}): 3.00 → 6.00 (+3.00)`)
    expect(out).toContain(`  team ${L.A.t1} score: 13.00 → 16.00`)
    expect(out).toContain(`league ${PREFIX}-B (${L.B.leagueId}) week 1: not eligible — league_archived`)
    expect(await scores(L.A)).toBe('13.00/14.50 final away')
    expect(await storedRows(L.A)).toBe('One/k:0=3.00:worker One/wr:0=10.00:worker Two/k:0=2.00:worker Two/wr:0=12.50:worker')
    expect(await receipts(L.A)).toBe(0)
    expect((await must(service.from('stat_fixes').select('id').eq('season', SEASON), 'fixes'))!.length).toBe(fixesBefore)

    // Round 5: given a landing BEFORE the week's close stamp (week 2's kickoff), the plan names A's week the way the
    // door will — scored after the fix landed, so scored with it already (216's stamp, read off the real row).
    const early: string[] = []
    const earlyCode = await runStatFixCli(['plan', '--file', 'lines.json', '--landed-at', '2075-09-18T00:00:00Z'], {
      supabaseUrl: LOCAL_URL,
      connect: () => ({ db: service, time: clock }),
      readFile: () => JSON.stringify({ season: SEASON, lines: [{ week: 1, player_id: K1, stat_key: 'fg_0_39', before: 0, after: 1 }] }),
      log: (line) => early.push(line),
      error: (line) => early.push(line),
    })
    expect(earlyCode).toBe(0)
    expect(early.find((l) => l.startsWith(`league ${PREFIX}-A `))).toMatch(
      new RegExp(`^league ${PREFIX}-A \\(${L.A.leagueId}\\) week 1: not eligible — week_scored_after_fix \\(last scored 2075-09-19T00:15:00\\+00:00, after the fix landed 2075-09-18T00:00:00Z`),
    )
  })

  it('SF2 THE PASS: stored + exactly our fix (the provider’s correction NOT paid), Σ rows = score, the result flips with it, results rebuilt — and QUIET', async () => {
    const report = await pass()
    expect(report.available).toBe(true)
    expect(report.problems).toEqual([])
    expect(report.weeks).toEqual([{ fix_id: fixId, league_id: L.A.leagueId, week: 1, verdict: 'applied', players_changed: 1, scores_changed: 1, results_changed: 2, refusal: null }])
    expect(await storedRows(L.A)).toBe('One/k:0=6.00:stat_fix One/wr:0=10.00:worker Two/k:0=2.00:worker Two/wr:0=12.50:worker')
    expect(await scores(L.A)).toBe('16.00/14.50 final home')
    expect(await rowsAreTheScore(L.A)).toBe(true)
    expect(await results(L.A)).toBe('One=16.00:win:true Two=14.50:loss:true')
    expect(await receipts(L.A)).toBe(1)
    expect(await noise(L.A)).toBe(quietA)
    expect(await states()).toBe('A:1:applied B:1:league_archived')
  })

  it('SF3 a second pass is a no-op: nothing owed, nothing written', async () => {
    const before = [await scores(L.A), await storedRows(L.A), await results(L.A), await receipts(L.A)]
    const report = await pass()
    expect([report.weeks, report.problems, report.applied]).toEqual([[], [], 0])
    expect([await scores(L.A), await storedRows(L.A), await results(L.A), await receipts(L.A)]).toEqual(before)
  })

  it('SF4 the archived league was skipped and is STILL OWED: restored, the next pass applies it the same way, quietly', async () => {
    expect(await scores(L.B)).toBe('13.00/14.50 final away')
    await must(service.from('leagues').update({ deleted_at: null }).eq('id', L.B.leagueId), 'restore B')
    expect(await states()).toBe('A:1:applied B:1:owed')
    const report = await pass()
    expect(report.weeks.map((w) => [w.league_id === L.B.leagueId ? 'B' : 'A', w.verdict, w.players_changed])).toEqual([['B', 'applied', 1]])
    expect(await storedRows(L.B)).toBe('One/k:0=6.00:stat_fix One/wr:0=10.00:worker Two/k:0=2.00:worker Two/wr:0=12.50:worker')
    expect(await scores(L.B)).toBe('16.00/14.50 final home')
    expect(await rowsAreTheScore(L.B)).toBe(true)
    expect(await noise(L.B)).toBe(quietB)
    expect(await states()).toBe('A:1:applied B:1:applied')

    // Round 5: `status` pages the targets through the REAL PostgREST (an exact count, ordered on the row's key).
    const out: string[] = []
    const code = await runStatFixCli(['status'], {
      supabaseUrl: LOCAL_URL,
      connect: () => ({ db: service, time: clock }),
      readFile: () => '',
      log: (line) => out.push(line),
      error: (line) => out.push(line),
    })
    expect(code).toBe(0)
    expect(out.find((l) => l.startsWith(`fix ${fixId} `))).toMatch(/: applied 2, owed 0, not eligible 0$/)
  })

  it('SF5 the provider’s own path is unchanged: a queued delta on the final week is consumed week_final and moves nothing (F405 / Q81)', async () => {
    const before = await storedRows(L.A)
    await plant({ [WR2]: { receiving_yards: 200 } }, '2075-10-02T12:00:00.000Z', true)
    const batch = await runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [L.A.leagueId] })
    expect(batch.written).toBe(0)
    expect(batch.problems).toContain(`[${L.A.leagueId} wk 1] league ${L.A.leagueId} week 1 skipped: week_final`)
    expect(await storedRows(L.A)).toBe(before)
    expect(await scores(L.A)).toBe('16.00/14.50 final home')
  })
})
