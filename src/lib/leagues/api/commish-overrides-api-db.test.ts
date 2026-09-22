/**
 * commish-overrides-api-db.test.ts — M6A L.E1.10 at the SERVICE layer: the
 * four commissioner override routes of part 1 (`/commish/score`,
 * `/commish/result`, `/commish/move-player`, `/commish/roster` →
 * `commishEditScore` / `commishSetResult` / `commishMovePlayer` /
 * `commishForceAddDrop` → 126's and 127's verbs) against the LOCAL Supabase
 * stack through PostgREST, with real signed-in clients (the
 * `schedule-edit-api-db.test.ts` rig).
 *
 * pgTAP 074 / 075 cover the verbs' LAW DB-side. What THIS suite proves is
 * the layer above it, ONE stack cell per verb driving the real RPC as a real
 * commissioner (the task's PROOF line), plus:
 *
 *   - **The auth matrix at the wire**: a seated manager who is not the
 *     commissioner gets the route's own no-leak 403 and writes no receipt.
 *   - **The receipt** (`commissioner_actions`, §10.3): every landed override
 *     writes exactly one row keyed by the action_id in `metadata`, with the
 *     reason stored TRIMMED (the service trims before the wire).
 *   - **F65(b) at the wire**: a REUSED action_id naming different numbers is
 *     refused 409 by the service, never answered 200 with the first
 *     submit's document — proved on the real replay ledger, not a double;
 *     and (R1053) the CROSS-DOOR replay on the real ledger too — 126's and
 *     127's ledgers are each SHARED by their two doors (D350), so a
 *     `/result` action_id re-sent to `/score`, and a move id re-sent to
 *     `/roster`, must be a 409 and never the sibling verb's document as a 200.
 *   - **THE REASON IS OPTIONAL END-TO-END (Q66 — Chris, 2026-09-16; spec
 *     v2.16.41; migration 131 / L.E1.15 / F362)**: one cell per verb sends NO
 *     (or a blank) reason and asserts the 200, the NULL-reason receipt and a
 *     system post with NO "— reason:" clause. Between L.E1.10 and L.E1.15
 *     these four cells pinned the transitional 22023 → 400 by name; the sweep
 *     is what re-cut them.
 *
 * Requires the local stack — D59(5) precedent; FAILS loudly when the stack
 * is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226): the league is on `SYNTHETIC_SEASON` (2099) with NO
 * game rows placed; the synthetic players' made-up NFL teams have no game in
 * any week, so no lock is ever read and no clock is read anywhere here.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `b02` — this suite owns it (the D108(14) registry: af0–aff, b00,
 * b01, b05 taken; b02 measured free 2026-09-16 by grep over src/, supabase/
 * tests/, e2e/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import {
  COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE,
  COMMISH_MATCHUP_FORBIDDEN_MESSAGE,
  commishEditScore,
  commishSetResult,
} from './commish-matchup-service'
import {
  COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE,
  COMMISH_ROSTER_FORBIDDEN_MESSAGE,
  commishForceAddDrop,
  commishMovePlayer,
} from './commish-roster-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-overrides-api-league'
const TEAM_COUNT = 8

const COMMISH = {
  email: 'commish-overrides-commish@fieldscout.test',
  password: 'pgtap-co-api-pass-1',
  username: 'co_commish_one',
}
const MEMBER = {
  email: 'commish-overrides-member@fieldscout.test',
  password: 'pgtap-co-api-pass-2',
  username: 'co_member_two',
}

/** The suite's OWN synthetic players (the lineups-db shape), on made-up NFL
 *  abbreviations so no real game row can ever lock them. */
const PLAYERS = [
  { id: 'vitest-co-mover', full_name: 'Vitest CO Mover', position: 'WR', team: 'VCA', status: 'Active' },
  { id: 'vitest-co-fa', full_name: 'Vitest CO Free Agent', position: 'RB', team: 'VCB', status: 'Active' },
] as const
const MOVER = 'vitest-co-mover'
const FREE_AGENT = 'vitest-co-fa'

