/**
 * L.A1.6 — validateLeagueSettings tests: ONE VIOLATING FIXTURE PER §7.3.8
 * BULLET (task test item 3), each asserting the per-field error, plus the
 * cross-field "R"-column checks the per-field schema cannot express, and the
 * §4.3b boundary instants of every validator comparison.
 *
 * Fixtures are hand-built TS objects (casts where the schema would already
 * reject) — the validator must catch every bullet INDEPENDENTLY of schema
 * parsing (the API layer parses first, but a hand-built object can't skip
 * the §7.3.8 rules).
 */
import { describe, expect, it } from 'vitest'

import type { LeagueSettings, RosterSettings } from './league-settings'
import { LEAGUE_SETTINGS_DEFAULTS, derivePlayoffRounds, deriveRosterSize, validateLeagueSettings } from './league-settings'

function settings(patch: Partial<LeagueSettings> = {}): LeagueSettings {
  return { ...structuredClone(LEAGUE_SETTINGS_DEFAULTS), ...patch }
}

function roster(patch: Partial<RosterSettings> = {}): RosterSettings {
  return { ...structuredClone(LEAGUE_SETTINGS_DEFAULTS.roster_settings), ...patch }
}

function errorFields(s: LeagueSettings, ctx?: { draftablePoolSize?: number }): string[] {
  return validateLeagueSettings(s, ctx).errors.map((e) => e.field)
}

describe('§7.3.8 bullet: team_count ∈ {8,10,12,14,16}', () => {
  it('violating fixture: 9 teams → per-field error on team_count', () => {
    const result = validateLeagueSettings(settings({ team_count: 9 as unknown as LeagueSettings['team_count'] }))
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].field).toBe('team_count')
    expect(result.errors[0].message).toMatch(/8, 10, 12, 14, 16/)
  })

  it('boundaries: every legal count passes; 6 and 18 fail', () => {
    for (const count of [8, 10, 12, 14, 16] as const) {
      expect(errorFields(settings({ team_count: count }))).toStrictEqual([])
    }
    for (const count of [6, 18]) {
      expect(errorFields(settings({ team_count: count as unknown as LeagueSettings['team_count'] }))).toContain('team_count')
    }
  })
})

describe('§7.3.8 bullet: playoff_start_week + rounds×weeks_per_round − 1 ≤ 18', () => {
  it('rounds derivation: bracket next-power-of-two (⌈log2⌉)', () => {
    expect(derivePlayoffRounds(0)).toBe(0)
    expect(derivePlayoffRounds(2)).toBe(1)
    expect(derivePlayoffRounds(4)).toBe(2)
    expect(derivePlayoffRounds(6)).toBe(3)
    expect(derivePlayoffRounds(8)).toBe(3)
    expect(derivePlayoffRounds(10)).toBe(4)
    expect(derivePlayoffRounds(12)).toBe(4)
  })

  it('violating fixture: 12 teams × 2-week rounds from wk 15 ends wk 22 → error on playoff_start_week', () => {
    const result = validateLeagueSettings(settings({ playoff_teams: 12, playoff_weeks_per_round: 2, playoff_start_week: 15 }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'playoff_start_week' })
    expect(result.errors[0].message).toMatch(/week 22/)
  })

  it('boundary: ends exactly week 18 passes; one week later fails', () => {
    // 12 playoff teams → 4 rounds × 1 week: start 15 → ends 18 (edge)
    expect(errorFields(settings({ playoff_teams: 12, playoff_start_week: 15 }))).toStrictEqual([])
    // start 16 → ends 19 (one past)
    expect(errorFields(settings({ playoff_teams: 12, playoff_start_week: 16 }))).toContain('playoff_start_week')
    // default 6-team bracket: 3 rounds; 2-week rounds from 14 → ends 19 (fails); from wk 14 with 1-week rounds → 16 (passes)
    expect(errorFields(settings({ playoff_weeks_per_round: 2, playoff_start_week: 14 }))).toContain('playoff_start_week')
    expect(errorFields(settings({ playoff_start_week: 14 }))).toStrictEqual([])
    // 4 teams × 2-week rounds from 15 → ends 18 (edge, passes)
    expect(errorFields(settings({ playoff_teams: 4, playoff_weeks_per_round: 2, playoff_start_week: 15 }))).toStrictEqual([])
  })

  it('playoff_teams 0 (points-only champion) skips the arithmetic entirely', () => {
    expect(errorFields(settings({ playoff_teams: 0, playoff_start_week: 17, playoff_weeks_per_round: 2 }))).toStrictEqual([])
  })
})

