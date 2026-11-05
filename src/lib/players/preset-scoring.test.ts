/**
 * The preset scorer (F576 / D537, K0): the Stats Center, the player page and
 * every list and card score a stored game the SAME way. Golden values are
 * stored literals, hand-checked against ESPN's table (the sum is written out on
 * each line). The inputs are real Sleeper lines run through the code ingest uses,
 * so a golden sees what ingest stores. The 2025 pins moved with F870 because the
 * fixtures run raw lines through the new map; production's 2025 rows don't move
 * without F872. `league-plays-golden.test.ts` holds the plays F870 / F871 opened.
 */
import { describe, expect, it } from 'vitest'

import { seasonToDate } from '@/lib/leagues/scoring/player-values'
import { normalizePosition, scoreStarter, type StatLineRow } from '@/lib/leagues/scoring/score-week-worker'

import { systemRules as coreStatsSystemRules } from './core-stats-service'
import {
  ARI_2026_WK1,
  AUBREY_2025_WK15,
  BASS_2026_WK1,
  BOSWELL_2025_WK1,
  BOSWELL_2026_WK8,
  BUF_2025_WK2,
  CHI_2026_WK6,
  DAL_2026_WK5,
  DAL_2026_WK6,
  KC_2025_WK7,
  KICKOFF_DST,
  MARKS_2025_WK15,
  MCMANUS_2025_WK2,
  MIN_2026_WK3,
  MYERS_2025_WK18,
  PHI_2026_WK8,
  PIT_2025_WK1,
  RYLAND_2026_WK6,
  SEA_2026_WK1,
  storedLine,
  TB_2026_WK8,
} from './preset-scoring.fixtures'
import {
  isOffensePosition,
  PRESET_BY_BUILDER_KEY,
  PRESET_LINE_COLUMNS,
  PRESET_LINE_SELECT,
  presetGamePoints,
  presetLines,
  presetSeasonDisplay,
  presetSeasonPoints,
  presetTotalsPoints,
  roundOneDecimal,
  systemRules,
  type PresetSystem,
} from './preset-scoring'

const SYSTEMS: readonly PresetSystem[] = ['espn_standard', 'quarter_ppr', 'half_ppr', 'ppr']

const line = (playerId: string, week: number, stats: Record<string, number | null>): StatLineRow => ({
  player_id: playerId,
  week,
  updated_at: '2026-10-01T00:00:00Z',
  advanced: {},
  ...stats,
})

