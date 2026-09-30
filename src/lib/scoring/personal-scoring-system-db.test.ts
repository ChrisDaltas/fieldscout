/**
 * Stack test — the personal scoring page never reads or saves a LEAGUE fork
 * (R1335; PROGRESS F523 / D451(10)).
 *
 * A commissioner who forked his league's scoring owns that fork
 * (`scoring_fork_template` inserts `owner_id = auth.uid()`), and it is the
 * newest row he owns. Before this fix the personal page read it as his own
 * rules and saved over it (since migration 170 the save was refused 42501 —
 * a 500 on a launch feature). Now, as the signed-in commissioner over the
 * real PostgREST:
 *   1. with no personal row, the read is null (not the fork) and the first
 *      save CREATES his personal row (201) — the fork untouched, no 42501;
 *   2. the next save UPDATES that personal row (200) — the fork untouched;
 *   3. the read returns the personal row and its rules;
 *   4. a `format` key is refused (400) — it would move the row out of the
 *      personal partition.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { readPersonalScoringSystem, savePersonalScoringSystem } from './personal-scoring-system'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-personal-scoring-league'
const PERSONAL_NAME = 'vitest-personal-scoring-mine'
const COMMISH = {
  email: 'personal-scoring-commish@fieldscout.test',
  password: 'personal-scoring-pass-1',
  username: 'pscore_commish',
}
// Fixed timestamps: the service takes the instant from its caller.
const SAVE_1_AT = '2026-09-30T12:00:00.000Z'
const SAVE_2_AT = '2026-09-30T12:05:00.000Z'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let commishId: string
let leagueId: string
let forkId: string
let forkRulesBefore: unknown

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id, scoring_system_id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  const forks = (stale ?? []).map((row) => row.scoring_system_id).filter((id): id is string => Boolean(id))
  if (ids.length > 0) {
    // The fork's receipt names no team; the league cascade takes it.
    const { error } = await service.from('leagues').delete().in('id', ids)
    if (error) throw new Error(`cleanup leagues: ${error.message}`)
  }
  if (forks.length > 0) {
    const { error } = await service.from('scoring_systems').delete().in('id', forks)
    if (error) throw new Error(`cleanup forks: ${error.message}`)
  }
  const { data: users } = await service.from('profiles').select('id').eq('username', COMMISH.username)
  for (const u of users ?? []) {
    const { error } = await service.from('scoring_systems').delete().eq('owner_id', u.id)
    if (error) throw new Error(`cleanup personal systems: ${error.message}`)
  }
  await deleteUserByUsername(COMMISH.username)
}

async function rowOf(id: string): Promise<{ rules: unknown; updated_at: string | null }> {
  const { data, error } = await service.from('scoring_systems').select('rules, updated_at').eq('id', id).single()
  if (error) throw new Error(`rowOf(${id}): ${error.message}`)
  return data
}

beforeAll(async () => {
  await cleanup()
  const { data: created, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`create user: ${userError.message}`)
  commishId = created.user.id

  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword(COMMISH)
  if (signInError) throw new Error(`sign in: ${signInError.message}`)

  const { data: template, error: templateError } = await service
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (templateError) throw new Error(`template: ${templateError.message}`)

  const { data: league, error: leagueError } = await service
    .from('leagues')
    .insert({
      owner_id: commishId,
      name: LEAGUE_NAME,
      season: 2026,
      status: 'setup',
      team_count: 8,
      scoring_system_id: template.id,
    })
    .select('id')
    .single()
  if (leagueError) throw new Error(`league: ${leagueError.message}`)
  leagueId = league.id
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: commishId, role: 'commissioner' })
  if (memberError) throw new Error(`member: ${memberError.message}`)

  // The commissioner forks the league's scoring — the row the old pick found.
  const { data: fork, error: forkError } = await commishClient.rpc('scoring_fork_template', {
    p_league_id: leagueId,
    p_template_id: template.id,
  })
  if (forkError) throw new Error(`fork: ${forkError.message}`)
  forkId = fork as string
  forkRulesBefore = (await rowOf(forkId)).rules
})

afterAll(async () => {
  await cleanup()
})

describe('the personal scoring page never reads or saves a league fork (R1335 / F523)', () => {
  it('premise: the league plays by a fork the commissioner owns, and it is his only row', async () => {
    const { data, error } = await service.from('scoring_systems').select('id, rules').eq('owner_id', commishId)
    expect(error).toBeNull()
    expect(data?.map((r) => r.id)).toEqual([forkId])
    expect((data?.[0]?.rules as Record<string, unknown>).format).toBe(2)
    const { data: league } = await service.from('leagues').select('scoring_system_id').eq('id', leagueId).single()
    expect(league?.scoring_system_id).toBe(forkId)
  })

  it('with no personal row the read is null — the fork is not shown as his rules', async () => {
    expect(await readPersonalScoringSystem(commishClient, commishId)).toBeNull()
  })

  it('the first save CREATES his personal row (201); the fork is untouched and nothing is refused', async () => {
    const result = await savePersonalScoringSystem(commishClient, commishId, {
      name: PERSONAL_NAME,
      rules: { passing_yards: 0.04, receptions: 0.5 },
      updatedAt: SAVE_1_AT,
    })
    expect(result).toMatchObject({ ok: true, status: 201 })
    if (!result.ok) return
    expect(result.row.id).not.toBe(forkId)
    expect(result.row.rules).toEqual({ passing_yards: 0.04, receptions: 0.5 })
    expect((await rowOf(forkId)).rules).toEqual(forkRulesBefore)
  })

  it('the next save UPDATES that personal row (200); the fork is still untouched', async () => {
    const first = await readPersonalScoringSystem(commishClient, commishId)
    const result = await savePersonalScoringSystem(commishClient, commishId, {
      name: PERSONAL_NAME,
      rules: { passing_yards: 0.05, receptions: 1 },
      updatedAt: SAVE_2_AT,
    })
    expect(result).toMatchObject({ ok: true, status: 200 })
    if (!result.ok) return
    expect(result.row.id).toBe(first?.id)
    expect((await rowOf(forkId)).rules).toEqual(forkRulesBefore)
    const { count } = await service
      .from('scoring_systems')
      .select('id', { count: 'exact', head: false })
      .eq('owner_id', commishId)
    expect(count).toBe(2)
  })

  it('the read returns his personal rules', async () => {
    const row = await readPersonalScoringSystem(commishClient, commishId)
    expect(row?.name).toBe(PERSONAL_NAME)
    expect(row?.rules).toEqual({ passing_yards: 0.05, receptions: 1 })
  })

  it('a "format" key is refused (400) and writes nothing', async () => {
    const before = await readPersonalScoringSystem(commishClient, commishId)
    const result = await savePersonalScoringSystem(commishClient, commishId, {
      name: PERSONAL_NAME,
      rules: { format: 2, receptions: 1 },
      updatedAt: SAVE_2_AT,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect((await readPersonalScoringSystem(commishClient, commishId))?.rules).toEqual(before?.rules)
  })
})
