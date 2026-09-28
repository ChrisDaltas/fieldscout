/**
 * waivers-api-db.test.ts — M5 L.D2.12 at the SERVICE layer: the claim routes
 * (`waivers-service.ts` → migration 145) and `/commish/faab`
 * (`commish-faab-service.ts` → migration 147) driven as signed-in users over
 * the real PostgREST wire, plus the FAAB balance / waiver priority on the
 * rosters, standings and league-detail reads.
 *
 *   - submit / cancel / move — the manager, and the commissioner for his team
 *     (TD5); a member for ANOTHER team is the one no-leak 403;
 *   - F65(b): a reused action_id naming a different claim / balance is a 409,
 *     the same body replayed is a byte-identical 200;
 *   - the BLIND read (E13): another member's GET returns only HIS team's
 *     claims, and naming this team is a 403 by name, never an empty list;
 *     a non-member is the family's 403 (R807 — see D387(3));
 *   - R1172: a balance one past INTEGER max is a clean 400, above-budget OK;
 *   - the reads carry `faab_balance` / `waiver_priority`.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down, and
 * refuses to run against anything but 127.0.0.1 (`.env.local` points at
 * HOSTED). Fixed emails / usernames / action_ids + cleanup-first. Action-id
 * prefix `b5c` — this suite owns it (measured free 2026-09-28). Cleanup order
 * is F406's (a commissioner-acted fixture).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

import { COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE, COMMISH_FAAB_FORBIDDEN_MESSAGE, commishEditFaab } from './commish-faab-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import { getLeagueDetail } from './leagues-service'
import { readRosters } from './rosters-service'
import { readStandings } from './standings-service'
import {
  WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE,
  WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE,
  WAIVER_CLAIM_FORBIDDEN_MESSAGE,
  cancelClaim,
  editClaim,
  readClaims,
  reorderClaim,
  submitClaim,
  type WaiverClaimsDocument,
} from './waivers-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-waivers-api-league'
const BALANCE = 30

const COMMISH = { email: 'waivers-api-commish@fieldscout.test', password: 'pgtap-wapi-pass-1', username: 'wapi_commish' }
const MANAGER_A = { email: 'waivers-api-manager-a@fieldscout.test', password: 'pgtap-wapi-pass-2', username: 'wapi_manager_a' }
const MANAGER_B = { email: 'waivers-api-manager-b@fieldscout.test', password: 'pgtap-wapi-pass-3', username: 'wapi_manager_b' }
const OUTSIDER = { email: 'waivers-api-outsider@fieldscout.test', password: 'pgtap-wapi-pass-4', username: 'wapi_outsider' }

const PLAYERS = [
  { id: 'vitest-wapi-1', full_name: 'Vitest WAPI One', position: 'WR', team: 'VWA', status: 'Active' },
  { id: 'vitest-wapi-2', full_name: 'Vitest WAPI Two', position: 'RB', team: 'VWB', status: 'Active' },
  { id: 'vitest-wapi-3', full_name: 'Vitest WAPI Three', position: 'TE', team: 'VWC', status: 'Active' },
] as const

const A = (n: number) => `b5c00000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACTION = {
  league: A(1),
  claim1: A(11),
  claim2: A(12),
  commishClaim: A(13),
  otherTeam: A(14),
  overBalance: A(15),
  move: A(21),
  moveForeign: A(22),
  cancel: A(31),
  edit: A(32),
  editBadDrop: A(33),
  faab: A(41),
  faabManager: A(42),
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let managerAId: string
let leagueId: string
let teamAId: string
let teamBId: string
const claimIds: string[] = []

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const table of ['waiver_claim_actions', 'waiver_claims', 'commish_faab_actions', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    // F406's order: detach the teams, delete the league (its immutable audit
    // rows go with it — ON DELETE CASCADE), THEN the teams.
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
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager', faab_balance: BALANCE })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

function doc(body: unknown): WaiverClaimsDocument {
  return body as WaiverClaimsDocument
}

beforeAll(async () => {
  // The suite writes; it must never reach the hosted project `.env.local` names.
  expect(new URL(LOCAL_URL).hostname).toBe('127.0.0.1')
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  managerAId = await createUser(MANAGER_A)
  const managerBId = await createUser(MANAGER_B)
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
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  teamAId = await seatManager(managerAId, 'WAPI Manager A Team')
  teamBId = await seatManager(managerBId, 'WAPI Manager B Team')

  const { data: inSeason, error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
    .select('waiver_type, faab_budget')
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  // PREMISE, measured: a FAAB league with a $100 budget.
  expect(inSeason).toStrictEqual([{ waiver_type: 'faab', faab_budget: 100 }])

  // 150 (L.D2.9, F407) re-cut: submit now refuses a player whose game has
  // kicked off, evaluated through the league's calendar — a league with no
  // league_weeks rows is refused by name. The synthetic season's weeks lie in
  // 2099, so nothing is locked at the wall clock.
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert(Array.from({ length: 14 }, (_, i) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week: i + 1 })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('POST …/waivers — submitClaim over the real verb', () => {
  it('the manager submits two claims; the answer is 145’s document, spending nothing', async () => {
    for (const [add, bid, action] of [
      // 150 re-cut (F422(b)): EQUAL bids — in a FAAB league the order follows
      // the bids and only equal bids reorder, and §PATCH moves claim 3 to 1.
      ['vitest-wapi-1', 5, ACTION.claim1],
      ['vitest-wapi-2', 5, ACTION.claim2],
    ] as const) {
      const res = await submitClaim(managerAClient, leagueId, { team_id: teamAId, add_player_id: add, faab_bid: bid, action_id: action })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const body = res.body as { claim: { id: string; faab_bid: number }; faab_spent: number; acted_as_commissioner: boolean }
      expect([body.claim.faab_bid, body.faab_spent, body.acted_as_commissioner]).toStrictEqual([bid, 0, false])
      claimIds.push(body.claim.id)
    }
  })

  it('the SAME body replays byte-identically; a reused action_id for a different player is a 409 (F65(b))', async () => {
    const first = { team_id: teamAId, add_player_id: 'vitest-wapi-1', faab_bid: 5, action_id: ACTION.claim1 }
    const replay = await submitClaim(managerAClient, leagueId, first)
    expect(replay.status).toBe(200)
    expect((replay.body as { claim: { id: string } }).claim.id).toBe(claimIds[0])
    const reused = await submitClaim(managerAClient, leagueId, { ...first, add_player_id: 'vitest-wapi-3' })
    expect(reused).toStrictEqual({ status: 409, body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE } })
  })

  it('refusals by name: over the balance → 409 verbatim; another member for team A → the no-leak 403; a bid past INTEGER max → 400', async () => {
    const over = await submitClaim(managerAClient, leagueId, { team_id: teamAId, add_player_id: 'vitest-wapi-3', faab_bid: BALANCE + 1, action_id: ACTION.overBalance })
    expect(over).toStrictEqual({
      status: 409,
      body: { error: `waiver_claim_submit: a bid of $${BALANCE + 1} is more than WAPI Manager A Team's FAAB balance of $${BALANCE} (§13.2)` },
    })
    const foreign = await submitClaim(managerBClient, leagueId, { team_id: teamAId, add_player_id: 'vitest-wapi-3', action_id: ACTION.otherTeam })
    expect(foreign).toStrictEqual({ status: 403, body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE } })
    const huge = await submitClaim(managerAClient, leagueId, { team_id: teamAId, add_player_id: 'vitest-wapi-3', faab_bid: 2147483648, action_id: ACTION.overBalance })
    expect(huge.status).toBe(400)
  })

  it('the commissioner claims FOR team A (TD5) — acted_as_commissioner, a receipt, the reason kept', async () => {
    const res = await submitClaim(commishClient, leagueId, {
      team_id: teamAId,
      add_player_id: 'vitest-wapi-3',
      faab_bid: 5,
      action_id: ACTION.commishClaim,
      reason: 'he asked me to',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { claim: { id: string; claim_order: number }; acted_as_commissioner: boolean; commissioner_action_id: string | null; reason: string }
    expect(body.acted_as_commissioner).toBe(true)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.reason).toBe('he asked me to')
    expect(body.claim.claim_order).toBe(3)
    claimIds.push(body.claim.id)
  })
})

describe('GET …/waivers — the blind read (E13)', () => {
  it('the manager reads HIS team’s three pending claims in order, with his balance', async () => {
    const res = await readClaims(managerAClient, leagueId, managerAId, {})
    expect(res.status).toBe(200)
    const d = doc(res.body)
    expect([d.team_id, d.status, d.waiver_type, d.faab_balance, d.faab_min_bid]).toStrictEqual([teamAId, 'pending', 'faab', BALANCE, 0])
    expect(d.claims.map((c) => [c.id, c.claim_order, c.add.full_name, c.faab_bid])).toStrictEqual([
      [claimIds[0], 1, 'Vitest WAPI One', 5],
      [claimIds[1], 2, 'Vitest WAPI Two', 5],
      [claimIds[2], 3, 'Vitest WAPI Three', 5],
    ])
  })

  it('ANOTHER member’s GET returns only his own team’s claims (none) — and naming team A is a 403 by name, never an empty list', async () => {
    const { data: bUser } = await managerBClient.auth.getUser()
    const own = await readClaims(managerBClient, leagueId, bUser.user!.id, {})
    expect(own.status).toBe(200)
    expect(doc(own.body).team_id).toBe(teamBId)
    expect(doc(own.body).claims).toStrictEqual([])
    const peek = await readClaims(managerBClient, leagueId, bUser.user!.id, { team_id: teamAId })
    expect(peek).toStrictEqual({ status: 403, body: { error: WAIVER_CLAIMS_READ_FORBIDDEN_MESSAGE } })
  })

  it('a non-member is refused (the family’s no-leak 403); the commissioner reads team A’s claims', async () => {
    const { data: o } = await outsiderClient.auth.getUser()
    expect(await readClaims(outsiderClient, leagueId, o.user!.id, {})).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    const { data: c } = await commishClient.auth.getUser()
    const res = await readClaims(commishClient, leagueId, c.user!.id, { team_id: teamAId })
    expect(res.status).toBe(200)
    expect(doc(res.body).claims).toHaveLength(3)
  })
})

describe('PATCH / DELETE …/waivers/[cid]', () => {
  it('the manager moves his third claim to first; the read shows the new order', async () => {
    const res = await reorderClaim(managerAClient, leagueId, claimIds[2], { claim_order: 1, action_id: ACTION.move })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const after = doc((await readClaims(managerAClient, leagueId, managerAId, {})).body)
    expect(after.claims.map((c) => c.id)).toStrictEqual([claimIds[2], claimIds[0], claimIds[1]])
  })

  it('another member cannot move or cancel team A’s claim — the no-leak 403 for both', async () => {
    expect(await reorderClaim(managerBClient, leagueId, claimIds[0], { claim_order: 1, action_id: ACTION.moveForeign })).toStrictEqual({
      status: 403,
      body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE },
    })
    expect(await cancelClaim(managerBClient, leagueId, claimIds[0], { action_id: ACTION.moveForeign })).toStrictEqual({
      status: 403,
      body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE },
    })
  })

  it('the manager cancels a claim; `status=all` shows it cancelled, the pending order stays dense', async () => {
    const res = await cancelClaim(managerAClient, leagueId, claimIds[0], { action_id: ACTION.cancel })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const all = doc((await readClaims(managerAClient, leagueId, managerAId, { status: 'all' })).body)
    expect(all.claims.map((c) => [c.id, c.status, c.claim_order, c.result_reason])).toStrictEqual([
      [claimIds[2], 'pending', 1, null],
      [claimIds[1], 'pending', 2, null],
      [claimIds[0], 'cancelled', 2, 'cancelled'],
    ])
    // A settled / cancelled claim cannot be moved — refused by name, no RPC.
    const moved = await reorderClaim(managerAClient, leagueId, claimIds[0], { claim_order: 1, action_id: A(23) })
    expect(moved.status).toBe(409)
    expect(JSON.stringify(moved.body)).toContain('this one is cancelled')
  })
})

describe('PATCH …/waivers/[cid] with { faab_bid, drop_player_id } — the one-transaction edit (M5 L.D2.9 / F417, migration 150)', () => {
  it('the manager raises a bid IN PLACE: the same claim id, the new bid, and it moves above the smaller bid (F422(b))', async () => {
    const res = await editClaim(managerAClient, leagueId, claimIds[1], { faab_bid: 9, drop_player_id: null, action_id: ACTION.edit })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as { claim: { id: string; faab_bid: number; claim_order: number }; before: { faab_bid: number }; no_changes: boolean }
    expect([body.claim.id, body.claim.faab_bid, body.claim.claim_order, body.before.faab_bid, body.no_changes]).toStrictEqual([claimIds[1], 9, 1, 5, false])
    const after = doc((await readClaims(managerAClient, leagueId, managerAId, {})).body)
    expect(after.claims.map((c) => [c.id, c.claim_order, c.faab_bid])).toStrictEqual([
      [claimIds[1], 1, 9],
      [claimIds[2], 2, 5],
    ])
    // The same body again replays byte-identically; the same id for a
    // DIFFERENT bid is the F65(b) 409, never a report of an edit nobody made.
    const replay = await editClaim(managerAClient, leagueId, claimIds[1], { faab_bid: 9, drop_player_id: null, action_id: ACTION.edit })
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(res.body))
    expect(await editClaim(managerAClient, leagueId, claimIds[1], { faab_bid: 8, drop_player_id: null, action_id: ACTION.edit })).toStrictEqual({
      status: 409,
      body: { error: WAIVER_CLAIM_ACTION_ID_REUSED_MESSAGE },
    })
  })

  it('refused by name: a drop not on the team (409, verbatim); another member (the no-leak 403)', async () => {
    const bad = await editClaim(managerAClient, leagueId, claimIds[1], { faab_bid: 9, drop_player_id: 'vitest-wapi-3', action_id: ACTION.editBadDrop })
    expect(bad).toStrictEqual({
      status: 409,
      body: { error: "waiver_claim_edit: Vitest WAPI Three (vitest-wapi-3) is not on WAPI Manager A Team's roster — a claim can only drop one of the team's own players (§13.2)" },
    })
    expect(await editClaim(managerBClient, leagueId, claimIds[1], { faab_bid: 1, drop_player_id: null, action_id: A(34) })).toStrictEqual({
      status: 403,
      body: { error: WAIVER_CLAIM_FORBIDDEN_MESSAGE },
    })
  })
})

describe('POST …/commish/faab — commishEditFaab over the real verb (R1172)', () => {
  it('the manager is refused (no-leak 403); a balance past INTEGER max is a clean 400', async () => {
    expect(await commishEditFaab(managerAClient, leagueId, { team_id: teamAId, balance: 60, action_id: ACTION.faabManager })).toStrictEqual({
      status: 403,
      body: { error: COMMISH_FAAB_FORBIDDEN_MESSAGE },
    })
    const huge = await commishEditFaab(commishClient, leagueId, { team_id: teamAId, balance: 2147483648, action_id: ACTION.faab })
    expect(huge.status).toBe(400)
  })

  it('the commissioner sets team A ABOVE the budget; replay is byte-identical; a reused id for another balance is a 409', async () => {
    const body = { team_id: teamAId, balance: 250, action_id: ACTION.faab }
    const res = await commishEditFaab(commishClient, leagueId, body)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const r = res.body as { faab_balance: number; previous_balance: number; commissioner_action_id: string | null; no_changes: boolean }
    expect([r.faab_balance, r.previous_balance, r.no_changes]).toStrictEqual([250, BALANCE, false])
    expect(r.commissioner_action_id).not.toBeNull()
    const replay = await commishEditFaab(commishClient, leagueId, body)
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(res.body))
    expect(await commishEditFaab(commishClient, leagueId, { ...body, balance: 60 })).toStrictEqual({
      status: 409,
      body: { error: COMMISH_FAAB_ACTION_ID_REUSED_MESSAGE },
    })
  })
})

describe('the reads carry FAAB balance + waiver priority (L.D2.12)', () => {
  it('rosters, standings and the league detail all show team A at $250 and team B at $30', async () => {
    const rosters = await readRosters(managerBClient, leagueId)
    expect(rosters.status).toBe(200)
    const teams = (rosters.body as { teams: Array<{ team_id: string; faab_balance: number | null; waiver_priority: number | null }> }).teams
    const byTeam = new Map(teams.map((t) => [t.team_id, t]))
    expect([byTeam.get(teamAId)?.faab_balance, byTeam.get(teamBId)?.faab_balance]).toStrictEqual([250, BALANCE])
    expect(byTeam.get(teamAId)?.waiver_priority).toBeNull()

    const standings = await readStandings(managerBClient, leagueId)
    expect(standings.status, JSON.stringify(standings.body)).toBe(200)
    const rows = (standings.body as { standings: Array<{ team_id: string; faab_balance: number | null }> }).standings
    // PREMISE: the table lists the seated teams (else the cell is vacuous).
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const byRow = new Map(rows.map((row) => [row.team_id, row.faab_balance]))
    expect([byRow.get(teamAId), byRow.get(teamBId)]).toStrictEqual([250, BALANCE])

    const { data: bUser } = await managerBClient.auth.getUser()
    const detail = await getLeagueDetail(managerBClient, bUser.user!.id, leagueId)
    expect(detail.status).toBe(200)
    const members = (detail.body as { members: Array<{ team_id: string; faab_balance: number | null; waiver_priority: number | null }> }).members
    expect(members.find((m) => m.team_id === teamAId)).toMatchObject({ faab_balance: 250, waiver_priority: null })
  })
})

describe('the league detail carries the waiver window (L.D2.13, F425) — over the real tables', () => {
  it('a member’s detail read at an instant composes the window from the real drafts / nfl_weeks / system_flags reads, never failing the detail', async () => {
    const { data: bUser } = await managerBClient.auth.getUser()
    const at = new Date('2099-09-15T12:00:00.000Z')
    const detail = await getLeagueDetail(managerBClient, bUser.user!.id, leagueId, at)
    expect(detail.status).toBe(200)
    const body = detail.body as { waiver_window: Record<string, unknown> | null; waiver_window_error: string | null }
    // Every read the window makes is member-readable: no error, a window.
    expect(body.waiver_window_error).toBeNull()
    expect(body.waiver_window).toMatchObject({ waivers: true, evaluated_at: at.toISOString(), time_zone: 'America/New_York', paused: false })
    expect(typeof body.waiver_window?.next_run_at).toBe('string')
    // Without an instant (older callers) nothing is read and nothing is claimed.
    const plain = await getLeagueDetail(managerBClient, bUser.user!.id, leagueId)
    expect((plain.body as { waiver_window: unknown }).waiver_window).toBeNull()
  })
})