const ACTION = {
  league: 'b0200000-0000-4000-8000-000000000001',
  score: 'b0200000-0000-4000-8000-000000000011',
  scoreReuse: 'b0200000-0000-4000-8000-000000000011', // deliberately ACTION.score
  scoreNoReason: 'b0200000-0000-4000-8000-000000000012',
  scoreMember: 'b0200000-0000-4000-8000-000000000013',
  result: 'b0200000-0000-4000-8000-000000000021',
  resultNoReason: 'b0200000-0000-4000-8000-000000000022',
  move: 'b0200000-0000-4000-8000-000000000031',
  moveNoReason: 'b0200000-0000-4000-8000-000000000032',
  moveMember: 'b0200000-0000-4000-8000-000000000033',
  roster: 'b0200000-0000-4000-8000-000000000041',
  rosterNoReason: 'b0200000-0000-4000-8000-000000000042',
  scoreBye: 'b0200000-0000-4000-8000-000000000014',
  scoreByeWrong: 'b0200000-0000-4000-8000-000000000015',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface Refusal {
  error: string
}
interface MatchupRow {
  id: string
  week: number
  home_team_id: string
  away_team_id: string | null
}

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let leagueId: string
let commishTeamId: string
let memberTeamId: string

function errorText(result: { body: unknown }): string {
  return String((result.body as Refusal).error)
}

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
    // The learned order (D306(6)): release the league graph before teams.
    // commissioner_actions / commish_*_actions ride the league's ON DELETE
    // CASCADE (123's immutability trigger exempts exactly that arm).
    for (const table of ['transactions', 'league_player_pool', 'league_chat', 'matchups', 'league_weeks', 'league_rosters', 'league_members'] as const) {
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
  for (const u of [COMMISH, MEMBER]) {
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

/** The week's REGULAR rows with an away side, as written. */
async function weekRows(week: number): Promise<MatchupRow[]> {
  const { data, error } = await service
    .from('matchups')
    .select('id, week, home_team_id, away_team_id')
    .eq('league_id', leagueId)
    .eq('week', week)
    .eq('round_type', 'regular')
    .not('away_team_id', 'is', null)
    .order('id')
  if (error) throw new Error(`matchups read: ${error.message}`)
  return data ?? []
}

/** The `commissioner_actions` receipts an override wrote, by the action_id
 *  126/127 store in `metadata`. `reason` is `string | null` (130 §0, Q66). */
async function receiptsFor(actionId: string): Promise<Array<{ action_type: string; target_type: string | null; target_id: string | null; reason: string | null }>> {
  const { data, error } = await service
    .from('commissioner_actions')
    .select('action_type, target_type, target_id, reason')
    .eq('league_id', leagueId)
    .eq('metadata->>action_id', actionId)
  if (error) throw new Error(`commissioner_actions read: ${error.message}`)
  return data ?? []
}

/** The system posts in this league whose text matches `pattern` (SQL LIKE). */
async function systemPostsLike(pattern: string): Promise<string[]> {
  const { data, error } = await service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).like('message', pattern)
  if (error) throw new Error(`league_chat read: ${error.message}`)
  return (data ?? []).map((r) => r.message)
}

async function rosterTeamOf(playerId: string): Promise<string[]> {
  const { data, error } = await service.from('league_rosters').select('team_id').eq('league_id', leagueId).eq('player_id', playerId)
  if (error) throw new Error(`league_rosters read: ${error.message}`)
  return (data ?? []).map((r) => r.team_id)
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)

  const settings = defaultsForTeamCount(TEAM_COUNT)
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

  const { data: commishTeam, error: commishTeamError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('owner_id', commishId)
    .single()
  if (commishTeamError) throw new Error(`commish team read: ${commishTeamError.message}`)
  commishTeamId = commishTeam.id

  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert(
      Array.from({ length: TEAM_COUNT - 1 }, (_, i) => ({
        owner_id: commishId,
        name: `CO Team ${i + 2}`,
        league_id: leagueId,
      })),
    )
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)
  memberTeamId = seats![0].id

  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: memberId, team_id: memberTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)

  // league_weeks (all `upcoming`) + the regular-season matchups, through the
  // real generator (110:759 is the table's first writer).
  const { error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  // THE PREMISE, asserted (§4 rule 14(c)): the mover starts on the
  // commissioner's roster and the free agent is on none.
  const { error: rosterError } = await service
    .from('league_rosters')
    .insert({ league_id: leagueId, team_id: commishTeamId, player_id: MOVER })
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
  const { error: poolError } = await service
    .from('league_player_pool')
    .insert({ league_id: leagueId, player_id: MOVER, state: 'rostered' })
  if (poolError) throw new Error(`league_player_pool insert: ${poolError.message}`)
  expect(await rosterTeamOf(MOVER)).toStrictEqual([commishTeamId])
  expect(await rosterTeamOf(FREE_AGENT)).toStrictEqual([])
}, 60_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// 1. /commish/score → commish_edit_score (126)
// ---------------------------------------------------------------------------

describe('POST …/commish/score — commishEditScore over the real RPC', () => {
  let row: MatchupRow

  it('a commissioner corrects a week-2 score WITH a reason: 200, the identity fields echo, the row carries the numbers, one receipt with the reason TRIMMED', async () => {
    row = (await weekRows(2))[0]
    const res = await commishEditScore(commishClient, leagueId, {
      matchup_id: row.id,
      home_score: 98.4,
      away_score: 101.25,
      action_id: ACTION.score,
      reason: '  stat correction landed after the box score  ',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as {
      matchup_id: string
      action_id: string
      verb: string
      arm: string
      home_score: number
      away_score: number
      result: string
      no_changes: boolean
      commissioner_action_id: string | null
      reason: string | null
      bypassed: string[]
    }
    expect(body.matchup_id).toBe(row.id)
    expect(body.action_id).toBe(ACTION.score)
    expect(body.verb).toBe('commish_edit_score')
    expect(body.arm).toBe('score')
    expect(body.home_score).toBe(98.4)
    expect(body.away_score).toBe(101.25)
    expect(body.result).toBe('away')
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.reason).toBe('stat correction landed after the box score')

    const { data: stored } = await service.from('matchups').select('home_score, away_score, is_overridden').eq('id', row.id).single()
    expect(stored).toStrictEqual({ home_score: 98.4, away_score: 101.25, is_overridden: true })

    const receipts = await receiptsFor(ACTION.score)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'edit_score', target_type: 'matchup', target_id: row.id, reason: 'stat correction landed after the box score' })
  })

  it('F65(b) on the REAL ledger: the same action_id re-sent with DIFFERENT numbers is a 409 — the stored row keeps the first submit’s numbers', async () => {
    const res = await commishEditScore(commishClient, leagueId, {
      matchup_id: row.id,
      home_score: 50,
      away_score: 60,
      action_id: ACTION.scoreReuse,
      reason: 'a different correction on a spent id',
    })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE)
    const { data: stored } = await service.from('matchups').select('home_score, away_score').eq('id', row.id).single()
    expect(stored).toStrictEqual({ home_score: 98.4, away_score: 101.25 })
    expect(await receiptsFor(ACTION.scoreReuse)).toHaveLength(1) // still the first submit’s
  })

  it('a seated manager who is not the commissioner gets the route’s own no-leak 403 and writes nothing', async () => {
    const res = await commishEditScore(memberClient, leagueId, {
      matchup_id: row.id,
      home_score: 1,
      away_score: 2,
      action_id: ACTION.scoreMember,
      reason: 'not mine to make',
    })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_MATCHUP_FORBIDDEN_MESSAGE)
    expect(await receiptsFor(ACTION.scoreMember)).toHaveLength(0)
  })

  it('Q66 (131 / L.E1.15): NO reason LANDS — 200, `reason: null` in the document, ONE receipt with reason NULL, and a system post with NO "— reason:" clause', async () => {
    const target = (await weekRows(2))[1]
    const res = await commishEditScore(commishClient, leagueId, {
      matchup_id: target.id,
      home_score: 70,
      away_score: 71,
      action_id: ACTION.scoreNoReason,
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { matchup_id: string; reason: string | null; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.matchup_id).toBe(target.id)
    expect(body.reason).toBeNull()
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    const receipts = await receiptsFor(ACTION.scoreNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'edit_score', target_id: target.id, reason: null })
    const posts = await systemPostsLike('%score set to 70–71 by %(commissioner override)%')
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toContain('— reason:')
    expect(posts[0]).not.toMatch(/reason/)
  })
})

