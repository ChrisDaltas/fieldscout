/**
 * commish-autopilot-api-db.test.ts — M6A L.E1.22 at the SERVICE layer: the
 * commissioner's per-team "Put on autopilot" switch (`/commish/autopilot` →
 * `commishSetAutopilot` → 139's `commish_set_autopilot`) against the LOCAL
 * Supabase stack through PostgREST, with real signed-in clients (the
 * `commish-part2-api-db.test.ts` rig). Spec §7.2.1(c) / §10.1 (v2.16.42 —
 * Q63 RULED 2026-09-27: autopilot is OFF by default).
 *
 * pgTAP 087 covers the verb's LAW DB-side. What THIS suite proves is the
 * layer above it:
 *
 *   - **The auth matrix at the wire**: a seated manager gets the route's own
 *     no-leak 403 and writes nothing.
 *   - **The landing**: 200, the identity fields echo, ONE receipt
 *     (`set_autopilot`, `{autopilot}` before/after) with a NULL reason (Q66),
 *     a system post with NO "— reason:" clause, and the switch row ON.
 *   - **The replay and F65(b) on the REAL ledger**: the same body replays
 *     byte-identically; a REUSED action_id naming the other direction is a
 *     409, never a 200 for a switch nobody flipped.
 *   - **The refusal VERBATIM**: ON on a managed seat is the verb's 409 text.
 *   - **The reads the team page and League Home use**: `readRosters` carries
 *     `autopilot` per team (true only where switched; the default is false),
 *     and `GET /commish/log` shows the act to a member.
 *
 * Requires the local stack — D59(5) precedent; FAILS loudly when the stack is
 * down, never skips (§4.3). No clock is read anywhere here.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `b06` — this suite owns it (the D108(14) registry; b06 measured free
 * 2026-09-27 by grep over src/, supabase/tests/, e2e/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE, COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE, commishSetAutopilot, type CommishSetAutopilotResult } from './commish-autopilot-service'
import { readCommishLog, type CommishLogPage } from './commish-log-service'
import { readRosters, type LeagueRosters } from './rosters-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-autopilot-api-league'
const TEAM_COUNT = 8

const COMMISH = { email: 'commish-autopilot-commish@fieldscout.test', password: 'pgtap-cap-api-pass-1', username: 'cap_commish_one' }
const MEMBER = { email: 'commish-autopilot-member@fieldscout.test', password: 'pgtap-cap-api-pass-2', username: 'cap_member_two' }

const ACTION = {
  league: 'b0600000-0000-4000-8000-000000000001',
  member: 'b0600000-0000-4000-8000-000000000011',
  on: 'b0600000-0000-4000-8000-000000000012',
  managed: 'b0600000-0000-4000-8000-000000000013',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let leagueId: string
let memberTeamId: string
let seatTeamId: string

const errorText = (result: { body: unknown }): string => String((result.body as { error: unknown }).error)

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    // The learned order (D306(6)): release the league graph before teams.
    // team_autopilot rides the teams delete (ON DELETE CASCADE, 139);
    // commissioner_actions / commish_autopilot_actions ride the league's.
    for (const table of ['league_chat', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  for (const u of [COMMISH, MEMBER]) await deleteUserByUsername(u.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { username: user.username } })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function switchRows(): Promise<Array<{ team_id: string; is_on: boolean }>> {
  const { data, error } = await service.from('team_autopilot').select('team_id, is_on').in('team_id', [memberTeamId, seatTeamId]).order('team_id')
  if (error) throw new Error(`team_autopilot read: ${error.message}`)
  return data ?? []
}

async function receiptsFor(actionId: string): Promise<Array<{ action_type: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown }>> {
  const { data, error } = await service
    .from('commissioner_actions')
    .select('action_type, target_type, target_id, reason, before, after')
    .eq('league_id', leagueId)
    .eq('metadata->>action_id', actionId)
  if (error) throw new Error(`commissioner_actions read: ${error.message}`)
  return data ?? []
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)

  const { columns, blob } = splitSettings(defaultsForTeamCount(TEAM_COUNT))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'ESPN Standard').single()
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
    .insert([
      { owner_id: commishId, name: 'CAP Member Team', league_id: leagueId },
      { owner_id: commishId, name: 'CAP Empty Seat', league_id: leagueId },
    ])
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)
  memberTeamId = seats![0].id
  seatTeamId = seats![1].id
  // The member's MANAGED seat, and a placeholder seat in add_placeholder_seat's
  // own shape (063:459-465: user_id NULL, is_placeholder TRUE).
  const { error: membersError } = await service.from('league_members').insert([
    { league_id: leagueId, user_id: memberId, team_id: memberTeamId, role: 'manager' },
    { league_id: leagueId, user_id: null, team_id: seatTeamId, role: 'manager', is_placeholder: true },
  ])
  if (membersError) throw new Error(`league_members insert: ${membersError.message}`)

  // THE PREMISES (§4 rule 14(c)): no switch row anywhere (the ruled default),
  // and an empty audit log — every row the cells find is theirs.
  expect(await switchRows()).toEqual([])
  expect((await service.from('commissioner_actions').select('id').eq('league_id', leagueId)).data).toHaveLength(0)
}, 60_000)

afterAll(async () => {
  await cleanup()
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(leagues ?? []).toHaveLength(0)
})

describe('POST …/commish/autopilot — commishSetAutopilot over the real RPC', () => {
  it('the rosters read carries autopilot = false for EVERY team before anyone switches (no row = OFF, the ruled default)', async () => {
    const res = await readRosters(memberClient, leagueId)
    expect(res.status).toBe(200)
    const teams = (res.body as unknown as LeagueRosters).teams
    expect(teams.length).toBeGreaterThanOrEqual(3)
    expect(teams.every((t) => t.autopilot === false)).toBe(true)
  })

  it('a seated manager gets the route’s own no-leak 403 and switches nothing', async () => {
    const res = await commishSetAutopilot(memberClient, leagueId, { team_id: seatTeamId, on: true, action_id: ACTION.member })
    expect(res.status).toBe(403)
    expect(errorText(res)).toBe(COMMISH_AUTOPILOT_FORBIDDEN_MESSAGE)
    expect(await switchRows()).toEqual([])
    expect(await receiptsFor(ACTION.member)).toHaveLength(0)
  })

  it('the commissioner puts the EMPTY seat on autopilot with NO reason (Q66): 200, the identity echoes, the switch is ON, ONE receipt with a NULL reason, a post with no reason clause', async () => {
    const res = await commishSetAutopilot(commishClient, leagueId, { team_id: seatTeamId, on: true, action_id: ACTION.on })
    expect(res.status, errorText(res)).toBe(200)
    const body = res.body as unknown as CommishSetAutopilotResult
    expect(body).toMatchObject({ verb: 'commish_set_autopilot', action_type: 'set_autopilot', action_id: ACTION.on, team_id: seatTeamId, autopilot: true, previous: false, requested: true, seat: 'unmanaged', no_changes: false, reason: null })
    expect(body.commissioner_action_id).not.toBeNull()
    expect(await switchRows()).toEqual([{ team_id: seatTeamId, is_on: true }])
    const receipts = await receiptsFor(ACTION.on)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ action_type: 'set_autopilot', target_type: 'team', target_id: seatTeamId, reason: null, before: { autopilot: false }, after: { autopilot: true } })
    const { data: posts } = await service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).like('message', 'CAP Empty Seat is now on autopilot%')
    expect(posts ?? []).toHaveLength(1)
    expect(posts![0].message).not.toContain('reason:')
  })

  it('the SAME body replays byte-identically (no second receipt); a REUSED action_id asking the OTHER direction is F65(b)’s 409', async () => {
    const first = await commishSetAutopilot(commishClient, leagueId, { team_id: seatTeamId, on: true, action_id: ACTION.on })
    expect(first.status).toBe(200)
    expect(await receiptsFor(ACTION.on)).toHaveLength(1)
    const reused = await commishSetAutopilot(commishClient, leagueId, { team_id: seatTeamId, on: false, action_id: ACTION.on })
    expect(reused.status).toBe(409)
    expect(errorText(reused)).toBe(COMMISH_AUTOPILOT_ACTION_ID_REUSED_MESSAGE)
    expect(await switchRows()).toEqual([{ team_id: seatTeamId, is_on: true }])
  })

  it('ON on a MANAGED seat is the verb’s own 409, VERBATIM', async () => {
    const res = await commishSetAutopilot(commishClient, leagueId, { team_id: memberTeamId, on: true, action_id: ACTION.managed })
    expect(res.status).toBe(409)
    expect(errorText(res)).toBe(
      `commish_set_autopilot: team ${memberTeamId} has a manager — autopilot is for a seat with NO manager (§7.2.1(c)); to set this team's lineup, use the lineup override`,
    )
    expect(await switchRows()).toEqual([{ team_id: seatTeamId, is_on: true }])
  })

  it('the reads the UI uses: rosters says autopilot = true for the switched seat ONLY, and the commissioner log shows the act to a MEMBER', async () => {
    const rosters = await readRosters(memberClient, leagueId)
    const teams = (rosters.body as unknown as LeagueRosters).teams
    expect(teams.filter((t) => t.autopilot).map((t) => t.team_id)).toEqual([seatTeamId])
    const log = await readCommishLog(memberClient, leagueId, {})
    expect(log.status).toBe(200)
    const items = (log.body as unknown as CommishLogPage).items
    expect(items.filter((i) => i.action_type === 'set_autopilot').map((i) => [i.target_id, i.after])).toEqual([[seatTeamId, { autopilot: true }]])
  })
})
