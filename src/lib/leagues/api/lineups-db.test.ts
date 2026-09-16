/**
 * lineups-db.test.ts — L.D1.4 item 5 at the WIRE layer: a manager sets a
 * lineup through `set_lineup` over PostgREST as a REAL signed-in user (the
 * production wire path — no API route exists yet; L.D4.1 owns the routes and
 * hooks), a locked-slot edit refuses with the friendly message, and an
 * unlocked-slot edit on the same lineup succeeds post-lock. pgTAP 060 covers
 * the law DB-side at injected instants; this suite proves the public verb's
 * transaction-`now()` behaviour, the RLS swap as seen by real clients, the
 * replay, and the SQLSTATE the wire carries.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/R724 — every fixture that evaluates a kickoff owns its
 * calendar): the league is created on `SYNTHETIC_SEASON` (2099), whose
 * `nfl_weeks` rows are seeded idempotently and never cleaned; the two
 * `nfl_games` rows this suite places on 2099 week 1 are its own (ids
 * `vitest-lu-*`) and are deleted in cleanup. The LOCKED game kicked off on a
 * fixed past literal (2001-09-09) and the OPEN game kicks off on a fixed
 * future literal (2099-09-13) — no wall clock is read anywhere here (the M0
 * fence), and neither literal can rot: `set_lineup` reads transaction
 * `now()`, which lies between them for the life of this repository.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**`). Action-id prefix `af4` — this
 * suite owns it (the D108(14) registry: af0 members, af1 league-lists, af2,
 * af3 taken; af4 measured free 2026-09-02).
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

const LEAGUE_NAME = 'vitest-lineups-league'
const GAME_LOCKED_ID = 'vitest-lu-locked'
const GAME_OPEN_ID = 'vitest-lu-open'
/** A kickoff that has ALWAYS passed — the locked game. */
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'
/** A kickoff that is ALWAYS ahead — the open game (the synthetic season's own year). */
const KICKOFF_FUTURE = '2099-09-13T17:00:00.000Z'

const COMMISH = {
  email: 'lineups-api-commish@fieldscout.test',
  password: 'pgtap-lineups-pass-1',
  username: 'lu_commish_one',
}
const MANAGER = {
  email: 'lineups-api-manager@fieldscout.test',
  password: 'pgtap-lineups-pass-2',
  username: 'lu_manager_two',
}
const OUTSIDER = {
  email: 'lineups-api-outsider@fieldscout.test',
  password: 'pgtap-lineups-pass-3',
  username: 'lu_outsider_three',
}

/**
 * The roster this suite drafts by hand — its OWN synthetic players (the
 * draft-core-db shape: upserted in beforeAll, deleted in cleanup; the F199
 * census counts them to zero afterwards), each on a DISTINCT made-up NFL
 * team so the only players a game row can ever lock are the ones the suite
 * means to lock (the lock datum joins `players.team` to
 * `nfl_games.home_team/away_team`; no real team abbreviation is used).
 */
const PLAYERS = [
  { id: 'vitest-lu-qb', full_name: 'Vitest LU QB', position: 'QB', team: 'VLA', status: 'Active' },
  { id: 'vitest-lu-rb-locked', full_name: 'Vitest LU RB Locked', position: 'RB', team: 'VLB', status: 'Active' },
  { id: 'vitest-lu-rb-open', full_name: 'Vitest LU RB Open', position: 'RB', team: 'VLC', status: 'Active' },
  { id: 'vitest-lu-wr-a', full_name: 'Vitest LU WR A', position: 'WR', team: 'VLD', status: 'Active' },
  { id: 'vitest-lu-wr-b', full_name: 'Vitest LU WR B', position: 'WR', team: 'VLE', status: 'Active' },
  { id: 'vitest-lu-wr-c', full_name: 'Vitest LU WR C', position: 'WR', team: 'VLF', status: 'Active' },
  { id: 'vitest-lu-te', full_name: 'Vitest LU TE', position: 'TE', team: 'VLG', status: 'Active' },
  { id: 'vitest-lu-k', full_name: 'Vitest LU K', position: 'K', team: 'VLH', status: 'Active' },
  { id: 'vitest-lu-dst', full_name: 'Vitest LU DST', position: 'DEF', team: 'VLI', status: 'Active' },
] as const
const qb = 'vitest-lu-qb'
const rbLocked = 'vitest-lu-rb-locked'
const rbOpen = 'vitest-lu-rb-open'
const wrA = 'vitest-lu-wr-a'
const wrB = 'vitest-lu-wr-b'
const wrC = 'vitest-lu-wr-c'
const te = 'vitest-lu-te'
const k = 'vitest-lu-k'
const dst = 'vitest-lu-dst'
const TEAM_OF_RB_LOCKED = 'VLB'
const TEAM_OF_WR_A = 'VLD'

