/**
 * dev-drive-inseason-week.ts — drive the L.D5.1/L.D5.3 LOCAL fixture league
 * (`dev-seed-inseason-league.ts`) through ONE scored week, for the matchup
 * view's browser pass (M4 task L.D5.2; tasks-M4 §6 L.D5.2 item 3: "a driven
 * score batch moves the live number; the pending-corrections badge flips at
 * finalize (harness-driven `p_now`)"; PROGRESS D323).
 *
 *   npx tsx scripts/dev-seed-inseason-league.ts          # first
 *   npx tsx scripts/dev-drive-inseason-week.ts --open     # week 1 upcoming → live (league_week_advance, p_now = starts_at + 1 min)
 *   npx tsx scripts/dev-drive-inseason-week.ts --lineup   # the dev team's week-1 slot_map (direct row — the 2001 kickoff would refuse set_lineup)
 *   npx tsx scripts/dev-drive-inseason-week.ts --games    # game rows: LDB live · LDA final (new row) · LDD scheduled → Now playing / Done / Up next
 *   npx tsx scripts/dev-drive-inseason-week.ts --score 1  # plant stat lines × N, enqueue, run the REAL worker (runScoreWeekBatch) scoped to the league
 *   npx tsx scripts/dev-drive-inseason-week.ts --score 2  # …again with bigger lines: the live number MOVES
 *   npx tsx scripts/dev-drive-inseason-week.ts --window   # every game final + last_game_ends_at recorded → league_week_advance → correction_window
 *   npx tsx scripts/dev-drive-inseason-week.ts --finalize # finalize_matchups(p_now = correction_window_ends_at + 1 min) → final
 *   npx tsx scripts/dev-seed-inseason-league.ts --teardown # after (F199)
 *
 * Every instant is INJECTED (`p_now` — D291) from the synthetic calendar's
 * own stored literals (2099 week 1: starts 09-09 04:00Z, window closes
 * 09-17 10:00Z); the wall clock decides nothing here except the report
 * stamp the worker prints. The scoring is the production worker itself
 * (`runScoreWeekBatch` over a service client — the queue is service-role-
 * only, 109; the door refuses a JWT, 119), never a hand-written UPDATE of
 * `matchups`: the number the page shows moved because the pipeline moved
 * it.
 *
 * LOCAL ONLY — refuses any URL that is not the local stack (the seeder's
 * guard, verbatim). Idempotent per step.
 */
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'
import { runScoreWeekBatch } from '../src/lib/leagues/scoring/score-week-worker'
import { SYNTHETIC_SEASON } from '../src/lib/leagues/sim/synthetic-season'
import { systemTime } from '../src/lib/leagues/time/time-provider'

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`refusing: ${URL} is not the local stack (this driver is LOCAL ONLY)`)
  process.exit(2)
}

const LEAGUE_NAME = 'L.D5.1 dev fixture league'
const WEEK = 1
const GAME_LOCKED_ID = 'dev-ld51-game-locked' // LDB — the locked RB's team
const GAME_OPEN_ID = 'dev-ld51-game-open' // LDD — WR A's team
const GAME_FINAL_ID = 'dev-ld52-game-final' // LDA — the QB's team (this driver's row; the seeder cleans it)
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

const service = createClient<Database>(URL, SERVICE_KEY, { auth: { persistSession: false } })

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

async function fixture() {
  const league = must(await service.from('leagues').select('id, season').eq('name', LEAGUE_NAME).maybeSingle(), 'league read')
  if (!league) throw new Error(`no "${LEAGUE_NAME}" — run npx tsx scripts/dev-seed-inseason-league.ts first`)
  const devTeam = must(await service.from('teams').select('id, owner_id').eq('league_id', league.id).eq('name', 'Dev Fixture FC').single(), 'dev team read')
  const week = must(
    await service.from('nfl_weeks').select('starts_at, last_game_ends_at, correction_window_ends_at').eq('season', SYNTHETIC_SEASON).eq('week', WEEK).single(),
    'nfl_weeks read',
  )
  if (!devTeam || !week) throw new Error('fixture incomplete — re-run the seeder')
  return { leagueId: league.id, devTeamId: devTeam.id, week }
}

async function state(leagueId: string) {
  const lw = must(await service.from('league_weeks').select('status, median_score, finalized_at').eq('league_id', leagueId).eq('week', WEEK).single(), 'league_weeks read')
  const rows = must(
    await service.from('matchups').select('id, round_type, status, home_team_id, away_team_id, home_score, away_score, result').eq('league_id', leagueId).eq('week', WEEK).order('id'),
    'matchups read',
  )
  const results = must(await service.from('team_week_results').select('team_id, points, is_final, h2h_result').eq('league_id', leagueId).eq('week', WEEK), 'results read')
  return { league_week: lw, matchups: rows, results }
}

async function open(): Promise<void> {
  const { leagueId, week } = await fixture()
  const pNow = new Date(Date.parse(week.starts_at) + MINUTE_MS).toISOString()
  const report = must(await service.rpc('league_week_advance', { p_now: pNow, p_league_id: leagueId }), 'league_week_advance (open)')
  console.log(JSON.stringify({ step: 'open', p_now: pNow, report }, null, 2))
}

