/**
 * player-values — the pure scoring layer (M6A L.E1.20; PROGRESS D374, F379
 * second third; F385 / F386(b) / F387-compute discharged; spec §12.28).
 *
 * Every number below is a STORED LITERAL (§4.3 falsifiability floor), hand
 * checked where the arithmetic is short (the reversal pair, the season sums,
 * the preseason lines). The fixture is L.E1.19's recorded week-4 response
 * (`src/lib/sync/fixtures/sleeper-weekly-projections-2026.json`), mapped to
 * canonical keys by the SAME map the sync writes the line with.
 *
 *   V1  GOLDEN vs SLEEPER — all 17 projected fixture rows under Sleeper
 *       Standard / Full PPR; offense reproduces Sleeper's own pts_std /
 *       pts_ppr within 0.05; the K and DEF gaps are EXACTLY the keys each
 *       value names as unscored (+ Sleeper's forced-fumble point, a stat no
 *       template scores) — restored, each lands within 0.05 of Sleeper.
 *   V2  F386(b) — a fractional projected PA / YA is floored (Sleeper's own
 *       tiering, 186/186 measured); the boundary instants 20.75 / 21.25.
 *   V3  ACTUALS UNCHANGED — the worker's composition still withholds a
 *       fractional PA (R58/D58), for the SAME value V2 floors.
 *   V4  THE REVERSAL — a custom league scoring (Scout Standard forked, RB
 *       receptions 1) reverses the preset order of two players; the value
 *       follows the league's snapshot, not a preset.
 *   V5  SEASON TO DATE — per-week rounding first, NULL (no games) vs a real
 *       0.00 (games ≥ 1).
 *   V6  F385 — the legacy season line, translated through the registry's
 *       column map; untranslatable keys named; a D/ST line without PA is
 *       NOT a shutout.
 *   V7  computePlayerValue's branches — F387's freshness boundary (exactly
 *       6 h fresh, 6 h + 1 ms stale), no line, other season, projected 0.00.
 *   V8  the projected line's position scope (no zero fill).
 *   V9  F387's two halves share ONE bound (L.E1.21, migration 138): the SQL
 *       read-side `c_max_age` in autopilot's newest definer equals
 *       PROJECTION_MAX_AGE_MS — a line the job still scores is a line the
 *       lock-time read still trusts.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { sleeperProjectionToStatRow } from '@/lib/sports-data/sleeper'

import { mapToCanonicalKeys } from '../stats/sleeper-stats-provider'
import { STAT_KEYS } from '../stats/stat-keys'
import { deriveTierIndicators } from './derive-stats'
import {
  computePlayerValue,
  floorProjectedTierSources,
  isFreshLine,
  LEGACY_SEASON_LINE_KEYS,
  PRESEASON_SOURCE_KEYS,
  PROJECTION_MAX_AGE_MS,
  scopedProjectedLine,
  scorePreseasonLine,
  scoreWeeklyProjection,
  seasonToDate,
  translateLegacySeasonLine,
  WEEKLY_SOURCE_KEYS,
} from './player-values'
import { forkTemplateDoc, type ScoringRulesDoc } from './rules-doc'
import { normalizePosition, scoreStarter, type StatLineRow } from './score-week-worker'
import { SCORING_TEMPLATES } from './templates'

const rules = (name: string): Record<string, number> => {
  const t = SCORING_TEMPLATES.find((x) => x.name === name)
  if (!t) throw new Error(`no template ${name}`)
  return { ...t.rules }
}
const SLEEPER_STD = rules('Sleeper Standard')
const SLEEPER_PPR = rules('Sleeper Full PPR')
const ESPN_STD = rules('ESPN Standard')
const SCOUT_STD = rules('Scout Standard')

type FixtureRow = { player_id: string; stats: Record<string, number>; player?: { last_name?: string } }
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../sync/fixtures/sleeper-weekly-projections-2026.json', import.meta.url)), 'utf8'),
) as { weeks: Record<string, Record<string, FixtureRow[]>> }
const WEEK4 = FIXTURE.weeks['4']

/** Every PROJECTED fixture row (carries Sleeper's own totals), with its position. */
const PROJECTED: Array<{ pos: string; row: FixtureRow }> = Object.entries(WEEK4).flatMap(([pos, rows]) =>
  rows.filter((r) => 'pts_std' in r.stats).map((row) => ({ pos, row })),
)
const find = (id: string) => {
  const hit = PROJECTED.find((p) => p.row.player_id === id)
  if (!hit) throw new Error(`fixture has no projected row ${id}`)
  return hit
}
const weekly = (doc: ScoringRulesDoc, id: string) => {
  const { pos, row } = find(id)
  return scoreWeeklyProjection(doc, normalizePosition(pos), mapToCanonicalKeys(row.stats))
}