// ---------------------------------------------------------------------------
// 2. /commish/result → commish_set_result (126)
// ---------------------------------------------------------------------------

describe('POST …/commish/score — a BYE ROW through the route (F366, fixed by L.E1.16)', () => {
  it('a real bye row: `away_score: null` LANDS as the home score alone — 200, the document is a bye document, the stored row carries the number with away NULL, one receipt; a NUMBER for the away side on the same row is 126’s own 22023 (400), verbatim', async () => {
    // v1 regular-season schedules carry no bye (111), so one is planted in
    // week 4 (as a `secondary` row — the team already has a regular home
    // row there, 109:182) the way the engine writes a playoff bye (away NULL, no away
    // score) — the shape 131:1047-1062 gates on. The PREMISE (rule 14(c)):
    // the row really has no away side.
    const { data: bye, error: byeError } = await service
      .from('matchups')
      .insert({ league_id: leagueId, season: SYNTHETIC_SEASON, week: 4, round_type: 'secondary', home_team_id: commishTeamId, away_team_id: null, home_score: 0, away_score: null, status: 'scheduled' })
      .select('id, away_team_id')
      .single()
    if (byeError) throw new Error(`bye row insert: ${byeError.message}`)
    expect(bye.away_team_id).toBeNull()

    const wrong = await commishEditScore(commishClient, leagueId, { matchup_id: bye.id, home_score: 77.7, away_score: 1, action_id: ACTION.scoreByeWrong })
    expect(wrong.status).toBe(400)
    expect(errorText(wrong)).toBe(`commish_edit_score: matchup ${bye.id} is a BYE — there is no away side to score; send p_away as null`)
    expect(await receiptsFor(ACTION.scoreByeWrong)).toHaveLength(0)

    const res = await commishEditScore(commishClient, leagueId, { matchup_id: bye.id, home_score: 77.7, away_score: null, action_id: ACTION.scoreBye })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { away_team_id: string | null; home_score: number; away_score: number | null; no_changes: boolean; verb: string }
    expect(body.verb).toBe('commish_edit_score')
    expect(body.away_team_id).toBeNull()
    expect(body.home_score).toBe(77.7)
    expect(body.away_score).toBeNull()
    expect(body.no_changes).toBe(false)
    const { data: stored } = await service.from('matchups').select('home_score, away_score, is_overridden').eq('id', bye.id).single()
    expect(stored).toStrictEqual({ home_score: 77.7, away_score: null, is_overridden: true })
    expect(await receiptsFor(ACTION.scoreBye)).toHaveLength(1)
  })
})

