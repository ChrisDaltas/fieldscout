/**
 * trade-execution-db.test.ts — M5 L.D3.3 at the WIRE layer: trades going
 * through (migration 151) under REAL concurrency, as signed-in users over
 * PostgREST and as the job. pgTAP 099 pins the law DB-side (review, the
 * deadline, the game-lock wait, E47, the executor's checklist F413 — all at
 * fixed instants); this suite proves what one pgTAP session cannot:
 *
 *   1. two ACCEPTED trades naming the SAME player, executing concurrently
 *      (trade_review none — each accept executes in its own transaction): the
 *      league-row lock serializes them, exactly one goes through, the other
 *      is dead through E37 before its accept can run (refused by name), and
 *      the player is on exactly one roster (F413);
 *   2. a trade EXECUTING while the proposer DROPS one of its players (E8 —
 *      `roster_add_drop`, a real roster writer): whichever order the lock
 *      picks, exactly one of the two lands and exclusivity holds;
 *   3. two TICKS racing over one trade whose review just ended: it executes
 *      once — one `transactions` row, never two.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down. Calendar:
 * SYNTHETIC_SEASON (2099) and made-up NFL teams with no games, so the
 * game-day lock reads every player as unlocked (the roster-add-drop-db
 * shape) and the week-11 deadline is decades away. The local pg_cron
 * `trade-tick` job may run the due trade in (3) before this suite's own
 * ticks do; the assertions hold either way (executed at most once, exactly
 * one row). Fixed emails / usernames / action_ids + cleanup-first.
 * Action-id prefix `b7e` — this suite owns it (the D108(14) registry;
 * measured free 2026-09-28).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-trade-exec-league'

const COMMISH = { email: 'trade-exec-commish@fieldscout.test', password: 'pgtap-tx-pass-1', username: 'txe_commish' }
const MANAGER_A = { email: 'trade-exec-manager-a@fieldscout.test', password: 'pgtap-tx-pass-2', username: 'txe_manager_a' }
const MANAGER_B = { email: 'trade-exec-manager-b@fieldscout.test', password: 'pgtap-tx-pass-3', username: 'txe_manager_b' }
const MANAGER_C = { email: 'trade-exec-manager-c@fieldscout.test', password: 'pgtap-tx-pass-4', username: 'txe_manager_c' }

const PLAYERS = [
  { id: 'vitest-txe-1', full_name: 'Vitest TXE One', position: 'WR', team: 'VXA', status: 'Active' },
  { id: 'vitest-txe-2', full_name: 'Vitest TXE Two', position: 'RB', team: 'VXA', status: 'Active' },
  { id: 'vitest-txe-3', full_name: 'Vitest TXE Three', position: 'WR', team: 'VXA', status: 'Active' },
  { id: 'vitest-txe-4', full_name: 'Vitest TXE Four', position: 'RB', team: 'VXB', status: 'Active' },
  { id: 'vitest-txe-5', full_name: 'Vitest TXE Five', position: 'WR', team: 'VXB', status: 'Active' },
  { id: 'vitest-txe-6', full_name: 'Vitest TXE Six', position: 'RB', team: 'VXC', status: 'Active' },
  { id: 'vitest-txe-7', full_name: 'Vitest TXE Seven', position: 'WR', team: 'VXC', status: 'Active' },
] as const

const ACTION = {
  league: 'b7e00000-0000-4000-8000-000000000001',
  proposeT1: 'b7e00000-0000-4000-8000-000000000011',
  proposeT2: 'b7e00000-0000-4000-8000-000000000012',
  acceptT1: 'b7e00000-0000-4000-8000-000000000013',
  acceptT2: 'b7e00000-0000-4000-8000-000000000014',
  proposeT3: 'b7e00000-0000-4000-8000-000000000021',
  acceptT3: 'b7e00000-0000-4000-8000-000000000022',
  dropT3: 'b7e00000-0000-4000-8000-000000000023',
  proposeT4: 'b7e00000-0000-4000-8000-000000000031',
  acceptT4: 'b7e00000-0000-4000-8000-000000000032',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type RespondResult = { trade: { id: string; status: string }; execution: { outcome: string } | null }
type TickResult = { executed: number; failures: unknown[] }

let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let managerCClient: SupabaseClient<Database>
let leagueId: string
let teamAId: string
let teamBId: string
let teamCId: string

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
    // trades-db.test.ts's order: trades first (they reference teams with no
    // cascade), then the league graph; then PROGRESS F406's order for teams.
    for (const table of [
      'trade_actions',
      'trades',
      'transactions',
      'league_player_pool',
      'league_weeks',
      'league_rosters',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { data: teams, error: teamsReadError } = await service.from('teams').select('id').in('league_id', ids)
    if (teamsReadError) throw new Error(`cleanup teams read: ${teamsReadError.message}`)
    const teamIds = (teams ?? []).map((row) => row.id)
    const { error: detachError } = await service.from('teams').update({ league_id: null }).in('id', teamIds)
    if (detachError) throw new Error(`cleanup teams detach: ${detachError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
    const { error: teamsError } = await service.from('teams').delete().in('id', teamIds)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
  }
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER_A, MANAGER_B, MANAGER_C]) {
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

async function seatManager(userId: string, name: string): Promise<string> {
  const { data: team, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: userId, name, league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager', faab_balance: 100 })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

async function propose(actionId: string, toTeamId: string, give: string, get: string): Promise<string> {
  const { data, error } = await managerAClient.rpc('trade_propose', {
    p_league_id: leagueId,
    p_from_team_id: teamAId,
    p_to_team_id: toTeamId,
    p_items: [
      { player_id: give, from_team_id: teamAId },
      { player_id: get, from_team_id: toTeamId },
    ],
    p_action_id: actionId,
  })
  if (error) throw new Error(`trade_propose failed: ${error.message}`)
  return (data as unknown as RespondResult).trade.id
}

async function setReview(review: 'none' | 'commissioner', periodHours?: number): Promise<void> {
  const { data: league, error: readError } = await service.from('leagues').select('settings').eq('id', leagueId).single()
  if (readError) throw new Error(`leagues read: ${readError.message}`)
  const settings = { ...(league.settings as Record<string, Json>) }
  if (periodHours !== undefined) settings.trade_review_period_hours = periodHours
  const { error } = await service.from('leagues').update({ trade_review: review, settings }).eq('id', leagueId)
  if (error) throw new Error(`leagues trade_review: ${error.message}`)
}

async function tradeRow(id: string): Promise<{ status: string; status_reason: string | null }> {
  const { data, error } = await service.from('trades').select('status, status_reason').eq('id', id).single()
  if (error) throw new Error(`tradeRow: ${error.message}`)
  return data
}

async function holderOf(playerId: string): Promise<string[]> {
  const { data, error } = await service
    .from('league_rosters')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
  if (error) throw new Error(`holderOf: ${error.message}`)
  return (data ?? []).map((row) => row.team_id)
}

async function tradeTransactions(tradeId: string): Promise<number> {
  const { count, error } = await service
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('type', 'trade')
    .eq('payload->>trade_id', tradeId)
  if (error) throw new Error(`transactions count: ${error.message}`)
  return count ?? -1
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  const managerAId = await createUser(MANAGER_A)
  const managerBId = await createUser(MANAGER_B)
  const managerCId = await createUser(MANAGER_C)
  const commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)
  managerCClient = await signIn(MANAGER_C)

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

  teamAId = await seatManager(managerAId, 'TXE Manager A Team')
  teamBId = await seatManager(managerBId, 'TXE Manager B Team')
  teamCId = await seatManager(managerCId, 'TXE Manager C Team')

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service.from('league_rosters').insert([
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-txe-1', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-txe-2', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-txe-3', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-txe-4', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-txe-5', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamCId, player_id: 'vitest-txe-6', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamCId, player_id: 'vitest-txe-7', slot_key: 'bn' },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('trades going through under real concurrency (migration 151)', () => {
  it('two accepted trades naming the SAME player execute concurrently: exactly one goes through, the other dies by E37, the player is on one roster', async () => {
    await setReview('none')
    const t1 = await propose(ACTION.proposeT1, teamBId, 'vitest-txe-1', 'vitest-txe-4')
    const t2 = await propose(ACTION.proposeT2, teamCId, 'vitest-txe-1', 'vitest-txe-6')
    const [b, c] = await Promise.all([
      managerBClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t1, p_op: 'accept', p_action_id: ACTION.acceptT1 }),
      managerCClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t2, p_op: 'accept', p_action_id: ACTION.acceptT2 }),
    ])
    const landed = [b, c].filter((r) => r.error === null)
    const refused = [b, c].filter((r) => r.error !== null)
    expect(landed).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect((landed[0].data as unknown as RespondResult).execution?.outcome).toBe('complete')
    const winner = landed[0] === b ? teamBId : teamCId
    const winnerName = landed[0] === b ? 'TXE Manager B Team' : 'TXE Manager C Team'
    expect(refused[0].error?.code).toBe('P0001')
    expect(refused[0].error?.message).toBe(
      `trade_respond: this trade is already invalid (Vitest TXE One (vitest-txe-1) is no longer on TXE Manager A Team's roster — he moved to ${winnerName} (E37)) — only a proposed trade can be accepted`,
    )
    expect(await holderOf('vitest-txe-1')).toStrictEqual([winner])
    const [winnerTrade, loserTrade] = landed[0] === b ? [t1, t2] : [t2, t1]
    expect((await tradeRow(winnerTrade)).status).toBe('complete')
    expect((await tradeRow(loserTrade)).status).toBe('invalid')
    expect(await tradeTransactions(winnerTrade)).toBe(1)
    expect(await tradeTransactions(loserTrade)).toBe(0)
  })

  it('a trade executing while its proposer DROPS one of its players (E8): exactly one of the two lands, exclusivity holds either way', async () => {
    const t3 = await propose(ACTION.proposeT3, teamBId, 'vitest-txe-2', 'vitest-txe-5')
    const [accepted, dropped] = await Promise.all([
      managerBClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t3, p_op: 'accept', p_action_id: ACTION.acceptT3 }),
      managerAClient.rpc('roster_add_drop', { p_league_id: leagueId, p_team_id: teamAId, p_drop: 'vitest-txe-2', p_action_id: ACTION.dropT3 }),
    ])
    expect([accepted.error === null, dropped.error === null].filter(Boolean)).toHaveLength(1)
    if (accepted.error === null) {
      // The trade ran first: the player is Manager B's now, and Manager A's drop
      // of a player he no longer has is refused by name.
      expect((accepted.data as unknown as RespondResult).execution?.outcome).toBe('complete')
      expect(dropped.error?.code).toBe('P0001')
      expect(dropped.error?.message).toBe(
        "roster_add_drop: Vitest TXE Two (vitest-txe-2) is on TXE Manager B Team's roster, not TXE Manager A Team's — a manager drops only his own players (§13.1)",
      )
      expect(await holderOf('vitest-txe-2')).toStrictEqual([teamBId])
      expect(await holderOf('vitest-txe-5')).toStrictEqual([teamAId])
      expect(await tradeTransactions(t3)).toBe(1)
    } else {
      // The drop ran first: the trade died through E37 and the accept is refused.
      expect(accepted.error.code).toBe('P0001')
      expect(accepted.error.message).toMatch(
        /^trade_respond: this trade is already invalid \(Vitest TXE Two \(vitest-txe-2\) is no longer on TXE Manager A Team's roster — he was dropped \(E37\)\)/,
      )
      expect(await holderOf('vitest-txe-2')).toStrictEqual([])
      expect(await holderOf('vitest-txe-5')).toStrictEqual([teamBId])
      expect(await tradeTransactions(t3)).toBe(0)
    }
  })

  it('two TICKS race over a trade whose review just ended: it executes once — one transactions row', async () => {
    await setReview('commissioner', 0)
    const t4 = await propose(ACTION.proposeT4, teamCId, 'vitest-txe-3', 'vitest-txe-7')
    const { data: acceptData, error: acceptError } = await managerCClient.rpc('trade_respond', {
      p_league_id: leagueId,
      p_trade_id: t4,
      p_op: 'accept',
      p_action_id: ACTION.acceptT4,
    })
    expect(acceptError).toBeNull()
    expect((acceptData as unknown as RespondResult).trade.status).toBe('in_review')

    const tick = () => service.rpc('trade_tick', { p_league_id: leagueId })
    const [x, y] = await Promise.all([tick(), tick()])
    expect(x.error).toBeNull()
    expect(y.error).toBeNull()
    const results = [x.data, y.data] as unknown as TickResult[]
    expect(results.every((r) => r.failures.length === 0)).toBe(true)
    // At most once between our two ticks (the local pg_cron trade-tick may
    // have run it first — then both of ours find nothing due).
    expect(results.reduce((sum, r) => sum + r.executed, 0)).toBeLessThanOrEqual(1)
    expect((await tradeRow(t4)).status).toBe('complete')
    expect(await tradeTransactions(t4)).toBe(1)
    expect(await holderOf('vitest-txe-3')).toStrictEqual([teamCId])
    expect(await holderOf('vitest-txe-7')).toStrictEqual([teamAId])
  })
})
