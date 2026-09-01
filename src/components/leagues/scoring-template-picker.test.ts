/**
 * L.A2.3 scoring-template-picker — schema-fixture golden pins (tasks-M1
 * §4.3 UI scoping: "schema-fixture golden pins their task text names" +
 * the D39 browser pass in the session log — cite that sentence in the
 * self-review note).
 *
 * Pinned here:
 *   1. Compare-view derivation vs the templates.ts literals: for each of
 *      the 7 authored templates (the exact objects migrations 058 + 106 seed),
 *      `deriveTemplateSummary(rules)` deep-equals a STORED literal —
 *      PPR / INT / kicking tiers / D/ST model are derived from rules,
 *      never hand-maintained (§4.3a: literals below are stored, not
 *      recomputed).
 *   2. Exactly-7: a 7-row fixture yields exactly 7 cards in §7.3.3 table
 *      order (v2.16.9: Scout Scoring first), input-order independent, with NO invented slots — no
 *      FieldScout Alpha/Ultra teaser cards, no editor placeholders
 *      (explicit-absence pin; spec v2.7 + §16.5.5).
 *   3. Selection emission: each card carries its row's `scoring_systems.id`
 *      verbatim (what `onChange` emits as `scoring_system_id`).
 *   4. v2.8.5 visibility: both ESPN cards' description carries the Q9
 *      parity-exception line VERBATIM and untruncated (description
 *      passthrough is byte-identical to the row).
 *   5. §7.3.3 table metadata: one-liners verbatim; "(platform default)"
 *      markers on exactly Yahoo Half PPR + Sleeper Full PPR.
 */
import { describe, expect, it } from 'vitest'

import {
  ESPN_PARITY_EXCEPTION_NOTE,
  SCORING_TEMPLATES,
} from '@/lib/leagues/scoring/templates'

import {
  buildTemplateCards,
  deriveTemplateSummary,
  formatPoints,
  PLATFORM_DEFAULT_TEMPLATE_NAMES,
  TEMPLATE_DISPLAY_ORDER,
  TEMPLATE_ONE_LINERS,
  type ScoringTemplateRow,
  type TemplateSummary,
} from './scoring-template-picker-ops'

/**
 * The 7-row fetch fixture: the authored templates.ts objects (the exact
 * rules 058 + 106 seed and templates-db.test.ts proves DB-equivalent) with
 * synthetic row ids, DELIBERATELY shuffled out of §7.3.3 order — the DB
 * query promises no order.
 */
const FIXTURE_ROWS: ScoringTemplateRow[] = [3, 6, 0, 5, 2, 4, 1].map((i) => ({
  id: `row-${i + 1}`,
  name: SCORING_TEMPLATES[i].name,
  description: SCORING_TEMPLATES[i].description,
  rules: SCORING_TEMPLATES[i].rules,
}))

/**
 * GOLDEN PINS — the expected compare summaries, stored as literals from
 * App B.1/B.4 (+ the Q9-verified ESPN tables): PPR = `receptions`, INT
 * (ESPN −2 vs Yahoo/Sleeper −1), kicking tiers (Yahoo omits miss penalties
 * — null, not 0), D/ST split (ESPN `def_ya_*` present) vs single.
 */
const EXPECTED_SUMMARIES: Record<string, TemplateSummary> = {
  // Scout Scoring (App B.5 as marked up 2026-08-31; SC.1): no PPR as a
  // STATED difference, INT −2, flat FG 3s with fg_missed −1 (FG-specific —
  // pat_missed omitted), ESPN split D/ST.
  'Scout Scoring': {
    ppr: 0,
    int: -2,
    kicking: { fg0_39: 3, fg40_49: 3, fg50Plus: 3, patMade: 1, fgMissed: -1, patMissed: null },
    dstModel: 'split',
  },
  'ESPN Standard': {
    ppr: 0,
    int: -2,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: -1, patMissed: null },
    dstModel: 'split',
  },
  'ESPN Full PPR': {
    ppr: 1,
    int: -2,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: -1, patMissed: null },
    dstModel: 'split',
  },
  'Yahoo Standard': {
    ppr: 0,
    int: -1,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: null, patMissed: null },
    dstModel: 'single',
  },
  'Yahoo Half PPR': {
    ppr: 0.5,
    int: -1,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: null, patMissed: null },
    dstModel: 'single',
  },
  'Sleeper Standard': {
    ppr: 0,
    int: -1,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: -1, patMissed: -1 },
    dstModel: 'single',
  },
  'Sleeper Full PPR': {
    ppr: 1,
    int: -1,
    kicking: { fg0_39: 3, fg40_49: 4, fg50Plus: 5, patMade: 1, fgMissed: -1, patMissed: -1 },
    dstModel: 'single',
  },
}