describe('§7.3.1 R column: playoff_teams ≤ team_count', () => {
  it('violating fixture: 12-team bracket in a 10-team league → error on playoff_teams', () => {
    const result = validateLeagueSettings(settings({ team_count: 10, playoff_teams: 12, playoff_start_week: 15 }))
    expect(result.errors.map((e) => e.field)).toContain('playoff_teams')
  })

  it('boundary: playoff_teams = team_count passes', () => {
    expect(errorFields(settings({ team_count: 8, playoff_teams: 8 }))).toStrictEqual([])
  })
})

describe('§7.3.8 bullet: sum of starting slots ≥ 1 and ≤ 20', () => {
  it('violating fixture: all-zero starting counts → error on roster_settings.starting_slots', () => {
    const zeroed = roster()
    zeroed.starting_slots = zeroed.starting_slots.map((s) => ({ ...s, count: 0 }))
    const result = validateLeagueSettings(settings({ roster_settings: zeroed }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'roster_settings.starting_slots' })
    expect(result.errors[0].message).toMatch(/between 1 and 20/)
  })

  it('boundaries: sum 1 and sum 20 pass; sum 21 fails', () => {
    const one = roster()
    one.starting_slots = [{ key: 'qb', label: 'QB', eligible: ['QB'], count: 1 }]
    expect(errorFields(settings({ roster_settings: one }))).toStrictEqual([])

    const twenty = roster()
    twenty.starting_slots = [
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 10 },
      { key: 'wr', label: 'WR', eligible: ['WR'], count: 10 },
    ]
    expect(errorFields(settings({ roster_settings: twenty }))).toStrictEqual([])

    const twentyOne = roster()
    twentyOne.starting_slots = [
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 10 },
      { key: 'wr', label: 'WR', eligible: ['WR'], count: 10 },
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    ]
    expect(errorFields(settings({ roster_settings: twentyOne }))).toContain('roster_settings.starting_slots')
  })
})

describe('§7.3.8 bullet: unique slot keys', () => {
  it('violating fixture: two slots keyed "rb" → error naming the duplicate', () => {
    const dup = roster()
    dup.starting_slots = [
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
      { key: 'rb', label: 'RB 2', eligible: ['RB'], count: 1 },
    ]
    const result = validateLeagueSettings(settings({ roster_settings: dup }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'roster_settings.starting_slots' })
    expect(result.errors[0].message).toMatch(/rb/)
  })

  it('duplicate IR spot keys are rejected too', () => {
    const dup = roster({
      ir_slots: [
        { key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT'] },
        { key: 'ir1', type: 'unrestricted', eligible_designations: ['IR'] },
      ],
    })
    expect(errorFields(settings({ roster_settings: dup }))).toContain('roster_settings.ir_slots')
  })
})

describe('§7.3.8 bullet: non-empty eligible sets (flex ≥ 2 / single = 1 by construction)', () => {
  it('violating fixture: a slot with an empty eligible set → per-field error', () => {
    const empty = roster()
    empty.starting_slots = [
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
      { key: 'mystery', label: '?', eligible: [] as unknown as ['QB'], count: 1 },
    ]
    const result = validateLeagueSettings(settings({ roster_settings: empty }))
    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe('roster_settings.starting_slots')
    expect(result.errors[0].message).toMatch(/mystery/)
  })

  it('a duplicated position inside one eligible set is rejected (a set, not a bag)', () => {
    const dup = roster()
    dup.starting_slots = [{ key: 'flex1', label: 'W/R', eligible: ['WR', 'WR'], count: 1 }]
    expect(errorFields(settings({ roster_settings: dup }))).toContain('roster_settings.starting_slots')
  })

  it('single-position and 2+-position (flex) slots both pass', () => {
    const ok = roster()
    ok.starting_slots = [
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
      { key: 'flex1', label: 'W/R', eligible: ['WR', 'RB'], count: 1 },
    ]
    expect(errorFields(settings({ roster_settings: ok }))).toStrictEqual([])
  })
})

describe('§7.3.8 bullet: bench 0–20', () => {
  it('violating fixture: bench 21 → per-field error', () => {
    const result = validateLeagueSettings(settings({ roster_settings: roster({ bench: 21 }) }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'roster_settings.bench' })
  })

  it('boundaries: 0 and 20 pass; −1 fails', () => {
    expect(errorFields(settings({ roster_settings: roster({ bench: 0 }) }))).toStrictEqual([])
    expect(errorFields(settings({ roster_settings: roster({ bench: 20 }) }))).toStrictEqual([])
    expect(errorFields(settings({ roster_settings: roster({ bench: -1 }) }))).toContain('roster_settings.bench')
  })
})

describe('§7.3.8 bullet: 0–6 IR spots, each typed with ≥1 designation; restricted min_weeks ≥ 1', () => {
  const spot = (i: number) => ({ key: `ir${i}`, type: 'unrestricted' as const, eligible_designations: ['OUT' as const] })

  it('violating fixture: 7 IR spots → per-field error', () => {
    const result = validateLeagueSettings(settings({ roster_settings: roster({ ir_slots: [1, 2, 3, 4, 5, 6, 7].map(spot) }) }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'roster_settings.ir_slots' })
  })

  it('violating fixture: a spot with zero designations → per-field error naming the spot', () => {
    const bad = roster({ ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: [] as unknown as ['OUT'] }] })
    const result = validateLeagueSettings(settings({ roster_settings: bad }))
    expect(result.errors[0].field).toBe('roster_settings.ir_slots')
    expect(result.errors[0].message).toMatch(/ir1/)
  })

  it('violating fixture: restricted with min_weeks 0 → per-field error; 1 and 17 pass, 18 fails', () => {
    const restricted = (weeks: number) =>
      roster({ ir_slots: [{ key: 'dl1', type: 'restricted', eligible_designations: ['OUT'], min_weeks: weeks }] })
    expect(errorFields(settings({ roster_settings: restricted(0) }))).toContain('roster_settings.ir_slots')
    expect(errorFields(settings({ roster_settings: restricted(1) }))).toStrictEqual([])
    expect(errorFields(settings({ roster_settings: restricted(17) }))).toStrictEqual([])
    expect(errorFields(settings({ roster_settings: restricted(18) }))).toContain('roster_settings.ir_slots')
  })

  it('0 IR spots and 6 IR spots both pass', () => {
    expect(errorFields(settings({ roster_settings: roster({ ir_slots: [] }) }))).toStrictEqual([])
    expect(errorFields(settings({ roster_settings: roster({ ir_slots: [1, 2, 3, 4, 5, 6].map(spot) }) }))).toStrictEqual([])
  })
})

