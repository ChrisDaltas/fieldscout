/**
 * lifecycle-db.test.ts — L.A1.11 item 4: the create → schedule →
 * force-transition probe against the LOCAL Supabase stack, end-to-end
 * through PostgREST (the exact wire path production RPCs use).
 *
 * SCOPING (recorded in PROGRESS D63): the task text's "create" step means
 * `create_league` — which is L.A1.12 work and gated on the Q10 ruling
 * (PROGRESS §5 B4), so it does not exist yet. Per the task pointer, the
 * league row is seeded DIRECTLY via the service-role path (the same
 * privileged-fixture pattern pgTAP 013 uses), and this suite exercises
 * everything 059 shipped: set_league_status boundaries, the D43 guard
 * against the service-role REST path, non-commish denial, and the snapshot
 * freeze deep-equalling the authored template rules (the L.A1.9(5)
 * TS↔DB link, extended through the RPC).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * same precondition as `npm run test:db` and templates-db.test.ts. FAILS
 * loudly when the stack is down; never skips (§4.3 falsifiability; D59(5)).
 *
 * Determinism note: fixtures use FIXED emails/usernames + cleanup-first
 * (no wall-clock/random uniqueness — the D3 time/random lint bans cover
 * test files under src/lib/leagues/** too, D17).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SCORING_TEMPLATES } from '../scoring/templates'

// The Supabase CLI's fixed local development URL + demo keys (printed by
// `npx supabase status`; identical for every local stack — not secrets).
const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-lifecycle-league'
const COMMISH = {
  email: 'lifecycle-commish@fieldscout.test',
  password: 'pgtap-lifecycle-pass-1',
  username: 'lifecycle_cmsh1',
}
const OUTSIDER = {
  email: 'lifecycle-outsider@fieldscout.test',
  password: 'pgtap-lifecycle-pass-2',
  username: 'lifecycle_outs1',
}

const service = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  await service.from('leagues').delete().eq('name', LEAGUE_NAME)
  await deleteUserByUsername(COMMISH.username)
  await deleteUserByUsername(OUTSIDER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient> {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

describe('league lifecycle end-to-end (059 — local stack, PostgREST wire path)', () => {
  let leagueId: string
  let espnStandardRules: Record<string, number>
  let commishClient: SupabaseClient
  let outsiderClient: SupabaseClient

  beforeAll(async () => {
    // Cleanup-first keeps the fixed fixtures idempotent across runs.
    await cleanup()

    for (const user of [COMMISH, OUTSIDER]) {
      const { error } = await service.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { username: user.username },
      })
      if (error) throw new Error(`createUser(${user.email}) failed: ${error.message}`)
    }

    const { data: commishProfile, error: profileError } = await service
      .from('profiles')
      .select('id')
      .eq('username', COMMISH.username)
      .single()
    if (profileError || !commishProfile) {
      throw new Error(`commish profile missing: ${profileError?.message}`)
    }

    const { data: template, error: templateError } = await service
      .from('scoring_systems')
      .select('id')
      .eq('is_template', true)
      .eq('name', 'ESPN Standard')
      .single()
    if (templateError || !template) {
      throw new Error(`ESPN Standard template missing (is 058 applied?): ${templateError?.message}`)
    }

    // Seed the league + commissioner membership via the service-role path
    // (create_league is L.A1.12 — see the header scoping note).
    const { data: league, error: leagueError } = await service
      .from('leagues')
      .insert({
        name: LEAGUE_NAME,
        owner_id: commishProfile.id,
        season: 2026,
        scoring_system_id: template.id,
      })
      .select('id, status, scoring_rules_snapshot')
      .single()
    if (leagueError || !league) throw new Error(`league seed failed: ${leagueError?.message}`)
    expect(league.status).toBe('setup')
    expect(league.scoring_rules_snapshot).toBeNull()
    leagueId = league.id

    const { error: memberError } = await service.from('league_members').insert({
      league_id: leagueId,
      user_id: commishProfile.id,
      role: 'commissioner',
    })
    if (memberError) throw new Error(`membership seed failed: ${memberError.message}`)

    commishClient = await signIn(COMMISH)
    outsiderClient = await signIn(OUTSIDER)

    const espn = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Standard')
    if (!espn) throw new Error('ESPN Standard missing from SCORING_TEMPLATES')
    espnStandardRules = espn.rules
  }, 30_000)

  afterAll(async () => {
    await cleanup()
  })

  it('refuses scheduled while draft_scheduled_at is unset (P0001, in-body)', async () => {
    const { error } = await commishClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'scheduled',
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('draft_scheduled_at is not set')
  })

  it('reaches scheduled once the draft instant exists, and can come back to setup', async () => {
    const { error: setError } = await service
      .from('leagues')
      .update({ settings: { draft_scheduled_at: '2026-09-13T17:00:00+00:00' } })
      .eq('id', leagueId)
    expect(setError).toBeNull()

    const { error } = await commishClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'scheduled',
    })
    expect(error).toBeNull()

    const { data } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(data?.status).toBe('scheduled')

    // Retry is an idempotent no-op (D63).
    const { error: retryError } = await commishClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'scheduled',
    })
    expect(retryError).toBeNull()

    const { error: backError } = await commishClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'setup',
    })
    expect(backError).toBeNull()
    const { data: back } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(back?.status).toBe('setup')
  })

  it('refuses drafting via set_league_status in M1 — the draft engine lands in M2', async () => {
    const { error } = await commishClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'drafting',
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('the draft engine lands in M2')
  })

  it('denies both RPCs to a non-commissioner (42501, in-body)', async () => {
    const { error: statusError } = await outsiderClient.rpc('set_league_status', {
      p_league_id: leagueId,
      p_status: 'scheduled',
    })
    expect(statusError?.code).toBe('42501')

    const { error: snapshotError } = await outsiderClient.rpc('snapshot_league_scoring', {
      p_league_id: leagueId,
    })
    expect(snapshotError?.code).toBe('42501')
  })

  it('FORCE-TRANSITION PROBE: even the service-role REST path cannot reach drafting without a snapshot (D43)', async () => {
    const { error } = await service.from('leagues').update({ status: 'drafting' }).eq('id', leagueId)
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('without scoring_rules_snapshot')

    const { data } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(data?.status).toBe('setup')
  })

  it('commissioner freezes the snapshot; it deep-equals the authored ESPN Standard rules', async () => {
    const { error } = await commishClient.rpc('snapshot_league_scoring', {
      p_league_id: leagueId,
    })
    expect(error).toBeNull()

    const { data } = await service
      .from('leagues')
      .select('scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    // toStrictEqual: the frozen copy is the authored template, values AND
    // key-set — the §7.3.3 freeze carries exactly what L.A1.10's parity
    // suite scored.
    expect(data?.scoring_rules_snapshot).toStrictEqual(espnStandardRules)
  })

  it('with the snapshot present, the privileged transition into drafting succeeds (counter-pin)', async () => {
    const { error } = await service.from('leagues').update({ status: 'drafting' }).eq('id', leagueId)
    expect(error).toBeNull()

    const { data } = await service.from('leagues').select('status').eq('id', leagueId).single()
    expect(data?.status).toBe('drafting')
  })
})
