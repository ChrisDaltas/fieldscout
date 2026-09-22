/**
 * commish-bracket-api-db.test.ts — M6A L.E1.16 at the SERVICE layer:
 * `/commish/bracket` → `commishEditBracket` → migration 134's
 * `commish_edit_bracket` against the LOCAL Supabase stack through PostgREST,
 * with real signed-in clients (the `commish-part2-api-db.test.ts` rig).
 *
 * pgTAP 082 covers the verb's LAW DB-side (the permutation, the seeds, the
 * SURVIVAL through the sync, the refusals by name). What THIS suite proves
 * is the layer above it, on a league walked to `playoffs` with an
 * engine-shaped round 1 (seeded rows, two byes, two games):
 *
 *   - **The auth matrix at the wire**: a seated manager gets the route's
 *     own no-leak 403 and writes no receipt.
 *   - **A hand-pick lands**: 200, the identity fields echo, the target AND
 *     the displaced sibling are re-paired on the real rows, EVERY seeded row
 *     of the round carries `pairing_set_by_action_id` = the receipt, ONE
 *     receipt (action_type `edit_bracket`) with `reason` NULL (Q66 — none
 *     sent), a system post naming the stand-down and no "— reason:" clause.
 *   - **A BYE lands through the route**: `away_team_id: null` reaches the
 *     verb as `p_away: null` (the F366 lesson, not repeated here: a nullable
 *     schema field the service really sends).
 *   - **F65(b) on the REAL ledger**: the hand-pick's action_id re-sent with a
 *     DIFFERENT pairing is a 409 — the rows keep the first submit's.
 *   - **A stranger is refused 409 with 134's copy VERBATIM** and writes no
 *     receipt.
 *
 * Requires the local stack — D59(5) precedent; FAILS loudly when the stack
 * is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226): the league is on `SYNTHETIC_SEASON` (2099) with NO
 * game rows placed; no clock is read anywhere here.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `b04` — this suite owns it (the D108(14) registry: af0–aff, b00,
 * b01, b02, b03, b05 taken; b04 measured free 2026-09-21 by grep over src/,
 * supabase/tests/, e2e/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE, COMMISH_BRACKET_FORBIDDEN_MESSAGE, commishEditBracket, type CommishEditBracketResult } from './commish-bracket-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-bracket-api-league'
const TEAM_COUNT = 8

const COMMISH = { email: 'commish-bracket-commish@fieldscout.test', password: 'pgtap-cb-api-pass-1', username: 'cb_commish_one' }
const MEMBER = { email: 'commish-bracket-member@fieldscout.test', password: 'pgtap-cb-api-pass-2', username: 'cb_member_two' }

const ACTION = {
  league: 'b0400000-0000-4000-8000-000000000001',
  pick: 'b0400000-0000-4000-8000-000000000011',
  pickMember: 'b0400000-0000-4000-8000-000000000012',
  bye: 'b0400000-0000-4000-8000-000000000013',
  stranger: 'b0400000-0000-4000-8000-000000000014',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

interface Refusal {
  error: string
}
interface BracketRow {
  id: string
  home_team_id: string
  away_team_id: string | null
  home_seed: number | null
  away_seed: number | null
  pairing_set_by_action_id: string | null
}

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let leagueId: string
let commishId: string
let teams: string[] // seeds 1..8 in order (index 0 = seed 1)
let playoffWeek: number

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
    for (const table of ['transactions', 'league_player_pool', 'league_chat', 'matchups', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
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

/** The round's seeded playoff rows, by home seed. */
async function roundRows(): Promise<BracketRow[]> {
  const { data, error } = await service
    .from('matchups')
    .select('id, home_team_id, away_team_id, home_seed, away_seed, pairing_set_by_action_id')
    .eq('league_id', leagueId)
    .eq('week', playoffWeek)
    .eq('round_type', 'playoff')
    .not('home_seed', 'is', null)
    .order('home_seed')
  if (error) throw new Error(`matchups read: ${error.message}`)
  return data ?? []
}

/** 066's rendering: `seed:idx v seed:idx | bye`, ordered by home seed. */
function render(rows: BracketRow[]): string {
  const idx = (id: string) => String(teams.indexOf(id) + 1)
  return rows
    .map((r) => `${r.home_seed}:${idx(r.home_team_id)}v${r.away_team_id ? `${r.away_seed}:${idx(r.away_team_id)}` : 'bye'}`)
    .join(',')
}

async function receiptsFor(actionId: string): Promise<Array<{ id: string; action_type: string; target_type: string | null; target_id: string | null; reason: string | null }>> {
  const { data, error } = await service
    .from('commissioner_actions')
    .select('id, action_type, target_type, target_id, reason')
    .eq('league_id', leagueId)
    .eq('metadata->>action_id', actionId)
  if (error) throw new Error(`commissioner_actions read: ${error.message}`)
  return data ?? []
}