// ---------------------------------------------------------------------------
// V1 — golden vs Sleeper
// ---------------------------------------------------------------------------
describe('V1 GOLDEN vs SLEEPER — the recorded week-4 lines through the canonical scorer', () => {
  // Stored literals: [player_id, Sleeper Standard, Sleeper Full PPR].
  const GOLDEN: Array<[string, number, number]> = [
    ['4984', 23.27, 23.27], // Allen QB
    ['4881', 22.7, 22.7], // Jackson QB
    ['5849', 20.35, 20.35], // Murray QB
    ['9221', 18.69, 23.17], // Gibbs RB
    ['6813', 19.24, 22.05], // Taylor RB
    ['9509', 15.27, 19.34], // Robinson RB
    ['13300', 0, 0], // Moss RB — a real projected 0.00
    ['9488', 13.87, 20.31], // Smith-Njigba WR
    ['9493', 12.95, 19.57], // Nacua WR
    ['7547', 11.94, 18.78], // St. Brown WR
    ['8130', 9.32, 16.43], // McBride TE
    ['11604', 8.29, 14.3], // Bowers TE
    ['12185', 6.86, 6.86], // Shrader K
    ['3451', 6.53, 6.53], // Fairbairn K
    ['MIN', 8.33, 8.33], // Vikings DEF
    ['BAL', 8.66, 8.66], // Ravens DEF
    ['PIT', 7.66, 7.66], // Steelers DEF — pts_allow 17.5, FRACTIONAL
  ]

  it('V1a every projected fixture row, both presets, BY VALUE (17 of 17 — none skipped)', () => {
    expect(PROJECTED).toHaveLength(17)
    expect(GOLDEN.map(([id]) => id).sort()).toEqual(PROJECTED.map((p) => p.row.player_id).sort())
    for (const [id, std, ppr] of GOLDEN) {
      expect([id, weekly(SLEEPER_STD, id).points]).toEqual([id, std])
      expect([id, weekly(SLEEPER_PPR, id).points]).toEqual([id, ppr])
    }
  })

  it('V1b OFFENSE reproduces Sleeper\'s own pts_std / pts_ppr within 0.05 (the scorer is right when the template matches the source)', () => {
    for (const { pos, row } of PROJECTED.filter((p) => ['QB', 'RB', 'WR', 'TE'].includes(p.pos))) {
      const line = mapToCanonicalKeys(row.stats)
      const std = scoreWeeklyProjection(SLEEPER_STD, pos, line).points
      const ppr = scoreWeeklyProjection(SLEEPER_PPR, pos, line).points
      expect(Math.abs(std - row.stats.pts_std), `${row.player_id} std ${std} vs ${row.stats.pts_std}`).toBeLessThanOrEqual(0.05)
      expect(Math.abs(ppr - row.stats.pts_ppr), `${row.player_id} ppr ${ppr} vs ${row.stats.pts_ppr}`).toBeLessThanOrEqual(0.05)
    }
  })

  it('V1c K: the value NAMES fg_0_39 and fg_missed as unscored — restoring the short makes (3 each) lands within 0.05 of Sleeper (Shrader 6.86 → 9.59 vs 9.63)', () => {
    for (const id of ['12185', '3451']) {
      const scored = weekly(SLEEPER_STD, id)
      expect(scored.unscored).toEqual(['fg_0_39', 'fg_missed'])
      const raw = find(id).row.stats
      const shortMakes = (raw.fgm_0_19 ?? 0) + (raw.fgm_20_29 ?? 0) + (raw.fgm_30_39 ?? 0)
      const restored = scored.points + SLEEPER_STD.fg_0_39 * shortMakes
      expect(Math.abs(restored - raw.pts_std), `${id} ${restored} vs ${raw.pts_std}`).toBeLessThanOrEqual(0.05)
    }
  })

  it('V1d DEF: the value NAMES def_block and def_return_td — restoring them (+ Sleeper\'s forced-fumble point, a stat no template scores) lands within 0.05 of Sleeper, the FRACTIONAL-PA PIT included', () => {
    for (const id of ['MIN', 'BAL', 'PIT']) {
      const scored = weekly(SLEEPER_STD, id)
      expect(scored.unscored).toEqual(['def_block', 'def_return_td'])
      const raw = find(id).row.stats
      // Sleeper's own special-teams TD total is `st_td` (kick + punt return;
      // measured live over weeks 1–6, 186 DEF rows — D374(5)).
      const restored = scored.points + SLEEPER_STD.def_block * (raw.blk_kick ?? 0) + SLEEPER_STD.def_return_td * (raw.st_td ?? 0) + 1 * (raw.ff ?? 0)
      expect(Math.abs(restored - raw.pts_std), `${id} ${restored} vs ${raw.pts_std}`).toBeLessThanOrEqual(0.05)
    }
  })

  it('V1e ESPN scoring now SCORES the yards-allowed tier from the projected line (L.E1.26 / F390 — re-cut; it was named unscored under F386(a))', () => {
    // MIN projects 300.39 yards → floor 300 → def_ya_300_349 (ESPN 0);
    // PIT 296.73 → 296 → def_ya_200_299 (ESPN +2). Only the two keys the
    // source still cannot supply stay named.
    expect(weekly(ESPN_STD, 'MIN').unscored).toEqual(['def_block', 'def_return_td'])
    expect(weekly(ESPN_STD, 'PIT').unscored).toEqual(['def_block', 'def_return_td'])
    // Sleeper Standard scores no yards-allowed tier: its value does not move.
    expect(weekly(SLEEPER_STD, 'MIN').unscored).toEqual(['def_block', 'def_return_td'])
  })

  it('V1f the source vocabulary is the one Sleeper → canonical map (derived, not hand-listed)', () => {
    expect(WEEKLY_SOURCE_KEYS.has('def_points_allowed')).toBe(true)
    expect(WEEKLY_SOURCE_KEYS.has('fg_0_39')).toBe(false)
    expect(WEEKLY_SOURCE_KEYS.has('def_yards_allowed')).toBe(true) // L.E1.26: yds_allow mapped (F390)
  })
})

