/**
 * trades-db.test.ts — M5 L.D3.2 at the WIRE layer: the trade verbs
 * (migration 148) under REAL concurrency, as signed-in users over PostgREST.
 * pgTAP 096 pins the law DB-side (refusals by name, E36, exclusivity, the
 * commissioner arm, RLS per role, the E37 trigger through two real roster
 * writers); this suite proves what a single-session pgTAP file cannot:
 *
 *   1. two ACCEPTS of the same offer racing (different action_ids) — the
 *      league-row lock serializes them: exactly one lands, the other gets the
 *      by-name P0001 ("already accepted"), and one accept is on the ledger;
 *   2. two accepts racing under the SAME action_id — one write, both answers
 *      byte-identical;
 *   3. an ACCEPT racing the proposer's own DROP of a player in the trade
 *      (`roster_add_drop`, 115 — a real roster writer): whichever order the
 *      lock picks, the drop lands, the trade ends `invalid` with the E37
 *      reason (an accept that ran first is invalidated by the drop; an accept
 *      that ran second is refused by name), every other in-flight trade
 *      naming that player goes invalid too, and exclusivity holds — no
 *      player changed teams (the league reviews trades — the §7.3.5 default —
 *      so nothing executes before the review ends; migration 151 re-cut the
 *      accepted status to in_review).
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down. Calendar:
 * the league is on SYNTHETIC_SEASON (2099) and the players are on made-up
 * NFL teams with no games, so the drop verb's game-day lock reads them as
 * unlocked (the roster-add-drop-db shape). Fixed emails / usernames /
 * action_ids + cleanup-first. Action-id prefix `b7d` — this suite owns it
 * (the D108(14) registry; measured free 2026-09-28).
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

const LEAGUE_NAME = 'vitest-trades-league'

const COMMISH = { email: 'trades-commish@fieldscout.test', password: 'pgtap-tr-pass-1', username: 'trd_commish' }
const MANAGER_A = { email: 'trades-manager-a@fieldscout.test', password: 'pgtap-tr-pass-2', username: 'trd_manager_a' }
const MANAGER_B = { email: 'trades-manager-b@fieldscout.test', password: 'pgtap-tr-pass-3', username: 'trd_manager_b' }

const PLAYERS = [
  { id: 'vitest-tr-1', full_name: 'Vitest TR One', position: 'WR', team: 'VTA', status: 'Active' },
  { id: 'vitest-tr-2', full_name: 'Vitest TR Two', position: 'RB', team: 'VTA', status: 'Active' },
  { id: 'vitest-tr-3', full_name: 'Vitest TR Three', position: 'WR', team: 'VTB', status: 'Active' },
  { id: 'vitest-tr-4', full_name: 'Vitest TR Four', position: 'RB', team: 'VTB', status: 'Active' },
] as const

const ACTION = {
  league: 'b7d00000-0000-4000-8000-000000000001',
  proposeT1: 'b7d00000-0000-4000-8000-000000000011',
  acceptT1a: 'b7d00000-0000-4000-8000-000000000012',
  acceptT1b: 'b7d00000-0000-4000-8000-000000000013',
  proposeT2: 'b7d00000-0000-4000-8000-000000000021',
  acceptT2: 'b7d00000-0000-4000-8000-000000000022',
  proposeT3: 'b7d00000-0000-4000-8000-000000000031',
  acceptT3: 'b7d00000-0000-4000-8000-000000000032',
  dropP1: 'b7d00000-0000-4000-8000-000000000033',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type TradeResult = { verb: string; op?: string; trade: { id: string; status: string } }

let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let leagueId: string
let teamAId: string
let teamBId: string
let managerAId: string
let managerBId: string

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
    // Trades first (they reference teams with no cascade), then the league
    // graph; then PROGRESS F406's order for the teams (detach, delete the
    // league, then the teams).
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
  for (const u of [COMMISH, MANAGER_A, MANAGER_B]) {
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

async function propose(actionId: string, give: string, get: string): Promise<string> {
  const { data, error } = await managerAClient.rpc('trade_propose', {
    p_league_id: leagueId,
    p_from_team_id: teamAId,
    p_to_team_id: teamBId,
    p_items: [
      { player_id: give, from_team_id: teamAId },
      { player_id: get, from_team_id: teamBId },
    ],
    p_action_id: actionId,
  })
  if (error) throw new Error(`trade_propose failed: ${error.message}`)
  return (data as unknown as TradeResult).trade.id
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

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  managerAId = await createUser(MANAGER_A)
  managerBId = await createUser(MANAGER_B)
  const commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)

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

  teamAId = await seatManager(managerAId, 'TRD Manager A Team')
  teamBId = await seatManager(managerBId, 'TRD Manager B Team')

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
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-tr-1', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-tr-2', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-tr-3', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-tr-4', slot_key: 'bn' },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('trade verbs over PostgREST under real concurrency (migration 148)', () => {
  let t1: string

  it('two ACCEPTS of one offer race: exactly one lands, the other is refused by name, one accept on the ledger', async () => {
    t1 = await propose(ACTION.proposeT1, 'vitest-tr-1', 'vitest-tr-3')
    const accept = (actionId: string) =>
      managerBClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t1, p_op: 'accept', p_action_id: actionId })
    const [a, b] = await Promise.all([accept(ACTION.acceptT1a), accept(ACTION.acceptT1b)])
    const landed = [a, b].filter((r) => r.error === null)
    const refused = [a, b].filter((r) => r.error !== null)
    expect(landed).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0].error?.code).toBe('P0001')
    expect(refused[0].error?.message).toBe(
      'trade_respond: this trade is already in_review (no reason recorded) — only a proposed trade can be accepted',
    )
    // The league reviews trades (the §7.3.5 default, commissioner), so an
    // accepted offer is in review — migration 151 (L.D3.3).
    expect((landed[0].data as unknown as TradeResult).trade.status).toBe('in_review')
    expect((await tradeRow(t1)).status).toBe('in_review')
    const { count } = await service
      .from('trade_actions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .in('action_id', [ACTION.acceptT1a, ACTION.acceptT1b])
    expect(count).toBe(1)
  })

  it('two accepts race under the SAME action_id: one write, both answers byte-identical', async () => {
    const t2 = await propose(ACTION.proposeT2, 'vitest-tr-2', 'vitest-tr-4')
    const accept = () =>
      managerBClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t2, p_op: 'accept', p_action_id: ACTION.acceptT2 })
    const [a, b] = await Promise.all([accept(), accept()])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data))
    expect((await tradeRow(t2)).status).toBe('in_review')
  })

  it("an ACCEPT racing the proposer's DROP of a traded player: the drop lands, the trade ends invalid (E37) either way, and no player changed teams", async () => {
    const t3 = await propose(ACTION.proposeT3, 'vitest-tr-1', 'vitest-tr-4')
    const [accepted, dropped] = await Promise.all([
      managerBClient.rpc('trade_respond', { p_league_id: leagueId, p_trade_id: t3, p_op: 'accept', p_action_id: ACTION.acceptT3 }),
      managerAClient.rpc('roster_add_drop', { p_league_id: leagueId, p_team_id: teamAId, p_drop: 'vitest-tr-1', p_action_id: ACTION.dropP1 }),
    ])
    // The drop never waits on a trade: it lands in both orders.
    expect(dropped.error).toBeNull()
    // The accept either ran first (and was then invalidated by the drop) or
    // ran second and was refused BY NAME — never a silent success.
    if (accepted.error !== null) {
      expect(accepted.error.code).toBe('P0001')
      expect(accepted.error.message).toMatch(/^trade_respond: this trade is already invalid \(Vitest TR One \(vitest-tr-1\) is no longer on TRD Manager A Team's roster — he was dropped \(E37\)\)/)
    } else {
      expect((accepted.data as unknown as TradeResult).trade.status).toBe('in_review')
    }
    const reason = "Vitest TR One (vitest-tr-1) is no longer on TRD Manager A Team's roster — he was dropped (E37)"
    expect(await tradeRow(t3)).toStrictEqual({ status: 'invalid', status_reason: reason })
    // …and so is the earlier ACCEPTED trade that also named him (t1).
    expect(await tradeRow(t1)).toStrictEqual({ status: 'invalid', status_reason: reason })

    // Exclusivity: nothing executed — the dropped player is on no roster,
    // everyone else is exactly where the fixture put them.
    expect(await holderOf('vitest-tr-1')).toStrictEqual([])
    expect(await holderOf('vitest-tr-2')).toStrictEqual([teamAId])
    expect(await holderOf('vitest-tr-3')).toStrictEqual([teamBId])
    expect(await holderOf('vitest-tr-4')).toStrictEqual([teamBId])

    // E37: both managers were told about t3.
    const { data: told, error: toldError } = await service
      .from('notifications')
      .select('user_id')
      .eq('type', 'league_trade_invalid')
      .eq('data->>trade_id', t3)
    expect(toldError).toBeNull()
    expect((told ?? []).map((row) => row.user_id).sort()).toStrictEqual([managerAId, managerBId].sort())
  })
})
