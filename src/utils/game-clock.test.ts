import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { gameStatus } from '@/components/mobile/league/game/game-ops'
import { gameLine as matchGameLine } from '@/components/mobile/league/match/match-ops'
import { gameLine as teamGameLine } from '@/components/mobile/league/team/team-ops'
import { gameState } from '@/components/mobile/players/players-ops'

import { isOvertime, liveClock, quarterLabel } from './game-clock'

/**
 * The one game-clock rule (gap list §4 item 14): Team rows printed overtime
 * as "Q5 2:31" while Match printed "OT 2:31". Team, Match, the player
 * profile's this-week card and the NFL game screen now all call
 * `liveClock`, so one game reads the same on each.
 */

describe('quarterLabel / isOvertime', () => {
  it('prints Q1–Q4, then OT from the fifth quarter on — never "Q5"', () => {
    expect([1, 2, 3, 4].map(quarterLabel)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(quarterLabel(5)).toBe('OT')
    expect(quarterLabel(6)).toBe('OT')
    expect(isOvertime(4)).toBe(false)
    expect(isOvertime(5)).toBe(true)
  })

  it('a quarter not on record prints nothing (null, undefined, or a 0 before the first snap)', () => {
    expect(quarterLabel(null)).toBeNull()
    expect(quarterLabel(undefined)).toBeNull()
    expect(quarterLabel(0)).toBeNull()
    expect(isOvertime(null)).toBe(false)
  })
})

describe('liveClock', () => {
  it('joins the stored quarter and clock', () => {
    expect(liveClock({ quarter: 4, game_clock: '6:50' })).toBe('Q4 6:50')
    expect(liveClock({ quarter: 5, game_clock: '2:31' })).toBe('OT 2:31')
    expect(liveClock({ quarter: 2, game_clock: null })).toBe('Q2')
    expect(liveClock({ quarter: null, game_clock: '6:50' })).toBe('6:50')
  })

  it('is null when neither is on record — the caller says "Live"', () => {
    expect(liveClock({ quarter: null, game_clock: null })).toBeNull()
    expect(liveClock({ quarter: 0, game_clock: '  ' })).toBeNull()
    expect(liveClock({})).toBeNull()
  })
})

describe('every phone surface prints the same clock for one game', () => {
  const ot = {
    id: 'g1',
    season: 2099,
    week: 1,
    home_team: 'GB',
    away_team: 'DET',
    kickoff_at: '2099-09-13T17:00:00Z',
    status: 'live',
    home_score: 24,
    away_score: 24,
    quarter: 5,
    game_clock: '2:31',
  }

  it('overtime reads "OT 2:31" on Team, Match, the profile card and the NFL game screen', () => {
    expect(teamGameLine('DET', [ot])).toMatchObject({ kind: 'game', text: 'OT 2:31 @ GB' })
    expect(matchGameLine('DET', 'now_playing', ot, null)).toBe('OT 2:31 @ GB')
    expect(gameState('DET', ot, () => '')).toBe('OT 2:31 · 24-24')
    expect(gameStatus(ot, '').text).toBe('OT 2:31')
  })

  it('a live game with no clock on record says "Live" on each', () => {
    const bare = { ...ot, quarter: null, game_clock: null }
    expect(teamGameLine('DET', [bare])).toMatchObject({ text: 'Live @ GB' })
    expect(matchGameLine('DET', 'now_playing', bare, null)).toBe('Live @ GB')
    expect(gameState('DET', bare, () => '')).toBe('Live')
    expect(gameStatus(bare, '').text).toBe('Live')
  })
})

/**
 * Source pin: the quarter is spelled out in one place. A phone file that
 * builds its own `Q${quarter}` string has gone around the shared rule (that
 * is how Team came to print "Q5").
 */
describe('one game-clock formatter on the phone', () => {
  const ROOT = process.cwd()
  const MOBILE = path.join(ROOT, 'src', 'components', 'mobile')

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return walk(full)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
    })
  }

  it('no phone file builds its own "Q<n>" quarter label', () => {
    const offenders = walk(MOBILE)
      .filter((file) => /`Q\$\{/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))
    expect(offenders).toEqual([])
  })
})