describe('POST …/commish/result — commishSetResult over the real RPC', () => {
  it('a commissioner sets the HOME side as winner of a week-3 matchup WITH a reason: 200, `result: home`, scores untouched, one receipt', async () => {
    const row = (await weekRows(3))[0]
    const res = await commishSetResult(commishClient, leagueId, {
      matchup_id: row.id,
      winner_team_id: row.home_team_id,
      action_id: ACTION.result,
      reason: 'ineligible starter on the away side',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { matchup_id: string; action_id: string; verb: string; arm: string; result: string; home_team_id: string; no_changes: boolean; commissioner_action_id: string | null }
    expect(body.matchup_id).toBe(row.id)
    expect(body.action_id).toBe(ACTION.result)
    expect(body.verb).toBe('commish_set_result')
    expect(body.arm).toBe('result')
    expect(body.result).toBe('home')
    expect(body.home_team_id).toBe(row.home_team_id)
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()

    const { data: stored } = await service.from('matchups').select('result, is_overridden').eq('id', row.id).single()
    expect(stored).toStrictEqual({ result: 'home', is_overridden: true })
    const receipts = await receiptsFor(ACTION.result)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'set_result', target_type: 'matchup', target_id: row.id, reason: 'ineligible starter on the away side' })
  })

  it('Q66 (131 / L.E1.15): a TAB-ONLY reason is NO reason and LANDS — 200, ONE receipt with reason NULL (not ""), a post with NO "— reason:" clause', async () => {
    const row = (await weekRows(3))[1]
    const res = await commishSetResult(commishClient, leagueId, {
      matchup_id: row.id,
      winner_team_id: row.away_team_id!,
      action_id: ACTION.resultNoReason,
      reason: '\t',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { matchup_id: string; result: string; reason: string | null; commissioner_action_id: string | null }
    expect(body.matchup_id).toBe(row.id)
    expect(body.result).toBe('away')
    expect(body.reason).toBeNull()
    expect(body.commissioner_action_id).not.toBeNull()
    const receipts = await receiptsFor(ACTION.resultNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'set_result', target_id: row.id, reason: null })
    const { data: stored } = await service.from('matchups').select('result').eq('id', row.id).single()
    expect(stored).toStrictEqual({ result: 'away' })
    const posts = await systemPostsLike('%result set to away by %(commissioner override)%')
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toContain('— reason:')
  })

  it('F65(b) CROSS-DOOR on the REAL ledger (R1053): the /result action_id re-sent to /score is a 409 — never the result document answered as a 200 score', async () => {
    const row = (await weekRows(3))[0]
    const res = await commishEditScore(commishClient, leagueId, {
      matchup_id: row.id,
      home_score: 12,
      away_score: 34,
      action_id: ACTION.result, // spent by commishSetResult above; 126's ledger is SHARED by both doors (D350)
      reason: 'a score on a result id',
    })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE)
    const { data: stored } = await service.from('matchups').select('home_score, away_score, result').eq('id', row.id).single()
    expect(stored).toMatchObject({ result: 'home' }) // the first submit's; no score was written
    expect(stored?.home_score).not.toBe(12)
    expect(await receiptsFor(ACTION.result)).toHaveLength(1) // still the first submit's
  })
})