async function lineup(): Promise<void> {
  const { leagueId, devTeamId } = await fixture()
  const slotMap = {
    'qb:0': 'dev-ld51-qb',
    'rb:0': 'dev-ld51-rb-locked',
    'rb:1': 'dev-ld51-rb-open',
    'wr:0': 'dev-ld51-wr-a',
    'wr:1': 'dev-ld51-wr-b',
    'wr:2': 'dev-ld51-wr-c',
    'te:0': 'dev-ld51-te',
    'k:0': 'dev-ld51-k',
    'dst:0': 'dev-ld51-dst',
    // flex:0 left EMPTY on purpose — the empty-seat state.
  }
  const rows = must(
    await service
      .from('team_lineups')
      .upsert({ team_id: devTeamId, season: SYNTHETIC_SEASON, week: WEEK, starters: [], bench: [], slot_map: slotMap }, { onConflict: 'team_id,season,week' })
      .select('id'),
    'team_lineups upsert',
  )
  if ((rows ?? []).length !== 1) throw new Error(`team_lineups upsert wrote ${(rows ?? []).length} rows`)
  console.log(JSON.stringify({ step: 'lineup', leagueId, devTeamId, slot_map: slotMap }, null, 2))
}

async function games(): Promise<void> {
  must(await service.from('nfl_games').update({ status: 'live', quarter: 3, game_clock: '7:12', home_score: 14, away_score: 10 }).eq('id', GAME_LOCKED_ID).select('id'), 'game live')
  must(await service.from('nfl_games').update({ status: 'scheduled' }).eq('id', GAME_OPEN_ID).select('id'), 'game scheduled')
  must(
    await service
      .from('nfl_games')
      .upsert({ id: GAME_FINAL_ID, season: SYNTHETIC_SEASON, week: WEEK, home_team: 'LDA', away_team: 'ZZX', kickoff_at: KICKOFF_PAST, status: 'final', home_score: 24, away_score: 17 })
      .select('id'),
    'game final',
  )
  console.log(JSON.stringify({ step: 'games', live: GAME_LOCKED_ID, final: GAME_FINAL_ID, scheduled: GAME_OPEN_ID }, null, 2))
}

async function score(scale: number): Promise<void> {
  const { leagueId } = await fixture()
  const stamp = systemTime.now().toISOString()
  const lines = [
    { player_id: 'dev-ld51-qb', pass_yards: 250 * scale, pass_tds: 2 * scale, interceptions: 1, rush_yards: 12 },
    { player_id: 'dev-ld51-rb-locked', rush_yards: 61 * scale, rush_tds: 1 * scale, receptions: 3, receiving_yards: 20 },
    { player_id: 'dev-ld51-wr-a', receptions: 6, receiving_yards: 84 * scale, receiving_tds: 1 },
  ]
  must(
    await service
      .from('player_stats')
      .upsert(
        lines.map((l) => ({ ...l, season: SYNTHETIC_SEASON, week: WEEK, stat_type: 'weekly', updated_at: stamp, advanced: {} })),
        { onConflict: 'player_id,season,week' },
      )
      .select('player_id'),
    'player_stats upsert',
  )
  must(
    await service
      .from('score_fanout')
      .upsert(
        lines.map((l) => ({ season: SYNTHETIC_SEASON, week: WEEK, player_id: l.player_id, enqueued_at: stamp, deferred_until: null })),
        { onConflict: 'season,week,player_id', ignoreDuplicates: false },
      )
      .select('player_id'),
    'score_fanout enqueue',
  )
  const report = await runScoreWeekBatch({ time: systemTime, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
  console.log(JSON.stringify({ step: 'score', scale, stamp, report: { drained: report.drained, leagues: report.leagues, problems: report.problems }, after: await state(leagueId) }, null, 2))
}

async function window(): Promise<void> {
  const { leagueId, week } = await fixture()
  const lastEnd = new Date(Date.parse(week.starts_at) + 5 * DAY_MS).toISOString()
  must(await service.from('nfl_games').update({ status: 'final' }).eq('season', SYNTHETIC_SEASON).eq('week', WEEK).select('id'), 'games final')
  must(await service.from('nfl_weeks').update({ last_game_ends_at: lastEnd }).eq('season', SYNTHETIC_SEASON).eq('week', WEEK).select('week'), 'nfl_weeks last_game_ends_at')
  const pNow = new Date(Date.parse(lastEnd) + MINUTE_MS).toISOString()
  const report = must(await service.rpc('league_week_advance', { p_now: pNow, p_league_id: leagueId }), 'league_week_advance (close)')
  console.log(JSON.stringify({ step: 'window', last_game_ends_at: lastEnd, p_now: pNow, report, after: await state(leagueId) }, null, 2))
}

async function finalize(): Promise<void> {
  const { leagueId, week } = await fixture()
  if (!week.correction_window_ends_at) throw new Error('nfl_weeks 2099 week 1 has no correction_window_ends_at — re-run the seeder')
  const pNow = new Date(Date.parse(week.correction_window_ends_at) + MINUTE_MS).toISOString()
  const report = must(await service.rpc('finalize_matchups', { p_now: pNow, p_league_id: leagueId }), 'finalize_matchups')
  console.log(JSON.stringify({ step: 'finalize', p_now: pNow, report, after: await state(leagueId) }, null, 2))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--open')) return open()
  if (args.includes('--lineup')) return lineup()
  if (args.includes('--games')) return games()
  const scoreAt = args.indexOf('--score')
  if (scoreAt !== -1) return score(Number(args[scoreAt + 1] ?? '1'))
  if (args.includes('--window')) return window()
  if (args.includes('--finalize')) return finalize()
  if (args.includes('--state')) {
    const { leagueId } = await fixture()
    console.log(JSON.stringify(await state(leagueId), null, 2))
    return
  }
  console.error('usage: --open | --lineup | --games | --score <scale> | --window | --finalize | --state')
  process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
