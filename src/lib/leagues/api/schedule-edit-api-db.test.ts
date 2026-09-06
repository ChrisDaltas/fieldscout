/**
 * schedule-edit-api-db.test.ts — L.D5.3 / F233(e) at the SERVICE layer: the
 * commissioner's manual matchup edit (`POST …/schedule/matchup` →
 * `editMatchup` → 111's `schedule_edit_matchup`) against the LOCAL Supabase
 * stack through PostgREST, with real signed-in clients (the
 * `schedule-api-db.test.ts` rig).
 *
 * pgTAP 059 covers 111's LAW DB-side (the parked permutation, the in-body
 * re-validation, the E41 window at kickoff ±1s on every datum arm — inside
 * a transaction `now()` is frozen, which is what makes ±1s exact there).
 * What THIS suite proves is the layer above it:
 *
 *   - **ONE matchup's two teams, never a schedule.** The body is a strict
 *     object; a `matchups`/`proposed` array is REFUSED (400), not ignored.
 *     A pairing change that touches a sibling re-seats the displaced teams
 *     SERVER-side and the week still seats every team exactly once.
 *   - **The auth matrix**: a manager who is not the commissioner and an
 *     outsider share one no-leak 403; neither writes a ledger row.
 *   - **The `action_id` round trip**: a replay is byte-identical and writes
 *     nothing; a REUSE for a different pairing is refused rather than
 *     answered 200 with the first edit's result (F65(b)); both hold with the
 *     ids sent UPPERCASE (R768).
 *   - **E41's two states through the route** (F233(e)'s "the E41 pair"):
 *     with the league's Week 1 kickoff AHEAD (a 2099 game row) an edit needs
 *     no reason; with it BEHIND (a 2001 game row) the same edit is refused
 *     by name without a reason (22023 → 400, verbatim) and succeeds with
 *     one, the system post carrying the override and the reason. The
 *     instants are the F215/F226 literals (2001-09-09 / 2099-09-13 — neither
 *     can rot around transaction `now()`); the ±1s boundary itself is 059's.
 *   - The family mapping: P0001 → 409 and P0002 → 404 with the RPC's copy
 *     verbatim; the D97 system post lands in the activity feed.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `afc` — this suite owns it (the D108(14) registry: af0–afb taken,
 * afc measured free 2026-09-05).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { readActivity } from './activity-service'
import { SCHEDULE_EDIT_ACTION_ID_REUSED_MESSAGE, SCHEDULE_FORBIDDEN_MESSAGE, editMatchup } from './schedule-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-schedule-edit-api-league'
const TEAM_COUNT = 8

/** The league's Week 1 game row for the E41 pair — the F215/F226 literals. */
const WEEK1_GAME_ID = 'vitest-sedit-w1-game'
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'
const KICKOFF_FUTURE = '2099-09-13T17:00:00.000Z'

const COMMISH = {
  email: 'schedule-edit-commish@fieldscout.test',
  password: 'pgtap-sedit-api-pass-1',
  username: 'se_commish_one',
}
const MEMBER = {
  email: 'schedule-edit-member@fieldscout.test',
  password: 'pgtap-sedit-api-pass-2',
  username: 'se_member_two',
}
const OUTSIDER = {
  email: 'schedule-edit-outsider@fieldscout.test',
  password: 'pgtap-sedit-api-pass-3',
  username: 'se_outsider_three',
}

const ACTION = {
  league: 'afc00000-0000-4000-8000-000000000001',
  free: 'afc00000-0000-4000-8000-000000000011',
  reuse: 'afc00000-0000-4000-8000-000000000011', // deliberately ACTION.free
  noChange: 'afc00000-0000-4000-8000-000000000012',
  notMine: 'afc00000-0000-4000-8000-000000000013',
  member: 'afc00000-0000-4000-8000-000000000014',
  outsider: 'afc00000-0000-4000-8000-000000000015',
  forged: 'afc00000-0000-4000-8000-000000000016',
  overrideNoReason: 'afc00000-0000-4000-8000-000000000017',
  overrideWithReason: 'afc00000-0000-4000-8000-000000000018',
  futureFree: 'afc00000-0000-4000-8000-000000000019',
  /** R768's fixture: sent UPPERCASE on the wire. */
  upper: 'afc00000-0000-4000-8000-00000000001a',
} as const

