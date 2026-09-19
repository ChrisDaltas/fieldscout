/**
 * commish-part2-api-db.test.ts — M6A L.E1.11 at the SERVICE layer: the three
 * commissioner override routes of part 2 (`/commish/team`,
 * `/commish/setting`, `/commish/schedule` → `commishRenameTeam` /
 * `commishChangeSetting` / `commishEditSchedule` → 128's / 129's / 130's
 * verbs as re-cut by 131) and the audit-log READ (`GET /commish/log` →
 * `readCommishLog`) against the LOCAL Supabase stack through PostgREST, with
 * real signed-in clients (the `commish-overrides-api-db.test.ts` rig).
 *
 * pgTAP 076 / 077 / 078 / 079 cover the verbs' LAW DB-side. What THIS suite
 * proves is the layer above it, ONE stack cell per verb driving the real RPC
 * as a real commissioner, plus:
 *
 *   - **The auth matrix at the wire**: a seated manager who is not the
 *     commissioner gets each route's own no-leak 403 and writes no receipt.
 *   - **The receipt** (`commissioner_actions`, §10.3): every landed override
 *     writes exactly one row keyed by the action_id in `metadata`, with a
 *     non-blank reason stored TRIMMED.
 *   - **THE REASON IS OPTIONAL END-TO-END (Q66 — Chris, 2026-09-16; spec
 *     v2.16.41; migration 131 / L.E1.15)**: one cell per verb sends NO (or a
 *     blank) reason and asserts the 200, the NULL-reason receipt and a
 *     system post with NO "— reason:" clause. No transitional state remains.
 *   - **F65(b) at the wire, on the REAL ledger**: a REUSED action_id naming a
 *     different team-name / key / VALUE (R1058, D351) / matchup — including
 *     a later-week row carrying the identical pairing, so the `matchup_id`
 *     line alone stands (R1059) — is refused 409 by the service, never
 *     answered 200 with the first submit's document.
 *   - **`GET /commish/log` (spec:1703)**: a MEMBER who is not the
 *     commissioner CAN read it and sees every receipt above, newest first,
 *     actor username resolved, `reason` as `string | null`; an authenticated
 *     NON-MEMBER cannot (the family's one no-leak 403, `123:333-334`'s
 *     `is_league_member`); and **the composite cursor is STABLE across two
 *     rows written in the same instant** — the premise (the two rows really
 *     share `created_at`, by value) is asserted BEFORE the pagination is
 *     (§4 rule 14(c)), and the pair is served exactly once across two
 *     one-row pages.
 *
 * Requires the local stack — D59(5) precedent; FAILS loudly when the stack
 * is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226): the league is on `SYNTHETIC_SEASON` (2099) with NO
 * game rows placed; no clock is read anywhere here.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `b03` — this suite owns it (the D108(14) registry: af0–aff, b00,
 * b01, b02, b05 taken; b03 measured free 2026-09-16 by grep over src/,
 * supabase/tests/, e2e/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { decodeCommishLogCursor, readCommishLog, type CommishLogPage } from './commish-log-service'
import { COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE, COMMISH_SCHEDULE_FORBIDDEN_MESSAGE, commishEditSchedule } from './commish-schedule-service'
import { COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE, COMMISH_SETTING_FORBIDDEN_MESSAGE, commishChangeSetting } from './commish-setting-service'
import { COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE, COMMISH_TEAM_FORBIDDEN_MESSAGE, commishRenameTeam } from './commish-team-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-part2-api-league'
const TEAM_COUNT = 8

const COMMISH = { email: 'commish-part2-commish@fieldscout.test', password: 'pgtap-cp2-api-pass-1', username: 'cp2_commish_one' }
const MEMBER = { email: 'commish-part2-member@fieldscout.test', password: 'pgtap-cp2-api-pass-2', username: 'cp2_member_two' }
const OUTSIDER = { email: 'commish-part2-outsider@fieldscout.test', password: 'pgtap-cp2-api-pass-3', username: 'cp2_outsider_three' }

const ACTION = {
  league: 'b0300000-0000-4000-8000-000000000001',
  rename: 'b0300000-0000-4000-8000-000000000011',
  renameNoReason: 'b0300000-0000-4000-8000-000000000012',
  renameMember: 'b0300000-0000-4000-8000-000000000013',
  setting: 'b0300000-0000-4000-8000-000000000021',
  settingNoReason: 'b0300000-0000-4000-8000-000000000022',
  settingMember: 'b0300000-0000-4000-8000-000000000023',
  settingRefused: 'b0300000-0000-4000-8000-000000000024',
  settingNonCanonical: 'b0300000-0000-4000-8000-000000000025',
  settingEnumCase: 'b0300000-0000-4000-8000-000000000026',
  schedule: 'b0300000-0000-4000-8000-000000000031',
  scheduleNoReason: 'b0300000-0000-4000-8000-000000000032',
  scheduleMember: 'b0300000-0000-4000-8000-000000000033',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

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
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let commishId: string
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
 *  128/129/130 store in `metadata`. `reason` is `string | null` (130 §0). */
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

