/**
 * members-api-db.test.ts — L.A1.15 item 3 at the SERVICE layer: member
 * management (placeholder seats, roles, assign, remove modes, leave) against
 * the LOCAL Supabase stack through PostgREST — the production wire path —
 * with real signed-in clients. pgTAP 017 covers the same invariants DB-side;
 * this suite proves the service composition, the Zod surface, and the
 * SQLSTATE→HTTP mapping (42501→403 · P0002→404 · P0001/22023→400).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**` — no wall-clock/random uniqueness
 * anywhere in here).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { createInvite, claimInvite } from './invites-service'
import { deleteLeague, listMyLeagues, patchLeague } from './leagues-service'
import {
  addPlaceholderSeat,
  assignManager,
  AUTODRAFT_DEFERRED_MESSAGE,
  patchMember,
  removeMember,
} from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-members-league'

/** faab_budget 777 — a literal a hardcoded 100 fails (R79's amplification). */
const FAAB_BUDGET = 777
const FAAB_BUDGET_AFTER_PATCH = 250

const COMMISH = {
  email: 'members-api-commish@fieldscout.test',
  password: 'pgtap-members-pass-1',
  username: 'mb_commish_one',
}
const CO = {
  email: 'members-api-co@fieldscout.test',
  password: 'pgtap-members-pass-2',
  username: 'mb_cocom_two',
}
const TARGET = {
  email: 'members-api-target@fieldscout.test',
  password: 'pgtap-members-pass-3',
  username: 'mb_target_three',
}
const SUCCESSOR = {
  email: 'members-api-successor@fieldscout.test',
  password: 'pgtap-members-pass-4',
  username: 'mb_succ_four',
}
const OUTSIDER = {
  email: 'members-api-outsider@fieldscout.test',
  password: 'pgtap-members-pass-5',
  username: 'mb_out_five',
}

const ACTION = {
  league1: 'af000000-0000-4000-8000-000000000001',
  league2: 'af000000-0000-4000-8000-000000000002',
  league3: 'af000000-0000-4000-8000-000000000003',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let coClient: SupabaseClient<Database>
let targetClient: SupabaseClient<Database>
let successorClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let commishId: string
let coId: string
let targetId: string
let successorId: string
let league1Id: string
let league2Id: string
/** Soft-deleted mid-suite (its own fixture — no earlier assertion depends on
 *  it still being visible), for the P0002 → 404 arms. */
let league3Id: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service
    .from('leagues')
    .select('id')
    .like('name', `${LEAGUE_NAME_PREFIX}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  for (const u of [COMMISH, CO, TARGET, SUCCESSOR, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
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
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function createLeagueAsCommish(name: string, actionId: string): Promise<string> {
  const settings = { ...defaultsForTeamCount(8), faab_budget: FAAB_BUDGET }
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data, error } = await commishClient.rpc('create_league', {
    p_name: name,
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league failed: ${error.message}`)
  return (data as { league_id: string }).league_id
}

