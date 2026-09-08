/**
 * season-sweep-db.test.ts — L.D6.1 item 3, the LIVE half: every in-season
 * invariant gets a violation PLANTED IN THE DATABASE against migrations
 * 001–122, the sweep is shown to redden on it, and the plant is reverted
 * (D267 — no decorative checks; §4.3's falsifiability floor).
 *
 * The collector under test is the RUNNER'S OWN (`collectSeasonAudit` /
 * `snapshotNewlyFinal` / `readLeagueState`), not a re-implementation: a
 * plant that the sim's own reader would miss must fail here.
 *
 * The fixture is one 8-seat league on `SYNTHETIC_SEASON` (2099) driven
 * through ONE week to `final` by the REAL machinery — `league_week_advance`
 * → `set_lineup` → `runScoreWeekBatch` (the production worker over the
 * production queue) → `league_week_advance` → `finalize_matchups`, every
 * instant `p_now`-injected from the calendar's own stored literals (D291),
 * every job call carrying `p_league_id` (D313(2) — the jobs would otherwise
 * walk every in-season league on the shared stack).
 *
 * WHAT CANNOT BE PLANTED, and why that is SAID rather than papered over:
 * roster exclusivity is `UNIQUE(league_id, player_id)` on `league_rosters`
 * (072:147), which refuses even a service-role INSERT. `the constraint
 * refuses the plant` below PROVES that refusal rather than skipping the
 * invariant, and the checker's own falsifiability is pinned in
 * `season-invariants.test.ts`. Invariant 1's other two arms — a started
 * player who is on nobody's roster, and one player started by two teams —
 * ARE plantable, because `team_lineups.slot_map` is unconstrained JSONB.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails / usernames / action_ids + cleanup-first (the
 * D3/D17 ESLint bans cover `src/lib/leagues/**`). Action-id prefix `ad6` —
 * this suite owns it (the D108(14) registry; measured free 2026-09-08).
 * Calendar: every instant is a 2099 literal; the week-1 stamp this suite
 * writes is RESTORED to NULL in cleanup and the 18 seeded rows are never
 * deleted (`synthetic-season.ts`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import type { ReconcileReport } from '../scoring/reconcile'
import { runScoreWeekBatch } from '../scoring/score-week-worker'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { systemTime } from '../time/time-provider'

import {
  sweepSeasonAudit,
  type SeasonAudit,
  type SeasonInvariantFailure,
} from './season-invariants'
import { collectSeasonAudit, readLeagueState, snapshotNewlyFinal, type LeagueState } from './season-runner'
import { seedSyntheticSeason, SYNTHETIC_SEASON } from './synthetic-season'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-season-sweep-league'
const GAME_ID = 'vitest-ss-g1'
const CLUB = 'VSA'
const OPPONENT = 'VSB'
const WEEK = 1

/** synthetic-season.ts week 1: Wed 2099-09-09 00:00 ET; window +8d 6h. */
const WEEK1_STARTS = '2099-09-09T04:00:00.000Z'
const KICKOFF = '2099-09-10T00:15:00.000Z'
const LAST_GAME_ENDS = '2099-09-14T04:00:00.000Z'
const WINDOW_CLOSES = '2099-09-17T10:00:00.000Z'
/** synthetic-season.ts week 2: seven days after week 1. */
const WEEK2_STARTS = '2099-09-16T04:00:00.000Z'
const MINUTE_MS = 60_000

const COMMISH = {
  email: 'season-sweep-commish@fieldscout.test',
  password: 'pgtap-ss-pass-1',
  username: 'ss_commish_one',
}

const SEATS = 8
const PLAYERS = Array.from({ length: SEATS }, (_, i) => [
  { id: `vitest-ss-qb-${i + 1}`, full_name: `Vitest SS QB ${i + 1}`, position: 'QB', team: CLUB, status: 'Active' },
  { id: `vitest-ss-rb-${i + 1}`, full_name: `Vitest SS RB ${i + 1}`, position: 'RB', team: CLUB, status: 'Active' },
]).flat()