async function systemPostsLike(pattern: string): Promise<string[]> {
  const { data, error } = await service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).like('message', pattern)
  if (error) throw new Error(`league_chat read: ${error.message}`)
  return (data ?? []).map((r) => r.message)
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)

  const settings = defaultsForTeamCount(TEAM_COUNT)
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

  const { data: commishTeam, error: commishTeamError } = await service.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', commishId).single()
  if (commishTeamError) throw new Error(`commish team read: ${commishTeamError.message}`)

  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert(Array.from({ length: TEAM_COUNT - 1 }, (_, i) => ({ owner_id: commishId, name: `CB Team ${i + 2}`, league_id: leagueId })))
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)
  teams = [commishTeam.id, ...seats!.map((s) => s.id)]

  const { error: memberError } = await service.from('league_members').insert({ league_id: leagueId, user_id: memberId, team_id: teams[1], role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null }).eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)

  // The engine's round-1 shape, written directly (the rollover's own write,
  // 118:1578-1590 — seeds frozen, byes to the top seeds, outside-in) for
  // playoff_teams 6: 1 bye, 2 bye, 3 v 6, 4 v 5 — in the first playoff week.
  const { data: league, error: leagueError } = await service.from('leagues').select('regular_season_weeks, playoff_teams').eq('id', leagueId).single()
  if (leagueError) throw new Error(`leagues read: ${leagueError.message}`)
  expect(league.playoff_teams).toBe(6)
  const { data: firstWeek } = await service.from('league_weeks').select('week').eq('league_id', leagueId).order('week').limit(1).single()
  playoffWeek = firstWeek!.week + league.regular_season_weeks
  const { error: rowsError } = await service.from('matchups').insert([
    { league_id: leagueId, season: SYNTHETIC_SEASON, week: playoffWeek, round_type: 'playoff', home_team_id: teams[0], away_team_id: null, home_seed: 1, away_seed: null, status: 'scheduled' },
    { league_id: leagueId, season: SYNTHETIC_SEASON, week: playoffWeek, round_type: 'playoff', home_team_id: teams[1], away_team_id: null, home_seed: 2, away_seed: null, status: 'scheduled' },
    { league_id: leagueId, season: SYNTHETIC_SEASON, week: playoffWeek, round_type: 'playoff', home_team_id: teams[2], away_team_id: teams[5], home_seed: 3, away_seed: 6, status: 'scheduled' },
    { league_id: leagueId, season: SYNTHETIC_SEASON, week: playoffWeek, round_type: 'playoff', home_team_id: teams[3], away_team_id: teams[4], home_seed: 4, away_seed: 5, status: 'scheduled' },
  ])
  if (rowsError) throw new Error(`playoff rows insert: ${rowsError.message}`)
  const { error: playoffsError } = await service.from('leagues').update({ status: 'playoffs' }).eq('id', leagueId)
  if (playoffsError) throw new Error(`leagues → playoffs: ${playoffsError.message}`)

  // THE PREMISES, asserted (§4 rule 14(c)).
  expect(render(await roundRows())).toBe('1:1vbye,2:2vbye,3:3v6:6,4:4v5:5')
  expect((await roundRows()).every((r) => r.pairing_set_by_action_id === null)).toBe(true)
  expect((await service.from('commissioner_actions').select('id').eq('league_id', leagueId)).data).toHaveLength(0)
}, 60_000)

afterAll(async () => {
  await cleanup()
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(leagues ?? []).toHaveLength(0)
  for (const u of [COMMISH, MEMBER]) {
    const { data } = await service.from('profiles').select('id').eq('username', u.username)
    expect(data ?? [], u.username).toHaveLength(0)
  }
})

