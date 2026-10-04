import { describe, expect, it } from 'vitest'

import { sumBox } from './core-stats-ops'
import { completionPct, keyStats, passerRating, perGame, yardsPerTarget, type KeyStatsInput } from './key-stats-ops'

const keysOf = (tiles: Array<{ key: string }>) => tiles.map((t) => t.key)
const val = (tiles: Array<{ key: string; value: string }>, k: string) => tiles.find((t) => t.key === k)?.value

describe('key stats — formulas (D486(14))', () => {
  it('passer rating is the NFL formula (golden values)', () => {
    // 20/30, 250 yds, 2 TD, 1 INT: a 1.8333 + b 1.3333 + c 1.3333 + d 1.5417 = 6.0417 → 100.69
    expect(passerRating({ pass_attempts: 30, pass_completions: 20, pass_yards: 250, pass_tds: 2, interceptions: 1 })!.toFixed(1)).toBe('100.7')
    // Every component clamps at 2.375 → the perfect 158.3.
    expect(passerRating({ pass_attempts: 10, pass_completions: 10, pass_yards: 200, pass_tds: 3, interceptions: 0 })!.toFixed(1)).toBe('158.3')
    // …and at 0 below: 0/10, 0 yds, 0 TD, 3 INT → 0.0.
    expect(passerRating({ pass_attempts: 10, pass_completions: 0, pass_yards: 0, pass_tds: 0, interceptions: 3 })!.toFixed(1)).toBe('0.0')
    expect(passerRating({ pass_attempts: 0, pass_completions: 0, pass_yards: 0, pass_tds: 0, interceptions: 0 })).toBeNull()
    expect(passerRating({ pass_attempts: 30, pass_completions: 20, pass_yards: 250, pass_tds: 2 })).toBeNull()
  })

  it('comp %, yds / target, per game', () => {
    expect(completionPct(20, 30)!.toFixed(1)).toBe('66.7')
    expect(completionPct(20, 0)).toBeNull()
    expect(yardsPerTarget(88, 11)).toBe(8)
    expect(yardsPerTarget(88, undefined)).toBeNull()
    expect(perGame(45, 3)).toBe(15)
    expect(perGame(45, 0)).toBeNull()
    expect(perGame(undefined, 3)).toBeNull()
  })

  it('sumBox: a column no line carries is absent; a stored 0 is a real 0', () => {
    expect(sumBox([{ rush_yards: 40, rush_tds: 0 }, { rush_yards: 60, rush_tds: 1, targets: null }])).toEqual({ rush_yards: 100, rush_tds: 1 })
    expect(sumBox([{ rush_tds: 0 }])).toEqual({ rush_tds: 0 })
  })
})

const RB: KeyStatsInput = {
  games: 4,
  totals: { rush_attempts: 62, rush_yards: 301, rush_tds: 3, targets: 14, receptions: 11, receiving_yards: 80, receiving_tds: 0 },
  usage: { snap_pct: 64.2, target_share: 9.1 },
}

describe('key stats — per position', () => {
  it('RB: Snap % · Carries / gm · Rush yds · Rush TD · Targets · Receptions; more = Rec yds · Rec TD', () => {
    const k = keyStats('RB', RB)
    expect(keysOf(k.primary)).toEqual(['snap_pct', 'carries_pg', 'rush_yds', 'rush_td', 'targets', 'receptions'])
    expect(k.primary.map((t) => t.value)).toEqual(['64.2%', '15.5', '301', '3', '14', '11'])
    expect(keysOf(k.more)).toEqual(['rec_yds', 'rec_td'])
    expect(val(k.more, 'rec_td')).toBe('0') // a real 0, shown
  })

  it('WR / TE: Targets · Tgt share (team att) · Receptions · Rec yds · Yds / target · Rec TD; more = Snap %', () => {
    const wr: KeyStatsInput = { games: 3, totals: { targets: 24, receptions: 17, receiving_yards: 230, receiving_tds: 2 }, usage: { snap_pct: 88, target_share: 23.4 } }
    for (const pos of ['WR', 'TE']) {
      const k = keyStats(pos, wr)
      expect(keysOf(k.primary)).toEqual(['targets', 'target_share', 'receptions', 'rec_yds', 'ypt', 'rec_td'])
      expect(val(k.primary, 'ypt')).toBe('9.6')
      expect(k.primary.find((t) => t.key === 'target_share')!.label).toBe('Tgt share (team att)')
      expect(keysOf(k.more)).toEqual(['snap_pct'])
    }
  })

  it('QB: Comp % · Pass yds · Pass TD · INT · Rush yds · Rush TD; more = Attempts · Passer rating', () => {
    const qb: KeyStatsInput = {
      games: 2,
      totals: { pass_attempts: 30, pass_completions: 20, pass_yards: 250, pass_tds: 2, interceptions: 1, rush_yards: 12, rush_tds: 0 },
      usage: null,
    }
    const k = keyStats('QB', qb)
    expect(k.primary.map((t) => [t.key, t.value])).toEqual([
      ['comp_pct', '66.7%'],
      ['pass_yds', '250'],
      ['pass_td', '2'],
      ['int', '1'],
      ['rush_yds', '12'],
      ['rush_td', '0'],
    ])
    expect(k.more.map((t) => [t.key, t.value])).toEqual([
      ['att', '30'],
      ['rating', '100.7'],
    ])
  })

  it('K and DEF: the stored equivalents', () => {
    const k = keyStats('K', { games: 3, totals: { fg_made: 7, fg_attempted: 8, fg_made_40_plus: 3, fg_made_50_plus: 1, xp_made: 9, xp_attempted: 9 }, usage: null })
    expect(k.primary.map((t) => t.value)).toEqual(['7/8', '87.5%', '3', '1', '9/9'])
    const d = keyStats('DEF', { games: 2, totals: { def_sacks: 5, def_interceptions: 2, def_fumble_recoveries: 1, def_tds: 0, def_points_allowed: 37, def_yards_allowed: 610 }, usage: null })
    expect(d.primary.map((t) => t.value)).toEqual(['5', '2', '1', '0', '18.5', '305.0'])
  })

  it('missing data is OMITTED, never invented: no usage row, no column, no games', () => {
    const k = keyStats('RB', { ...RB, usage: null, totals: { rush_yards: 301 } })
    expect(keysOf(k.primary)).toEqual(['rush_yds'])
    expect(keysOf(k.more)).toEqual([])
    expect(keyStats('RB', { ...RB, games: 0 })).toEqual({ primary: [], more: [] })
    expect(keyStats('RB', null)).toEqual({ primary: [], more: [] })
    expect(keyStats('LS', RB)).toEqual({ primary: [], more: [] })
  })
})
