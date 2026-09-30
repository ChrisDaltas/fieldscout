/**
 * commish-trade-api-db.test.ts — M5 L.D3.6 at the SERVICE layer:
 * `POST /api/leagues/[id]/commish/trade` (`trades-service.ts` `commishTrade`
 * → migration 156's `commish_force_or_reverse_trade`) driven as signed-in
 * users over the real PostgREST wire — PROGRESS F451's route half.
 *
 *   - a manager (even one of the trade's own teams) and a non-member get the
 *     one no-leak 403;
 *   - approve → the executor puts the trade through; the same body replays
 *     byte-identically; the same action_id for ANOTHER op is 156's by-name
 *     refusal, a 409 verbatim (R732);
 *   - reverse is not an op since 174 (Chris 2026-09-30, "Remove reverse") —
 *     a 400 before the wire; the approved trade stands;
 *   - veto of a trade in review; force of an offer nobody accepted is a 409
 *     BY NAME (174 / D463 — an accepted trade only), and force of the same
 *     trade once accepted goes through past the review;
 *   - a refusal by name (veto of a completed trade) is a 409 with the
 *     database's sentence; a malformed body a 400 before the wire;
 *   - the trades read reflects every op (status + reason).
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down, and
 * refuses to run against anything but 127.0.0.1. Calendar: SYNTHETIC_SEASON
 * (2099), made-up NFL teams with no games — nothing locked, no live week to
 * re-score. Fixed emails / usernames / action_ids + cleanup-first. Action-id
 * prefix `b8b` — this suite owns it (measured free 2026-09-28).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

import { COMMISH_TRADE_FORBIDDEN_MESSAGE, actOnTrade, commishTrade, proposeTrade, readTrades, type CommishTradeResult, type TradesDocument } from './trades-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-trade-api-league'

const COMMISH = { email: 'ctapi-commish@fieldscout.test', password: 'pgtap-ctapi-pass-1', username: 'ctapi_commish' }
const MANAGER_A = { email: 'ctapi-manager-a@fieldscout.test', password: 'pgtap-ctapi-pass-2', username: 'ctapi_manager_a' }
const MANAGER_B = { email: 'ctapi-manager-b@fieldscout.test', password: 'pgtap-ctapi-pass-3', username: 'ctapi_manager_b' }
const OUTSIDER = { email: 'ctapi-outsider@fieldscout.test', password: 'pgtap-ctapi-pass-4', username: 'ctapi_outsider' }

const PLAYERS = [
  { id: 'vitest-ctapi-1', full_name: 'Vitest CTAPI One', position: 'WR', team: 'VYA', status: 'Active' },
  { id: 'vitest-ctapi-2', full_name: 'Vitest CTAPI Two', position: 'RB', team: 'VYA', status: 'Active' },
  { id: 'vitest-ctapi-3', full_name: 'Vitest CTAPI Three', position: 'WR', team: 'VYB', status: 'Active' },
  { id: 'vitest-ctapi-4', full_name: 'Vitest CTAPI Four', position: 'RB', team: 'VYB', status: 'Active' },
] as const

const A = (n: number) => `b8b00000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACTION = {
  league: A(1),
  proposeT1: A(11),
  acceptT1: A(12),
  proposeT2: A(21),
  acceptT2: A(22),
  proposeT3: A(31),
  approveByManager: A(41),
  approveByOutsider: A(42),
  approveT1: A(43),
  reverseT1: A(44),
  reverseT1Again: A(45),
  vetoT2: A(46),
  forceT3: A(47),
  forceT3Offer: A(49),
  acceptT3: A(32),
  vetoComplete: A(48),
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let teamAId: string
let teamBId: string
let managerBId: string
const trade: Record<string, string> = {}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const leagueIds = (stale ?? []).map((row) => row.id)
  if (leagueIds.length > 0) {
    for (const table of [
      'commish_trade_actions',
      'trade_actions',
      'transactions',
      'trades',
      'league_chat',
      'league_player_pool',
      'league_weeks',
      'league_rosters',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', leagueIds)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { data: teams, error: teamsReadError } = await service.from('teams').select('id').in('league_id', leagueIds)
    if (teamsReadError) throw new Error(`cleanup teams read: ${teamsReadError.message}`)
    const teamIds = (teams ?? []).map((row) => row.id)
    const { error: detachError } = await service.from('teams').update({ league_id: null }).in('id', teamIds)
    if (detachError) throw new Error(`cleanup teams detach: ${detachError.message}`)
    // F406's order: the league goes (its immutable audit rows with it —
    // ON DELETE CASCADE), THEN the teams.
    const { error: leaguesError } = await service.from('leagues').delete().in('id', leagueIds)
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
  for (const u of [COMMISH, MANAGER_A, MANAGER_B, OUTSIDER]) await deleteUserByUsername(u.username)
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
  const { data: team, error: teamError } = await service.from('teams').insert({ owner_id: userId, name, league_id: leagueId }).select('id').single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager', faab_balance: 100 })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

async function holderOf(playerId: string): Promise<string[]> {
  const { data, error } = await service.from('league_rosters').select('team_id').eq('league_id', leagueId).eq('player_id', playerId)
  if (error) throw new Error(`holderOf: ${error.message}`)
  return (data ?? []).map((row) => row.team_id)
}

async function offer(actionId: string, give: string, get: string): Promise<string> {
  const res = await proposeTrade(managerAClient, leagueId, {
    from_team_id: teamAId,
    to_team_id: teamBId,
    items: [
      { player_id: give, from_team_id: teamAId },
      { player_id: get, from_team_id: teamBId },
    ],
    action_id: actionId,
  })
  if (res.status !== 200) throw new Error(`propose: ${JSON.stringify(res.body)}`)
  return (res.body as { trade: { id: string } }).trade.id
}

async function accept(tradeId: string, actionId: string): Promise<void> {
  const res = await actOnTrade(managerBClient, leagueId, tradeId, { op: 'accept', action_id: actionId })
  if (res.status !== 200) throw new Error(`accept: ${JSON.stringify(res.body)}`)
}

function result(body: unknown): CommishTradeResult {
  return body as CommishTradeResult
}

const AT = new Date('2099-09-10T12:00:00.000Z')

beforeAll(async () => {
  expect(new URL(LOCAL_URL).hostname).toBe('127.0.0.1')
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  const managerAId = await createUser(MANAGER_A)
  managerBId = await createUser(MANAGER_B)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'CTAPI Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  teamAId = await seatManager(managerAId, 'CTAPI Manager A Team')
  teamBId = await seatManager(managerBId, 'CTAPI Manager B Team')

  const { data: inSeason, error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
    .select('trade_review')
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  expect(inSeason).toStrictEqual([{ trade_review: 'commissioner' }])
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert(Array.from({ length: 14 }, (_, i) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week: i + 1 })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service.from('league_rosters').insert([
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-ctapi-1', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-ctapi-2', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-ctapi-3', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-ctapi-4', slot_key: 'bn' },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)

  trade.t1 = await offer(ACTION.proposeT1, 'vitest-ctapi-1', 'vitest-ctapi-3')
  await accept(trade.t1, ACTION.acceptT1)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('POST …/commish/trade — who may use it', () => {
  it('a manager of one of the trade’s own teams and a non-member get the one no-leak 403; nothing moved', async () => {
    expect(await commishTrade(managerBClient, leagueId, { trade_id: trade.t1, op: 'approve', action_id: ACTION.approveByManager })).toStrictEqual({
      status: 403,
      body: { error: COMMISH_TRADE_FORBIDDEN_MESSAGE },
    })
    expect(await commishTrade(outsiderClient, leagueId, { trade_id: trade.t1, op: 'approve', action_id: ACTION.approveByOutsider })).toStrictEqual({
      status: 403,
      body: { error: COMMISH_TRADE_FORBIDDEN_MESSAGE },
    })
    expect(await holderOf('vitest-ctapi-1')).toStrictEqual([teamAId])
  })

  it('a malformed body is a 400 before the wire — an unknown op, a trade id that is not a uuid', async () => {
    expect((await commishTrade(commishClient, leagueId, { trade_id: trade.t1, op: 'undo', action_id: A(90) })).status).toBe(400)
    expect((await commishTrade(commishClient, leagueId, { trade_id: 'nope', op: 'veto', action_id: A(91) })).status).toBe(400)
  })
})

describe('POST …/commish/trade — the three ops over the real verb (174: reverse removed)', () => {
  it('approve: the trade goes through (the executor), one receipt; the same body replays byte-identically', async () => {
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t1, op: 'approve', action_id: ACTION.approveT1, reason: 'looks fair' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const r = result(res.body)
    expect([r.outcome, r.status_before, r.status, r.no_changes, r.commissioner_action_id !== null, r.reason]).toStrictEqual([
      'approved',
      'in_review',
      'complete',
      false,
      true,
      'looks fair',
    ])
    expect([await holderOf('vitest-ctapi-1'), await holderOf('vitest-ctapi-3')]).toStrictEqual([[teamBId], [teamAId]])
    const replay = await commishTrade(commishClient, leagueId, { trade_id: trade.t1, op: 'approve', action_id: ACTION.approveT1, reason: 'looks fair' })
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(res.body))
  })

  it('the same action_id for ANOTHER op is 156’s refusal by name — a 409 verbatim, never a replay (R732)', async () => {
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t1, op: 'veto', action_id: ACTION.approveT1 })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('already names a approve of another trade or another op in this league')
  })

  it('reverse is not an op (174 — “Remove reverse”): a 400 before the wire, and the approved trade stands', async () => {
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t1, op: 'reverse', action_id: ACTION.reverseT1 })
    expect(res.status).toBe(400)
    expect([await holderOf('vitest-ctapi-1'), await holderOf('vitest-ctapi-3')]).toStrictEqual([[teamBId], [teamAId]])
  })

  it('veto: a trade in review is closed vetoed with the commissioner’s reason', async () => {
    trade.t2 = await offer(ACTION.proposeT2, 'vitest-ctapi-2', 'vitest-ctapi-4')
    await accept(trade.t2, ACTION.acceptT2)
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t2, op: 'veto', action_id: ACTION.vetoT2, reason: 'lopsided' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect([result(res.body).outcome, result(res.body).status]).toStrictEqual(['vetoed', 'vetoed'])
    expect(await holderOf('vitest-ctapi-2')).toStrictEqual([teamAId])
  })

  it('force: an offer nobody accepted is a 409 BY NAME; once team B accepts it, force puts it through past the review (174 / D463)', async () => {
    trade.t3 = await offer(ACTION.proposeT3, 'vitest-ctapi-2', 'vitest-ctapi-4')
    const early = await commishTrade(commishClient, leagueId, { trade_id: trade.t3, op: 'force', action_id: ACTION.forceT3Offer })
    expect(early).toStrictEqual({
      status: 409,
      body: {
        error:
          "commish_force_or_reverse_trade: this offer has not been accepted yet, so it cannot be forced — a commissioner acts on a trade only after it's accepted: veto it or push it through (§13.3)",
      },
    })
    expect(await holderOf('vitest-ctapi-2')).toStrictEqual([teamAId])
    await accept(trade.t3, ACTION.acceptT3)
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t3, op: 'force', action_id: ACTION.forceT3 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const r = result(res.body)
    expect([r.outcome, r.status_before, r.status, r.accepted_for_team_id]).toStrictEqual(['forced', 'in_review', 'complete', null])
    expect(r.bypassed).toStrictEqual(['review_period'])
    expect([await holderOf('vitest-ctapi-2'), await holderOf('vitest-ctapi-4')]).toStrictEqual([[teamBId], [teamAId]])
  })

  it('a refusal by name — veto of a completed trade — is a 409 with the database’s sentence', async () => {
    const res = await commishTrade(commishClient, leagueId, { trade_id: trade.t3, op: 'veto', action_id: ACTION.vetoComplete })
    expect(res.status).toBe(409)
    expect((res.body as { error: string }).error).toMatch(/^commish_force_or_reverse_trade: /)
  })

  it('the trades read reflects every op — approved, vetoed with its reason, forced', async () => {
    const res = await readTrades(managerBClient, leagueId, managerBId, { status: 'closed' }, AT)
    expect(res.status).toBe(200)
    const d = res.body as unknown as TradesDocument
    expect(d.trades.map((t) => [t.id, t.status])).toStrictEqual([
      [trade.t3, 'complete'],
      [trade.t2, 'vetoed'],
      [trade.t1, 'complete'],
    ])
    expect(d.trades.find((t) => t.id === trade.t2)?.status_reason).toContain('lopsided')
  })
})
