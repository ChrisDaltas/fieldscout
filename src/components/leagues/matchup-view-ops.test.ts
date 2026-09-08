/**
 * matchup-view-ops.test.ts — L.D5.2's pure pins (spec §11.4, §16.5.3,
 * §16.5.4; PROGRESS D295/D321(4)/Q42). Every decision the matchup view
 * makes over the server's payloads, pinned as stored literals.
 *
 * Probes of the PR: (1) THE DoD's — make `weekBadge('correction_window')`
 * return the `final` state (hide the pending badge while the window is
 * open) → the lifecycle pins here AND the render suite's go red; (2) render
 * a pending starter as `0.00` → the E61 pins; (3) zero-fill a leaderboard
 * absence → the R788 pin.
 */
import { describe, expect, it } from 'vitest'

import type { BoxStarter } from '@/lib/leagues/api/box-score-service'
import type { MatchupRow, TeamWeekResultRow, WeekMatchups } from '@/lib/leagues/api/matchups-service'

import {
  BYE_TITLE,
  NO_MATCHUPS_COPY,
  PENDING_SCORE_COPY,
  PENDING_SCORE_TITLE,
  PLAYING_NO_LINE_TITLE,
  PLAYOFF_ROUND_PENDING_COPY,
  WEEK_NOT_STARTED_TITLE,
  YET_TO_PLAY_TITLE,
  ZERO_BY_NAME_TITLE,
  boxSumCell,
  emptyWeekCopy,
  gameStateLine,
  groupByPhase,
  leaderboardRows,
  lineSummary,
  medianRow,
  resolveWeek,
  resultChip,
  scoreCell,
  secondChip,
  selectedMatchup,
  sideResult,
  splitRows,
  starterCell,
  weekBadge,
  weekFromParam,
  weekNav,
} from './matchup-view-ops'
import { weekStatusBadge } from './schedule-view-ops'

// ---------------------------------------------------------------------------
// Fixtures — stored literals (D62)
// ---------------------------------------------------------------------------

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const T4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const T5 = 'aaaaaaaa-0000-4000-8000-000000000005'

function row(over: Partial<MatchupRow> & Pick<MatchupRow, 'id' | 'home_team_id'>): MatchupRow {
  return {
    season: 2099,
    week: 1,
    round_type: 'regular',
    status: 'live',
    away_team_id: null,
    home_score: null,
    away_score: null,
    result: null,
    is_overridden: false,
    updated_at: null,
    ...over,
  }
}

function result(over: Partial<TeamWeekResultRow> & Pick<TeamWeekResultRow, 'team_id' | 'points'>): TeamWeekResultRow {
  return {
    opponent_team_id: null,
    h2h_result: null,
    median_result: null,
    second_opponent_team_id: null,
    second_result: null,
    is_final: false,
    ...over,
  }
}

const TEAMS = [
  { id: T1, name: 'Alpha', status: 'active' },
  { id: T2, name: 'Bravo', status: 'active' },
  { id: T3, name: 'Charlie', status: 'active' },
  { id: T4, name: 'Delta', status: 'active' },
  { id: T5, name: 'Echo (retired)', status: 'retired' },
]

function doc(over: Partial<WeekMatchups> = {}): WeekMatchups {
  return {
    league_id: 'league-1',
    season: 2099,
    week: 1,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: TEAMS,
    matchups: [],
    results: [],
    ...over,
  }
}

