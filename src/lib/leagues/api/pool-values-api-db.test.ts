/**
 * pool-values-api-db.test.ts — the players page's value read over the REAL
 * local stack (League UX batch 5; `GET /api/leagues/[id]/player-values`,
 * `pool-values-service.ts`).
 *
 * The claim: a FREE AGENT gets exactly the number the league-player-values
 * job (137) would store for him if he were rostered — same engine, same
 * readers, same league rules — and a rostered player's read equals the row
 * the job actually stored. Every value is a STORED LITERAL, and the
 * literals are the ones `player-values-db.test.ts` pins for the job under
 * the same custom scoring (Scout Standard forked with RB receptions = 1):
 *   - RB 6813's recorded week line → 22.05 (the job's "taylor");
 *   - RB 9221's → 23.17 (the job's "gibbs");
 *   - the QB's two played weeks → 43.55; the WR's two empty weeks → a real
 *     0.00 over 2 games; no games → NULL with 0 games (never a 0.00).
 * Plus: a non-member is refused 403; a week off the league's schedule is
 * 404; a malformed query 400; an unknown id is NAMED, never silently
 * dropped.
 *
 * Season 2099 (the synthetic calendar), the clock at week 3. Requires the
 * local stack — D59(5); FAILS loudly when it is down. Fixture hygiene
 * (F199): every `pvr-` player / line / stat row, `vitest-pvr-` league and
 * `pvr_` user is deleted before and after.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SYNTHETIC_SEASON, seedSyntheticSeason } from '@/lib/leagues/sim/synthetic-season'
import type { Database, Json } from '@/types/database'

import { runLeaguePlayerValues } from '../scoring/player-values-job'
import { forkTemplateDoc } from '../scoring/rules-doc'
import { SCORING_TEMPLATES } from '../scoring/templates'
import { mapToCanonicalKeys } from '../stats/sleeper-stats-provider'
import type { TimeProvider } from '../time/time-provider'
import { readPoolValues, type PoolValues } from './pool-values-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SEASON = SYNTHETIC_SEASON
const P = 'pvr-'
const LEAGUE_NAME = 'vitest-pvr-league'
const MEMBER = { email: 'pvr-member@fieldscout.local', password: 'pvr-password-1234', username: 'pvr_member' }
const OUTSIDER = { email: 'pvr-outsider@fieldscout.local', password: 'pvr-password-1234', username: 'pvr_outsider' }

const clock = (iso: string): TimeProvider => ({ now: () => new Date(iso) })
const NOW = '2099-09-24T12:50:00.000Z' // week 3 (starts 2099-09-23T04:00Z)
const FRESH = '2099-09-24T12:40:00+00:00'

type FixtureRow = { player_id: string; stats: Record<string, number> }
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../sync/fixtures/sleeper-weekly-projections-2026.json', import.meta.url)), 'utf8'),
) as { weeks: Record<string, Record<string, FixtureRow[]>> }
const recorded = (pos: string, id: string) => {
  const row = FIXTURE.weeks['4'][pos].find((r) => r.player_id === id)
  if (!row) throw new Error(`fixture has no ${pos} ${id}`)
  return mapToCanonicalKeys(row.stats) as Json
}

const SCOUT = { ...SCORING_TEMPLATES.find((t) => t.name === 'Scout Standard')!.rules }
const CUSTOM = forkTemplateDoc(SCOUT)
CUSTOM.positions = { RB: { receptions: 1 } }

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data as NonNullable<T>
}

async function cleanup(): Promise<void> {
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (leagues ?? []).map((l) => l.id)
  if (ids.length > 0) {
    for (const table of ['league_player_values', 'league_rosters', 'league_weeks', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('player_weekly_projections').delete().like('player_id', `${P}%`), 'cleanup lines')
  await must(service.from('player_stats').delete().like('player_id', `${P}%`), 'cleanup stats')
  await must(service.from('players').delete().like('id', `${P}%`), 'cleanup players')
  for (const u of [MEMBER, OUTSIDER]) {
    const { data: prof } = await service.from('profiles').select('id').eq('username', u.username)
    for (const row of prof ?? []) await service.auth.admin.deleteUser(row.id)
  }
}

async function createUser(user: typeof MEMBER): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { username: user.username } })
  if (error) throw new Error(`createUser ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: typeof MEMBER): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in ${user.email}: ${error.message}`)
  return client
}

let leagueId = ''
let member: SupabaseClient<Database>
let outsider: SupabaseClient<Database>
const ROSTERED = ['gibbs', 'vet', 'zero']
const FREE = ['fa-rb', 'fa-qb', 'fa-none']
const ALL = [...ROSTERED, ...FREE].map((id) => P + id)

beforeAll(async () => {
  await seedSyntheticSeason(service)
  await cleanup()
  const memberId = await createUser(MEMBER)
  await createUser(OUTSIDER)
  member = await signIn(MEMBER)
  outsider = await signIn(OUTSIDER)
  const scoutId = (await must(service.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'Scout Standard').single(), 'scout')).id

  await must(
    service.from('players').insert([
      { id: `${P}gibbs`, full_name: 'PVR Gibbs', position: 'RB' },
      { id: `${P}vet`, full_name: 'PVR Vet', position: 'QB' },
      { id: `${P}zero`, full_name: 'PVR Zero', position: 'WR' },
      { id: `${P}fa-rb`, full_name: 'PVR Free Back', position: 'RB' },
      { id: `${P}fa-qb`, full_name: 'PVR Free Passer', position: 'QB' },
      { id: `${P}fa-none`, full_name: 'PVR Free Nobody', position: 'WR' },
    ]),
    'players',
  )
  const line = (id: string, stats: Json) => ({ season: SEASON, week: 3, player_id: P + id, stats, raw_stats: {}, source: 'sleeper', fetched_at: FRESH })
  await must(service.from('player_weekly_projections').insert([line('gibbs', recorded('RB', '9221')), line('fa-rb', recorded('RB', '6813'))]), 'lines')
  const stat = (id: string, week: number, cols: Record<string, number>) => ({ player_id: P + id, season: SEASON, week, ...cols })
  const qbWeeks = (id: string) => [stat(id, 1, { pass_yards: 300, pass_tds: 2, interceptions: 1, rush_yards: 20 }), stat(id, 2, { pass_yards: 201, pass_tds: 1, rush_yards: 5 })]
  await must(service.from('player_stats').insert([...qbWeeks('vet'), ...qbWeeks('fa-qb'), stat('zero', 1, {}), stat('zero', 2, {}), stat('fa-qb', 3, { pass_yards: 999 })]), 'stats')

  const league = await must(
    service.from('leagues').insert({ owner_id: memberId, name: LEAGUE_NAME, season: SEASON, status: 'in_season', scoring_system_id: scoutId, scoring_rules_snapshot: CUSTOM as unknown as Json }).select('id').single(),
    'league',
  )
  leagueId = league.id
  const team = await must(service.from('teams').insert({ owner_id: memberId, name: 'PVR team', league_id: leagueId }).select('id').single(), 'team')
  await must(service.from('league_members').insert({ league_id: leagueId, user_id: memberId, team_id: team.id, role: 'commissioner' }), 'member')
  await must(service.from('league_weeks').insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SEASON, week }))), 'league_weeks')
  await must(service.from('league_rosters').insert(ROSTERED.map((id) => ({ league_id: leagueId, team_id: team.id, player_id: P + id }))), 'roster')
}, 120_000)

afterAll(async () => {
  await cleanup()
})

const byId = (body: unknown) => new Map((body as PoolValues).values.map((v) => [v.player_id, v]))

describe('the players page’s value read — free agents scored like the job scores the rostered', () => {
  it('FREE AGENTS get league-scored values: 22.05 projected (RB receptions = 1), 43.55 over 2 games, NULL with 0 games — never 0.00', async () => {
    const res = await readPoolValues(member, leagueId, { week: '3', players: ALL.join(',') }, clock(NOW))
    expect(res.status).toBe(200)
    const v = byId(res.body)
    expect(v.get(`${P}fa-rb`)).toEqual({ player_id: `${P}fa-rb`, projected_points: 22.05, projected_missing: null, season_points: null, season_games: 0 })
    // Week 3's own stat row is NOT in the season to date (weeks before this one).
    expect(v.get(`${P}fa-qb`)).toEqual({ player_id: `${P}fa-qb`, projected_points: null, projected_missing: 'no_line', season_points: 43.55, season_games: 2 })
    expect(v.get(`${P}fa-none`)).toEqual({ player_id: `${P}fa-none`, projected_points: null, projected_missing: 'no_line', season_points: null, season_games: 0 })
    expect((res.body as unknown as PoolValues).unknown_players).toEqual([])
  })

  it('a ROSTERED player’s read equals the row the hourly job stored for him', async () => {
    const report = await runLeaguePlayerValues({ db: service, time: clock(NOW) }, { season: SEASON, weeks: [3], leagueIds: [leagueId] })
    expect(report.failures).toEqual([])
    const stored = await must(
      service.from('league_player_values').select('player_id, projected_points, projected_missing, season_points, season_games').eq('league_id', leagueId).eq('week', 3).order('player_id'),
      'stored',
    )
    expect(stored).toEqual([
      { player_id: `${P}gibbs`, projected_points: 23.17, projected_missing: null, season_points: null, season_games: 0 },
      { player_id: `${P}vet`, projected_points: null, projected_missing: 'no_line', season_points: 43.55, season_games: 2 },
      { player_id: `${P}zero`, projected_points: null, projected_missing: 'no_line', season_points: 0, season_games: 2 },
    ])
    const res = await readPoolValues(member, leagueId, { week: '3', players: ROSTERED.map((id) => P + id).join(',') }, clock(NOW))
    expect(res.status).toBe(200)
    expect([...byId(res.body).values()].sort((a, b) => a.player_id.localeCompare(b.player_id))).toEqual(stored)
  })

  it('a non-member is refused (403); a week off the schedule is 404; a malformed query is 400; an unknown id is named', async () => {
    expect((await readPoolValues(outsider, leagueId, { week: '3', players: `${P}fa-rb` }, clock(NOW))).status).toBe(403)
    const off = await readPoolValues(member, leagueId, { week: '9', players: `${P}fa-rb` }, clock(NOW))
    expect(off.status).toBe(404)
    expect((off.body as { error: string }).error).toBe('Week 9 is not on this league’s schedule.')
    expect((await readPoolValues(member, leagueId, { week: '3' }, clock(NOW))).status).toBe(400)
    expect((await readPoolValues(member, leagueId, { week: '3', players: Array.from({ length: 301 }, (_, i) => `x${i}`).join(',') }, clock(NOW))).status).toBe(400)
    const unknown = await readPoolValues(member, leagueId, { week: '3', players: `${P}fa-rb,${P}nobody` }, clock(NOW))
    expect(unknown.status).toBe(200)
    expect((unknown.body as unknown as PoolValues).unknown_players).toEqual([`${P}nobody`])
    expect((unknown.body as unknown as PoolValues).values.map((v) => v.player_id)).toEqual([`${P}fa-rb`])
  })

  it('the freshness bound is the job’s: the same line read 6 h 0 m 1 s after it was fetched is stale — “—”, not a number', async () => {
    const res = await readPoolValues(member, leagueId, { week: '3', players: `${P}fa-rb` }, clock('2099-09-24T18:40:01.000Z'))
    expect(byId(res.body).get(`${P}fa-rb`)).toMatchObject({ projected_points: null, projected_missing: 'stale_line' })
    const edge = await readPoolValues(member, leagueId, { week: '3', players: `${P}fa-rb` }, clock('2099-09-24T18:40:00.000Z'))
    expect(byId(edge.body).get(`${P}fa-rb`)).toMatchObject({ projected_points: 22.05, projected_missing: null })
  })
})
