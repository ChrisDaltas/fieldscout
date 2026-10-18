/**
 * The NFL game screen's box score (gap list §3 #17): which stored lines
 * belong to the game, how they group and order, and the game's own state in
 * the design's words. Nothing here scores — every cell is a stored column.
 */
import { describe, expect, it } from 'vitest'

import {
  boxGroups,
  emptyBoxCopy,
  gameIdFromSegment,
  gameStatus,
  lineInGame,
  listedByCurrentTeam,
  nflGameHref,
  scoreText,
  type GameBoxLine,
  type GameBoxPlayer,
  type NflGameRow,
} from './game-ops'

const GAME: NflGameRow = {
  id: 'g-cin-mia',
  season: 2099,
  week: 5,
  away_team: 'CIN',
  home_team: 'MIA',
  kickoff_at: '2099-10-11T17:00:00Z',
  status: 'live',
  away_score: 28,
  home_score: 18,
  quarter: 4,
  game_clock: '2:19',
}

const P = (id: string, full_name: string, position: string, team: string | null): GameBoxPlayer => ({ id, full_name, position, team })
const PLAYERS = [
  P('burrow', 'Joe Burrow', 'QB', 'CIN'),
  P('tua', 'Tua Tagovailoa', 'QB', 'MIA'),
  P('brown', 'Chase Brown', 'RB', 'CIN'),
  P('achane', "De'Von Achane", 'RB', 'MIA'),
  P('chase', "Ja'Marr Chase", 'WR', 'CIN'),
  P('higgins', 'Tee Higgins', 'WR', 'CIN'),
  P('hill', 'Tyreek Hill', 'WR', 'MIA'),
  P('sanders', 'Jason Sanders', 'K', 'MIA'),
  P('MIA', 'Miami Dolphins', 'DEF', 'MIA'),
  P('bench', 'Sat Out', 'WR', 'CIN'),
]
const L = (player_id: string, cols: Partial<GameBoxLine> = {}): GameBoxLine => ({ player_id, game_id: null, ...cols })
const LINES: GameBoxLine[] = [
  // Home QB listed first in the read: the box still puts the away side first.
  L('tua', { pass_completions: 19, pass_attempts: 28, pass_yards: 201, pass_tds: 1, interceptions: 1 }),
  L('burrow', { pass_completions: 24, pass_attempts: 31, pass_yards: 288, pass_tds: 2, interceptions: 0, rush_attempts: 2, rush_yards: 6, rush_tds: 0 }),
  L('brown', { rush_attempts: 16, rush_yards: 64, rush_tds: 1, receptions: 2, targets: 3, receiving_yards: 11, receiving_tds: 0 }),
  L('achane', { rush_attempts: 14, rush_yards: 71, rush_tds: 0 }),
  L('higgins', { receptions: 5, targets: 7, receiving_yards: 74, receiving_tds: 1 }),
  L('chase', { receptions: 9, targets: 11, receiving_yards: 132, receiving_tds: 1 }),
  L('hill', { receptions: 6, targets: 9, receiving_yards: 88, receiving_tds: 0 }),
  L('sanders', { fg_made: 2, fg_attempted: 3, xp_made: 2, xp_attempted: 2 }),
  L('MIA', { def_sacks: 2, def_interceptions: 0, def_fumble_recoveries: 1, def_tds: 0 }),
  // A line with no numbers in any group shows nowhere.
  L('bench', { pass_yards: 0, rush_yards: 0, receiving_yards: 0 }),
]

const groupOf = (key: string) => boxGroups(GAME, PLAYERS, LINES).find((g) => g.key === key)
const rowsOf = (key: string) => groupOf(key)?.rows.map((r) => [r.name, ...r.cells]) ?? []

