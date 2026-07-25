/**
 * leagues-api-db.test.ts — L.A1.12 item 4: league CRUD integration against
 * the LOCAL Supabase stack, end-to-end through PostgREST (the exact wire
 * path production uses).
 *
 * WHAT'S UNDER TEST (D68): the SERVICE layer (`leagues-service.ts`) driven
 * with real signed-in clients — the same composition the Route Handlers
 * wrap (Zod parse → validateLeagueSettings → splitSettings → create_league
 * RPC; RLS-scoped reads; soft_delete_league RPC). The Next routes add only
 * cookie/auth plumbing on top (CLAUDE.md: routes carry minimal logic). The
 * RPC layer is additionally driven DIRECTLY for the idempotency pin (the
 * task's "pin the double-submit at both layers").
 *
 * Held-lock note (plan §8.3): create_league takes NO locks on pre-existing
 * rows (no FOR UPDATE/advisory locks — the double-submit race settles on
 * the creation_action_id UNIQUE constraint), so the <50ms held-lock
 * assertion is inapplicable — cited in the 060 banner + D68 rather than
 * silently skipped.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * same precondition as `npm run test:db` (D59(5)). FAILS loudly when the
 * stack is down; never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (no
 * wall-clock/random uniqueness — the D3/D17 lint bans cover leagues test
 * files).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  defaultsForTeamCount,
  splitSettings,
  V1_TEAM_COUNTS,
  type LeagueSettings,
} from '../settings/league-settings'
import {
  createLeague,
  deleteLeague,
  getLeagueDetail,
  listMyLeagues,
} from './leagues-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME_PREFIX = 'vitest-crud-league'

const CREATOR = {
  email: 'leagues-api-creator@fieldscout.test',
  password: 'pgtap-leagues-pass-1',
  username: 'lg_creator_one',
}
const OUTSIDER = {
  email: 'leagues-api-outsider@fieldscout.test',
  password: 'pgtap-leagues-pass-2',
  username: 'lg_outsider_two',
}

// Fixed action_ids (deterministic — one per logical create in this suite).
const ACTION = {
  sweep8: 'ad000000-0000-4000-8000-000000000008',
  sweep10: 'ad000000-0000-4000-8000-000000000010',
  sweep12: 'ad000000-0000-4000-8000-000000000012',
  sweep14: 'ad000000-0000-4000-8000-000000000014',
  sweep16: 'ad000000-0000-4000-8000-000000000016',
  personal: 'ad000000-0000-4000-8000-0000000000a1',
  invalid: 'ad000000-0000-4000-8000-0000000000a2',
  doubleRoute: 'ad000000-0000-4000-8000-0000000000a3',
  doubleRpc: 'ad000000-0000-4000-8000-0000000000a4',
} as const
const sweepActionId = (teamCount: number): string =>
  ACTION[`sweep${teamCount}` as keyof typeof ACTION]

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let creatorClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let creatorId: string
let personalScoringId: string
let espnStandardId: string

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
    // teams.league_id has no ON DELETE action — clear franchises first.
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await deleteUserByUsername(CREATOR.username)
  await deleteUserByUsername(OUTSIDER.username)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** The full valid create body for one sweep size (non-default faab 250 so the seed pin is falsifiable). */
function sweepInput(teamCount: (typeof V1_TEAM_COUNTS)[number]): {
  name: string
  season: number
  scoring_system_id: string
  team_name: string
  action_id: string
  settings: LeagueSettings
} {
  const settings = defaultsForTeamCount(teamCount)
  settings.faab_budget = 250
  return {
    name: `${LEAGUE_NAME_PREFIX}-${teamCount}`,
    season: 2026,
    scoring_system_id: espnStandardId,
    team_name: `Crushers ${teamCount}`,
    action_id: sweepActionId(teamCount),
    settings,
  }
}

