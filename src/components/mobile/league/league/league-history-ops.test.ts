/**
 * League Menu › League history on the phone (gap list §3 #16; handoff
 * m-community G4) — the pure half: one team's head-to-head this season, from
 * STORED results only, every other team listed in league order.
 */
import { describe, expect, it } from 'vitest'

import { matchup } from '@/components/leagues/standings-schedule.fixtures'

import {
  historyMenuSub,
  historyPoints,
  historyRows,
  historySearch,
  historyTeamFromParam,
  historyTeams,
  historyTotal,
  perGameLine,
  recordHeading,
  recordToneClass,
  seasonLine,
} from './league-history-ops'

// League order is the league read's order (created_at, oldest first).
const TEAMS = [
  { id: 't1', name: 'Alpha', status: 'active' },
  { id: 't2', name: 'Bravo', status: 'active' },
  { id: 't3', name: 'Charlie', status: 'active' },
  { id: 't4', name: 'Delta', status: 'active' },
]

const SEASON = [
  // Week 1: t1 beat t3 (final).
  matchup({ id: 'a', week: 1, home_team_id: 't1', away_team_id: 't3', status: 'final', home_score: 120.25, away_score: 99.5, result: 'home' }),
  // Week 2: t2 beat t1 (final).
  matchup({ id: 'b', week: 2, home_team_id: 't2', away_team_id: 't1', status: 'final', home_score: 110.1, away_score: 101.3, result: 'home' }),
  // Week 3: t1 v t3 again, t1 won (final).
  matchup({ id: 'c', week: 3, home_team_id: 't3', away_team_id: 't1', status: 'final', home_score: 90, away_score: 95.45, result: 'away' }),
  // Week 4: t1 v t4 is being played — no stored result, never counted.
  matchup({ id: 'd', week: 4, home_team_id: 't1', away_team_id: 't4', status: 'live', home_score: 60, away_score: 70, result: null }),
  // A bye is no game.
  matchup({ id: 'e', week: 5, home_team_id: 't1', away_team_id: null, status: 'final', home_score: 88, away_score: null, result: null }),
]

describe('historyRows — stored results, every other team in league order', () => {
  it('lists every other team in league order; a team not played yet reads 0-0', () => {
    const rows = historyRows(SEASON, 't1', TEAMS, 2099)
    expect(rows.map((r) => [r.opponentName, r.wins, r.losses, r.games, r.pointsFor, r.pointsAgainst])).toEqual([
      ['Bravo', 0, 1, 1, 101.3, 110.1],
      ['Charlie', 2, 0, 2, 215.7, 189.5],
      // The live game against Delta isn't a result yet.
      ['Delta', 0, 0, 0, 0, 0],
    ])
  })

  it('counts only this season', () => {
    const other = matchup({ id: 'x', season: 2098, week: 1, home_team_id: 't1', away_team_id: 't2', status: 'final', home_score: 150, away_score: 50, result: 'home' })
    const rows = historyRows([...SEASON, other], 't1', TEAMS, 2099)
    expect(rows.find((r) => r.opponentId === 't2')).toMatchObject({ wins: 0, losses: 1, games: 1 })
  })

  it('a retired team shows only when it was played; an opponent the league read misses still counts', () => {
    const teams = [...TEAMS.slice(0, 3), { id: 't4', name: 'Delta', status: 'retired' }]
    expect(historyRows(SEASON, 't1', teams, 2099).map((r) => r.opponentId)).toEqual(['t2', 't3'])
    const ghost = matchup({ id: 'g', week: 6, home_team_id: 't9', away_team_id: 't1', status: 'final', home_score: 80, away_score: 90, result: 'away' })
    const rows = historyRows([...SEASON, ghost], 't1', TEAMS, 2099)
    expect(rows.at(-1)).toMatchObject({ opponentId: 't9', opponentName: 'Unknown team', wins: 1, games: 1 })
  })

  it('a tie is its own result; the whole line adds every opponent up', () => {
    const tie = matchup({ id: 't', week: 6, home_team_id: 't1', away_team_id: 't4', status: 'final', home_score: 100, away_score: 100, result: 'tie' })
    const rows = historyRows([...SEASON, tie], 't1', TEAMS, 2099)
    const total = historyTotal(rows)
    expect(total).toEqual({ wins: 2, losses: 1, ties: 1, games: 4, pointsFor: 417, pointsAgainst: 399.6 })
    expect(recordHeading(total)).toBe('W-L-T')
    expect(recordHeading(historyTotal(historyRows(SEASON, 't1', TEAMS, 2099)))).toBe('W-L')
  })
})

describe('the team chips and the address', () => {
  it('puts your team first, then league order; retired teams are left out', () => {
    const teams = [...TEAMS, { id: 't5', name: 'Echo', status: 'retired' }]
    expect(historyTeams(teams, 't3').map((t) => t.id)).toEqual(['t3', 't1', 't2', 't4'])
    // A viewer without a team: league order.
    expect(historyTeams(teams, null).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('opens the team the address names when it is a chip, else the first chip', () => {
    const ids = ['t3', 't1', 't2']
    expect(historyTeamFromParam('t2', ids)).toBe('t2')
    expect(historyTeamFromParam('nope', ids)).toBe('t3')
    expect(historyTeamFromParam(null, ids)).toBe('t3')
    expect(historyTeamFromParam(null, [])).toBeNull()
  })

  it('rides ?team= for any team but the first chip, keeping other params', () => {
    expect(historySearch('', 't2', 't1')).toBe('?team=t2')
    expect(historySearch('?team=t2&x=1', 't1', 't1')).toBe('?x=1')
    expect(historySearch('?team=t2', 't1', 't1')).toBe('')
  })
})

describe('the numbers as the page prints them', () => {
  it('points: one decimal, no thousands separator; a dash before any game or when a score is missing', () => {
    expect(historyPoints(1090.4567, 9)).toBe('1090.5')
    expect(historyPoints(0, 0)).toBe('—')
    expect(historyPoints(null, 3)).toBe('—')
    expect(perGameLine(1090.5, 9)).toBe('121.2 per game')
    expect(perGameLine(0, 0)).toBeNull()
    expect(perGameLine(null, 2)).toBeNull()
  })

  it('the record is green when winning, red when losing, the text colour when even', () => {
    expect(recordToneClass({ wins: 3, losses: 2 })).toBe('text-m-green')
    expect(recordToneClass({ wins: 1, losses: 2 })).toBe('text-m-red')
    expect(recordToneClass({ wins: 1, losses: 1 })).toBe('text-m-t1')
    expect(recordToneClass({ wins: 0, losses: 0 })).toBe('text-m-t1')
  })

  it('the record card and the Menu row name the season', () => {
    expect(seasonLine(2026)).toBe('2026 season')
    expect(historyMenuSub(2026)).toBe('Since 2026')
  })
})
