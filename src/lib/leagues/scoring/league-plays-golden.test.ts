/**
 * F870 / F871 goldens (Chris 2026-11-05, verbatim: "go on league kickers and the
 * other plays"): real, untrimmed Sleeper lines through the real pipeline, the map →
 * `storedLine` → `scoreStarter`. Every number is a stored literal, worked out by a
 * table that imports nothing from this repo, and ESPN's column is ESPN's own
 * `appliedTotal`, read from its fantasy API on 2026-11-05.
 *
 * The lines are full on purpose (`fixtures/sleeper-league-plays.json`). A wrong map
 * shows only on the field it wrongly reads, so these lines are chosen to carry
 * those fields: `misc_td`, `fg_blkd`, `xp_blkd`, `fum_rec_ez_tds`, `st_fum_rec`,
 * `fgmiss_30_39`.
 *
 * 2025 lines pin the map, not production: production's 2025 rows don't move without
 * F872, and these only read the map through the fixtures.
 *
 * Three ESPN values move again in PR 4 of this work, which adds F871's 60+ and
 * two-point keys: Aubrey 2026 wk2 16 → 17, Boswell 2025 wk1 14 → 15, Tampa Bay 2026
 * wk7 26 → 28. Yahoo, Sleeper and Scout don't move.
 */
import { describe, expect, it } from 'vitest'

import { presetGamePoints, presetLines, presetSeasonDisplay, presetTotalsPoints, BUILDER_TOTAL_COLUMNS, type PresetSystem } from '@/lib/players/preset-scoring'
import { recordedActual, recordedProjection, storedLine } from '@/lib/players/preset-scoring.fixtures'
import { sumStatRows, type StatRow } from '@/lib/scoring/default'
import type { WeeklyProjectionPosition } from '@/lib/sync/weekly-projections'

import { mapToCanonicalKeys } from '../stats/sleeper-stats-provider'
import { scorePreseasonLine, scoreWeeklyProjection } from './player-values'
import { resolveRules, type ScoringRulesDoc } from './rules-doc'
import { normalizePosition, scoreStarter } from './score-week-worker'
import { SCORING_TEMPLATES } from './templates'

const template = (name: string) => {
  const found = SCORING_TEMPLATES.find((t) => t.name === name)
  if (!found) throw new Error(`no template named ${name}`)
  return found.rules as unknown as ScoringRulesDoc
}
const SCOUT = template('Scout Standard')
const ESPN = template('ESPN Standard')
const YAHOO = template('Yahoo Standard')
const SLEEPER = template('Sleeper Standard')

type Golden = {
  key: string
  position: string
  scout: number
  espn: number
  yahoo: number
  sleeper: number
  /** ESPN's own total for the line. */
  espnOwn: number
  why: string
}

const G = (key: string, position: string, [scout, espn, yahoo, sleeper]: readonly [number, number, number, number], espnOwn: number, why: string): Golden => ({
  key,
  position,
  scout,
  espn,
  yahoo,
  sleeper,
  espnOwn,
  why,
})

const GOLDENS: readonly Golden[] = [
  // Kickers
  G('bass_2026_wk1', 'K', [12, 13, 13, 13], 13, 'two short FGs, the 7 → 13 of F870'),
  G('boswell_2026_wk8', 'K', [8, 8, 9, 8], 8, 'a miss; Yahoo charges none'),
  G('aubrey_2026_wk2', 'K', [13, 16, 16, 16], 17, 'a 60-yarder pays 5 until F871 adds the key'),
  G('aubrey_2025_wk15', 'K', [12.6, 14.6, 16.6, 14.6], 14.6, 'the 6 rushing yards pay 0.6'),
  G('boswell_2025_wk1', 'K', [10, 14, 14, 14], 15, 'a 60-yarder pays 5 until F871 adds the key'),
  G('lutz_2026_wk5', 'K', [10, 10, 11, 10], 10, 'fgm_0_19 is part of the short-FG sum'),
  G('santos_2026_wk2', 'K', [2, 4, 5, 4], 4, 'K fg_blkd is already inside fgmiss'),
  G('shrader_2026_wk1', 'K', [5, 7, 7, 6], 7, 'xpmiss with no fgmiss: not an FG miss; Sleeper alone charges it'),
  G('fitzgerald_2026_wk1', 'K', [7, 8, 8, 7], 8, 'xp_blkd is already inside xpmiss'),
  G('loop_2026_wk8', 'K', [3, 3, 4, 3], 3, 'fgmiss_30_39 is already inside fgmiss'),
  G('borregales_2026_wk3', 'K', [5, 6, 7, 6], 6, 'fgmiss_30_39 is already inside fgmiss'),
  // D/ST
  G('chi_2026_wk6', 'DEF', [13, 13, 11, 11], 13, 'two special-teams recoveries; def_st_ff pays nothing'),
  G('ari_2026_wk1', 'DEF', [12, 12, 10, 10], 12, 'a blocked kick'),
  G('min_2026_wk3', 'DEF', [19, 19, 17, 17], 19, 'a D/ST return TD'),
  G('tb_2026_wk7', 'DEF', [26, 26, 25, 25], 28, 'a two-point return pays nothing until F871 adds the key'),
  G('ari_2026_wk6', 'DEF', [8, 8, 6, 6], 7, 'the standing difference: the sack ESPN does not count (F893)'),
  G('ten_2026_wk6', 'DEF', [19, 19, 21, 21], 19, 'misc_td + blk_kick + def_st_td: a blocked-kick return TD pays block + TD, once'),
  G('sf_2026_wk5', 'DEF', [20, 20, 18, 18], 20, 'fum_rec_ez_tds, the defense scoring: already inside def_td'),
  G('dal_2026_wk8', 'DEF', [3, 3, 8, 8], 3, 'fum_rec_ez_tds, the offense scoring (Mitchell): pays the D/ST nothing'),
  G('chi_2026_wk2', 'DEF', [8, 8, 7, 7], 8, 'DEF fg_blkd is the team\'s OWN kick: no block paid'),
  G('lv_2026_wk2', 'DEF', [12, 12, 12, 12], 12, 'a safety'),
  // Offense
  G('price_2026_wk3', 'WR', [6, 6, 6, 6], 6, 'a return TD, and no stat row before the map'),
  G('laube_2026_wk8', 'RB', [6, 6, 6, 6], 6, 'a return TD, and no stat row before the map'),
  G('mitchell_2026_wk8', 'TE', [6, 6, 6, 6], 6, 'a fumble-recovery TD, and no stat row before the map; fum_rec_ez_tds and anytime_tds pay nothing more'),
  G('marks_2025_wk15', 'RB', [9.8, 9.8, 9.8, 9.8], 9.8, 'a fumble-recovery TD'),
  G('delp_2026_wk6', 'TE', [1, 1, 1, 1], 1, 'st_fum_rec on an offensive player pays nothing'),
]