const ACTION_LEAGUE = 'ad600000-0000-4000-8000-000000000001'
const lineupAction = (i: number): string => `ad600000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let commishId: string
let leagueId: string
let teamIds: string[] = []
let state: LeagueState

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

/** `must`, and the row must EXIST — "no row" is loud, never a plausible
 *  empty (CLAUDE.md's "never let nothing happened mean it worked"). */
function need<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = must(res, what)
  if (data === null || data === undefined) throw new Error(`${what}: no row`)
  return data as NonNullable<T>
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const tIds = (teams ?? []).map((t) => t.id)
    if (tIds.length > 0) {
      must(await service.from('team_lineups').delete().in('team_id', tIds).select('id'), 'cleanup team_lineups')
    }
    for (const table of [
      'lineup_actions',
      'team_week_results',
      'matchups',
      'league_weeks',
      'league_player_pool',
      'league_rosters',
      'league_chat',
      'league_members',
      'transactions',
      'schedule_actions',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    must(await service.from('leagues').update({ champion_team_id: null }).in('id', ids).select('id'), 'cleanup champion')
    must(await service.from('teams').delete().in('league_id', ids).select('id'), 'cleanup teams')
    must(await service.from('leagues').delete().in('id', ids).select('id'), 'cleanup leagues')
  }
  const playerIds = PLAYERS.map((p) => p.id)
  for (const table of ['score_fanout', 'player_stats'] as const) {
    const { error } = await service.from(table).delete().in('player_id', playerIds)
    if (error) throw new Error(`cleanup ${table}: ${error.message}`)
  }
  const { error: gamesError } = await service.from('nfl_games').delete().eq('id', GAME_ID)
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  const { error: playersError } = await service.from('players').delete().in('id', playerIds)
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  // The seeded week-1 row is shared reference data: only the stamp this
  // suite wrote goes back to NULL (synthetic-season.ts).
  const { error: weekError } = await service
    .from('nfl_weeks')
    .update({ last_game_ends_at: null })
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', WEEK)
  if (weekError) throw new Error(`cleanup nfl_weeks: ${weekError.message}`)
  await deleteUserByUsername(COMMISH.username)
}

async function job(
  name: 'league_week_advance' | 'finalize_matchups',
  at: string,
): Promise<void> {
  const { error } = await service.rpc(name, { p_now: at, p_league_id: leagueId })
  if (error) throw new Error(`${name}(${at}): ${error.message}`)
}

/** A no-finding reconcile report: the three PROMOTED finding kinds are
 *  pinned in `season-invariants.test.ts`; this file plants the DIRECT arms. */
const EMPTY_RECONCILE = {
  ran_at: '',
  season: SYNTHETIC_SEASON,
  leagues: 0,
  league_weeks: 0,
  cells: 0,
  excluded_overridden: 0,
  findings: [],
  counts: {},
  alerts: 0,
  warns: 0,
  infos: 0,
  reason: null,
} satisfies ReconcileReport

async function audit(): Promise<SeasonAudit> {
  return collectSeasonAudit(service, state, [WEEK], EMPTY_RECONCILE, [], 0)
}

async function sweep(): Promise<SeasonInvariantFailure[]> {
  return sweepSeasonAudit(await audit())
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const { data: created, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  commishId = created.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword(COMMISH)
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)

  // ---- The league: 8 seats, ONE starting QB + ONE starting RB, one IR ----
  const settings = {
    ...defaultsForTeamCount(SEATS),
    roster_settings: {
      starting_slots: [
        { key: 'qb', label: 'QB', eligible: ['QB' as const], count: 1 },
        { key: 'rb', label: 'RB', eligible: ['RB' as const], count: 1 },
      ],
      bench: 0,
      ir_slots: [{ key: 'ir1', type: 'unrestricted' as const, eligible_designations: ['OUT' as const, 'IR' as const] }],
      swap_spots: 0 as const,
    },
  }
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const template = need(
    await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single(),
    'scoring template',
  )
  const league = need(
    await commishClient.rpc('create_league', {
      p_name: LEAGUE_NAME,
      p_season: SYNTHETIC_SEASON,
      p_scoring_system_id: template.id,
      p_team_name: 'Seat 1',
      p_action_id: ACTION_LEAGUE,
      p_settings: blob,
      ...columnArgs,
    } as unknown as Database['public']['Functions']['create_league']['Args']),
    'create_league',
  )
  leagueId = (league as { league_id: string }).league_id

  const first = need(await service.from('teams').select('id').eq('league_id', leagueId).single(), 'commissioner team')
  const extra = need(
    await service
      .from('teams')
      .insert(Array.from({ length: SEATS - 1 }, (_, i) => ({ owner_id: commishId, name: `Seat ${i + 2}`, league_id: leagueId })))
      .select('id'),
    'extra teams',
  )
  teamIds = [first.id, ...extra.map((t) => t.id)]

  must(await service.from('players').insert(PLAYERS).select('id'), 'players insert')
  must(
    await service
      .from('league_rosters')
      .insert(
        teamIds.flatMap((teamId, i) => [
          { league_id: leagueId, team_id: teamId, player_id: `vitest-ss-qb-${i + 1}` },
          { league_id: leagueId, team_id: teamId, player_id: `vitest-ss-rb-${i + 1}` },
        ]),
      )
      .select('player_id'),
    'league_rosters insert',
  )
  must(
    await service
      .from('league_player_pool')
      .insert(PLAYERS.map((p) => ({ league_id: leagueId, player_id: p.id, state: 'rostered' })))
      .select('player_id'),
    'league_player_pool insert',
  )
  must(
    await service
      .from('leagues')
      .update({ status: 'in_season', scoring_rules_snapshot: template.rules })
      .eq('id', leagueId)
      .select('id'),
    'leagues → in_season',
  )
  must(
    await service
      .from('league_weeks')
      .insert([WEEK, WEEK + 1].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
      .select('week'),
    'league_weeks insert',
  )
  must(
    await service
      .from('matchups')
      .insert(
        Array.from({ length: SEATS / 2 }, (_, i) => ({
          league_id: leagueId,
          season: SYNTHETIC_SEASON,
          week: WEEK,
          round_type: 'regular',
          home_team_id: teamIds[i * 2]!,
          away_team_id: teamIds[i * 2 + 1]!,
        })),
      )
      .select('id'),
    'matchups insert',
  )
  must(
    await service
      .from('nfl_games')
      .insert({
        id: GAME_ID,
        season: SYNTHETIC_SEASON,
        week: WEEK,
        home_team: CLUB,
        away_team: OPPONENT,
        kickoff_at: KICKOFF,
        status: 'final',
      })
      .select('id'),
    'nfl_games insert',
  )

  // ---- Drive the week through the REAL machinery -------------------------
  await job('league_week_advance', new Date(Date.parse(WEEK1_STARTS) + MINUTE_MS).toISOString())
  for (const [i, teamId] of teamIds.entries()) {
    const { error } = await commishClient.rpc('set_lineup', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_week: WEEK,
      p_slot_map: { 'qb:0': `vitest-ss-qb-${i + 1}`, 'rb:0': `vitest-ss-rb-${i + 1}` },
      p_action_id: lineupAction(i + 1),
      p_reason: 'season-sweep fixture: seating every franchise for the driven week',
    })
    if (error) throw new Error(`set_lineup(seat ${i + 1}): ${error.message}`)
  }
  // Stat lines, then the PRODUCTION worker over the PRODUCTION queue — no
  // hand-written matchup UPDATE exists in this fixture.
  const stamp = systemTime.now().toISOString()
  must(
    await service
      .from('player_stats')
      .upsert(
        PLAYERS.map((p, i) => ({
          player_id: p.id,
          season: SYNTHETIC_SEASON,
          week: WEEK,
          stat_type: 'weekly',
          updated_at: stamp,
          advanced: {},
          ...(p.position === 'QB'
            ? { pass_yards: 200 + i * 7, pass_tds: 1 + (i % 3) }
            : { rush_yards: 40 + i * 5, rush_tds: i % 2 }),
        })),
        { onConflict: 'player_id,season,week' },
      )
      .select('player_id'),
    'player_stats upsert',
  )
  must(
    await service
      .from('score_fanout')
      .upsert(
        PLAYERS.map((p) => ({ season: SYNTHETIC_SEASON, week: WEEK, player_id: p.id, enqueued_at: stamp, deferred_until: null })),
        { onConflict: 'season,week,player_id', ignoreDuplicates: false },
      )
      .select('player_id'),
    'score_fanout enqueue',
  )
  const batch = await runScoreWeekBatch({ time: systemTime, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
  if (batch.written === 0) {
    throw new Error(`the fixture's score batch wrote nothing — refusing to call that a driven week: ${JSON.stringify(batch.problems)}`)
  }
  must(
    await service
      .from('nfl_weeks')
      .update({ last_game_ends_at: LAST_GAME_ENDS })
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', WEEK)
      .select('week'),
    'nfl_weeks last_game_ends_at',
  )
  await job('league_week_advance', new Date(Date.parse(LAST_GAME_ENDS) + MINUTE_MS).toISOString())
  await job('finalize_matchups', new Date(Date.parse(WINDOW_CLOSES) + MINUTE_MS).toISOString())

  state = await readLeagueState(service, 'vitest season sweep', leagueId, SEATS, 0)
  await snapshotNewlyFinal(service, [state])
}, 180_000)

