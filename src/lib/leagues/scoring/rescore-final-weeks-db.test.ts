/**
 * rescore-final-weeks-db.test.ts — THE PRODUCTION STORY, END TO END, over the
 * REAL local stack (M5 task L.D3.13, migration 161; PROGRESS D425; spec §11.4
 * / §23.4 v2.16.70). Chris (2026-09-29): "re-score weeks 1 and 2 with the
 * actual yards".
 *
 * Its own calendar (season 2093 — measured unused), a VirtualClock, the REAL
 * worker, league_week_advance and finalize_matchups; one h2h league on ESPN
 * Standard (which scores yards allowed), two seats with two managers:
 *   RS0  PREMISE — week 1 was scored while every D/ST's yards read 0 (the
 *        pre-143 DEFAULT: the top "0–99 yards" tier, +5), stored WITHOUT
 *        per-player points (production scored it before 158), and went
 *        final: One 15.00 v Two 14.00, One wins. Then the re-ingest filled
 *        the real yards (381 / 180) and the worker consumed the deltas as
 *        `week_final` — the stored week did not move.
 *   RS1  the ordinary backfill's dry run says what production's said: both
 *        teams `backfill_unrecoverable`, recomputed 9.00 / 12.00 (−6 / −2).
 *   RS2  RETIRED (migration 164, L.D3.14; PROGRESS F489 / D428): the door
 *        was used once (2026-09-29, F488) and 164 revoked it from the service
 *        role. The REAL answer (42501, "permission denied for function
 *        admin_rescore_final_week") ⇒ the dry run is refused BY NAME, naming
 *        the migration that would re-grant it — and NOTHING is written.
 *   RS3  …and so is an --apply.
 *   RS8  the ordinary worker still skips the locked week (a new correction
 *        lands in player_stats; nothing in the league moves).
 *   RS9  PRE-161 — the door missing (the REAL PostgREST answer, from a schema
 *        that lacks it): refused BY NAME, nothing written.
 *
 * L.D3.13's own story through the door (its RS2–RS7: the dry run, the apply,
 * the box score / reconcile / backfill over the `rescore` rows, the second
 * apply) ran green on 001–163 and is kept in the repository history at main
 * f6ce0a7 (this file); the door's database behaviour stays pinned by pgTAP
 * 109, which runs it as its owner. If the door is ever re-granted (a new
 * migration, on a new recorded ruling), restore those cells (PROGRESS F498).
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-rsf` prefix on players / stats / queue / games,
 * the league by name, the 2093 calendar rows; cleanup first and after.
 * Action-id prefix `3c1` (measured free 2026-09-29).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { VirtualClock } from '../time/virtual-clock'
import { backfillPlayerPoints } from './player-points-backfill'
import { PRE_161_SENTENCE, RETIRED_SENTENCE, rescoreFinalWeeks, type RescoreOptions } from './rescore-final-weeks'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-rsf'
const SEASON = 2093
const COMMISH = { email: 'rescore-commish@fieldscout.test', password: 'pgtap-rsf-pass-1', username: 'rsf_commish_one' }
const MANAGER = { email: 'rescore-manager@fieldscout.test', password: 'pgtap-rsf-pass-2', username: 'rsf_manager_two' }
const ACTION_LEAGUE = '3c100000-0000-4000-8000-000000000001'

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const DSTA = `${PREFIX}-dsta`
const DSTB = `${PREFIX}-dstb`
const PLAYERS = [
  { id: WR1, full_name: 'RSF Receiver One', position: 'WR', team: 'RSA', status: 'Active' },
  { id: WR2, full_name: 'RSF Receiver Two', position: 'WR', team: 'RSB', status: 'Active' },
  { id: DSTA, full_name: 'RSF Defense A', position: 'DEF', team: 'RSA', status: 'Active' },
  { id: DSTB, full_name: 'RSF Defense B', position: 'DEF', team: 'RSB', status: 'Active' },
]

/** The calendar (literals). Week 1's window ends at week 2's first kickoff (158). */
const WEEK1 = { starts: '2093-09-10T04:00:00.000Z', kickoff: '2093-09-12T00:15:00.000Z', lastEnd: '2093-09-16T04:00:00.000Z', defaultClose: '2093-09-18T10:00:00.000Z' }
const WEEK2 = { starts: '2093-09-17T04:00:00.000Z', kickoff: '2093-09-19T00:15:00.000Z', defaultClose: '2093-09-25T10:00:00.000Z' }
const STAMP_LIVE = '2093-09-13T20:00:00.000Z'
const REINGEST = '2093-09-29T12:00:00.000Z'
const LATE = '2093-09-30T12:00:00.000Z'