// ---------------------------------------------------------------------------
// V2 / V3 — fractional PA: floored on the projected path, withheld on the actual
// ---------------------------------------------------------------------------
describe('V2 F386(b) — a fractional projected PA / YA takes the tier of its floor (the source\'s own reading)', () => {
  const dst = (pa: number) => scoreWeeklyProjection(SLEEPER_STD, 'DST', { def_sack: 2, def_points_allowed: pa })

  it('V2a PIT 17.5 scores its 14–20 tier (+1): 7.66 under Sleeper, not the 6.66 a withheld family would give (ESPN 9.66 — its yards tier, L.E1.26)', () => {
    expect(weekly(SLEEPER_STD, 'PIT').points).toBe(7.66)
    // ESPN: 17 → 14–17 (+1); and since L.E1.26 (F390) the projected 296.73
    // yards → 296 → def_ya_200_299 (+2): 7.66 + 2 = 9.66 (was 7.66 with the
    // yards family unscored).
    expect(weekly(ESPN_STD, 'PIT').points).toBe(9.66)
  })

  it('V2b the boundary instants Sleeper itself decided (measured live): 20.75 → 14–20 (+1), 21.25 → 21–27 (0), 13.5 → 7–13 (+4)', () => {
    expect(dst(20.75).points).toBe(3)
    expect(dst(21).points).toBe(2)
    expect(dst(21.25).points).toBe(2)
    expect(dst(13.5).points).toBe(6)
    expect(dst(14).points).toBe(3)
    expect(dst(20.75).unscored).toEqual(['def_block', 'def_return_td'])
  })

  it('V2c the floor touches only the two D/ST tier sources, only when fractional', () => {
    expect(floorProjectedTierSources({ def_points_allowed: 17.5, def_yards_allowed: 349.18, def_sack: 2.84 })).toEqual({
      def_points_allowed: 17,
      def_yards_allowed: 349,
      def_sack: 2.84,
    })
    expect(floorProjectedTierSources({ def_points_allowed: 17 })).toEqual({ def_points_allowed: 17 })
    expect(floorProjectedTierSources({ def_points_allowed: Number.NaN }).def_points_allowed).toBeNaN()
  })
})

