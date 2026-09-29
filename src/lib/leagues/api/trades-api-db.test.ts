/**
 * trades-api-db.test.ts — M5 L.D3.6 at the SERVICE layer: the trade routes
 * (`trades-service.ts` → migrations 148 / 151 / 155) driven as signed-in
 * users over the real PostgREST wire.
 *
 *   POST  …/trades        propose — the manager, the commissioner for a team
 *                         (TD5); a non-member and a member for ANOTHER team
 *                         are the one no-leak 403; F65(b) on a reused id;
 *   GET   …/trades        every member reads every trade (not blind — §12.11)
 *                         with names, status, reason and the review countdown
 *                         at the injected instant; a non-member is the
 *                         family's 403 (R807); the league-vote COUNT, never who;
 *   PATCH …/trades/[tid]  accept / reject / cancel / counter / vote — a
 *                         non-member and a non-party member are the no-leak
 *                         403; the OTHER party asking for the wrong move is a
 *                         409 by name; a party voting is a 409 by name.
 *
 * L.D3.12 (migration 162): the deadline read and the legality preview — a
 * member reads / previews, a non-member is the no-leak 403, nothing written.
 *
 * Plus the deploy-before-push predicate against PostgREST’s REAL answer for a
 * missing table / function (the hosted database is at 134; trades are 148+).
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down, and
 * refuses to run against anything but 127.0.0.1 (`.env.local` points at
 * HOSTED). Calendar: SYNTHETIC_SEASON (2099), made-up NFL teams with no
 * games — nothing is locked and the week-11 deadline is decades away; the
 * review deadlines are 24 h out, so the local `trade-tick` job never runs
 * one. Fixed emails / usernames / action_ids + cleanup-first. Action-id
 * prefix `b8a` — this suite owns it (the D108(14) registry; measured free
 * 2026-09-28).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import {
  TRADE_ACTION_ID_REUSED_MESSAGE,
  TRADE_PROPOSE_FORBIDDEN_MESSAGE,
  TRADE_RESPOND_FORBIDDEN_MESSAGE,
  TRADE_VOTE_FORBIDDEN_MESSAGE,
  TRADE_CHECKS_FORBIDDEN_MESSAGE,
  TRADE_CHECK_OBJECTS,
  previewTrade,
  readTradeDeadline,
  type TradeDeadlineView,
  type TradePreview,
  actOnTrade,
  isDoorNotPushed,
  isMissingSchemaObject,
  proposeTrade,
  readTrades,
  type TradesDocument,
  type TradeView,
} from './trades-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-trades-api-league'

const COMMISH = { email: 'trades-api-commish@fieldscout.test', password: 'pgtap-tapi-pass-1', username: 'tapi_commish' }
const MANAGER_A = { email: 'trades-api-manager-a@fieldscout.test', password: 'pgtap-tapi-pass-2', username: 'tapi_manager_a' }
const MANAGER_B = { email: 'trades-api-manager-b@fieldscout.test', password: 'pgtap-tapi-pass-3', username: 'tapi_manager_b' }
const MANAGER_C = { email: 'trades-api-manager-c@fieldscout.test', password: 'pgtap-tapi-pass-4', username: 'tapi_manager_c' }
const OUTSIDER = { email: 'trades-api-outsider@fieldscout.test', password: 'pgtap-tapi-pass-5', username: 'tapi_outsider' }

const PLAYERS = [
  { id: 'vitest-tapi-1', full_name: 'Vitest TAPI One', position: 'WR', team: 'VXA', status: 'Active' },
  { id: 'vitest-tapi-2', full_name: 'Vitest TAPI Two', position: 'RB', team: 'VXA', status: 'Active' },
  { id: 'vitest-tapi-3', full_name: 'Vitest TAPI Three', position: 'WR', team: 'VXB', status: 'Active' },
  { id: 'vitest-tapi-4', full_name: 'Vitest TAPI Four', position: 'RB', team: 'VXB', status: 'Active' },
  { id: 'vitest-tapi-5', full_name: 'Vitest TAPI Five', position: 'TE', team: 'VXC', status: 'Active' },
] as const

const A = (n: number) => `b8a00000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACTION = {
  league: A(1),
  proposeT1: A(11),
  proposeForeign: A(12),
  proposeOutsider: A(13),
  proposeCommish: A(14),
  proposeT3: A(15),
  proposeT4: A(16),
  acceptWrongSide: A(21),
  acceptOutsider: A(22),
  acceptNonParty: A(23),
  acceptT1: A(24),
  cancelT2: A(31),
  counterT3: A(41),
  acceptT4: A(51),
  voteC: A(61),
  voteParty: A(62),
  voteOutsider: A(63),
  voteCommish: A(64),
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let managerCClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
const ids: Record<string, string> = {}
let leagueId: string
let commishTeamId: string
let teamAId: string
let teamBId: string
let teamCId: string
const trade: Record<string, string> = {}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const leagueIds = (stale ?? []).map((row) => row.id)
  if (leagueIds.length > 0) {
    // trades-db.test.ts's order: trades first (they reference teams with no
    // cascade — their legs / drops / votes cascade with them), then the
    // league graph; then PROGRESS F406's order for the teams.
    for (const table of [
      'trade_actions',
      'trades',
      'transactions',
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
  for (const u of [COMMISH, MANAGER_A, MANAGER_B, MANAGER_C, OUTSIDER]) await deleteUserByUsername(u.username)
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

async function setReview(review: 'none' | 'commissioner' | 'league_vote'): Promise<void> {
  const { error } = await service.from('leagues').update({ trade_review: review }).eq('id', leagueId)
  if (error) throw new Error(`leagues trade_review: ${error.message}`)
}

function doc(body: Json): TradesDocument {
  return body as unknown as TradesDocument
}

function find(d: TradesDocument, id: string): TradeView {
  const t = d.trades.find((x) => x.id === id)
  if (!t) throw new Error(`trade ${id} not in the document`)
  return t
}

const AT = new Date('2099-09-10T12:00:00.000Z')

beforeAll(async () => {
  // The suite writes; it must never reach the hosted project `.env.local` names.
  expect(new URL(LOCAL_URL).hostname).toBe('127.0.0.1')
  await cleanup()
  await seedSyntheticSeason(service)

  ids.commish = await createUser(COMMISH)
  ids.a = await createUser(MANAGER_A)
  ids.b = await createUser(MANAGER_B)
  ids.c = await createUser(MANAGER_C)
  ids.outsider = await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)
  managerCClient = await signIn(MANAGER_C)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'TAPI Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id
  const { data: seat } = await service.from('league_members').select('team_id').eq('league_id', leagueId).eq('user_id', ids.commish).single()
  commishTeamId = seat!.team_id!

  teamAId = await seatManager(ids.a, 'TAPI Manager A Team')
  teamBId = await seatManager(ids.b, 'TAPI Manager B Team')
  teamCId = await seatManager(ids.c, 'TAPI Manager C Team')

  const { data: inSeason, error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
    .select('trade_review')
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  // PREMISE, measured: the §7.3.5 default — the commissioner reviews trades.
  expect(inSeason).toStrictEqual([{ trade_review: 'commissioner' }])
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert(Array.from({ length: 14 }, (_, i) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week: i + 1 })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service.from('league_rosters').insert([
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-tapi-1', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamAId, player_id: 'vitest-tapi-2', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-tapi-3', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamBId, player_id: 'vitest-tapi-4', slot_key: 'bn' },
    { league_id: leagueId, team_id: teamCId, player_id: 'vitest-tapi-5', slot_key: 'bn' },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

const oneForOne = (give: string, get: string) => [
  { player_id: give, from_team_id: teamAId },
  { player_id: get, from_team_id: teamBId },
]

describe('POST …/trades — proposeTrade over the real verb', () => {
  it('manager A offers One for Three: 200, the offer proposed, nothing moved', async () => {
    const res = await proposeTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: oneForOne('vitest-tapi-1', 'vitest-tapi-3'),
      note: 'fair?',
      action_id: ACTION.proposeT1,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { trade: { id: string; status: string; note: string }; acted_as_commissioner: boolean }
    expect([body.trade.status, body.trade.note, body.acted_as_commissioner]).toStrictEqual(['proposed', 'fair?', false])
    trade.t1 = body.trade.id
  })

  it('the SAME body replays byte-identically; a reused action_id for other legs is a 409 (F65(b))', async () => {
    const first = { from_team_id: teamAId, to_team_id: teamBId, items: oneForOne('vitest-tapi-1', 'vitest-tapi-3'), note: 'fair?', action_id: ACTION.proposeT1 }
    const replay = await proposeTrade(managerAClient, leagueId, first)
    expect(replay.status).toBe(200)
    expect((replay.body as { trade: { id: string } }).trade.id).toBe(trade.t1)
    expect(await proposeTrade(managerAClient, leagueId, { ...first, items: oneForOne('vitest-tapi-2', 'vitest-tapi-3') })).toStrictEqual({
      status: 409,
      body: { error: TRADE_ACTION_ID_REUSED_MESSAGE },
    })
  })

  it('a non-member, and a member offering for ANOTHER team, get the one no-leak 403', async () => {
    const body = { from_team_id: teamAId, to_team_id: teamBId, items: oneForOne('vitest-tapi-2', 'vitest-tapi-4') }
    expect(await proposeTrade(outsiderClient, leagueId, { ...body, action_id: ACTION.proposeOutsider })).toStrictEqual({
      status: 403,
      body: { error: TRADE_PROPOSE_FORBIDDEN_MESSAGE },
    })
    expect(await proposeTrade(managerCClient, leagueId, { ...body, action_id: ACTION.proposeForeign })).toStrictEqual({
      status: 403,
      body: { error: TRADE_PROPOSE_FORBIDDEN_MESSAGE },
    })
  })

  it('the commissioner offers FOR team A (TD5) — acted_as_commissioner, a receipt, the reason kept', async () => {
    const res = await proposeTrade(commishClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: oneForOne('vitest-tapi-2', 'vitest-tapi-4'),
      action_id: ACTION.proposeCommish,
      reason: 'he asked me to',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { trade: { id: string }; acted_as_commissioner: boolean; commissioner_action_id: string | null; reason: string }
    expect([body.acted_as_commissioner, body.commissioner_action_id !== null, body.reason]).toStrictEqual([true, true, 'he asked me to'])
    trade.t2 = body.trade.id
  })
})

describe('GET …/trades — every member reads every trade (not blind)', () => {
  it('a NON-PARTY member reads both offers, newest first, with names, legs and no review yet', async () => {
    const res = await readTrades(managerCClient, leagueId, ids.c, {}, AT)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const d = doc(res.body)
    expect(d.viewer).toStrictEqual({ team_id: teamCId, is_commissioner: false })
    expect([d.settings.trade_review, d.settings.trade_review_period_hours, d.settings.trade_deadline_week, d.evaluated_at]).toStrictEqual([
      'commissioner',
      24,
      11,
      AT.toISOString(),
    ])
    expect(d.trades.map((t) => t.id)).toStrictEqual([trade.t2, trade.t1])
    const t1 = find(d, trade.t1)
    expect([t1.status, t1.in_flight, t1.proposer.name, t1.recipient.name, t1.note, t1.review, t1.tally]).toStrictEqual([
      'proposed',
      true,
      'TAPI Manager A Team',
      'TAPI Manager B Team',
      'fair?',
      null,
      null,
    ])
    expect(t1.items.map((i) => [i.from_team_id, i.player?.full_name, i.faab_amount])).toStrictEqual([
      [teamAId, 'Vitest TAPI One', null],
      [teamBId, 'Vitest TAPI Three', null],
    ])
  })

  it('a non-member is the family’s 403 by name — never an empty list; filters and a stray key', async () => {
    expect(await readTrades(outsiderClient, leagueId, ids.outsider, {}, AT)).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(doc((await readTrades(managerCClient, leagueId, ids.c, { team_id: teamCId }, AT)).body).trades).toStrictEqual([])
    expect(doc((await readTrades(managerCClient, leagueId, ids.c, { status: 'closed' }, AT)).body).trades).toStrictEqual([])
    expect((await readTrades(managerCClient, leagueId, ids.c, { peek: 'x' }, AT)).status).toBe(400)
  })
})

describe('PATCH …/trades/[tid] — answer', () => {
  it('a non-member and a NON-PARTY member are the no-leak 403; the PROPOSER accepting is a 409 by name', async () => {
    expect(await actOnTrade(outsiderClient, leagueId, trade.t1, { op: 'accept', action_id: ACTION.acceptOutsider })).toStrictEqual({
      status: 403,
      body: { error: TRADE_RESPOND_FORBIDDEN_MESSAGE },
    })
    expect(await actOnTrade(managerCClient, leagueId, trade.t1, { op: 'accept', action_id: ACTION.acceptNonParty })).toStrictEqual({
      status: 403,
      body: { error: TRADE_RESPOND_FORBIDDEN_MESSAGE },
    })
    expect(await actOnTrade(managerAClient, leagueId, trade.t1, { op: 'accept', action_id: ACTION.acceptWrongSide })).toStrictEqual({
      status: 409,
      body: { error: 'trade_respond: only the team that received a trade can accept it — you proposed this one, so cancel it instead (§13.3)' },
    })
  })

  it('manager B accepts: in review (the commissioner reviews); the read shows the countdown at the injected instant', async () => {
    const res = await actOnTrade(managerBClient, leagueId, trade.t1, { op: 'accept', action_id: ACTION.acceptT1 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { trade: { status: string; review_deadline: string }; review: { mode: string; period_hours: number } }
    expect([body.trade.status, body.review.mode, body.review.period_hours]).toStrictEqual(['in_review', 'commissioner', 24])
    // The same id for an accept with a drop replays the first (no drops) — refused.
    expect(await actOnTrade(managerBClient, leagueId, trade.t1, { op: 'accept', drops: ['vitest-tapi-4'], action_id: ACTION.acceptT1 })).toStrictEqual({
      status: 409,
      body: { error: TRADE_ACTION_ID_REUSED_MESSAGE },
    })

    const deadline = Date.parse(body.trade.review_deadline)
    const hourBefore = new Date(deadline - 3_600_000)
    const t1 = find(doc((await readTrades(managerCClient, leagueId, ids.c, { status: 'open' }, hourBefore)).body), trade.t1)
    expect(t1.review).toStrictEqual({ mode: 'commissioner', ends_at: body.trade.review_deadline, ms_remaining: 3_600_000 })
    const after = find(doc((await readTrades(managerCClient, leagueId, ids.c, {}, new Date(deadline + 1))).body), trade.t1)
    expect(after.review?.ms_remaining).toBe(0)
  })

  it('manager A cancels the commissioner’s offer; history shows it closed with its reason', async () => {
    const res = await actOnTrade(managerAClient, leagueId, trade.t2, { op: 'cancel', action_id: ACTION.cancelT2 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const closed = doc((await readTrades(managerBClient, leagueId, ids.b, { status: 'closed' }, AT)).body)
    expect(closed.trades.map((t) => [t.id, t.status, t.status_reason, t.in_flight])).toStrictEqual([
      [trade.t2, 'cancelled', 'cancelled by TAPI Manager A Team', false],
    ])
  })

  it('manager B COUNTERS a new offer: the original is rejected, the counter goes the other way', async () => {
    const offer = await proposeTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: oneForOne('vitest-tapi-2', 'vitest-tapi-4'),
      action_id: ACTION.proposeT3,
    })
    expect(offer.status, JSON.stringify(offer.body)).toBe(200)
    trade.t3 = (offer.body as { trade: { id: string } }).trade.id
    const items = [
      { player_id: 'vitest-tapi-4', from_team_id: teamBId },
      { player_id: 'vitest-tapi-2', from_team_id: teamAId },
      { player_id: 'vitest-tapi-1', from_team_id: teamAId },
    ]
    const res = await actOnTrade(managerBClient, leagueId, trade.t3, { op: 'counter', items, note: 'add One', action_id: ACTION.counterT3 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { trade: { status: string; status_reason: string }; counter_trade: { id: string; proposer_team_id: string; countered_from: string } }
    expect([body.trade.status, body.trade.status_reason, body.counter_trade.proposer_team_id, body.counter_trade.countered_from]).toStrictEqual([
      'rejected',
      'countered by TAPI Manager B Team',
      teamBId,
      trade.t3,
    ])
  })
})

describe('PATCH …/trades/[tid] with { op: "vote" } — league vote (Q77, 155)', () => {
  it('a league-vote trade in review: C votes veto (recorded), the COUNT is read, never who', async () => {
    await setReview('league_vote')
    const offer = await proposeTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: [{ player_id: 'vitest-tapi-2', from_team_id: teamAId }],
      action_id: ACTION.proposeT4,
    })
    // A one-sided offer needs allow_future_considerations — measured, so the
    // premise is named rather than assumed.
    expect(offer.status, JSON.stringify(offer.body)).toBe(409)
    const even = await proposeTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: oneForOne('vitest-tapi-2', 'vitest-tapi-3'),
      action_id: A(17),
    })
    expect(even.status, JSON.stringify(even.body)).toBe(200)
    trade.t4 = (even.body as { trade: { id: string } }).trade.id
    expect((await actOnTrade(managerBClient, leagueId, trade.t4, { op: 'accept', action_id: ACTION.acceptT4 })).status).toBe(200)

    const vote = await actOnTrade(managerCClient, leagueId, trade.t4, { op: 'vote', vote: 'veto', action_id: ACTION.voteC })
    expect(vote.status, JSON.stringify(vote.body)).toBe(200)
    expect((vote.body as { outcome: string }).outcome).toBe('recorded')

    const t4 = find(doc((await readTrades(managerCClient, leagueId, ids.c, { status: 'open' }, AT)).body), trade.t4)
    expect(t4.review?.mode).toBe('league_vote')
    // Eligible voters: the seated managers of the two non-party teams (the
    // commissioner's team and C) — so the league's number (⌈8/2⌉ = 4) is
    // capped at 2 (F430).
    expect(t4.tally).toMatchObject({
      veto_votes: 1,
      eligible_voters: 2,
      setting: 4,
      veto_number: 2,
      capped: true,
      voting_open: true,
      my_vote: 'veto',
      can_vote: true,
      cannot_vote_because: null,
    })
    // The count, never who: no key of the tally names a voter.
    expect(Object.keys(t4.tally!).sort()).toStrictEqual(
      [
        'trade_id',
        'review',
        'status',
        'veto_votes',
        'eligible_voters',
        'setting',
        'veto_number',
        'capped',
        'voting_open',
        'closes_at',
        'my_vote',
        'can_vote',
        'cannot_vote_because',
        'evaluated_at',
      ].sort(),
    )
    // A party reads the same count with his own vote empty and why he cannot vote.
    const asA = find(doc((await readTrades(managerAClient, leagueId, ids.a, {}, AT)).body), trade.t4)
    expect([asA.tally?.veto_votes, asA.tally?.my_vote, asA.tally?.can_vote, asA.tally?.cannot_vote_because]).toStrictEqual([1, null, false, 'party'])
  })

  it('refusals: a party votes → 409 by name; a non-member → 403; a reused id for the other vote → 409 verbatim', async () => {
    expect(await actOnTrade(managerAClient, leagueId, trade.t4, { op: 'vote', vote: 'approve', action_id: ACTION.voteParty })).toStrictEqual({
      status: 409,
      body: { error: 'trade_vote: your team is in this trade — the two teams in a trade do not vote on it; every other manager may (§13.3 / Q77)' },
    })
    expect(await actOnTrade(outsiderClient, leagueId, trade.t4, { op: 'vote', vote: 'veto', action_id: ACTION.voteOutsider })).toStrictEqual({
      status: 403,
      body: { error: TRADE_VOTE_FORBIDDEN_MESSAGE },
    })
    const reusedVote = await actOnTrade(managerCClient, leagueId, trade.t4, { op: 'vote', vote: 'approve', action_id: ACTION.voteC })
    expect(reusedVote.status).toBe(409)
    expect(JSON.stringify(reusedVote.body)).toContain('already names a trade_vote for another request')
  })

  it('the commissioner, voting as his TEAM’s manager, brings the count to the number: vetoed at once', async () => {
    const res = await actOnTrade(commishClient, leagueId, trade.t4, { op: 'vote', vote: 'veto', action_id: ACTION.voteCommish })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { outcome: string; team_id: string; trade: { status: string } }
    expect([body.outcome, body.team_id, body.trade.status]).toStrictEqual(['vetoed', commishTeamId, 'vetoed'])
    const t4 = find(doc((await readTrades(managerBClient, leagueId, ids.b, { status: 'closed' }, AT)).body), trade.t4)
    expect([t4.status, t4.in_flight, t4.review, t4.tally]).toStrictEqual(['vetoed', false, null, null])
    expect(t4.status_reason).toMatch(/2/)
  })
})

describe('deploy before push — PostgREST’s REAL answer for a missing object', () => {
  it('a missing table and a missing function are recognised by name (the shape the hosted database gives before 148)', async () => {
    const table = await managerAClient.from('trades_l_d3_6_probe' as never).select('id')
    expect(table.error?.code).toBe('PGRST205')
    expect(isMissingSchemaObject(table.error, ['trades_l_d3_6_probe'])).toBe(true)
    expect(isMissingSchemaObject(table.error, ['trades'])).toBe(false)
    const fn = await managerAClient.rpc('trade_l_d3_6_probe' as never, { p_league_id: leagueId } as never)
    expect(fn.error?.code).toBe('PGRST202')
    expect(isMissingSchemaObject(fn.error, ['trade_l_d3_6_probe'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// L.D3.12 — migration 162's two reads over the real wire (PROGRESS D426)
// ---------------------------------------------------------------------------

describe('GET …/trades/deadline + POST …/trades/preview — 162 over the real wire', () => {
  it('a member reads the deadline instant (week N+1’s start in the calendar), not passed in 2099; a non-member is the no-leak 403', async () => {
    const { data: league } = await service.from('leagues').select('trade_deadline_week, season').eq('id', leagueId).single()
    const week = league!.trade_deadline_week!
    const { data: next } = await service.from('nfl_weeks').select('starts_at').eq('season', league!.season).eq('week', week + 1).single()
    const res = await readTradeDeadline(managerAClient, leagueId)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const view = res.body as unknown as TradeDeadlineView
    expect([view.deadline_week, Date.parse(view.deadline_at!), view.why, view.passed]).toStrictEqual([week, Date.parse(next!.starts_at), 'next_week_starts', false])
    expect(await readTradeDeadline(outsiderClient, leagueId)).toStrictEqual({ status: 403, body: { error: TRADE_CHECKS_FORBIDDEN_MESSAGE } })
  })

  it('a member previews an offer — the rosters’ facts from the verbs’ own validator; a leg naming another team’s player is the validator’s sentence; nothing is written', async () => {
    const { data: rows } = await service.from('league_rosters').select('team_id, player_id').eq('league_id', leagueId).order('player_id')
    const mine = rows!.find((r) => r.team_id === teamAId)!.player_id
    const theirs = rows!.find((r) => r.team_id === teamCId)!.player_id
    const before = await service.from('trades').select('id', { count: 'exact', head: true }).eq('league_id', leagueId)

    const ok = await previewTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamCId,
      items: [
        { player_id: mine, from_team_id: teamAId },
        { player_id: theirs, from_team_id: teamCId },
      ],
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const p = ok.body as unknown as TradePreview
    expect([p.mode, p.ok, p.refusal, p.rosters?.proposer.must_drop, p.rosters?.recipient.enforced]).toStrictEqual(['offer', true, null, 0, false])

    const wrong = await previewTrade(managerAClient, leagueId, {
      from_team_id: teamAId,
      to_team_id: teamBId,
      items: [
        { player_id: mine, from_team_id: teamAId },
        { player_id: theirs, from_team_id: teamBId },
      ],
    })
    expect(wrong.status).toBe(200)
    expect((wrong.body as unknown as TradePreview).refusal).toMatch(/^trade_preview: .+ is on TAPI Manager C Team's roster, not TAPI Manager B Team's — a trade can only move a player from the team that has him/)
    expect(await previewTrade(outsiderClient, leagueId, { from_team_id: teamAId, to_team_id: teamCId, items: [{ player_id: mine, from_team_id: teamAId }] })).toStrictEqual({
      status: 403,
      body: { error: TRADE_CHECKS_FORBIDDEN_MESSAGE },
    })
    const after = await service.from('trades').select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
    expect(after.count).toBe(before.count)
  })

  it('the named-503 predicate recognises PostgREST’s REAL answer for a door this database does not have (the pre-162 shape)', async () => {
    const { error } = await (managerAClient.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>)(
      'trade_preview_not_pushed',
      { p_league_id: leagueId },
    )
    expect(error?.code).toBe('PGRST202')
    expect(error?.message).toBe('Could not find the function public.trade_preview_not_pushed(p_league_id) in the schema cache')
    expect(isMissingSchemaObject(error, ['trade_preview_not_pushed'])).toBe(true)
    expect(isMissingSchemaObject(error, TRADE_CHECK_OBJECTS)).toBe(false)
    expect(isDoorNotPushed(error, { trade_preview_not_pushed: ['p_league_id'] })).toBe(true)
  })

  it('R1282: a DRIFTED call to a door that exists is never read as "not pushed" (PostgREST’s real answers, with and without a hint)', async () => {
    const call = managerAClient.rpc.bind(managerAClient) as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string; hint?: string | null } | null }>
    const drift1 = (await call('trade_deadline', { p_bogus: 1 })).error
    const drift2 = (await call('trade_preview', { p_league_id: leagueId, p_bogus: 1 })).error
    expect([drift1?.code, drift2?.code]).toStrictEqual(['PGRST202', 'PGRST202'])
    expect(isMissingSchemaObject(drift1, TRADE_CHECK_OBJECTS)).toBe(true) // the old, too-wide test said "not pushed"
    expect(isDoorNotPushed(drift1)).toBe(false)
    expect(isDoorNotPushed(drift2)).toBe(false)
  })
})
