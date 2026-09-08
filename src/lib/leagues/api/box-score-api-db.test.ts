/**
 * box-score-api-db.test.ts — L.D5.2's box-score read, driven through the
 * SERVICE against the local stack (spec §11.4 "the matchup view refetches
 * box-score lines"; §7.3.3 the frozen snapshot; §11.2's bye reading; E61;
 * PROGRESS D292/D321(4)/Q42; the `inseason-reads-api-db.test.ts` rig).
 *
 * What is pinned here and nowhere else:
 *   - the membership gate precedes every read (a non-member's 403 leaks no
 *     box; a soft-deleted league is a member's 404 by name — R812);
 *   - the strict query (`week` AND `team` required; a team of another league
 *     is a 404 by name; a week off the calendar quotes the ladder's bounds);
 *   - the per-starter points come out of the REAL frozen snapshot (`ESPN
 *     Standard`, the template `create_league` froze) through the worker's
 *     own `computeTeamWeek` — GOLDEN LITERALS computed by hand from the
 *     template's coefficients (D62): QB 250 pass yds × 0.04 + 2 pass TD × 4
 *     − 1 INT × 2 + 12 rush yds × 0.1 = 17.20; WR 6 rec × 0 + 84 rec yds ×
 *     0.1 + 1 rec TD × 6 = 14.40; a starter with NO line = 0 by name (Q42);
 *     the box total 31.60 (the worker's roundHalfUp over the rounded
 *     per-player values);
 *   - the Live Mode phases from `nfl_games.status` — `live` → now_playing,
 *     `final` → done, `scheduled` → up_next, no row → bye — read as STORED,
 *     never from a kickoff vs a clock (the scheduled game's kickoff is a
 *     PAST literal and it is still up_next);
 *   - a team with no `team_lineups` row is `lineup: null`, not zeros; an
 *     empty seat is `reason: 'empty'`.
 *
 * NOT pinned here: the PENDING (E61) state — unreachable on this chain (no
 * shipped snapshot can pay an undelivered key, D321(5)); it is pinned purely
 * in `matchup-view-ops.test.ts` / `matchup-view.render.test.ts` over the
 * worker's own `pending[]` shape.
 *
 * F226: every instant is a fixed literal on the synthetic season (2099).
 * F199: fixture players / stats / games are prefixed `vitest-bx-` and
 * deleted cleanup-first and in afterAll; the 2099 stamps count to zero.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { readBoxScore, type TeamBoxScore } from './box-score-service'
import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-box-api-league'
const NO_SUCH_TEAM = '00000000-0000-4000-8000-0000000beef2'
const STAMP = '2099-09-13T21:00:00+00:00'
/** F226: a PAST literal kickoff on a game whose status is still
 *  `scheduled` — the phase must still read up_next. */
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'

const COMMISH = { email: 'box-api-commish@fieldscout.test', password: 'pgtap-box-api-pass-1', username: 'bx_commish_one' }
const MANAGER = { email: 'box-api-manager@fieldscout.test', password: 'pgtap-box-api-pass-2', username: 'bx_manager_two' }
const OUTSIDER = { email: 'box-api-outsider@fieldscout.test', password: 'pgtap-box-api-pass-3', username: 'bx_outsider_three' }

const QB = 'vitest-bx-qb'
const WR = 'vitest-bx-wr'
const TE = 'vitest-bx-te'
const WR2 = 'vitest-bx-wr2'
const PLAYERS = [
  { id: QB, full_name: 'Vitest BX QB', position: 'QB', team: 'BXA', status: 'Active' },
  { id: WR, full_name: 'Vitest BX WR', position: 'WR', team: 'BXB', status: 'Active' },
  { id: TE, full_name: 'Vitest BX TE', position: 'TE', team: 'BXC', status: 'Active' },
  { id: WR2, full_name: 'Vitest BX WR Two', position: 'WR', team: 'BXD', status: 'Active' },
] as const
const GAMES = [
  { id: 'vitest-bx-game-live', home_team: 'BXA', away_team: 'BXZ', status: 'live', quarter: 3, game_clock: '7:12', home_score: 14, away_score: 10, kickoff_at: KICKOFF_PAST },
  { id: 'vitest-bx-game-final', home_team: 'BXY', away_team: 'BXB', status: 'final', quarter: null, game_clock: null, home_score: 24, away_score: 17, kickoff_at: KICKOFF_PAST },
  { id: 'vitest-bx-game-next', home_team: 'BXC', away_team: 'BXX', status: 'scheduled', quarter: null, game_clock: null, home_score: null, away_score: null, kickoff_at: KICKOFF_PAST },
] as const

