/**
 * invites-api-db.test.ts — L.A1.14 item 4: invite/join/claim integration
 * against the LOCAL Supabase stack through PostgREST (the production wire
 * path), driving the SERVICE layer (`invites-service.ts`) with real
 * signed-in clients — real JWT email claims, so E53/E65 matching runs
 * against genuine tokens, not synthetic set_config claims (the pgTAP 016
 * suite covers the same algebra DB-side; this suite proves the service
 * composition + outcome→status mapping + the D37 email seam).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the
 * D3/D17 lint bans cover leagues test files — no wall-clock/random
 * uniqueness anywhere).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { EmailMessage, EmailSender } from '@/lib/email/email-sender'
import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  claimInvite,
  createInvite,
  joinLeague,
  revokeInvite,
  rotateInviteCode,
  setInviteSlug,
} from './invites-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-invites-league'

const COMMISH = {
  email: 'invites-api-commish@fieldscout.test',
  password: 'pgtap-invites-pass-1',
  username: 'iv_commish_one',
}
/** The invited account — invited_email is stored in a DIFFERENT case, so a
 *  successful claim proves case-insensitive JWT-email matching (E65). */
const INVITEE = {
  email: 'invites-api-invitee@fieldscout.test',
  password: 'pgtap-invites-pass-2',
  username: 'iv_invitee_two',
}
const WRONG = {
  email: 'invites-api-wrong@fieldscout.test',
  password: 'pgtap-invites-pass-3',
  username: 'iv_wrong_three',
}
/** FREE user who joins TWO leagues (C3/C4 — the 018 cap must not fire). */
const JOINER = {
  email: 'invites-api-joiner@fieldscout.test',
  password: 'pgtap-invites-pass-4',
  username: 'iv_joiner_four',
}

