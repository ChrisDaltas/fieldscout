/**
 * playoff-bracket.fixtures.ts — the LITERAL bracket documents L.D5.5's pins
 * share (the D62 discipline: goldens as stored literals, in 118's shape —
 * `playoff_bracket_state_internal` / `league_playoff_bracket`, D318(6)).
 * Kept out of the test files so the render suite can import them without
 * re-registering the ops suite's cells.
 *
 * CALENDAR (F215/F226): every instant is a 2099 literal on the synthetic
 * season. `ROLLOVER_AT` is Tuesday 08:00Z — 00:00 in Los Angeles, 02:00 in
 * Chicago, 03:00 in New York: the exact instant Q39 (E) argues about ("for
 * central and eastern timezones it's already hours into Tuesday").
 */
import type { BracketGame, BracketRound, PlayoffBracketDoc, PlayoffPointsRace } from '@/lib/leagues/api/playoffs-service'

export const T = {
  alpha: 'aaaaaaaa-0000-4000-8000-000000000001',
  bravo: 'aaaaaaaa-0000-4000-8000-000000000002',
  charlie: 'aaaaaaaa-0000-4000-8000-000000000003',
  delta: 'aaaaaaaa-0000-4000-8000-000000000004',
  echo: 'aaaaaaaa-0000-4000-8000-000000000005',
  foxtrot: 'aaaaaaaa-0000-4000-8000-000000000006',
} as const

export const BRACKET_NAMES = new Map<string, string>([
  [T.alpha, 'Alpha'],
  [T.bravo, 'Bravo'],
  [T.charlie, 'Charlie'],
  [T.delta, 'Delta'],
  [T.echo, 'Echo'],
  [T.foxtrot, 'Foxtrot'],
])

/** Tuesday 2099-12-15 08:00Z = Mon 12-14 midnight PT · 02:00 CT · 03:00 ET. */
export const ROLLOVER_AT = '2099-12-15T08:00:00+00:00'
export const CORRECTIONS_CLOSE_AT = '2099-12-17T11:00:00+00:00'

const base = {
  league_id: 'league-1',
  season: 2099,
  status: 'in_season',
  schedule_mode: 'h2h',
  playoff_teams: 6,
  regular_season: { first_week: 1, last_week: 14 },
  regular_season_rolled: false,
  regular_season_final: false,
  rollover_week: 14,
  rollover_at: ROLLOVER_AT,
  corrections_close_at: CORRECTIONS_CLOSE_AT,
  champion_team_id: null,
} as const

function week(w: number, status: string): BracketRound['weeks'][number] {
  return { week: w, status, rollover_at: null, corrections_close_at: null }
}

function unbuiltRound(round: number, weeks: number[], expected: number): BracketRound {
  return {
    round,
    weeks: weeks.map((w) => week(w, 'upcoming')),
    rollover_at: null,
    corrections_close_at: null,
    rolled: false,
    built: false,
    final: false,
    source: null,
    prior_stage_rolled: false,
    prior_stage_final: false,
    expected_games: expected,
    foreign_rows: 0,
    games: [],
    survivors: [],
  }
}

/** THE PROJECTED GOLDEN — a 6-team bracket in an 8-team league mid-season:
 *  Alpha and Bravo bye; Charlie(3) v Foxtrot(6); Delta(4) v Echo(5). */
export const PROJECTED_DOC: PlayoffBracketDoc = {
  ...base,
  kind: 'bracket',
  view: 'projected',
  bracket_size: 8,
  rounds: 3,
  weeks_per_round: 1,
  reseed: true,
  playoff_start_week: 15,
  round_list: [unbuiltRound(1, [15], 4), unbuiltRound(2, [16], 2), unbuiltRound(3, [17], 1)],
  next_round: 1,
  entrants_next: null,
  bracket_champion_team_id: null,
  projected_round_1: [
    { home: { team_id: T.alpha, seed: 1, line: 1 }, away: null },
    { home: { team_id: T.bravo, seed: 2, line: 2 }, away: null },
    { home: { team_id: T.charlie, seed: 3, line: 3 }, away: { team_id: T.foxtrot, seed: 6, line: 6 } },
    { home: { team_id: T.delta, seed: 4, line: 4 }, away: { team_id: T.echo, seed: 5, line: 5 } },
  ],
  projection_basis: { projected: true, weeks_final: 8, weeks_projected: 1, seeded: 6, reason: null },
}

/** The same league at week 0: no week played, the seeds are the coin flip's. */
export const PROJECTED_NO_WEEKS_DOC: PlayoffBracketDoc = {
  ...PROJECTED_DOC,
  projection_basis: { projected: true, weeks_final: 0, weeks_projected: 0, seeded: 6, reason: 'no_final_weeks' },
}

/** The projection cannot seed the bracket (a 3-seat table for 6 seats). */
export const PROJECTED_UNSEEDABLE_DOC: PlayoffBracketDoc = {
  ...PROJECTED_DOC,
  projected_round_1: null,
  projection_basis: { projected: true, weeks_final: 1, weeks_projected: 0, seeded: 3, reason: null },
}