afterAll(async () => {
  await cleanup()
})

describe('the driven fixture', () => {
  it('reached `final` through the real jobs, and the sweep is GREEN on it', async () => {
    const a = await audit()
    expect(a.weeks.find((w) => w.week === WEEK)?.status).toBe('final')
    expect(a.results.filter((r) => r.week === WEEK && r.points !== null)).toHaveLength(SEATS)
    expect(state.weeksFinal.has(WEEK)).toBe(true)
    expect(sweepSeasonAudit(a)).toEqual([])
  })
})

describe('1 — exclusivity: the constraint, and the two arms nothing constrains', () => {
  it('the DB REFUSES the roster plant — 072:147\'s unique index is the proof, and the check can never redden here', async () => {
    const { error } = await service
      .from('league_rosters')
      .insert({ league_id: leagueId, team_id: teamIds[1]!, player_id: 'vitest-ss-qb-1' })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/duplicate key|unique/i)
    // …and the sweep stays green, because nothing changed.
    expect(await sweep()).toEqual([])
  })

  it('a started player on NOBODY\'s roster reddens the sweep, and reverts clean', async () => {
    const { data: before } = await service
      .from('team_lineups')
      .select('slot_map')
      .eq('team_id', teamIds[0]!)
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', WEEK)
      .single()
    must(
      await service
        .from('team_lineups')
        .update({ slot_map: { 'qb:0': 'vitest-ss-qb-1', 'rb:0': 'vitest-ss-rb-8' } })
        .eq('team_id', teamIds[0]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .select('id'),
      'plant: foreign starter',
    )
    const failures = await sweep()
    expect(failures.filter((f) => f.invariant === 'exclusivity').length).toBeGreaterThan(0)
    expect(failures.find((f) => f.invariant === 'exclusivity')!.detail).toContain('vitest-ss-rb-8')
    expect(failures.find((f) => f.invariant === 'exclusivity')!.week).toBe(WEEK)

    must(
      await service
        .from('team_lineups')
        .update({ slot_map: before!.slot_map })
        .eq('team_id', teamIds[0]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .select('id'),
      'revert: foreign starter',
    )
    expect(await sweep()).toEqual([])
  })
})

describe('2 — roster/lineup legality: the bipartite recheck against lineup_fit_internal', () => {
  it('an RB seated in the QB slot key reddens the sweep with the ORACLE\'s own words, and reverts clean', async () => {
    const { data: before } = await service
      .from('team_lineups')
      .select('slot_map')
      .eq('team_id', teamIds[2]!)
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', WEEK)
      .single()
    // Both of this team's players in RB-eligible seats: the RB slot can hold
    // one, the QB slot holds none of them — `lineup_fit_internal` returns a
    // non-empty `unplaced`.
    must(
      await service
        .from('team_lineups')
        .update({ slot_map: { 'qb:0': 'vitest-ss-rb-3', 'rb:0': 'vitest-ss-qb-3' } })
        .eq('team_id', teamIds[2]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .select('id'),
      'plant: illegal seating',
    )
    const failures = (await sweep()).filter((f) => f.invariant === 'lineup-legality')
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]!.week).toBe(WEEK)
    expect(failures.map((f) => f.detail).join(' ')).toMatch(/cannot seat|REARRANGED/)

    must(
      await service
        .from('team_lineups')
        .update({ slot_map: before!.slot_map })
        .eq('team_id', teamIds[2]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .select('id'),
      'revert: illegal seating',
    )
    expect(await sweep()).toEqual([])
  })
})

describe('3 — standings ≡ recompute-from-scratch (THE DoD BREAK PROBE)', () => {
  it('a perturbed team_week_results.points makes the rebuild CHANGE the final week — md5 before ≠ after — and reverts to before = after', async () => {
    // GREEN first: the rebuild is a no-op and the two digests agree.
    const green = (await audit()).rebuilds.find((r) => r.week === WEEK)!
    expect(green.refusal).toBeNull()
    expect(green.changed).toBe(false)
    expect(green.digest_before).toBe(green.digest_after)
    const digestGreen = green.digest_before

    const target = need(
      await service
        .from('team_week_results')
        .select('team_id, points')
        .eq('league_id', leagueId)
        .eq('week', WEEK)
        .order('team_id')
        .limit(1)
        .single(),
      'probe: read a results row',
    )
    const original = Number(target.points)
    must(
      await service
        .from('team_week_results')
        .update({ points: original + 13.5 })
        .eq('league_id', leagueId)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .eq('team_id', target.team_id)
        .select('team_id'),
      'plant: standings drift',
    )

    const red = await audit()
    const probe = red.rebuilds.find((r) => r.week === WEEK)!
    expect(probe.changed).toBe(true)
    expect(probe.digest_before).not.toBe(probe.digest_after)
    // The rebuild REPAIRED the row as it measured it, so the drift is only
    // visible in the probe's own digests — which is exactly the assertion.
    const failures = sweepSeasonAudit(red).filter((f) => f.invariant === 'standings-recompute')
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]!.week).toBe(WEEK)
    expect(failures[0]!.detail).toContain(probe.digest_before!)
    expect(failures[0]!.detail).toContain(probe.digest_after!)

    // Reverted: the rebuild already restored the row, and a second probe is
    // a no-op again with the ORIGINAL digest back.
    const after = (await audit()).rebuilds.find((r) => r.week === WEEK)!
    expect(after.changed).toBe(false)
    expect(after.digest_before).toBe(after.digest_after)
    expect(after.digest_after).toBe(digestGreen)
  })
})