/**
 * ESPN Standard, hand-computed: a WR scores 0.1 / receiving yard; a D/ST that
 * allows 20 points scores 0 (18–27), 0–99 yards allowed +5, 350–399 −1,
 * 100–199 +3. First scored with yards 0 ⇒ One 10 + 5 = 15, Two 9 + 5 = 14.
 * With the real yards (381 / 180) ⇒ One 10 − 1 = 9, Two 9 + 3 = 12: the flip.
 */
const RULING = 'Chris (product owner), 2026-09-29: "re-score weeks 1 and 2 with the actual yards" — D/ST yards allowed were missing (read as 0) when the weeks were first scored'
const WHY = 'defense yards allowed were missing when it was first scored'

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
    // commissioner_actions / admin_rescore_actions / league_week_player_points ride the cascades (123's immutability trigger exempts exactly that arm).
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
  await deleteUserByUsername(MANAGER.username)
}

let leagueId: string
let t1: string
let t2: string
let commishId: string
let managerId: string
let matchupId: string
let commishClient: SupabaseClient<Database>
let seq = 0

async function plant(lines: Record<string, Record<string, number>>, stamp: string): Promise<void> {
  const rows = Object.entries(lines).map(([player_id, columns]) => ({ player_id, season: SEASON, week: 1, stat_type: 'weekly', updated_at: stamp, advanced: {}, ...columns }))
  await must(service.from('player_stats').upsert(rows, { onConflict: 'player_id,season,week' }).select('player_id'), 'plant')
  await must(
    service
      .from('score_fanout')
      .upsert(rows.map((r) => ({ season: SEASON, week: 1, player_id: r.player_id, enqueued_at: stamp, deferred_until: null })), { onConflict: 'season,week,player_id', ignoreDuplicates: false })
      .select('player_id'),
    'enqueue',
  )
}

