/**
 * waiver-claims-db.test.ts — M5 L.D2.5 at the WIRE layer: the claim verbs
 * (migration 145) under REAL concurrency, as signed-in users over PostgREST.
 * pgTAP 093 pins the law DB-side (refusals by name, E13 per role, the FAAB
 * floor CHECK, blind-safe commissioner receipts); this suite proves what a
 * single-session pgTAP file cannot:
 *
 *   1. two IDENTICAL submits racing (different action_ids) — the league-row
 *      lock serializes them: exactly one lands, the other gets the friendly
 *      by-name P0001, never a raw 23505 from the partial unique index;
 *   2. two submits racing under the SAME action_id — both answer the one
 *      stored result byte-identically, one claim row;
 *   3. a burst of concurrent submits, each bidding the team's WHOLE balance —
 *      every one lands (a claim is a promise, not a debit: TD2) and the
 *      balance is unchanged and ≥ 0 afterwards;
 *   4. the blind read over the wire: another member's SELECT returns none of
 *      this team's claims (E13).
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down. Fixed
 * emails / usernames / action_ids + cleanup-first. Action-id prefix `b5a` —
 * this suite owns it (the D108(14) registry; measured free 2026-09-27).
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

const LEAGUE_NAME = 'vitest-waiver-claims-league'
const BALANCE = 30

const COMMISH = { email: 'waiver-claims-commish@fieldscout.test', password: 'pgtap-wc-pass-1', username: 'wcl_commish' }
const MANAGER_A = { email: 'waiver-claims-manager-a@fieldscout.test', password: 'pgtap-wc-pass-2', username: 'wcl_manager_a' }
const MANAGER_B = { email: 'waiver-claims-manager-b@fieldscout.test', password: 'pgtap-wc-pass-3', username: 'wcl_manager_b' }

const PLAYERS = [
  { id: 'vitest-wc-1', full_name: 'Vitest WC One', position: 'WR', team: 'VWA', status: 'Active' },
  { id: 'vitest-wc-2', full_name: 'Vitest WC Two', position: 'WR', team: 'VWA', status: 'Active' },
  { id: 'vitest-wc-3', full_name: 'Vitest WC Three', position: 'RB', team: 'VWB', status: 'Active' },
  { id: 'vitest-wc-4', full_name: 'Vitest WC Four', position: 'RB', team: 'VWB', status: 'Active' },
  { id: 'vitest-wc-5', full_name: 'Vitest WC Five', position: 'TE', team: 'VWC', status: 'Active' },
  { id: 'vitest-wc-6', full_name: 'Vitest WC Six', position: 'TE', team: 'VWC', status: 'Active' },
] as const

const ACTION = {
  league: 'b5a00000-0000-4000-8000-000000000001',
  raceA: 'b5a00000-0000-4000-8000-000000000011',
  raceB: 'b5a00000-0000-4000-8000-000000000012',
  sameId: 'b5a00000-0000-4000-8000-000000000021',
  burst: [
    'b5a00000-0000-4000-8000-000000000031',
    'b5a00000-0000-4000-8000-000000000032',
    'b5a00000-0000-4000-8000-000000000033',
    'b5a00000-0000-4000-8000-000000000034',
  ],
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type SubmitResult = {
  verb: string
  team_id: string
  claim: { id: string; add_player_id: string; faab_bid: number; claim_order: number; status: string }
  faab_spent: number
}

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let leagueId: string
let teamAId: string

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
    for (const table of ['waiver_claim_actions', 'waiver_claims', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    // ORDER MATTERS (PROGRESS F406): a commissioner-placed claim writes a
    // commissioner_actions row whose `acting_as_team_id` references the team
    // (123:304, no ON DELETE), and that row is immutable except through the
    // league's ON DELETE CASCADE. So the teams are detached from the league,
    // the league is deleted (taking the audit rows with it), THEN the teams.
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
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager', faab_balance: BALANCE })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

async function claimsOfTeamA(): Promise<Array<{ add_player_id: string; faab_bid: number; status: string }>> {
  const { data, error } = await service
    .from('waiver_claims')
    .select('add_player_id, faab_bid, status')
    .eq('team_id', teamAId)
    .order('add_player_id')
  if (error) throw new Error(`claimsOfTeamA: ${error.message}`)
  return data ?? []
}

async function balanceOfTeamA(): Promise<number | null> {
  const { data, error } = await service.from('league_members').select('faab_balance').eq('team_id', teamAId).single()
  if (error) throw new Error(`balanceOfTeamA: ${error.message}`)
  return data.faab_balance
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  const managerAId = await createUser(MANAGER_A)
  const managerBId = await createUser(MANAGER_B)
  commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)

  // The league through the real verb, catalog defaults: waiver_type faab,
  // faab_min_bid 0.
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

  teamAId = await seatManager(managerAId, 'WC Manager A Team')
  await seatManager(managerBId, 'WC Manager B Team')

  const { data: inSeason, error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
    .select('waiver_type')
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  // PREMISE, measured: a FAAB league (the balance cells mean nothing otherwise).
  expect(inSeason).toStrictEqual([{ waiver_type: 'faab' }])

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

describe('waiver_claim_submit over PostgREST under real concurrency (migration 145)', () => {
  it('two IDENTICAL submits race: exactly one lands, the other gets the by-name P0001 — never a raw 23505', async () => {
    const [a, b] = await Promise.all([
      managerAClient.rpc('waiver_claim_submit', {
        p_league_id: leagueId,
        p_team_id: teamAId,
        p_add: 'vitest-wc-1',
        p_bid: 5,
        p_action_id: ACTION.raceA,
      }),
      managerAClient.rpc('waiver_claim_submit', {
        p_league_id: leagueId,
        p_team_id: teamAId,
        p_add: 'vitest-wc-1',
        p_bid: 9,
        p_action_id: ACTION.raceB,
      }),
    ])
    const landed = [a, b].filter((r) => r.error === null)
    const refused = [a, b].filter((r) => r.error !== null)
    expect(landed).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0].error?.code).toBe('P0001')
    expect(refused[0].error?.message).toMatch(/already has a pending claim for Vitest WC One \(vitest-wc-1\) with no drop/)
    expect(refused[0].error?.message).not.toMatch(/duplicate key/)
    const rows = await claimsOfTeamA()
    expect(rows.filter((r) => r.add_player_id === 'vitest-wc-1')).toHaveLength(1)
  })

  it('two submits race under the SAME action_id: one claim row, both answers byte-identical', async () => {
    const call = () =>
      managerAClient.rpc('waiver_claim_submit', {
        p_league_id: leagueId,
        p_team_id: teamAId,
        p_add: 'vitest-wc-2',
        p_bid: 3,
        p_action_id: ACTION.sameId,
      })
    const [a, b] = await Promise.all([call(), call()])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data))
    expect((a.data as unknown as SubmitResult).claim.add_player_id).toBe('vitest-wc-2')
    const rows = await claimsOfTeamA()
    expect(rows.filter((r) => r.add_player_id === 'vitest-wc-2')).toHaveLength(1)
  })

  it('a concurrent burst of whole-balance bids (manager AND commissioner) all land, and the balance is untouched and >= 0 — a claim is a promise, never a debit (TD2)', async () => {
    expect(await balanceOfTeamA()).toBe(BALANCE)
    const players = ['vitest-wc-3', 'vitest-wc-4', 'vitest-wc-5', 'vitest-wc-6'] as const
    const results = await Promise.all(
      players.map((player, i) =>
        (i % 2 === 0 ? managerAClient : commishClient).rpc('waiver_claim_submit', {
          p_league_id: leagueId,
          p_team_id: teamAId,
          p_add: player,
          p_bid: BALANCE,
          p_action_id: ACTION.burst[i],
        }),
      ),
    )
    for (const r of results) {
      expect(r.error).toBeNull()
      expect((r.data as unknown as SubmitResult).faab_spent).toBe(0)
    }
    const whole = (await claimsOfTeamA()).filter((r) => r.faab_bid === BALANCE)
    expect(whole).toHaveLength(4)
    expect(await balanceOfTeamA()).toBe(BALANCE)

    // A bid ONE dollar over the balance is still refused by name afterwards.
    const { error } = await managerAClient.rpc('waiver_claim_submit', {
      p_league_id: leagueId,
      p_team_id: teamAId,
      p_add: 'vitest-wc-6',
      p_bid: BALANCE + 1,
      p_action_id: 'b5a00000-0000-4000-8000-000000000041',
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message).toBe(
      `waiver_claim_submit: a bid of $${BALANCE + 1} is more than WC Manager A Team's FAAB balance of $${BALANCE} (§13.2)`,
    )
  })

  it("E13 over the wire: another member reads none of this team's claims; the owner reads all six; nobody reads the ledger", async () => {
    const { data: other, error: otherError } = await managerBClient.from('waiver_claims').select('id').eq('league_id', leagueId)
    expect(otherError).toBeNull()
    expect(other).toHaveLength(0)
    const { data: own } = await managerAClient.from('waiver_claims').select('id').eq('league_id', leagueId)
    expect(own).toHaveLength(6)
    const { data: ledger } = await managerAClient.from('waiver_claim_actions').select('id').eq('league_id', leagueId)
    expect(ledger).toHaveLength(0)
    const { data: commishView } = await commishClient.from('waiver_claims').select('id').eq('league_id', leagueId)
    expect(commishView).toHaveLength(6)
  })
})
