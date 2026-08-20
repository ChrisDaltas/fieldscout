import { describe, expect, it } from 'vitest'

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
  filterRows,
  formatColumnValue,
  HALF_PPR_FLOOR,
  mergeSources,
  pointsPerWeek,
  PPR_FLOOR,
  projectedPointsFor,
  scoringFamilyFromRules,
  SPLIT_GROUP_STAT_KEYS,
  splitGroupAvailability,
  statSplits,
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
 * The C43 gate is pinned in BOTH directions the banner asks for: the
 * SHIPPED blob shape (measured off the local pool — yards and TDs for all
 * three phases, no volume field anywhere) leaves all three groups shut,
 * and a blob carrying a complete triple opens exactly that one.
 */

// ---------------------------------------------------------------------------
// The shipped projections blob, verbatim — the 17 keys `sync:projections`
// actually writes (`sleeperProjectionToStatRow`, sleeper.ts:157), measured
// on the local pool at build time: 590 blobs, these keys, nothing else.
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

describe('splitGroupAvailability — the C43 gate, both directions', () => {
  it('the SHIPPED blob shape leaves all three groups SHUT', () => {
    // This is C43's ruled outcome, pinned against the real feed rather
    // than against a flag: yards and TDs exist for every phase, and the
    // VOLUME column of each triple (rush_attempts / targets /
    // pass_attempts) exists nowhere.
    const rows = [{ splits: blobOf(SHIPPED_BLOB_KEYS) }]
    expect(splitGroupAvailability(rows)).toEqual({
      rushing: false,
      receiving: false,
      passing: false,
    })
  })

  it('a blob carrying a COMPLETE triple opens exactly that group', () => {
    const rows = [{ splits: blobOf([...SHIPPED_BLOB_KEYS, 'rush_attempts']) }]
    expect(splitGroupAvailability(rows)).toEqual({
      rushing: true,
      receiving: false,
      passing: false,
    })
  })

  it('all three triples ⇒ all three groups', () => {
    const rows = [
      {
        splits: blobOf([
          ...SPLIT_GROUP_STAT_KEYS.rushing,
          ...SPLIT_GROUP_STAT_KEYS.receiving,
          ...SPLIT_GROUP_STAT_KEYS.passing,
        ]),
      },
    ]
    expect(splitGroupAvailability(rows)).toEqual({
      rushing: true,
      receiving: true,
      passing: true,
    })
  })

  it('the keys may be spread across ROWS — the feed is the subject, not the player', () => {
    // A QB's blob carries no rushing volume and an RB's carries no passing
    // attempts; the question the gate asks is whether the FEED has the
    // field, evidenced by anyone who has it.
    const rows = [
      { splits: blobOf(['rush_attempts', 'rush_yards']) },
      { splits: blobOf(['rush_tds']) },
    ]
    expect(splitGroupAvailability(rows).rushing).toBe(true)
  })

  it('an empty pool opens nothing (no rows ⇒ no evidence)', () => {
    expect(splitGroupAvailability([])).toEqual({
      rushing: false,
      receiving: false,
      passing: false,
    })
  })

  it('every gated column’s key IS its blob key, and the two lists agree', () => {
    // Two places name the same nine facts — the catalog's `statKey` and
    // the gate's per-group list — and a gate keyed off a spelling the
    // catalog does not use would stay shut forever while the data sat in
    // the blob. The invariant is that they are one set.
    const catalogKeys = AUCTION_COLUMNS.filter((c) => c.statKey !== undefined)
      .map((c) => c.statKey!)
      .sort()
    const gateKeys = Object.values(SPLIT_GROUP_STAT_KEYS).flat().sort()
    expect(catalogKeys).toEqual(gateKeys)
    expect(catalogKeys).toHaveLength(9)
    // …and the column key is the blob key, so a cell can never read a
    // different field from the one the gate proved exists.
    for (const column of AUCTION_COLUMNS) {
      if (column.statKey === undefined) continue
      expect(column.key).toBe(column.statKey)
    }
  })

  it('the gated columns are exactly the nine §16.4 split columns', () => {
    const shut = { rushing: false, receiving: false, passing: false }
    const open = { rushing: true, receiving: true, passing: true }
    expect(AUCTION_COLUMNS.length - availableColumns(shut).length).toBe(9)
    expect(availableColumns(open).length).toBe(AUCTION_COLUMNS.length)
    expect(availableColumns(shut).map((c) => c.key)).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
    ])
  })

  it('a gated column cannot be shown even if the stored visible set names it', () => {
    // The user's persisted set outlives a gate closing (a projections
    // rollback, a different environment) — the gate wins, so a column can
    // never render as a run of dashes.
    const visible = new Set<AuctionColumnKey>(['cost', 'rush_yards'])
    const shut = { rushing: false, receiving: false, passing: false }
    expect(visibleColumns(visible, shut).map((c) => c.key)).toEqual(['cost'])
    const open = { rushing: true, receiving: false, passing: false }
    expect(visibleColumns(visible, open).map((c) => c.key)).toEqual(['cost', 'rush_yards'])
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
  const base = {
    totalRows: 12,
    search: '',
    position: '',
    favoritesOnly: false,
    onlyList: false,
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
})

// ---------------------------------------------------------------------------
// 7. The customizer's reducer
// ---------------------------------------------------------------------------

describe('columnsReducer — add, remove, reset (§16.4)', () => {
  it('starts at the seven ungated columns', () => {
    expect(DEFAULT_VISIBLE_COLUMNS).toEqual([
      'cost',
      'dollars_per_point',
      'proj_points',
      'proj_points_week',
      'bye',
      'sos',
      'adp',
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