describe('4 — pool/roster mirror (§12.19; D294)', () => {
  it('a rostered player flipped to free_agent in the pool reddens the sweep, and reverts clean', async () => {
    must(
      await service
        .from('league_player_pool')
        .update({ state: 'free_agent' })
        .eq('league_id', leagueId)
        .eq('player_id', 'vitest-ss-qb-4')
        .select('player_id'),
      'plant: pool flip',
    )
    const failures = (await sweep()).filter((f) => f.invariant === 'pool-roster-mirror')
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('vitest-ss-qb-4')
    expect(failures[0]!.detail).toContain("'free_agent'")

    must(
      await service
        .from('league_player_pool')
        .update({ state: 'rostered' })
        .eq('league_id', leagueId)
        .eq('player_id', 'vitest-ss-qb-4')
        .select('player_id'),
      'revert: pool flip',
    )
    expect(await sweep()).toEqual([])
  })

  it('DELETING a pool row is LAWFUL (§12.19 lazy rows) — the naive false positive does NOT fire', async () => {
    must(
      await service
        .from('league_player_pool')
        .delete()
        .eq('league_id', leagueId)
        .eq('player_id', 'vitest-ss-rb-5')
        .select('player_id'),
      'plant: lazy row',
    )
    expect(await sweep()).toEqual([])
    must(
      await service
        .from('league_player_pool')
        .insert({ league_id: leagueId, player_id: 'vitest-ss-rb-5', state: 'rostered' })
        .select('player_id'),
      'revert: lazy row',
    )
    expect(await sweep()).toEqual([])
  })
})

