/**
 * F576 parity (PROGRESS D537): the Stats Center (`/api/players/builder`)
 * and the player page's core-stats row score a stored season the SAME way —
 * both through `presetSeasonPoints` (canonical engine, shipped ESPN
 * templates, each week alone). Golden values are stored literals,
 * hand-checked against the ESPN template rules (comments per line).
 */
import { describe, expect, it } from 'vitest'

import { seasonToDate } from '@/lib/leagues/scoring/player-values'
import { normalizePosition, type StatLineRow } from '@/lib/leagues/scoring/score-week-worker'
import { calculateFantasyPoints, HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING, sumStatRows } from '@/lib/scoring/default'

import { systemRules as coreStatsSystemRules } from './core-stats-service'
import { builderSeasonPoints, PRESET_BY_BUILDER_KEY, presetSeasonPoints, systemRules } from './preset-scoring'

const line = (playerId: string, week: number, stats: Record<string, number | null>): StatLineRow => ({
  player_id: playerId,
  week,
  updated_at: '2026-10-01T00:00:00Z',
  advanced: {},
  ...stats,
})

const WR = [
  line('wr', 1, { receptions: 6, receiving_yards: 85, receiving_tds: 1, targets: 9 }),
  line('wr', 2, { receptions: 4, receiving_yards: 40, receiving_tds: 0, fumbles_lost: 1 }),
]
// K: 3 FGs (one 0-39, one 40-49, one 50+), 2 PATs, one missed FG.
const K = [line('k', 1, { fg_made: 3, fg_attempted: 4, fg_0_39: 1, fg_made_40_plus: 1, fg_made_50_plus: 1, fg_missed: 1, xp_made: 2, xp_attempted: 2 })]
// D/ST: 3 sacks, 1 INT, 10 points allowed, 290 yards allowed.
const DEF = [line('dst', 1, { def_sacks: 3, def_interceptions: 1, def_points_allowed: 10, def_yards_allowed: 290 })]

describe('F576 — one preset scorer for the Stats Center and the player page', () => {
  it('the player page and the Stats Center read the SAME rules object source', () => {
    for (const s of ['espn_standard', 'half_ppr', 'ppr'] as const) expect(coreStatsSystemRules(s)).toEqual(systemRules(s))
    expect(PRESET_BY_BUILDER_KEY).toEqual({ standard: 'espn_standard', half_ppr: 'half_ppr', ppr: 'ppr' })
  })

  it('R1580 parity against STORED literals — the Stats Center number per preset × position, hand-checked from the templates', () => {
    // WR: see the golden pin below. K (ESPN): 0-39 3 + 40-49 4 + 50+ 5 + PAT 2 − missed FG 1 = 13 (receptions irrelevant).
    // DST (ESPN): 3 sacks × 1 + 1 INT × 2 + PA 10 → def_pa_7_13 = 3 + YA 290 → def_ya_200_299 = 2 = 10.
    const expected: Record<string, Record<string, number>> = {
      standard: { WR: 16.5, K: 13, DEF: 10 },
      half_ppr: { WR: 21.5, K: 13, DEF: 10 },
      ppr: { WR: 26.5, K: 13, DEF: 10 },
    }
    const rows: Record<string, [string, StatLineRow[]]> = { WR: ['wr', WR], K: ['k', K], DEF: ['dst', DEF] }
    for (const [builderKey, preset] of Object.entries(PRESET_BY_BUILDER_KEY)) {
      for (const [pos, [id, r]] of Object.entries(rows)) {
        expect(builderSeasonPoints(preset, id, pos, r), `${builderKey} ${pos}`).toBe(expected[builderKey][pos])
      }
    }
  })

  it('R1580: the legacy calculator disagreed on D/ST too — no points- or yards-allowed tiers (5 vs ESPN 10)', () => {
    expect(calculateFantasyPoints(sumStatRows(DEF as never), STANDARD_SCORING)).toBe(5)
    expect(presetSeasonPoints('espn_standard', 'dst', 'DEF', DEF).points).toBe(10)
  })

  it('parity: the Stats Center number equals the core-stats engine path, every preset × position', () => {
    const cases: Array<[string, string, StatLineRow[]]> = [
      ['wr', 'WR', WR],
      ['k', 'K', K],
      ['dst', 'DEF', DEF],
    ]
    for (const [builderKey, preset] of Object.entries(PRESET_BY_BUILDER_KEY)) {
      for (const [id, pos, rows] of cases) {
        // The player page's computation (computePoolStandings' own call).
        const page = seasonToDate(systemRules(preset), id, normalizePosition(pos), rows).points!
        expect(builderSeasonPoints(preset, id, pos, rows), `${builderKey} ${pos}`).toBe(Math.round(page * 10) / 10)
      }
    }
  })

  it('golden pins (stored literals)', () => {
    // WR: 125 yds × 0.1 = 12.5, 1 TD = 6, fumble −2 → 16.5; + 10 catches.
    expect(presetSeasonPoints('espn_standard', 'wr', 'WR', WR).points).toBe(16.5)
    expect(presetSeasonPoints('half_ppr', 'wr', 'WR', WR).points).toBe(21.5)
    expect(presetSeasonPoints('ppr', 'wr', 'WR', WR).points).toBe(26.5)
    expect(presetSeasonPoints('ppr', 'wr', 'WR', WR).games).toBe(2)
    // K (ESPN): 0-39 = 3, 40-49 = 4, 50+ = 5, PAT 1 × 2, missed FG −1 → 13.
    expect(presetSeasonPoints('ppr', 'k', 'K', K).points).toBe(13)
    // No lines → null, never 0.
    expect(presetSeasonPoints('ppr', 'x', 'WR', []).points).toBeNull()
    expect(builderSeasonPoints('ppr', 'x', 'WR', [])).toBe(0)
  })

  it('the legacy calculator disagreed (why F576 existed): it paid fg_made × 3 on top of the distance bonuses', () => {
    const legacyK = calculateFantasyPoints(sumStatRows(K as never), PPR_SCORING)
    expect(legacyK).toBe(20) // 3×3 + 4 + 5 + 2 — not ESPN's 13
    expect(builderSeasonPoints('ppr', 'k', 'K', K)).toBe(13)
    // For a plain receiving line the two always agreed — the change is K/DST.
    expect(calculateFantasyPoints(sumStatRows(WR as never), STANDARD_SCORING)).toBe(16.5)
    expect(calculateFantasyPoints(sumStatRows(WR as never), HALF_PPR_SCORING)).toBe(21.5)
  })
})