describe('K0 goldens: real stored lines against ESPN table, the same under all four scorings', () => {
  const cases: ReadonlyArray<[string, string, Record<string, number>, number]> = [
    ['Tyler Bass 2026 wk1: 3 + 3 + 4 + 3 PAT', 'K', BASS_2026_WK1, 13],
    ['Chad Ryland 2026 wk6: five short 15 + 4', 'K', RYLAND_2026_WK6, 19],
    ['Chris Boswell 2026 wk8: two short 6 − 1 miss + 3 PAT', 'K', BOSWELL_2026_WK8, 8],
    ['Jason Myers 2025 wk18: 3 + 4 − 2 misses + 1 PAT', 'K', MYERS_2025_WK18, 6],
    ['Brandon McManus 2025 wk2: 3 + 5 − 1 miss + 3 PAT', 'K', MCMANUS_2025_WK2, 10],
    // The 60+ point is F871's next step (PR 4 moves this pin to 15).
    ['Chris Boswell 2025 wk1: 50–59 5 + 60+ 5 + 4 PAT (ESPN 15: the 60+ tier is a named gap)', 'K', BOSWELL_2025_WK1, 14],
    ['Seattle 2026 wk1: 3 sacks + 6 INT + PA 10 3 + YA 277 2', 'DEF', SEA_2026_WK1, 14],
    ['Tampa Bay 2026 wk8: 8 INT + shutout by omission 5 + YA 224 2', 'DEF', TB_2026_WK8, 15],
    ['Kansas City 2025 wk7: 1 sack + 2 FR + shutout by omission 5 + YA 95 5', 'DEF', KC_2025_WK7, 13],
    ['Buffalo 2025 wk2: 4 sacks + 2 FR + PA 10 3 + YA 154 3', 'DEF', BUF_2025_WK2, 12],
    ['Philadelphia 2026 wk8: 2 sacks + 2 FR + PA 27 0 + YA 339 0', 'DEF', PHI_2026_WK8, 4],
    ['Dallas 2026 wk5: 1 sack + PA 24 0 + YA 419 −3', 'DEF', DAL_2026_WK5, -2],
    ['Dallas 2026 wk6: 3 sacks + 2 INT + PA 23 0 + YA 318 0', 'DEF', DAL_2026_WK6, 5],
    ['Arizona 2026 wk1: 3 + 2 + 2 + block 2 + PA 14 1 + YA 268 2 (= ESPN)', 'DEF', ARI_2026_WK1, 12],
    ['Minnesota 2026 wk3: 6 + 4 + return TD 6 + PA 16 1 + YA 243 2 (= ESPN)', 'DEF', MIN_2026_WK3, 19],
    ['Chicago 2026 wk6: 5 sacks + 1 FR 2 + two special-teams recoveries 4 + PA 23 0 + YA 257 2 (= ESPN)', 'DEF', CHI_2026_WK6, 13],
    ['Pittsburgh 2025 wk1: 1 sack + special-teams recovery 2 + PA 32 −1 + YA 394 −1 (= ESPN)', 'DEF', PIT_2025_WK1, 1],
  ]
  it.each(cases)('%s', (_name, position, raw, points) => {
    for (const system of SYSTEMS) expect(presetGamePoints(system, position, storedLine(raw)), system).toBe(points)
  })

  it('a D/ST season is its games scored alone: Dallas −2 + 5 = 3, never one summed line', () => {
    const rows = [storedLine(DAL_2026_WK5), storedLine(DAL_2026_WK6)]
    for (const system of SYSTEMS) expect(presetSeasonPoints(system, 'DEF', rows)).toEqual({ points: 3, games: 2 })
  })

  it('a live D/ST row at 0 points and 0 yards is a real number: 5 + 5 + 1 sack = 11, as the league engine pays', () => {
    const live = line('dal', 7, { def_points_allowed: 0, def_yards_allowed: 0, def_sacks: 1 })
    expect(presetGamePoints('ppr', 'DEF', live)).toBe(11)
    expect(scoreStarter(systemRules('ppr'), 'dal', 'DST', live).points).toBe(11)
  })

  it('a kicker\'s rushing yards pay (Aubrey 2025 wk15: 14 + 6 yards 0.6 = 14.6, = ESPN)', () => {
    expect(presetGamePoints('espn_standard', 'K', storedLine(AUBREY_2025_WK15))).toBe(14.6)
  })

  it('a fumble-recovery TD pays (Woody Marks 2025 wk15: 3 + 0.8 + 6 = 9.8, = ESPN)', () => {
    expect(presetGamePoints('espn_standard', 'RB', storedLine(MARKS_2025_WK15))).toBe(9.8)
  })
})