// ---------------------------------------------------------------------------
// 3. /commish/move-player → commish_move_player (127)
// ---------------------------------------------------------------------------

describe('POST …/commish/move-player — commishMovePlayer over the real RPC', () => {
  it('a seated manager gets the route’s own no-leak 403, moves nothing and writes NO receipt (R1054)', async () => {
    const res = await commishMovePlayer(memberClient, leagueId, {
      player_id: MOVER,
      from_team_id: commishTeamId,
      to_team_id: memberTeamId,
      action_id: ACTION.moveMember,
      reason: 'I want him',
    })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_ROSTER_FORBIDDEN_MESSAGE)
    expect(await rosterTeamOf(MOVER)).toStrictEqual([commishTeamId])
    expect(await receiptsFor(ACTION.moveMember)).toHaveLength(0)
  })

  it('a commissioner moves the player from his own team to the member’s WITH a reason: 200, the identity fields echo, league_rosters now holds him on the destination, one receipt', async () => {
    const res = await commishMovePlayer(commishClient, leagueId, {
      player_id: MOVER,
      from_team_id: commishTeamId,
      to_team_id: memberTeamId,
      action_id: ACTION.move,
      reason: 'voided trade unwound by hand',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { verb: string; action_id: string; player_id: string; from_team_id: string; to_team_id: string; moved_player_id: string; no_changes: boolean; commissioner_action_id: string | null; transaction_id: string | null; affected_team_ids: string[] }
    expect(body.verb).toBe('commish_move_player')
    expect(body.action_id).toBe(ACTION.move)
    expect(body.player_id).toBe(MOVER)
    expect(body.from_team_id).toBe(commishTeamId)
    expect(body.to_team_id).toBe(memberTeamId)
    expect(body.moved_player_id).toBe(MOVER)
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.transaction_id).not.toBeNull()
    expect([...body.affected_team_ids].sort()).toStrictEqual([commishTeamId, memberTeamId].sort())
    expect(await rosterTeamOf(MOVER)).toStrictEqual([memberTeamId])
    const receipts = await receiptsFor(ACTION.move)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ reason: 'voided trade unwound by hand' })
  })

  it('Q66 (131 / L.E1.15): NO reason LANDS — the commissioner moves him BACK: 200, ONE receipt with reason NULL, a post with NO "— reason:" clause', async () => {
    const res = await commishMovePlayer(commishClient, leagueId, {
      player_id: MOVER,
      from_team_id: memberTeamId,
      to_team_id: commishTeamId,
      action_id: ACTION.moveNoReason,
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { moved_player_id: string; reason: string | null; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.moved_player_id).toBe(MOVER)
    expect(body.reason).toBeNull()
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(await rosterTeamOf(MOVER)).toStrictEqual([commishTeamId])
    const receipts = await receiptsFor(ACTION.moveNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'move_player', reason: null })
    const posts = await systemPostsLike('Vitest CO Mover moved from CO Team 2 to Commish Team by %(commissioner override)%')
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toContain('— reason:')
  })
})

