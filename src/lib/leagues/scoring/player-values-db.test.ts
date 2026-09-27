/**
 * player-values-db.test.ts — the league-player-values job over the REAL
 * local stack (M6A L.E1.20; migration 137; PROGRESS D374, F379 second third;
 * spec §12.28).
 *
 * Pinned here (every value a STORED LITERAL, read back from the table):
 *   S1 THE WRITE + THE REVERSAL: league L1's snapshot is Scout Standard
 *      FORKED with RB receptions = 1 (a custom league scoring that REVERSES
 *      the preset order of Gibbs and Taylor — Scout Standard itself has
 *      Taylor 19.24 over Gibbs 18.69; the league has Gibbs 23.17 over Taylor
 *      22.05). Eight rostered players cover every column shape: a K and a
 *      FRACTIONAL-PA D/ST (the unscored keys named), a STALE line (F387), a
 *      QB with two played weeks (season 43.55) and another season's
 *      preseason line, a WR who played two weeks and scored a REAL 0.00, and
 *      a rookie with no games (NULL) and a preseason value.
 *   S2 WEEK 1: nothing is before week 1, so EVERY season value is NULL with
 *      0 games — the same QB who has 43.55 at week 3 — and the rookie's
 *      preseason value stands.
 *   S3 THE REFRESH: a player dropped from the roster loses his row on the
 *      next run (`removed = 1`); the rest are re-stamped with the new
 *      instant.
 *   S4 THE 1000-ROW CAP: 150 rostered players × 7 played weeks = 1,050
 *      `player_stats` rows in ONE id chunk — the last seven players' rows
 *      sit only on the SECOND page; every one of the 150 must have 7 games.
 *   S5 RLS through PostgREST: anon reads 0 rows and cannot insert.
 *
 * Season 2099 (the synthetic calendar); every run is scoped to this suite's
 * leagues (`leagueIds`) so a concurrent suite on the same season cannot
 * enter its report. Requires the local stack (001–137) — D59(5); FAILS
 * loudly when the stack is down. Fixture hygiene (F199): every `lpv-`
 * player, line and stat row and every `vitest-lpv-` league is deleted
 * before and after.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SYNTHETIC_SEASON, seedSyntheticSeason } from '@/lib/leagues/sim/synthetic-season'
import type { Database, Json } from '@/types/database'

import { mapToCanonicalKeys } from '../stats/sleeper-stats-provider'
import type { TimeProvider } from '../time/time-provider'
import { runLeaguePlayerValues } from './player-values-job'
import { forkTemplateDoc } from './rules-doc'
import { SCORING_TEMPLATES } from './templates'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
const SEASON = SYNTHETIC_SEASON
const P = 'lpv-'
const LEAGUE_PREFIX = 'vitest-lpv-'
const USER = { email: 'lpv-commish@fieldscout.local', password: 'lpv-password-1234', username: 'lpv_commish' }

const clock = (iso: string): TimeProvider => ({ now: () => new Date(iso) })
const NOW = '2099-09-24T12:50:00.000Z' // week 3 (starts 2099-09-23T04:00Z)
const FRESH = '2099-09-24T12:40:00+00:00'
const STALE = '2099-09-24T06:49:59+00:00' // 6 h 0 m 1 s before NOW

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
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_PREFIX}%`)
  const ids = (leagues ?? []).map((l) => l.id)
  if (ids.length > 0) {
    for (const table of ['league_player_values', 'league_rosters', 'league_weeks'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('player_weekly_projections').delete().like('player_id', `${P}%`), 'cleanup lines')
  await must(service.from('player_stats').delete().like('player_id', `${P}%`), 'cleanup stats')
  await must(service.from('players').delete().like('id', `${P}%`), 'cleanup players')
  const { data: prof } = await service.from('profiles').select('id').eq('username', USER.username)
  for (const row of prof ?? []) await service.auth.admin.deleteUser(row.id)
}

let ownerId = ''
let scoutId = ''
async function createLeague(name: string, snapshot: Json, weeks: number[]): Promise<{ id: string; team: string }> {
  const league = await must(
    service.from('leagues').insert({ owner_id: ownerId, name: LEAGUE_PREFIX + name, season: SEASON, status: 'in_season', scoring_system_id: scoutId, scoring_rules_snapshot: snapshot }).select('id').single(),
    `league ${name}`,
  )
  const team = await must(service.from('teams').insert({ owner_id: ownerId, name: `${name} team`, league_id: league.id }).select('id').single(), `team ${name}`)
  await must(service.from('league_weeks').insert(weeks.map((week) => ({ league_id: league.id, season: SEASON, week }))), `league_weeks ${name}`)
  return { id: league.id, team: team.id }
}

async function rosterAdd(leagueId: string, teamId: string, ids: string[]): Promise<void> {
  await must(service.from('league_rosters').insert(ids.map((id) => ({ league_id: leagueId, team_id: teamId, player_id: P + id }))), 'roster')
}

const VALUE_COLUMNS =
  'player_id, projected_points, projected_missing, projected_unscored, projection_fetched_at, season_points, season_games, preseason_points, preseason_missing, preseason_unscored, computed_at'
async function valuesFor(leagueId: string, week: number) {
  return must(service.from('league_player_values').select(VALUE_COLUMNS).eq('league_id', leagueId).eq('season', SEASON).eq('week', week).order('player_id'), 'values')
}

let L1 = { id: '', team: '' }
let L3 = { id: '', team: '' }
const CAP_IDS = Array.from({ length: 150 }, (_, i) => `cap-${String(i).padStart(3, '0')}`)

beforeAll(async () => {
  await seedSyntheticSeason(service)
  await cleanup()
  const { data: user, error } = await service.auth.admin.createUser({ email: USER.email, password: USER.password, email_confirm: true, user_metadata: { username: USER.username } })
  if (error) throw new Error(`createUser: ${error.message}`)
  ownerId = user.user.id
  scoutId = (await must(service.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'Scout Standard').single(), 'scout')).id

  const player = (id: string, position: string, extra: Partial<Database['public']['Tables']['players']['Insert']> = {}) => ({ id: P + id, full_name: `LPV ${id}`, position, ...extra })
  const players = [
    player('gibbs', 'RB'),
    player('taylor', 'RB'),
    player('k', 'K'),
    player('pit', 'DEF'),
    player('te-stale', 'TE'),
    player('vet', 'QB', { projected_stats: { pass_yards: 4000 }, projections_season: SEASON - 1, projected_pts_standard: 160 }),
    player('zero', 'WR'),
    player('rookie', 'WR', { projected_stats: { receiving_yards: 800, receiving_tds: 5 }, projections_season: SEASON, projected_pts_standard: 110 }),
    ...CAP_IDS.map((id) => player(id, 'WR')),
  ]
  await must(service.from('players').insert(players), 'players')

  const line = (id: string, week: number, stats: Json, fetched_at: string) => ({ season: SEASON, week, player_id: P + id, stats, raw_stats: {}, source: 'sleeper', fetched_at })
  await must(
    service.from('player_weekly_projections').insert([
      line('gibbs', 3, recorded('RB', '9221'), FRESH),
      line('taylor', 3, recorded('RB', '6813'), FRESH),
      line('k', 3, recorded('K', '12185'), FRESH),
      line('pit', 3, recorded('DEF', 'PIT'), FRESH),
      line('te-stale', 3, recorded('TE', '8130'), STALE),
      line('gibbs', 1, recorded('RB', '9221'), '2099-09-10T12:40:00+00:00'),
      line('cap-000', 8, { receiving_yards: 10 }, '2099-10-29T12:40:00+00:00'),
    ]),
    'lines',
  )

  const stat = (id: string, week: number, cols: Record<string, number>) => ({ player_id: P + id, season: SEASON, week, ...cols })
  await must(
    service.from('player_stats').insert([
      stat('vet', 1, { pass_yards: 300, pass_tds: 2, interceptions: 1, rush_yards: 20 }),
      stat('vet', 2, { pass_yards: 201, pass_tds: 1, rush_yards: 5 }),
      stat('zero', 1, {}),
      stat('zero', 2, {}),
    ]),
    'stats',
  )
  const capRows = CAP_IDS.flatMap((id) => [1, 2, 3, 4, 5, 6, 7].map((week) => stat(id, week, { receiving_yards: 10 })))
  for (let i = 0; i < capRows.length; i += 500) await must(service.from('player_stats').insert(capRows.slice(i, i + 500)), 'cap stats')

  L1 = await createLeague('L1', CUSTOM as unknown as Json, [1, 3])
  await rosterAdd(L1.id, L1.team, ['gibbs', 'taylor', 'k', 'pit', 'te-stale', 'vet', 'zero', 'rookie'])
  L3 = await createLeague('L3', SCOUT as unknown as Json, [8])
  await rosterAdd(L3.id, L3.team, CAP_IDS)
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('league-player-values — the service-role job over the stack', () => {
  it('S1 THE WRITE + THE REVERSAL: eight rostered players, every column BY VALUE, under the league\'s custom scoring', async () => {
    const report = await runLeaguePlayerValues({ db: service, time: clock(NOW) }, { season: SEASON, weeks: [3], leagueIds: [L1.id] })
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.leagueWeeks).toEqual([
      { league_id: L1.id, week: 3, ok: true, rostered: 8, written: 8, removed: 0, projected: 4, stale: 1, noLine: 3, season: 2, preseason: 1, failures: [] },
    ])
    expect(report.warnings).toEqual([`league ${L1.id} week 3: 1 projection line(s) older than the freshness bound — treated as absent: lpv-te-stale`])

    const ESPN_YA = ['def_ya_0_99', 'def_ya_100_199', 'def_ya_200_299', 'def_ya_350_399', 'def_ya_400_449', 'def_ya_450_499', 'def_ya_500_549', 'def_ya_550_plus']
    const at = '2099-09-24T12:50:00+00:00'
    expect(await valuesFor(L1.id, 3)).toEqual([
      { player_id: 'lpv-gibbs', projected_points: 23.17, projected_missing: null, projected_unscored: ['fumble_recovery_td', 'return_td'], projection_fetched_at: FRESH, season_points: null, season_games: 0, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-k', projected_points: 5.56, projected_missing: null, projected_unscored: ['fg_0_39', 'fg_missed'], projection_fetched_at: FRESH, season_points: null, season_games: 0, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-pit', projected_points: 7.66, projected_missing: null, projected_unscored: ['def_block', 'def_return_td', ...ESPN_YA], projection_fetched_at: FRESH, season_points: null, season_games: 0, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-rookie', projected_points: null, projected_missing: 'no_line', projected_unscored: null, projection_fetched_at: null, season_points: null, season_games: 0, preseason_points: 110, preseason_missing: null, preseason_unscored: ['fumble_recovery_td', 'pass_2pt', 'rec_2pt', 'return_td', 'rush_2pt'], computed_at: at },
      { player_id: 'lpv-taylor', projected_points: 22.05, projected_missing: null, projected_unscored: ['fumble_recovery_td', 'return_td'], projection_fetched_at: FRESH, season_points: null, season_games: 0, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-te-stale', projected_points: null, projected_missing: 'stale_line', projected_unscored: null, projection_fetched_at: STALE, season_points: null, season_games: 0, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-vet', projected_points: null, projected_missing: 'no_line', projected_unscored: null, projection_fetched_at: null, season_points: 43.55, season_games: 2, preseason_points: null, preseason_missing: 'other_season', preseason_unscored: null, computed_at: at },
      { player_id: 'lpv-zero', projected_points: null, projected_missing: 'no_line', projected_unscored: null, projection_fetched_at: null, season_points: 0, season_games: 2, preseason_points: null, preseason_missing: 'no_line', preseason_unscored: null, computed_at: at },
    ])
  })

  it('S2 WEEK 1 (no games yet): every season value is NULL with 0 games — the QB who has 43.55 at week 3 included — and the rookie\'s preseason value stands', async () => {
    const report = await runLeaguePlayerValues({ db: service, time: clock('2099-09-10T12:50:00.000Z') }, { season: SEASON, weeks: [1], leagueIds: [L1.id] })
    expect(report.failures).toEqual([])
    const rows = await valuesFor(L1.id, 1)
    expect(rows.map((r) => [r.player_id, r.season_points, r.season_games])).toEqual([
      ['lpv-gibbs', null, 0], ['lpv-k', null, 0], ['lpv-pit', null, 0], ['lpv-rookie', null, 0],
      ['lpv-taylor', null, 0], ['lpv-te-stale', null, 0], ['lpv-vet', null, 0], ['lpv-zero', null, 0],
    ])
    expect(rows.find((r) => r.player_id === 'lpv-rookie')?.preseason_points).toBe(110)
    expect(rows.find((r) => r.player_id === 'lpv-gibbs')?.projected_points).toBe(23.17)
  })

  it('S3 THE REFRESH: a player dropped from the roster loses his row on the next run; the rest are re-stamped', async () => {
    await must(service.from('league_rosters').delete().eq('league_id', L1.id).eq('player_id', `${P}taylor`), 'drop taylor')
    const report = await runLeaguePlayerValues({ db: service, time: clock('2099-09-24T13:50:00.000Z') }, { season: SEASON, weeks: [3], leagueIds: [L1.id] })
    expect(report.failures).toEqual([])
    expect(report.leagueWeeks[0]).toMatchObject({ rostered: 7, written: 7, removed: 1 })
    const rows = await valuesFor(L1.id, 3)
    expect(rows.map((r) => r.player_id)).not.toContain('lpv-taylor')
    expect(new Set(rows.map((r) => r.computed_at))).toEqual(new Set(['2099-09-24T13:50:00+00:00']))
    // The stale line is now 7 h old, still stale; the fresh ones are 1 h 10 m old, still fresh.
    expect(rows.find((r) => r.player_id === 'lpv-gibbs')?.projected_points).toBe(23.17)
  })

  it('S4 THE 1000-ROW CAP: 150 players × 7 weeks = 1,050 stat rows in one id chunk — every player has all 7 games (7.00), the second page included', async () => {
    const { count } = await service.from('player_stats').select('player_id', { count: 'exact', head: true }).like('player_id', `${P}cap-%`)
    expect(count).toBe(1050)
    const report = await runLeaguePlayerValues({ db: service, time: clock('2099-10-29T12:50:00.000Z') }, { season: SEASON, weeks: [8], leagueIds: [L3.id] })
    expect(report.failures).toEqual([])
    expect(report.leagueWeeks[0]).toMatchObject({ rostered: 150, written: 150, season: 150, projected: 1 })
    const rows = await valuesFor(L3.id, 8)
    expect(rows).toHaveLength(150)
    expect(rows.filter((r) => r.season_games !== 7 || r.season_points !== 7).map((r) => [r.player_id, r.season_games, r.season_points])).toEqual([])
  })

  it('S5 RLS through PostgREST: anon reads 0 rows and cannot insert', async () => {
    const read = await anon.from('league_player_values').select('player_id').eq('league_id', L1.id)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([])
    const write = await anon.from('league_player_values').insert({ league_id: L1.id, season: SEASON, week: 3, player_id: `${P}gibbs`, season_games: 0, projected_missing: 'no_line', preseason_missing: 'no_line', computed_at: NOW })
    expect(write.error?.code).toBe('42501')
  })
})