function starter(over: Partial<BoxStarter> = {}): BoxStarter {
  return {
    slot: 'qb:0',
    slot_key: 'qb',
    label: 'QB',
    player: { id: 'p1', full_name: 'P One', position: 'QB', nfl_team: 'AAA' },
    phase: 'up_next',
    game: null,
    points: 0,
    pending: [],
    reason: 'scored',
    line: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// §16.5.4 — the badge lifecycle
// ---------------------------------------------------------------------------

describe('weekBadge — `Final (pending corrections)` → `Final`, driven by league_weeks.status (D295)', () => {
  it('upcoming → Upcoming (stroke)', () => {
    expect(weekBadge('upcoming')).toMatchObject({ state: 'upcoming', label: 'Upcoming', variant: 'stroke' })
  })
  it('live → Live', () => {
    expect(weekBadge('live')).toMatchObject({ state: 'live', label: 'Live' })
  })
  it('correction_window → the PENDING badge, with the §23.4 title — the window is open, corrections still recompute', () => {
    const badge = weekBadge('correction_window')
    expect(badge).toMatchObject({ state: 'pending_corrections', label: 'Final (pending corrections)', variant: 'yellow' })
    expect(badge.title).toContain('§23.4')
  })
  it('final → Final (black), and ONLY final is the final state', () => {
    expect(weekBadge('final')).toMatchObject({ state: 'final', label: 'Final', variant: 'black' })
    for (const status of ['upcoming', 'live', 'correction_window']) {
      expect(weekBadge(status).state, status).not.toBe('final')
    }
  })
  it('the label and variant are the schedule grid’s own (one spelling across the two surfaces)', () => {
    for (const status of ['upcoming', 'live', 'correction_window', 'final', 'nonsense']) {
      const grid = weekStatusBadge(status)
      expect(weekBadge(status)).toMatchObject({ label: grid.label, variant: grid.variant })
    }
  })
})

// ---------------------------------------------------------------------------
// Scores and results
// ---------------------------------------------------------------------------

describe('scoreCell — the door’s NULL is pending, never 0.00 (E61 / R788)', () => {
  it('a number renders to two decimals', () => {
    expect(scoreCell(71.5, 'live')).toEqual({ text: '71.50', title: null, pending: false })
    expect(scoreCell(0, 'live')).toEqual({ text: '0.00', title: null, pending: false })
  })
  it('NULL on a scheduled row is a dash — no score yet', () => {
    expect(scoreCell(null, 'scheduled')).toEqual({ text: '—', title: WEEK_NOT_STARTED_TITLE, pending: false })
  })
  it('NULL on a live or final row is the word pending, with the E61 title', () => {
    for (const status of ['live', 'final']) {
      expect(scoreCell(null, status)).toEqual({ text: PENDING_SCORE_COPY, title: PENDING_SCORE_TITLE, pending: true })
    }
    expect(PENDING_SCORE_TITLE).toContain('never shown as 0.00')
  })
})

describe('resultChip / sideResult — the stored result, never a client comparison', () => {
  it('win / loss / tie / bye map to W / L / T / Bye; null is undecided', () => {
    expect(resultChip('win')).toMatchObject({ text: 'W', variant: 'green', decided: true })
    expect(resultChip('loss')).toMatchObject({ text: 'L', variant: 'pink', decided: true })
    expect(resultChip('tie')).toMatchObject({ text: 'T', decided: true })
    expect(resultChip('bye')).toMatchObject({ text: 'Bye', decided: true })
    expect(resultChip(null)).toMatchObject({ text: '—', decided: false })
  })
  it('a row result `home` / `away` reads from each side; a finalized results row wins over it', () => {
    const r = row({ id: 'm1', home_team_id: T1, away_team_id: T2, result: 'home' })
    expect(sideResult(r, T1, [])).toBe('win')
    expect(sideResult(r, T2, [])).toBe('loss')
    expect(sideResult({ ...r, result: 'away' }, T1, [])).toBe('loss')
    expect(sideResult({ ...r, result: 'tie' }, T1, [])).toBe('tie')
    expect(sideResult({ ...r, result: null }, T1, [])).toBeNull()
    expect(sideResult({ ...r, result: null }, T1, [result({ team_id: T1, points: 1, h2h_result: 'win' })])).toBe('win')
  })
  it('a scored bye row is a bye for its one team', () => {
    expect(sideResult(row({ id: 'b', home_team_id: T3, result: 'home' }), T3, [])).toBe('bye')
  })
  it('a score DIFFERENCE never decides a result on the client — 71.5 vs 35 with result NULL stays undecided', () => {
    const r = row({ id: 'm1', home_team_id: T1, away_team_id: T2, home_score: 71.5, away_score: 35, result: null })
    expect(sideResult(r, T1, [])).toBeNull()
    expect(sideResult(r, T2, [])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The box — the worker's three starter states (D321(4)), rendered
// ---------------------------------------------------------------------------

describe('starterCell — PENDING is the word, never a number (E61)', () => {
  it('a pending starter renders `pending` naming the keys — with points 0 AND with points > 0 alike', () => {
    const a = starterCell(starter({ pending: ['charted_placeholder'], points: 0, phase: 'done' }))
    expect(a).toMatchObject({ text: PENDING_SCORE_COPY, tone: 'pending' })
    expect(a.title).toContain('charted_placeholder')
    const b = starterCell(starter({ pending: ['x'], points: 12.3, phase: 'now_playing' }))
    expect(b.text).toBe(PENDING_SCORE_COPY)
    expect(b.text).not.toContain('12.3')
  })
  it('a scored starter renders his rounded points', () => {
    expect(starterCell(starter({ points: 18.34, phase: 'done' }))).toEqual({ text: '18.34', title: null, tone: 'scored' })
    expect(starterCell(starter({ points: 0, phase: 'done' }))).toEqual({ text: '0.00', title: null, tone: 'scored' })
  })
})

describe('starterCell — NO STAT LINE is the worker’s 0 by name (Q42), said in the title', () => {
  it('in a DONE game: 0.00 with the Q42 reason', () => {
    expect(starterCell(starter({ reason: 'no_stat_row', phase: 'done' }))).toEqual({ text: '0.00', title: ZERO_BY_NAME_TITLE, tone: 'zero_by_name' })
    expect(ZERO_BY_NAME_TITLE).toContain('Q42')
  })
  it('before or during his game: a dash that says it counts as 0 — the same reading, not a different score', () => {
    expect(starterCell(starter({ reason: 'no_stat_row', phase: 'up_next' }))).toEqual({ text: '—', title: YET_TO_PLAY_TITLE, tone: 'yet_to_play' })
    expect(starterCell(starter({ reason: 'no_stat_row', phase: 'now_playing' }))).toEqual({ text: '—', title: PLAYING_NO_LINE_TITLE, tone: 'yet_to_play' })
    for (const title of [YET_TO_PLAY_TITLE, PLAYING_NO_LINE_TITLE]) expect(title).toMatch(/counts as 0.*Q42/)
  })
  it('a bye scores 0 by §11.2’s own reading', () => {
    expect(starterCell(starter({ reason: 'no_stat_row', phase: 'bye' }))).toEqual({ text: '0.00', title: BYE_TITLE, tone: 'bye' })
  })
  it('an empty seat and an unknown player are dashes with their reasons, never 0.00', () => {
    expect(starterCell(starter({ reason: 'empty', player: null })).text).toBe('—')
    expect(starterCell(starter({ reason: 'unknown_player' })).text).toBe('—')
  })
})

describe('boxSumCell — the worker’s NULL (any starter pending) is pending', () => {
  it('a number renders; NULL names the pending keys', () => {
    expect(boxSumCell({ points: 101.02, pending: [] })).toEqual({ text: '101.02', title: null, pending: false })
    const cell = boxSumCell({ points: null, pending: [{ player_id: 'p1', keys: ['k1', 'k2'] }] })
    expect(cell.text).toBe(PENDING_SCORE_COPY)
    expect(cell.title).toContain('k1, k2')
  })
})

describe('groupByPhase — Live Mode’s Now playing / Done / Up next (§11.4), byes their own', () => {
  it('groups in the fixed order, empty groups omitted, slot order kept within a group', () => {
    const groups = groupByPhase([
      starter({ slot: 'qb:0', phase: 'up_next' }),
      starter({ slot: 'rb:0', phase: 'done' }),
      starter({ slot: 'rb:1', phase: 'now_playing' }),
      starter({ slot: 'wr:0', phase: 'done' }),
      starter({ slot: 'te:0', phase: 'bye' }),
    ])
    expect(groups.map((g) => [g.label, g.starters.map((s) => s.slot)])).toEqual([
      ['Now playing', ['rb:1']],
      ['Done', ['rb:0', 'wr:0']],
      ['Up next', ['qb:0']],
      ['Bye', ['te:0']],
    ])
  })
  it('an empty lineup groups to nothing', () => {
    expect(groupByPhase([])).toEqual([])
  })
})

describe('lineSummary / gameStateLine — stored values, glanceable', () => {
  it('non-zero headline stats only', () => {
    expect(lineSummary({ pass_yards: 212, pass_tds: 2, interceptions: 0, rush_yards: 14 })).toBe('212 pass yds · 2 pass TD · 14 rush yds')
    expect(lineSummary(null)).toBe('')
    expect(lineSummary({})).toBe('')
  })
  it('a live game renders the provider’s quarter / clock / score; a final one says Final; a scheduled one the pairing', () => {
    const game = { id: 'g', status: 'live', home_team: 'AAA', away_team: 'BBB', home_score: 14, away_score: 10, quarter: 3, game_clock: '7:12', kickoff_at: '2099-09-13T17:00:00Z' }
    expect(gameStateLine(game)).toBe('BBB 10 – AAA 14 · Q3 7:12')
    expect(gameStateLine({ ...game, status: 'final', home_score: 24, away_score: 17 })).toBe('Final · BBB 17 – AAA 24')
    expect(gameStateLine({ ...game, status: 'scheduled', home_score: null, away_score: null })).toBe('BBB @ AAA')
    expect(gameStateLine(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

describe('resolveWeek / weekNav / weekFromParam — the page’s week is a stored fact, never a clock', () => {
  const weeks = [
    { week: 3, status: 'final' },
    { week: 4, status: 'live' },
    { week: 5, status: 'upcoming' },
  ]
  it('a matchup id names its own week through the ladder', () => {
    expect(resolveWeek({ matchupId: 'm5', weekParam: 3, weeks, matchups: [{ id: 'm5', week: 5 }] })).toBe(5)
  })
  it('an unknown id falls through to ?week=, then to the ladder’s current week (the greatest started week)', () => {
    expect(resolveWeek({ matchupId: 'nope', weekParam: 3, weeks, matchups: [] })).toBe(3)
    expect(resolveWeek({ matchupId: null, weekParam: null, weeks, matchups: [] })).toBe(4)
  })
  it('an unknown ladder with nothing else named is null (skeleton), an EMPTY ladder is null too (no schedule yet)', () => {
    expect(resolveWeek({ matchupId: null, weekParam: null, weeks: undefined, matchups: undefined })).toBeNull()
    expect(resolveWeek({ matchupId: null, weekParam: null, weeks: [], matchups: [] })).toBeNull()
  })
  it('prev/next walk the ladder’s own weeks', () => {
    expect(weekNav(weeks, 4)).toEqual({ prev: 3, next: 5 })
    expect(weekNav(weeks, 3)).toEqual({ prev: null, next: 4 })
    expect(weekNav(weeks, 5)).toEqual({ prev: 4, next: null })
  })
  it('?week= is an integer 1–18 or nothing', () => {
    expect(weekFromParam('7')).toBe(7)
    expect(weekFromParam(['2', '9'])).toBe(2)
    for (const bad of ['0', '19', '1.5', 'x', '', undefined]) expect(weekFromParam(bad)).toBeNull()
  })
})

describe('splitRows / selectedMatchup — the URL’s row, else mine, else the first', () => {
  const primary = [
    row({ id: 'm1', home_team_id: T1, away_team_id: T2 }),
    row({ id: 'm2', home_team_id: T3, away_team_id: T4 }),
  ]
  const secondary = [row({ id: 's1', home_team_id: T1, away_team_id: T3, round_type: 'secondary' })]
  it('secondary rows are split off', () => {
    expect(splitRows([...primary, ...secondary])).toEqual({ primary, secondary })
  })
  it('selection order', () => {
    expect(selectedMatchup(primary, 'm2', T1)?.id).toBe('m2')
    expect(selectedMatchup(primary, 'zzz', T4)?.id).toBe('m2')
    expect(selectedMatchup(primary, null, null)?.id).toBe('m1')
    expect(selectedMatchup([], 'm1', T1)).toBeNull()
  })
})

describe('emptyWeekCopy — by reason', () => {
  const weeks = [{ week: 1 }, { week: 2 }, { week: 3 }, { week: 4 }]
  it('a playoff week before its round exists names the rollover; a regular week says none on record', () => {
    expect(emptyWeekCopy(4, weeks, 3)).toBe(PLAYOFF_ROUND_PENDING_COPY)
    expect(emptyWeekCopy(2, weeks, 3)).toBe(NO_MATCHUPS_COPY)
    expect(emptyWeekCopy(2, [], 3)).toBe(NO_MATCHUPS_COPY)
  })
})

// ---------------------------------------------------------------------------
// §16.5.3 variants
// ---------------------------------------------------------------------------

describe('medianRow — the second row with its OWN chip (§16.5.3), off unless median_game', () => {
  it('null when the setting is off', () => {
    expect(medianRow(doc(), T1, false)).toBeNull()
  })
  it('the stored median (NULL until finalization) and the team’s stored median_result', () => {
    expect(medianRow(doc(), T1, true)).toEqual({ median: null, result: null })
    const d = doc({
      league_week: { status: 'final', median_score: 97.63, finalized_at: '2099-09-18T10:05:00Z' },
      results: [result({ team_id: T1, points: 101.02, median_result: 'win' }), result({ team_id: T2, points: 90, median_result: 'loss' })],
    })
    expect(medianRow(d, T1, true)).toEqual({ median: 97.63, result: 'win' })
    expect(medianRow(d, T2, true)).toEqual({ median: 97.63, result: 'loss' })
  })
})

describe('secondChip — the second opponent’s chip (§16.5.3), off unless second_opponent', () => {
  it('null when the setting is off', () => {
    expect(secondChip(doc(), T1, false)).toBeNull()
  })
  it('live: the secondary row’s scores from the team’s side, no result yet', () => {
    const d = doc({ matchups: [row({ id: 's1', home_team_id: T3, away_team_id: T1, round_type: 'secondary', home_score: 88, away_score: 91.5 })] })
    expect(secondChip(d, T1, true)).toEqual({ opponent_team_id: T3, score: 91.5, opponent_score: 88, result: null })
  })
  it('final: the results row’s second_opponent + second_result win', () => {
    const d = doc({
      matchups: [row({ id: 's1', home_team_id: T3, away_team_id: T1, round_type: 'secondary', home_score: 88, away_score: 91.5, result: 'away' })],
      results: [result({ team_id: T1, points: 91.5, second_opponent_team_id: T3, second_result: 'win' })],
    })
    expect(secondChip(d, T1, true)).toMatchObject({ opponent_team_id: T3, result: 'win' })
  })
  it('a live secondary row with a stored result reads it from the side', () => {
    const d = doc({ matchups: [row({ id: 's1', home_team_id: T3, away_team_id: T1, round_type: 'secondary', result: 'home' })] })
    expect(secondChip(d, T1, true)?.result).toBe('loss')
    expect(secondChip(d, T3, true)?.result).toBe('win')
  })
})

describe('leaderboardRows — the total_points week (§16.5.3): stored points, ranked; absence is PENDING, never 0 (R788 / F241(b))', () => {
  it('ranks seated teams by stored points; a team with no results row is pending at the bottom, unranked; a retired franchise is not a row', () => {
    const d = doc({
      schedule_mode: 'total_points',
      results: [result({ team_id: T1, points: 101.02 }), result({ team_id: T2, points: 120.5, is_final: true }), result({ team_id: T3, points: 101.02 })],
    })
    expect(leaderboardRows(d)).toEqual([
      { rank: 1, team_id: T2, name: 'Bravo', points: 120.5, is_final: true },
      { rank: 2, team_id: T1, name: 'Alpha', points: 101.02, is_final: false },
      { rank: 2, team_id: T3, name: 'Charlie', points: 101.02, is_final: false },
      { rank: null, team_id: T4, name: 'Delta', points: null, is_final: false },
    ])
  })
  it('a week with no rows at all is every seated team pending', () => {
    const rows = leaderboardRows(doc({ schedule_mode: 'total_points' }))
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.points === null && r.rank === null)).toBe(true)
  })
  it('ties share a rank and the next rank skips (1, 1, 3)', () => {
    const d = doc({
      results: [result({ team_id: T1, points: 50 }), result({ team_id: T2, points: 50 }), result({ team_id: T3, points: 40 }), result({ team_id: T4, points: 30 })],
    })
    expect(leaderboardRows(d).map((r) => r.rank)).toEqual([1, 1, 3, 4])
  })
})
