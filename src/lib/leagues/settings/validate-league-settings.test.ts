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
import { LEAGUE_SETTINGS_DEFAULTS, defaultsForTeamCount, derivePlayoffRounds, deriveRosterSize, leagueSettingsSchema, validateLeagueSettings } from './league-settings'

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
    // Fixtures below keep the Q10 seam consistent (start = regular + 1, regular
    // defaulting to 14 unless patched) so each probes the END arithmetic alone.
    // 12 playoff teams → 4 rounds × 1 week: start 15 → ends 18 (edge)
    expect(errorFields(settings({ playoff_teams: 12, playoff_start_week: 15 }))).toStrictEqual([])
    // 15-week season, start 16 → ends 19 (one past)
    expect(errorFields(settings({ regular_season_weeks: 15, playoff_teams: 12, playoff_start_week: 16 }))).toContain('playoff_start_week')
    // default 6-team bracket: 3 rounds; 13-week season, 2-week rounds from 14 → ends 19 (fails); 1-week rounds from 14 → 16 (passes)
    expect(errorFields(settings({ regular_season_weeks: 13, playoff_weeks_per_round: 2, playoff_start_week: 14 }))).toContain('playoff_start_week')
    expect(errorFields(settings({ regular_season_weeks: 13, playoff_start_week: 14 }))).toStrictEqual([])
    // 4 teams × 2-week rounds from 15 → ends 18 (edge, passes)
    expect(errorFields(settings({ playoff_teams: 4, playoff_weeks_per_round: 2, playoff_start_week: 15 }))).toStrictEqual([])
  })

  it('playoff_teams 0 (points-only champion) skips the arithmetic entirely', () => {
    // Seam-consistent pair (15+16) — the D60(5) skip covers the END arithmetic
    // only; the Q10 seam check applies even points-only (see the seam suite).
    expect(errorFields(settings({ playoff_teams: 0, regular_season_weeks: 15, playoff_start_week: 16, playoff_weeks_per_round: 2 }))).toStrictEqual([])
  })
})

describe('§7.3.8 bullet (Q10, v2.8.6): playoff_start_week = regular_season_weeks + 1 — strict continuity', () => {
  it('REGRESSION TRAP — the old Q10 live-probe overlap pair (regular 15 + start 14) now fails with the per-field message', () => {
    // Pre-ruling, this exact pair parsed clean AND passed validateLeagueSettings
    // (Q10 evidence / F25). A validator that loses the seam check re-accepts it.
    const result = validateLeagueSettings(settings({ regular_season_weeks: 15, playoff_start_week: 14 }))
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].field).toBe('playoff_start_week')
    expect(result.errors[0].message).toBe(
      'Playoffs must start the week after the regular season ends — week 16 for a 15-week regular season (currently week 14).',
    )
  })

  it('boundary pins: every legal (regular_season_weeks, playoff_start_week) edge passes — 12→13, 13→14, 14→15, 15→16', () => {
    for (const [regular, start] of [
      [12, 13],
      [13, 14],
      [14, 15],
      [15, 16],
    ] as const) {
      expect(errorFields(settings({ regular_season_weeks: regular, playoff_start_week: start }))).toStrictEqual([])
    }
  })

  it('the creation defaults (14 + 15) satisfy the seam — LEAGUE_SETTINGS_DEFAULTS and every defaultsForTeamCount stay clean', () => {
    expect(LEAGUE_SETTINGS_DEFAULTS.regular_season_weeks).toBe(14)
    expect(LEAGUE_SETTINGS_DEFAULTS.playoff_start_week).toBe(15)
    expect(validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS).errors).toStrictEqual([])
    for (const count of [8, 10, 12, 14, 16] as const) {
      expect(validateLeagueSettings(defaultsForTeamCount(count)).errors).toStrictEqual([])
    }
  })

  it('one past in both directions fails: overlap (start = regular) and gap (start = regular + 2)', () => {
    // overlap: 14-week season starting playoffs in week 14
    expect(errorFields(settings({ regular_season_weeks: 14, playoff_start_week: 14 }))).toContain('playoff_start_week')
    // gap: 12-week season starting playoffs in week 14 (week 13 belongs to nothing)
    expect(errorFields(settings({ regular_season_weeks: 12, playoff_start_week: 14 }))).toContain('playoff_start_week')
    // the widest expressible gap under the new 13–16 schema range: 12 + 16
    // (the old gap example 12 + 17 is now schema-unrepresentable — the range
    // pin in league-settings.test.ts rejects 17 at parse)
    expect(errorFields(settings({ regular_season_weeks: 12, playoff_start_week: 16 }))).toContain('playoff_start_week')
  })

  it('applies even when playoff_teams = 0 — the field is derived, not conditional (Q10 option (a))', () => {
    expect(errorFields(settings({ playoff_teams: 0, playoff_start_week: 16 }))).toContain('playoff_start_week')
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
    // (playoff_start_week patched alongside regular_season_weeks to keep the Q10 seam consistent)
    expect(errorFields(settings({ regular_season_weeks: 13, playoff_start_week: 14, trade_deadline_week: 14 }))).toContain('trade_deadline_week')
    expect(errorFields(settings({ regular_season_weeks: 13, playoff_start_week: 14, trade_deadline_week: 13 }))).toStrictEqual([])
    expect(errorFields(settings({ trade_deadline_week: null }))).toStrictEqual([])
  })
})