/** The regular season has ROLLED but round 1 is not written — the read's
 *  `view` is still `projected` (118 §9: `next_round = 1` and `in_season`). */
export const AWAITING_BUILD_DOC: PlayoffBracketDoc = {
  ...PROJECTED_DOC,
  regular_season_rolled: true,
}

/** …and with a foreign row holding it (D318(5)). */
export const FOREIGN_ROWS_DOC: PlayoffBracketDoc = {
  ...AWAITING_BUILD_DOC,
  round_list: [{ ...unbuiltRound(1, [15], 4), foreign_rows: 1 }, unbuiltRound(2, [16], 2), unbuiltRound(3, [17], 1)],
}

/** The unrecorded rollover: F238's posture — the event, never a clock. */
export const UNRECORDED_ROLLOVER_DOC: PlayoffBracketDoc = { ...PROJECTED_DOC, rollover_at: null }

function game(over: Partial<BracketGame> & Pick<BracketGame, 'home_team_id' | 'home_seed' | 'away_team_id' | 'away_seed' | 'winner_team_id' | 'decided_by'>): BracketGame {
  return { weeks: [], home_total: 0, away_total: 0, final: true, ...over }
}

/**
 * THE BUILT GOLDEN — the 6-team bracket after round 1 FINAL and round 2
 * LIVE, with `playoff_weeks_per_round = 2` on the championship. Round 1:
 * Alpha, Bravo bye; Charlie(3) beat Foxtrot(6) 101.25–98.10 on points;
 * Delta(4) v Echo(5) TIED 90.00–90.00 — the higher seed (Delta) advances
 * with `result` left `tie` (Q39 (A)). Round 2 (reseeded): Alpha(1) v
 * Delta(4) live (Delta's score pending — E61's NULL); Bravo(2) v Charlie(3)
 * live. Round 3: two weeks (16 + 17), unbuilt.
 */
export const BUILT_DOC: PlayoffBracketDoc = {
  ...base,
  status: 'playoffs',
  regular_season_rolled: true,
  regular_season_final: true,
  kind: 'bracket',
  view: 'bracket',
  bracket_size: 8,
  rounds: 3,
  weeks_per_round: 1,
  reseed: true,
  playoff_start_week: 15,
  round_list: [
    {
      round: 1,
      weeks: [week(15, 'final')],
      rollover_at: '2099-12-22T08:00:00+00:00',
      corrections_close_at: '2099-12-24T11:00:00+00:00',
      rolled: true,
      built: true,
      final: true,
      source: 'final',
      prior_stage_rolled: true,
      prior_stage_final: true,
      expected_games: 4,
      foreign_rows: 0,
      games: [
        game({ home_team_id: T.alpha, home_seed: 1, away_team_id: null, away_seed: null, winner_team_id: T.alpha, decided_by: 'bye', weeks: [{ week: 15, matchup_id: 'm-r1-a', home_score: 0, away_score: null, status: 'final', result: null, is_overridden: false }] }),
        game({ home_team_id: T.bravo, home_seed: 2, away_team_id: null, away_seed: null, winner_team_id: T.bravo, decided_by: 'bye', weeks: [{ week: 15, matchup_id: 'm-r1-b', home_score: 0, away_score: null, status: 'final', result: null, is_overridden: false }] }),
        game({
          home_team_id: T.charlie,
          home_seed: 3,
          away_team_id: T.foxtrot,
          away_seed: 6,
          winner_team_id: T.charlie,
          decided_by: 'points',
          home_total: 101.25,
          away_total: 98.1,
          weeks: [{ week: 15, matchup_id: 'm-r1-c', home_score: 101.25, away_score: 98.1, status: 'final', result: 'home', is_overridden: false }],
        }),
        game({
          home_team_id: T.delta,
          home_seed: 4,
          away_team_id: T.echo,
          away_seed: 5,
          winner_team_id: T.delta,
          decided_by: 'higher_seed',
          home_total: 90,
          away_total: 90,
          weeks: [{ week: 15, matchup_id: 'm-r1-d', home_score: 90, away_score: 90, status: 'final', result: 'tie', is_overridden: false }],
        }),
      ],
      survivors: [
        { team_id: T.alpha, seed: 1, line: 1 },
        { team_id: T.bravo, seed: 2, line: 2 },
        { team_id: T.charlie, seed: 3, line: 3 },
        { team_id: T.delta, seed: 4, line: 4 },
      ],
    },
    {
      round: 2,
      weeks: [week(16, 'live')],
      rollover_at: null,
      corrections_close_at: '2099-12-31T11:00:00+00:00',
      rolled: false,
      built: true,
      final: false,
      source: 'final',
      prior_stage_rolled: true,
      prior_stage_final: true,
      expected_games: 2,
      foreign_rows: 0,
      games: [
        game({
          home_team_id: T.alpha,
          home_seed: 1,
          away_team_id: T.delta,
          away_seed: 4,
          winner_team_id: T.alpha,
          decided_by: 'points',
          home_total: 12.5,
          away_total: 0,
          final: false,
          weeks: [{ week: 16, matchup_id: 'm-r2-a', home_score: 12.5, away_score: null, status: 'live', result: null, is_overridden: false }],
        }),
        game({
          home_team_id: T.bravo,
          home_seed: 2,
          away_team_id: T.charlie,
          away_seed: 3,
          winner_team_id: T.charlie,
          decided_by: 'points',
          home_total: 40,
          away_total: 55.75,
          final: false,
          weeks: [{ week: 16, matchup_id: 'm-r2-b', home_score: 40, away_score: 55.75, status: 'live', result: null, is_overridden: true }],
        }),
      ],
      survivors: [
        { team_id: T.alpha, seed: 1, line: 1 },
        { team_id: T.charlie, seed: 3, line: 2 },
      ],
    },
    unbuiltRound(3, [17], 1),
  ],
  next_round: 3,
  entrants_next: [
    { team_id: T.alpha, seed: 1, line: 1 },
    { team_id: T.charlie, seed: 3, line: 2 },
  ],
  bracket_champion_team_id: null,
  projected_round_1: null,
  projection_basis: null,
}

