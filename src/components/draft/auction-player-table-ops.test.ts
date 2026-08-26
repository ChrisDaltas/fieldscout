import { describe, expect, it } from 'vitest'

import { forkTemplateDoc, resolveRules } from '@/lib/leagues/scoring/rules-doc'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'
import {
  AUCTION_COLUMNS,
  availableColumns,
  columnsAreDefault,
  columnsReducer,
  columnValue,
  decorateRows,
  DEFAULT_VISIBLE_COLUMNS,
  dollarsPerPoint,
  EMPTY_COPY,
  emptyReason,
  FAILURE_COPY,
  failureReason,
  filterRows,
  formatColumnValue,
  HALF_PPR_FLOOR,
  mergeSources,
  pointsPerWeek,
  PPR_FLOOR,
  projectedPointsFor,
  scoringFamilyFromRules,
  columnHeaderLabel,
  customizerGroups,
  SPLIT_GROUP_STAT_KEYS,
  SPLIT_STAT_KEYS,
  splitColumnAvailability,
  statSplits,
  tablePending,
  visibleColumns,
  type AuctionColumnKey,
  type AuctionPlayerSource,
  type ScoringFamily,
} from './auction-player-table-ops'

/**
 * Goldens for the auction player table's pure layer — M3 task L.C3.3
 * (spec §16.4's v2.10 player-table callout; §12.24/C42; tasks-M3 C43;
 * PROGRESS D194).
 *
 * Every number below is a STORED LITERAL, not a re-derivation: a test
 * that computes `value / points` to check `dollarsPerPoint` passes when
 * both are wrong the same way. The boundary instants are here on purpose
 * — the scoring-family cuts, a zero-point denominator, a priceless
 * player, the ÷-weeks rounding — because they are the inputs a derived
 * column meets on draft night and never in a demo.
 *
 * The C43 gate is pinned in BOTH directions, per COLUMN since Q16 (RULED
 * 2026-08-20; D202): the SHIPPED blob shape (measured off the local pool
 * — yards, TDs and receptions for the three phases, no volume field
 * anywhere) opens exactly the seven witnessed columns under FLAT labels,
 * and a blob completing a triple opens its volume column and REGROUPS
 * that group.
 */

// ---------------------------------------------------------------------------
// The projections blob, verbatim — the 18 keys `sync:projections` CAN emit
// (`sleeperProjectionToStatRow`, sleeper.ts:157). 17 of them are PRESENT in
// the pool RE-measured at AP.7 (588 blobs, these keys, nothing else);
// `def_safeties` is the writer's 18th and no measured row carried it, which
// is why the list here is one longer than the measurement. Either way there
// is no volume field — no attempts, no targets — which is the C43 fact the
// per-column gate now ships around (Q16).
// ---------------------------------------------------------------------------
const SHIPPED_BLOB_KEYS = [
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_yards',
  'rush_tds',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fumbles_lost',
  'two_point_conversions',
  'fg_made_40_plus',
  'fg_made_50_plus',
  'xp_made',
  'def_sacks',
  'def_interceptions',
  'def_fumble_recoveries',
  'def_tds',
  'def_safeties',
] as const

function blobOf(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key, index) => [key, index + 1]))
}