const ACTION = {
  league1: 'ae000000-0000-4000-8000-000000000001',
  league2: 'ae000000-0000-4000-8000-000000000002',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Capturing fake for the D37 seam — the route-level email test double. */
class CapturingEmailSender implements EmailSender {
  messages: EmailMessage[] = []
  async send(message: EmailMessage) {
    this.messages.push(message)
    return { ok: true, sender: 'capturing-fake' }
  }
}

let commishClient: SupabaseClient<Database>
let inviteeClient: SupabaseClient<Database>
let wrongClient: SupabaseClient<Database>
let joinerClient: SupabaseClient<Database>
let anonClient: SupabaseClient<Database>
let joinerId: string
let league1Id: string
let league1Code: string
let league2Id: string
let seatTeamId: string

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
  for (const u of [COMMISH, INVITEE, WRONG, JOINER]) {
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
  const settings = defaultsForTeamCount(8)
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

beforeAll(async () => {
  await cleanup()
  await createUser(COMMISH)
  await createUser(INVITEE)
  await createUser(WRONG)
  joinerId = await createUser(JOINER)
  commishClient = await signIn(COMMISH)
  inviteeClient = await signIn(INVITEE)
  wrongClient = await signIn(WRONG)
  joinerClient = await signIn(JOINER)
  anonClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })

  league1Id = await createLeagueAsCommish(`${LEAGUE_NAME_PREFIX}-1`, ACTION.league1)
  league2Id = await createLeagueAsCommish(`${LEAGUE_NAME_PREFIX}-2`, ACTION.league2)
  const { data: l1 } = await commishClient
    .from('leagues')
    .select('invite_code')
    .eq('id', league1Id)
    .single()
  league1Code = l1?.invite_code ?? ''

  // Seat-target franchise (L.A1.15's placeholder RPC doesn't exist yet —
  // privileged fixture, same as pgTAP 016).
  const { data: commishProfile } = await service
    .from('profiles')
    .select('id')
    .eq('username', COMMISH.username)
    .single()
  const { data: team, error } = await service
    .from('teams')
    .insert({
      owner_id: commishProfile?.id ?? '',
      name: 'vitest-invites-seat-team',
      league_id: league1Id,
      list_id: null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`seat team insert failed: ${error.message}`)
  seatTeamId = team.id
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('invite creation + the D37 email seam', () => {
  let inviteToken: string
  let inviteId: string

  it('commissioner creates a seat-targeted EMAIL invite; the seam sends league name, team label, and the /join/[token] link', async () => {
    const sender = new CapturingEmailSender()
    // Invited email in a DIFFERENT case than the account's — E65 matching
    // must be case-insensitive end-to-end.
    const result = await createInvite(
      commishClient,
      league1Id,
      {
        target_team_id: seatTeamId,
        invited_email: 'Invites-API-Invitee@Fieldscout.TEST',
      },
      sender,
    )
    expect(result.status).toBe(201)
    const body = result.body as unknown as {
      invite_id: string
      token: string
      resent: boolean
      email_sent: boolean
    }
    inviteToken = body.token
    inviteId = body.invite_id
    expect(body.resent).toBe(false)
    expect(body.email_sent).toBe(true)
    expect(sender.messages).toHaveLength(1)
    expect(sender.messages[0].to).toBe('Invites-API-Invitee@Fieldscout.TEST')
    expect(sender.messages[0].subject).toContain('vitest-invites-league-1')
    expect(sender.messages[0].text).toContain('vitest-invites-seat-team')
    expect(sender.messages[0].text).toContain(`/join/${body.token}`)
  })

  it('re-creating the same live invite RE-SENDS (200, resent, last_sent_at stamped — D46) instead of duplicating', async () => {
    const sender = new CapturingEmailSender()
    const result = await createInvite(
      commishClient,
      league1Id,
      { target_team_id: seatTeamId, invited_email: INVITEE.email },
      sender,
    )
    expect(result.status).toBe(200)
    const body = result.body as unknown as { invite_id: string; resent: boolean }
    expect(body.resent).toBe(true)
    expect(body.invite_id).toBe(inviteId)
    expect(sender.messages).toHaveLength(1)
    const { data: row } = await commishClient
      .from('league_invites')
      .select('last_sent_at, created_at')
      .eq('id', inviteId)
      .single()
    expect(row?.last_sent_at).not.toBeNull()
  })

  it('a non-commissioner cannot create invites (403) and cannot see invite rows (commish-only SELECT)', async () => {
    const result = await createInvite(wrongClient, league1Id, { max_uses: 1 })
    expect(result.status).toBe(403)
    const { data } = await wrongClient.from('league_invites').select('id').eq('league_id', league1Id)
    expect(data).toEqual([])
  })

  it('pre-auth preview over the ANON key returns exactly the D48 three-field shape (F2)', async () => {
    const { data, error } = await anonClient.rpc('get_join_preview', { p_value: inviteToken })
    expect(error).toBeNull()
    expect(data).toEqual({
      found: true,
      type: 'invite',
      status: 'ok',
      league_name: 'vitest-invites-league-1',
      team_label: 'vitest-invites-seat-team',
      inviter_name: COMMISH.username,
      seats_open: null,
    })
  })

  it('E53: the WRONG signed-in account claiming → 403 mismatch, invite intact', async () => {
    const result = await claimInvite(wrongClient, { token: inviteToken })
    expect(result.status).toBe(403)
    expect((result.body as { reason?: string }).reason).toBe('mismatch')
    const { data: row } = await commishClient
      .from('league_invites')
      .select('use_count, claimed_by')
      .eq('id', inviteId)
      .single()
    expect(row).toEqual({ use_count: 0, claimed_by: null })
  })

  it('E65: the invited account claims (real JWT email claim, case-insensitive) and is seated on the exact franchise with an open stint', async () => {
    const result = await claimInvite(inviteeClient, { token: inviteToken })
    expect(result.status).toBe(200)
    const body = result.body as unknown as {
      ok: boolean
      already_member: boolean
      team_id: string
      league_id: string
    }
    expect(body.ok).toBe(true)
    expect(body.already_member).toBe(false)
    expect(body.team_id).toBe(seatTeamId)
    expect(body.league_id).toBe(league1Id)

    // Seated: membership + open stint, faab seeded (member-visible reads).
    const { data: member } = await inviteeClient
      .from('league_members')
      .select('role, team_id, faab_balance, is_placeholder')
      .eq('league_id', league1Id)
      .eq('team_id', seatTeamId)
      .single()
    expect(member).toEqual({
      role: 'manager',
      team_id: seatTeamId,
      faab_balance: 100,
      is_placeholder: false,
    })
    const { data: stints } = await inviteeClient
      .from('team_managers')
      .select('ended_at')
      .eq('team_id', seatTeamId)
    expect(stints).toEqual([{ ended_at: null }])
  })

  it('claim retry is idempotent (200, already_member, use_count unchanged — D63)', async () => {
    const result = await claimInvite(inviteeClient, { token: inviteToken })
    expect(result.status).toBe(200)
    expect((result.body as { already_member?: boolean }).already_member).toBe(true)
    const { data: row } = await commishClient
      .from('league_invites')
      .select('use_count')
      .eq('id', inviteId)
      .single()
    expect(row?.use_count).toBe(1)
  })

  it('revoke → 410 revoked on a later claim; unknown token → 404', async () => {
    const create = await createInvite(commishClient, league1Id, { max_uses: 5 })
    const created = create.body as unknown as { invite_id: string; token: string }
    const revoke = await revokeInvite(commishClient, created.invite_id)
    expect(revoke.status).toBe(200)
    const claim = await claimInvite(wrongClient, { token: created.token })
    expect(claim.status).toBe(410)
    expect((claim.body as { reason?: string }).reason).toBe('revoked')
    const unknown = await claimInvite(wrongClient, { token: 'no-such-token' })
    expect(unknown.status).toBe(404)
  })
})

describe('join by code/slug, rotation, capacity, F5 free-join', () => {
  it('a FREE user joins by code: team + membership + open stint created', async () => {
    // F5 pin is real only if the fixture is FREE:
    const { data: profile } = await service
      .from('profiles')
      .select('is_pro')
      .eq('id', joinerId)
      .single()
    expect(profile?.is_pro).toBe(false)

    const result = await joinLeague(joinerClient, { code: league1Code })
    expect(result.status).toBe(200)
    const body = result.body as unknown as { ok: boolean; team_id: string }
    expect(body.ok).toBe(true)
    const { data: stint } = await joinerClient
      .from('team_managers')
      .select('ended_at, user_id')
      .eq('team_id', body.team_id)
    expect(stint).toEqual([{ ended_at: null, user_id: joinerId }])
  })

  it('rotation (§22.5): old code stops joining, new code previews; the slug survives and resolves case-insensitively', async () => {
    const slug = await setInviteSlug(commishClient, league2Id, {
      invite_slug: 'Vitest-Invites-Slug',
    })
    expect(slug.status).toBe(200)
    expect(slug.body).toEqual({ invite_slug: 'vitest-invites-slug' })

    const { data: before } = await commishClient
      .from('leagues')
      .select('invite_code')
      .eq('id', league2Id)
      .single()
    const oldCode = before?.invite_code ?? ''

    const rotate = await rotateInviteCode(commishClient, league2Id)
    expect(rotate.status).toBe(200)
    const newCode = (rotate.body as { invite_code?: string }).invite_code ?? ''
    expect(newCode).not.toBe(oldCode)

    const dead = await joinLeague(joinerClient, { code: oldCode })
    expect(dead.status).toBe(404)
    expect((dead.body as { reason?: string }).reason).toBe('not_found')

    // Slug still resolves pre-auth after rotation (case-variant).
    const { data: preview } = await anonClient.rpc('get_join_preview', {
      p_value: 'VITEST-INVITES-SLUG',
    })
    expect((preview as { type?: string; status?: string }).type).toBe('slug')

    // C3/C4: the same FREE user joins a SECOND league (via the slug) — the
    // 018 cap (lists.is_team only, D35) must not fire.
    const second = await joinLeague(joinerClient, { code: 'vitest-invites-slug' })
    expect(second.status).toBe(200)
    const { data: memberships } = await service
      .from('league_members')
      .select('league_id')
      .eq('user_id', joinerId)
    expect(memberships?.map((m) => m.league_id).sort()).toEqual([league1Id, league2Id].sort())
  })

  it('D47: a full league refuses joins with "league is full" and writes nothing', async () => {
    // Fill league2 to team_count = 8 with privileged filler franchises.
    const { data: commishProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', COMMISH.username)
      .single()
    const { count: current } = await service
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', league2Id)
    const fillers = 8 - (current ?? 0)
    for (let i = 0; i < fillers; i++) {
      await service.from('teams').insert({
        owner_id: commishProfile?.id ?? '',
        name: `vitest-invites-filler-${i}`,
        league_id: league2Id,
        list_id: null,
      })
    }
    const result = await joinLeague(wrongClient, { code: 'vitest-invites-slug' })
    expect(result.status).toBe(409)
    expect((result.body as { reason?: string; message?: string }).reason).toBe('league_full')
    expect((result.body as { message?: string }).message).toContain('full')
    const { count: after } = await service
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', league2Id)
    expect(after).toBe(8)
  })
})