/** Round 2 BUILT but not yet played — its rows `scheduled` into an
 *  `upcoming` week with 109's DEFAULT 0 scores (F273's shape): the view
 *  must show dashes and no verdict, never a 0–0 tie. */
export const BUILT_UNPLAYED_DOC: PlayoffBracketDoc = {
  ...BUILT_DOC,
  round_list: [
    BUILT_DOC.round_list[0],
    {
      ...BUILT_DOC.round_list[1],
      weeks: [week(16, 'upcoming')],
      games: BUILT_DOC.round_list[1].games.map((g) => ({
        ...g,
        home_total: 0,
        away_total: 0,
        decided_by: 'higher_seed' as const,
        winner_team_id: g.home_team_id,
        weeks: g.weeks.map((w) => ({ ...w, home_score: 0, away_score: 0, status: 'scheduled', is_overridden: false })),
      })),
    },
    BUILT_DOC.round_list[2],
  ],
}

/** A two-week championship, FINAL, with the champion STORED: Alpha 80 + 70
 *  = 150.00 v Charlie 95.5 + 54.5 = 150.00 — an equal sum falls to the
 *  higher seed (Q39 (B) → (A); 066 J1's arm). Alpha is champion. */
export const COMPLETE_DOC: PlayoffBracketDoc = {
  ...BUILT_DOC,
  status: 'complete',
  champion_team_id: T.alpha,
  bracket_champion_team_id: T.alpha,
  weeks_per_round: 2,
  next_round: null,
  round_list: [
    BUILT_DOC.round_list[0],
    { ...BUILT_DOC.round_list[1], weeks: [week(16, 'final')], rolled: true, final: true, games: BUILT_DOC.round_list[1].games.map((g) => ({ ...g, final: true })) },
    {
      round: 3,
      weeks: [week(17, 'final'), week(18, 'final')],
      rollover_at: '2100-01-05T08:00:00+00:00',
      corrections_close_at: '2100-01-07T11:00:00+00:00',
      rolled: true,
      built: true,
      final: true,
      source: 'final',
      prior_stage_rolled: true,
      prior_stage_final: true,
      expected_games: 1,
      foreign_rows: 0,
      games: [
        game({
          home_team_id: T.alpha,
          home_seed: 1,
          away_team_id: T.charlie,
          away_seed: 3,
          winner_team_id: T.alpha,
          decided_by: 'higher_seed',
          home_total: 150,
          away_total: 150,
          weeks: [
            { week: 17, matchup_id: 'm-r3-w17', home_score: 80, away_score: 95.5, status: 'final', result: 'away', is_overridden: false },
            { week: 18, matchup_id: 'm-r3-w18', home_score: 70, away_score: 54.5, status: 'final', result: 'home', is_overridden: false },
          ],
        }),
      ],
      survivors: [{ team_id: T.alpha, seed: 1, line: 1 }],
    },
  ],
}

export const POINTS_RACE_DOC: PlayoffPointsRace = {
  ...base,
  schedule_mode: 'total_points',
  playoff_teams: 0,
  kind: 'points_race',
  view: 'points_race',
}

export const NO_PLAYOFFS_DOC: PlayoffPointsRace = {
  ...base,
  playoff_teams: 0,
  kind: 'no_playoffs',
  view: 'no_playoffs',
}

export const NO_PLAYOFFS_COMPLETE_DOC: PlayoffPointsRace = {
  ...NO_PLAYOFFS_DOC,
  status: 'complete',
  regular_season_rolled: true,
  regular_season_final: true,
  champion_team_id: T.bravo,
}