// ---------------------------------------------------------------------------
// 4. /commish/roster → commish_force_add_drop (127)
// ---------------------------------------------------------------------------

describe('POST …/commish/roster — commishForceAddDrop over the real RPC', () => {
  it('a commissioner force-adds the free agent to his own roster WITH a reason: 200, the identity fields echo, league_rosters holds him, the pool says rostered, one receipt', async () => {
    const res = await commishForceAddDrop(commishClient, leagueId, {
      team_id: commishTeamId,
      add_player_id: FREE_AGENT,
      action_id: ACTION.roster,
      reason: 'manager unreachable — IR replacement',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { verb: string; action_id: string; team_id: string; add_player_id: string | null; drop_player_id: string | null; added_player_id: string | null; acquisition_type: string | null; no_changes: boolean; commissioner_action_id: string | null; caps: { commissioner_move_not_counted: boolean } }
    expect(body.verb).toBe('commish_force_add_drop')
    expect(body.action_id).toBe(ACTION.roster)
    expect(body.team_id).toBe(commishTeamId)
    expect(body.add_player_id).toBe(FREE_AGENT)
    expect(body.drop_player_id).toBeNull()
    expect(body.added_player_id).toBe(FREE_AGENT)
    expect(body.acquisition_type).toBe('commissioner')
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.caps.commissioner_move_not_counted).toBe(true)
    expect(await rosterTeamOf(FREE_AGENT)).toStrictEqual([commishTeamId])
    const { data: pool } = await service.from('league_player_pool').select('state').eq('league_id', leagueId).eq('player_id', FREE_AGENT).single()
    expect(pool).toStrictEqual({ state: 'rostered' })
    const receipts = await receiptsFor(ACTION.roster)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ reason: 'manager unreachable — IR replacement' })
  })

  it('Q66 (131 / L.E1.15): a BLANK reason is NO reason and the force-DROP LANDS — 200, ONE receipt with reason NULL (not ""), the free agent is off the roster, a post with NO "— reason:" clause', async () => {
    const res = await commishForceAddDrop(commishClient, leagueId, {
      team_id: commishTeamId,
      drop_player_id: FREE_AGENT,
      action_id: ACTION.rosterNoReason,
      reason: '   ',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { drop_player_id: string | null; reason: string | null; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.drop_player_id).toBe(FREE_AGENT)
    expect(body.reason).toBeNull()
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(await rosterTeamOf(FREE_AGENT)).toStrictEqual([])
    const receipts = await receiptsFor(ACTION.rosterNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'force_drop', reason: null })
    const posts = await systemPostsLike('Commish Team: dropped Vitest CO Free Agent by %(commissioner override)%')
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toContain('— reason:')
  })

  it('F65(b) CROSS-DOOR on the REAL ledger (R1053): the /move-player action_id re-sent to /roster is a 409 — never the move document answered as a 200 add', async () => {
    const res = await commishForceAddDrop(commishClient, leagueId, {
      team_id: commishTeamId,
      add_player_id: FREE_AGENT,
      action_id: ACTION.move, // spent by commishMovePlayer above; 127's ledger is SHARED by both doors (D350)
      reason: 'an add on a move id',
    })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE)
    expect(await rosterTeamOf(FREE_AGENT)).toStrictEqual([]) // nothing was added
    expect(await receiptsFor(ACTION.move)).toHaveLength(1) // still the move's
  })
})
