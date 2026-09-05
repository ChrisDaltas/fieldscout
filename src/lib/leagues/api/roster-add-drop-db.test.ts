/**
 * roster-add-drop-db.test.ts — L.D1.5 item 4 at the WIRE layer: two managers
 * RACE one FCFS add through `roster_add_drop` over PostgREST as REAL
 * signed-in users (the production wire path — no API route exists yet;
 * L.D4.2 owns the routes and hooks). Exactly one wins, the other gets the
 * FRIENDLY exclusivity refusal (P0001 — never a raw 23505), exclusivity
 * holds in `league_rosters`, the pool mirror says `rostered` once, the
 * winner's replay is byte-identical, the loser's retry still refuses, and
 * after the winner drops him the loser's add refuses on WAIVER STATE. pgTAP
 * 061 covers the law DB-side at injected instants (E32 both sides, caps,
 * fa_hold, the lineup interplay); this suite proves the public verb's
 * transaction-`now()` behaviour under real concurrency and the SQLSTATEs
 * the wire carries.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226 — every fixture that evaluates a kickoff owns its
 * calendar): the league is created on `SYNTHETIC_SEASON` (2099), whose
 * `nfl_weeks` rows are seeded idempotently and never cleaned. This suite
 * places NO game rows: the contested player's made-up NFL team (`VPA`) has
 * no game in any week, so E32 reads him as a bye (when a sibling suite has
 * placed 2099 week-1 rows) or as free under the week datum (2099-09-09,
 * always ahead) — never locked, and no clock is read anywhere here (the M0
 * fence). No `DRAFT_INSTANT`: the league is set `in_season` directly (the
 * lineups-db shape), so pg_cron's draft_tick has nothing to start.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**`). Action-id prefix `af6` — this
 * suite owns it (the D108(14) registry: af0–af4 taken, af5 taken by the
 * solvency property suite; af6 measured free 2026-09-02).
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

const LEAGUE_NAME = 'vitest-roster-add-drop-league'

const COMMISH = {
  email: 'roster-add-drop-commish@fieldscout.test',
  password: 'pgtap-add-drop-pass-1',
  username: 'pd_commish_one',
}
const MANAGER_A = {
  email: 'roster-add-drop-manager-a@fieldscout.test',
  password: 'pgtap-add-drop-pass-2',
  username: 'pd_manager_a',
}
const MANAGER_B = {
  email: 'roster-add-drop-manager-b@fieldscout.test',
  password: 'pgtap-add-drop-pass-3',
  username: 'pd_manager_b',
}
const OUTSIDER = {
  email: 'roster-add-drop-outsider@fieldscout.test',
  password: 'pgtap-add-drop-pass-4',
  username: 'pd_outsider_four',
}

/**
 * The suite's OWN synthetic players (the lineups-db shape: upserted in
 * beforeAll, deleted in cleanup; the F199 census counts them to zero
 * afterwards), on made-up NFL abbreviations so no real game row can ever
 * lock them.
 */
const PLAYERS = [
  { id: 'vitest-pd-fa', full_name: 'Vitest PD Contested FA', position: 'WR', team: 'VPA', status: 'Active' },
  { id: 'vitest-pd-fa2', full_name: 'Vitest PD Second FA', position: 'RB', team: 'VPB', status: 'Active' },
] as const
const CONTESTED = 'vitest-pd-fa'
const SECOND = 'vitest-pd-fa2'

