/**
 * members-retire-api-db.test.ts — the members route's removal outcomes
 * against the LOCAL Supabase stack over PostgREST, with real signed-in
 * clients. Born with M6 L.E1.40 ("Retire the team"); RE-CUT BY L.E1.42
 * (Chris 2026-10-01: "you can't simply retire a Team, you can change the
 * manager but the Team lives" / "yes drop it"; PROGRESS D467, migration 176):
 *   - the route refuses `mode: retire` itself, 400 in plain words, before
 *     any database call — for the commissioner and anyone else, with or
 *     without an action id or a reason, in season and in the playoffs —
 *     and nothing is written (so main says the same before 176 is pushed);
 *   - the verb, called straight over PostgREST, refuses by name too (176);
 *   - F549 (PROGRESS D465), now over a PLANTED pre-176 retirement (176
 *     cannot write one; a receipt is immutable, so an old one must still
 *     read): ONE line in League Home's activity and the Activity page's All
 *     tab — the ledger row, ✸-linked to its receipt, its D97 post folded in
 *     — and the log names each removal (the old retirement / vacate /
 *     takeover) with the manager it names.
 *   - F555 (migration 175): the commissioner's own client cannot append a
 *     receipt at all (42501 by name, nothing written); the log read's
 *     hardening against a forged row is still proven, on a row planted as
 *     the service role (a legacy or out-of-band row).
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). No clock or random read anywhere here.
 *
 * Determinism: FIXED emails / usernames / action_ids + cleanup-first.
 * Action-id prefix `e14` — this suite owns it (the D108(14) registry; e14
 * measured free 2026-09-30 by grep over src/, supabase/tests/, e2e/,
 * scripts/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { commishLogLines, feedLines } from '@/components/leagues/activity-feed-ops'
import { plainText, usernameParts } from '@/components/shared/username-link-ops'

import { readActivity, type ActivityItem } from './activity-service'
import { readCommishLog, type CommishLogItem } from './commish-log-service'
import { RETIRE_REMOVED_MESSAGE, removeMember } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-members-retire-league'

const COMMISH = { email: 'members-retire-commish@fieldscout.test', password: 'pgtap-mret-pass-1', username: 'mret_commish_one' }
const MGR_A = { email: 'members-retire-a@fieldscout.test', password: 'pgtap-mret-pass-2', username: 'mret_mgr_two' }
const MGR_B = { email: 'members-retire-b@fieldscout.test', password: 'pgtap-mret-pass-3', username: 'mret_mgr_three' }
const MGR_C = { email: 'members-retire-c@fieldscout.test', password: 'pgtap-mret-pass-4', username: 'mret_mgr_four' }
/** F549: the successor a takeover seats — not a member before it. */
const MGR_D = { email: 'members-retire-d@fieldscout.test', password: 'pgtap-mret-pass-5', username: 'mret_mgr_five' }
/** R1425: a FieldScout user with no stint and no membership in the league. */
const OUTSIDER = { email: 'members-retire-outsider@fieldscout.test', password: 'pgtap-mret-pass-6', username: 'mret_outsider' }

const ACTION = {
  retireA: 'e1400000-0000-4000-8000-000000000001',
  noId: 'e1400000-0000-4000-8000-000000000002',
  playoffs: 'e1400000-0000-4000-8000-000000000003',
  manager: 'e1400000-0000-4000-8000-000000000004',
  planted: 'e1400000-0000-4000-8000-000000000005',
} as const

const RETIRE_400 = { status: 400, body: { error: RETIRE_REMOVED_MESSAGE } }

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let mgrAClient: SupabaseClient<Database>
let commishId: string
let ids: { a: string; b: string; c: string; d: string; outsider: string }
let mgrBClient: SupabaseClient<Database>
let leagueId: string
let playoffLeagueId: string
let teamA: string
let teamB: string

const errorText = (result: { body: unknown }): string => JSON.stringify((result.body as { error: unknown }).error)

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const leagueIds = (stale ?? []).map((row) => row.id)
  if (leagueIds.length > 0) {
    // F406's order (D449 / D450): a receipt names its team with no ON DELETE,
    // and the log goes only with its league — detach the teams, delete the
    // leagues (taking receipts, ledger rows and posts), THEN the teams.
    const { data: teams } = await service.from('teams').select('id').in('league_id', leagueIds)
    const teamIds = (teams ?? []).map((row) => row.id)
    await service.from('teams').update({ league_id: null }).in('id', teamIds)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', leagueIds)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
    const { error: teamsError } = await service.from('teams').delete().in('id', teamIds)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
  }
  for (const u of [COMMISH, MGR_A, MGR_B, MGR_C, MGR_D, OUTSIDER]) await deleteUserByUsername(u.username)
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