/** Where ESPN's own total still differs, each one named. */
const NAMED_GAPS = new Set(['aubrey_2026_wk2', 'boswell_2025_wk1', 'tb_2026_wk7', 'ari_2026_wk6'])

const line = (g: Golden) => storedLine(recordedActual(g.key).stats)
const points = (doc: ScoringRulesDoc, g: Golden) => {
  const scored = scoreStarter(doc, g.key, normalizePosition(g.position), line(g))
  expect(scored.pending, `${g.key} pending`).toEqual([])
  return scored.points
}

describe('real lines through the real pipeline, four rules sets', () => {
  it.each(GOLDENS)('$key: $why', (g) => {
    expect([points(SCOUT, g), points(ESPN, g), points(YAHOO, g), points(SLEEPER, g)]).toEqual([g.scout, g.espn, g.yahoo, g.sleeper])
  })

  it('constructed, because no DEF row in 26 weeks carries it: xp_blkd is the team\'s own blocked PAT and pays a D/ST nothing', () => {
    const row = recordedActual('chi_2026_wk2').stats
    expect(scoreStarter(ESPN, 'chi', 'DST', storedLine({ ...row, xp_blkd: 1 })).points).toBe(8)
  })

  it('under ESPN rules every line equals ESPN\'s own total, except the four named', () => {
    const off = GOLDENS.filter((g) => g.espn !== g.espnOwn).map((g) => g.key)
    expect(new Set(off)).toEqual(NAMED_GAPS)
  })

  it('a PPR sibling differs from its standard template by exactly its catches', () => {
    const pairs = [
      ['Scout Standard', 'Scout PPR', 0.2],
      ['ESPN Standard', 'ESPN Full PPR', 1],
      ['Yahoo Standard', 'Yahoo Half PPR', 0.5],
      ['Sleeper Standard', 'Sleeper Full PPR', 1],
    ] as const
    for (const g of GOLDENS) {
      const catches = Number(line(g).receptions ?? 0)
      for (const [standard, sibling, perCatch] of pairs) {
        const gap = points(template(sibling), g) - points(template(standard), g)
        expect(gap, `${g.key} ${sibling}`).toBeCloseTo(catches * perCatch, 6)
      }
    }
  })
})

describe('a stats page and a league pay the same on the same play', () => {
  it('every line under ESPN Standard, through presetGamePoints', () => {
    for (const g of GOLDENS) expect(presetGamePoints('espn_standard', g.position, line(g)), g.key).toBe(g.espn)
  })

  it('the K derive stays, and on a filled row it equals the stored columns', () => {
    for (const g of GOLDENS.filter((x) => x.position === 'K')) {
      const stored = line(g)
      const [prepared] = presetLines('K', [stored])
      expect(prepared.fg_0_39, `${g.key} fg_0_39`).toBe(stored.fg_0_39)
      expect(prepared.fg_missed, `${g.key} fg_missed`).toBe(stored.fg_missed)
    }
  })
})