const NO_SUCH_MATCHUP = 'afc00000-0000-4000-8000-0000000000ff'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface Refusal {
  error: string
}
interface Pairing {
  home_team_id: string
  away_team_id: string
}
interface EditResult {
  action_id: string
  week: number
  round_type: string
  matchup: { matchup_id: string; before: Pairing; after: Pairing }
  siblings: Array<{ matchup_id: string; before: Pairing; after: Pairing; vacated_sides: string[] }>
  rows_changed: number
  reason_required: boolean
  window: { free: boolean; reason_required: boolean; datum_arm: string }
  system_post: string
}
interface WeekRow {
  id: string
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
}

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string

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
    const { error: actionsError } = await service.from('schedule_actions').delete().in('league_id', ids)
    if (actionsError) throw new Error(`cleanup schedule_actions: ${actionsError.message}`)
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: gameError } = await service.from('nfl_games').delete().eq('id', WEEK1_GAME_ID)
  if (gameError) throw new Error(`cleanup nfl_games: ${gameError.message}`)
  for (const u of [COMMISH, MEMBER, OUTSIDER]) {
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

/** The week's REGULAR rows, as written. */
async function weekRows(week: number): Promise<WeekRow[]> {
  const { data, error } = await service
    .from('matchups')
    .select('id, week, round_type, home_team_id, away_team_id')
    .eq('league_id', leagueId)
    .eq('week', week)
    .eq('round_type', 'regular')
    .order('id')
  if (error) throw new Error(`matchups read: ${error.message}`)
  return data ?? []
}

/** Every team exactly once across home ∪ away in the week (§11.7's
 *  invariant — the thing a client-side edit could never keep). */
function seatsEveryTeamOnce(rows: WeekRow[]): boolean {
  const seen = new Map<string, number>()
  for (const r of rows) {
    for (const t of [r.home_team_id, r.away_team_id]) {
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1)
    }
  }
  return seen.size === TEAM_COUNT && [...seen.values()].every((n) => n === 1)
}

async function ledgerCount(actionId?: string): Promise<number> {
  let q = service.from('schedule_actions').select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
  if (actionId) q = q.eq('action_id', actionId)
  const { count } = await q
  return count ?? 0
}