/** A league in `status` with four managed seats (commissioner + A, B, C) of eight. */
async function seedLeague(name: string, status: 'in_season' | 'playoffs'): Promise<{ league: string; teams: string[] }> {
  const { data: template, error: templateError } = await service
    .from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  if (templateError) throw new Error(`template read: ${templateError.message}`)
  const { data: league, error: leagueError } = await service
    .from('leagues')
    .insert({
      owner_id: commishId, name, season: 2026, status, team_count: 8, regular_season_weeks: 14,
      playoff_teams: status === 'playoffs' ? 2 : 0, playoff_start_week: 15,
      scoring_system_id: template.id, scoring_rules_snapshot: template.rules, faab_budget: 100, settings: {},
    })
    .select('id')
    .single()
  if (leagueError) throw new Error(`league insert: ${leagueError.message}`)
  const owners = [commishId, ids.a, ids.b, ids.c]
  const { data: teams, error: teamsError } = await service
    .from('teams')
    .insert(owners.map((owner, i) => ({ owner_id: owner, name: `MRET T${i + 1}`, league_id: league.id })))
    .select('id, owner_id')
  if (teamsError) throw new Error(`teams insert: ${teamsError.message}`)
  const byOwner = new Map((teams ?? []).map((t) => [t.owner_id, t.id]))
  const teamIds = owners.map((o) => byOwner.get(o)!)
  const { error: membersError } = await service.from('league_members').insert(
    owners.map((owner, i) => ({ league_id: league.id, user_id: owner, team_id: teamIds[i], role: i === 0 ? 'commissioner' : 'manager', is_placeholder: false, faab_balance: 100 })),
  )
  if (membersError) throw new Error(`league_members insert: ${membersError.message}`)
  const { error: stintError } = await service.from('team_managers').insert(
    owners.map((owner, i) => ({ league_id: league.id, team_id: teamIds[i], user_id: owner, role: 'manager' })),
  )
  if (stintError) throw new Error(`team_managers insert: ${stintError.message}`)
  return { league: league.id, teams: teamIds }
}

async function memberIdOf(league: string, userId: string | null, teamId?: string): Promise<string> {
  let query = service.from('league_members').select('id').eq('league_id', league)
  query = userId ? query.eq('user_id', userId) : query.eq('team_id', teamId!)
  const { data, error } = await query.single()
  if (error) throw new Error(`memberIdOf: ${error.message}`)
  return data.id
}

async function trail(): Promise<{ receipts: Array<{ target_id: string | null; reason: string | null }>; ledger: number; posts: string[] }> {
  const [{ data: receipts }, { data: ledger }, { data: posts }] = await Promise.all([
    service.from('commissioner_actions').select('target_id, reason').eq('league_id', leagueId).eq('action_type', 'retire_franchise'),
    service.from('transactions').select('id').eq('league_id', leagueId).eq('type', 'commissioner_move'),
    service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).like('message', '% was retired by %'),
  ])
  return { receipts: receipts ?? [], ledger: (ledger ?? []).length, posts: (posts ?? []).map((p) => p.message) }
}

