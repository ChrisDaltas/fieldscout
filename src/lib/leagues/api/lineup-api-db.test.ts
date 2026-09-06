/**
 * lineup-api-db.test.ts — L.D4.1 items 1 & 3 at the SERVICE layer:
 * `PATCH /api/leagues/[id]/teams/[tid]/lineup` against the LOCAL Supabase
 * stack through PostgREST — the production wire path — with real signed-in
 * clients (the `transactions-api-db.test.ts` shape).
 *
 * pgTAP 060/062 cover `set_lineup`'s LAW DB-side at injected instants (E16,
 * the per-player lock, IR, both `allow_illegal_lineups` settings);
 * `lineups-db.test.ts` covers the raw verb over the wire. What THIS suite
 * proves is the layer those two do not touch:
 *
 *   - the auth matrix a route can get wrong (outsider · a FELLOW manager of
 *     another team · the commissioner without a reason · the commissioner
 *     with one · the team's own manager);
 *   - **that the lock refusal REACHES THE CALLER VERBATIM** (F224(e)/§11.2)
 *     — naming the slot, the player, his kickoff instant, and that every
 *     other unlocked slot stays editable — never swallowed into a generic
 *     failure (probe 2 of the PR: replace the message with a generic string
 *     and the verbatim cell below reds);
 *   - the SQLSTATE → HTTP contract (42501 → 403 · P0001 → 409 · 22023 → 400);
 *   - the `action_id` round trip: a replay of the SAME submit is
 *     byte-identical; a REUSE of the id for a different placement is refused
 *     (F65(b)) — including sent UPPERCASE (R768); an E16 re-seat of the
 *     SAME submit passes the guard through `moved[]`;
 *   - the render duties: `flags`, `rearranged` + `moved[]`, `no_changes`,
 *     `locked_at`, and the canonical `slot_map` all reach the body whole.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226 — every fixture that evaluates a kickoff owns its
 * calendar): the league lives on `SYNTHETIC_SEASON` (2099), whose
 * `nfl_weeks` rows are seeded idempotently; the two `nfl_games` rows this
 * suite places on 2099 week 1 are its own (ids `vitest-la-*`) and deleted
 * in cleanup. The LOCKED game kicked off on a fixed past literal
 * (2001-09-09) and the OPEN game kicks off on a fixed future literal
 * (2099-09-13) — no wall clock is read (the M0 fence) and neither literal
 * can rot: `set_lineup` reads transaction `now()`, which lies between them
 * for the life of this repository. No `DRAFT_INSTANT`: the league is set
 * `in_season` directly, so pg_cron's `draft_tick` has nothing to start.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `afa` — this suite owns it (the D108(14) registry: af0–af9 taken,
 * afa measured free 2026-09-05).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import {
  LINEUP_ACTION_ID_REUSED_MESSAGE,
  LINEUP_FORBIDDEN_MESSAGE,
  setLineup,
  type SetLineupResult,
} from './lineup-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-lineup-api-league'
const GAME_LOCKED_ID = 'vitest-la-locked'
const GAME_OPEN_ID = 'vitest-la-open'
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'
const KICKOFF_FUTURE = '2099-09-13T17:00:00.000Z'

const COMMISH = {
  email: 'lineup-api-commish@fieldscout.test',
  password: 'pgtap-lineup-api-pass-1',
  username: 'la_commish_one',
}
const MANAGER = {
  email: 'lineup-api-manager@fieldscout.test',
  password: 'pgtap-lineup-api-pass-2',
  username: 'la_manager_two',
}
const FELLOW = {
  email: 'lineup-api-fellow@fieldscout.test',
  password: 'pgtap-lineup-api-pass-3',
  username: 'la_fellow_three',
}
const OUTSIDER = {
  email: 'lineup-api-outsider@fieldscout.test',
  password: 'pgtap-lineup-api-pass-4',
  username: 'la_outsider_four',
}

/** The suite's OWN synthetic players, each on a DISTINCT made-up NFL team so
 *  the only players a game row can lock are the ones the suite means to. */