describe('5 — PF counted once per week (§11.7; D297)', () => {
  it("doubling a week's points moves the standings PF by exactly that delta ONCE, and the sweep names it", async () => {
    const target = need(
      await service
        .from('team_week_results')
        .select('team_id, points')
        .eq('league_id', leagueId)
        .eq('week', WEEK)
        .order('team_id')
        .limit(1)
        .single(),
      'plant: read a results row',
    )
    const original = Number(target.points)
    const before = (await audit()).standings.find((s) => s.team_id === target.team_id)!.points_for
    expect(before).toBeCloseTo(original, 2)

    must(
      await service
        .from('team_week_results')
        .update({ points: original * 2 })
        .eq('league_id', leagueId)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK)
        .eq('team_id', target.team_id)
        .select('team_id'),
      'plant: PF double',
    )
    const red = await audit()
    // PF moved by exactly the delta, ONCE — not twice for a median/second game.
    const moved = red.standings.find((s) => s.team_id === target.team_id)!.points_for
    expect(moved).toBeCloseTo(original * 2, 2)
    // …and the sweep catches the recompute drift the same plant caused.
    const failures = sweepSeasonAudit(red)
    expect(failures.some((f) => f.invariant === 'standings-recompute')).toBe(true)

    // Revert: the rebuild the audit ran already restored the row from
    // `matchups` (117:855) — assert the ORIGINAL value is back, then sweep.
    const restored = need(
      await service
        .from('team_week_results')
        .select('points')
        .eq('league_id', leagueId)
        .eq('week', WEEK)
        .eq('team_id', target.team_id)
        .single(),
      'revert: read back',
    )
    expect(Number(restored.points)).toBeCloseTo(original, 2)
    expect(await sweep()).toEqual([])
  })

  it('a standings PF that disagrees with the week sums is caught even when the rebuild is clean', async () => {
    // Plant on the MATCHUP (the standings' own source) so the rebuild agrees
    // with the results table and only the PF arm can see it.
    const a = await audit()
    const teamId = a.standings[0]!.team_id
    const sum = a.results.filter((r) => r.team_id === teamId).reduce((n, r) => n + (r.points ?? 0), 0)
    expect(a.standings[0]!.points_for).toBeCloseTo(sum, 2)
    // A doctored audit is the falsifiability of the arm itself (the live
    // plant above proves the DB path); one line, one field.
    const doctored: SeasonAudit = { ...a, standings: [{ team_id: teamId, points_for: sum + 0.01 }, ...a.standings.slice(1)] }
    const failures = sweepSeasonAudit(doctored).filter((f) => f.invariant === 'pf-once-per-week')
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('counted once per week')
  })
})

