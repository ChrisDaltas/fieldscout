/**
 * inseason-reads-api-db.test.ts — L.D4.1 items 1 & 3 for the three READ
 * routes at the SERVICE layer: `GET /api/leagues/[id]/rosters`,
 * `GET /api/leagues/[id]/matchups?week=` and `GET /api/leagues/[id]/standings`
 * against the LOCAL Supabase stack through PostgREST — the production wire
 * path — with real signed-in clients (the `transactions-api-db.test.ts`
 * shape).
 *
 * pgTAP 057/065 cover the tables' RLS and `league_standings`' chain DB-side.
 * What THIS suite proves is the layer they do not touch:
 *
 *   - the auth matrix (member · commissioner · NON-MEMBER · a nonexistent
 *     league · a SOFT-DELETED league) — and the load-bearing half: a
 *     non-member gets the family's no-leak 403, **never an empty league**
 *     (CLAUDE.md's "never let 'nothing happened' mean 'it worked'"; the
 *     membership gate precedes the RLS reads), and a member of a deleted
 *     league gets a 404 BY NAME after the membership check (R812) — on
 *     every direct read, the activity feed included (R807);
 *   - **F241(d)**: a planted `locked_until = 'infinity'` pool row reaches the
 *     client as the string `"infinity"` and is rendered as
 *     `locked_release_unrecorded`, beside an instant and a NULL;
 *   - **F247(b)**: `points_for` / `points_against` are numbers of ONE kind
 *     for a team with rows (`71.50`) and a team with none (`0`);
 *   - the matchups week contract: `week` required (400), a week off the
 *     calendar is a 404 BY NAME with the ladder's bounds, a NULL score stays
 *     null (E61 — never 0.00), the `league_weeks` row and both round types
 *     ride along.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226): the league lives on `SYNTHETIC_SEASON` (2099); NO
 * `nfl_games` rows are placed — nothing here evaluates a kickoff. No
 * `DRAFT_INSTANT`: the league is set `in_season` directly. The one instant
 * literal is a 2099 `locked_until` (far-future, F226).
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first. Action-id
 * prefix `afb` — this suite owns it (the D108(14) registry: af0–afa taken,
 * afb measured free 2026-09-05).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { readActivity } from './activity-service'
import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import { readMatchups, type WeekMatchups } from './matchups-service'
import { readRosters, type LeagueRosters } from './rosters-service'
import { readStandings, type LeagueStandings } from './standings-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-reads-api-league'
const NO_SUCH_LEAGUE = '00000000-0000-4000-8000-0000000beef1'
/** F226: far-future. The instant a planted `locked_until` carries. */
const LOCKED_UNTIL = '2099-09-15T03:30:00+00:00'

const COMMISH = {
  email: 'reads-api-commish@fieldscout.test',
  password: 'pgtap-reads-api-pass-1',
  username: 'rd_commish_one',
}
const MANAGER = {
  email: 'reads-api-manager@fieldscout.test',
  password: 'pgtap-reads-api-pass-2',
  username: 'rd_manager_two',
}
const OUTSIDER = {
  email: 'reads-api-outsider@fieldscout.test',
  password: 'pgtap-reads-api-pass-3',
  username: 'rd_outsider_three',
}

const PLAYERS = [
  { id: 'vitest-rd-p1', full_name: 'Vitest RD One', position: 'WR', team: 'RDA', status: 'Active', bye_week: 7 },
  { id: 'vitest-rd-p2', full_name: 'Vitest RD Two', position: 'RB', team: 'RDB', status: 'Questionable', bye_week: null },
  { id: 'vitest-rd-p3', full_name: 'Vitest RD Three', position: 'TE', team: 'RDC', status: 'Active', bye_week: null },
] as const
const P1 = 'vitest-rd-p1'
const P2 = 'vitest-rd-p2'
const P3 = 'vitest-rd-p3'