beforeAll(async () => {
  await cleanup()
  commishId = await createUser(COMMISH)
  ids = { a: await createUser(MGR_A), b: await createUser(MGR_B), c: await createUser(MGR_C), d: await createUser(MGR_D), outsider: await createUser(OUTSIDER) }
  commishClient = await signIn(COMMISH)
  mgrAClient = await signIn(MGR_A)
  mgrBClient = await signIn(MGR_B)

  const inSeason = await seedLeague(`${LEAGUE_NAME}-season`, 'in_season')
  leagueId = inSeason.league
  teamA = inSeason.teams[1]
  teamB = inSeason.teams[2]
  // Weeks 1–2 final, week 3 live — the new team's book opens at week 3.
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert(Array.from({ length: 14 }, (_, i) => ({ league_id: leagueId, season: 2026, week: i + 1 })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)
  for (const [status, upTo] of [['live', 3], ['correction_window', 2], ['final', 2]] as const) {
    const { error } = await service.from('league_weeks').update({ status }).eq('league_id', leagueId).lte('week', upTo)
    if (error) throw new Error(`league_weeks ${status}: ${error.message}`)
  }
  playoffLeagueId = (await seedLeague(`${LEAGUE_NAME}-playoffs`, 'playoffs')).league

  // THE PREMISE: no retirement anywhere yet.
  expect(await trail()).toEqual({ receipts: [], ledger: 0, posts: [] })
}, 60_000)

afterAll(async () => {
  await cleanup()
  const { data } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(data ?? []).toHaveLength(0)
})

describe('DELETE …/members/[mid] mode retire — refused by the route in plain words, nothing written (L.E1.42)', () => {
  it('the commissioner: with an action id, without one, with a reason — each a 400 naming the two outcomes; nothing written', async () => {
    const mid = await memberIdOf(leagueId, ids.a)
    for (const body of [
      { mode: 'retire', action_id: ACTION.retireA },
      { mode: 'retire' },
      { mode: 'retire', action_id: ACTION.noId, reason: 'moving away' },
    ]) {
      expect(await removeMember(commishClient, leagueId, mid, commishId, body)).toEqual(RETIRE_400)
    }
    expect(RETIRE_REMOVED_MESSAGE).toBe('A team can’t be retired — seat a new manager or leave it vacant.')
    expect(await trail()).toEqual({ receipts: [], ledger: 0, posts: [] })
    const { data: team } = await service.from('teams').select('status, retired_at_week, successor_team_id').eq('id', teamA).single()
    expect(team).toEqual({ status: 'active', retired_at_week: null, successor_team_id: null })
    const { data: seat } = await service.from('league_members').select('user_id, team_id').eq('id', mid).single()
    expect(seat).toEqual({ user_id: ids.a, team_id: teamA })
  })

  it('a manager and the playoffs: the same 400 (the route never asks the verb)', async () => {
    const mid = await memberIdOf(leagueId, ids.b)
    expect(await removeMember(mgrAClient, leagueId, mid, ids.a, { mode: 'retire', action_id: ACTION.manager })).toEqual(RETIRE_400)
    const playoffMid = await memberIdOf(playoffLeagueId, ids.a)
    expect(await removeMember(commishClient, playoffLeagueId, playoffMid, commishId, { mode: 'retire', action_id: ACTION.playoffs })).toEqual(RETIRE_400)
    expect(await trail()).toEqual({ receipts: [], ledger: 0, posts: [] })
  })

  it('an action_id on a vacate is refused at the schema (no mode takes one any more)', async () => {
    const mid = await memberIdOf(leagueId, ids.a)
    const res = await removeMember(commishClient, leagueId, mid, commishId, { mode: 'vacate', action_id: ACTION.noId })
    expect(res.status).toBe(400)
    expect(errorText(res)).toContain('action_id')
  })

  it('migration 176: the verb itself, called straight over PostgREST, refuses retire by name — nothing written', async () => {
    const mid = await memberIdOf(leagueId, ids.a)
    const { data, error } = await commishClient.rpc('remove_manager', {
      p_league_id: leagueId, p_member_id: mid, p_mode: 'retire', p_action_id: ACTION.retireA,
    })
    expect(data).toBeNull()
    expect([error?.code, error?.message]).toEqual(['P0001', 'remove_manager: a team can\'t be retired — seat a new manager or leave it vacant (§7.2.1)'])
    expect(await trail()).toEqual({ receipts: [], ledger: 0, posts: [] })
  })
})

/** A retirement COMMITTED BEFORE 176, planted as the service role (176 cannot
 *  write one; production holds none — measured 2026-10-01): its receipt, its
 *  ledger row and its D97 post at the receipt’s
 *  instant, in 173's shapes. History the log and the feed must still read. */
async function plantPre176Retirement(): Promise<string> {
  const mid = await memberIdOf(leagueId, ids.a)
  const { data: receipt, error: receiptError } = await service
    .from('commissioner_actions')
    .insert({
      league_id: leagueId, actor_id: commishId, action_type: 'retire_franchise', target_type: 'team', target_id: teamA,
      before: { manager_user_id: ids.a, team_status: 'active' },
      after: { manager_user_id: null, team_status: 'retired', successor_team_name: 'Team 5', retired_at_week: 3 },
      metadata: { mode: 'retire', member_id: mid, team_name: 'MRET T2', affected_team_ids: [teamA], action_id: ACTION.planted },
    })
    .select('id, created_at')
    .single()
  if (receiptError) throw new Error(`plant receipt: ${receiptError.message}`)
  const { error: ledgerError } = await service.from('transactions').insert({
    league_id: leagueId, type: 'commissioner_move', status: 'complete', action_id: ACTION.planted,
    created_at: receipt.created_at, // the receipt instant links them (related_action_id is guarded to a verb — TD10)
    payload: {
      ok: true, mode: 'retire', verb: 'retire_franchise', action_id: ACTION.planted, member_id: mid,
      retired_team_id: teamA, retired_team_name: 'MRET T2', successor_team_name: 'Team 5', retired_at_week: 3, reason: null,
    },
  })
  if (ledgerError) throw new Error(`plant ledger: ${ledgerError.message}`)
  const { error: postError } = await service.from('league_chat').insert({
    league_id: leagueId, user_id: commishId, is_system: true, created_at: receipt.created_at,
    message:
      'MRET T2 was retired by mret_commish_one — the franchise is sealed under its final manager; Team 5 takes its slot from Week 3 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))',
  })
  if (postError) throw new Error(`plant post: ${postError.message}`)
  return receipt.id
}

/** What League Home and the Activity page hand the renderer: the league's
 *  teams by name and its CURRENT members by username (the league detail). */
async function leagueNames(): Promise<{ teams: Map<string, string>; members: Map<string, string> }> {
  const [{ data: teams }, { data: members }] = await Promise.all([
    service.from('teams').select('id, name').eq('league_id', leagueId),
    service.from('league_members').select('user_id, profiles(username)').eq('league_id', leagueId),
  ])
  return {
    teams: new Map((teams ?? []).map((t) => [t.id, t.name])),
    members: new Map(
      (members ?? []).flatMap((m) => (m.user_id && m.profiles?.username ? [[m.user_id, m.profiles.username] as const] : [])),
    ),
  }
}

describe('F549 — a pre-176 retirement still reads as one line; the removal receipts in words', () => {
  it('League Home (limit 8) and the Activity page’s All tab show a pre-176 retirement as ONE ✸ line linked to its receipt — the ledger row and the post are two rows, one line', async () => {
    const receiptId = await plantPre176Retirement()
    const { data: receipt } = await service.from('commissioner_actions').select('id').eq('league_id', leagueId).eq('action_type', 'retire_franchise').single()
    expect(receipt!.id).toBe(receiptId)
    const names = await leagueNames()
    for (const query of [{ limit: '8' }, {}]) {
      const res = await readActivity(mgrBClient, leagueId, query)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const items = (res.body as unknown as { items: ActivityItem[] }).items
      // THE PREMISE: the retirement wrote two feed rows — its ledger row and its D97 post.
      const rows = items.filter((i) => (i.kind === 'transaction' ? i.type === 'commissioner_move' : i.message.includes(' was retired by ')))
      expect(rows.map((i) => [i.kind, i.commish_action_id])).toEqual(
        expect.arrayContaining([['transaction', receipt!.id], ['system', receipt!.id]]),
      )
      expect(rows).toHaveLength(2)
      const lines = feedLines(items, names.teams, names.members).filter((l) => /retired/.test(l.text))
      expect(lines.map((l) => ({ kind: l.kind, text: l.text, commissioner: l.commissioner, commishActionId: l.commishActionId }))).toEqual([
        { kind: 'transaction', text: 'retired MRET T2 — Team 5 takes its place from Week 3', commissioner: true, commishActionId: receipt!.id },
      ])
    }
  })

  it('a vacate and a takeover: the log names every removed manager (no longer a member) and the new one, each a profile link', async () => {
    const vacate = await removeMember(commishClient, leagueId, await memberIdOf(leagueId, ids.c), commishId, { mode: 'vacate' })
    expect(vacate.status, errorText(vacate)).toBe(200)
    const takeover = await removeMember(commishClient, leagueId, await memberIdOf(leagueId, ids.b), commishId, { mode: 'takeover', successor_user_id: ids.d })
    expect(takeover.status, errorText(takeover)).toBe(200)

    const names = await leagueNames()
    // THE PREMISE: the league's member list no longer names the removed managers
    // (A never left — 176 refused his team's retirement; the planted receipt is history).
    expect([names.members.has(ids.a), names.members.has(ids.b), names.members.has(ids.c), names.members.get(ids.d)]).toEqual([true, false, false, MGR_D.username])

    const res = await readCommishLog(commishClient, leagueId, {})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const items = (res.body as unknown as { items: CommishLogItem[] }).items
    const removals = items.filter((i) => ['retire_franchise', 'vacate_seat', 'replace_manager'].includes(i.action_type))
    const lines = commishLogLines(removals, names.teams, names.members)
    expect(lines.map((l) => ({ actor: l.actor, text: l.text }))).toEqual([
      { actor: COMMISH.username, text: 'replaced MRET T3’s manager: mret_mgr_three → mret_mgr_five' },
      { actor: COMMISH.username, text: 'removed mret_mgr_four as MRET T4’s manager — the team has no manager now' },
      { actor: COMMISH.username, text: 'retired MRET T2 (managed by mret_mgr_two) — Team 5 takes its place from Week 3' },
    ])
    // Each person is a door to his profile — exactly the names the sentence interpolated.
    expect(lines.map((l) => usernameParts(l.marked).flatMap((p) => (typeof p === 'string' ? [] : [p.username])))).toEqual([
      [MGR_B.username, MGR_D.username],
      [MGR_C.username],
      [MGR_A.username],
    ])
    expect(lines.every((l) => plainText(l.marked) === l.text)).toBe(true)
  })

  it('F555 (migration 175): the commissioner’s own client can NOT append a receipt — refused 42501 by name, nothing written', async () => {
    const count = async () => {
      const { count: n, error } = await service.from('commissioner_actions').select('id', { count: 'exact', head: true }).eq('league_id', leagueId)
      if (error) throw new Error(`count receipts: ${error.message}`)
      return n
    }
    const before = await count()
    expect(before, 'the league already holds the removals’ receipts (the count is not vacuous)').toBeGreaterThan(0)
    const { data, error } = await commishClient
      .from('commissioner_actions')
      .insert({
        league_id: leagueId, actor_id: commishId, action_type: 'replace_manager', target_type: 'team', target_id: teamB,
        before: { manager_user_id: ids.outsider }, after: { manager_user_id: ids.d }, metadata: { team_name: 'MRET T3' },
      })
      .select('id')
      .single()
    expect(data).toBeNull()
    expect([error?.code, error?.message]).toEqual(['42501', 'permission denied for table commissioner_actions'])
    expect(await count(), 'nothing was written').toBe(before)
  })

  it('R1424 / R1425: a forged receipt already in the log (a pre-175 client append, or an out-of-band row — planted here as the service role) — 400+ user-id keys, naming an outsider — leaves the log readable (200) and names no outsider', async () => {
    const stuffed = Object.fromEntries(Array.from({ length: 420 }, (_, n) => [`k${n}_user_id`, `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`]))
    // THE PREMISE (a): 400 ids in ONE `.in` is refused by PostgREST (the URL is too long) — the old read's shape.
    const { error: tooLong } = await service.from('profiles').select('id').in('id', Object.values(stuffed).slice(0, 400))
    expect(tooLong, 'a 400-id .in must fail, or this cell proves nothing').not.toBeNull()
    // THE PREMISE (b): such a row exists. Since 175 (F555) no client can
    // write one, but rows appended through 123:335's policy before the push
    // stay (the log is immutable) — so the read's hardening still has to
    // hold. The service role bypasses RLS and keeps INSERT (pgTAP 123 A4).
    const { data: forged, error: forgeError } = await service
      .from('commissioner_actions')
      .insert({
        league_id: leagueId, actor_id: commishId, action_type: 'replace_manager', target_type: 'team', target_id: teamB,
        before: { ...stuffed, manager_user_id: ids.outsider }, after: { ...stuffed, manager_user_id: ids.d }, metadata: { ...stuffed, team_name: 'MRET T3', user_id: ids.outsider },
      })
      .select('id')
      .single()
    expect(forgeError, forgeError?.message).toBeNull()
    const { data: outsiderRows } = await service.from('league_members').select('id').eq('league_id', leagueId).eq('user_id', ids.outsider)
    const { data: outsiderStints } = await service.from('team_managers').select('id').eq('league_id', leagueId).eq('user_id', ids.outsider)
    expect([outsiderRows?.length, outsiderStints?.length]).toEqual([0, 0])

    const res = await readCommishLog(commishClient, leagueId, {})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const items = (res.body as unknown as { items: CommishLogItem[] }).items
    const row = items.find((i) => i.id === forged!.id)
    expect(row, 'the forged row is served').toBeDefined()
    // Only the word keys were read, and only the league's own person is named.
    expect(row!.usernames).toEqual({ [ids.d]: MGR_D.username })
    // The earlier removals still name their managers on the same page.
    expect(items.filter((i) => i.action_type === 'vacate_seat').map((i) => i.usernames)).toEqual([{ [ids.c]: MGR_C.username }])
    const names = await leagueNames()
    const [line] = commishLogLines([row!], names.teams, names.members)
    expect(line.text).toBe('made mret_mgr_five the new manager of MRET T3')
    expect(usernameParts(line.marked).flatMap((p) => (typeof p === 'string' ? [] : [p.username]))).toEqual([MGR_D.username])
  })
})