describe('V3 ACTUALS UNCHANGED — the worker composition still withholds the SAME fractional PA (R58/D58)', () => {
  const row = (pa: number): StatLineRow => ({ player_id: 'x', updated_at: '2099-01-01T00:00:00Z', advanced: {}, def_sacks: 2, def_points_allowed: pa })

  it('V3a deriveTierIndicators emits no def_pa_* key for 17.5 (untouched by this task)', () => {
    expect(Object.keys(deriveTierIndicators({ def_points_allowed: 17.5 })).filter((k) => k.startsWith('def_pa_'))).toEqual([])
  })

  it('V3b scoreStarter on an ACTUAL D/ST line: PA 17 → 3.00 scored; PA 17.5 → the family PENDING (2.00 + pending keys) — no floor leaked into actual scoring', () => {
    expect(scoreStarter(SLEEPER_STD, 'x', 'DST', row(17))).toEqual({ player_id: 'x', position: 'DST', points: 3, pending: [], reason: 'scored' })
    const fractional = scoreStarter(SLEEPER_STD, 'x', 'DST', row(17.5))
    expect(fractional.points).toBe(2)
    expect(fractional.pending).toEqual(['def_pa_0', 'def_pa_1_6', 'def_pa_7_13', 'def_pa_14_20', 'def_pa_21_27', 'def_pa_28_34', 'def_pa_35_plus'])
  })
})

// ---------------------------------------------------------------------------
// V4 — the reversal: the league's scoring, not a preset
// ---------------------------------------------------------------------------
describe('V4 THE REVERSAL — a custom league scoring reverses the preset order (§4 rule 14(b))', () => {
  const custom = forkTemplateDoc(SCOUT_STD)
  custom.positions = { RB: { receptions: 1 } }
  const at = new Date('2099-09-24T12:00:00Z')
  const value = (doc: ScoringRulesDoc, id: string) =>
    computePlayerValue(doc, { league_id: 'L', season: 2099, week: 3, now: at }, {
      player_id: id,
      position: 'RB',
      weekly: { stats: mapToCanonicalKeys(find(id).row.stats), fetched_at: '2099-09-24T11:40:00Z' },
      seasonRows: [],
      preseason: null,
    }).projected_points

  it('V4a under the PRESET (Scout Standard, 0 PPR) Taylor 19.24 outranks Gibbs 18.69', () => {
    expect([value(SCOUT_STD, '9221'), value(SCOUT_STD, '6813')]).toEqual([18.69, 19.24])
  })

  it('V4b under the LEAGUE\'s custom doc (RB receptions 1) Gibbs 23.17 outranks Taylor 22.05 — hand-checked: +4.48 / +2.81 receptions', () => {
    expect([value(custom, '9221'), value(custom, '6813')]).toEqual([23.17, 22.05])
  })
})