describe('§7.3.5 R columns: veto votes and trade deadline (cross-field)', () => {
  it('violating fixture: league_vote with votes > team_count → error on trade_veto_votes', () => {
    const result = validateLeagueSettings(settings({ team_count: 10, trade_review: 'league_vote', trade_veto_votes: 11 }))
    expect(result.errors.map((e) => e.field)).toContain('trade_veto_votes')
  })

  it('boundary: votes = team_count passes; the check only applies under league_vote', () => {
    expect(errorFields(settings({ team_count: 10, trade_review: 'league_vote', trade_veto_votes: 10 }))).toStrictEqual([])
    // not league_vote → the votes field is inert (stored but unused)
    expect(errorFields(settings({ team_count: 10, trade_review: 'commissioner', trade_veto_votes: 16 }))).toStrictEqual([])
  })

  it('violating fixture: deadline past the regular season → error on trade_deadline_week; edge passes; null (off) passes', () => {
    expect(errorFields(settings({ regular_season_weeks: 13, trade_deadline_week: 14 }))).toContain('trade_deadline_week')
    expect(errorFields(settings({ regular_season_weeks: 13, trade_deadline_week: 13 }))).toStrictEqual([])
    expect(errorFields(settings({ trade_deadline_week: null }))).toStrictEqual([])
  })
})

describe('§7.3.8 bullet: auction solvency — auction_budget ≥ roster_size × auction_min_bid', () => {
  const auction = (budget: number, minBid: number): LeagueSettings => {
    const s = settings()
    s.draft = { ...s.draft, draft_type: 'auction', auction_budget: budget, auction_min_bid: minBid }
    return s
  }

  it('violating fixture: budget 50, min bid 5, default 16-spot roster (needs 80) → error on draft.auction_budget', () => {
    expect(deriveRosterSize(LEAGUE_SETTINGS_DEFAULTS.roster_settings)).toBe(16)
    const result = validateLeagueSettings(auction(50, 5))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'draft.auction_budget' })
    expect(result.errors[0].message).toMatch(/80/)
  })

  it('boundary: budget exactly roster_size × min_bid passes; one below fails', () => {
    expect(errorFields(auction(80, 5))).toStrictEqual([])
    expect(errorFields(auction(79, 5))).toContain('draft.auction_budget')
  })

  it('the floor applies to auction drafts only (the bullet is prefixed "Auction:")', () => {
    const snake = settings()
    snake.draft = { ...snake.draft, draft_type: 'snake', auction_budget: 50, auction_min_bid: 5 }
    expect(errorFields(snake)).toStrictEqual([])
  })
})

describe('§7.3.8 bullet: roster_size × team_count ≤ draftable pool — WARNS (§7.3.2)', () => {
  it('violating fixture: pool one short of 12 × 16 = 192 → warning, not error', () => {
    const result = validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS, { draftablePoolSize: 191 })
    expect(result.valid).toBe(true)
    expect(result.errors).toStrictEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ field: 'roster_settings' })
    expect(result.warnings[0].message).toMatch(/192/)
  })

  it('boundary: pool exactly 192 → no warning; no ctx → no warning', () => {
    expect(validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS, { draftablePoolSize: 192 }).warnings).toStrictEqual([])
    expect(validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS).warnings).toStrictEqual([])
  })
})
