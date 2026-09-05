/**
 * week-workers-db.test.ts — L.D1.6 item 6: a FULL VIRTUAL WEEK driven by
 * `p_now` injection over the real stack — open → lock → close → finalize —
 * through the three job RPCs migration 116 puts on pg_cron
 * (`league_week_advance`, `lineup_lock_tick`, `finalize_matchups`; spec
 * v2.16.21 §14 / §11.2 / §11.4 / §11.7 / §23.2 / §23.3; PROGRESS D291 /
 * D293 / D295 / D313). pgTAP 064 pins the law DB-side at injected instants
 * with the goldens; this suite proves the wire shape: the service role
 * drives the jobs with a virtual instant and ONE league scope (the D313
 * harness seam — production cron passes nothing), a real manager edits the
 * AUTO-CARRIED row through `set_lineup` (114's `ON CONFLICT DO NOTHING` +
 * `FOR UPDATE` finds it), a signed-in user cannot call a job at all, and
 * the finalized week refuses a lineup edit (the F4 chain seen by a client).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/R724/F226 — every fixture that evaluates an instant owns
 * its calendar and reads NO wall clock): the league lives on
 * `SYNTHETIC_SEASON` (2099); every `p_now` below is a fixed 2099 literal;
 * the one `nfl_games` row is this suite's own (deleted in cleanup) and the
 * week-1 `last_game_ends_at` stamp this suite writes is RESTORED to NULL in
 * cleanup (the seeded rows are shared reference data and never cleaned —
 * `synthetic-season.ts`). `set_lineup` reads transaction `now()`, which lies
 * before every 2099 kickoff for the life of this repository.
 *
 * SCOPE: every job call passes `p_league_id` — the jobs would otherwise walk
 * every in-season league on the shared stack and flip OTHER suites' weeks
 * (their `scheduled` matchups, their `league_weeks`) mid-run (D313). The
 * unscoped production shape is pgTAP 064's subject.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**`). Action-id prefix `af9` — this
 * suite owns it (the D108(14) registry: af0–af8 taken; af9 measured free
 * 2026-09-05).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-week-workers-league'
const GAME_ID = 'vitest-ww-g1'
const TEAM_HOME = 'VWA'
const TEAM_AWAY = 'VWB'

/** The synthetic season's week 1 (synthetic-season.ts: Wed 2099-09-09 00:00 ET). */
const WEEK1_STARTS = '2099-09-09T04:00:00.000Z'
const KICKOFF = '2099-09-10T00:15:00.000Z'
const KICKOFF_PLUS_1S = '2099-09-10T00:15:01.000Z'
const KICKOFF_FLEXED = '2099-09-10T01:15:00.000Z'
const LAST_GAME_ENDS = '2099-09-14T04:00:00.000Z'
/** synthetic-season.ts: the following Thursday 06:00 ET = start + 8d 6h. */
const WINDOW_CLOSES = '2099-09-17T10:00:00.000Z'
const WINDOW_MINUS_1S = '2099-09-17T09:59:59.000Z'

const COMMISH = {
  email: 'week-workers-commish@fieldscout.test',
  password: 'pgtap-ww-pass-1',
  username: 'ww_commish_one',
}
const MANAGER = {
  email: 'week-workers-manager@fieldscout.test',
  password: 'pgtap-ww-pass-2',
  username: 'ww_manager_two',
}

const PLAYERS = [
  { id: 'vitest-ww-qb', full_name: 'Vitest WW QB', position: 'QB', team: TEAM_HOME, status: 'Active' },
  { id: 'vitest-ww-rb', full_name: 'Vitest WW RB', position: 'RB', team: 'VWC', status: 'Active' },
  { id: 'vitest-ww-fa', full_name: 'Vitest WW FA', position: 'WR', team: TEAM_AWAY, status: 'Active' },
] as const
const qb = 'vitest-ww-qb'
const rb = 'vitest-ww-rb'
const fa = 'vitest-ww-fa'