describe('K0 missing data: refuse rather than show a plausible number', () => {
  const defLine = (over: Record<string, number | null>) => line('d', 1, { def_points_allowed: 10, def_yards_allowed: 300, def_sacks: 2, ...over })
  const kLine = (over: Record<string, number | null>) =>
    line('k', 1, { fg_made: 2, fg_attempted: 3, fg_made_40_plus: 1, fg_made_50_plus: 0, xp_made: 1, xp_attempted: 1, ...over })

  it('D/ST with points allowed NULL is refused, not 2 or 7', () => {
    expect(presetGamePoints('ppr', 'DEF', defLine({ def_points_allowed: null }))).toBeNull()
  })

  it('points allowed 0 with yards NULL (a kickoff row) is refused, not a +5 shutout', () => {
    expect(presetGamePoints('ppr', 'DEF', defLine({ def_points_allowed: 0, def_yards_allowed: null }))).toBeNull()
  })

  it('a fractional or negative D/ST input is refused', () => {
    expect(presetGamePoints('ppr', 'DEF', defLine({ def_points_allowed: 10.5 }))).toBeNull()
    expect(presetGamePoints('ppr', 'DEF', defLine({ def_yards_allowed: 300.5 }))).toBeNull()
    expect(presetGamePoints('ppr', 'DEF', defLine({ def_points_allowed: -1 }))).toBeNull()
  })

  it('a column the SELECT left out throws: it can never pay a quiet +5 or a quiet 0', () => {
    expect(() => presetGamePoints('ppr', 'DEF', line('d', 1, { def_yards_allowed: 300 }))).toThrow(/def_points_allowed/)
    expect(() => presetGamePoints('ppr', 'DEF', line('d', 1, { def_points_allowed: 3 }))).toThrow(/def_yards_allowed/)
    for (const column of ['fg_made', 'fg_attempted', 'fg_made_40_plus', 'fg_made_50_plus', 'xp_made', 'xp_attempted']) {
      const row = kLine({})
      delete row[column]
      expect(() => presetGamePoints('ppr', 'K', row), column).toThrow(column)
    }
  })

  it('a K line with nothing kicked, or with distance buckets above made, is refused', () => {
    const empty = kLine({ fg_made: 0, fg_attempted: 0, fg_made_40_plus: 0, xp_made: 0, xp_attempted: 0 })
    expect(presetGamePoints('ppr', 'K', empty)).toBeNull()
    expect(presetGamePoints('ppr', 'K', kLine({ fg_made: 1, fg_made_40_plus: 1, fg_made_50_plus: 1 }))).toBeNull()
    expect(presetGamePoints('ppr', 'K', kLine({ fg_attempted: 1 }))).toBeNull()
  })

  it('a K whose only stat is rushing yards is a game, not an empty row: stats page and league both read 0.8', () => {
    const rushOnly = storedLine({ rush_att: 1, rush_yd: 8, gp: 1 })
    expect(presetGamePoints('espn_standard', 'K', rushOnly)).toBe(0.8)
    expect(scoreStarter(systemRules('espn_standard'), 'k', 'K', rushOnly).points).toBe(0.8)
    expect(presetLines('K', [rushOnly])).toHaveLength(1)
  })

  it('any position outside the six is refused', () => {
    expect(presetGamePoints('ppr', 'LB', line('x', 1, { receptions: 4 }))).toBeNull()
    expect(presetLines('LB', [line('x', 1, { receptions: 4 })])).toEqual([])
  })

  it('one bad game plus one good game is the good game, with one game counted', () => {
    const rows = [defLine({ def_points_allowed: null }), storedLine(SEA_2026_WK1)]
    expect(presetSeasonPoints('ppr', 'DEF', rows)).toEqual({ points: 14, games: 1 })
  })

  it('every game bad is no number for K and D/ST; a WR with no rows still reads 0', () => {
    expect(presetSeasonPoints('ppr', 'DEF', [defLine({ def_points_allowed: null })])).toEqual({ points: null, games: 0 })
    expect(presetSeasonDisplay('ppr', 'DEF', [defLine({ def_points_allowed: null })])).toBeNull()
    expect(presetSeasonDisplay('ppr', 'K', [])).toBeNull()
    expect(presetSeasonDisplay('ppr', 'WR', [])).toBe(0)
    expect(presetSeasonPoints('ppr', 'WR', [])).toEqual({ points: null, games: 0 })
  })

  it('refused games leave presetLines before anything counts them: Cowboys 5 and 6 final, 7 a live kickoff row', () => {
    const kickoff = storedLine(KICKOFF_DST)
    expect([kickoff.def_points_allowed, kickoff.def_yards_allowed]).toEqual([0, null])
    const prepared = presetLines('DEF', [storedLine(DAL_2026_WK5), storedLine(DAL_2026_WK6), kickoff])
    expect(prepared).toHaveLength(2)
    for (const system of SYSTEMS) {
      const { points, games } = presetSeasonPoints(system, 'DEF', prepared)
      expect(points).toBe(3)
      expect(games).toBe(2)
      expect((points as number) / games).toBe(1.5)
    }
  })

  it('presetLines is idempotent and keeps exactly the games presetGamePoints scores', () => {
    const rows = [storedLine(BASS_2026_WK1), storedLine(BOSWELL_2026_WK8), kLine({ fg_attempted: 1 })]
    const once = presetLines('K', rows)
    expect(once).toHaveLength(2)
    expect(presetLines('K', once)).toEqual(once)
    expect(once.map((r) => presetGamePoints('ppr', 'K', r))).toEqual([13, 8])
    expect(rows.filter((r) => presetGamePoints('ppr', 'K', r) !== null)).toHaveLength(2)
  })
})