async function systemPostCount(): Promise<number> {
  const { count } = await service
    .from('league_chat')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('is_system', true)
  return count ?? 0
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)
  outsiderClient = await signIn(OUTSIDER)

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

  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert(
      Array.from({ length: TEAM_COUNT - 1 }, (_, i) => ({
        owner_id: commishId,
        name: `SE Team ${i + 2}`,
        league_id: leagueId,
      })),
    )
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)

  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: memberId, team_id: seats![0].id, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)

  const { error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// 1. The FREE window (no Week 1 game rows → the nfl_weeks datum, 2099): a
//    pairing change that touches a sibling is re-seated SERVER-side.
// ---------------------------------------------------------------------------

describe('POST …/schedule/matchup — one pairing, re-seated in body (§11.7)', () => {
  let edited: WeekRow
  let sibling: WeekRow
  let result: EditResult

  it('re-pairs a week-2 matchup with a team from another row; the displaced team takes the vacated seat; every team still once', async () => {
    const before = await weekRows(2)
    expect(before).toHaveLength(TEAM_COUNT / 2)
    expect(seatsEveryTeamOnce(before)).toBe(true)
    ;[edited, sibling] = before
    const posts = await systemPostCount()

    const response = await editMatchup(commishClient, leagueId, {
      matchup_id: edited.id,
      home_team_id: edited.home_team_id,
      away_team_id: sibling.away_team_id,
      action_id: ACTION.free,
    })
    expect(response.status, errorText(response)).toBe(200)
    result = response.body as unknown as EditResult
    expect(result.action_id).toBe(ACTION.free)
    expect(result.week).toBe(2)
    expect(result.matchup.matchup_id).toBe(edited.id)
    expect(result.matchup.before).toEqual({ home_team_id: edited.home_team_id, away_team_id: edited.away_team_id })
    expect(result.matchup.after).toEqual({ home_team_id: edited.home_team_id, away_team_id: sibling.away_team_id })
    // The sibling took the displaced team into the seat the new team left.
    expect(result.siblings).toHaveLength(1)
    expect(result.siblings[0].matchup_id).toBe(sibling.id)
    expect(result.siblings[0].after).toEqual({ home_team_id: sibling.home_team_id, away_team_id: edited.away_team_id })
    expect(result.rows_changed).toBe(2)
    expect(result.reason_required).toBe(false)
    expect(result.window.free).toBe(true)

    const after = await weekRows(2)
    expect(after.find((r) => r.id === edited.id)).toMatchObject({ home_team_id: edited.home_team_id, away_team_id: sibling.away_team_id })
    expect(after.find((r) => r.id === sibling.id)).toMatchObject({ home_team_id: sibling.home_team_id, away_team_id: edited.away_team_id })
    expect(seatsEveryTeamOnce(after)).toBe(true)

    // ONE ledger row, ONE system post (the D97 in-transaction post).
    expect(await ledgerCount(ACTION.free)).toBe(1)
    expect(await systemPostCount()).toBe(posts + 1)
    expect(result.system_post).toContain('Week 2 matchup edited by')
    expect(result.system_post).toMatch(/\.$/) // free: no override tail
    expect(result.system_post).not.toContain('commissioner override')
  })

  it('the D97 post is a `system` item in the activity feed, readable by an ordinary member', async () => {
    const feed = await readActivity(memberClient, leagueId, { kind: 'system' })
    expect(feed.status).toBe(200)
    const items = (feed.body as unknown as { items: Array<{ kind: string; message: string }> }).items
    expect(items.some((i) => i.kind === 'system' && i.message === result.system_post)).toBe(true)
  })

  it('a client-supplied SCHEDULE body is REFUSED (400), not ignored — and the id is not consumed', async () => {
    const forged = await editMatchup(commishClient, leagueId, {
      matchup_id: edited.id,
      home_team_id: edited.home_team_id,
      away_team_id: sibling.away_team_id,
      action_id: ACTION.forged,
      matchups: [{ week: 2, home_team_id: 'x', away_team_id: 'y' }],
    })
    expect(forged.status).toBe(400)
    expect(JSON.stringify(forged.body)).toContain('matchups')
    expect(await ledgerCount(ACTION.forged)).toBe(0)
    for (const key of ['proposed', 'diff', 'weeks_regenerable']) {
      const r = await editMatchup(commishClient, leagueId, {
        matchup_id: edited.id,
        home_team_id: edited.home_team_id,
        away_team_id: sibling.away_team_id,
        action_id: ACTION.forged,
        [key]: [],
      })
      expect(r.status, key).toBe(400)
    }
    // A missing key is a 400 too — never a null reaching the RPC.
    const missing = await editMatchup(commishClient, leagueId, { matchup_id: edited.id, home_team_id: 'x', away_team_id: 'y' })
    expect(missing.status).toBe(400)
  })

  it('replays the SAME submit byte-identically and writes nothing', async () => {
    const posts = await systemPostCount()
    const { data: stored } = await service
      .from('schedule_actions')
      .select('result, kind')
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.free)
      .single()
    expect(stored!.kind).toBe('edit_matchup')
    const replay = await editMatchup(commishClient, leagueId, {
      matchup_id: edited.id,
      home_team_id: edited.home_team_id,
      away_team_id: sibling.away_team_id,
      action_id: ACTION.free,
    })
    expect(replay.status).toBe(200)
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(stored!.result))
    expect(await ledgerCount()).toBe(1)
    expect(await systemPostCount()).toBe(posts)
  })

  it('REFUSES the id reused for a DIFFERENT pairing rather than returning the first edit’s result (F65(b))', async () => {
    const rows = await weekRows(2)
    const other = rows.find((r) => r.id !== edited.id && r.id !== sibling.id)!
    const reuse = await editMatchup(commishClient, leagueId, {
      matchup_id: edited.id,
      home_team_id: edited.home_team_id,
      away_team_id: other.away_team_id,
      action_id: ACTION.reuse,
    })
    expect(reuse.status).toBe(409)
    expect(errorText(reuse)).toBe(SCHEDULE_EDIT_ACTION_ID_REUSED_MESSAGE)
    // The board is untouched.
    expect(await weekRows(2)).toEqual(rows)
    expect(await ledgerCount()).toBe(1)
  })

  it('an edit that changes nothing is refused by name (P0001 → 409, verbatim); a matchup of another league is a 404 by name (P0002)', async () => {
    const rows = await weekRows(2)
    const same = await editMatchup(commishClient, leagueId, {
      matchup_id: rows[0].id,
      home_team_id: rows[0].home_team_id,
      away_team_id: rows[0].away_team_id!,
      action_id: ACTION.noChange,
    })
    expect(same.status).toBe(409)
    expect(errorText(same)).toContain('nothing to change')
    expect(await ledgerCount(ACTION.noChange)).toBe(0)

    const notMine = await editMatchup(commishClient, leagueId, {
      matchup_id: NO_SUCH_MATCHUP,
      home_team_id: rows[0].home_team_id,
      away_team_id: rows[1].away_team_id!,
      action_id: ACTION.notMine,
    })
    expect(notMine.status).toBe(404)
    expect(errorText(notMine)).toContain('is not a matchup of league')
  })
})