const ACTION = {
  league: 'afb00000-0000-4000-8000-000000000001',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let managerClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let commishId: string
let managerId: string
let leagueId: string
let commishTeamId: string
let managerTeamId: string
let ghostTeamId: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const table of [
      'team_week_results',
      'matchups',
      'league_weeks',
      'league_player_pool',
      'league_rosters',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
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

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  managerId = await createUser(MANAGER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerClient = await signIn(MANAGER)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id
  const { data: commishTeam, error: ctError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('owner_id', commishId)
    .single()
  if (ctError) throw new Error(`commish team: ${ctError.message}`)
  commishTeamId = commishTeam.id

  // The manager's franchise + a GHOST franchise with no manager and no
  // results (the F247(b) no-rows shape; `manager_user_id: null`).
  const { data: mt, error: mtError } = await service
    .from('teams')
    .insert({ owner_id: managerId, name: 'Manager Team', league_id: leagueId })
    .select('id')
    .single()
  if (mtError) throw new Error(`teams insert: ${mtError.message}`)
  managerTeamId = mt.id
  const { data: gt, error: gtError } = await service
    .from('teams')
    .insert({ owner_id: commishId, name: 'Ghost Team', league_id: leagueId })
    .select('id')
    .single()
  if (gtError) throw new Error(`teams insert (ghost): ${gtError.message}`)
  ghostTeamId = gt.id
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: managerId, team_id: managerTeamId, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  // Rosters: the manager holds P1 + P2, the commissioner P3. Pool rows: P1
  // locked with the release UNRECORDED ('infinity' — F241(d)), P2 locked
  // until an instant, P3 has NO pool row (lazy rows, §12.19).
  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
  const { error: rosterError } = await service.from('league_rosters').insert([
    { league_id: leagueId, team_id: managerTeamId, player_id: P1, slot_key: 'wr' },
    { league_id: leagueId, team_id: managerTeamId, player_id: P2, slot_key: 'bn', acquisition_type: 'free_agent' },
    { league_id: leagueId, team_id: commishTeamId, player_id: P3, slot_key: 'te' },
  ])
  if (rosterError) throw new Error(`league_rosters insert: ${rosterError.message}`)
  const { error: poolError } = await service.from('league_player_pool').insert([
    { league_id: leagueId, player_id: P1, state: 'rostered', locked_until: 'infinity' },
    { league_id: leagueId, player_id: P2, state: 'rostered', locked_until: LOCKED_UNTIL },
  ])
  if (poolError) throw new Error(`league_player_pool insert: ${poolError.message}`)

  // Week 1: commish vs manager (regular) with the home score written and the
  // away score PENDING (NULL — E61); the ghost on a bye. Week-1 results are
  // FINAL for the two who played; the ghost has no row.
  const { error: matchupError } = await service.from('matchups').insert([
    {
      league_id: leagueId,
      season: SYNTHETIC_SEASON,
      week: 1,
      round_type: 'regular',
      home_team_id: commishTeamId,
      away_team_id: managerTeamId,
      home_score: 71.5,
      away_score: null,
      status: 'live',
    },
    {
      league_id: leagueId,
      season: SYNTHETIC_SEASON,
      week: 1,
      round_type: 'regular',
      home_team_id: ghostTeamId,
      away_team_id: null,
      home_score: null,
      away_score: null,
      status: 'scheduled',
    },
  ])
  if (matchupError) throw new Error(`matchups insert: ${matchupError.message}`)
  const { error: resultsError } = await service.from('team_week_results').insert([
    {
      league_id: leagueId,
      team_id: commishTeamId,
      season: SYNTHETIC_SEASON,
      week: 1,
      points: 71.5,
      opponent_team_id: managerTeamId,
      h2h_result: 'win',
      is_final: true,
    },
    {
      league_id: leagueId,
      team_id: managerTeamId,
      season: SYNTHETIC_SEASON,
      week: 1,
      points: 35,
      opponent_team_id: commishTeamId,
      h2h_result: 'loss',
      is_final: true,
    },
  ])
  if (resultsError) throw new Error(`team_week_results insert: ${resultsError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('GET …/rosters', () => {
  it('a NON-MEMBER gets the no-leak 403 — never an empty league (the membership gate precedes the RLS reads)', async () => {
    const result = await readRosters(outsiderClient, leagueId)
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    // The RLS half, for the record: the outsider's own read IS empty — which
    // is exactly why the route cannot use it as the answer.
    const { data: rlsRows } = await outsiderClient.from('league_rosters').select('id').eq('league_id', leagueId)
    expect(rlsRows).toHaveLength(0)
  })

  it('a nonexistent league answers a MEMBER the same 403', async () => {
    const result = await readRosters(managerClient, NO_SUCH_LEAGUE)
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a member reads EVERY franchise, with the F241(d) lock view and the manager mapping', async () => {
    const result = await readRosters(managerClient, leagueId)
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as LeagueRosters
    expect(doc.league_id).toBe(leagueId)
    expect(doc.season).toBe(SYNTHETIC_SEASON)
    expect(doc.teams.map((t) => t.name)).toStrictEqual(['Commish Team', 'Ghost Team', 'Manager Team'])

    const manager = doc.teams.find((t) => t.team_id === managerTeamId)!
    expect(manager.manager_user_id).toBe(managerId)
    expect(manager.roster.map((p) => p.player_id)).toStrictEqual([P1, P2])
    const p1 = manager.roster[0]
    expect(p1.full_name).toBe('Vitest RD One')
    expect(p1.position).toBe('WR')
    expect(p1.nfl_team).toBe('RDA')
    expect(p1.bye_week).toBe(7)
    expect(p1.slot_key).toBe('wr')
    expect(p1.pool_state).toBe('rostered')
    // THE F241(d) CELL: the wire carried the string "infinity"; the view is
    // the named state, and nothing here is an Invalid Date.
    expect(p1.game_lock).toStrictEqual({ state: 'locked_release_unrecorded', until: null })
    const p2 = manager.roster[1]
    expect(p2.status).toBe('Questionable')
    expect(p2.acquisition_type).toBe('free_agent')
    expect(p2.game_lock.state).toBe('locked_until')
    expect(new Date(p2.game_lock.until as string).toISOString()).toBe('2099-09-15T03:30:00.000Z')

    const commish = doc.teams.find((t) => t.team_id === commishTeamId)!
    expect(commish.manager_user_id).toBe(commishId)
    expect(commish.roster).toHaveLength(1)
    expect(commish.roster[0].pool_state).toBeNull() // lazy rows: no pool row yet
    expect(commish.roster[0].game_lock).toStrictEqual({ state: 'unlocked', until: null })

    const ghost = doc.teams.find((t) => t.team_id === ghostTeamId)!
    expect(ghost.manager_user_id).toBeNull()
    expect(ghost.roster).toStrictEqual([]) // an empty roster is a real state
  })

  it('the raw column really does arrive as the string "infinity" (the hazard F241(d) names)', async () => {
    const { data } = await managerClient
      .from('league_player_pool')
      .select('locked_until')
      .eq('league_id', leagueId)
      .eq('player_id', P1)
      .single()
    expect(data?.locked_until).toBe('infinity')
    expect(Number.isNaN(new Date(data!.locked_until as string).getTime())).toBe(true)
  })

  it('the commissioner reads the same document', async () => {
    const result = await readRosters(commishClient, leagueId)
    expect(result.status).toBe(200)
    expect((result.body as unknown as LeagueRosters).teams).toHaveLength(3)
  })
})

describe('GET …/matchups?week=', () => {
  it('week is REQUIRED — absent, empty or malformed is a 400 field error, never a guess', async () => {
    for (const query of [{}, { week: 'x' }, { week: '0' }, { week: '19' }, { week: '1.5' }, { week: '1', extra: 'y' }]) {
      const result = await readMatchups(managerClient, leagueId, query)
      expect(result.status, JSON.stringify(query)).toBe(400)
      expect(errorText(result)).toContain('fieldErrors')
    }
  })

  it('a NON-MEMBER gets the no-leak 403, never an empty week', async () => {
    const result = await readMatchups(outsiderClient, leagueId, { week: '1' })
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a nonexistent league answers a MEMBER the same 403 (R814 — the cell rosters and standings already had)', async () => {
    const result = await readMatchups(managerClient, NO_SUCH_LEAGUE, { week: '1' })
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a week OFF the calendar is a 404 by name with the ladder\'s bounds', async () => {
    const result = await readMatchups(managerClient, leagueId, { week: '9' })
    expect(result.status).toBe(404)
    expect(errorText(result)).toBe(
      `Week 9 is not on this league’s calendar (season ${SYNTHETIC_SEASON}; league_weeks holds weeks 1–3)`,
    )
  })

  it('a member reads the week as the database holds it — a NULL score stays null (E61), both rows, the ladder row, the results', async () => {
    const result = await readMatchups(managerClient, leagueId, { week: '1' })
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as WeekMatchups
    expect(doc.week).toBe(1)
    expect(doc.season).toBe(SYNTHETIC_SEASON)
    expect(doc.schedule_mode).toBe('h2h')
    expect(doc.league_week).toStrictEqual({ status: 'upcoming', median_score: null, finalized_at: null })
    expect(doc.teams.map((t) => t.name)).toStrictEqual(['Commish Team', 'Ghost Team', 'Manager Team'])

    expect(doc.matchups).toHaveLength(2)
    const game = doc.matchups.find((m) => m.away_team_id === managerTeamId)!
    expect(game.home_team_id).toBe(commishTeamId)
    expect(game.home_score).toBe(71.5)
    expect(game.away_score).toBeNull() // pending, never coerced to 0
    expect(game.status).toBe('live')
    expect(game.is_overridden).toBe(false)
    const bye = doc.matchups.find((m) => m.home_team_id === ghostTeamId)!
    expect(bye.away_team_id).toBeNull()
    expect(bye.round_type).toBe('regular')

    expect(doc.results).toHaveLength(2)
    const managerResult = doc.results.find((r) => r.team_id === managerTeamId)!
    expect(managerResult.points).toBe(35)
    expect(managerResult.h2h_result).toBe('loss')
    expect(managerResult.opponent_team_id).toBe(commishTeamId)
    expect(managerResult.is_final).toBe(true)
  })

  it('a calendar week with no matchup rows yet is an EMPTY list under a real week row, not an error', async () => {
    const result = await readMatchups(commishClient, leagueId, { week: '2' })
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as WeekMatchups
    expect(doc.league_week.status).toBe('upcoming')
    expect(doc.matchups).toStrictEqual([])
    expect(doc.results).toStrictEqual([])
  })
})

describe('GET …/standings', () => {
  it('a NON-MEMBER is refused by 117 in-body (42501) and the route answers the family\'s 403', async () => {
    const result = await readStandings(outsiderClient, leagueId)
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a nonexistent league answers a member the same 403 — the membership check precedes the lookup', async () => {
    const result = await readStandings(managerClient, NO_SUCH_LEAGUE)
    expect(result).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a member reads the ordered table with the F247(b) scale normalised — 71.50, 35.00 and the no-rows 0 are ONE kind of number', async () => {
    const result = await readStandings(managerClient, leagueId)
    expect(result.status, errorText(result)).toBe(200)
    const doc = result.body as unknown as LeagueStandings
    expect(doc.league_id).toBe(leagueId)
    expect(doc.schedule_mode).toBe('h2h')
    expect(doc.weeks_final).toBe(1)
    expect(doc.reason).toBeNull()
    expect(doc.standings.map((r) => r.team_id)).toStrictEqual([commishTeamId, managerTeamId, ghostTeamId])
    expect(doc.standings.map((r) => r.rank)).toStrictEqual([1, 2, 3])

    const [first, second, third] = doc.standings
    expect(first.points_for).toBe(71.5)
    expect(first.points_against).toBe(35)
    expect(second.points_for).toBe(35)
    expect(second.points_against).toBe(71.5)
    // THE F247(b) CELL: the team with no rows renders `0`, the others
    // `71.50`/`35.00` — after the service, all three are the same JS type and
    // format without a guard.
    expect(third.points_for).toBe(0)
    expect(third.points_against).toBe(0)
    for (const row of doc.standings) {
      expect(typeof row.points_for).toBe('number')
      expect(typeof row.points_against).toBe('number')
      expect(typeof row.win_pct).toBe('number')
    }
    expect(third.points_for.toFixed(2)).toBe('0.00')
    expect(first.points_for.toFixed(2)).toBe('71.50')
    expect(first.wins).toBe(1)
    expect(second.losses).toBe(1)
    expect(third.games).toBe(0)
    // The chain rides through as 117 renders it — nothing re-derived here.
    expect(Array.isArray(doc.chain)).toBe(true)
    expect(doc.coin_flip_seed_source).toBeDefined()
  })

  it('the raw RPC really does render the two scales differently on the WIRE (the hazard F247(b) names — R601: raw bytes)', async () => {
    // supabase-js parses the document, which hides the difference; the
    // measurement is over the bytes PostgREST sends, the way R804 made it.
    const { data: session } = await managerClient.auth.getSession()
    const response = await fetch(`${LOCAL_URL}/rest/v1/rpc/league_standings`, {
      method: 'POST',
      headers: {
        apikey: LOCAL_ANON_KEY,
        Authorization: `Bearer ${session.session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_league_id: leagueId }),
    })
    expect(response.status).toBe(200)
    const raw = await response.text()
    // The summed shape carries its numeric(8,2) scale; the no-rows shape is a
    // bare 0 — two renderings of one column, which is why the service
    // normalises rather than trusts.
    expect(raw).toMatch(/"points_for":\s*71\.50\b/)
    expect(raw).toMatch(/"points_for":\s*0[,}]/)
    expect(raw).not.toMatch(/"points_for":\s*0\.00/)
  })
})