function source(over: Partial<AuctionPlayerSource> & { id: string }): AuctionPlayerSource {
  return {
    full_name: `Player ${over.id}`,
    position: 'RB',
    team: 'KC',
    adp: null,
    headshot_url: null,
    status: 'Active',
    auction_value: null,
    bye_week: null,
    sos: null,
    projected_pts_ppr: null,
    projected_pts_half_ppr: null,
    projected_pts_standard: null,
    projected_stats: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. Scoring family (§7.3.3's snapshot → which projection column)
// ---------------------------------------------------------------------------

describe('scoringFamilyFromRules — the league’s own rules pick the column', () => {
  const cases: Array<[number, ScoringFamily]> = [
    [0, 'standard'],
    [0.1, 'standard'],
    [0.24, 'standard'],
    [HALF_PPR_FLOOR, 'half_ppr'], // 0.25 — the boundary INSTANT, inclusive
    [0.5, 'half_ppr'],
    [0.74, 'half_ppr'],
    [PPR_FLOOR, 'ppr'], // 0.75 — inclusive
    [1, 'ppr'],
    [1.5, 'ppr'], // TE-premium-style values stay PPR
  ]
  for (const [receptions, family] of cases) {
    it(`receptions ${receptions} → ${family}`, () => {
      expect(scoringFamilyFromRules({ receptions })).toBe(family)
    })
  }

  it('the three shipped template values map to the three families', () => {
    // 058 seeds `receptions` at 0 / 0.5 / 1 across its six parity rows.
    expect([0, 0.5, 1].map((r) => scoringFamilyFromRules({ receptions: r }))).toEqual([
      'standard',
      'half_ppr',
      'ppr',
    ])
  })

  it('is NULL — never a default family — when the rules cannot be read', () => {
    // §16.5.4 "never wrong numbers": guessing half-PPR here would print a
    // plausible projection for a league scored some other way.
    expect(scoringFamilyFromRules(null)).toBeNull()
    expect(scoringFamilyFromRules(undefined)).toBeNull()
    expect(scoringFamilyFromRules({})).toBeNull()
    expect(scoringFamilyFromRules({ receptions: 'one' } as never)).toBeNull()
    expect(scoringFamilyFromRules({ receptions: Number.NaN })).toBeNull()
    expect(scoringFamilyFromRules([1, 2, 3] as never)).toBeNull()
    expect(scoringFamilyFromRules('ppr' as never)).toBeNull()
  })
})

describe('scoringFamilyFromRules — it reads THROUGH the format-2 envelope (SE.2(6) / F133)', () => {
  // Added BESIDE the flat cases above, never in place of them (§4 rule 5).
  // Those cases are exactly why this defect was invisible: a suite that only
  // ever passes `{ receptions: n }` stays green while every customized
  // auction room renders "Scoring not readable — projections hidden".
  const forkOf = (name: string) => {
    const t = SCORING_TEMPLATES.find((t) => t.name === name)
    if (!t) throw new Error(`template not found: ${name}`)
    return forkTemplateDoc(t.rules)
  }

  it('A FORKED TEMPLATE CLASSIFIES TO ITS TEMPLATE’S FAMILY — all six, fork vs flat', () => {
    for (const t of SCORING_TEMPLATES) {
      const fromTemplate = scoringFamilyFromRules(t.rules)
      expect(fromTemplate, `${t.name} must classify at all`).not.toBeNull()
      expect(
        scoringFamilyFromRules(forkTemplateDoc(t.rules) as never),
        `${t.name}: the fork must classify exactly like its template`,
      ).toBe(fromTemplate)
    }
  })

  it('the three shipped per-reception values survive the envelope', () => {
    expect(scoringFamilyFromRules(forkOf('ESPN Full PPR') as never)).toBe('ppr')
    expect(scoringFamilyFromRules(forkOf('Yahoo Half PPR') as never)).toBe('half_ppr')
    expect(scoringFamilyFromRules(forkOf('ESPN Standard') as never)).toBe('standard')
  })

  it('a PER-POSITION override of `receptions` is what the room reflects — the WR value wins', () => {
    // The classifier picks a whole-table column, so it asks the resolver for
    // the position `receptions` belongs to. A league that keeps 0 PPR
    // everywhere but pays WRs a full point is a PPR room.
    const doc = forkOf('ESPN Standard')
    doc.positions.WR = { receptions: 1 }
    expect(scoringFamilyFromRules(doc as never)).toBe('ppr')

    // …and an override on some OTHER position does not move the column.
    const teOnly = forkOf('ESPN Standard')
    teOnly.positions.TE = { receptions: 1.5 }
    expect(scoringFamilyFromRules(teOnly as never)).toBe('standard')
  })

  it('the boundary instants survive the envelope too (0.24 / 0.25 / 0.74 / 0.75)', () => {
    const at = (receptions: number) => {
      const doc = forkOf('ESPN Standard')
      doc.base.receptions = receptions
      return scoringFamilyFromRules(doc as never)
    }
    expect(at(0.24)).toBe('standard')
    expect(at(HALF_PPR_FLOOR)).toBe('half_ppr')
    expect(at(0.74)).toBe('half_ppr')
    expect(at(PPR_FLOOR)).toBe('ppr')
  })

  it('IS A STRICT NO-OP FOR FORMAT 1 — the flat answers are the STORED pre-SE.2 literals, and the mechanism is the identity', () => {
    // R583 — as first written this pin compared `f(x)` with `f(x)`, the same
    // call on both sides, so its loop could not fail for its stated reason:
    // it passed with the function stubbed to return `null` for every input.
    // The fix is the same rule this PR's headline finding is about — assert
    // against a value the code under test cannot supply.
    //
    // These nine are STORED LITERALS (D62): the families the PRE-SE.2
    // top-level read produced, transcribed. Nothing the resolver returns can
    // satisfy them by accident.
    const PRE_SE2_ANSWERS: ReadonlyArray<[number, ScoringFamily]> = [
      [0, 'standard'],
      [0.1, 'standard'],
      [0.24, 'standard'],
      [0.25, 'half_ppr'],
      [0.5, 'half_ppr'],
      [0.74, 'half_ppr'],
      [0.75, 'ppr'],
      [1, 'ppr'],
      [1.5, 'ppr'],
    ]
    for (const [receptions, family] of PRE_SE2_ANSWERS) {
      expect(
        scoringFamilyFromRules({ receptions }),
        `receptions ${receptions} must still answer ${family}`,
      ).toBe(family)
    }

    // …and the MECHANISM that makes "no-op" true rather than coincidental:
    // at this call site the resolver hands back the very document it was
    // given, so there is no copy in which a coefficient could drift.
    const flat = { receptions: 0.5 }
    expect(resolveRules(flat, 'WR')).toBe(flat)
  })

  it('an UNREADABLE document is null, never a guessed family and never a thrown render', () => {
    // §16.5.4's degraded rule. `resolveRules` fails loudly on an unknown
    // format; this surface turns that into the "Scoring not readable" state
    // rather than crashing the room mid-render.
    expect(scoringFamilyFromRules({ format: 3, base: { receptions: 1 } } as never)).toBeNull()
    expect(scoringFamilyFromRules({ format: 2 } as never)).toBeNull()
    expect(scoringFamilyFromRules({ format: 2, base: { receptions: 1 } } as never)).toBeNull()
    expect(
      scoringFamilyFromRules({ format: 2, base: {}, positions: {}, tier_cuts: {} } as never),
    ).toBeNull()
  })
})

describe('projectedPointsFor — one column per family, null when unknown', () => {
  const player = {
    projected_pts_ppr: 288.4,
    projected_pts_half_ppr: 251.9,
    projected_pts_standard: 215.4,
  }

  it('reads the family’s column and no other', () => {
    expect(projectedPointsFor(player, 'ppr')).toBe(288.4)
    expect(projectedPointsFor(player, 'half_ppr')).toBe(251.9)
    expect(projectedPointsFor(player, 'standard')).toBe(215.4)
  })

  it('an unknown family reads nothing at all', () => {
    expect(projectedPointsFor(player, null)).toBeNull()
  })

  it('a player with no projection in that family is null, not zero', () => {
    expect(
      projectedPointsFor(
        { projected_pts_ppr: null, projected_pts_half_ppr: 1, projected_pts_standard: 1 },
        'ppr',
      ),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. The derived columns — stored literals + boundary instants
// ---------------------------------------------------------------------------

describe('pointsPerWeek — season total ÷ REGULAR-SEASON WEEKS (§16.4)', () => {
  const golden: Array<[number, number, number]> = [
    // [season points, regular_season_weeks, expected]
    [280, 14, 20],
    [280, 12, 23.3],
    [280, 15, 18.7],
    [100, 14, 7.1], // 7.142857… → 1dp
    [249.7, 13, 19.2], // 19.2077… → 1dp
    [0, 14, 0],
    [-14, 14, -1], // a negative projection (D/ST blowouts) stays negative
  ]
  for (const [points, weeks, expected] of golden) {
    it(`${points} over ${weeks} weeks → ${expected}`, () => {
      expect(pointsPerWeek(points, weeks)).toBe(expected)
    })
  }

  it('is NOT points-per-GAME — 17 games and 14 weeks are different questions', () => {
    // The distinction the docblock argues: a 280-point season is 20.0 a
    // week in a 14-week league and 16.5 a game over 17 games. If this ever
    // returns 16.5, someone swapped `regular_season_weeks` for
    // `projected_games`.
    expect(pointsPerWeek(280, 14)).toBe(20)
    expect(pointsPerWeek(280, 14)).not.toBe(16.5)
  })

  it('no projection or no weeks ⇒ null (never a divide-by-zero Infinity)', () => {
    expect(pointsPerWeek(null, 14)).toBeNull()
    expect(pointsPerWeek(280, 0)).toBeNull()
    expect(pointsPerWeek(280, -1)).toBeNull()
    expect(pointsPerWeek(280, Number.NaN)).toBeNull()
  })
})

describe('dollarsPerPoint — cost ÷ projected points, LOWER is better', () => {
  const golden: Array<[number | null, number | null, number | null]> = [
    // [auction_value, projected points, expected]
    [60, 280, 0.21], // 0.214285… → 2dp
    [45, 210.5, 0.21], // 0.213776… → 2dp
    [7, 2, 3.5],
    [1, 3, 0.33], // 0.3333… → 2dp
    [0, 100, 0], // a $0 valuation over real points is a real 0
    [60, 0, null], // no denominator — "—" beats ∞
    [60, -5, null], // a negative projection is no denominator either
    [null, 280, null], // no cost to divide
    [60, null, null], // no projection to divide by
    [null, null, null],
  ]
  for (const [value, points, expected] of golden) {
    it(`$${value} over ${points} pts → ${expected}`, () => {
      expect(dollarsPerPoint(value, points)).toBe(expected)
    })
  }

  it('divides — it does not multiply (the plausible-wrong-answer pin)', () => {
    // $60 × 280 = 16800 and $60 ÷ 280 = 0.21 both render without
    // complaint; only the literal separates them.
    expect(dollarsPerPoint(60, 280)).toBe(0.21)
    expect(dollarsPerPoint(60, 280)).not.toBe(16800)
    // …and the ratio is cost-per-point, not points-per-dollar (4.67).
    expect(dollarsPerPoint(60, 280)).not.toBe(4.67)
  })
})

// ---------------------------------------------------------------------------
// 3. The C43 gate
// ---------------------------------------------------------------------------

describe('statSplits — numeric keys only, never coerced', () => {
  it('keeps finite numbers and drops everything else', () => {
    expect(
      statSplits({ rush_yards: 812, pass_yards: '4100', receptions: null, targets: 96.5 } as never),
    ).toEqual({ rush_yards: 812, targets: 96.5 })
  })

  it('an absent or malformed blob is {}', () => {
    expect(statSplits(null)).toEqual({})
    expect(statSplits(undefined)).toEqual({})
    expect(statSplits([1, 2] as never)).toEqual({})
    expect(statSplits('rush_yards' as never)).toEqual({})
  })
})

describe('splitColumnAvailability — the C43 gate, per COLUMN (Q16/D202)', () => {
  it('the SHIPPED blob shape opens EXACTLY the seven witnessed columns and regroups nothing', () => {
    // Q16's ruled outcome, pinned against the real feed (re-measured at
    // AP.7 on the local pool: 588 blobs; rush_yards 351 · rush_tds 141 ·
    // targets 0 · receptions 445 · receiving_yards 445 · receiving_tds
    // 292 · pass_yards 72 · pass_tds 72 · rush_attempts 0 ·
    // pass_attempts 0): yards and TDs exist for every phase, receptions
    // exists, and the VOLUME column of each triple exists nowhere.
    const rows = [{ splits: blobOf(SHIPPED_BLOB_KEYS) }]
    const availability = splitColumnAvailability(rows)
    expect(availability.columns).toEqual({
      rush_attempts: false,
      rush_yards: true,
      rush_tds: true,
      targets: false,
      receptions: true,
      receiving_yards: true,
      receiving_tds: true,
      pass_attempts: false,
      pass_yards: true,
      pass_tds: true,
    })
    // No triple is complete, so NO group may wear its header (D202(2)).
    expect(availability.groups).toEqual({
      rushing: false,
      receiving: false,
      passing: false,
    })
    // …and the table therefore offers the seven, as a stored literal.
    expect(availableColumns(availability).map((c) => c.key)).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
      'rush_yards',
      'rush_tds',
      'receptions',
      'receiving_yards',
      'receiving_tds',
      'pass_yards',
      'pass_tds',
    ])
  })

  it('a blob with yards+TDs and NO volume field opens exactly the SIX ruled columns', () => {
    // Q16's own sentence — "ship the six" — as a stored literal list,
    // not a count.
    const rows = [
      {
        splits: blobOf([
          'rush_yards',
          'rush_tds',
          'receiving_yards',
          'receiving_tds',
          'pass_yards',
          'pass_tds',
        ]),
      },
    ]
    const availability = splitColumnAvailability(rows)
    expect(availableColumns(availability).map((c) => c.key)).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
      'rush_yards',
      'rush_tds',
      'receiving_yards',
      'receiving_tds',
      'pass_yards',
      'pass_tds',
    ])
    expect(availability.groups).toEqual({
      rushing: false,
      receiving: false,
      passing: false,
    })
  })

  it('a COMPLETE triple opens its volume column and REGROUPS that group — F81\u2019s promise', () => {
    // The day the sync writes `rush_attempts`, the seventh column opens
    // and Rushing reassembles under its header, with no code change.
    const rows = [{ splits: blobOf([...SHIPPED_BLOB_KEYS, 'rush_attempts']) }]
    const availability = splitColumnAvailability(rows)
    expect(availability.columns.rush_attempts).toBe(true)
    expect(availability.groups).toEqual({
      rushing: true,
      receiving: false,
      passing: false,
    })
  })

  it('all ten keys ⇒ all ten columns and all three groups', () => {
    const rows = [{ splits: blobOf(SPLIT_STAT_KEYS) }]
    const availability = splitColumnAvailability(rows)
    expect(Object.values(availability.columns).every(Boolean)).toBe(true)
    expect(availability.groups).toEqual({
      rushing: true,
      receiving: true,
      passing: true,
    })
    expect(availableColumns(availability)).toHaveLength(AUCTION_COLUMNS.length)
  })

  it('the keys may be spread across ROWS — the feed is the subject, not the player', () => {
    // A QB\u2019s blob carries no rushing volume and an RB\u2019s carries no
    // passing attempts; the question the gate asks is whether the FEED
    // has the field, evidenced by anyone who has it.
    const rows = [
      { splits: blobOf(['rush_attempts', 'rush_yards']) },
      { splits: blobOf(['rush_tds']) },
    ]
    expect(splitColumnAvailability(rows).groups.rushing).toBe(true)
  })

  it('the gate\u2019s boundary: zero witnesses shuts a column, ONE opens it (D146)', () => {
    // An empty pool is no evidence, and a single row carrying a single
    // key is all the evidence the gate needs — key PRESENCE is the
    // predicate, so a stored 0 (a numeric key the blob does carry)
    // counts as a witness too.
    const empty = splitColumnAvailability([])
    expect(Object.values(empty.columns).some(Boolean)).toBe(false)
    expect(empty.groups).toEqual({ rushing: false, receiving: false, passing: false })
    expect(availableColumns(empty).map((c) => c.key)).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
    ])
    const one = splitColumnAvailability([{ splits: { rush_yards: 0 } }])
    expect(one.columns.rush_yards).toBe(true)
    expect(
      Object.entries(one.columns)
        .filter(([, open]) => open)
        .map(([key]) => key),
    ).toEqual(['rush_yards'])
  })

  it('every gated column\u2019s key IS its blob key, and the three lists agree', () => {
    // Three places name the same ten facts — the catalog\u2019s `statKey`,
    // the derived SPLIT_STAT_KEYS domain, and the regroup lists — and a
    // gate keyed off a spelling the catalog does not use would stay shut
    // forever while the data sat in the blob. The invariant is that they
    // are one set.
    const catalogKeys = AUCTION_COLUMNS.filter((c) => c.statKey !== undefined)
      .map((c) => c.statKey!)
      .sort()
    const groupKeys = Object.values(SPLIT_GROUP_STAT_KEYS).flat().sort()
    expect(catalogKeys).toEqual(groupKeys)
    expect(catalogKeys).toEqual([...SPLIT_STAT_KEYS].sort())
    expect(catalogKeys).toHaveLength(10)
    // …and the column key is the blob key, so a cell can never read a
    // different field from the one the gate proved exists.
    for (const column of AUCTION_COLUMNS) {
      if (column.statKey === undefined) continue
      expect(column.key).toBe(column.statKey)
      // D202(2): every split column carries the flat label it wears
      // while its group is incomplete.
      expect(column.flat).toBeTruthy()
    }
  })

  it('the gated columns are exactly the TEN split columns (§16.4\u2019s nine + receptions)', () => {
    const shut = splitColumnAvailability([])
    const open = splitColumnAvailability([{ splits: blobOf(SPLIT_STAT_KEYS) }])
    expect(AUCTION_COLUMNS.length - availableColumns(shut).length).toBe(10)
    expect(availableColumns(open).length).toBe(AUCTION_COLUMNS.length)
  })

  it('a gated column cannot be shown even if the stored visible set names it', () => {
    // The user\u2019s persisted set outlives a gate closing (a projections
    // rollback, a different environment) — the gate wins, so a column can
    // never render as a run of dashes.
    const visible = new Set<AuctionColumnKey>(['cost', 'rush_yards'])
    const shut = splitColumnAvailability([])
    expect(visibleColumns(visible, shut).map((c) => c.key)).toEqual(['cost'])
    const open = splitColumnAvailability([{ splits: blobOf(['rush_yards']) }])
    expect(visibleColumns(visible, open).map((c) => c.key)).toEqual(['cost', 'rush_yards'])
  })
})

describe('columnHeaderLabel / customizerGroups — flat labels, no half-group header (D202(2))', () => {
  const shipped = splitColumnAvailability([{ splits: blobOf(SHIPPED_BLOB_KEYS) }])

  it('the SHIPPED seven wear their FLAT labels, as stored literals', () => {
    const labels = availableColumns(shipped)
      .filter((c) => c.statKey !== undefined)
      .map((c) => columnHeaderLabel(c, shipped))
    expect(labels).toEqual([
      'Rush Yds',
      'Rush TDs',
      'Rec',
      'Rec Yds',
      'Rec TDs',
      'Pass Yds',
      'Pass TDs',
    ])
  })

  it('a COMPLETE group returns to the short grouped form; ungated columns are untouched', () => {
    const complete = splitColumnAvailability([
      { splits: blobOf([...SHIPPED_BLOB_KEYS, 'rush_attempts']) },
    ])
    const by = (key: AuctionColumnKey) => AUCTION_COLUMNS.find((c) => c.key === key)!
    expect(columnHeaderLabel(by('rush_yards'), complete)).toBe('Yds')
    expect(columnHeaderLabel(by('rush_attempts'), complete)).toBe('Att')
    // Receiving is still incomplete (no targets), so its columns stay flat.
    expect(columnHeaderLabel(by('receiving_yards'), complete)).toBe('Rec Yds')
    expect(columnHeaderLabel(by('cost'), complete)).toBe('$')
    expect(columnHeaderLabel(by('cost'), shipped)).toBe('$')
  })

  it('the customizer collects INCOMPLETE groups\u2019 columns under one flat "Splits" section', () => {
    const sections = customizerGroups(availableColumns(shipped), shipped)
    expect(sections.map((s) => s.label)).toEqual(['Value', 'Schedule', 'Splits'])
    expect(sections[2].columns.map((c) => c.key)).toEqual([
      'rush_yards',
      'rush_tds',
      'receptions',
      'receiving_yards',
      'receiving_tds',
      'pass_yards',
      'pass_tds',
    ])
  })

  it('a COMPLETE group gets its own overline back — the grouped presentation reassembles', () => {
    const complete = splitColumnAvailability([
      { splits: blobOf([...SHIPPED_BLOB_KEYS, 'rush_attempts']) },
    ])
    const sections = customizerGroups(availableColumns(complete), complete)
    expect(sections.map((s) => s.label)).toEqual(['Value', 'Schedule', 'Rushing', 'Splits'])
    expect(sections[2].columns.map((c) => c.key)).toEqual([
      'rush_attempts',
      'rush_yards',
      'rush_tds',
    ])
  })

  it('a pool with NO split data offers no Splits section at all — the empty answer is deliberate', () => {
    const none = splitColumnAvailability([])
    const sections = customizerGroups(availableColumns(none), none)
    expect(sections.map((s) => s.label)).toEqual(['Value', 'Schedule'])
  })
})

// ---------------------------------------------------------------------------
// 4. Cells
// ---------------------------------------------------------------------------

describe('columnValue / formatColumnValue', () => {
  const row = decorateRows({
    players: [
      source({
        id: 'p1',
        auction_value: 60,
        bye_week: 10,
        sos: 3,
        adp: 4.25,
        projected_pts_ppr: 280,
        projected_stats: { rush_yards: 812.4, rush_tds: 9 },
      }),
    ],
    picks: [],
    family: 'ppr',
    regularSeasonWeeks: 14,
    dndIds: new Set(),
    queuedIds: new Set(),
    favoriteIds: new Set(),
  })[0]

  it('reads each column off the row', () => {
    const by = (key: AuctionColumnKey) =>
      columnValue(row, AUCTION_COLUMNS.find((c) => c.key === key)!)
    expect(by('cost')).toBe(60)
    expect(by('dollars_per_point')).toBe(0.21)
    expect(by('proj_points')).toBe(280)
    expect(by('proj_points_week')).toBe(20)
    expect(by('bye')).toBe(10)
    expect(by('sos')).toBe(3)
    expect(by('adp')).toBe(4.25)
    expect(by('rush_yards')).toBe(812.4)
    expect(by('targets')).toBeNull() // absent from the blob
  })

  it('formats each column at its own precision, and null as an em-dash', () => {
    expect(formatColumnValue(60, 'cost')).toBe('$60')
    expect(formatColumnValue(0.21, 'dollars_per_point')).toBe('$0.21')
    expect(formatColumnValue(280, 'proj_points')).toBe('280.0')
    expect(formatColumnValue(20, 'proj_points_week')).toBe('20.0')
    expect(formatColumnValue(10, 'bye')).toBe('10')
    expect(formatColumnValue(3, 'sos')).toBe('3')
    expect(formatColumnValue(4.25, 'adp')).toBe('4.3')
    expect(formatColumnValue(812.4, 'rush_yards')).toBe('812.4')
    expect(formatColumnValue(9, 'rush_tds')).toBe('9')
    for (const key of ['cost', 'proj_points', 'bye', 'rush_yards'] as AuctionColumnKey[]) {
      expect(formatColumnValue(null, key)).toBe('—')
    }
  })

  it('a zero renders as zero — an em-dash means ABSENT, never 0', () => {
    expect(formatColumnValue(0, 'cost')).toBe('$0')
    expect(formatColumnValue(0, 'proj_points')).toBe('0.0')
  })
})

// ---------------------------------------------------------------------------
// 5. Row assembly
// ---------------------------------------------------------------------------

describe('decorateRows — prices, winners, and the three per-user marks', () => {
  const rows = decorateRows({
    players: [
      source({ id: 'won', auction_value: 40, projected_pts_half_ppr: 200 }),
      source({ id: 'undone', auction_value: 12 }),
      source({ id: 'free', auction_value: 3 }),
    ],
    picks: [
      { player_id: 'won', team_id: 'team-a', price: 37, is_undone: false },
      { player_id: 'undone', team_id: 'team-b', price: 99, is_undone: true },
    ],
    family: 'half_ppr',
    regularSeasonWeeks: 14,
    dndIds: new Set(['free']),
    queuedIds: new Set(['won']),
    favoriteIds: new Set(['undone']),
  })
  const byId = new Map(rows.map((row) => [row.id, row]))

  it('a live pick makes the row drafted, with its price and winner', () => {
    expect(byId.get('won')).toMatchObject({
      drafted: true,
      price: 37,
      wonByTeamId: 'team-a',
      queued: true,
    })
  })

  it('an UNDONE pick is not drafted (E4 returns the player to the pool)', () => {
    expect(byId.get('undone')).toMatchObject({
      drafted: false,
      price: null,
      wonByTeamId: null,
      favorite: true,
    })
  })

  it('marks decorate, they do not remove', () => {
    expect(byId.get('free')).toMatchObject({ dnd: true, drafted: false })
    expect(rows).toHaveLength(3)
  })

  it('derives both mirrors off the family’s column', () => {
    expect(byId.get('won')).toMatchObject({
      projectedPoints: 200,
      pointsPerWeek: 14.3, // 200 ÷ 14 = 14.2857…
      dollarsPerPoint: 0.2, // 40 ÷ 200
    })
  })
})

describe('mergeSources — the window plus the by-id read, deduped', () => {
  it('window order first, extras appended, first occurrence wins', () => {
    const merged = mergeSources(
      [source({ id: 'a' }), source({ id: 'b' })],
      [source({ id: 'b', full_name: 'SHOULD NOT WIN' }), source({ id: 'z' })],
    )
    expect(merged.map((row) => row.id)).toEqual(['a', 'b', 'z'])
    expect(merged[1].full_name).toBe('Player b')
  })

  it('an empty extra read changes nothing', () => {
    expect(mergeSources([source({ id: 'a' })], []).map((r) => r.id)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// 6. Filters
// ---------------------------------------------------------------------------

describe('filterRows — position · search · Favorites · Show Drafted', () => {
  const rows = decorateRows({
    players: [
      source({ id: 'rb1', full_name: 'Bijan Robinson', position: 'RB' }),
      source({ id: 'wr1', full_name: 'Ja’Marr Chase', position: 'WR' }),
      source({ id: 'rb2', full_name: 'Jahmyr Gibbs', position: 'RB' }),
    ],
    picks: [{ player_id: 'rb2', team_id: 'team-a', price: 44, is_undone: false }],
    family: 'ppr',
    regularSeasonWeeks: 14,
    dndIds: new Set(['rb1']),
    queuedIds: new Set(),
    favoriteIds: new Set(['wr1']),
  })
  const base = {
    rows,
    search: '',
    position: '',
    favoritesOnly: false,
    showDrafted: false,
    onlyListIds: null,
  }

  it('drops drafted players by default', () => {
    expect(filterRows(base).map((r) => r.id)).toEqual(['rb1', 'wr1'])
  })

  it('Show Drafted keeps them IN PLACE, greyed rather than hidden (§16.4)', () => {
    expect(filterRows({ ...base, showDrafted: true }).map((r) => r.id)).toEqual([
      'rb1',
      'wr1',
      'rb2',
    ])
  })

  it('position narrows', () => {
    expect(filterRows({ ...base, position: 'WR' }).map((r) => r.id)).toEqual(['wr1'])
  })

  it('search is case-insensitive and matches anywhere in the name', () => {
    expect(filterRows({ ...base, search: 'ROBIN' }).map((r) => r.id)).toEqual(['rb1'])
    expect(filterRows({ ...base, search: '  chase ' }).map((r) => r.id)).toEqual(['wr1'])
  })

  it('Favorites narrows to the is_favorites list', () => {
    expect(filterRows({ ...base, favoritesOnly: true }).map((r) => r.id)).toEqual(['wr1'])
  })

  it('“Only this list” narrows to the overlaid list’s ids (§8.9)', () => {
    expect(
      filterRows({ ...base, onlyListIds: new Set(['rb1', 'rb2']) }).map((r) => r.id),
    ).toEqual(['rb1'])
  })

  it('DND FILTERS NOTHING — it is a label (§12.24, C42 ruled display-only)', () => {
    // `rb1` is marked and still first in every result above. There is no
    // hide-DND filter and there must never be one: the mark is visual.
    expect(filterRows(base).map((r) => r.id)).toContain('rb1')
    expect(filterRows({ ...base, favoritesOnly: false }).some((r) => r.dnd)).toBe(true)
  })

  it('filters compose', () => {
    expect(
      filterRows({ ...base, showDrafted: true, position: 'RB', search: 'gibbs' }).map(
        (r) => r.id,
      ),
    ).toEqual(['rb2'])
  })
})

describe('emptyReason — say WHY it is empty, never just that it is', () => {
  // Non-zero SETTLED counts: the user has favourites and the overlaid list
  // has players, so "none of them match" is the true reason. The zero
  // cases are their own block below (R450).
  const base = {
    totalRows: 12,
    search: '',
    position: '',
    favoritesOnly: false,
    favoritesCount: 3,
    onlyList: false,
    onlyListCount: 5,
  }

  it('names the active filter', () => {
    expect(emptyReason({ ...base, search: 'zzz' })).toBe('filters')
    expect(emptyReason({ ...base, position: 'K' })).toBe('filters')
    expect(emptyReason({ ...base, favoritesOnly: true })).toBe('favorites')
    expect(emptyReason({ ...base, onlyList: true })).toBe('list')
  })

  it('A FILTER EXPLAINS EMPTINESS BEFORE "no pool" DOES (the browser-pass fix)', () => {
    // Search and position narrow SERVER-side, so a term matching nobody
    // empties `totalRows` itself. A `totalRows === 0` shortcut told a
    // user who typed "zzzz" that the player pool was empty — measured
    // live at 1280. Both directions pinned.
    expect(emptyReason({ ...base, totalRows: 0, search: 'zzzz' })).toBe('filters')
    expect(emptyReason({ ...base, totalRows: 0, position: 'K' })).toBe('filters')
    expect(emptyReason({ ...base, totalRows: 0, favoritesOnly: true })).toBe('favorites')
    expect(emptyReason({ ...base, totalRows: 0, onlyList: true })).toBe('list')
  })

  it('composed filters still get a TRUE sentence — search wins, and it is actionable', () => {
    expect(emptyReason({ ...base, search: 'zzz', favoritesOnly: true })).toBe('filters')
    expect(EMPTY_COPY.filters).toContain('Loosen the search')
  })

  it('an unfiltered empty view is "everyone is drafted", not "no players"', () => {
    expect(emptyReason(base)).toBe('all-drafted')
  })

  it('a genuinely empty pool — no rows AND no filter — says so', () => {
    expect(emptyReason({ ...base, totalRows: 0 })).toBe('no-pool')
  })

  it('every reason has designed copy (§16.5.4: empty is written, not blank)', () => {
    for (const key of Object.keys(EMPTY_COPY) as Array<keyof typeof EMPTY_COPY>) {
      expect(EMPTY_COPY[key].length).toBeGreaterThan(20)
    }
    expect(EMPTY_COPY['all-drafted']).toContain('Show drafted')
  })

  // -------------------------------------------------------------------
  // R450 / M3 batch 16 — an EMPTY SOURCE is not a failed match
  // -------------------------------------------------------------------

  it('zero favourites is "you have none", not "none of them match"', () => {
    // A user who has never favourited anybody read the SAME sentence as a
    // user whose 40 favourites were all drafted — "Turn Favorites off to
    // see the whole pool" is actionable, "None of your Favorites match"
    // is a claim about a filtering outcome that never happened.
    expect(emptyReason({ ...base, favoritesOnly: true, favoritesCount: 0 })).toBe('no-favorites')
    // …and the other direction: with favourites, it IS a failed match.
    expect(emptyReason({ ...base, favoritesOnly: true, favoritesCount: 1 })).toBe('favorites')
    expect(EMPTY_COPY['no-favorites']).toContain('haven’t favorited')
    expect(EMPTY_COPY.favorites).toContain('None of your Favorites match')
  })

  it('an EMPTY overlaid list is "no players on it yet", not "none still available"', () => {
    expect(emptyReason({ ...base, onlyList: true, onlyListCount: 0 })).toBe('empty-list')
    expect(emptyReason({ ...base, onlyList: true, onlyListCount: 1 })).toBe('list')
    expect(EMPTY_COPY['empty-list']).toContain('no players on it yet')
  })

  it('an EMPTY SOURCE outranks the search branch — loosening a filter cannot fix it', () => {
    // Composition, and the reason the two new branches are ordered FIRST:
    // "Loosen the search or position filter" is true but UNACTIONABLE when
    // the set being filtered by is itself empty.
    expect(
      emptyReason({ ...base, search: 'zzz', favoritesOnly: true, favoritesCount: 0 }),
    ).toBe('no-favorites')
    expect(emptyReason({ ...base, position: 'K', onlyList: true, onlyListCount: 0 })).toBe(
      'empty-list',
    )
    // A zero count with the filter OFF changes nothing.
    expect(emptyReason({ ...base, favoritesCount: 0, onlyListCount: 0 })).toBe('all-drafted')
    expect(emptyReason({ ...base, totalRows: 0, favoritesCount: 0, onlyListCount: 0 })).toBe(
      'no-pool',
    )
  })
})

// ---------------------------------------------------------------------------
// 6b. R444 — EVERY read reaches a load gate, never the empty state
// ---------------------------------------------------------------------------

describe('tablePending — an unsettled read never reaches emptyReason', () => {
  const settled = {
    poolPending: false,
    extrasPending: false,
    extraIdCount: 0,
    favoritesOnly: false,
    favoritesPending: false,
    onlyMode: false,
    overlayPending: false,
  }

  it('nothing pending ⇒ not loading', () => {
    expect(tablePending(settled)).toBe(false)
  })

  it('the pool is unconditional', () => {
    expect(tablePending({ ...settled, poolPending: true })).toBe(true)
  })

  it('the by-id read counts only when it was ASKED for something (R283)', () => {
    // Disabled queries report isPending forever — the whole table would
    // sit behind skeletons in the default view.
    expect(tablePending({ ...settled, extrasPending: true, extraIdCount: 0 })).toBe(false)
    expect(tablePending({ ...settled, extrasPending: true, extraIdCount: 4 })).toBe(true)
  })

  it('a PENDING favourites read is loading, not "you have no favourites"', () => {
    // The gap D194(13) left: it fixed the ERROR half only, so an in-flight
    // read still fell through to a designed empty sentence.
    expect(tablePending({ ...settled, favoritesOnly: true, favoritesPending: true })).toBe(true)
    expect(tablePending({ ...settled, favoritesOnly: false, favoritesPending: true })).toBe(false)
  })

  it('a PENDING overlay read is loading, not "no players on this list" (R444)', () => {
    expect(tablePending({ ...settled, onlyMode: true, overlayPending: true })).toBe(true)
    // `useLeagueListPlayers` is disabled without an overlay, so it pends
    // forever — off-mode must treat it as settled.
    expect(tablePending({ ...settled, onlyMode: false, overlayPending: true })).toBe(false)
  })
})

describe('failureReason — a failed read is an ERROR, never a designed empty state', () => {
  const clean = {
    poolError: false,
    extrasError: false,
    extraIdCount: 0,
    favoritesOnly: false,
    favoritesError: false,
    onlyMode: false,
    overlayError: false,
  }

  it('nothing failed ⇒ null (the empty state is reachable)', () => {
    expect(failureReason(clean)).toBe(null)
  })

  it('each source names ITSELF', () => {
    expect(failureReason({ ...clean, poolError: true })).toBe('pool')
    expect(failureReason({ ...clean, onlyMode: true, overlayError: true })).toBe('overlay')
    expect(failureReason({ ...clean, favoritesOnly: true, favoritesError: true })).toBe(
      'favorites',
    )
    expect(failureReason({ ...clean, extrasError: true, extraIdCount: 9 })).toBe('extras')
  })

  it('a filter read that failed while the filter is OFF is not this table’s problem', () => {
    // Both directions, for both filter-scoped sources: an unused filter's
    // failed read must not blank a table the user can still browse.
    expect(failureReason({ ...clean, favoritesError: true })).toBe(null)
    expect(failureReason({ ...clean, overlayError: true })).toBe(null)
    expect(failureReason({ ...clean, extrasError: true, extraIdCount: 0 })).toBe(null)
  })

  it('the pool outranks every filter — nothing else can be said honestly', () => {
    expect(
      failureReason({
        ...clean,
        poolError: true,
        onlyMode: true,
        overlayError: true,
        favoritesOnly: true,
        favoritesError: true,
      }),
    ).toBe('pool')
  })

  it('every failure has copy that names the SOURCE, not a generic apology', () => {
    expect(FAILURE_COPY.pool).toContain('player pool')
    expect(FAILURE_COPY.overlay).toContain('overlaid list')
    expect(FAILURE_COPY.favorites).toContain('Favorites')
    expect(FAILURE_COPY.extras).toContain('outside the browse window')
    for (const key of Object.keys(FAILURE_COPY) as Array<keyof typeof FAILURE_COPY>) {
      expect(FAILURE_COPY[key].length).toBeGreaterThan(20)
      // Never the empty-state vocabulary: an error must not read as a
      // designed "nothing matched".
      expect(FAILURE_COPY[key]).not.toContain('match')
    }
  })
})

// ---------------------------------------------------------------------------
// 7. The customizer's reducer
// ---------------------------------------------------------------------------

describe('columnsReducer — add, remove, reset (§16.4)', () => {
  it('the default is §16.4’s printed list — the DATA gate, not the default, keeps absent columns out', () => {
    // Q16/D202: the split keys live in the default so the ruled six (plus
    // receptions) render without a customizer visit, and F81's three
    // volume columns light up by themselves when the sync lands —
    // `visibleColumns` intersects this with the gate, so nothing here can
    // render a column the pool does not witness.
    expect(DEFAULT_VISIBLE_COLUMNS).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
      'rush_attempts',
      'rush_yards',
      'rush_tds',
      'targets',
      'receptions',
      'receiving_yards',
      'receiving_tds',
      'pass_attempts',
      'pass_yards',
      'pass_tds',
    ])
    expect(columnsAreDefault([...DEFAULT_VISIBLE_COLUMNS])).toBe(true)
  })

  it('toggle removes a shown column and adds a hidden one', () => {
    const without = columnsReducer([...DEFAULT_VISIBLE_COLUMNS], { type: 'toggle', column: 'sos' })
    expect(without).not.toContain('sos')
    expect(columnsAreDefault(without)).toBe(false)
    expect(columnsReducer(without, { type: 'toggle', column: 'sos' })).toEqual([
      ...DEFAULT_VISIBLE_COLUMNS,
    ])
  })

  it('re-added columns come back in CATALOG order, never at the end', () => {
    const dropped = columnsReducer([...DEFAULT_VISIBLE_COLUMNS], { type: 'toggle', column: 'cost' })
    expect(columnsReducer(dropped, { type: 'toggle', column: 'cost' })[0]).toBe('cost')
  })

  it('reset restores the default from ANY state, including empty', () => {
    expect(columnsReducer([], { type: 'reset' })).toEqual([...DEFAULT_VISIBLE_COLUMNS])
    expect(columnsReducer(['rush_yards'], { type: 'reset' })).toEqual([
      ...DEFAULT_VISIBLE_COLUMNS,
    ])
  })

  it('columnsAreDefault is order- and length-sensitive (the Reset control’s gate)', () => {
    expect(columnsAreDefault(['cost'])).toBe(false)
    expect(columnsAreDefault([...DEFAULT_VISIBLE_COLUMNS].reverse())).toBe(false)
  })
})