// ---------------------------------------------------------------------------
// 2. The auth matrix — 42501 → 403, no-leak
// ---------------------------------------------------------------------------

describe('the auth matrix — only the commissioner edits (§11.7)', () => {
  it('an ordinary MEMBER and an OUTSIDER get one identical 403; neither writes a ledger row', async () => {
    const [a, b] = await weekRows(3)
    for (const [client, actionId] of [
      [memberClient, ACTION.member],
      [outsiderClient, ACTION.outsider],
    ] as const) {
      const r = await editMatchup(client, leagueId, {
        matchup_id: a.id,
        home_team_id: a.home_team_id,
        away_team_id: b.away_team_id!,
        action_id: actionId,
      })
      expect(r.status).toBe(403)
      expect(errorText(r)).toBe(SCHEDULE_FORBIDDEN_MESSAGE)
      expect(await ledgerCount(actionId)).toBe(0)
    }
    expect(seatsEveryTeamOnce(await weekRows(3))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. E41's two states through the route (F233(e)'s pair). Week 1's game row
//    is the datum; the EDITED weeks (3, 4) carry no game rows, so their own
//    kickoff check (R730) reads the 2099 week datum and stays free.
// ---------------------------------------------------------------------------

describe('E41 — free until the league’s Week 1 kickoff, a reason REQUIRED after it (D290)', () => {
  it('with Week 1 kicked off (2001): the edit is refused by name WITHOUT a reason (22023 → 400, verbatim), nothing written', async () => {
    const { error } = await service
      .from('nfl_games')
      .insert({ id: WEEK1_GAME_ID, season: SYNTHETIC_SEASON, week: 1, home_team: 'SEA', away_team: 'SEB', kickoff_at: KICKOFF_PAST })
    expect(error).toBeNull()

    const [a, b] = await weekRows(3)
    const posts = await systemPostCount()
    const refused = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id,
      home_team_id: a.home_team_id,
      away_team_id: b.away_team_id!,
      action_id: ACTION.overrideNoReason,
    })
    expect(refused.status).toBe(400)
    expect(errorText(refused)).toContain('schedule_edit_matchup:')
    expect(errorText(refused)).toContain('league Week 1 kicked off at')
    expect(errorText(refused)).toContain('requires a reason')
    expect(await ledgerCount(ACTION.overrideNoReason)).toBe(0)
    expect(await systemPostCount()).toBe(posts)
    expect((await weekRows(3)).slice(0, 2)).toEqual([a, b]) // untouched
  })

  it('…and a blank reason is the same refusal', async () => {
    const [a, b] = await weekRows(3)
    const blank = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id,
      home_team_id: a.home_team_id,
      away_team_id: b.away_team_id!,
      reason: '   ',
      action_id: ACTION.overrideNoReason,
    })
    expect(blank.status).toBe(400)
    expect(errorText(blank)).toContain('requires a reason')
  })

  it('WITH a reason: the edit applies as a commissioner override and the D97 post carries the override and the reason', async () => {
    const [a, b] = await weekRows(3)
    const r = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id,
      home_team_id: a.home_team_id,
      away_team_id: b.away_team_id!,
      reason: 'bye-week balance',
      action_id: ACTION.overrideWithReason,
    })
    expect(r.status, errorText(r)).toBe(200)
    const result = r.body as unknown as EditResult
    expect(result.reason_required).toBe(true)
    expect(result.window).toMatchObject({ free: false, reason_required: true, datum_arm: 'nfl_games' })
    expect(result.system_post).toContain('after Week 1 kickoff (commissioner override) — reason: bye-week balance')
    expect(seatsEveryTeamOnce(await weekRows(3))).toBe(true)
  })

  it('with Week 1 kickoff AHEAD (2099): the same shape of edit needs no reason — the window is the server’s reading of the datum', async () => {
    const { error } = await service.from('nfl_games').update({ kickoff_at: KICKOFF_FUTURE }).eq('id', WEEK1_GAME_ID)
    expect(error).toBeNull()
    const [a, b] = await weekRows(4)
    const r = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id,
      home_team_id: a.home_team_id,
      away_team_id: b.away_team_id!,
      action_id: ACTION.futureFree,
    })
    expect(r.status, errorText(r)).toBe(200)
    const result = r.body as unknown as EditResult
    expect(result.window).toMatchObject({ free: true, reason_required: false, datum_arm: 'nfl_games' })
    expect(result.system_post).not.toContain('commissioner override')
  })
})

// ---------------------------------------------------------------------------
// 4. R768 — the ids sent UPPERCASE are the same edit. Last on purpose (a
//    fresh edit rewrites week 5).
// ---------------------------------------------------------------------------

describe('the guard compares against what POSTGRES wrote (R768)', () => {
  it('an uppercase FRESH edit APPLIES and is reported as the edit it was; a lowercase replay of it is a replay', async () => {
    const [a, b] = await weekRows(5)
    const r = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id.toUpperCase(),
      home_team_id: a.home_team_id.toUpperCase(),
      away_team_id: b.away_team_id!.toUpperCase(),
      action_id: ACTION.upper.toUpperCase(),
    })
    expect(r.status, errorText(r)).toBe(200)
    const result = r.body as unknown as EditResult
    expect(result.action_id).toBe(ACTION.upper) // normalised on the way in
    expect(result.matchup.matchup_id).toBe(a.id)

    const replay = await editMatchup(commishClient, leagueId, {
      matchup_id: a.id,
      home_team_id: a.home_team_id,
      away_team_id: b.away_team_id!,
      action_id: ACTION.upper,
    })
    expect(replay.status).toBe(200)
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(r.body))
    expect(await ledgerCount(ACTION.upper)).toBe(1)
  })
})