describe('summed lines carry return TDs and fumble-recovery TDs', () => {
  /** The Stats Center's accumulator (`players/builder/route.ts`), which feeds the phone's Quarter PPR pool. */
  const builderTotals = (rows: readonly Record<string, unknown>[]) => {
    const totals: Record<string, number> = {}
    for (const row of rows) for (const column of BUILDER_TOTAL_COLUMNS) totals[column] = (totals[column] ?? 0) + Number(row[column] ?? 0)
    return totals
  }
  const lines = (...keys: string[]) => keys.map((key) => storedLine(recordedActual(key).stats))
  const SEASONS = [
    ['James Mitchell', 'TE', lines('mitchell_2026_wk8'), { espn_standard: 6, quarter_ppr: 6, half_ppr: 6, ppr: 6 }],
    ['Dylan Laube', 'RB', lines('laube_2026_wk3', 'laube_2026_wk5', 'laube_2026_wk6', 'laube_2026_wk8'), { espn_standard: 12.4, quarter_ppr: 13.4, half_ppr: 14.4, ppr: 16.4 }],
    ['Myles Price', 'WR', lines('price_2026_wk2', 'price_2026_wk3', 'price_2026_wk4', 'price_2026_wk5'), { espn_standard: 6.8, quarter_ppr: 8.1, half_ppr: 9.3, ppr: 11.8 }],
  ] as const

  it.each(SEASONS)('%s: per-game sum = the builder\'s summed line = the player page\'s summed line', (_name, position, rows, expected) => {
    for (const system of Object.keys(expected) as PresetSystem[]) {
      expect(presetSeasonDisplay(system, position, rows), `${system} per game`).toBe(expected[system])
      expect(presetTotalsPoints(system, position, builderTotals(rows)), `${system} builder`).toBe(expected[system])
      expect(presetTotalsPoints(system, position, sumStatRows(rows as unknown as StatRow[])), `${system} player page`).toBe(expected[system])
    }
  })
})

describe('projected lines: what each feed\'s spellings pay', () => {
  const scoreRow = (doc: ScoringRulesDoc, key: string, position: WeeklyProjectionPosition) =>
    scoreWeeklyProjection(doc, normalizePosition(position), mapToCanonicalKeys(recordedProjection(key).stats, { feed: 'projections', position }))

  const ROWS: ReadonlyArray<[string, WeeklyProjectionPosition, number, number, number, number, string[]]> = [
    // pr_td 0.06 × 6 = 0.36 of it, on an offense row.
    ['washington_2026_wk9', 'WR', 10.29, 10.29, 10.29, 10.29, ['fumble_recovery_td']],
    // def_kr_td 0.06 × 6 = 0.36 of it, on an offense row.
    ['brown_2026_wk9', 'WR', 1.68, 1.68, 1.68, 1.68, ['fumble_recovery_td']],
    // fgm_0_19 0.05 is part of the 0.79 short makes; misses 0.04 + 0.08 + 0.12.
    ['borregales_2026_wk9', 'K', 6.57, 7.41, 7.65, 7.29, []],
    // fgmiss_20_29 0.06 is part of the 0.36 misses, the 2025 shape.
    ['szmyt_2025_wk1', 'K', 6.16, 7.09, 7.45, 7.03, []],
  ]

  it.each(ROWS)('%s', (key, position, scout, espn, yahoo, sleeper, unscored) => {
    expect([SCOUT, ESPN, YAHOO, SLEEPER].map((doc) => scoreRow(doc, key, position).points)).toEqual([scout, espn, yahoo, sleeper])
    expect(scoreRow(ESPN, key, position).unscored).toEqual(unscored)
  })

  it('the buckets fill the keys, and K\'s rushing yards are no gap: nothing projected for a K is named, and a preseason K names nothing new', () => {
    expect(mapToCanonicalKeys(recordedProjection('borregales_2026_wk9').stats, { feed: 'projections', position: 'K' })).toMatchObject({ fg_0_39: 0.79, fg_missed: 0.24 })
    expect(mapToCanonicalKeys(recordedProjection('szmyt_2025_wk1').stats, { feed: 'projections', position: 'K' })).toMatchObject({ fg_0_39: 0.86, fg_missed: 0.36 })
    expect(scorePreseasonLine(ESPN, 'K', { fg_made_40_plus: 10, fg_made_50_plus: 4, xp_made: 30 }).unscored).not.toContain('rush_yards')
    expect(resolveRules(ESPN, 'K').rush_yards).toBe(0.1)
  })

  it('K\'s rushing yards also PAY on a projected line, as on an actual one: never a silent drop', () => {
    // One 30-39 make + 6 rushing yards: 3 + 0.6 = 3.6, projected (weekly feed) and actual alike.
    const raw = { fgm_30_39: 1, fga: 1, fgm: 1, rush_yd: 6 }
    expect(scoreWeeklyProjection(ESPN, 'K', mapToCanonicalKeys(raw, { feed: 'projections', position: 'K' }))).toEqual({ points: 3.6, unscored: [] })
    expect(scoreStarter(ESPN, 'k', 'K', storedLine(raw)).points).toBe(3.6)
    // Preseason: a 40-49 make 4 + 1 PAT + 10 rushing yards 1 = 6.
    const preseason = scorePreseasonLine(ESPN, 'K', { fg_made_40_plus: 1, xp_made: 1, rush_yards: 10 })
    expect(preseason.points).toBe(6)
    expect(preseason.unscored).not.toContain('rush_yards')
  })
})