describe('K0 offense', () => {
  it('summed lines score offense only: K and D/ST throw', () => {
    expect(() => presetTotalsPoints('ppr', 'K', { fg_made: 3 })).toThrow(/per game/)
    expect(() => presetTotalsPoints('ppr', 'DEF', { def_sacks: 3 })).toThrow(/per game/)
    expect(() => presetTotalsPoints('ppr', 'DST', { def_sacks: 3 })).toThrow(/per game/)
    expect(presetTotalsPoints('ppr', 'WR', { receptions: 10, receiving_yards: 125, receiving_tds: 1, fumbles_lost: 1 })).toBe(26.5)
  })

  it('a 2-pt total above its splits goes on pass_2pt, and agreeing columns are not paid twice', () => {
    const totalOnly = line('wr', 1, { two_point_conversions: 1, receiving_yards: 10 })
    expect(presetGamePoints('espn_standard', 'WR', totalOnly)).toBe(3)
    const agreeing = line('wr', 1, { two_point_conversions: 1, rec_2pt: 1, receiving_yards: 10 })
    expect(presetGamePoints('espn_standard', 'WR', agreeing)).toBe(3)
    expect(presetTotalsPoints('espn_standard', 'QB', { two_point_conversions: 2 })).toBe(4)
  })

  it('isOffensePosition takes both spellings of D/ST', () => {
    expect(['QB', 'RB', 'WR', 'TE', 'wr'].every(isOffensePosition)).toBe(true)
    expect(['K', 'DEF', 'DST', ''].some(isOffensePosition)).toBe(false)
  })

  it('the 1-decimal helper rounds exact halves up, as the phone strip and list both read them', () => {
    expect(roundOneDecimal(104.55)).toBe(104.6)
    expect(roundOneDecimal(161.05)).toBe(161.1)
    expect(roundOneDecimal(5.15)).toBe(5.2)
    expect(roundOneDecimal(299.06)).toBe(299.1)
  })
})

describe('the one select', () => {
  it('carries every required column and the 2-pt total, once each', () => {
    for (const column of ['fg_made', 'fg_attempted', 'fg_made_40_plus', 'fg_made_50_plus', 'xp_made', 'xp_attempted', 'def_points_allowed', 'def_yards_allowed', 'two_point_conversions', 'pass_2pt']) {
      expect(PRESET_LINE_COLUMNS, column).toContain(column)
    }
    expect(new Set(PRESET_LINE_COLUMNS).size).toBe(PRESET_LINE_COLUMNS.length)
    expect(PRESET_LINE_SELECT.split(', ').slice(0, 4)).toEqual(['player_id', 'season', 'week', 'source'])
  })
})

describe('league pin: the engine with no preset step', () => {
  it('on Bass 2026 wk1 reads 13, the stats page\'s number: the map fills short FGs (F870, ruled 2026-11-05; it read 7 until then)', () => {
    expect(seasonToDate(systemRules('espn_standard'), 'k', 'K', [storedLine(BASS_2026_WK1)]).points).toBe(13)
  })

  it('a stored 2-pt total alone pays nothing through the engine with no preset step', () => {
    const totalOnly = line('wr', 1, { two_point_conversions: 1 })
    expect(seasonToDate(systemRules('espn_standard'), 'wr', 'WR', [totalOnly]).points).toBe(0)
  })
})

