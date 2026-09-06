/**
 * standings-schedule.fixtures.ts — the LITERAL fixtures L.D5.3's pins share
 * (the D62 discipline: goldens as stored literals). Kept out of the test
 * files so the render suite can import them without re-registering the ops
 * suites' cells.
 */
import type { LeagueSchedule, ScheduleMatchup } from '@/hooks/use-schedule'
import type { LeagueStandings, StandingsRow } from '@/lib/leagues/api/standings-service'

/** A row in 117's shape. */
export function standingsRow(
  over: Partial<StandingsRow> & Pick<StandingsRow, 'rank' | 'team_id' | 'name'>,
): StandingsRow {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    games: 0,
    win_pct: 0,
    points_for: 0,
    points_against: 0,
    weeks: 0,
    h2h_record: { wins: 0, losses: 0, ties: 0 },
    median_record: { wins: 0, losses: 0, ties: 0 },
    second_record: { wins: 0, losses: 0, ties: 0 },
    separated_by: null,
    ...over,
  }
}

/**
 * THE GOLDEN — stored literals (the D62 discipline). Four teams after three
 * final weeks: T1 leads on Win %; T2 and T3 are tied on Win % AND PF and
 * T2 is placed by head_to_head; T4 trails T3 on PF. Every separator is
 * 117's word for the entry that placed the row.
 */
export const GOLDEN_STANDINGS: LeagueStandings = {
  league_id: 'league-1',
  season: 2099,
  schedule_mode: 'h2h',
  regular_season: { first_week: 1, last_week: 14 },
  weeks_final: 3,
  chain: [
    { entry: 'win_pct', status: 'applied', reason: null },
    { entry: 'points_for', status: 'applied', reason: null },
    { entry: 'head_to_head', status: 'applied', reason: 'clean_two_team_ties_only' },
    { entry: 'points_against', status: 'applied', reason: null },
    { entry: 'division_record', status: 'inert', reason: 'divisions_pinned_at_1' },
    { entry: 'coin_flip', status: 'applied', reason: null },
  ],
  chain_appended: [],
  coin_flip_seed: '424242',
  coin_flip_seed_source: 'schedule_seed',
  skipped: [],
  pa_gaps: [],
  standings: [
    standingsRow({
      rank: 1,
      team_id: 't1',
      name: 'Alpha',
      wins: 3,
      losses: 0,
      ties: 0,
      games: 3,
      win_pct: 1,
      points_for: 310.5,
      points_against: 240.25,
      weeks: 3,
      separated_by: null,
    }),
    standingsRow({
      rank: 2,
      team_id: 't2',
      name: 'Bravo',
      wins: 2,
      losses: 1,
      ties: 0,
      games: 3,
      win_pct: 0.6667,
      points_for: 280,
      points_against: 250,
      weeks: 3,
      separated_by: 'win_pct',
    }),
    standingsRow({
      rank: 3,
      team_id: 't3',
      name: 'Charlie',
      wins: 2,
      losses: 1,
      ties: 0,
      games: 3,
      win_pct: 0.6667,
      points_for: 280,
      points_against: 300,
      weeks: 3,
      separated_by: 'head_to_head',
    }),
    standingsRow({
      rank: 4,
      team_id: 't4',
      name: 'Delta',
      wins: 0,
      losses: 3,
      ties: 0,
      games: 3,
      win_pct: 0,
      points_for: 190.75,
      points_against: 270.5,
      weeks: 3,
      separated_by: 'win_pct',
    }),
  ],
  reason: null,
}

export const NAMES = new Map([
  ['t1', 'Alpha'],
  ['t2', 'Bravo'],
  ['t3', 'Charlie'],
  ['t4', 'Delta'],
])

export function matchup(
  over: Partial<ScheduleMatchup> &
    Pick<ScheduleMatchup, 'id' | 'week' | 'home_team_id' | 'away_team_id'>,
): ScheduleMatchup {
  return {
    season: 2099,
    round_type: 'regular',
    status: 'scheduled',
    home_score: null,
    away_score: null,
    result: null,
    is_overridden: false,
    ...over,
  }
}

/** A 4-team season: weeks 1–3 regular (regular_season_weeks = 3), week 4 a
 *  playoff week with no rows yet; week 1 final, week 2 live, week 3 upcoming. */
export const SCHEDULE: LeagueSchedule = {
  weeks: [
    {
      id: 'w1',
      season: 2099,
      week: 1,
      status: 'final',
      finalized_at: '2099-09-16T00:00:00Z',
      median_score: 101.5,
    },
    { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
    { id: 'w3', season: 2099, week: 3, status: 'upcoming', finalized_at: null, median_score: null },
    { id: 'w4', season: 2099, week: 4, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [
    matchup({
      id: 'm1',
      week: 1,
      home_team_id: 't1',
      away_team_id: 't2',
      status: 'final',
      home_score: 120.5,
      away_score: 99,
      result: 'home',
    }),
    matchup({
      id: 'm2',
      week: 1,
      home_team_id: 't3',
      away_team_id: 't4',
      status: 'final',
      home_score: 80,
      away_score: 80,
      result: 'tie',
      is_overridden: true,
    }),
    matchup({
      id: 'm3',
      week: 2,
      home_team_id: 't1',
      away_team_id: 't3',
      status: 'live',
      home_score: 40.25,
      away_score: null,
    }),
    matchup({
      id: 'm4',
      week: 2,
      home_team_id: 't2',
      away_team_id: 't4',
      status: 'live',
      home_score: 10,
      away_score: 12,
    }),
    matchup({ id: 'm5', week: 3, home_team_id: 't1', away_team_id: 't4' }),
    matchup({ id: 'm6', week: 3, home_team_id: 't2', away_team_id: 't3' }),
    matchup({ id: 'm7', week: 3, home_team_id: 't1', away_team_id: 't2', round_type: 'secondary' }),
    matchup({ id: 'm8', week: 3, home_team_id: 't3', away_team_id: 't4', round_type: 'secondary' }),
  ],
}