describe('POST …/commish/bracket — commishEditBracket over the real RPC', () => {
  it('a seated manager gets the route’s own no-leak 403, re-pairs nothing and writes NO receipt', async () => {
    const rows = await roundRows()
    const res = await commishEditBracket(memberClient, leagueId, { matchup_id: rows[2].id, home_team_id: teams[2], away_team_id: teams[4], action_id: ACTION.pickMember })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_BRACKET_FORBIDDEN_MESSAGE)
    expect(render(await roundRows())).toBe('1:1vbye,2:2vbye,3:3v6:6,4:4v5:5')
    expect(await receiptsFor(ACTION.pickMember)).toHaveLength(0)
  })

  it('a commissioner hand-picks 3 v 5 with NO reason: 200, the identity fields echo with the teams’ seeds, the sibling takes the displaced 6, EVERY row of the round is MARKED with the receipt, one receipt (edit_bracket, reason NULL), a post naming the stand-down and no "— reason:" clause', async () => {
    const before = await roundRows()
    const res = await commishEditBracket(commishClient, leagueId, { matchup_id: before[2].id, home_team_id: teams[2], away_team_id: teams[4], action_id: ACTION.pick })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const doc = res.body as unknown as CommishEditBracketResult
    expect(doc.verb).toBe('commish_edit_bracket')
    expect(doc.action_id).toBe(ACTION.pick)
    expect(doc.matchup.matchup_id).toBe(before[2].id)
    expect(doc.matchup.after).toStrictEqual({ home_team_id: teams[2], away_team_id: teams[4], home_seed: 3, away_seed: 5 })
    expect(doc.no_changes).toBe(false)
    expect(doc.rows_changed).toBe(2)
    expect(doc.rows_marked).toBe(4)
    expect(doc.bypassed).toStrictEqual(['bracket_sync_rebuild:stood_down'])
    expect(doc.reason).toBeNull()
    expect(doc.reason_required).toBe(false)
    expect(doc.round).toBe(1)
    expect(doc.weeks).toStrictEqual([playoffWeek, playoffWeek])

    const after = await roundRows()
    expect(render(after)).toBe('1:1vbye,2:2vbye,3:3v5:5,4:4v6:6')
    const receipts = await receiptsFor(ACTION.pick)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'edit_bracket', target_type: 'bracket', target_id: before[2].id, reason: null })
    expect(doc.commissioner_action_id).toBe(receipts[0].id)
    expect(after.map((r) => r.pairing_set_by_action_id)).toStrictEqual([receipts[0].id, receipts[0].id, receipts[0].id, receipts[0].id])
    const posts = await systemPostsLike('Playoff round 1 (week %) matchup hand-picked by cb_commish_one (commissioner override): %')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('— lifted: bracket_sync_rebuild:stood_down')
    expect(posts[0]).not.toContain('reason:')
  })

  it('F65(b) on the REAL ledger: the hand-pick’s action_id re-sent with a DIFFERENT pairing is a 409 — the rows keep the first submit’s', async () => {
    const rows = await roundRows()
    const res = await commishEditBracket(commishClient, leagueId, { matchup_id: rows[2].id, home_team_id: teams[2], away_team_id: teams[5], action_id: ACTION.pick })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE)
    expect(render(await roundRows())).toBe('1:1vbye,2:2vbye,3:3v5:5,4:4v6:6')
    expect(await receiptsFor(ACTION.pick)).toHaveLength(1)
  })

  it('a BYE lands THROUGH THE ROUTE: seed 1’s bye becomes 1 v 4 (`away_team_id` a team), then 4’s old pairing is normalised to 6’s bye — `away_team_id: null` on the wire reaches the verb as p_away NULL (the F366 lesson)', async () => {
    const rows = await roundRows()
    // Give seed 1 an opponent: the bye row's away becomes team 4; 4's pairing (4 v 6) loses its home and 6 holds the bye.
    const res = await commishEditBracket(commishClient, leagueId, { matchup_id: rows[0].id, home_team_id: teams[0], away_team_id: teams[3], action_id: ACTION.bye })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const doc = res.body as unknown as CommishEditBracketResult
    expect(doc.siblings).toHaveLength(1)
    expect(doc.siblings[0]).toMatchObject({ home_after: teams[5], away_after: null, bye_normalised: true })
    expect(render(await roundRows())).toBe('1:1v4:4,2:2vbye,3:3v5:5,6:6vbye')
    // …and the bye direction itself through the same schema: the document
    // for a bye request echoes `away_team_id: null`, and the guard accepts
    // it (a two-team document for a bye submit is what 409s — unit-pinned).
    const byeRow = (await roundRows()).find((r) => r.home_seed === 6)!
    const noop = await commishEditBracket(commishClient, leagueId, { matchup_id: byeRow.id, home_team_id: teams[5], away_team_id: null, action_id: 'b0400000-0000-4000-8000-000000000015' })
    expect(noop.status, JSON.stringify(noop.body)).toBe(200)
    expect((noop.body as unknown as CommishEditBracketResult).no_changes).toBe(true)
    expect((noop.body as unknown as CommishEditBracketResult).matchup.after.away_team_id).toBeNull()
  })

  it('a team from OUTSIDE the round is refused 409 with 134’s copy VERBATIM (the subset rule) and writes NO receipt', async () => {
    const rows = await roundRows()
    const res = await commishEditBracket(commishClient, leagueId, { matchup_id: rows[2].id, home_team_id: teams[2], away_team_id: teams[6], action_id: ACTION.stranger })
    expect(res.status).toBe(409)
    expect(errorText(res)).toContain(`commish_edit_bracket: team ${teams[6]} is not in round 1 of league ${leagueId} — the round’s entrants are the 6 teams seeded on its rows`.replace('’', "'"))
    expect(await receiptsFor(ACTION.stranger)).toHaveLength(0)
  })
})