function drain() {
  return runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function scores(): Promise<string> {
  const m = await must(service.from('matchups').select('home_score, away_score, status, result').eq('id', matchupId).single(), 'matchup')
  return `${Number(m!.home_score).toFixed(2)}/${Number(m!.away_score).toFixed(2)} ${m!.status} ${m!.result ?? '-'}`
}

async function results(): Promise<string> {
  const rows = await must(service.from('team_week_results').select('team_id, points, h2h_result, is_final').eq('league_id', leagueId).eq('week', 1).order('team_id'), 'results')
  return (rows ?? []).map((r) => `${r.team_id === t1 ? 'One' : 'Two'}=${Number(r.points).toFixed(2)}:${r.h2h_result}:${r.is_final}`).sort().join(' ')
}

async function storedRows(): Promise<string> {
  const rows = await must(service.from('league_week_player_points').select('team_id, slot, points, source').eq('league_id', leagueId).eq('week', 1), 'stored rows')
  return (rows ?? []).map((r) => `${r.team_id === t1 ? 'One' : 'Two'}/${r.slot}=${Number(r.points).toFixed(2)}:${r.source}`).sort().join(' ')
}

async function ledger(): Promise<string> {
  const audit = await must(service.from('commissioner_actions').select('id').eq('league_id', leagueId).eq('action_type', 'rescore_final_week'), 'audit')
  const posts = await must(service.from('league_chat').select('id').eq('league_id', leagueId), 'posts')
  const notes = await must(service.from('notifications').select('id').eq('type', 'league_week_rescored').in('user_id', [commishId, managerId]), 'notifications')
  return `audit ${audit!.length} · posts ${posts!.length} · notifications ${notes!.length}`
}

function opts(over: Partial<RescoreOptions> = {}): RescoreOptions {
  return { season: SEASON, weeks: [1], apply: false, reason: RULING, memberNote: WHY, actorId: commishId, leagueIds: [leagueId], ...over }
}

function rescore(over: Partial<RescoreOptions> = {}, db: SupabaseClient<Database> = service) {
  return rescoreFinalWeeks({ db, time: clock, newActionId: () => `3c100000-0000-4000-8000-0000000001${String(++seq).padStart(2, '0')}` }, opts(over))
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
  await must(service.from('nfl_games').insert([{ id: `${PREFIX}-g1`, season: SEASON, week: 1, home_team: 'RSA', away_team: 'RSB', kickoff_at: WEEK1.kickoff, status: 'final' }]), 'nfl_games')
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

  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: 'RSF One',
    p_action_id: ACTION_LEAGUE,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  t2 = (await must(service.from('teams').insert({ owner_id: managerId, name: 'RSF Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  await must(service.from('league_members').insert({ league_id: leagueId, user_id: managerId, team_id: t2, role: 'manager', is_placeholder: false }), 'manager seat')
  // No bracket: this league's finalize runs 118's sync, and a bracket is not this suite's subject.
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json, playoff_teams: 0 }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  matchupId = (await must(
    service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id').single(),
    'matchup',
  ))!.id
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: t1, player_id: WR1 }, { league_id: leagueId, team_id: t1, player_id: DSTA },
    { league_id: leagueId, team_id: t2, player_id: WR2 }, { league_id: leagueId, team_id: t2, player_id: DSTB },
  ]), 'rosters')
  await must(service.from('team_lineups').insert([
    { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR1, 'dst:0': DSTA } },
    { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR2, 'dst:0': DSTB } },
  ]), 'lineups')

  // (1) PRE-143 SCORING: yards read 0 (the DEFAULT) — the phantom +5 — through the REAL worker.
  await plant({ [WR1]: { receiving_yards: 100 }, [WR2]: { receiving_yards: 90 }, [DSTA]: { def_points_allowed: 20, def_yards_allowed: 0 }, [DSTB]: { def_points_allowed: 20, def_yards_allowed: 0 } }, STAMP_LIVE)
  const batch = await drain()
  if (batch.written !== 1) throw new Error(`premise: the worker wrote ${batch.written} rows, expected 1 — ${JSON.stringify(batch.problems)}`)
  // (2) PRE-158: production scored weeks 1–2 before the per-player store existed — no rows (the week is open, so the lock allows it).
  await must(service.from('league_week_player_points').delete().eq('league_id', leagueId).eq('week', 1).select('slot'), 'the pre-158 state')
  // (3) The REAL advance + finalize: final at week 2's first kickoff.
  clock.advanceTo(new Date(WEEK1.lastEnd))
  if ((await service.rpc('league_week_advance', { p_now: WEEK1.lastEnd, p_league_id: leagueId })).error) throw new Error('advance')
  clock.advanceTo(new Date(WEEK2.kickoff))
  if ((await service.rpc('finalize_matchups', { p_now: WEEK2.kickoff, p_league_id: leagueId })).error) throw new Error('finalize')
  // (4) THE RE-INGEST (sync:reingest's effect): the real yards land; the worker consumes the deltas as week_final.
  clock.advanceTo(new Date(REINGEST))
  await plant({ [DSTA]: { def_points_allowed: 20, def_yards_allowed: 381 }, [DSTB]: { def_points_allowed: 20, def_yards_allowed: 180 } }, REINGEST)
  const after = await drain()
  if (after.written !== 0) throw new Error(`premise: the worker wrote ${after.written} rows into a final week`)
}, 60_000)

afterAll(cleanup)