const ACTION = {
  league: 'af600000-0000-4000-8000-000000000001',
  raceA: 'af600000-0000-4000-8000-000000000011',
  raceB: 'af600000-0000-4000-8000-000000000012',
  retryB: 'af600000-0000-4000-8000-000000000013',
  drop: 'af600000-0000-4000-8000-000000000014',
  afterDropB: 'af600000-0000-4000-8000-000000000015',
  outsider: 'af600000-0000-4000-8000-000000000016',
  commish: 'af600000-0000-4000-8000-000000000017',
  second: 'af600000-0000-4000-8000-000000000018',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type AddDropResult = {
  transaction_id: string
  action_id: string
  team_id: string
  week: number
  add_player_id: string | null
  drop_player_id: string | null
  add: { from_state: string; to_state: string; slot_key: string; game_lock: { locked: boolean } } | null
  drop: { to_state: string; waivers_until: string | null } | null
}

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let managerAId: string
let managerBId: string
let leagueId: string
let teamAId: string
let teamBId: string

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
    // The learned order (D306(6)): release the league graph before teams —
    // transactions references teams (initiator_team_id, no cascade).
    for (const table of [
      'transactions',
      'league_player_pool',
      'matchups',
      'league_weeks',
      'league_rosters',
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
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER_A, MANAGER_B, OUTSIDER]) {
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
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

async function rosterRowsFor(playerId: string): Promise<Array<{ team_id: string; slot_key: string | null }>> {
  const { data, error } = await service
    .from('league_rosters')
    .select('team_id, slot_key')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
  if (error) throw new Error(`rosterRowsFor: ${error.message}`)
  return data ?? []
}

async function poolRowFor(playerId: string): Promise<{ state: string; waivers_until: string | null } | null> {
  const { data, error } = await service
    .from('league_player_pool')
    .select('state, waivers_until')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (error) throw new Error(`poolRowFor: ${error.message}`)
  return data
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  managerAId = await createUser(MANAGER_A)
  managerBId = await createUser(MANAGER_B)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)
  outsiderClient = await signIn(OUTSIDER)

  // The league, created by the commissioner through the real verb on the
  // synthetic season with the catalog defaults (the game-day lock is a rule since 115, 48h
  // waivers, immediate_after_waivers, unlimited caps, no fa_hold).
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

  // Two seated managers (service role — fixtures only): a franchise + the
  // league_members cache row that the verb's in-body auth reads (F35).
  teamAId = await seatManager(managerAId, 'Manager A Team')
  teamBId = await seatManager(managerBId, 'Manager B Team')

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
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('roster_add_drop over PostgREST — two managers race one FCFS add', () => {
  let winnerClient: SupabaseClient<Database>
  let loserClient: SupabaseClient<Database>
  let winnerTeamId: string
  let winnerActionId: string
  let winnerResult: AddDropResult

  it('exactly one manager wins, the other gets the friendly P0001 refusal, and exclusivity holds', async () => {
    const [a, b] = await Promise.all([
      managerAClient.rpc('roster_add_drop', {
        p_league_id: leagueId,
        p_team_id: teamAId,
        p_add: CONTESTED,
        p_action_id: ACTION.raceA,
      }),
      managerBClient.rpc('roster_add_drop', {
        p_league_id: leagueId,
        p_team_id: teamBId,
        p_add: CONTESTED,
        p_action_id: ACTION.raceB,
      }),
    ])
    const outcomes = [
      { client: managerAClient, teamId: teamAId, actionId: ACTION.raceA, res: a },
      { client: managerBClient, teamId: teamBId, actionId: ACTION.raceB, res: b },
    ]
    const winners = outcomes.filter((o) => o.res.error === null)
    const losers = outcomes.filter((o) => o.res.error !== null)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)

    const [winner] = winners
    const [loser] = losers
    winnerClient = winner.client
    loserClient = loser.client
    winnerTeamId = winner.teamId
    winnerActionId = winner.actionId
    winnerResult = winner.res.data as unknown as AddDropResult
    expect(winnerResult.add_player_id).toBe(CONTESTED)
    expect(winnerResult.team_id).toBe(winnerTeamId)
    expect(winnerResult.add?.from_state).toBe('free_agent')
    expect(winnerResult.add?.to_state).toBe('rostered')
    expect(winnerResult.add?.slot_key).toBe('bn')
    expect(winnerResult.add?.game_lock.locked).toBe(false)

    // The loser: the FRIENDLY refusal — the league-row lock serializes him
    // behind the winner, so he reaches the exclusivity PRE-CHECK (the
    // unique-index handler is an unpinnable backstop, R757); never a raw
    // 23505. The regex admits both wordings so a weakened lock would still
    // be caught by the `duplicate key` negative below.
    expect(loser.res.error?.code).toBe('P0001')
    expect(loser.res.error?.message).toMatch(/a player is on ONE roster per league \(player exclusivity/)
    expect(loser.res.error?.message).not.toMatch(/duplicate key/)

    // Exclusivity in the table: ONE roster row, the winner's, on the bench.
    const rows = await rosterRowsFor(CONTESTED)
    expect(rows).toStrictEqual([{ team_id: winnerTeamId, slot_key: 'bn' }])
    // The pool mirror: rostered, no waivers_until.
    expect(await poolRowFor(CONTESTED)).toStrictEqual({ state: 'rostered', waivers_until: null })
    // Exactly ONE transactions row for the contested player, stamped with the winner's action_id.
    const { data: txns } = await service
      .from('transactions')
      .select('type, status, initiator_team_id, action_id, week')
      .eq('league_id', leagueId)
    expect(txns).toStrictEqual([
      { type: 'add_drop', status: 'complete', initiator_team_id: winnerTeamId, action_id: winnerActionId, week: 1 },
    ])
  })

  it("the winner's replay is byte-identical and writes nothing; the loser's retry still refuses", async () => {
    const { data, error } = await winnerClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: winnerTeamId,
      p_add: SECOND, // a DIFFERENT add under the SAME action_id — the replay wins
      p_action_id: winnerActionId,
    })
    expect(error).toBeNull()
    expect(JSON.stringify(data)).toBe(JSON.stringify(winnerResult))
    expect(await rosterRowsFor(SECOND)).toHaveLength(0)

    const loserTeamId = winnerTeamId === teamAId ? teamBId : teamAId
    const { error: retryError } = await loserClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: loserTeamId,
      p_add: CONTESTED,
      p_action_id: ACTION.retryB,
    })
    expect(retryError?.code).toBe('P0001')
    expect(retryError?.message).toContain('is already on')
    expect(await rosterRowsFor(CONTESTED)).toHaveLength(1)
  })

  it('after the winner drops him the loser is refused on WAIVER STATE; direct table writes are refused for everyone', async () => {
    const { data, error } = await winnerClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: winnerTeamId,
      p_drop: CONTESTED,
      p_action_id: ACTION.drop,
    })
    expect(error).toBeNull()
    const dropResult = data as unknown as AddDropResult
    expect(dropResult.drop?.to_state).toBe('on_waivers')
    expect(dropResult.drop?.waivers_until).not.toBeNull()
    expect(await rosterRowsFor(CONTESTED)).toHaveLength(0)
    const pool = await poolRowFor(CONTESTED)
    expect(pool?.state).toBe('on_waivers')

    const loserTeamId = winnerTeamId === teamAId ? teamBId : teamAId
    const { error: waiversError } = await loserClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: loserTeamId,
      p_add: CONTESTED,
      p_action_id: ACTION.afterDropB,
    })
    expect(waiversError?.code).toBe('P0001')
    expect(waiversError?.message).toContain('is on waivers until')
    expect(waiversError?.message).toContain("waiver claims are M5's")

    // No client writes anywhere: a manager's direct INSERT into league_rosters
    // is refused by RLS (there is no write policy), his pool/transactions
    // UPDATEs touch 0 rows.
    const { error: directInsert } = await loserClient
      .from('league_rosters')
      .insert({ league_id: leagueId, team_id: loserTeamId, player_id: CONTESTED })
    expect(directInsert?.code).toBe('42501')
    const { data: poolUpdate } = await loserClient
      .from('league_player_pool')
      .update({ state: 'free_agent', waivers_until: null })
      .eq('league_id', leagueId)
      .select('player_id')
    expect(poolUpdate).toHaveLength(0)
    const { data: txnUpdate } = await loserClient
      .from('transactions')
      .update({ status: 'reversed' })
      .eq('league_id', leagueId)
      .select('id')
    expect(txnUpdate).toHaveLength(0)
    // …while members READ the pool and the activity (109's member SELECT).
    const { data: memberPool } = await loserClient.from('league_player_pool').select('player_id').eq('league_id', leagueId)
    expect(memberPool).toHaveLength(1)
  })

  it('an outsider and the commissioner-on-another-team are refused with the one no-leak 42501; a plain add by a manager lands', async () => {
    const { error: outsiderError } = await outsiderClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: teamAId,
      p_add: SECOND,
      p_action_id: ACTION.outsider,
    })
    expect(outsiderError?.code).toBe('42501')
    expect(outsiderError?.message).toBe('roster_add_drop: not the manager of this team')

    const { error: commishError } = await commishClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: teamAId,
      p_add: SECOND,
      p_action_id: ACTION.commish,
    })
    expect(commishError?.code).toBe('42501')
    expect(commishError?.message).toBe('roster_add_drop: not the manager of this team')

    const { data, error } = await managerAClient.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: teamAId,
      p_add: SECOND,
      p_action_id: ACTION.second,
    })
    expect(error).toBeNull()
    expect((data as unknown as AddDropResult).add_player_id).toBe(SECOND)
    expect(await rosterRowsFor(SECOND)).toStrictEqual([{ team_id: teamAId, slot_key: 'bn' }])
    expect(await poolRowFor(SECOND)).toStrictEqual({ state: 'rostered', waivers_until: null })
  })
})