describe('the box score groups', () => {
  it('has the design’s three groups with its columns, then Kicking and Defense', () => {
    const groups = boxGroups(GAME, PLAYERS, LINES)
    expect(groups.map((g) => [g.title, ...g.cols])).toEqual([
      ['Passing', 'C/Att', 'Yds', 'TD', 'Int'],
      ['Rushing', 'Car', 'Yds', 'TD'],
      ['Receiving', 'Rec', 'Yds', 'TD'],
      ['Kicking', 'FG', 'XP'],
      ['Defense', 'Sacks', 'Int', 'FR', 'TD'],
    ])
  })

  it('prints stored columns as they are — "J. Burrow · CIN 24/31, 288, 2, 0" — away side first', () => {
    expect(rowsOf('passing')).toEqual([
      ['J. Burrow · CIN', '24/31', '288', '2', '0'],
      ['T. Tagovailoa · MIA', '19/28', '201', '1', '1'],
    ])
  })

  it('orders each side by the group’s yards, the away team before the home team', () => {
    expect(rowsOf('rushing')).toEqual([
      ['C. Brown · CIN', '16', '64', '1'],
      ['J. Burrow · CIN', '2', '6', '0'],
      ['D. Achane · MIA', '14', '71', '0'],
    ])
    expect(rowsOf('receiving')).toEqual([
      ['J. Chase · CIN', '9', '132', '1'],
      ['T. Higgins · CIN', '5', '74', '1'],
      ['C. Brown · CIN', '2', '11', '0'],
      ['T. Hill · MIA', '6', '88', '0'],
    ])
  })

  it('kicking reads made/attempted; a D/ST keeps its full name', () => {
    expect(rowsOf('kicking')).toEqual([['J. Sanders · MIA', '2/3', '2/2']])
    expect(rowsOf('defense')).toEqual([['Miami Dolphins · MIA', '2', '0', '1', '0']])
  })

  it('a column the line doesn’t carry reads "–", never a guessed 0', () => {
    const groups = boxGroups(GAME, PLAYERS, [L('burrow', { pass_yards: 250, pass_tds: 2 })])
    expect(groups.map((g) => g.key)).toEqual(['passing'])
    expect(groups[0]!.rows[0]!.cells).toEqual(['–', '250', '2', '–'])
  })

  it('each row names its columns for a screen reader', () => {
    expect(groupOf('passing')!.rows[0]!.label).toBe('J. Burrow, CIN: 24/31 C/Att, 288 Yds, 2 TD, 0 Int')
  })

  it('no lines, or none with numbers, is no groups', () => {
    expect(boxGroups(GAME, PLAYERS, [])).toEqual([])
    expect(boxGroups(GAME, PLAYERS, [L('bench', { pass_yards: 0 })])).toEqual([])
  })

  it('a held game (moved out of the week / cancelled) shows no lines — its players score 0', () => {
    expect(boxGroups({ ...GAME, operator_hold: 'cancelled' }, PLAYERS, LINES)).toEqual([])
    expect(boxGroups({ ...GAME, operator_hold: 'out_of_week' }, PLAYERS, LINES)).toEqual([])
    // An in-week mark is not a hold that zeroes anyone.
    expect(boxGroups({ ...GAME, operator_hold: 'in_week' }, PLAYERS, LINES).length).toBe(5)
  })
})

describe('which line is this game’s (the held-games rule)', () => {
  it('a line naming a game belongs to that game only', () => {
    expect(lineInGame({ game_id: 'g-cin-mia' }, { team: 'BUF' }, GAME)).toBe(true)
    expect(lineInGame({ game_id: 'g-other' }, { team: 'CIN' }, GAME)).toBe(false)
  })

  it('a line with no game id belongs to the game his current team plays in', () => {
    expect(lineInGame({ game_id: null }, { team: 'CIN' }, GAME)).toBe(true)
    expect(lineInGame({ game_id: null }, { team: 'MIA' }, GAME)).toBe(true)
    expect(lineInGame({ game_id: null }, { team: 'BUF' }, GAME)).toBe(false)
    expect(lineInGame({ game_id: null }, { team: null }, GAME)).toBe(false)
    expect(lineInGame({ game_id: null }, undefined, GAME)).toBe(false)
  })

  it('the box drops a line that names another game (he played elsewhere that week)', () => {
    const groups = boxGroups(GAME, PLAYERS, [L('chase', { game_id: 'g-other', receptions: 3, receiving_yards: 30 })])
    expect(groups).toEqual([])
  })

  // No line carries the team it was earned for: a player who has changed
  // teams since that week shows under his CURRENT team's game. Pinned so a
  // fix to ingest (lines naming their game) is a visible change here.
  it('a no-game-id line follows his current team, even for a past week', () => {
    const moved = [P('wr', 'Moved Receiver', 'WR', 'BUF')] // played that week for CIN
    expect(boxGroups(GAME, moved, [L('wr', { receptions: 4, receiving_yards: 40 })])).toEqual([])
    expect(boxGroups({ ...GAME, away_team: 'BUF' }, moved, [L('wr', { receptions: 4, receiving_yards: 40 })]).map((g) => g.key)).toEqual(['receiving'])
  })

  it('a final game placed by current team says so; live, held, or every line naming its game don’t', () => {
    const final = { ...GAME, status: 'final' }
    const st = (g: NflGameRow) => gameStatus(g, '')
    expect(listedByCurrentTeam(final, st(final), PLAYERS, LINES)).toBe(true)
    expect(listedByCurrentTeam(GAME, st(GAME), PLAYERS, LINES)).toBe(false)
    const named = LINES.map((l) => ({ ...l, game_id: GAME.id }))
    expect(listedByCurrentTeam(final, st(final), PLAYERS, named)).toBe(false)
    const held = { ...final, operator_hold: 'cancelled' }
    expect(listedByCurrentTeam(held, st(held), PLAYERS, LINES)).toBe(false)
    expect(listedByCurrentTeam(final, st(final), PLAYERS, [])).toBe(false)
  })
})