async function teamName(teamId: string): Promise<string> {
  const { data, error } = await service.from('teams').select('name').eq('id', teamId).single()
  if (error) throw new Error(`teams read: ${error.message}`)
  return data.name
}

async function blobSetting(key: string): Promise<unknown> {
  const { data, error } = await service.from('leagues').select('settings').eq('id', leagueId).single()
  if (error) throw new Error(`leagues read: ${error.message}`)
  return (data.settings as Record<string, unknown> | null)?.[key]
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)
  outsiderClient = await signIn(OUTSIDER)

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
  commishTeamId = commishTeam.id

  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert(Array.from({ length: TEAM_COUNT - 1 }, (_, i) => ({ owner_id: commishId, name: `CP2 Team ${i + 2}`, league_id: leagueId })))
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)
  memberTeamId = seats![0].id

  const { error: memberError } = await service.from('league_members').insert({ league_id: leagueId, user_id: memberId, team_id: memberTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null }).eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)

  const { error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)

  // THE PREMISES, asserted (§4 rule 14(c)): the member's seat starts under
  // its seeded name, the blob key starts at its default, and the audit log
  // is EMPTY for this league — every row the cells below find is theirs.
  expect(await teamName(memberTeamId)).toBe('CP2 Team 2')
  expect(await blobSetting('waiver_period_hours')).not.toBe(72)
  expect((await service.from('commissioner_actions').select('id').eq('league_id', leagueId)).data).toHaveLength(0)
}, 60_000)

afterAll(async () => {
  await cleanup()
  // Post-run census: nothing of ours survives (fixture hygiene).
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(leagues ?? []).toHaveLength(0)
  for (const u of [COMMISH, MEMBER, OUTSIDER]) {
    const { data } = await service.from('profiles').select('id').eq('username', u.username)
    expect(data ?? [], u.username).toHaveLength(0)
  }
})

// ---------------------------------------------------------------------------
// 1. /commish/team → commish_rename_team (128 via 131)
// ---------------------------------------------------------------------------

