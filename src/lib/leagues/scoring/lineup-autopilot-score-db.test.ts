/**
 * lineup-autopilot-score-db.test.ts — M6A L.E1.4, the closing clause of exit
 * criterion 4 (`tasks-M6A-commissioner-fallback.md` §1 item 4 / R988): after
 * the tick fills an unmanaged seat, the lineup it wrote must reach the
 * SCOREBOARD. A seated lineup that never scores is the same zero Q56(b)
 * measured, one layer down — and every other assertion in this slice stops at
 * `team_lineups`.
 *
 * THE CHAIN, end to end, with nothing stubbed:
 *   `lineup_lock_tick` (migration 125, arm (c)) materializes and fills an
 *   UNMANAGED seat → `score_fanout` carries the seated players' delta →
 *   the REAL `runScoreWeekBatch` drains it → `team_week_results.points > 0`.
 *
 * TWO MEASURED CORRECTIONS TO R988's WORDING, both recorded in the PR and in
 * PROGRESS (they are facts about `src/`, which the breakdown's own citation
 * discipline makes advisory — §2's head note):
 *   (1) R988 says the probe should "write `slot_map` WITHOUT the `starters[]`
 *       element the worker maps from". MEASURED: the worker maps a player to a
 *       team through `team_lineups.slot_map` and never reads `starters`
 *       (`score-week-worker.ts` → the `team_lineups` read selects
 *       `team_id, slot_map, edited_by_commish`, and `startersOf(row.slot_map,
 *       irKeys)` is what derives the starters). The breakdown says so itself
 *       elsewhere (§2.1: "the scoring worker … reads `slot_map` and nothing
 *       else"). So the probe that actually falsifies this file omits the
 *       `slot_map` entry; an omitted `starters[]` element is invisible to the
 *       worker, which is itself worth knowing and is why BOTH probe arms are
 *       reported.
 *   (2) There is no `team_week_results.total_points` column — the column is
 *       `points` (`total_points` is the schedule MODE, and a `total_points`
 *       column exists on `team_lineups`). Asserted on `points`.
 *
 * WHY A `total_points` LEAGUE. In that mode the worker's own single drain
 * writes `team_week_results.points` (`score_write_week_batch`, migration 119).
 * In `h2h` the same drain writes `matchups.home_score/away_score` and
 * `team_week_results` arrives later from `finalize_matchups` — a longer chain
 * that pgTAP 064 §E already pins end to end. This file is about autopilot's
 * output reaching a score at all, so it takes the one-drain path.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/R724/F226 — every fixture that evaluates an instant owns its
 * calendar and reads NO wall clock): the league lives on `SYNTHETIC_SEASON`
 * (2099); every instant below is a fixed 2099 literal and the worker is driven
 * by a `VirtualClock`, never by the system clock (the D3/D17 ESLint bans cover
 * `src/lib/leagues/**`).
 *
 * SCOPE: the tick and the drain are both scoped to this league
 * (`p_league_id` / `leagueIds`) — unscoped they would walk every in-season
 * league on the shared stack and flip other suites' weeks mid-run (D313).
 *
 * No `action_id` is minted anywhere here (the job RPC takes none), so this
 * file claims no prefix in the D108(14) registry.
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-apscore'
const SEASON = SYNTHETIC_SEASON
const WEEK = 1
/** synthetic-season.ts: week 1 opens Wed 2099-09-09 04:00Z. */
const TICK_AT = '2099-09-09T12:00:00.000Z'
/** The one game of the week, after the tick instant ⇒ nobody is locked. */
const KICKOFF = '2099-09-10T00:15:00.000Z'
/** The stat stamp AND the queue stamp: equal passes the worker's `updated_at >= enqueued_at`. */
const STAMP = '2099-09-14T01:00:00.000Z'

const COMMISH = {
  email: 'autopilot-score-commish@fieldscout.test',
  password: 'pgtap-apscore-pass-1',
  username: 'apscore_commish',
}