// 092/AP.1 (spec v2.13 §7.3.8): the bullet used to read
// `× auction_min_bid`; the field is retired and the reserve is derived from
// `auction_zero_dollar_nominations` — 1 OFF, 0 ON.
//
// **Reachability — CORRECTED (R456).** An earlier revision of this PR claimed
// the arm was unreachable through a schema-valid object because
// `deriveRosterSize` "tops out at 20 starters + 20 bench + 6 IR = 46". THAT
// WAS FALSE, and it was inferred from a printed spec bullet instead of being
// observed at the layer it named. **The 20-slot starting cap is not a schema
// bound** — it is a SIBLING ARM of this very validator (`league-settings.ts`,
// the `startingSum < 1 || startingSum > 20` push); `rosterSettingsSchema`
// declares `starting_slots: z.array(startingSlotSchema)` with **no `.max()`**,
// and bounds only each slot's `count` at 10. So `roster_size` is unbounded
// through Zod and the solvency arm fires on a Zod-valid object — pinned
// below, and at the API surface in `settings-round-trip-db.test.ts`.
//
// What IS true is a weaker and more useful statement: at reserve 1 the arm
// never fires ALONE, because anything that violates it also violates the
// roster-size arm beside it. That is redundancy between two arms of one
// validator, not dead code — and a guard recorded as vacuous is a guard the
// next session deletes, which is why the distinction is written down here and
// folded to the spec (v2.13.3) rather than left in a comment.
describe('§7.3.8 bullet: auction solvency — auction_budget ≥ roster_size × reserve', () => {
  const auction = (budget: number, zeroDollar = false): LeagueSettings => {
    const s = settings()
    s.draft = {
      ...s.draft,
      draft_type: 'auction',
      auction_budget: budget,
      auction_zero_dollar_nominations: zeroDollar,
    }
    return s
  }

  // 17 since SC.2 (v2.16.9 §7.3.2 Scout default roster, wr 2 → 3): the
  // default roster derives 10 starters + 6 bench + 1 IR.
  it('violating fixture: budget 10 against the default 17-spot roster at a $1 reserve (needs 17) → error on draft.auction_budget', () => {
    expect(deriveRosterSize(LEAGUE_SETTINGS_DEFAULTS.roster_settings)).toBe(17)
    const result = validateLeagueSettings(auction(10))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ field: 'draft.auction_budget' })
    expect(result.errors[0].message).toMatch(/needs at least 17/)
    // The remedy the message points at is the one that exists now.
    expect(result.errors[0].message).toMatch(/Allowing \$0 nominations removes the reserve\./)
  })

  it('D146 BOUNDARY at reserve 1: budget exactly roster_size passes; one dollar below fails', () => {
    expect(errorFields(auction(17))).toStrictEqual([])
    expect(errorFields(auction(16))).toContain('draft.auction_budget')
  })

  it('D146 BOUNDARY at reserve 0: the SAME $16 budget passes, and so does $0 — the floor is vacuous, not absent (§8.6.8)', () => {
    expect(errorFields(auction(16, true))).toStrictEqual([])
    expect(errorFields(auction(0, true))).toStrictEqual([])
    // …and the check is still RUNNING: nothing can be under a floor of 0, so
    // a negative budget (schema-impossible, constructed here) still trips it.
    expect(errorFields(auction(-1, true))).toContain('draft.auction_budget')
  })

  it('the floor applies to auction drafts only (the bullet is prefixed "Auction:")', () => {
    const snake = settings()
    snake.draft = { ...snake.draft, draft_type: 'snake', auction_budget: 10 }
    expect(errorFields(snake)).toStrictEqual([])
  })

  // R456 — THE PIN THAT WOULD HAVE CAUGHT THE FALSE PREMISE. It asserts the
  // reachability claim at the layer the claim is about: parse through Zod
  // FIRST (so "schema-valid" is observed, not assumed), then validate.
  it('the arm fires on a SCHEMA-VALID object — `starting_slots` has no array bound, so roster_size is unbounded through Zod', () => {
    const raw = structuredClone(LEAGUE_SETTINGS_DEFAULTS) as LeagueSettings
    raw.roster_settings = {
      ...raw.roster_settings,
      // Every slot is schema-legal (`count` ≤ 10); the ARRAY is unbounded.
      starting_slots: Array.from({ length: 30 }, (_, i) => ({
        key: `r456rb${i}`,
        label: `R456 RB ${i}`,
        eligible: ['RB' as const],
        count: 10,
      })),
    }
    raw.draft = { ...raw.draft, draft_type: 'auction', auction_budget: 50 }

    // 1. Zod admits it — the half the false premise got wrong.
    const parsed = leagueSettingsSchema.parse(raw)
    expect(deriveRosterSize(parsed.roster_settings)).toBe(307)

    // 2. …and the solvency arm fires on it, by field and by number.
    const result = validateLeagueSettings(parsed)
    const solvency = result.errors.find((e) => e.field === 'draft.auction_budget')
    expect(solvency?.message).toContain('307-player roster')
    expect(solvency?.message).toContain('needs at least 307')

    // 3. The TRUE statement about redundancy: it never fires alone — the
    //    roster-size arm of the SAME validator fires with it.
    expect(result.errors.map((e) => e.field)).toStrictEqual([
      'roster_settings.starting_slots',
      'draft.auction_budget',
    ])

    // 4. …and with $0 nominations ON the reserve is 0, so the solvency arm
    //    drops out while its sibling stays — the two are independent rules
    //    that merely happen to co-fire at reserve 1.
    const zeroDollar = leagueSettingsSchema.parse({
      ...raw,
      draft: { ...raw.draft, auction_zero_dollar_nominations: true },
    })
    expect(validateLeagueSettings(zeroDollar).errors.map((e) => e.field)).toStrictEqual([
      'roster_settings.starting_slots',
    ])
  })
})

describe('§7.3.8 bullet: roster_size × team_count ≤ draftable pool — WARNS (§7.3.2)', () => {
  // 12 × 17 = 204 since SC.2 (the Scout default roster, wr 2 → 3).
  it('violating fixture: pool one short of 12 × 17 = 204 → warning, not error', () => {
    const result = validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS, { draftablePoolSize: 203 })
    expect(result.valid).toBe(true)
    expect(result.errors).toStrictEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ field: 'roster_settings' })
    expect(result.warnings[0].message).toMatch(/204/)
  })

  it('boundary: pool exactly 204 → no warning; no ctx → no warning', () => {
    expect(validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS, { draftablePoolSize: 204 }).warnings).toStrictEqual([])
    expect(validateLeagueSettings(LEAGUE_SETTINGS_DEFAULTS).warnings).toStrictEqual([])
  })
})