describe('league CRUD end-to-end (060 — local stack, PostgREST wire path)', () => {
  beforeAll(async () => {
    await cleanup()

    for (const user of [CREATOR, OUTSIDER]) {
      const { error } = await service.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { username: user.username },
      })
      if (error) throw new Error(`createUser(${user.email}) failed: ${error.message}`)
    }

    const { data: creatorProfile } = await service
      .from('profiles')
      .select('id, is_pro')
      .eq('username', CREATOR.username)
      .single()
    if (!creatorProfile) throw new Error('creator profile missing')
    creatorId = creatorProfile.id

    const { data: template } = await service
      .from('scoring_systems')
      .select('id')
      .eq('is_template', true)
      .eq('name', 'ESPN Standard')
      .single()
    if (!template) throw new Error('ESPN Standard template missing (is 058 applied?)')
    espnStandardId = template.id

    const { data: outsiderProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', OUTSIDER.username)
      .single()
    if (!outsiderProfile) throw new Error('outsider profile missing')

    // A PERSONAL (owner-scoped, non-template) scoring system — the v1
    // templates-only negative (§7.3.3).
    const { data: personal, error: personalError } = await service
      .from('scoring_systems')
      .insert({
        owner_id: outsiderProfile.id,
        name: 'vitest-personal-system',
        rules: { passing_yards: 0.05 },
      })
      .select('id')
      .single()
    if (personalError || !personal) {
      throw new Error(`personal scoring seed failed: ${personalError?.message}`)
    }
    personalScoringId = personal.id

    creatorClient = await signIn(CREATOR)
    outsiderClient = await signIn(OUTSIDER)
  }, 30_000)

  afterAll(async () => {
    await cleanup()
  })

  it('a FREE (non-Pro) user is the creator fixture — Q6/v2.8, ledger F5 create half', async () => {
    const { data } = await service.from('profiles').select('is_pro').eq('id', creatorId).single()
    // Explicit falsy pin: a Pro flag on this fixture would make every
    // "creation is free" pin below vacuous.
    expect(Boolean(data?.is_pro)).toBe(false)
  })

  it.each([...V1_TEAM_COUNTS])(
    'creates at team_count %i (Phase A gate size): commissioner + team + OPEN stint + faab seed',
    async (teamCount) => {
      const input = sweepInput(teamCount)
      const result = await createLeague(creatorClient, input)
      expect(result.status).toBe(201)
      const body = result.body as {
        league_id: string
        team_id: string
        invite_code: string
        replayed: boolean
      }
      expect(body.replayed).toBe(false)
      expect(body.invite_code).toHaveLength(10)

      // League row: typed columns as split, max_teams synced (§12.1).
      const { data: league } = await service
        .from('leagues')
        .select('*')
        .eq('id', body.league_id)
        .single()
      expect(league?.team_count).toBe(teamCount)
      expect(league?.max_teams).toBe(teamCount)
      expect(league?.status).toBe('setup')
      expect(league?.owner_id).toBe(creatorId)
      expect(league?.faab_budget).toBe(250)
      expect(league?.scoring_rules_snapshot).toBeNull()
      expect(league?.creation_action_id).toBe(input.action_id)
      // The stored blob is EXACTLY splitSettings' blob half (D60 authority).
      expect(league?.settings).toStrictEqual(splitSettings(input.settings).blob)

      // Creator seated as commissioner with a team (§12.2), faab_balance
      // seeded from faab_budget — the NON-default 250.
      const { data: members } = await service
        .from('league_members')
        .select('user_id, role, team_id, faab_balance')
        .eq('league_id', body.league_id)
      expect(members).toHaveLength(1)
      expect(members?.[0]).toMatchObject({
        user_id: creatorId,
        role: 'commissioner',
        team_id: body.team_id,
        faab_balance: 250,
      })

      // Franchise: named as passed, no backing list (D35a).
      const { data: team } = await service
        .from('teams')
        .select('name, owner_id, list_id, league_id')
        .eq('id', body.team_id)
        .single()
      expect(team).toMatchObject({
        name: `Crushers ${teamCount}`,
        owner_id: creatorId,
        list_id: null,
        league_id: body.league_id,
      })

      // OPEN stint asserted DIRECTLY (task item 4; §12.22).
      const { data: stints } = await service
        .from('team_managers')
        .select('user_id, ended_at, started_week, role')
        .eq('team_id', body.team_id)
      expect(stints).toHaveLength(1)
      expect(stints?.[0]).toMatchObject({
        user_id: creatorId,
        ended_at: null,
        started_week: null,
        role: 'manager',
      })
    },
  )

  it('REJECTS a personal (owner-scoped, non-template) scoring system — per-field 400, NO league row (§7.3.3)', async () => {
    const input = { ...sweepInput(10), action_id: ACTION.personal, scoring_system_id: personalScoringId }
    const result = await createLeague(creatorClient, input)
    expect(result.status).toBe(400)
    const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
    expect(body.error.fieldErrors.scoring_system_id?.[0]).toContain(
      'personal scoring systems cannot be attached to a league in v1',
    )

    // No-write pin: the rejected create left nothing behind.
    const { data: rows } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.personal)
    expect(rows).toHaveLength(0)
  })

  it('REJECTS invalid settings with the per-field message — the Q10 overlap pair (§7.3.8 API enforcement point)', async () => {
    const settings = defaultsForTeamCount(12)
    settings.regular_season_weeks = 15
    settings.playoff_start_week = 14 // the Q10 live-probe overlap pair (D67(5))
    const input = { ...sweepInput(12), action_id: ACTION.invalid, settings }
    const result = await createLeague(creatorClient, input)
    expect(result.status).toBe(400)
    const body = result.body as { error: { fieldErrors: Record<string, string[]> } }
    expect(body.error.fieldErrors.playoff_start_week).toStrictEqual([
      'Playoffs must start the week after the regular season ends — week 16 for a 15-week regular season (currently week 14).',
    ])

    const { data: rows } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.invalid)
    expect(rows).toHaveLength(0)
  })

  it('REJECTS a malformed body at the Zod layer (unknown team_count never reaches the DB)', async () => {
    const input = sweepInput(12) as Record<string, unknown>
    const settings = structuredClone(input.settings) as Record<string, unknown>
    settings.team_count = 9 // not a v1 size — leagueSettingsSchema union rejects
    const result = await createLeague(creatorClient, { ...input, settings })
    expect(result.status).toBe(400)
    expect((result.body as { error: unknown }).error).toBeTruthy()
  })

  it('double-submit at the ROUTE layer replays: same action_id → 200, same league, ONE row', async () => {
    const input = { ...sweepInput(12), action_id: ACTION.doubleRoute, name: `${LEAGUE_NAME_PREFIX}-double` }
    const first = await createLeague(creatorClient, input)
    expect(first.status).toBe(201)
    const firstBody = first.body as { league_id: string; replayed: boolean }

    const second = await createLeague(creatorClient, input)
    expect(second.status).toBe(200)
    const secondBody = second.body as { league_id: string; team_id: string; replayed: boolean }
    expect(secondBody.replayed).toBe(true)
    expect(secondBody.league_id).toBe(firstBody.league_id)

    const { data: rows } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.doubleRoute)
    expect(rows).toHaveLength(1)
  })

  it('double-submit at the RPC layer replays too (direct PostgREST rpc, no service layer)', async () => {
    const settings = defaultsForTeamCount(8)
    const { columns, blob } = splitSettings(settings)
    const args = {
      p_name: `${LEAGUE_NAME_PREFIX}-rpc-double`,
      p_season: 2026,
      p_scoring_system_id: espnStandardId,
      p_team_name: '',
      p_action_id: ACTION.doubleRpc,
      p_settings: blob,
      ...Object.fromEntries(Object.entries(columns).map(([k, v]) => [`p_${k}`, v])),
    } as unknown as Database['public']['Functions']['create_league']['Args']

    const first = await creatorClient.rpc('create_league', args)
    expect(first.error).toBeNull()
    const second = await creatorClient.rpc('create_league', args)
    expect(second.error).toBeNull()
    const firstResult = first.data as { league_id: string; replayed: boolean }
    const secondResult = second.data as { league_id: string; replayed: boolean }
    expect(firstResult.replayed).toBe(false)
    expect(secondResult.replayed).toBe(true)
    expect(secondResult.league_id).toBe(firstResult.league_id)

    const { data: rows } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.doubleRpc)
    expect(rows).toHaveLength(1)
  })

  it('GET /api/leagues (service): my leagues via league_members, commissioner role on each', async () => {
    const result = await listMyLeagues(creatorClient, creatorId)
    expect(result.status).toBe(200)
    const { leagues } = result.body as {
      leagues: Array<{ id: string; name: string; my_role: string; team_count: number }>
    }
    const mine = leagues.filter((l) => l.name.startsWith(LEAGUE_NAME_PREFIX))
    // 5 sweep sizes + route-double + rpc-double = 7 leagues.
    expect(mine).toHaveLength(7)
    expect(new Set(mine.map((l) => l.my_role))).toStrictEqual(new Set(['commissioner']))
  })

  it('GET /api/leagues/[id] (service): settings ROUND-TRIP the submitted contract object; members/teams/my_role', async () => {
    const input = sweepInput(14)
    const { data: league } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.sweep14)
      .single()
    if (!league) throw new Error('sweep-14 league missing')

    const result = await getLeagueDetail(creatorClient, creatorId, league.id)
    expect(result.status).toBe(200)
    const body = result.body as {
      league: { id: string; max_teams: number; invite_code: string | null }
      settings: LeagueSettings
      members: Array<{ role: string; user_id: string | null }>
      teams: Array<{ name: string }>
      my_role: string | null
    }
    // Golden round-trip: what came back through splitSettings → DB →
    // mergeSettings is EXACTLY what was submitted (gate item 3's per-field
    // sweep is L.A1.13; this pins the create-path round-trip wholesale).
    expect(body.settings).toStrictEqual(input.settings)
    expect(body.league.max_teams).toBe(14)
    expect(body.league.invite_code).toHaveLength(10)
    expect(body.members).toHaveLength(1)
    expect(body.members[0]).toMatchObject({ role: 'commissioner', user_id: creatorId })
    expect(body.teams).toHaveLength(1)
    expect(body.teams[0]?.name).toBe('Crushers 14')
    expect(body.my_role).toBe('commissioner')
  })

  it('a NON-MEMBER cannot see the league detail — RLS yields 404, no existence leak', async () => {
    const { data: league } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.sweep14)
      .single()
    if (!league) throw new Error('sweep-14 league missing')

    const { data: outsiderProfile } = await service
      .from('profiles')
      .select('id')
      .eq('username', OUTSIDER.username)
      .single()
    const result = await getLeagueDetail(outsiderClient, outsiderProfile?.id ?? '', league.id)
    expect(result.status).toBe(404)
  })

  it('DELETE (service): outsider 403; commissioner soft-deletes; detail 404s; list shrinks; retry idempotent', async () => {
    const { data: league } = await service
      .from('leagues')
      .select('id')
      .eq('creation_action_id', ACTION.sweep8)
      .single()
    if (!league) throw new Error('sweep-8 league missing')

    const denied = await deleteLeague(outsiderClient, league.id)
    expect(denied.status).toBe(403)

    const deleted = await deleteLeague(creatorClient, league.id)
    expect(deleted.status).toBe(200)

    // Soft, not hard (CLAUDE.md rule 8): the row survives with deleted_at.
    const { data: row } = await service
      .from('leagues')
      .select('deleted_at')
      .eq('id', league.id)
      .single()
    expect(row?.deleted_at).not.toBeNull()

    const detail = await getLeagueDetail(creatorClient, creatorId, league.id)
    expect(detail.status).toBe(404)

    const list = await listMyLeagues(creatorClient, creatorId)
    const { leagues } = list.body as { leagues: Array<{ id: string }> }
    expect(leagues.some((l) => l.id === league.id)).toBe(false)

    // Retry is an idempotent no-op success (D63 doctrine).
    const retried = await deleteLeague(creatorClient, league.id)
    expect(retried.status).toBe(200)
  })
})