// ---------------------------------------------------------------------------
// R812 — a SOFT-DELETED league. Last in the file on purpose: the league row
// is mutated and restored around the cells.
// ---------------------------------------------------------------------------

describe('a SOFT-DELETED league answers a MEMBER a 404 by name after the membership check, and a NON-MEMBER the same 403 (R812)', () => {
  it('rosters / matchups / activity: 404 by name for a member; standings: 117\'s own P0002 → 404; the outsider still 403', async () => {
    const { error: deleteError } = await service
      .from('leagues')
      .update({ deleted_at: '2099-01-01T00:00:00+00:00' })
      .eq('id', leagueId)
    expect(deleteError).toBeNull()
    try {
      // `is_league_member` ignores `deleted_at` (052:86-94), so without the
      // fold the member would pass the gate and the services would answer
      // "the league row read empty after membership passed" — a 500.
      const { data: stillMember } = await managerClient.rpc('is_league_member', { p_league_id: leagueId })
      expect(stillMember).toBe(true)

      const gone = { status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } }
      expect(await readRosters(managerClient, leagueId)).toStrictEqual(gone)
      expect(await readMatchups(managerClient, leagueId, { week: '1' })).toStrictEqual(gone)
      expect(await readActivity(managerClient, leagueId, {})).toStrictEqual(gone)
      // 117 looks the league up `deleted_at IS NULL` in-body and raises P0002
      // (117:1001-1004); the family mapper answers 404 with its words.
      const standings = await readStandings(managerClient, leagueId)
      expect(standings.status).toBe(404)
      expect(errorText(standings)).toContain(`league ${leagueId} not found`)

      // Order is load-bearing: the outsider is refused BEFORE the deleted
      // check runs, so a non-member never learns the league existed.
      const forbidden = { status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } }
      expect(await readRosters(outsiderClient, leagueId)).toStrictEqual(forbidden)
      expect(await readMatchups(outsiderClient, leagueId, { week: '1' })).toStrictEqual(forbidden)
      expect(await readActivity(outsiderClient, leagueId, {})).toStrictEqual(forbidden)
      expect(await readStandings(outsiderClient, leagueId)).toStrictEqual(forbidden)
    } finally {
      const { error: restoreError } = await service.from('leagues').update({ deleted_at: null }).eq('id', leagueId)
      expect(restoreError).toBeNull()
    }
    // Restored: the member reads again (the fold did not break the live path).
    expect((await readRosters(managerClient, leagueId)).status).toBe(200)
  })
})