// ---------------------------------------------------------------------------
// V5 — season to date
// ---------------------------------------------------------------------------
describe('V5 SEASON TO DATE — the worker\'s scoreStarter per week, rounded per week, NULL is not zero', () => {
  const line = (week: number, cols: Record<string, number>): StatLineRow => ({ player_id: 'p', updated_at: `2099-09-0${week}T00:00:00Z`, advanced: {}, ...cols })

  it('V5a no rows ⇒ NULL with 0 games (no games yet — never 0.00)', () => {
    expect(seasonToDate(SCOUT_STD, 'p', 'WR', [])).toEqual({ points: null, games: 0 })
  })

  it('V5b a played week with nothing in it ⇒ a REAL 0.00 with 1 game', () => {
    expect(seasonToDate(SCOUT_STD, 'p', 'WR', [line(1, {})])).toEqual({ points: 0, games: 1 })
  })

  it('V5c QB weeks 27.00 + 16.55 = 43.55 under Scout Standard (hand: 300×.05+2×6−2+20×.1; 201×.05+6+5×.1)', () => {
    const rows = [
      line(1, { pass_yards: 300, pass_tds: 2, interceptions: 1, rush_yards: 20 }),
      line(2, { pass_yards: 201, pass_tds: 1, rush_yards: 5 }),
    ]
    expect(seasonToDate(SCOUT_STD, 'p', 'QB', rows)).toEqual({ points: 43.55, games: 2 })
  })

  it('V5d the per-PLAYER-WEEK precision is applied first (§7.3.3): two 10.005 weeks sum to 20.02, not 20.01', () => {
    const doc = { receiving_yards: 0.10005 }
    expect(seasonToDate(doc, 'p', 'WR', [line(1, { receiving_yards: 100 }), line(2, { receiving_yards: 100 })])).toEqual({ points: 20.02, games: 2 })
  })
})

// ---------------------------------------------------------------------------
// V6 — F385: the legacy preseason line
// ---------------------------------------------------------------------------
describe('V6 F385 — the LEGACY season line, translated through the registry\'s column map', () => {
  it('V6a the mapper\'s whole vocabulary is LEGACY_SEASON_LINE_KEYS (a line carrying every field it reads)', () => {
    const every = {
      pass_yd: 1, pass_td: 1, pass_int: 1, rush_yd: 1, rush_td: 1, rec: 1, rec_yd: 1, rec_td: 1, fum_lost: 1,
      pass_2pt: 1, rush_2pt: 1, rec_2pt: 1, fgm_40_49: 1, fgm_50p: 1, xpm: 1, sack: 1, int: 1, fum_rec: 1,
      def_fum_td: 1, pass_int_td: 1, def_kr_td: 1, pr_td: 1, safe: 1,
    }
    expect(Object.keys(sleeperProjectionToStatRow(every)).sort()).toEqual([...LEGACY_SEASON_LINE_KEYS].sort())
  })

  it('V6b the registry\'s key → column map is ONE-TO-ONE (so its inverse is a translation)', () => {
    const columns = STAT_KEYS.filter((d) => d.storage === 'column').map((d) => d.column)
    expect(new Set(columns).size).toBe(columns.length)
  })

  it('V6c the translation: legacy names → canonical keys; two_point_conversions (a SUM of three canonical keys) is untranslatable and named', () => {
    expect(
      translateLegacySeasonLine({ xp_made: 42, fg_made_40_plus: 9, fg_made_50_plus: 8, def_sacks: 52, def_tds: 3, two_point_conversions: 1.2, pass_yards: 4000 }),
    ).toEqual({
      line: { pat_made: 42, fg_40_49: 9, fg_50_plus: 8, def_sack: 52, def_td: 3, pass_yards: 4000 },
      untranslated: ['two_point_conversions'],
    })
    expect([...PRESEASON_SOURCE_KEYS].sort()).toEqual([
      'def_fumble_rec', 'def_int', 'def_sack', 'def_safety', 'def_td', 'fg_40_49', 'fg_50_plus', 'fumbles_lost',
      'interceptions', 'pass_tds', 'pass_yards', 'pat_made', 'receiving_tds', 'receiving_yards', 'receptions', 'rush_tds', 'rush_yards',
    ])
  })

  it('V6d a K season line under Scout Standard: 9×3 + 8×3 + 42 = 93.00, fg_0_39 / fg_missed named', () => {
    expect(scorePreseasonLine(SCOUT_STD, 'K', { fg_made_40_plus: 9, fg_made_50_plus: 8, xp_made: 42 })).toEqual({ points: 93, unscored: ['fg_0_39', 'fg_missed'] })
  })

  it('V6e a D/ST season line WITHOUT points allowed is NOT a shutout: 52 + 15×2 + 11×2 + 3×6 = 122.00 (def_pa_0 would add 5), the PA/YA families named', () => {
    const scored = scorePreseasonLine(SCOUT_STD, 'DST', { def_sacks: 52, def_interceptions: 15, def_fumble_recoveries: 11, def_tds: 3 })
    expect(scored.points).toBe(122)
    expect(scored.unscored).toEqual([
      'def_block', 'def_pa_0', 'def_pa_14_17', 'def_pa_1_6', 'def_pa_28_34', 'def_pa_35_45', 'def_pa_46_plus', 'def_pa_7_13',
      'def_return_td', 'def_ya_0_99', 'def_ya_100_199', 'def_ya_200_299', 'def_ya_350_399', 'def_ya_400_449', 'def_ya_450_499',
      'def_ya_500_549', 'def_ya_550_plus',
    ])
  })

  it('V6f a QB season line: two_point_conversions is not scored and the three canonical 2-pt keys are named', () => {
    expect(scorePreseasonLine(SCOUT_STD, 'QB', { pass_yards: 4000, pass_tds: 30, two_point_conversions: 2 })).toEqual({
      points: 380,
      unscored: ['fumble_recovery_td', 'pass_2pt', 'rec_2pt', 'return_td', 'rush_2pt'],
    })
  })
})