const ACTION = { league: 'bf000000-0000-4000-8000-000000000001', other: 'bf000000-0000-4000-8000-000000000002' } as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let managerClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let commishId: string
let managerId: string
let leagueId: string
let otherLeagueId: string
let commishTeamId: string
let managerTeamId: string
let otherTeamId: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) {
      const { error } = await service.from('team_lineups').delete().in('team_id', teamIds)
      if (error) throw new Error(`cleanup team_lineups: ${error.message}`)
    }
    for (const table of ['team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const playerIds = PLAYERS.map((p) => p.id)
  const { error: statsError } = await service.from('player_stats').delete().in('player_id', playerIds)
  if (statsError) throw new Error(`cleanup player_stats: ${statsError.message}`)
  const { error: gamesError } = await service.from('nfl_games').delete().in('id', GAMES.map((g) => g.id))
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  const { error: playersError } = await service.from('players').delete().in('id', playerIds)
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER, OUTSIDER]) await deleteUserByUsername(u.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
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
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

function errorText(result: { body: unknown }): string {
  const err = (result.body as { error?: unknown }).error
  return typeof err === 'string' ? err : JSON.stringify(err)
}

async function createLeague(client: SupabaseClient<Database>, name: string, actionId: string): Promise<string> {
  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await client.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await client.rpc('create_league', {
    p_name: name,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league failed: ${error.message}`)
  const id = (created as { league_id: string }).league_id
  const { error: seasonError } = await service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null }).eq('id', id)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  return id
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)
  outsiderClient = await signIn(OUTSIDER)

  leagueId = await createLeague(commishClient, LEAGUE_NAME, ACTION.league)
  otherLeagueId = await createLeague(commishClient, `${LEAGUE_NAME}-other`, ACTION.other)

  const { data: commishTeam, error: ctError } = await service.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', commishId).single()
  if (ctError) throw new Error(`commish team: ${ctError.message}`)
  commishTeamId = commishTeam.id
  const { data: otherTeam, error: otError } = await service.from('teams').select('id').eq('league_id', otherLeagueId).eq('owner_id', commishId).single()
  if (otError) throw new Error(`other team: ${otError.message}`)
  otherTeamId = otherTeam.id
  const { data: mt, error: mtError } = await service.from('teams').insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId }).select('id').single()
  if (mtError) throw new Error(`teams insert: ${mtError.message}`)
  managerTeamId = mt.id
  const { error: memberError } = await service.from('league_members').insert({ league_id: leagueId, user_id: managerId, team_id: managerTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: weeksError } = await service.from('league_weeks').insert([1, 2].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service
    .from('league_rosters')
    .insert(PLAYERS.map((p) => ({ league_id: leagueId, team_id: commishTeamId, player_id: p.id })))
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)

  // The commissioner's week-1 lineup: QB, WR, TE, a second WR; every other
  // seat empty. Week 2 has NO row (the lineup-null cell).
  const { error: lineupError } = await service.from('team_lineups').insert({
    team_id: commishTeamId,
    season: SYNTHETIC_SEASON,
    week: 1,
    starters: [],
    bench: [],
    slot_map: { 'qb:0': QB, 'wr:0': WR, 'wr:1': WR2, 'te:0': TE },
  })
  if (lineupError) throw new Error(`team_lineups insert: ${lineupError.message}`)

  // Lines for the QB and the WR; NONE for the TE (Q42) and the second WR (bye).
  const { error: statsError } = await service.from('player_stats').insert([
    { player_id: QB, season: SYNTHETIC_SEASON, week: 1, stat_type: 'weekly', updated_at: STAMP, advanced: {}, pass_yards: 250, pass_tds: 2, interceptions: 1, rush_yards: 12 },
    { player_id: WR, season: SYNTHETIC_SEASON, week: 1, stat_type: 'weekly', updated_at: STAMP, advanced: {}, receptions: 6, receiving_yards: 84, receiving_tds: 1 },
  ])
  if (statsError) throw new Error(`player_stats insert: ${statsError.message}`)

  const { error: gamesError } = await service.from('nfl_games').insert(GAMES.map((g) => ({ ...g, season: SYNTHETIC_SEASON, week: 1 })))
  if (gamesError) throw new Error(`nfl_games insert: ${gamesError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

function box(result: { body: unknown }): TeamBoxScore {
  return result.body as TeamBoxScore
}

describe('GET …/matchups/box?week=&team= — the gate and the query', () => {
  it('a NON-MEMBER gets the no-leak 403 — never an empty box', async () => {
    const result = await readBoxScore(outsiderClient, leagueId, { week: '1', team: commishTeamId })
    expect(result.status).toBe(403)
    expect(errorText(result)).toBe(INSEASON_READ_FORBIDDEN_MESSAGE)
  })

  it('`week` and `team` are both REQUIRED (400 with a field error); a stranger key is refused', async () => {
    for (const query of [{ week: '1' }, { team: commishTeamId }, { week: '1', team: commishTeamId, extra: 'x' }, { week: '1', team: 'not-a-uuid' }]) {
      const result = await readBoxScore(managerClient, leagueId, query)
      expect(result.status, JSON.stringify(query)).toBe(400)
    }
  })

  it('a week off the calendar is a 404 BY NAME with the ladder’s bounds', async () => {
    const result = await readBoxScore(managerClient, leagueId, { week: '9', team: commishTeamId })
    expect(result.status).toBe(404)
    expect(errorText(result)).toBe(`Week 9 is not on this league’s calendar (season ${SYNTHETIC_SEASON}; league_weeks holds weeks 1–2)`)
  })

  it('a team that is not a franchise of THIS league is a 404 by name — another league’s team included', async () => {
    for (const team of [NO_SUCH_TEAM, otherTeamId]) {
      const result = await readBoxScore(managerClient, leagueId, { week: '1', team })
      expect(result.status, team).toBe(404)
      expect(errorText(result)).toBe('This team isn’t a franchise of this league.')
    }
  })

  it('a member reads ANY team’s box (member truth, 112’s F18 swap) — the manager reads the commissioner’s', async () => {
    const result = await readBoxScore(managerClient, leagueId, { week: '1', team: commishTeamId })
    expect(result.status).toBe(200)
    expect(box(result).team_id).toBe(commishTeamId)
  })
})

describe('the box — the worker’s function over the frozen snapshot, golden literals (D62)', () => {
  let doc: TeamBoxScore
  beforeAll(async () => {
    const result = await readBoxScore(commishClient, leagueId, { week: '1', team: commishTeamId })
    expect(result.status).toBe(200)
    doc = box(result)
  })

  it('the shape: league, season, week, team, the lineup record, every starting slot of the roster settings in order', () => {
    expect(doc).toMatchObject({ league_id: leagueId, season: SYNTHETIC_SEASON, week: 1, team_id: commishTeamId, no_game_rows: false })
    expect(doc.lineup).toMatchObject({ locked_at: null, edited_by_commish: false })
    expect(typeof doc.lineup?.set_at).toBe('string') // 112's DEFAULT now() — a stored stamp, rendered as such
    // defaultsForTeamCount(8): qb1 rb2 wr3 te1 flex1 k1 dst1 = 10 seats.
    expect(doc.starters.map((s) => s.slot)).toEqual(['qb:0', 'rb:0', 'rb:1', 'wr:0', 'wr:1', 'wr:2', 'te:0', 'flex:0', 'k:0', 'dst:0'])
    expect(doc.starters.find((s) => s.slot === 'flex:0')?.label).toBe('FLEX (W/R/T)')
  })

  it('QB: 250 × 0.04 + 2 × 4 − 1 × 2 + 12 × 0.1 = 17.20 — scored, Now playing (his game is `live`), the provider’s game state on the row', () => {
    const qb = doc.starters.find((s) => s.slot === 'qb:0')!
    expect(qb).toMatchObject({ reason: 'scored', points: 17.2, pending: [], phase: 'now_playing' })
    expect(qb.player).toEqual({ id: QB, full_name: 'Vitest BX QB', position: 'QB', nfl_team: 'BXA' })
    expect(qb.game).toMatchObject({ id: 'vitest-bx-game-live', status: 'live', quarter: 3, game_clock: '7:12', home_score: 14, away_score: 10 })
    expect(qb.line).toMatchObject({ pass_yards: 250, pass_tds: 2, interceptions: 1, rush_yards: 12 })
  })

  it('WR: 84 × 0.1 + 6 = 14.40 — scored, Done (his game is `final`)', () => {
    const wr = doc.starters.find((s) => s.slot === 'wr:0')!
    expect(wr).toMatchObject({ reason: 'scored', points: 14.4, pending: [], phase: 'done' })
    expect(wr.game).toMatchObject({ id: 'vitest-bx-game-final', status: 'final' })
    expect(wr.line).toMatchObject({ receptions: 6, receiving_yards: 84, receiving_tds: 1 })
  })

  it('TE: NO stat line → 0 by name (Q42), Up next — his game is `scheduled` although its kickoff literal is 2001 (no clock decides a phase)', () => {
    const te = doc.starters.find((s) => s.slot === 'te:0')!
    expect(te).toMatchObject({ reason: 'no_stat_row', points: 0, pending: [], phase: 'up_next', line: null })
    expect(te.game).toMatchObject({ id: 'vitest-bx-game-next', status: 'scheduled', kickoff_at: '2001-09-09T17:00:00+00:00' })
  })

  it('the second WR: no game row for his team in a week that has rows → bye, 0 by name', () => {
    const wr2 = doc.starters.find((s) => s.slot === 'wr:1')!
    expect(wr2).toMatchObject({ reason: 'no_stat_row', points: 0, phase: 'bye', game: null })
  })

  it('every other seat is EMPTY by name, never a zero-scored ghost', () => {
    const empties = doc.starters.filter((s) => s.reason === 'empty').map((s) => s.slot)
    expect(empties).toEqual(['rb:0', 'rb:1', 'wr:2', 'flex:0', 'k:0', 'dst:0'])
    for (const s of doc.starters.filter((x) => x.reason === 'empty')) expect(s.player).toBeNull()
  })

  it('the team: points 31.60 (17.20 + 14.40 + 0 + 0), nothing pending, the two no-line starters NAMED', () => {
    expect(doc.points).toBe(31.6)
    expect(doc.pending).toEqual([])
    expect(doc.no_stat_row.sort()).toEqual([TE, WR2].sort())
  })
})

describe('the box — real states, not zeros', () => {
  it('a week with NO team_lineups row is `lineup: null` with no starters (nothing set, the week not opened)', async () => {
    const result = await readBoxScore(commishClient, leagueId, { week: '2', team: commishTeamId })
    expect(result.status).toBe(200)
    expect(box(result)).toMatchObject({ week: 2, lineup: null, starters: [], points: null, pending: [], no_stat_row: [], no_game_rows: true })
  })

  it('a SOFT-DELETED league answers a MEMBER a 404 by name after the membership check (R812), and a non-member the same 403', async () => {
    const { error } = await service.from('leagues').update({ deleted_at: STAMP }).eq('id', leagueId)
    if (error) throw new Error(`soft-delete: ${error.message}`)
    try {
      const member = await readBoxScore(managerClient, leagueId, { week: '1', team: commishTeamId })
      expect(member.status).toBe(404)
      expect(errorText(member)).toBe(INSEASON_LEAGUE_GONE_MESSAGE)
      const outsider = await readBoxScore(outsiderClient, leagueId, { week: '1', team: commishTeamId })
      expect(outsider.status).toBe(403)
    } finally {
      const { error: restore } = await service.from('leagues').update({ deleted_at: null }).eq('id', leagueId)
      if (restore) throw new Error(`restore: ${restore.message}`)
    }
  })
})