// The Stats Center and player page parity (F576 / D537).
const WR = [
  line('wr', 1, { receptions: 6, receiving_yards: 85, receiving_tds: 1, targets: 9 }),
  line('wr', 2, { receptions: 4, receiving_yards: 40, receiving_tds: 0, fumbles_lost: 1 }),
]
// K: 3 FGs (one 0-39, one 40-49, one 50+), 2 PATs, one missed FG.
const K = [line('k', 1, { fg_made: 3, fg_attempted: 4, fg_0_39: 1, fg_made_40_plus: 1, fg_made_50_plus: 1, fg_missed: 1, xp_made: 2, xp_attempted: 2 })]
// D/ST: 3 sacks, 1 INT, 10 points allowed, 290 yards allowed.
const DEF = [line('dst', 1, { def_sacks: 3, def_interceptions: 1, def_points_allowed: 10, def_yards_allowed: 290 })]

describe('F576: one preset scorer for the Stats Center and the player page', () => {
  it('the player page and the Stats Center read the SAME rules object source', () => {
    for (const s of ['espn_standard', 'half_ppr', 'ppr'] as const) expect(coreStatsSystemRules(s)).toEqual(systemRules(s))
    expect(PRESET_BY_BUILDER_KEY).toEqual({ standard: 'espn_standard', half_ppr: 'half_ppr', ppr: 'ppr' })
  })

  it('R1580 parity against STORED literals: the Stats Center number per preset × position, hand-checked from the templates', () => {
    // WR: see the golden pin below. K (ESPN): 0-39 3 + 40-49 4 + 50+ 5 + PAT 2 − missed FG 1 = 13 (receptions irrelevant).
    // DST (ESPN): 3 sacks × 1 + 1 INT × 2 + PA 10 → def_pa_7_13 = 3 + YA 290 → def_ya_200_299 = 2 = 10.
    const expected: Record<string, Record<string, number>> = {
      standard: { WR: 16.5, K: 13, DEF: 10 },
      half_ppr: { WR: 21.5, K: 13, DEF: 10 },
      ppr: { WR: 26.5, K: 13, DEF: 10 },
    }
    const rows: Record<string, StatLineRow[]> = { WR, K, DEF }
    for (const [builderKey, preset] of Object.entries(PRESET_BY_BUILDER_KEY)) {
      for (const [pos, r] of Object.entries(rows)) {
        expect(presetSeasonDisplay(preset, pos, r), `${builderKey} ${pos}`).toBe(expected[builderKey][pos])
      }
    }
  })

  it('parity: the Stats Center number equals the core-stats engine path on prepared lines, every preset × position', () => {
    const cases: Array<[string, string, StatLineRow[]]> = [
      ['wr', 'WR', WR],
      ['k', 'K', K],
      ['dst', 'DEF', DEF],
    ]
    for (const [builderKey, preset] of Object.entries(PRESET_BY_BUILDER_KEY)) {
      for (const [id, pos, rows] of cases) {
        // The player page's computation (computePoolStandings' own call).
        const page = seasonToDate(systemRules(preset), id, normalizePosition(pos), presetLines(pos, rows)).points as number
        expect(presetSeasonDisplay(preset, pos, rows), `${builderKey} ${pos}`).toBe(roundOneDecimal(page))
      }
    }
  })

  it('golden pins (stored literals)', () => {
    // WR: 125 yds × 0.1 = 12.5, 1 TD = 6, fumble −2 → 16.5; + 10 catches.
    expect(presetSeasonPoints('espn_standard', 'WR', WR).points).toBe(16.5)
    expect(presetSeasonPoints('quarter_ppr', 'WR', WR).points).toBe(19)
    expect(presetSeasonPoints('half_ppr', 'WR', WR).points).toBe(21.5)
    expect(presetSeasonPoints('ppr', 'WR', WR).points).toBe(26.5)
    expect(presetSeasonPoints('ppr', 'WR', WR).games).toBe(2)
    // K (ESPN): 0-39 = 3, 40-49 = 4, 50+ = 5, PAT 1 × 2, missed FG −1 → 13.
    expect(presetSeasonPoints('ppr', 'K', K).points).toBe(13)
    // No lines → null, never 0.
    expect(presetSeasonPoints('ppr', 'WR', []).points).toBeNull()
  })
})