const QB = `${PREFIX}-qb`
const WR = `${PREFIX}-wr`
const GAME = `${PREFIX}-g1`

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
/** The worker's injected instant — inside the synthetic week, never a wall clock. */
const clock = new VirtualClock(new Date('2099-09-14T02:00:00.000Z'))

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  await service.from('score_fanout').delete().in('player_id', [QB, WR])
  await service.from('player_stats').delete().like('player_id', `${PREFIX}-%`)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of [
      'transactions',
      'team_week_results',
      'matchups',
      'league_weeks',
      'league_player_pool',
      'league_rosters',
      'league_chat',
      'league_members',
    ] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').update({ successor_team_id: null }).in('league_id', ids), 'cleanup teams lineage')
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await service.from('nfl_games').delete().eq('id', GAME)
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  const { data: profiles } = await service.from('profiles').select('id').eq('username', COMMISH.username)
  for (const row of profiles ?? []) await service.auth.admin.deleteUser(row.id)
}

let leagueId = ''
let unmanagedTeamId = ''
let commishTeamId = ''

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const { data: created, error: userError } = await service.auth.admin.createUser({
    email: COMMISH.email,
    password: COMMISH.password,
    email_confirm: true,
    user_metadata: { username: COMMISH.username },
  })
  if (userError) throw new Error(`createUser failed: ${userError.message}`)
  const commishId = created.user.id

  const commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({
    email: COMMISH.email,
    password: COMMISH.password,
  })
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`)

  // The league through the REAL create_league, then a total_points mode and a
  // two-slot roster this file controls.
  const base = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings({ ...base, schedule_mode: 'total_points' as const, playoff_teams: 0 as const })
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const template = await must(
    commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single(),
    'ESPN Standard template',
  )
  const { data: league, error: leagueError } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: template!.id,
    p_team_name: 'Commish Team',
    p_action_id: '00000000-0000-4000-8000-0000b02a0001',
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (leagueError) throw new Error(`create_league failed: ${leagueError.message}`)
  leagueId = (league as { league_id: string }).league_id

  commishTeamId = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'commish team'))!.id
  unmanagedTeamId = (
    await must(
      service
        .from('teams')
        .insert({ owner_id: commishId, name: 'Unmanaged Seat', league_id: leagueId })
        .select('id')
        .single(),
      'unmanaged team',
    )
  )!.id

  await must(
    service
      .from('leagues')
      .update({
        status: 'in_season',
        scoring_rules_snapshot: template!.rules,
        roster_settings: {
          starting_slots: [
            { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
            { key: 'flex', label: 'W/R/T', eligible: ['WR', 'RB', 'TE'], count: 1 },
          ],
          bench: 4,
          ir_slots: [],
          swap_spots: 0,
        } as unknown as Json,
      })
      .eq('id', leagueId),
    'league → in_season',
  )

  // THE UNMANAGED SEAT, in add_placeholder_seat's own shape (user_id NULL,
  // is_placeholder TRUE, team_id SET) — D339's predicate matches this and not
  // the commissioner's own seat.
  await must(
    service
      .from('league_members')
      .insert({ league_id: leagueId, user_id: null, team_id: unmanagedTeamId, role: 'manager', is_placeholder: true }),
    'placeholder seat',
  )

  await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week: WEEK }), 'league_weeks')
  await must(
    service.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', WEEK),
    'week → live',
  )

  await must(
    service.from('nfl_games').upsert(
      { id: GAME, season: SEASON, week: WEEK, home_team: 'PHI', away_team: 'DAL', kickoff_at: KICKOFF, status: 'scheduled' },
      { onConflict: 'id' },
    ),
    'nfl_games',
  )
  await must(
    service.from('players').upsert(
      [
        { id: QB, full_name: 'AP Score QB', position: 'QB', team: 'DAL', status: 'Active', adp: 1 },
        { id: WR, full_name: 'AP Score WR', position: 'WR', team: 'DAL', status: 'Active', adp: 2 },
      ],
      { onConflict: 'id' },
    ),
    'players',
  )
  await must(
    service.from('league_rosters').insert([
      { league_id: leagueId, team_id: unmanagedTeamId, player_id: QB },
      { league_id: leagueId, team_id: unmanagedTeamId, player_id: WR },
    ]),
    'league_rosters',
  )
  // The commissioner's own seat needs a week row for the total_points door's
  // own precondition (every seated team must have one, F241(b)) — empty, and
  // it stays empty because its seat is MANAGED.
  await must(
    service
      .from('team_lineups')
      .insert({ team_id: commishTeamId, season: SEASON, week: WEEK, starters: [], bench: [], slot_map: {} }),
    'commish lineup row',
  )
}, 120_000)

afterAll(async () => {
  await cleanup()
}, 120_000)

describe('autopilot reaches the scoreboard (M6A exit criterion 4, R988)', () => {
  it('PREMISE: the unmanaged seat has NO lineup row for the live week', async () => {
    const rows = await must(
      service.from('team_lineups').select('id').eq('team_id', unmanagedTeamId).eq('season', SEASON).eq('week', WEEK),
      'premise lineup rows',
    )
    expect(rows ?? []).toHaveLength(0)
  })

  it('the tick materializes and FILLS the unmanaged seat (arm (c), D354)', async () => {
    const report = await must(
      service.rpc('lineup_lock_tick', { p_now: TICK_AT, p_league_id: leagueId }),
      'lineup_lock_tick',
    )
    const seats = (report as unknown as { seats_materialized: Array<{ team_id: string }> }).seats_materialized
    const piloted = (report as unknown as { autopiloted: Array<{ team_id: string }> }).autopiloted
    expect(seats.map((s) => s.team_id)).toContain(unmanagedTeamId)
    expect(piloted.map((s) => s.team_id)).toContain(unmanagedTeamId)

    const row = await must(
      service
        .from('team_lineups')
        .select('slot_map, starters')
        .eq('team_id', unmanagedTeamId)
        .eq('season', SEASON)
        .eq('week', WEEK)
        .single(),
      'filled lineup',
    )
    expect(row!.slot_map).toEqual({ 'qb:0': QB, 'flex:0': WR })
    // The redundant projection the box score reads, written in the same UPDATE.
    expect((row!.starters as Array<{ slot: string; player_id: string | null }>).map((s) => s.player_id)).toEqual([QB, WR])
  })

  it('PREMISE: both seated players carry stat lines, so a zero cannot be blamed on missing stats', async () => {
    await must(
      service.from('player_stats').upsert(
        [
          { player_id: QB, season: SEASON, week: WEEK, stat_type: 'weekly', updated_at: STAMP, advanced: {}, pass_yards: 200, pass_tds: 1 },
          { player_id: WR, season: SEASON, week: WEEK, stat_type: 'weekly', updated_at: STAMP, advanced: {}, receiving_yards: 50 },
        ],
        { onConflict: 'player_id,season,week' },
      ),
      'player_stats',
    )
    const lines = await must(
      service.from('player_stats').select('player_id, updated_at').in('player_id', [QB, WR]).eq('season', SEASON).eq('week', WEEK),
      'premise stat lines',
    )
    expect(lines!.map((l) => l.player_id).sort()).toEqual([QB, WR].sort())
    // Compare INSTANTS, not rendered text — Postgres renders `+00:00` where
    // the literal above says `Z` (the same comparison rule 119's arm (b) makes
    // for `kickoff_at`).
    expect(lines!.every((l) => Date.parse(l.updated_at ?? '') === Date.parse(STAMP))).toBe(true)
  })

  it('the REAL worker drains the seated lineup and writes a NON-ZERO team_week_results.points', async () => {
    // Ingestion's own payload shape: the stamp, the deferral cleared (122).
    await must(
      service
        .from('score_fanout')
        .upsert(
          [QB, WR].map((player_id) => ({ season: SEASON, week: WEEK, player_id, enqueued_at: STAMP, deferred_until: null })),
          { onConflict: 'season,week,player_id', ignoreDuplicates: false },
        )
        .select('player_id'),
      'score_fanout',
    )

    const report = await runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
    if (report.written === 0) {
      throw new Error(`the drain wrote nothing — problems: ${JSON.stringify(report.problems)}`)
    }

    const result = await must(
      service
        .from('team_week_results')
        .select('points')
        .eq('league_id', leagueId)
        .eq('team_id', unmanagedTeamId)
        .eq('season', SEASON)
        .eq('week', WEEK)
        .maybeSingle(),
      'team_week_results',
    )
    // 200 pass yards (×0.04) + 1 pass TD (×4) + 50 receiving yards (×0.1) = 17.00
    // under the ESPN Standard snapshot. The assertion that matters is > 0: a
    // seated lineup that scores zero is the zero this slice exists to remove.
    expect(Number(result!.points)).toBeGreaterThan(0)
    expect(Number(result!.points)).toBe(17)
  })
})
