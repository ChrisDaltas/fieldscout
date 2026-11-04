import { describe, expect, it } from 'vitest'

import { presetTotalsPoints } from '../players/preset-scoring'
import { sleeperProjectionToStatRow } from './sleeper'

// Trimmed from a real Sleeper 2026 RB projection row (Bijan Robinson).
const RB_PROJECTION = {
  pass_yd: 0,
  rush_att: 280,
  rush_yd: 1372,
  rush_td: 9,
  rush_2pt: 1,
  rec: 64,
  rec_yd: 537,
  rec_td: 3,
  fum_lost: 2,
  pts_std: 260.9,
  pts_half_ppr: 292.9,
  pts_ppr: 324.9,
}

// Trimmed from a real Sleeper 2026 K projection row (Cameron Dicker).
const K_PROJECTION = {
  fgm_40_49: 9,
  fgm_50p: 6,
  fgm_yds: 741,
  fgmiss_40_49: 1,
  xpm: 42,
  xpmiss: 2,
  pts_std: 106,
}

describe('sleeperProjectionToStatRow', () => {
  it('maps skill-position keys to the app StatRow convention', () => {
    const line = sleeperProjectionToStatRow(RB_PROJECTION)
    expect(line).toEqual({
      rush_yards: 1372,
      rush_tds: 9,
      two_point_conversions: 1,
      receptions: 64,
      receiving_yards: 537,
      receiving_tds: 3,
      fumbles_lost: 2,
    })
  })

  it('drops zero-valued and unknown keys', () => {
    const line = sleeperProjectionToStatRow(RB_PROJECTION)
    expect(line).not.toHaveProperty('pass_yards')
    expect(line).not.toHaveProperty('pts_ppr')
  })

  it('scores under each preset close to Sleeper’s own totals', () => {
    const line = sleeperProjectionToStatRow(RB_PROJECTION)
    // Sleeper's internal weights differ slightly (first-down bonuses etc.),
    // so allow a small tolerance rather than exact equality.
    expect(presetTotalsPoints('espn_standard', 'RB', line)).toBeCloseTo(260.9, -1)
    expect(presetTotalsPoints('half_ppr', 'RB', line)).toBeCloseTo(292.9, -1)
    expect(presetTotalsPoints('ppr', 'RB', line)).toBeCloseTo(324.9, -1)
  })

  it('maps kicker 40+/50+ buckets (no short-FG key exists on projections)', () => {
    const line = sleeperProjectionToStatRow(K_PROJECTION)
    expect(line).toEqual({
      fg_made_40_plus: 9,
      fg_made_50_plus: 6,
      xp_made: 42,
    })
    // A season line can't be scored for a kicker: it has no short field goals.
    // Pre-season K and D/ST read Sleeper's stored totals instead.
    expect(() => presetTotalsPoints('espn_standard', 'K', line)).toThrow(/per game/)
  })

  it('returns an empty line for null stats', () => {
    expect(sleeperProjectionToStatRow(null)).toEqual({})
    expect(sleeperProjectionToStatRow(undefined)).toEqual({})
  })
})