describe('POST …/commish/team — commishRenameTeam over the real RPC', () => {
  it('a seated manager gets the route’s own no-leak 403, renames nothing and writes NO receipt', async () => {
    const res = await commishRenameTeam(memberClient, leagueId, { team_id: commishTeamId, name: 'Not Mine', action_id: ACTION.renameMember, reason: 'I want to' })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_TEAM_FORBIDDEN_MESSAGE)
    expect(await teamName(commishTeamId)).toBe('Commish Team')
    expect(await receiptsFor(ACTION.renameMember)).toHaveLength(0)
  })

  it('a commissioner renames the member’s team WITH a reason: 200, the identity fields echo, teams.name holds it, one receipt (action_type reassign_team, F355) with the reason TRIMMED', async () => {
    const res = await commishRenameTeam(commishClient, leagueId, {
      team_id: memberTeamId,
      name: '  The Renamed Seat  ',
      action_id: ACTION.rename,
      reason: '  paper draft: the owner picked a name  ',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { verb: string; action_type: string; action_id: string; team_id: string; name: string; previous_name: string; requested_name: string; no_changes: boolean; commissioner_action_id: string | null; reason: string | null }
    expect(body.verb).toBe('commish_rename_team')
    expect(body.action_type).toBe('reassign_team')
    expect(body.action_id).toBe(ACTION.rename)
    expect(body.team_id).toBe(memberTeamId)
    expect(body.requested_name).toBe('The Renamed Seat')
    expect(body.name).toBe('The Renamed Seat')
    expect(body.previous_name).toBe('CP2 Team 2')
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.reason).toBe('paper draft: the owner picked a name')
    expect(await teamName(memberTeamId)).toBe('The Renamed Seat')
    const receipts = await receiptsFor(ACTION.rename)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'reassign_team', target_type: 'team', target_id: memberTeamId, reason: 'paper draft: the owner picked a name' })
  })

  it('Q66 (131 / L.E1.15): NO reason LANDS — a second rename: 200, `reason: null`, ONE receipt with reason NULL, a post with NO "— reason:" clause', async () => {
    const res = await commishRenameTeam(commishClient, leagueId, { team_id: memberTeamId, name: 'Renamed Twice', action_id: ACTION.renameNoReason })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { name: string; reason: string | null; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.name).toBe('Renamed Twice')
    expect(body.reason).toBeNull()
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(await teamName(memberTeamId)).toBe('Renamed Twice')
    const receipts = await receiptsFor(ACTION.renameNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'reassign_team', target_id: memberTeamId, reason: null })
    const posts = await systemPostsLike('%renamed by %(commissioner override)%')
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const noReason = posts.filter((p) => p.includes('Renamed Twice'))
    expect(noReason).toHaveLength(1)
    expect(noReason[0]).not.toContain('— reason:')
  })

  it('F65(b) on the REAL ledger: the rename’s action_id re-sent with a DIFFERENT name is a 409 — the stored name keeps the first submit’s', async () => {
    const res = await commishRenameTeam(commishClient, leagueId, { team_id: memberTeamId, name: 'A Third Name', action_id: ACTION.rename, reason: 'a different name on a spent id' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_TEAM_ACTION_ID_REUSED_MESSAGE)
    expect(await teamName(memberTeamId)).toBe('Renamed Twice')
    expect(await receiptsFor(ACTION.rename)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 2. /commish/setting → commish_change_setting (129 via 131)
// ---------------------------------------------------------------------------

describe('POST …/commish/setting — commishChangeSetting over the real RPC', () => {
  it('a seated manager gets the route’s own no-leak 403, changes nothing and writes NO receipt', async () => {
    const before = await blobSetting('waiver_period_hours')
    const res = await commishChangeSetting(memberClient, leagueId, { key: 'waiver_period_hours', value: 72, action_id: ACTION.settingMember, reason: 'not mine' })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_SETTING_FORBIDDEN_MESSAGE)
    expect(await blobSetting('waiver_period_hours')).toStrictEqual(before)
    expect(await receiptsFor(ACTION.settingMember)).toHaveLength(0)
  })

  it('a commissioner changes waiver_period_hours to 72 in-season WITH a reason: 200, the identity fields echo, the blob holds 72, the lifted status gate is NAMED, one receipt with the reason TRIMMED', async () => {
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_period_hours', value: 72, action_id: ACTION.setting, reason: '  waivers clear faster in-season  ' })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { verb: string; action_type: string; action_id: string; key: string; value: unknown; requested_value: unknown; rescore_requested: boolean; no_changes: boolean; commissioner_action_id: string | null; bypassed: string[]; reason: string | null }
    expect(body.verb).toBe('commish_change_setting')
    expect(body.action_type).toBe('change_setting')
    expect(body.action_id).toBe(ACTION.setting)
    expect(body.key).toBe('waiver_period_hours')
    expect(body.value).toBe(72)
    expect(body.requested_value).toBe(72)
    expect(body.rescore_requested).toBe(false)
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.bypassed.length).toBeGreaterThan(0)
    expect(body.reason).toBe('waivers clear faster in-season')
    expect(await blobSetting('waiver_period_hours')).toBe(72)
    const receipts = await receiptsFor(ACTION.setting)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'change_setting', target_type: 'setting', target_id: 'waiver_period_hours', reason: 'waivers clear faster in-season' })
  })

  it('Q66 (131 / L.E1.15): a BLANK reason is NO reason and LANDS — 96 hours: 200, ONE receipt with reason NULL (not ""), a post with NO "— reason:" clause', async () => {
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_period_hours', value: 96, action_id: ACTION.settingNoReason, reason: '   ' })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { value: unknown; reason: string | null; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.value).toBe(96)
    expect(body.reason).toBeNull()
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(await blobSetting('waiver_period_hours')).toBe(96)
    const receipts = await receiptsFor(ACTION.settingNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'change_setting', target_id: 'waiver_period_hours', reason: null })
    const posts = await systemPostsLike('%waiver_period_hours%(commissioner override)%')
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const noReason = posts.filter((p) => p.includes('96'))
    expect(noReason).toHaveLength(1)
    expect(noReason[0]).not.toContain('— reason:')
  })

  it('F65(b) on the REAL ledger: the setting’s action_id re-sent for a DIFFERENT key is a 409 — the blob keeps the first submit’s value and the other key is untouched', async () => {
    const before = await blobSetting('faab_min_bid')
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'faab_min_bid', value: 5, action_id: ACTION.setting, reason: 'another key on a spent id' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE)
    expect(await blobSetting('faab_min_bid')).toStrictEqual(before)
    expect(await receiptsFor(ACTION.setting)).toHaveLength(1)
  })

  it('R1058 (D351) on the REAL ledger — the reviewer’s P1: 72 landed under id A, 96 under id B; id A re-sent for the SAME key with 120 is a 409, the blob still holds 96 and A still has ONE receipt (never a 200 saying 72)', async () => {
    // THE PREMISE (§4 rule 14(c)): both earlier submits landed, and the blob
    // holds the SECOND one's value.
    expect(await receiptsFor(ACTION.setting)).toHaveLength(1)
    expect(await receiptsFor(ACTION.settingNoReason)).toHaveLength(1)
    expect(await blobSetting('waiver_period_hours')).toBe(96)
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_period_hours', value: 120, action_id: ACTION.setting, reason: 'a different value on a spent id' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE)
    expect(await blobSetting('waiver_period_hours')).toBe(96)
    expect(await receiptsFor(ACTION.setting)).toHaveLength(1)
  })

  it('F365 / R1062 on the REAL verb — the narrowed guard still answers a lawful FIRST submit in a NON-CANONICAL depth-0 form with 200 (" 48 " lands as 48, never a false 409 for a change that landed), and a same-id replay with 120 is a 409', async () => {
    const first = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_period_hours', value: ' 48 ', action_id: ACTION.settingNonCanonical })
    expect(first.status).toBe(200)
    expect((first.body as { requested_value: unknown; no_changes: boolean }).requested_value).toBe(48)
    expect(await blobSetting('waiver_period_hours')).toBe(48)
    expect(await receiptsFor(ACTION.settingNonCanonical)).toHaveLength(1)
    const replay = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_period_hours', value: '120', action_id: ACTION.settingNonCanonical })
    expect(replay.status).toBe(409)
    expect(await blobSetting('waiver_period_hours')).toBe(48)
  })

  it('F365 — THE PREMISE of the enum arm, measured on the real verb: 129 only btrims an enum, so an UPPER-CASE enum is REFUSED by name (never canonicalised to an echo the guard would have to fold) and writes no receipt', async () => {
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'waiver_type', value: 'ROLLING_PRIORITY', action_id: ACTION.settingEnumCase })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(errorText(res)).not.toBe(COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE)
    expect(await receiptsFor(ACTION.settingEnumCase)).toHaveLength(0)
  })

  it('a REFUSED-in-season key (team_count, Q65) comes back 409 with 129’s copy VERBATIM and writes NO receipt', async () => {
    const res = await commishChangeSetting(commishClient, leagueId, { key: 'team_count', value: 10, action_id: ACTION.settingRefused, reason: 'try' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toContain('team_count is PRE-DRAFT ONLY')
    expect(await receiptsFor(ACTION.settingRefused)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 3. /commish/schedule → commish_edit_schedule (130 via 131)
// ---------------------------------------------------------------------------

describe('POST …/commish/schedule — commishEditSchedule over the real RPC', () => {
  it('a seated manager gets the route’s own no-leak 403, re-pairs nothing and writes NO receipt', async () => {
    const row = (await weekRows(2))[0]
    const res = await commishEditSchedule(memberClient, leagueId, { matchup_id: row.id, home_team_id: row.away_team_id!, away_team_id: row.home_team_id, action_id: ACTION.scheduleMember, reason: 'not mine' })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_SCHEDULE_FORBIDDEN_MESSAGE)
    expect((await weekRows(2))[0]).toStrictEqual(row)
    expect(await receiptsFor(ACTION.scheduleMember)).toHaveLength(0)
  })

  it('a commissioner swaps the sides of a week-2 matchup WITH a reason: 200, the identity fields echo, the row is flipped, one receipt with the reason TRIMMED', async () => {
    const row = (await weekRows(2))[0]
    const res = await commishEditSchedule(commishClient, leagueId, {
      matchup_id: row.id,
      home_team_id: row.away_team_id!,
      away_team_id: row.home_team_id,
      action_id: ACTION.schedule,
      reason: '  venue swap  ',
    })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { verb: string; action_type: string; action_id: string; week: number; matchup: { matchup_id: string; after: { home_team_id: string; away_team_id: string } }; rows_changed: number; no_changes: boolean; commissioner_action_id: string | null; reason_required: boolean; reason: string | null }
    expect(body.verb).toBe('commish_edit_schedule')
    expect(body.action_type).toBe('edit_schedule')
    expect(body.action_id).toBe(ACTION.schedule)
    expect(body.week).toBe(2)
    expect(body.matchup.matchup_id).toBe(row.id)
    expect(body.matchup.after).toStrictEqual({ home_team_id: row.away_team_id, away_team_id: row.home_team_id })
    expect(body.rows_changed).toBe(1)
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    expect(body.reason_required).toBe(false)
    expect(body.reason).toBe('venue swap')
    const stored = (await weekRows(2)).find((r) => r.id === row.id)
    expect(stored).toMatchObject({ home_team_id: row.away_team_id, away_team_id: row.home_team_id })
    const receipts = await receiptsFor(ACTION.schedule)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'edit_schedule', target_type: 'schedule', target_id: row.id, reason: 'venue swap' })
  })

  it('Q66 (130 / 131): NO reason LANDS — a week-3 swap: 200, `reason: null`, `reason_required: false`, ONE receipt with reason NULL, a post with NO "— reason:" clause', async () => {
    const row = (await weekRows(3))[0]
    const res = await commishEditSchedule(commishClient, leagueId, { matchup_id: row.id, home_team_id: row.away_team_id!, away_team_id: row.home_team_id, action_id: ACTION.scheduleNoReason })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as { reason: string | null; reason_required: boolean; commissioner_action_id: string | null; no_changes: boolean }
    expect(body.reason).toBeNull()
    expect(body.reason_required).toBe(false)
    expect(body.no_changes).toBe(false)
    expect(body.commissioner_action_id).not.toBeNull()
    const receipts = await receiptsFor(ACTION.scheduleNoReason)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'edit_schedule', target_id: row.id, reason: null })
    const posts = await systemPostsLike('Week 3 matchup edited by %(commissioner override)%')
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toContain('— reason:')
  })

  it('F65(b) on the REAL ledger: the schedule action_id re-sent for a DIFFERENT matchup is a 409 — that matchup is untouched', async () => {
    const other = (await weekRows(2))[1]
    const res = await commishEditSchedule(commishClient, leagueId, { matchup_id: other.id, home_team_id: other.away_team_id!, away_team_id: other.home_team_id, action_id: ACTION.schedule, reason: 'another matchup on a spent id' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE)
    expect((await weekRows(2)).find((r) => r.id === other.id)).toStrictEqual(other)
    expect(await receiptsFor(ACTION.schedule)).toHaveLength(1)
  })

  it('R1059 — the cell where ONLY the `matchup_id` guard line stands: the schedule action_id re-sent against a LATER-week row carrying the IDENTICAL pairing is a 409 — that row is untouched', async () => {
    // THE PREMISE (§4 rule 14(c)): the swapped week-2 pairing recurs in a
    // later regular-season week (an 8-team round-robin repeats after 7
    // weeks). Found by search, asserted present — never assumed.
    const edited = (await weekRows(2))[0]
    const { data: later, error } = await service
      .from('matchups')
      .select('id, week, home_team_id, away_team_id')
      .eq('league_id', leagueId)
      .eq('round_type', 'regular')
      .eq('home_team_id', edited.home_team_id)
      .eq('away_team_id', edited.away_team_id!)
      .gt('week', 2)
      .order('week')
    if (error) throw new Error(`matchups read: ${error.message}`)
    expect(later!.length, 'the swapped pairing recurs in a later week').toBeGreaterThanOrEqual(1)
    const twin = later![0]
    expect(twin.id).not.toBe(edited.id)
    // Same verb, same id, same home, same away — only the ROW differs.
    const res = await commishEditSchedule(commishClient, leagueId, { matchup_id: twin.id, home_team_id: edited.home_team_id, away_team_id: edited.away_team_id!, action_id: ACTION.schedule, reason: 'the same pairing on another row, on a spent id' })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(COMMISH_SCHEDULE_ACTION_ID_REUSED_MESSAGE)
    expect((await weekRows(twin.week)).find((r) => r.id === twin.id)).toStrictEqual(twin)
    expect(await receiptsFor(ACTION.schedule)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 4. GET /commish/log → readCommishLog (spec:1703; 123:333-334)
// ---------------------------------------------------------------------------

describe('GET …/commish/log — readCommishLog over the real table', () => {
  /** The six receipts the cells above wrote, by action_id. */
  const WRITTEN = [ACTION.rename, ACTION.renameNoReason, ACTION.setting, ACTION.settingNoReason, ACTION.settingNonCanonical, ACTION.schedule, ACTION.scheduleNoReason]

  it('a MEMBER who is not the commissioner CAN read it (spec:1703): every receipt above, newest first, the actor’s username resolved, `reason` null where none was given and never the string "null"', async () => {
    const res = await readCommishLog(memberClient, leagueId, {})
    expect(res.status, errorText(res)).toBe(200)
    const page = res.body as unknown as CommishLogPage
    expect(page.has_more).toBe(false)
    expect(page.next_cursor).toBeNull()
    expect(page.items).toHaveLength(WRITTEN.length)
    const byAction = new Map(page.items.map((i) => [(i.metadata as { action_id: string }).action_id, i]))
    for (const id of WRITTEN) expect(byAction.has(id), id).toBe(true)
    // Newest first, by value: every adjacent pair is non-increasing on (created_at, id).
    for (let i = 1; i < page.items.length; i += 1) {
      const a = page.items[i - 1]
      const b = page.items[i]
      expect(a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id), `${a.id} before ${b.id}`).toBe(true)
    }
    expect(byAction.get(ACTION.rename)).toMatchObject({ action_type: 'reassign_team', target_type: 'team', target_id: memberTeamId, reason: 'paper draft: the owner picked a name', actor: { id: commishId, username: COMMISH.username } })
    expect(byAction.get(ACTION.renameNoReason)!.reason).toBeNull()
    expect(byAction.get(ACTION.settingNoReason)!.reason).toBeNull()
    expect(byAction.get(ACTION.scheduleNoReason)!.reason).toBeNull()
    for (const item of page.items) {
      expect(item.reason).not.toBe('null')
      expect(item.reason).not.toBe('')
      // C70: nothing on a row claims the verb ran.
      expect(Object.keys(item)).not.toContain('executed')
      expect(Object.keys(item)).not.toContain('applied')
    }
  })

  it('the commissioner reads the same page', async () => {
    const res = await readCommishLog(commishClient, leagueId, {})
    expect(res.status).toBe(200)
    expect((res.body as unknown as CommishLogPage).items).toHaveLength(WRITTEN.length)
  })

  it('an authenticated NON-MEMBER gets the family’s one no-leak 403 — the same answer a nonexistent league gives — never an empty log', async () => {
    const res = await readCommishLog(outsiderClient, leagueId, {})
    expect(res).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    const gone = await readCommishLog(outsiderClient, '00000000-0000-4000-8000-000000000000', {})
    expect(gone).toStrictEqual(res)
  })

  it('THE COMPOSITE CURSOR IS STABLE ACROSS TWO ROWS WRITTEN IN THE SAME INSTANT (R770): premise planted — the pair really shares created_at by value — then each of two one-row pages serves exactly one of them, and the third page moves past both', async () => {
    // Two rows in ONE statement: one transaction, one frozen `now()`, so
    // both carry the identical `created_at` (to the microsecond — stronger
    // than the same millisecond). The service role bypasses RLS; 123's
    // triggers guard UPDATE / DELETE / TRUNCATE, not INSERT.
    const { data: pair, error } = await service
      .from('commissioner_actions')
      .insert([
        { league_id: leagueId, actor_id: commishId, action_type: 'edit_lineup', target_type: 'team', target_id: memberTeamId, reason: null, metadata: { action_id: 'b0300000-0000-4000-8000-0000000000a1', probe: 'same-instant-pair' } },
        { league_id: leagueId, actor_id: commishId, action_type: 'edit_lineup', target_type: 'team', target_id: commishTeamId, reason: null, metadata: { action_id: 'b0300000-0000-4000-8000-0000000000a2', probe: 'same-instant-pair' } },
      ])
      .select('id, created_at')
    if (error) throw new Error(`pair insert: ${error.message}`)
    expect(pair).toHaveLength(2)
    // THE PREMISE (§4 rule 14(c)): asserted by VALUE, not assumed.
    expect(pair![0].created_at).toBe(pair![1].created_at)
    const pairIds = pair!.map((r) => r.id).sort()
    // And the pair is the NEWEST thing in the log — the first page starts on it.
    const all = (await readCommishLog(memberClient, leagueId, {})).body as unknown as CommishLogPage
    expect(all.items.slice(0, 2).map((i) => i.id).sort()).toStrictEqual(pairIds)
    expect(all.items[0].created_at).toBe(pair![0].created_at)

    // Page 1: one row — the higher id of the pair.
    const p1 = (await readCommishLog(memberClient, leagueId, { limit: '1' })).body as unknown as CommishLogPage
    expect(p1.items).toHaveLength(1)
    expect(p1.has_more).toBe(true)
    expect(p1.next_cursor).not.toBeNull()
    expect(decodeCommishLogCursor(p1.next_cursor!)).toStrictEqual({ before: p1.items[0].created_at, beforeId: p1.items[0].id })

    // Page 2: the OTHER row of the pair — the one an instant-only boundary
    // would have dropped, because its created_at EQUALS the cursor's.
    const p2 = (await readCommishLog(memberClient, leagueId, { limit: '1', cursor: p1.next_cursor! })).body as unknown as CommishLogPage
    expect(p2.items).toHaveLength(1)
    expect(p2.items[0].created_at).toBe(p1.items[0].created_at)
    expect(p2.items[0].id).not.toBe(p1.items[0].id)
    expect([p1.items[0].id, p2.items[0].id].sort()).toStrictEqual(pairIds)
    expect(p2.has_more).toBe(true)

    // Page 3: past the pair — strictly older, and not either of them.
    const p3 = (await readCommishLog(memberClient, leagueId, { limit: '1', cursor: p2.next_cursor! })).body as unknown as CommishLogPage
    expect(p3.items).toHaveLength(1)
    expect(p3.items[0].created_at < p1.items[0].created_at).toBe(true)
    expect(pairIds).not.toContain(p3.items[0].id)

    // Walking the whole log one row at a time serves every row EXACTLY once.
    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 20; guard += 1) {
      const page = (await readCommishLog(memberClient, leagueId, { limit: '1', ...(cursor ? { cursor } : {}) })).body as unknown as CommishLogPage
      seen.push(...page.items.map((i) => i.id))
      if (!page.has_more) break
      cursor = page.next_cursor!
    }
    expect(seen).toHaveLength(WRITTEN.length + 2)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.sort()).toStrictEqual(all.items.map((i) => i.id).sort())
  })

  it('a malformed cursor is refused BY NAME (400 on `cursor`), never paged from the top', async () => {
    const res = await readCommishLog(memberClient, leagueId, { cursor: 'bm90LWEtY3Vyc29y' })
    expect(res.status).toBe(400)
    expect((res.body as { error: { fieldErrors: Record<string, string[]> } }).error.fieldErrors.cursor).toHaveLength(1)
  })
})
