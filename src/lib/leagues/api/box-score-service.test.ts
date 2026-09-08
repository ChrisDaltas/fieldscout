/**
 * box-score-service.test.ts — the pure halves of L.D5.2's box read (spec
 * §11.4 "Now Playing / Done / Up Next"; §11.2's bye reading; §7.3.2 the
 * starting slots; PROGRESS D321(4)). The read itself is driven on the stack
 * by `box-score-api-db.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { BOX_LINE_COLUMNS, slotInstanceKeys, starterPhase, startingSlotDefs, type BoxGame } from './box-score-service'
import { STAT_LINE_COLUMNS } from '../scoring/score-week-worker'

const game = (over: Partial<BoxGame> & Pick<BoxGame, 'id' | 'home_team' | 'away_team'>): BoxGame => ({
  status: 'scheduled',
  home_score: null,
  away_score: null,
  quarter: null,
  game_clock: null,
  kickoff_at: '2099-09-13T17:00:00Z',
  ...over,
})

describe('starterPhase — the provider’s stored status, never a clock (§23.3)', () => {
  const games = [
    game({ id: 'g1', home_team: 'AAA', away_team: 'BBB', status: 'live', quarter: 2 }),
    game({ id: 'g2', home_team: 'CCC', away_team: 'DDD', status: 'final' }),
    game({ id: 'g3', home_team: 'EEE', away_team: 'FFF', status: 'scheduled' }),
    game({ id: 'g4', home_team: 'GGG', away_team: 'HHH', status: 'postponed' }),
    game({ id: 'g5', home_team: 'III', away_team: 'JJJ', status: null }),
  ]
  it('live → now_playing (home or away side)', () => {
    expect(starterPhase('AAA', games)).toMatchObject({ phase: 'now_playing', game: { id: 'g1' } })
    expect(starterPhase('BBB', games)).toMatchObject({ phase: 'now_playing', game: { id: 'g1' } })
  })
  it('final → done', () => {
    expect(starterPhase('DDD', games)).toMatchObject({ phase: 'done', game: { id: 'g2' } })
  })
  it('scheduled / postponed / NULL → up_next, with the row (its kickoff is the UI’s to format)', () => {
    expect(starterPhase('EEE', games)).toMatchObject({ phase: 'up_next', game: { id: 'g3' } })
    expect(starterPhase('GGG', games)).toMatchObject({ phase: 'up_next', game: { id: 'g4' } })
    expect(starterPhase('III', games)).toMatchObject({ phase: 'up_next', game: { id: 'g5' } })
  })
  it('a team with no row in a week that HAS rows is a bye (§11.2); no team at all is a bye too', () => {
    expect(starterPhase('ZZZ', games)).toEqual({ phase: 'bye', game: null })
    expect(starterPhase(null, games)).toEqual({ phase: 'bye', game: null })
  })
  it('a week with NO game rows is up_next for everyone — nothing on record, not a bye (the F238 posture)', () => {
    expect(starterPhase('AAA', [])).toEqual({ phase: 'up_next', game: null })
    expect(starterPhase(null, [])).toEqual({ phase: 'up_next', game: null })
  })
  it('a kickoff in the past with status still `scheduled` is STILL up_next — the phase never reads a clock', () => {
    expect(starterPhase('EEE', [game({ id: 'old', home_team: 'EEE', away_team: 'FFF', status: 'scheduled', kickoff_at: '2001-09-09T17:00:00Z' })]).phase).toBe('up_next')
  })
})

describe('startingSlotDefs / slotInstanceKeys — §7.3.2 starting_slots → the §12.13 instance keys', () => {
  const roster = {
    starting_slots: [
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 2 },
      { key: 'flex', label: 'FLEX (W/R/T)', eligible: ['WR', 'RB', 'TE'], count: 1 },
      { key: 'skip', label: 'Skip', eligible: ['K'], count: 0 },
    ],
    bench: 6,
    ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT'] }],
  }
  it('expands counts in order; a zero-count slot yields no instance; IR spots are not starting slots', () => {
    expect(slotInstanceKeys(startingSlotDefs(roster))).toEqual([
      { slot: 'qb:0', slot_key: 'qb', label: 'QB' },
      { slot: 'rb:0', slot_key: 'rb', label: 'RB' },
      { slot: 'rb:1', slot_key: 'rb', label: 'RB' },
      { slot: 'flex:0', slot_key: 'flex', label: 'FLEX (W/R/T)' },
    ])
  })
  it('a malformed document yields no slots; a missing label falls back to the key', () => {
    expect(startingSlotDefs(null)).toEqual([])
    expect(startingSlotDefs({ starting_slots: 'nope' })).toEqual([])
    expect(startingSlotDefs({ starting_slots: [{ key: 'k', count: 1 }, { count: 1 }] })).toEqual([{ key: 'k', label: 'k', count: 1 }])
  })
})

describe('BOX_LINE_COLUMNS — a DISPLAY subset of the columns the worker scores from', () => {
  it('every rendered column is one the scoring reads (no invented stat)', () => {
    for (const column of BOX_LINE_COLUMNS) expect(STAT_LINE_COLUMNS, column).toContain(column)
  })
})