describe('the game’s state, in the design’s words', () => {
  it('live is the stored quarter and clock (OT past the 4th), else "Live"', () => {
    expect(gameStatus(GAME, 'Sun 1:00 PM')).toEqual({ state: 'live', text: 'Q4 2:19', started: true })
    expect(gameStatus({ ...GAME, quarter: 5, game_clock: '7:30' }, '')).toMatchObject({ text: 'OT 7:30' })
    expect(gameStatus({ ...GAME, quarter: null, game_clock: null }, '')).toMatchObject({ text: 'Live' })
  })

  it('final, scheduled (the kickoff), postponed and held', () => {
    expect(gameStatus({ ...GAME, status: 'final', quarter: null }, '')).toEqual({ state: 'final', text: 'Final', started: true })
    expect(gameStatus({ ...GAME, status: 'final', quarter: 5 }, '')).toMatchObject({ text: 'Final/OT' })
    expect(gameStatus({ ...GAME, status: 'scheduled' }, 'Sun 1:00 PM')).toEqual({ state: 'scheduled', text: 'Sun 1:00 PM', started: false })
    expect(gameStatus({ ...GAME, status: 'postponed' }, 'Sun 1:00 PM')).toEqual({ state: 'postponed', text: 'Postponed', started: false })
    expect(gameStatus({ ...GAME, operator_hold: 'cancelled' }, '')).toEqual({ state: 'held', text: 'Cancelled', started: false })
    expect(gameStatus({ ...GAME, operator_hold: 'out_of_week' }, '')).toMatchObject({ state: 'held', text: 'Moved out of the week' })
  })

  it('a score shows once the game is under way — a scheduled 0-0 is blank', () => {
    expect(scoreText(gameStatus(GAME, ''), 28)).toBe('28')
    expect(scoreText(gameStatus({ ...GAME, status: 'scheduled' }, 'Sun'), 0)).toBe('')
    expect(scoreText(gameStatus(GAME, ''), null)).toBe('')
  })

  it('an empty box says why', () => {
    expect(emptyBoxCopy(gameStatus({ ...GAME, status: 'scheduled' }, 'Sun'))).toBe('Stats show here once the game starts.')
    expect(emptyBoxCopy(gameStatus(GAME, ''))).toBe('No stats yet.')
    expect(emptyBoxCopy(gameStatus({ ...GAME, status: 'final' }, ''))).toBe('No player stats for this game.')
    expect(emptyBoxCopy(gameStatus({ ...GAME, operator_hold: 'cancelled' }, ''))).toBe('Its players score 0 this week.')
  })
})

it('the game screen lives under the league, its id encoded — and read back as stored', () => {
  expect(nflGameHref('league-1', '2026-wk01-BUF@KC')).toBe('/app/leagues/league-1/games/2026-wk01-BUF%40KC')
  expect(gameIdFromSegment('2026-wk01-BUF%40KC')).toBe('2026-wk01-BUF@KC')
  expect(gameIdFromSegment('2026-wk01-BUF@KC')).toBe('2026-wk01-BUF@KC')
  // A stray "%" is not an encoding: the segment as it came.
  expect(gameIdFromSegment('bad%E0id')).toBe('bad%E0id')
})