const PLAYERS = [
  { id: 'vitest-la-qb', full_name: 'Vitest LA QB', position: 'QB', team: 'LAA', status: 'Active' },
  { id: 'vitest-la-rb-locked', full_name: 'Vitest LA RB Locked', position: 'RB', team: 'LAB', status: 'Active' },
  { id: 'vitest-la-rb-open', full_name: 'Vitest LA RB Open', position: 'RB', team: 'LAC', status: 'Active' },
  { id: 'vitest-la-wr-a', full_name: 'Vitest LA WR A', position: 'WR', team: 'LAD', status: 'Active' },
  { id: 'vitest-la-wr-b', full_name: 'Vitest LA WR B', position: 'WR', team: 'LAE', status: 'Active' },
  { id: 'vitest-la-wr-c', full_name: 'Vitest LA WR C', position: 'WR', team: 'LAF', status: 'Active' },
  { id: 'vitest-la-te', full_name: 'Vitest LA TE', position: 'TE', team: 'LAG', status: 'Active' },
  { id: 'vitest-la-k', full_name: 'Vitest LA K', position: 'K', team: 'LAH', status: 'Active' },
  { id: 'vitest-la-dst', full_name: 'Vitest LA DST', position: 'DEF', team: 'LAI', status: 'Active' },
] as const
const qb = 'vitest-la-qb'
const rbLocked = 'vitest-la-rb-locked'
const rbOpen = 'vitest-la-rb-open'
const wrA = 'vitest-la-wr-a'
const wrB = 'vitest-la-wr-b'
const wrC = 'vitest-la-wr-c'
const te = 'vitest-la-te'
const k = 'vitest-la-k'
const dst = 'vitest-la-dst'
const TEAM_OF_RB_LOCKED = 'LAB'
const TEAM_OF_WR_A = 'LAD'

