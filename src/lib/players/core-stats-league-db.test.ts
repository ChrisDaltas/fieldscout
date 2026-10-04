/**
 * core-stats-league-db.test.ts — R1504: the player page's core-stats read in
 * LEAGUE mode over the real local stack (D486(10)/(11)).
 *
 *  L1 Each opened week is scored under ITS OWN stored rules, not the
 *     league's current snapshot (144 / F397). The league's snapshot is ESPN
 *     Standard (0 PPR); week 1 was opened under Full PPR (1 PPR) and week 2
 *     under ESPN Standard. The same line both weeks (5 rec / 80 yds / 1 TD):
 *     19 + 14 = 33 — not 28 (snapshot both weeks) and not 38 (PPR both).
 *  L2 A non-member is refused (403) and learns nothing — no `basis`, no
 *     league name.
 *
 * Season 2076 (unused elsewhere). Requires the local stack — D59(5).
 * Fixture hygiene (F199): every `pcl-` row is deleted before and after.
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { forkTemplateDoc } from '../leagues/scoring/rules-doc'
import { SCORING_TEMPLATES } from '../leagues/scoring/templates'
import type { TimeProvider } from '../leagues/time/time-provider'
import type { CoreStatsPayload } from './core-stats-ops'
import { readPlayerCoreStats } from './core-stats-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SEASON = 2076
const P = 'pcl-'
const LEAGUE_NAME = 'vitest-pcl-league'
const MEMBER = { email: 'pcl-member@fieldscout.local', password: 'pcl-password-1234', username: 'pcl_member' }
const OUTSIDER = { email: 'pcl-outsider@fieldscout.local', password: 'pcl-password-1234', username: 'pcl_outsider' }
const clock: TimeProvider = { now: () => new Date('2076-10-01T12:00:00.000Z') }

const rulesOf = (name: string) => {
  const t = SCORING_TEMPLATES.find((x) => x.name === name)
  if (!t) throw new Error(`template ${name}`)
  return forkTemplateDoc(t.rules) as unknown as Json
}
const STANDARD = rulesOf('ESPN Standard')
const PPR = rulesOf('ESPN Full PPR')

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data as NonNullable<T>
}

async function cleanup() {
  const { data: leagues } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (leagues ?? []).map((l) => l.id)
  if (ids.length > 0) {
    await must(service.from('league_weeks').delete().in('league_id', ids), 'cleanup weeks')
    await must(service.from('league_members').delete().in('league_id', ids), 'cleanup members')
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('player_stats').delete().like('player_id', `${P}%`), 'cleanup stats')
  await must(service.from('players').delete().like('id', `${P}%`), 'cleanup players')
  const { data: prof } = await service.from('profiles').select('id').in('username', [MEMBER.username, OUTSIDER.username])
  for (const row of prof ?? []) await service.auth.admin.deleteUser(row.id)
}

async function signedIn(u: typeof MEMBER) {
  const { data, error } = await service.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true, user_metadata: { username: u.username } })
  if (error) throw new Error(`createUser: ${error.message}`)
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const s = await client.auth.signInWithPassword({ email: u.email, password: u.password })
  if (s.error) throw new Error(`sign-in: ${s.error.message}`)
  return { id: data.user.id, client }
}

let leagueId = ''
let member: Awaited<ReturnType<typeof signedIn>>
let outsider: Awaited<ReturnType<typeof signedIn>>

beforeAll(async () => {
  await cleanup()
  await must(
    service.from('nfl_weeks').insert([1, 2, 3].map((week) => ({ season: SEASON, week, starts_at: `2076-09-${String(1 + 7 * week).padStart(2, '0')}T04:00:00Z` }))),
    'nfl_weeks',
  )
  member = await signedIn(MEMBER)
  outsider = await signedIn(OUTSIDER)
  const std = await must(service.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'ESPN Standard').single(), 'espn')
  const league = await must(
    service
      .from('leagues')
      .insert({ owner_id: member.id, name: LEAGUE_NAME, season: SEASON, status: 'in_season', scoring_system_id: std.id, scoring_rules_snapshot: STANDARD })
      .select('id')
      .single(),
    'league',
  )
  leagueId = league.id
  const team = await must(service.from('teams').insert({ owner_id: member.id, name: 'PCL team', league_id: leagueId }).select('id').single(), 'team')
  await must(service.from('league_members').insert({ league_id: leagueId, user_id: member.id, team_id: team.id, role: 'commissioner' }), 'member')
  await must(
    service.from('league_weeks').insert([
      { league_id: leagueId, season: SEASON, week: 1, status: 'final', scoring_rules_snapshot: PPR, scoring_rules_source: 'week_open' },
      { league_id: leagueId, season: SEASON, week: 2, status: 'final', scoring_rules_snapshot: STANDARD, scoring_rules_source: 'week_open' },
      { league_id: leagueId, season: SEASON, week: 3, status: 'upcoming' },
    ]),
    'weeks',
  )
  // The stored rules are what we wrote (no trigger re-stamped them).
  const weeks = await must(service.from('league_weeks').select('week, scoring_rules_snapshot').eq('league_id', leagueId).order('week'), 'weeks read')
  const recOf = (j: unknown) => JSON.stringify(j).match(/"receptions":(\d+(?:\.\d+)?)/)?.[1]
  expect(weeks.slice(0, 2).map((w) => recOf(w.scoring_rules_snapshot))).toEqual(['1', '0'])

  await must(service.from('players').insert([{ id: `${P}wr`, full_name: 'PCL Wr', position: 'WR' }]), 'players')
  await must(
    service.from('player_stats').insert([1, 2].map((week) => ({ player_id: `${P}wr`, season: SEASON, week, receptions: 5, receiving_yards: 80, receiving_tds: 1 }))),
    'stats',
  )
})

afterAll(cleanup)

describe('core stats read — league mode (R1504)', () => {
  it('L1: each opened week under its own stored rules — 19 (PPR wk1) + 14 (Standard wk2) = 33', async () => {
    const r = await readPlayerCoreStats(member.client, `${P}wr`, { kind: 'league', leagueId }, clock)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const body = r.body as unknown as CoreStatsPayload
    expect(body.basis).toEqual({ kind: 'league', league_name: LEAGUE_NAME })
    expect([body.week, body.total_points, body.games, body.avg_points, body.pos_rank]).toEqual([3, 33, 2, 16.5, 1])
  })

  it('L2: a non-member is refused with no league name', async () => {
    const r = await readPlayerCoreStats(outsider.client, `${P}wr`, { kind: 'league', leagueId }, clock)
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).not.toContain(LEAGUE_NAME)
    expect((r.body as Record<string, unknown>).basis).toBeUndefined()
  })
})