describe('L.D3.13 — the ruled re-score of a final week, end to end (Chris 2026-09-29: "re-score weeks 1 and 2 with the actual yards")', () => {
  it('RS0 PREMISE — final as first scored (One 15.00 v Two 14.00, One wins), no per-player rows, the real yards now in player_stats', async () => {
    expect(await scores()).toBe('15.00/14.00 final home')
    expect(await results()).toBe('One=15.00:win:true Two=14.00:loss:true')
    expect(await storedRows()).toBe('')
    const yards = await must(service.from('player_stats').select('player_id, def_yards_allowed').in('player_id', [DSTA, DSTB]).eq('season', SEASON).order('player_id'), 'yards')
    expect(yards!.map((y) => y.def_yards_allowed)).toEqual([381, 180])
    expect(await ledger()).toBe('audit 0 · posts 0 · notifications 0')
  })

  it('RS1 the ordinary backfill’s dry run reports what production’s did: both teams unrecoverable, recomputed 9.00 / 12.00', async () => {
    const report = await backfillPlayerPoints({ db: service, time: clock }, { season: SEASON, apply: false, leagueIds: [leagueId] })
    expect(report.notable.map((c) => [c.team_id === t1 ? 'One' : 'Two', c.verdict, c.stored, c.recomputed]).sort()).toEqual([
      ['One', 'backfill_unrecoverable', [15], 9],
      ['Two', 'backfill_unrecoverable', [14], 12],
    ])
  })

  it('RS2 RETIRED (164 / F489): the dry run is refused BY NAME on the REAL 42501, naming the migration that would re-grant the door — and NOTHING is written', async () => {
    // PREMISE — the database's own answer to the service role, an all-NULL call (it runs no line of the door).
    const premise = await service.rpc('admin_rescore_final_week', {
      p_league_id: null, p_week: null, p_teams: null, p_reason: null, p_member_note: null, p_actor_id: null, p_action_id: null, p_dry_run: true,
    } as never)
    expect([premise.error?.code, premise.error?.message]).toEqual(['42501', 'permission denied for function admin_rescore_final_week'])
    await expect(rescore()).rejects.toThrow(`rescore refused: ${RETIRED_SENTENCE}`)
    expect(RETIRED_SENTENCE).toContain('GRANT EXECUTE ON FUNCTION public.admin_rescore_final_week(uuid, integer, jsonb, text, text, uuid, uuid, boolean) TO service_role')
    expect(await scores()).toBe('15.00/14.00 final home')
    expect(await results()).toBe('One=15.00:win:true Two=14.00:loss:true')
    expect(await storedRows()).toBe('')
    expect(await ledger()).toBe('audit 0 · posts 0 · notifications 0')
  })

  it('RS3 …and an --apply is refused the same way, before anything is read or written', async () => {
    await expect(rescore({ apply: true })).rejects.toThrow(`rescore refused: ${RETIRED_SENTENCE}`)
    expect(await scores()).toBe('15.00/14.00 final home')
    expect(await results()).toBe('One=15.00:win:true Two=14.00:loss:true')
    expect(await storedRows()).toBe('')
    expect(await ledger()).toBe('audit 0 · posts 0 · notifications 0')
  })

  it('RS8 the ordinary worker still skips the locked week: a later correction lands in player_stats, nothing in the league moves', async () => {
    clock.advanceTo(new Date(LATE))
    const rowsBefore = await storedRows()
    await plant({ [WR1]: { receiving_yards: 120 } }, LATE)
    const batch = await drain()
    expect(batch.written).toBe(0)
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    expect(await scores()).toBe('15.00/14.00 final home')
    expect(await storedRows()).toBe(rowsBefore)
  })

  it('RS9 PRE-161: the door missing (the REAL PostgREST answer) ⇒ refused BY NAME, nothing written', async () => {
    // The same credentials against a schema the local PostgREST serves that has no such function (graphql_public).
    const absent = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: 'graphql_public' as 'public' } })
    const premise = await absent.rpc('admin_rescore_final_week' as never, {} as never)
    expect((premise.error as { code?: string } | null)?.code).toBe('PGRST202')
    const pre161 = new Proxy(service, {
      get(target, prop, receiver) {
        if (prop === 'rpc') return (fn: string, args: Record<string, unknown>) => absent.rpc(fn as never, args as never)
        return Reflect.get(target, prop, receiver)
      },
    }) as SupabaseClient<Database>
    const before = await ledger()
    await expect(rescore({ apply: true }, pre161)).rejects.toThrow(`rescore refused: ${PRE_161_SENTENCE}`)
    expect(await ledger()).toBe(before)
    expect(await scores()).toBe('15.00/14.00 final home')
  })
})