const ACTION = {
  league: 'af400000-0000-4000-8000-000000000001',
  set1: 'af400000-0000-4000-8000-000000000011',
  lockedEdit: 'af400000-0000-4000-8000-000000000012',
  unlockedEdit: 'af400000-0000-4000-8000-000000000013',
  outsider: 'af400000-0000-4000-8000-000000000014',
  commish: 'af400000-0000-4000-8000-000000000015',
  /** Q66 / 131: the commissioner arm with NO reason lands. */
  commishNoReason: 'af400000-0000-4000-8000-000000000016',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type SlotMap = Record<string, string>
type SetLineupResult = {
  slot_map: SlotMap
  no_changes: boolean
  edited_by_commish: boolean
  /** NULL when none was given (Q66 / 131). */
  reason: string | null
  starters: Array<{ slot: string; player_id: string | null; flags: string[] }>
  locked_at: string | null
}

let commishClient: SupabaseClient<Database>
let managerClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let managerId: string
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
    // The learned order (D306(6)): release matchups + league_weeks before teams.
    for (const table of ['matchups', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: gamesError } = await service
    .from('nfl_games')
    .delete()
    .in('id', [GAME_LOCKED_ID, GAME_OPEN_ID])
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER, OUTSIDER]) {
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

function omit(map: SlotMap, key: string): SlotMap {
  const next: SlotMap = { ...map }
  delete next[key]
  return next
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

function baseMap(): SlotMap {
  return {
    'qb:0': qb,
    'rb:0': rbLocked,
    'rb:1': rbOpen,
    'wr:0': wrA,
    'wr:1': wrB,
    'te:0': te,
    'k:0': k,
    'dst:0': dst,
  }
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)
  outsiderClient = await signIn(OUTSIDER)

  // The league, created by the commissioner through the real verb on the
  // synthetic season (the catalog's default roster: 1QB/2RB/3WR/1TE/1FLEX/
  // 1K/1DST, bench 6, one unrestricted IR spot).
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

  // Seat the manager (service role — fixtures only): a franchise + the
  // league_members cache row that `set_lineup`'s in-body auth reads (F35).
  const { data: team, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  managerTeamId = team.id
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: managerId, team_id: managerTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  // In season, with the frozen snapshot (the scoring-api-db B5 precedent),
  // and week 1 on the calendar.
  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  // The roster: the suite's nine synthetic players. rbLocked's team plays
  // the LOCKED game and wrA's team the OPEN game; every other player's team
  // has NO game row (a bye — flagged, never locked: allow_illegal_lineups
  // defaults TRUE).
  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service
    .from('league_rosters')
    .insert(PLAYERS.map((p) => ({ league_id: leagueId, team_id: managerTeamId, player_id: p.id })))
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)

  const { error: gamesError } = await service.from('nfl_games').insert([
    {
      id: GAME_LOCKED_ID,
      season: SYNTHETIC_SEASON,
      week: 1,
      home_team: TEAM_OF_RB_LOCKED,
      away_team: 'ZZZ',
      kickoff_at: KICKOFF_PAST,
    },
    {
      id: GAME_OPEN_ID,
      season: SYNTHETIC_SEASON,
      week: 1,
      home_team: TEAM_OF_WR_A,
      away_team: 'ZZY',
      kickoff_at: KICKOFF_FUTURE,
    },
  ])
  if (gamesError) throw new Error(`nfl_games insert: ${gamesError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('set_lineup over PostgREST — the manager, the lock, the swap', () => {
  it('the manager sets a week-1 lineup as a real user: the canonical map is stored and readable by members only', async () => {
    // rbLocked's game kicked off in 2001 — he cannot ENTER a slot. The first
    // set therefore places him nowhere; the pin below proves the refusal is
    // the friendly one, then the lineup is set without him.
    const { error: enterError } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: baseMap(),
      p_action_id: ACTION.set1,
    })
    expect(enterError).not.toBeNull()
    expect(enterError?.code).toBe('P0001')
    expect(enterError?.message).toContain('a player whose game has started cannot enter or move slots')

    const map = omit({ ...baseMap(), 'rb:0': rbOpen }, 'rb:1')
    const { data, error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: map,
      p_action_id: ACTION.set1,
    })
    expect(error).toBeNull()
    const result = data as unknown as SetLineupResult
    expect(result.no_changes).toBe(false)
    expect(result.edited_by_commish).toBe(false)
    expect(result.slot_map).toStrictEqual(map)
    expect(await storedSlotMap()).toStrictEqual(map)

    // The F18 swap as real clients see it: members read, the outsider reads
    // nothing, and NOBODY writes directly.
    const { data: managerRows } = await managerClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(managerRows).toHaveLength(1)
    const { data: commishRows } = await commishClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(commishRows).toHaveLength(1)
    const { data: outsiderRows } = await outsiderClient.from('team_lineups').select('id').eq('team_id', managerTeamId)
    expect(outsiderRows).toHaveLength(0)
    const { data: directWrite } = await managerClient
      .from('team_lineups')
      .update({ total_points: 1 })
      .eq('team_id', managerTeamId)
      .select('id')
    expect(directWrite).toHaveLength(0)
  })

  it('a replay of the same action_id returns the stored result and writes nothing', async () => {
    const before = await storedSlotMap()
    const { data, error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: { 'qb:0': qb },
      p_action_id: ACTION.set1,
    })
    expect(error).toBeNull()
    expect((data as unknown as SetLineupResult).slot_map).toStrictEqual(before)
    expect(await storedSlotMap()).toStrictEqual(before)
  })

  it('a locked-slot edit refuses with the friendly message — the lock is read from nfl_games at transaction now()', async () => {
    // Lock a stored starter by moving his team's game into the past: wrA sits
    // at wr:0 and his (open) game is re-timed to 2001 — E42's mechanism in
    // reverse, the same evaluation-time read.
    const { error: moveError } = await service
      .from('nfl_games')
      .update({ kickoff_at: KICKOFF_PAST })
      .eq('id', GAME_OPEN_ID)
    expect(moveError).toBeNull()

    const before = await storedSlotMap()
    const { error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: { ...before, 'wr:0': wrC },
      p_action_id: ACTION.lockedEdit,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('slot wr:0 is locked')
    expect(error?.message).toContain("a locked slot's player never moves")
    expect(error?.message).toContain('every other unlocked slot stays editable')
    expect(await storedSlotMap()).toStrictEqual(before)
  })

  it('an unlocked-slot edit on the SAME lineup succeeds post-lock, the locked slot untouched', async () => {
    const before = await storedSlotMap()
    // wrB's team has no game row in week 1 (a bye — no lock): wr:1 is open;
    // wrC's team has none either, so he may enter.
    const next = { ...before, 'wr:1': wrC }
    const { data, error } = await managerClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: next,
      p_action_id: ACTION.unlockedEdit,
    })
    expect(error).toBeNull()
    const result = data as unknown as SetLineupResult
    expect(result.no_changes).toBe(false)
    expect(result.slot_map['wr:0']).toBe(wrA)
    expect(result.slot_map['wr:1']).toBe(wrC)
    expect(await storedSlotMap()).toStrictEqual(next)
    // …and the record of the lock instant is the OPEN game's (now past)
    // kickoff — the earliest among the starters.
    expect(result.locked_at).not.toBeNull()
    expect(new Date(result.locked_at as string).toISOString()).toBe(KICKOFF_PAST)
  })

  it('an outsider is refused with the one no-leak 42501; the commissioner may set the lineup and is recorded', async () => {
    const before = await storedSlotMap()
    const { error: outsiderError } = await outsiderClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: before,
      p_action_id: ACTION.outsider,
    })
    expect(outsiderError?.code).toBe('42501')
    expect(outsiderError?.message).toBe('set_lineup: not a manager of this team')

    // The commissioner edits an unlocked slot (te:0 → empty is a change) under
    // the same lock law. WITHOUT a reason it LANDS (Q66 — migration 131 /
    // L.E1.15 swept 114:317-321's R738 refusal): the row records
    // edited_by_commish = TRUE and the post carries NO reason clause.
    const next = omit(before, 'te:0')
    const { data: noReasonData, error: noReason } = await commishClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: next,
      p_action_id: ACTION.commishNoReason,
    })
    expect(noReason).toBeNull()
    expect((noReasonData as unknown as SetLineupResult).edited_by_commish).toBe(true)
    expect((noReasonData as unknown as SetLineupResult).reason).toBeNull()
    // With a reason, the change BACK posts it.
    const { data, error } = await commishClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: managerTeamId,
      p_week: 1,
      p_slot_map: before,
      p_action_id: ACTION.commish,
      p_reason: 'manager on vacation',
    })
    expect(error).toBeNull()
    expect((data as unknown as SetLineupResult).edited_by_commish).toBe(true)
    // R738 / Q66: the D97 in-txn system post carries the reason WHEN GIVEN,
    // and no "— reason:" clause otherwise.
    const { data: posts } = await service
      .from('league_chat')
      .select('message')
      .eq('league_id', leagueId)
      .eq('is_system', true)
      .order('message')
    expect(posts?.map((row) => row.message)).toStrictEqual([
      `Week 1 lineup for Manager Team set by ${COMMISH.username} (commissioner)`,
      `Week 1 lineup for Manager Team set by ${COMMISH.username} (commissioner) — reason: manager on vacation`,
    ])
    const { data: row } = await service
      .from('team_lineups')
      .select('edited_by_commish')
      .eq('team_id', managerTeamId)
      .eq('week', 1)
      .single()
    expect(row?.edited_by_commish).toBe(true)
  })
})
