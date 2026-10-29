/**
 * league-archive-scoring-db.test.ts — F716 / migration 212 over the REAL
 * stack: the scoring fan-out (the TS worker, `runScoreWeekBatch`) skips an
 * ARCHIVED league, the database refuses a score written into one anyway, and
 * the restore re-queues the league's scoring so the week it missed is scored
 * by the normal path (D782). pgTAP 162 proves every SQL job; this is the one
 * job that runs in TypeScript.
 *
 * World (SYNTHETIC_SEASON 2099 — no wall clock; every instant a literal): one
 * h2h league, two teams, week 1 live, one matchup T1 v T2; T1 starts a QB
 * whose line is planted and queued exactly as ingestion leaves it
 * (ESPN Standard: 250 pass yards + 2 TD = 18.00).
 *
 *   1. ARCHIVED — a drain scoped to the league maps the QB to NO league (the
 *      roster read keeps `leagues.deleted_at IS NULL`); the matchup keeps its
 *      score (0, the row default); no door call is made for it.
 *   2. THE BACKSTOP — the door itself (`score_write_week_batch`, service
 *      role) refuses the archived league by name (212's freeze, 55000).
 *   3. RESTORED — the restore re-queues the QB's week (the stamp = his
 *      line's own `updated_at`, so the worker reads him as landed) and the
 *      next drain scores 18.00 into the matchup.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down. Fixture
 * prefix `vitest-arch`; action-id prefix `afa` (D108(14) registry: measured
 * free 2026-10-27).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { archiveLeague, restoreLeague } from '../api/league-archive-service'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { type ScoreWorkerClient, runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-arch'
const SEASON = SYNTHETIC_SEASON
const COMMISH = { email: 'archive-scoring-commish@fieldscout.test', password: 'pgtap-arch-pass-1', username: 'arch_commish_one' }
const ACTION = 'afa00000-0000-4000-8000-000000000001'
const QB = `${PREFIX}-qb`
const STAMP = '2099-09-13T20:00:00.000Z'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(new Date('2099-09-13T20:00:05.000Z'))

/** Every `score_write_week_batch` call the worker makes, by league. */
const doorCalls: string[] = []
const countingDb = new Proxy(service, {
  get(target, prop, receiver) {
    if (prop === 'rpc') {
      return (fn: string, args: Record<string, unknown>) => {
        if (fn === 'score_write_week_batch') doorCalls.push(args.p_league_id as string)
        return target.rpc(fn as never, args as never)
      }
    }
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as unknown as ScoreWorkerClient

let commishClient: SupabaseClient<Database>
let commishId: string
let leagueId: string
let t1: string
let t2: string

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
    // 212: an archived league's rows refuse every write — bring it back first
    // (the restore-shaped update is the one write its row accepts).
    await must(service.from('leagues').update({ deleted_at: null, archived_by: null }).in('id', ids), 'cleanup un-archive')
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['team_week_results', 'matchups', 'league_week_player_points', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    // F406's order: detach the teams, delete the league (its receipts go with
    // it — the immutable log's CASCADE), then the teams.
    await must(service.from('teams').update({ league_id: null }).in('id', teamIds), 'cleanup teams detach')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
    if (teamIds.length > 0) await must(service.from('teams').delete().in('id', teamIds), 'cleanup teams')
  }
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

async function homeScore(): Promise<number | null> {
  const rows = await must(service.from('matchups').select('home_score').eq('league_id', leagueId).eq('week', 1), 'matchup read')
  return rows?.[0]?.home_score ?? null
}

async function queued(): Promise<Array<{ player_id: string; enqueued_at: string }>> {
  const rows = await must(service.from('score_fanout').select('player_id, enqueued_at').eq('player_id', QB).eq('season', SEASON), 'queue read')
  return (rows ?? []).map((r) => ({ player_id: r.player_id, enqueued_at: new Date(r.enqueued_at).toISOString() }))
}

function drain() {
  doorCalls.length = 0
  return runScoreWeekBatch({ time: clock, db: countingDb }, { batchSize: 1000, leagueIds: [leagueId] })
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (createError) throw new Error(`createUser: ${createError.message}`)
  commishId = created.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword(COMMISH)
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)

  await must(service.from('players').upsert([{ id: QB, full_name: 'Arch QB', position: 'QB', team: 'SWA', status: 'Active' }]).select('id'), 'players')

  const { data: espn } = await service.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-h2h`,
    p_season: SEASON,
    p_scoring_system_id: espn?.id,
    p_team_name: 'Arch One',
    p_action_id: ACTION,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'commish team'))!.id
  t2 = (await must(service.from('teams').insert({ owner_id: commishId, name: 'Arch Two', league_id: leagueId }).select('id').single(), 'second team'))!.id
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: espn?.rules as Json }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week: 1 }), 'week 1')
  await must(service.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', 1), 'week 1 → live')
  await must(
    service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, home_team_id: t1, away_team_id: t2, round_type: 'regular', status: 'live' }).select('id'),
    'matchup',
  )
  await must(service.from('league_rosters').insert({ league_id: leagueId, team_id: t1, player_id: QB }), 'roster')
  await must(service.from('team_lineups').insert({ team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { qb: QB } }), 'lineup')
  await must(
    service
      .from('player_stats')
      .upsert({ player_id: QB, season: SEASON, week: 1, stat_type: 'weekly', updated_at: STAMP, advanced: {}, pass_yards: 250, pass_tds: 2 }, { onConflict: 'player_id,season,week' })
      .select('player_id'),
    'stat line',
  )
  await must(
    service.from('score_fanout').upsert([{ season: SEASON, week: 1, player_id: QB, enqueued_at: STAMP, deferred_until: null }], { onConflict: 'season,week,player_id' }).select('player_id'),
    'enqueue',
  )
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('F716 — the scoring fan-out skips an archived league; restore catches it up', () => {
  it('1. ARCHIVED: the worker maps the player to no league, writes nothing for it, and the score stays where it was', async () => {
    const archived = await archiveLeague(commishClient, leagueId, {})
    expect(archived.status).toBe(200)
    expect(archived.body).toMatchObject({ changed: true, archived: true })

    const report = await drain()
    expect(doorCalls).toEqual([])
    expect(report.leagues.some((l) => l.league_id === leagueId)).toBe(false)
    expect(await homeScore()).toBe(0) // where it was: the row's default, untouched
    // The scoped drain consumes only what it scores — the row is still there.
    expect(await queued()).toEqual([{ player_id: QB, enqueued_at: STAMP }])
  })

  it('2. THE BACKSTOP: the scoring door refuses a write into the archived league by name', async () => {
    // The door reads an archived league as not found (its own deleted_at
    // check — 212 repurposed that stamp); the freeze trigger stands behind it.
    const { error } = await service.rpc('score_write_week_batch', {
      p_league_id: leagueId,
      p_week: 1,
      p_scores: [{ team_id: t1, points: 99 }],
    })
    expect(error?.message).toBe(`score_write_week_batch: league ${leagueId} not found`)
    expect(await homeScore()).toBe(0) // where it was: the row's default, untouched
    // …and a direct write is refused by the freeze itself.
    const { error: direct } = await service.from('matchups').update({ home_score: 99 }).eq('league_id', leagueId).select('id')
    expect(direct?.code).toBe('55000')
    expect(direct?.message).toMatch(/^This league is archived/)
    expect(await homeScore()).toBe(0) // where it was: the row's default, untouched
  })

  it('3. RESTORED: the week is re-queued at its line’s own stamp and the next drain scores it (18.00)', async () => {
    // What the production (unscoped) drain does with a row no live league
    // rosters while this one is archived: consumes it (`unmapped` — pinned in
    // score-week-worker-db). Done here by hand so the restore's re-queue is
    // what brings the row back.
    await must(service.from('score_fanout').delete().eq('player_id', QB).select('player_id'), 'consume the row')
    expect(await queued()).toEqual([])

    const restored = await restoreLeague(commishClient, leagueId, {})
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ changed: true, archived: false, scores_requeued: 1 })
    expect(await queued()).toEqual([{ player_id: QB, enqueued_at: STAMP }])

    const report = await drain()
    expect(doorCalls).toEqual([leagueId])
    expect(report.leagues.find((l) => l.league_id === leagueId && l.week === 1)?.outcome).not.toBe('failed')
    expect(await homeScore()).toBe(18)
    expect(await queued()).toEqual([])
  })
})