describe('6 — zero final-cell rewrites (§23.4; D295(b))', () => {
  it('a direct UPDATE of a FINAL matchup reddens the temporal check, and reverts clean', async () => {
    const target = need(
      await service
        .from('matchups')
        .select('id, home_score')
        .eq('league_id', leagueId)
        .eq('week', WEEK)
        .order('id')
        .limit(1)
        .single(),
      'plant: read a final cell',
    )
    const original = target.home_score
    must(
      await service.from('matchups').update({ home_score: Number(original) + 42 }).eq('id', target.id).select('id'),
      'plant: final-cell rewrite',
    )
    const failures = (await sweep()).filter((f) => f.invariant === 'final-cell-immutable')
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]!.week).toBe(WEEK)
    expect(failures[0]!.detail).toContain(target.id)

    must(
      await service.from('matchups').update({ home_score: original }).eq('id', target.id).select('id'),
      'revert: final-cell rewrite',
    )
    // The revert is not complete until the derived table follows it. This is
    // §6-D of the build brief made visible: invariant 3's probe
    // (`rebuild_team_week_results`) is a WRITER — 117:855 re-runs the results
    // math unconditionally — so the plant above propagated into
    // `team_week_results` through the rebuild the FIRST audit ran, and one
    // more audit is what re-derives the reverted matchup into it. (This is
    // exactly why the runner takes the final-cell snapshot BEFORE calling the
    // rebuild: a sweep that ordered them the other way would trip its own
    // invariant. Measured here 2026-09-08 as an ordering red in a full-suite
    // run — the reason it is worth a comment rather than a shrug.)
    await audit()
    expect((await sweep()).filter((f) => f.invariant === 'final-cell-immutable')).toEqual([])
  })
})