const ACTION = {
  league: 'afa00000-0000-4000-8000-000000000001',
  set1: 'afa00000-0000-4000-8000-000000000011',
  reseat: 'afa00000-0000-4000-8000-000000000012',
  lockedEdit: 'afa00000-0000-4000-8000-000000000013',
  unlockedEdit: 'afa00000-0000-4000-8000-000000000014',
  outsider: 'afa00000-0000-4000-8000-000000000015',
  fellow: 'afa00000-0000-4000-8000-000000000016',
  commish: 'afa00000-0000-4000-8000-000000000017',
  badKey: 'afa00000-0000-4000-8000-000000000018',
  notRostered: 'afa00000-0000-4000-8000-000000000019',
  /** R768's fixture: sent UPPERCASE on the wire. */
  upper: 'afa00000-0000-4000-8000-00000000001a',
  restore: 'afa00000-0000-4000-8000-00000000001b',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type SlotMap = Record<string, string>

let commishClient: SupabaseClient<Database>
let managerClient: SupabaseClient<Database>
let fellowClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let managerId: string
let fellowId: string
let leagueId: string
let managerTeamId: string

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
    for (const table of ['matchups', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: gamesError } = await service.from('nfl_games').delete().in('id', [GAME_LOCKED_ID, GAME_OPEN_ID])
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER, FELLOW, OUTSIDER]) {
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

async function storedSlotMap(): Promise<SlotMap> {
  const { data, error } = await service
    .from('team_lineups')
    .select('slot_map')
    .eq('team_id', managerTeamId)
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', 1)
    .single()
  if (error) throw new Error(`storedSlotMap: ${error.message}`)
  return (data.slot_map ?? {}) as SlotMap
}

/** The legal week-1 map: rbLocked's game kicked off in 2001, so he cannot
 *  ENTER a slot — he stays on the bench. */
function baseMap(): SlotMap {
  return {
    'qb:0': qb,
    'rb:0': rbOpen,
    'wr:0': wrA,
    'wr:1': wrB,
    'te:0': te,
    'k:0': k,
    'dst:0': dst,
  }
}

function body(map: SlotMap, actionId: string, extra: Record<string, unknown> = {}) {
  return { week: 1, slot_map: map, action_id: actionId, ...extra }
}

function errorText(result: { body: unknown }): string {
  const err = (result.body as { error?: unknown }).error
  return typeof err === 'string' ? err : JSON.stringify(err)
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  fellowId = await createUser(FELLOW)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)
  fellowClient = await signIn(FELLOW)
  outsiderClient = await signIn(OUTSIDER)

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

  // Two seated managers (service role — fixtures only): the team under test
  // and a FELLOW manager of another franchise (a member who is not this
  // team's manager — the auth cell a route can get wrong).
  const { data: team, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  managerTeamId = team.id
  const { data: fellowTeam, error: fellowTeamError } = await service
    .from('teams')
    .insert({ owner_id: fellowId, name: 'Fellow Team', league_id: leagueId })
    .select('id')
    .single()
  if (fellowTeamError) throw new Error(`teams insert (fellow): ${fellowTeamError.message}`)
  const { error: memberError } = await service.from('league_members').insert([
    { league_id: leagueId, user_id: managerId, team_id: managerTeamId, role: 'manager' },
    { league_id: leagueId, user_id: fellowId, team_id: fellowTeam.id, role: 'manager' },
  ])
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

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
  const { error: rosterError } = await service
    .from('league_rosters')
    .insert(PLAYERS.map((p) => ({ league_id: leagueId, team_id: managerTeamId, player_id: p.id })))
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)

  const { error: gamesError } = await service.from('nfl_games').insert([
    { id: GAME_LOCKED_ID, season: SYNTHETIC_SEASON, week: 1, home_team: TEAM_OF_RB_LOCKED, away_team: 'ZZZ', kickoff_at: KICKOFF_PAST },
    { id: GAME_OPEN_ID, season: SYNTHETIC_SEASON, week: 1, home_team: TEAM_OF_WR_A, away_team: 'ZZY', kickoff_at: KICKOFF_FUTURE },
  ])
  if (gamesError) throw new Error(`nfl_games insert: ${gamesError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('the wire shape — a malformed submit is a field error, never a 500 (Zod on every input)', () => {
  it('an unparseable body, a missing action_id, an out-of-range week and a null slot are each 400', async () => {
    const before = await storedSlotMapOrEmpty()
    for (const raw of [
      null,
      { week: 1, slot_map: baseMap() },
      { week: 19, slot_map: baseMap(), action_id: ACTION.set1 },
      { week: 1, slot_map: { 'qb:0': null }, action_id: ACTION.set1 },
      { week: 1, slot_map: baseMap(), action_id: ACTION.set1, starters: [] },
    ]) {
      const result = await setLineup(managerClient, leagueId, managerTeamId, raw)
      expect(result.status, JSON.stringify(raw)).toBe(400)
      expect(errorText(result)).toContain('fieldErrors')
    }
    expect(await storedSlotMapOrEmpty()).toStrictEqual(before)
  })

  it('a malformed team segment is a 404 from the service, before the RPC', async () => {
    const result = await setLineup(managerClient, leagueId, 'not-a-team', body(baseMap(), ACTION.set1))
    expect(result).toStrictEqual({ status: 404, body: { error: 'Team not found' } })
  })
})

async function storedSlotMapOrEmpty(): Promise<SlotMap> {
  const { data } = await service
    .from('team_lineups')
    .select('slot_map')
    .eq('team_id', managerTeamId)
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', 1)
    .maybeSingle()
  return ((data?.slot_map ?? {}) as SlotMap)
}

describe('the auth matrix (member / non-member / fellow manager / commissioner)', () => {
  it('an OUTSIDER is refused with the one no-leak 403', async () => {
    const result = await setLineup(outsiderClient, leagueId, managerTeamId, body(baseMap(), ACTION.outsider))
    expect(result).toStrictEqual({ status: 403, body: { error: LINEUP_FORBIDDEN_MESSAGE } })
    expect(await storedSlotMapOrEmpty()).toStrictEqual({})
  })

  it('a FELLOW manager (a member, but of another team) is refused with the SAME 403 — no leak between cases', async () => {
    const result = await setLineup(fellowClient, leagueId, managerTeamId, body(baseMap(), ACTION.fellow))
    expect(result).toStrictEqual({ status: 403, body: { error: LINEUP_FORBIDDEN_MESSAGE } })
  })

  it('a nonexistent league answers the same 403 to a member — a missing league is not distinguishable', async () => {
    const result = await setLineup(
      managerClient,
      '00000000-0000-4000-8000-00000000dead',
      managerTeamId,
      body(baseMap(), ACTION.fellow),
    )
    expect(result).toStrictEqual({ status: 403, body: { error: LINEUP_FORBIDDEN_MESSAGE } })
    // …and the family's copy is the READ family's sibling, not the same string
    // (a write refusal names the manager; a read refusal names membership).
    expect(LINEUP_FORBIDDEN_MESSAGE).not.toBe(INSEASON_READ_FORBIDDEN_MESSAGE)
  })

  it('the MANAGER sets the lineup: 200, the canonical map stored, the render duties in the body', async () => {
    const result = await setLineup(managerClient, leagueId, managerTeamId, body(baseMap(), ACTION.set1))
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as SetLineupResult
    expect(doc.team_id).toBe(managerTeamId)
    expect(doc.week).toBe(1)
    expect(doc.action_id).toBe(ACTION.set1)
    expect(doc.slot_map).toStrictEqual(baseMap())
    expect(doc.no_changes).toBe(false)
    expect(doc.rearranged).toBe(false)
    expect(doc.moved).toStrictEqual([])
    expect(doc.edited_by_commish).toBe(false)
    expect(doc.lineup_lock).toBe('per_player_kickoff')
    // flags: rb:1, wr:2 and flex:0 are EMPTY (rbLocked cannot enter; nobody
    // at wr:2 or flex); every other starter's team has no game row — a bye,
    // flagged, never locked (allow_illegal_lineups defaults TRUE).
    expect(doc.flags.illegal).toBe(true)
    expect(doc.flags.empty.length).toBe(3)
    expect(doc.flags.bye.length).toBeGreaterThan(0)
    expect(doc.flags.out).toStrictEqual([])
    expect(doc.flags.ir_ineligible).toStrictEqual([])
    expect(doc.starters.map((s) => s.slot)).toContain('wr:0')
    expect(doc.starters.find((s) => s.slot === 'wr:0')?.kickoff_at).not.toBeNull()
    expect(doc.starters.find((s) => s.slot === 'wr:0')?.flags).toStrictEqual([])
    // locked_at is the RECORD of the earliest kickoff among the STARTERS —
    // the instant the lineup begins locking, rendered as "locks at" (R779),
    // never as the lock itself: wrA starts and his game is in 2099, so it is
    // his kickoff, still ahead.
    expect(new Date(doc.locked_at as string).toISOString()).toBe(KICKOFF_FUTURE)
    expect(doc.bench).toContain(rbLocked)
    expect(doc.bench).toContain(wrC)
    expect(await storedSlotMap()).toStrictEqual(baseMap())
  })

  it('the COMMISSIONER without a reason is 400 with 112\'s own words; with one, 200 and recorded', async () => {
    const before = await storedSlotMap()
    const next = { ...before, 'wr:1': wrC }
    const noReason = await setLineup(commishClient, leagueId, managerTeamId, body(next, ACTION.commish))
    expect(noReason.status).toBe(400)
    expect(errorText(noReason)).toContain("a commissioner setting another team's lineup must give a reason")
    expect(await storedSlotMap()).toStrictEqual(before)

    const withReason = await setLineup(
      commishClient,
      leagueId,
      managerTeamId,
      body(next, ACTION.commish, { reason: 'manager on vacation' }),
    )
    expect(withReason.status, errorText(withReason)).toBe(200)
    const doc = withReason.body as unknown as SetLineupResult
    expect(doc.edited_by_commish).toBe(true)
    expect(doc.reason).toBe('manager on vacation')
    expect(doc.system_post).toContain('reason: manager on vacation')
    expect(await storedSlotMap()).toStrictEqual(next)

    // Put the manager's own map back for the cells that follow (a fresh id —
    // a new gesture).
    const restore = await setLineup(managerClient, leagueId, managerTeamId, body(baseMap(), ACTION.restore))
    expect(restore.status, errorText(restore)).toBe(200)
  })
})

describe('the refusals reach the caller AS THEIR REASON (F224(e)) with the family\'s statuses', () => {
  it('an unknown slot key is 112\'s 22023 → 400, verbatim (the slots the league HAS are named)', async () => {
    const result = await setLineup(managerClient, leagueId, managerTeamId, body({ ...baseMap(), 'zz:0': wrC }, ACTION.badKey))
    expect(result.status).toBe(400)
    expect(errorText(result)).toContain('"zz:0" is not a slot of league')
    expect(errorText(result)).toContain('starting_slots:')
  })

  it('a player not on the roster is 112\'s P0001 → 409, verbatim', async () => {
    const result = await setLineup(
      managerClient,
      leagueId,
      managerTeamId,
      body({ ...baseMap(), 'wr:2': 'vitest-la-nobody' }, ACTION.notRostered),
    )
    expect(result.status).toBe(409)
    expect(errorText(result)).toContain('player vitest-la-nobody is not on team')
  })

  it('THE LOCK REFUSAL, VERBATIM — the slot, the player, his kickoff instant, and that every other slot stays editable (§11.2)', async () => {
    // Lock a stored starter by moving his team's game into the past: wrA sits
    // at wr:0 and his open game is re-timed to 2001 — E42's mechanism, the
    // evaluation-time read, in reverse.
    const { error: moveError } = await service.from('nfl_games').update({ kickoff_at: KICKOFF_PAST }).eq('id', GAME_OPEN_ID)
    expect(moveError).toBeNull()

    const before = await storedSlotMap()
    const result = await setLineup(
      managerClient,
      leagueId,
      managerTeamId,
      body({ ...before, 'wr:0': wrC }, ACTION.lockedEdit),
    )
    expect(result.status).toBe(409)
    // PROBE 2's TARGET: the message is the RPC's, whole. Swallowing it into a
    // generic string reds every line below.
    const text = errorText(result)
    expect(text).toContain('slot wr:0 is locked')
    expect(text).toContain('Vitest LA WR A kicked off at 2001-09-09')
    expect(text).toContain("a locked slot's player never moves")
    expect(text).toContain('every other unlocked slot stays editable')
    expect(text).toContain('lineup_lock = per_player_kickoff')
    expect(text).not.toContain('Something went wrong')
    expect(await storedSlotMap()).toStrictEqual(before)
  })

  it('an unlocked-slot edit on the SAME lineup succeeds post-lock; locked_at now records the (past) earliest kickoff', async () => {
    const before = await storedSlotMap()
    const next = { ...before, 'wr:1': wrC }
    const result = await setLineup(managerClient, leagueId, managerTeamId, body(next, ACTION.unlockedEdit))
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as SetLineupResult
    expect(doc.slot_map['wr:0']).toBe(wrA)
    expect(doc.slot_map['wr:1']).toBe(wrC)
    expect(doc.locked_at).not.toBeNull()
    expect(new Date(doc.locked_at as string).toISOString()).toBe(KICKOFF_PAST)
    expect(await storedSlotMap()).toStrictEqual(next)
  })
})

describe('the action_id round trip (E2/D68(1) + the F65(b) guard + R768)', () => {
  it('a replay of the SAME submit is byte-identical and writes nothing', async () => {
    const before = await storedSlotMap()
    const first = await setLineup(managerClient, leagueId, managerTeamId, body(baseMap(), ACTION.set1))
    const again = await setLineup(managerClient, leagueId, managerTeamId, body(baseMap(), ACTION.set1))
    expect(first.status).toBe(200)
    expect(JSON.stringify(again)).toBe(JSON.stringify(first))
    // The stored row is the LATER lineup (the unlocked edit) — the replay
    // returned the ledger's document and touched nothing.
    expect(await storedSlotMap()).toStrictEqual(before)
    expect((first.body as unknown as SetLineupResult).slot_map).toStrictEqual(baseMap())
  })

  it('a REUSE of the id for a different placement is refused (409), not answered 200 with a lineup never set', async () => {
    const before = await storedSlotMap()
    const result = await setLineup(
      managerClient,
      leagueId,
      managerTeamId,
      body({ ...baseMap(), 'wr:1': wrC, 'wr:2': wrB }, ACTION.set1),
    )
    expect(result).toStrictEqual({ status: 409, body: { error: LINEUP_ACTION_ID_REUSED_MESSAGE } })
    expect(await storedSlotMap()).toStrictEqual(before)
  })

  it('a reuse for a different WEEK is refused too — the replay is (league, action_id)-keyed, the guard is not', async () => {
    const result = await setLineup(managerClient, leagueId, managerTeamId, {
      week: 2,
      slot_map: baseMap(),
      action_id: ACTION.set1,
    })
    expect(result).toStrictEqual({ status: 409, body: { error: LINEUP_ACTION_ID_REUSED_MESSAGE } })
  })

  it('an E16 RE-SEAT of one submit passes the guard through moved[] — rearranged is a fact, not a mismatch', async () => {
    // The TE at wr:0 is per-slot invalid (WR takes WR only); 112 re-seats him
    // along an augmenting path to te:0, and wr:0 reads empty. The guard must
    // accept its own re-seat; wr:0 is locked (wrA kicked off) so the current
    // map keeps him there and the TE goes to wr:2 → te:0 instead.
    const current = await storedSlotMap()
    const submitted: SlotMap = { ...current, 'wr:2': te }
    delete submitted['te:0']
    const result = await setLineup(managerClient, leagueId, managerTeamId, body(submitted, ACTION.reseat))
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as SetLineupResult
    expect(doc.rearranged).toBe(true)
    expect(doc.moved).toHaveLength(1)
    expect(doc.moved[0].player_id).toBe(te)
    expect(doc.moved[0].from).toBe('wr:2')
    // The augmenting path lands him on a TE-eligible free slot — te:0 or the
    // flex — whichever 112's slot order reaches first; the pin is that the
    // canonical map holds him THERE and not at wr:2.
    expect(['te:0', 'flex:0']).toContain(doc.moved[0].to)
    expect(doc.slot_map[doc.moved[0].to]).toBe(te)
    expect(doc.slot_map['wr:2']).toBeUndefined()
    // And its replay — the same submitted map — still passes.
    const again = await setLineup(managerClient, leagueId, managerTeamId, body(submitted, ACTION.reseat))
    expect(JSON.stringify(again)).toBe(JSON.stringify(result))
  })

  it('UPPERCASE ids on the wire commit AND are reported as committed (R768) — never a 409 for a set that landed', async () => {
    const current = await storedSlotMap()
    const next = { ...current, 'wr:1': wrB }
    expect(current['wr:1']).not.toBe(wrB) // a real change, not a no-op
    const result = await setLineup(
      managerClient,
      leagueId,
      managerTeamId.toUpperCase(),
      body(next, ACTION.upper.toUpperCase()),
    )
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as SetLineupResult
    expect(doc.action_id).toBe(ACTION.upper)
    expect(doc.team_id).toBe(managerTeamId)
    // The lowercase replay of the same submit is the same document.
    const again = await setLineup(managerClient, leagueId, managerTeamId, body(next, ACTION.upper))
    expect(JSON.stringify(again)).toBe(JSON.stringify(result))
    // …and an uppercase REUSE for a different placement is still caught.
    const reuse = await setLineup(
      managerClient,
      leagueId,
      managerTeamId,
      body({ ...next, 'wr:1': wrC }, ACTION.upper.toUpperCase()),
    )
    expect(reuse).toStrictEqual({ status: 409, body: { error: LINEUP_ACTION_ID_REUSED_MESSAGE } })
  })

  it('members read the row under the F18 swap; the outsider reads nothing; nobody writes directly', async () => {
    const { data: managerRows } = await managerClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(managerRows).toHaveLength(1)
    const { data: fellowRows } = await fellowClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(fellowRows).toHaveLength(1)
    const { data: outsiderRows } = await outsiderClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(outsiderRows).toHaveLength(0)
    const { data: directWrite } = await managerClient
      .from('team_lineups')
      .update({ total_points: 1 })
      .eq('team_id', managerTeamId)
      .select('id')
    expect(directWrite).toHaveLength(0)
  })
})