/** The member row id for a user in a league (service role — fixtures only). */
async function memberIdOf(leagueId: string, userId: string): Promise<string> {
  const { data, error } = await service
    .from('league_members')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`memberIdOf failed: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  await cleanup()
  commishId = await createUser(COMMISH)
  coId = await createUser(CO)
  targetId = await createUser(TARGET)
  successorId = await createUser(SUCCESSOR)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  coClient = await signIn(CO)
  targetClient = await signIn(TARGET)
  successorClient = await signIn(SUCCESSOR)
  outsiderClient = await signIn(OUTSIDER)

  league1Id = await createLeagueAsCommish(`${LEAGUE_NAME_PREFIX}-1`, ACTION.league1)
  league2Id = await createLeagueAsCommish(`${LEAGUE_NAME_PREFIX}-2`, ACTION.league2)
  league3Id = await createLeagueAsCommish(`${LEAGUE_NAME_PREFIX}-3`, ACTION.league3)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('POST /api/leagues/[id]/members — placeholder seats', () => {
  it('the commissioner adds a seat: 201 with the §7.2:170 shape (franchise + unclaimed cache row)', async () => {
    const result = await addPlaceholderSeat(commishClient, league1Id, {})
    expect(result.status).toBe(201)
    const body = result.body as unknown as {
      member_id: string
      team_id: string
      team_name: string
      seats_filled: number
      team_count: number
    }
    expect(body.team_name).toBe('Team 2')
    expect(body.seats_filled).toBe(2)
    expect(body.team_count).toBe(8)

    const { data: member } = await service
      .from('league_members')
      .select('user_id, team_id, role, is_placeholder, faab_balance')
      .eq('id', body.member_id)
      .single()
    expect(member).toMatchObject({
      user_id: null,
      team_id: body.team_id,
      role: 'manager',
      is_placeholder: true,
      faab_balance: FAAB_BUDGET,
    })
  })

  it('a non-commissioner gets 403', async () => {
    const result = await addPlaceholderSeat(outsiderClient, league1Id, {})
    expect(result.status).toBe(403)
  })

  it('an unknown top-level key is rejected 400 (R82 — strictObject at the top level)', async () => {
    const result = await addPlaceholderSeat(commishClient, league1Id, { teamName: 'oops' })
    expect(result.status).toBe(400)
  })

  it('a soft-deleted league is 404 — and the body carries NO fieldErrors (R87 mis-shape)', async () => {
    const deleted = await deleteLeague(commishClient, league3Id)
    expect(deleted.status).toBe(200)

    const result = await addPlaceholderSeat(commishClient, league3Id, {})
    expect(result.status).toBe(404)
    expect(JSON.stringify(result.body)).not.toContain('fieldErrors')
  })
})

describe('POST .../teams/[tid]/assign-manager', () => {
  let seatTeamId: string

  it('seats a user on a placeholder franchise (200) and fills the SAME cache row', async () => {
    const seat = await addPlaceholderSeat(commishClient, league1Id, { team_name: 'Yardboats' })
    seatTeamId = (seat.body as unknown as { team_id: string }).team_id

    const result = await assignManager(commishClient, league1Id, seatTeamId, { user_id: targetId })
    expect(result.status).toBe(200)
    const body = result.body as unknown as { member_id: string; already_seated: boolean }
    expect(body.already_seated).toBe(false)

    const { data: rows } = await service
      .from('league_members')
      .select('id, user_id, is_placeholder, faab_balance')
      .eq('league_id', league1Id)
      .eq('team_id', seatTeamId)
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({
      user_id: targetId,
      is_placeholder: false,
      faab_balance: FAAB_BUDGET,
    })

    const { data: stints } = await service
      .from('team_managers')
      .select('user_id, ended_at')
      .eq('team_id', seatTeamId)
    expect(stints).toHaveLength(1)
    expect(stints?.[0]).toMatchObject({ user_id: targetId, ended_at: null })
  })

  it('CROSS-LEAGUE (R86): addressing league 2’s franchise through league 1 is refused 400 — the same commissioner runs both, so only the league segment can be doing the work', async () => {
    // The target is a STINT-FREE seat in league 2 and the user is seated in
    // NEITHER league, so the league scoping is the only guard in play: drop
    // it and the call SEATS successorId in league 1 on a league-2 franchise
    // rather than raising. The message is asserted too — the old fixture (an
    // occupied league-1 seat) let a different guard raise the same P0001, so
    // the status alone could not tell the two apart (R91).
    const seat2 = await addPlaceholderSeat(commishClient, league2Id, {})
    const team2Id = (seat2.body as unknown as { team_id: string }).team_id

    const result = await assignManager(commishClient, league1Id, team2Id, { user_id: successorId })
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('not part of this league')

    // Control: through its OWN league the same shape succeeds.
    const ok = await assignManager(commishClient, league2Id, team2Id, { user_id: successorId })
    expect(ok.status).toBe(200)
  })

  it('a non-commissioner gets 403; an unknown key gets 400', async () => {
    const forbidden = await assignManager(outsiderClient, league1Id, seatTeamId, {
      user_id: successorId,
    })
    expect(forbidden.status).toBe(403)

    const bad = await assignManager(commishClient, league1Id, seatTeamId, {
      user_id: successorId,
      role: 'commissioner',
    })
    expect(bad.status).toBe(400)
  })
})

describe('PATCH .../members/[mid] — roles and the deferred autodraft toggle', () => {
  it('promotes a manager to co_commissioner (200)', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await patchMember(commishClient, league1Id, mid, { role: 'co_commissioner' })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ role: 'co_commissioner', transferred: false })
  })

  it('is_autodraft gets an EXPLICIT named 400 (F33), not a generic unknown-key rejection', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await patchMember(commishClient, league1Id, mid, { is_autodraft: true })
    expect(result.status).toBe(400)
    // The MESSAGE is the assertion: a strictObject rejection would also be a
    // 400, and the named branch could then be deleted unnoticed.
    expect(JSON.stringify(result.body)).toContain(AUTODRAFT_DEFERRED_MESSAGE)
  })

  it('a co-commissioner cannot promote themselves to commissioner (403 — the coup path)', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await patchMember(targetClient, league1Id, mid, { role: 'commissioner' })
    expect(result.status).toBe(403)
  })

  it('CROSS-LEAGUE (R86): a league-1 member id addressed through league 2 is refused 403', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await patchMember(commishClient, league2Id, mid, { role: 'manager' })
    expect(result.status).toBe(403)

    // Control: through its own league the same call succeeds.
    const ok = await patchMember(commishClient, league1Id, mid, { role: 'manager' })
    expect(ok.status).toBe(200)
  })

  it('an unknown role value is 400; a malformed member id is 400; a soft-deleted league is 404', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    expect((await patchMember(commishClient, league1Id, mid, { role: 'overlord' })).status).toBe(400)
    expect((await patchMember(commishClient, league1Id, 'not-a-uuid', { role: 'manager' })).status).toBe(
      400,
    )
    const deletedMid = await memberIdOf(league3Id, commishId)
    const gone = await patchMember(commishClient, league3Id, deletedMid, { role: 'manager' })
    expect(gone.status).toBe(404)
  })
})

describe('DELETE .../members/[mid] — the three outcomes and the leave dispatch', () => {
  it('retire is a friendly 400 before the draft (D42) and writes nothing', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await removeMember(commishClient, league1Id, mid, commishId, { mode: 'retire' })
    expect(result.status).toBe(400)

    const { data: stints } = await service
      .from('team_managers')
      .select('id')
      .eq('league_id', league1Id)
      .is('ended_at', null)
      .eq('user_id', targetId)
    expect(stints).toHaveLength(1)
  })

  it('takeover without successor_user_id is 400 at the Zod refine (the §15.1 body contract)', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const result = await removeMember(commishClient, league1Id, mid, commishId, { mode: 'takeover' })
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('successor')
  })

  it('takeover reseats the named successor in place, closing the outgoing stint as "replaced"', async () => {
    const mid = await memberIdOf(league1Id, targetId)
    const { data: before } = await service
      .from('league_members')
      .select('team_id')
      .eq('id', mid)
      .single()
    const teamId = before?.team_id ?? ''

    const result = await removeMember(commishClient, league1Id, mid, commishId, {
      mode: 'takeover',
      successor_user_id: successorId,
      reason: 'went quiet in July',
    })
    expect(result.status).toBe(200)

    const { data: rows } = await service
      .from('league_members')
      .select('id, user_id, role, faab_balance')
      .eq('league_id', league1Id)
      .eq('team_id', teamId)
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({ id: mid, user_id: successorId, role: 'manager' })

    const { data: stints } = await service
      .from('team_managers')
      .select('user_id, end_reason, ended_by, ended_at')
      .eq('team_id', teamId)
      .order('started_at', { ascending: true })
    expect(stints).toHaveLength(2)
    expect(stints?.[0]).toMatchObject({
      user_id: targetId,
      end_reason: 'replaced',
      ended_by: commishId,
    })
    expect(stints?.[1]).toMatchObject({ user_id: successorId, ended_at: null })
  })

  it('vacate opens the seat again: placeholder cache row, franchise orphaned, stint closed as "kicked"', async () => {
    const mid = await memberIdOf(league1Id, successorId)
    const { data: before } = await service
      .from('league_members')
      .select('team_id')
      .eq('id', mid)
      .single()
    const teamId = before?.team_id ?? ''

    const result = await removeMember(commishClient, league1Id, mid, commishId, {
      mode: 'vacate',
      reason: 'moved away',
    })
    expect(result.status).toBe(200)

    const { data: row } = await service
      .from('league_members')
      .select('user_id, team_id, is_placeholder, faab_balance')
      .eq('id', mid)
      .single()
    expect(row).toMatchObject({
      user_id: null,
      team_id: teamId,
      is_placeholder: true,
      faab_balance: FAAB_BUDGET,
    })

    const { data: team } = await service
      .from('teams')
      .select('status, owner_id')
      .eq('id', teamId)
      .single()
    expect(team).toMatchObject({ status: 'orphaned', owner_id: commishId })

    const { data: closed } = await service
      .from('team_managers')
      .select('end_reason')
      .eq('team_id', teamId)
      .eq('user_id', successorId)
      .not('ended_at', 'is', null)
    expect(closed?.[0]).toMatchObject({ end_reason: 'kicked' })
  })

  it('a member DELETEing their OWN membership leaves the league (no mode needed) and loses access — E50 analogue at the API layer', async () => {
    // Seat the co-commissioner fixture on a fresh placeholder first.
    const seat = await addPlaceholderSeat(commishClient, league1Id, { team_name: 'Leavers' })
    const teamId = (seat.body as unknown as { team_id: string }).team_id
    await assignManager(commishClient, league1Id, teamId, { user_id: coId })
    const mid = await memberIdOf(league1Id, coId)

    // BEFORE: the league is listed for them (so "not listed" after is real).
    const before = await listMyLeagues(coClient, coId)
    expect(JSON.stringify(before.body)).toContain(league1Id)

    const result = await removeMember(coClient, league1Id, mid, coId, null)
    expect(result.status).toBe(200)

    const after = await listMyLeagues(coClient, coId)
    expect(JSON.stringify(after.body)).not.toContain(league1Id)

    // History retained, access gone (§7.2.1).
    const { data: closed } = await service
      .from('team_managers')
      .select('end_reason, ended_by')
      .eq('team_id', teamId)
      .eq('user_id', coId)
    expect(closed?.[0]).toMatchObject({ end_reason: 'left', ended_by: coId })
  })

  it('the commissioner cannot leave until the role is transferred (400), and CAN after (the §7.2.1:192 precondition, end to end)', async () => {
    const commishMid = await memberIdOf(league2Id, commishId)
    const blocked = await removeMember(commishClient, league2Id, commishMid, commishId, null)
    expect(blocked.status).toBe(400)

    // Transfer to the successor fixture seated on league 2, then leave.
    const successorMid = await memberIdOf(league2Id, successorId)
    const transferred = await patchMember(commishClient, league2Id, successorMid, {
      role: 'commissioner',
    })
    expect(transferred.status).toBe(200)
    expect(transferred.body).toMatchObject({ transferred: true })

    // The natural retry: the SAME client resends the SAME PATCH (a dropped
    // response, a React Query retry). Before R94 this came back 400 with copy
    // asserting the target is not commissioner — breaking the D63 contract
    // this file's own service header states.
    const replay = await patchMember(commishClient, league2Id, successorMid, {
      role: 'commissioner',
    })
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ role: 'commissioner', transferred: false })

    // R100: the CREATOR-TARGET replay — the replay above targets the successor,
    // NOT the creator, so it never reached the anti-coup guard. commishId is
    // league2's creator (owner_id). Hand the role TO the creator, then have a
    // co_commissioner replay the identical PATCH: before the R100 hoist the
    // anti-coup guard (co-commissioner actor + creator target) answered 403
    // here instead of the idempotent transferred:false. Round-trips back to the
    // successor so the departed-creator shape below is unchanged.
    const toCreator = await patchMember(successorClient, league2Id, commishMid, {
      role: 'commissioner',
    })
    expect(toCreator.status).toBe(200)
    expect(toCreator.body).toMatchObject({ transferred: true })
    const creatorReplay = await patchMember(successorClient, league2Id, commishMid, {
      role: 'commissioner',
    })
    expect(creatorReplay.status).toBe(200)
    expect(creatorReplay.body).toMatchObject({ role: 'commissioner', transferred: false })
    const backToSuccessor = await patchMember(commishClient, league2Id, successorMid, {
      role: 'commissioner',
    })
    expect(backToSuccessor.status).toBe(200)
    expect(backToSuccessor.body).toMatchObject({ transferred: true })

    const left = await removeMember(commishClient, league2Id, commishMid, commishId, null)
    expect(left.status).toBe(200)

    // The DEPARTED CREATOR shape (F36): no membership, no commish power —
    // but leagues' SELECT policy still matches on owner_id, so the league row
    // itself stays visible. Pinned so the residual is deliberate, not news.
    const { data: visible } = await commishClient
      .from('leagues')
      .select('id')
      .eq('id', league2Id)
      .maybeSingle()
    expect(visible?.id).toBe(league2Id)
    const { data: members } = await commishClient
      .from('league_members')
      .select('id')
      .eq('league_id', league2Id)
    expect(members).toHaveLength(0)
    const stillCommish = await addPlaceholderSeat(commishClient, league2Id, {})
    expect(stillCommish.status).toBe(403)

    // And the new commissioner can act.
    const seat = await addPlaceholderSeat(successorClient, league2Id, {})
    expect(seat.status).toBe(201)
  })
})

describe('FAAB parity across every seating path (§12.2 / v2.8.7)', () => {
  it('placeholder + assign + claim seats all carry the CURRENT budget, and a budget PATCH re-seeds every one of them', async () => {
    const { data: before } = await service
      .from('league_members')
      .select('faab_balance')
      .eq('league_id', league1Id)
    const distinctBefore = [...new Set((before ?? []).map((r) => r.faab_balance))]
    expect(distinctBefore).toEqual([FAAB_BUDGET])

    // A seat filled by CLAIM (the third seating path) joins the same set.
    const seat = await addPlaceholderSeat(commishClient, league1Id, { team_name: 'Claimers' })
    const teamId = (seat.body as unknown as { team_id: string }).team_id
    const invite = await createInvite(commishClient, league1Id, {
      target_team_id: teamId,
      invited_username: TARGET.username,
    })
    expect(invite.status).toBe(201)
    const token = (invite.body as unknown as { token: string }).token
    const claimed = await claimInvite(targetClient, { token })
    expect(claimed.status).toBe(200)

    const { data: afterClaim } = await service
      .from('league_members')
      .select('faab_balance')
      .eq('league_id', league1Id)
    expect([...new Set((afterClaim ?? []).map((r) => r.faab_balance))]).toEqual([FAAB_BUDGET])

    // PATCH the budget pre-draft → every seat re-seeds (061/§12.2 v2.8.7),
    // placeholders included.
    const patched = await patchLeague(commishClient, league1Id, {
      settings: { faab_budget: FAAB_BUDGET_AFTER_PATCH },
    })
    expect(patched.status).toBe(200)

    const { data: afterPatch } = await service
      .from('league_members')
      .select('faab_balance')
      .eq('league_id', league1Id)
    expect([...new Set((afterPatch ?? []).map((r) => r.faab_balance))]).toEqual([
      FAAB_BUDGET_AFTER_PATCH,
    ])
  })
})