describe('7 — zero unhandled worker errors (§23.2)', () => {
  it('the chain REFUSES three plants outright — and each refusal is defence in depth, recorded not worked around', async () => {
    // Recorded rather than worked around. D292's quarantine arm
    // (`assertSnapshotScorable`, score-week-worker.ts:294) is unreachable
    // from a planted row on this chain, because two DB guards stand in
    // front of it, and BOTH were measured here on 2026-09-08:
    //   * a NULL snapshot on an `in_season` league →
    //     "cannot be in status in_season without scoring_rules_snapshot"
    //     (D43's guard, `trg_leagues_snapshot_guard`);
    //   * a corrupt document → `trg_leagues_scoring_rules_valid`, which
    //     fires ALWAYS and validates the §7.3.3.1 shape in-database.
    // That is defence in depth working, so the LIVE arm below plants a
    // different real worker failure instead of weakening either guard.
    const { error: nullError } = await service
      .from('leagues')
      .update({ scoring_rules_snapshot: null })
      .eq('id', leagueId)
    expect(nullError).not.toBeNull()
    expect(nullError!.message).toContain('scoring_rules_snapshot')

    const { error: corruptError } = await service
      .from('leagues')
      .update({ scoring_rules_snapshot: { version: 2, positions: 'not-an-object' } })
      .eq('id', leagueId)
    expect(corruptError).not.toBeNull()
    expect(corruptError!.message).toMatch(/Document shape|§7\.3\.3\.1/)

    // …and `team_lineups.slot_map` cannot be made unreadable either:
    // `team_lineups_slot_map_is_object` refuses a non-object.
    const { error: mapError } = await service
      .from('team_lineups')
      .update({ slot_map: [] })
      .eq('team_id', teamIds[0]!)
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', WEEK)
    expect(mapError).not.toBeNull()
    expect(mapError!.message).toContain('team_lineups_slot_map_is_object')

    // Nothing changed, so the sweep is still green.
    expect(await sweep()).toEqual([])
  })

  it("a starter with no `players` row FAILS that league's week (D292 quarantine) and the failure reaches the sweep, then reverts clean", async () => {
    // Week 2 is opened through the REAL advance job so the door state is
    // `live` and the worker actually reaches step 6 (a `final` week is
    // skipped by name before it — D295(b)).
    await job('league_week_advance', new Date(Date.parse(WEEK2_STARTS) + MINUTE_MS).toISOString())
    must(
      await service
        .from('matchups')
        .insert(
          Array.from({ length: SEATS / 2 }, (_, i) => ({
            league_id: leagueId,
            season: SYNTHETIC_SEASON,
            week: WEEK + 1,
            round_type: 'regular',
            home_team_id: teamIds[i * 2]!,
            away_team_id: teamIds[i * 2 + 1]!,
          })),
        )
        .select('id'),
      'week 2 matchups',
    )
    const before = need(
      await service
        .from('team_lineups')
        .select('slot_map')
        .eq('team_id', teamIds[0]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK + 1)
        .single(),
      'week 2 carried lineup',
    )
    // A starter the `players` table does not know. `set_lineup` refuses this
    // (the map is validated against the team's roster), which is why the
    // plant is a direct row write — `slot_map` is JSONB with no FK.
    must(
      await service
        .from('team_lineups')
        .update({ slot_map: { 'qb:0': 'vitest-ss-ghost', 'rb:0': 'vitest-ss-rb-1' } })
        .eq('team_id', teamIds[0]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK + 1)
        .select('id'),
      'plant: ghost starter',
    )

    const stamp = systemTime.now().toISOString()
    must(
      await service
        .from('player_stats')
        .upsert(
          [{ player_id: 'vitest-ss-rb-1', season: SYNTHETIC_SEASON, week: WEEK + 1, stat_type: 'weekly', updated_at: stamp, advanced: {}, rush_yards: 88 }],
          { onConflict: 'player_id,season,week' },
        )
        .select('player_id'),
      'plant: week 2 delta stats',
    )
    must(
      await service
        .from('score_fanout')
        .upsert([{ season: SYNTHETIC_SEASON, week: WEEK + 1, player_id: 'vitest-ss-rb-1', enqueued_at: stamp, deferred_until: null }], {
          onConflict: 'season,week,player_id',
          ignoreDuplicates: false,
        })
        .select('player_id'),
      'plant: week 2 delta enqueue',
    )
    const batch = await runScoreWeekBatch({ time: systemTime, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
    const failed = batch.leagues.filter((l) => l.outcome === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.league_id).toBe(leagueId)
    expect(failed[0]!.week).toBe(WEEK + 1)
    expect(failed[0]!.error).toContain('vitest-ss-ghost')
    // D292: the failure is QUARANTINED to that league-week — the drain did
    // not throw, and `problems` carries it with league context (§23.2).
    expect(batch.problems.join(' ')).toContain(leagueId)

    // The runner routes exactly that into the sweep's invariant 7.
    const withError = await collectSeasonAudit(
      service,
      state,
      [WEEK],
      EMPTY_RECONCILE,
      [`score batch: league ${failed[0]!.league_id} week ${failed[0]!.week} FAILED — ${failed[0]!.error ?? ''}`],
      0,
    )
    const failures = sweepSeasonAudit(withError).filter((f) => f.invariant === 'zero-worker-errors')
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('vitest-ss-ghost')
    expect(failures[0]!.leagueId).toBe(leagueId)
    // The SAME plant is invariant 1's other live arm (a started player on
    // nobody's roster) — one plant, two invariants, both named.
    expect(sweepSeasonAudit(withError).some((f) => f.invariant === 'exclusivity')).toBe(true)

    // ---- revert ----------------------------------------------------------
    must(
      await service
        .from('team_lineups')
        .update({ slot_map: before.slot_map })
        .eq('team_id', teamIds[0]!)
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', WEEK + 1)
        .select('id'),
      'revert: ghost starter',
    )
    must(
      await service.from('score_fanout').delete().eq('season', SYNTHETIC_SEASON).eq('week', WEEK + 1).select('player_id'),
      'revert: week 2 queue',
    )
    expect(await sweep()).toEqual([])
  }, 60_000)
})