describe('deriveTemplateSummary — golden pins vs templates.ts literals', () => {
  for (const template of SCORING_TEMPLATES) {
    it(`derives the ${template.name} compare summary`, () => {
      expect(deriveTemplateSummary(template.rules)).toEqual(
        EXPECTED_SUMMARIES[template.name],
      )
    })
  }

  it('detects the split D/ST model from def_ya_* presence alone (boundary)', () => {
    expect(deriveTemplateSummary({ def_ya_0_99: 5 }).dstModel).toBe('split')
    expect(deriveTemplateSummary({ def_pa_0: 10 }).dstModel).toBe('single')
    expect(deriveTemplateSummary({}).dstModel).toBe('single')
  })

  it('reports absent kicking keys as null, never 0 (Yahoo omits, not zeroes)', () => {
    const yahoo = SCORING_TEMPLATES.find((t) => t.name === 'Yahoo Standard')!
    expect('fg_missed' in yahoo.rules).toBe(false)
    expect(deriveTemplateSummary(yahoo.rules).kicking.fgMissed).toBeNull()
  })
})

describe('buildTemplateCards — exactly 7, §7.3.3 order, no invented slots', () => {
  const cards = buildTemplateCards(FIXTURE_ROWS)

  it('renders exactly one card per fetched row (7), in §7.3.3 table order — Scout first', () => {
    expect(cards).toHaveLength(7)
    // Stored literal — the §7.3.3 table order, not derived from the input.
    expect(cards.map((c) => c.name)).toEqual([
      'Scout Scoring',
      'ESPN Standard',
      'ESPN Full PPR',
      'Yahoo Standard',
      'Yahoo Half PPR',
      'Sleeper Standard',
      'Sleeper Full PPR',
    ])
  })

  it('is input-order independent', () => {
    const reversed = buildTemplateCards([...FIXTURE_ROWS].reverse())
    expect(reversed.map((c) => c.name)).toEqual(cards.map((c) => c.name))
  })

  it('invents NO extra slots — no Alpha/Ultra teasers, no placeholders (v2.7 + §16.5.5)', () => {
    expect(cards.map((c) => c.name)).not.toContain('FieldScout Alpha')
    expect(cards.map((c) => c.name)).not.toContain('FieldScout Ultra')
    // 1:1 with input — a picker fed N rows shows N cards, nothing more.
    expect(buildTemplateCards(FIXTURE_ROWS.slice(0, 4))).toHaveLength(4)
    expect(buildTemplateCards([])).toHaveLength(0)
  })

  it('preserves each row id verbatim for selection emission (scoring_system_id)', () => {
    const byName = new Map(FIXTURE_ROWS.map((r) => [r.name, r.id]))
    for (const card of cards) {
      expect(card.id).toBe(byName.get(card.name))
    }
  })

  it('carries the §7.3.3 one-liners verbatim (stored literals)', () => {
    const oneLiners = Object.fromEntries(cards.map((c) => [c.name, c.oneLiner]))
    expect(oneLiners).toEqual({
      'Scout Scoring':
        'One clean rule set. Every TD 6 — passing TDs included — every FG 3, ' +
        'no PPR, 0.1/yd rush+rec · 0.05/yd pass, −2 all turnovers. Full table ' +
        '+ basis: Appendix B.5',
      'ESPN Standard': "ESPN's defaults, 0 PPR",
      'ESPN Full PPR': "ESPN's defaults, 1.0 PPR",
      'Yahoo Standard': "Yahoo's defaults, 0 PPR (note: −1 INT)",
      'Yahoo Half PPR': "Yahoo's defaults, 0.5 PPR",
      'Sleeper Standard': "Sleeper's defaults, 0 PPR",
      'Sleeper Full PPR': "Sleeper's defaults, 1.0 PPR",
    })
  })

  it('marks exactly the two "(platform default)" rows (§7.3.3 table)', () => {
    expect(cards.filter((c) => c.isPlatformDefault).map((c) => c.name)).toEqual(
      ['Yahoo Half PPR', 'Sleeper Full PPR'],
    )
    expect(PLATFORM_DEFAULT_TEMPLATE_NAMES).toEqual([
      'Yahoo Half PPR',
      'Sleeper Full PPR',
    ])
  })

  it('R73: the marker copy is the §7.3.3 POSSESSIVE, not a generic "Platform default"', () => {
    const markers = Object.fromEntries(cards.map((c) => [c.name, c.platformDefaultMarker]))
    // The two default rows carry the platform's possessive; nobody else does.
    expect(markers['Yahoo Half PPR']).toBe("Yahoo's platform default")
    expect(markers['Sleeper Full PPR']).toBe("Sleeper's platform default")
    expect(markers['ESPN Standard']).toBeNull()
    expect(markers['Yahoo Standard']).toBeNull()
    // A card that is a platform default ALWAYS carries the possessive marker
    // (the two flags never disagree) — and the generic string is gone.
    for (const card of cards) {
      expect(card.isPlatformDefault).toBe(card.platformDefaultMarker !== null)
      expect(card.platformDefaultMarker).not.toBe('Platform default')
    }
  })

  it('passes each description through byte-identical — never truncated', () => {
    for (const card of cards) {
      const row = FIXTURE_ROWS.find((r) => r.name === card.name)!
      expect(card.description).toBe(row.description)
    }
  })

  it('keeps the Q9 ESPN parity-exception line verbatim on both ESPN cards (v2.8.5)', () => {
    const espnCards = cards.filter((c) => c.name.startsWith('ESPN '))
    expect(espnCards).toHaveLength(2)
    for (const card of espnCards) {
      expect(card.description).toContain(ESPN_PARITY_EXCEPTION_NOTE)
    }
    // And on no one else's.
    for (const card of cards.filter((c) => !c.name.startsWith('ESPN '))) {
      expect(card.description).not.toContain(ESPN_PARITY_EXCEPTION_NOTE)
    }
  })

  it('degrades gracefully on an unknown name (sorted last, derived one-liner, no marker)', () => {
    const stray: ScoringTemplateRow = {
      id: 'row-x',
      name: 'Mystery Template',
      description: null,
      rules: { receptions: 0.5 },
    }
    const withStray = buildTemplateCards([stray, ...FIXTURE_ROWS])
    expect(withStray).toHaveLength(8)
    const last = withStray[7]
    expect(last.name).toBe('Mystery Template')
    expect(last.oneLiner).toBe('0.5 PPR')
    expect(last.isPlatformDefault).toBe(false)
    expect(last.description).toBe('')
  })

  it('ops metadata covers the 7 §7.3.3 names exactly (drift guard vs templates.ts)', () => {
    expect(TEMPLATE_DISPLAY_ORDER).toEqual(SCORING_TEMPLATES.map((t) => t.name))
    expect(Object.keys(TEMPLATE_ONE_LINERS).sort()).toEqual(
      SCORING_TEMPLATES.map((t) => t.name).sort(),
    )
  })
})

describe('formatPoints — display literals', () => {
  it('renders a real minus sign, plain positives, and "—" for absent keys', () => {
    expect(formatPoints(-2)).toBe('−2')
    expect(formatPoints(0.5)).toBe('0.5')
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(1)).toBe('1')
    expect(formatPoints(null)).toBe('—')
  })
})