// ---------------------------------------------------------------------------
// V7 — computePlayerValue's branches
// ---------------------------------------------------------------------------
describe('V7 computePlayerValue — freshness, absence named, NULL never zero', () => {
  const now = new Date('2099-09-24T12:00:00.000Z')
  const ctx = { league_id: 'L', season: 2099, week: 3, now }
  const base = { player_id: 'p', position: 'WR', seasonRows: [] as StatLineRow[], preseason: null }
  const line = { receiving_yards: 50, receiving_tds: 0.5 }

  it('V7a F387 boundary: a line EXACTLY 6 h old is fresh; 6 h + 1 ms is stale ⇒ NULL, named, its fetch instant kept', () => {
    expect(PROJECTION_MAX_AGE_MS).toBe(21_600_000)
    const fresh = computePlayerValue(SCOUT_STD, ctx, { ...base, weekly: { stats: line, fetched_at: '2099-09-24T06:00:00.000Z' } })
    expect([fresh.projected_points, fresh.projected_missing, fresh.projected_unscored, fresh.projection_fetched_at]).toEqual([
      8, null, ['fumble_recovery_td', 'return_td'], '2099-09-24T06:00:00.000Z',
    ])
    const stale = computePlayerValue(SCOUT_STD, ctx, { ...base, weekly: { stats: line, fetched_at: '2099-09-24T05:59:59.999Z' } })
    expect([stale.projected_points, stale.projected_missing, stale.projected_unscored, stale.projection_fetched_at]).toEqual([
      null, 'stale_line', null, '2099-09-24T05:59:59.999Z',
    ])
    expect(isFreshLine('not a date', now)).toBe(false)
  })

  it('V7b no line ⇒ NULL, "no_line", no fetch instant; a REAL projected 0.00 (Moss) is a value, not a NULL', () => {
    const none = computePlayerValue(SCOUT_STD, ctx, { ...base, weekly: null })
    expect([none.projected_points, none.projected_missing, none.projection_fetched_at]).toEqual([null, 'no_line', null])
    const zero = computePlayerValue(SCOUT_STD, ctx, { ...base, position: 'RB', weekly: { stats: mapToCanonicalKeys(find('13300').row.stats), fetched_at: '2099-09-24T11:40:00.000Z' } })
    expect([zero.projected_points, zero.projected_missing]).toEqual([0, null])
  })

  it('V7c preseason: THIS season\'s line scores; another season\'s is "other_season"; an unprojected player is "no_line" — and the week-1 shape is NULL season points + a preseason value', () => {
    const pre = (season: number | null, projected: boolean) =>
      computePlayerValue(SCOUT_STD, { ...ctx, week: 1 }, { ...base, weekly: null, preseason: { projected_stats: { receiving_yards: 800, receiving_tds: 5 }, projections_season: season, projected } })
    const week1 = pre(2099, true)
    expect([week1.season_points, week1.season_games, week1.preseason_points, week1.preseason_missing, week1.preseason_unscored]).toEqual([
      null, 0, 110, null, ['fumble_recovery_td', 'pass_2pt', 'rec_2pt', 'return_td', 'rush_2pt'],
    ])
    expect([pre(2098, true).preseason_points, pre(2098, true).preseason_missing]).toEqual([null, 'other_season'])
    expect([pre(2099, false).preseason_points, pre(2099, false).preseason_missing]).toEqual([null, 'no_line'])
  })

  it('V7d the row is stamped with the injected instant', () => {
    expect(computePlayerValue(SCOUT_STD, ctx, { ...base, weekly: null }).computed_at).toBe('2099-09-24T12:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// V8 — scope
// ---------------------------------------------------------------------------
describe('V8 the projected line\'s position scope — the worker\'s scope, WITHOUT its zero fill', () => {
  it('V8a a QB keeps only offense keys; a D/ST keeps its events AND the raw PA source; nothing is zero-filled', () => {
    expect(scopedProjectedLine({ pass_yards: 250, def_points_allowed: 0, def_sack: 1 }, 'QB')).toEqual({ pass_yards: 250 })
    expect(scopedProjectedLine({ def_sack: 3, def_points_allowed: 17.5, pass_yards: 9 }, 'DST')).toEqual({ def_sack: 3, def_points_allowed: 17.5 })
    expect(scopedProjectedLine({ pass_yards: Number.POSITIVE_INFINITY, pass_tds: 'x' }, 'QB')).toEqual({})
    expect(scopedProjectedLine({ pass_yards: 250 }, 'IDP')).toEqual({})
  })

  it('V8b a D/ST projected line WITHOUT points allowed scores its events only (no shutout tier), the PA family named', () => {
    const scored = scoreWeeklyProjection(SLEEPER_STD, 'DST', { def_sack: 3 })
    expect(scored.points).toBe(3)
    expect(scored.unscored).toEqual(['def_block', 'def_pa_0', 'def_pa_14_20', 'def_pa_1_6', 'def_pa_28_34', 'def_pa_35_plus', 'def_pa_7_13', 'def_return_td'])
  })
})

describe('V9 F387 — the compute bound and the lock-time read bound are ONE number (L.E1.21, migration 138)', () => {
  it('V9a the NEWEST migration defining lineup_autopilot_internal carries c_max_age = 6 hours, equal to PROJECTION_MAX_AGE_MS', () => {
    const dir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url))
    const definers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => /CREATE OR REPLACE FUNCTION (public\.)?lineup_autopilot_internal\(/.test(readFileSync(dir + f, 'utf8')))
    expect(definers.length).toBeGreaterThan(0)
    const newest = readFileSync(dir + definers[definers.length - 1]!, 'utf8')
    const m = newest.match(/c_max_age\s+CONSTANT INTERVAL := interval '(\d+) hours'/)
    expect(m, 'the read-side bound must be declared as a whole number of hours').not.toBeNull()
    expect(Number(m![1]) * 60 * 60 * 1000).toBe(PROJECTION_MAX_AGE_MS)
    expect(PROJECTION_MAX_AGE_MS).toBe(6 * 60 * 60 * 1000)
  })
})