const ACTION = {
  league: 'af900000-0000-4000-8000-000000000001',
  set1: 'af900000-0000-4000-8000-000000000011',
  setFinal: 'af900000-0000-4000-8000-000000000012',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type JobReport = Record<string, unknown> & {
  leagues: number
  reason: string | null
  failures: unknown[]
}

let commishClient: SupabaseClient<Database>
let managerClient: SupabaseClient<Database>
let managerId: string
let commishId: string
let leagueId: string
let managerTeamId: string
let teamIds: string[] = []

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const tIds = (teams ?? []).map((t) => t.id)
    if (tIds.length > 0) {
      const { error } = await service.from('team_lineups').delete().in('team_id', tIds)
      if (error) throw new Error(`cleanup team_lineups: ${error.message}`)
    }
    // The learned order (D306(6)): results + matchups + weeks before teams.
    for (const table of [
      'team_week_results',
      'matchups',
      'league_weeks',
      'league_player_pool',
      'league_rosters',
      'league_chat',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: gamesError } = await service.from('nfl_games').delete().eq('id', GAME_ID)
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  // The shared week-1 row: the stamp this suite writes goes back to NULL.
  const { error: weekError } = await service
    .from('nfl_weeks')
    .update({ last_game_ends_at: null })
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', 1)
  if (weekError) throw new Error(`cleanup nfl_weeks: ${weekError.message}`)
  for (const u of [COMMISH, MANAGER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function job(
  name: 'league_week_advance' | 'lineup_lock_tick' | 'finalize_matchups',
  at: string,
): Promise<JobReport> {
  const { data, error } = await service.rpc(name, { p_now: at, p_league_id: leagueId })
  if (error) throw new Error(`${name}(${at}): ${error.message}`)
  return data as unknown as JobReport
}

async function weekStatus(): Promise<string> {
  const { data, error } = await service
    .from('league_weeks')
    .select('status')
    .eq('league_id', leagueId)
    .eq('week', 1)
    .single()
  if (error) throw new Error(`weekStatus: ${error.message}`)
  return data.status
}

async function poolRow(): Promise<{ state: string; locked_until: string | null }> {
  const { data, error } = await service
    .from('league_player_pool')
    .select('state, locked_until')
    .eq('league_id', leagueId)
    .eq('player_id', fa)
    .single()
  if (error) throw new Error(`poolRow: ${error.message}`)
  return data
}

async function managerLineup(): Promise<{ slot_map: unknown; locked_at: string | null; set_at: string | null }> {
  const { data, error } = await service
    .from('team_lineups')
    .select('slot_map, locked_at, set_at')
    .eq('team_id', managerTeamId)
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', 1)
    .single()
  if (error) throw new Error(`managerLineup: ${error.message}`)
  return data
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Eight seats: the commissioner's (create_league made it) + the manager's
  // + six more commissioner-owned fixtures (service role — fixtures only).
  const { data: commishTeam, error: commishTeamError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .single()
  if (commishTeamError) throw new Error(`commissioner team: ${commishTeamError.message}`)
  const { data: manager, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  managerTeamId = manager.id
  const { data: extra, error: extraError } = await service
    .from('teams')
    .insert(
      Array.from({ length: 6 }, (_, i) => ({ owner_id: commishId, name: `Seat ${i + 3}`, league_id: leagueId })),
    )
    .select('id')
  if (extraError) throw new Error(`teams insert (extra): ${extraError.message}`)
  teamIds = [commishTeam.id, managerTeamId, ...(extra ?? []).map((t) => t.id)]
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: managerId, team_id: managerTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  // Four week-1 matchups over the eight seats; scores as the door would
  // have left them at the window close (the manager's team wins 100–90).
  const scores: Array<[number, number]> = [
    [100.0, 90.0],
    [80.25, 80.25],
    [70.0, 75.5],
    [60.0, 50.0],
  ]
  const { error: matchupsError } = await service.from('matchups').insert(
    scores.map(([home, away], i) => ({
      league_id: leagueId,
      season: SYNTHETIC_SEASON,
      week: 1,
      round_type: 'regular',
      home_team_id: teamIds[i * 2 + 1],
      away_team_id: teamIds[i * 2],
      home_score: home,
      away_score: away,
      status: 'scheduled',
    })),
  )
  if (matchupsError) throw new Error(`matchups insert: ${matchupsError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service.from('league_rosters').insert([
    { league_id: leagueId, team_id: managerTeamId, player_id: qb },
    { league_id: leagueId, team_id: managerTeamId, player_id: rb },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
  const { error: poolError } = await service
    .from('league_player_pool')
    .insert({ league_id: leagueId, player_id: fa, state: 'free_agent' })
  if (poolError) throw new Error(`league_player_pool insert: ${poolError.message}`)
  const { error: gameError } = await service.from('nfl_games').insert({
    id: GAME_ID,
    season: SYNTHETIC_SEASON,
    week: 1,
    home_team: TEAM_HOME,
    away_team: TEAM_AWAY,
    kickoff_at: KICKOFF,
    status: 'scheduled',
  })
  if (gameError) throw new Error(`nfl_games insert: ${gameError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('a full virtual week over the real stack — open → lock → close → finalize', () => {
  it('a signed-in user cannot call a job RPC at all (EXECUTE revoked — 42501 on the wire)', async () => {
    const { error } = await managerClient.rpc('lineup_lock_tick', { p_now: WEEK1_STARTS, p_league_id: leagueId })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('OPEN: starts_at −1s does nothing, AT opens week 1, flips matchups live and materializes eight carried rows', async () => {
    const before = await job('league_week_advance', '2099-09-09T03:59:59.000Z')
    expect(before.opened).toBe(0)
    expect(before.reason).toBe('nothing_due')
    expect(await weekStatus()).toBe('upcoming')

    const at = await job('league_week_advance', WEEK1_STARTS)
    expect(at.failures).toEqual([])
    expect(at.opened).toBe(1)
    expect(at.matchups_live).toBe(4)
    expect(at.carried).toBe(8)
    expect(await weekStatus()).toBe('live')

    const { count } = await service
      .from('team_lineups')
      .select('id', { count: 'exact', head: true })
      .in('team_id', teamIds)
      .eq('week', 1)
    expect(count).toBe(8)
    const row = await managerLineup()
    expect(row.slot_map).toEqual({})
    expect(row.locked_at).toBeNull()
    expect(row.set_at).toBe('2099-09-09T04:00:00+00:00')

    const again = await job('league_week_advance', WEEK1_STARTS)
    expect(Number(again.opened) + Number(again.carried)).toBe(0)
    expect(again.reason).toBe('nothing_due')
  })

  it('the manager edits the AUTO-CARRIED row through set_lineup as a real user (114 finds it on first touch)', async () => {
    const { data, error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: { 'qb:0': qb, 'rb:0': rb },
      p_action_id: ACTION.set1,
    })
    expect(error).toBeNull()
    const result = data as { no_changes: boolean; locked_at: string | null }
    expect(result.no_changes).toBe(false)
    expect(result.locked_at).toBe('2099-09-10T00:15:00+00:00')
    const row = await managerLineup()
    expect(row.slot_map).toEqual({ 'qb:0': qb, 'rb:0': rb })
    const { count } = await service
      .from('team_lineups')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', managerTeamId)
      .eq('week', 1)
    expect(count).toBe(1)
  })

  it('LOCK: kickoff +1s locks the free agent until INFINITY (no recorded last game end — F238 loud), the record is already stamped; a flexed kickoff moves both (E42)', async () => {
    const tick = await job('lineup_lock_tick', KICKOFF_PLUS_1S)
    expect(tick.failures).toEqual([])
    expect(tick.pool_updates).toBe(1)
    expect(tick.lineup_updates).toBe(0) // set_lineup already recorded the kickoff — agreement, not a rewrite
    expect(await poolRow()).toEqual({ state: 'locked_in_game', locked_until: 'infinity' })

    const again = await job('lineup_lock_tick', KICKOFF_PLUS_1S)
    expect(Number(again.pool_updates) + Number(again.lineup_updates)).toBe(0)
    expect(again.reason).toBe('no_changes')

    const { error: flexError } = await service.from('nfl_games').update({ kickoff_at: KICKOFF_FLEXED }).eq('id', GAME_ID)
    if (flexError) throw new Error(flexError.message)
    const flexed = await job('lineup_lock_tick', KICKOFF_PLUS_1S)
    expect(flexed.pool_updates).toBe(1)
    expect(flexed.lineup_updates).toBe(1)
    expect(await poolRow()).toEqual({ state: 'free_agent', locked_until: null })
    expect((await managerLineup()).locked_at).toBe('2099-09-10T01:15:00+00:00')

    const { error: backError } = await service.from('nfl_games').update({ kickoff_at: KICKOFF }).eq('id', GAME_ID)
    if (backError) throw new Error(backError.message)
    const back = await job('lineup_lock_tick', KICKOFF_PLUS_1S)
    expect(back.pool_updates).toBe(1)
    expect(back.lineup_updates).toBe(1)
    expect((await managerLineup()).locked_at).toBe('2099-09-10T00:15:00+00:00')
  })

  it('CLOSE: the game goes final and ingestion records the last game end — the week closes AT the stamp and the pool releases', async () => {
    const { error: finalError } = await service.from('nfl_games').update({ status: 'final' }).eq('id', GAME_ID)
    if (finalError) throw new Error(finalError.message)
    const { error: stampError } = await service
      .from('nfl_weeks')
      .update({ last_game_ends_at: LAST_GAME_ENDS })
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', 1)
    if (stampError) throw new Error(stampError.message)

    const before = await job('league_week_advance', '2099-09-14T03:59:59.000Z')
    expect(before.closed).toBe(0)
    expect(await weekStatus()).toBe('live')
    const at = await job('league_week_advance', LAST_GAME_ENDS)
    expect(at.closed).toBe(1)
    expect(await weekStatus()).toBe('correction_window')

    const tick = await job('lineup_lock_tick', LAST_GAME_ENDS)
    expect(tick.pool_updates).toBe(1)
    expect(await poolRow()).toEqual({ state: 'free_agent', locked_until: null })
  })

  it('FINALIZE: window −1s does nothing; AT writes results + eight team_week_results and flips the week final; a re-run writes nothing', async () => {
    const before = await job('finalize_matchups', WINDOW_MINUS_1S)
    expect(before.finalized).toBe(0)
    expect(before.reason).toBe('nothing_due')

    const at = await job('finalize_matchups', WINDOW_CLOSES)
    expect(at.failures).toEqual([])
    expect(at.finalized).toBe(1)
    expect(await weekStatus()).toBe('final')

    const { data: results, error } = await service
      .from('team_week_results')
      .select('team_id, points, h2h_result, is_final')
      .eq('league_id', leagueId)
      .eq('week', 1)
    if (error) throw new Error(error.message)
    expect(results).toHaveLength(8)
    expect(results?.every((r) => r.is_final)).toBe(true)
    const mine = results?.find((r) => r.team_id === managerTeamId)
    expect(mine?.points).toBe(100)
    expect(mine?.h2h_result).toBe('win')
    const tied = results?.filter((r) => r.h2h_result === 'tie')
    expect(tied).toHaveLength(2) // 80.25 v 80.25 — a two-decimal tie is a tie (E38)

    const { data: matchups } = await service
      .from('matchups')
      .select('status, result')
      .eq('league_id', leagueId)
      .eq('week', 1)
    expect(matchups?.every((m) => m.status === 'final')).toBe(true)
    expect(matchups?.map((m) => m.result).sort()).toEqual(['away', 'home', 'home', 'tie'])

    const again = await job('finalize_matchups', WINDOW_CLOSES)
    expect(again.finalized).toBe(0)
    expect(again.reason).toBe('nothing_due')
  })

  it('a finalized week refuses a lineup edit from the manager (the F4 chain as a client sees it)', async () => {
    const { error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: { 'qb:0': qb },
      p_action_id: ACTION.setFinal,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('is final')
  })
})
