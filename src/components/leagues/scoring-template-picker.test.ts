/**
 * L.A2.3 scoring-template-picker — schema-fixture golden pins (tasks-M1
 * §4.3 UI scoping: "schema-fixture golden pins their task text names" +
 * the D39 browser pass in the session log — cite that sentence in the
 * self-review note).
 *
 * Pinned here:
 *   1. Compare-view derivation vs the templates.ts literals: for each of
 *      the 8 authored templates (the exact objects migrations 058 + 106 +
 *      108 seed), `deriveTemplateSummary(rules)` deep-equals a STORED
 *      literal — PPR / INT / kicking tiers / D/ST model are derived from
 *      rules, never hand-maintained (§4.3a: literals below are stored, not
 *      recomputed).
 *   2. Exactly-8: an 8-row fixture yields exactly 8 cards in §7.3.3 table
 *      order (v2.16.11: the Scout pair first), input-order independent,
 *      with NO invented slots — no FieldScout Alpha/Ultra teaser cards, no
 *      editor placeholders (explicit-absence pin; spec v2.7 + §16.5.5).
 *   3. Selection emission: each card carries its row's `scoring_systems.id`
 *      verbatim (what `onChange` emits as `scoring_system_id`).
 *   4. v2.8.5 visibility: both ESPN cards' description carries the Q9
 *      parity-exception line VERBATIM and untruncated (description
 *      passthrough is byte-identical to the row).
 *   5. Card metadata: the six parity one-liners §7.3.3-verbatim + Scout
 *      Standard's B.5-approved trim (SC.3/D282) + Scout PPR's approved
 *      one-liner (SC.4/B.5.1); "(platform default)" markers on exactly
 *      Yahoo Half PPR + Sleeper Full PPR; "FieldScout's default" per
 *      B.5.1's marker law — unfiltered on exactly Scout Standard (the
 *      system default), and on the family's own Scout when a family is
 *      passed.
 *   6. SC.3/SC.4 preselection ops (§7.3.3's system-default bullet, per
 *      family since v2.16.11): `resolveDefaultTemplateId` resolves the
 *      family's Scout by NATURAL KEY (name under is_template — never a
 *      hardcoded uuid, never input position; no_ppr/omitted → Scout
 *      Standard, ppr → Scout PPR), warns LOUDLY naming whichever half is
 *      absent and returns null when that row is missing (the "nothing
 *      happened" rule: a missing seed must not silently un-default), and
 *      `effectiveTemplateSelection` lets an explicit pick ALWAYS win.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ESPN_PARITY_EXCEPTION_NOTE,
  SCORING_TEMPLATES,
} from '@/lib/leagues/scoring/templates'

import {
  buildTemplateCards,
  DEFAULT_TEMPLATE_MARKER,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_TEMPLATE_NAMES,
  deriveTemplateSummary,
  effectiveTemplateSelection,
  formatPoints,
  PLATFORM_DEFAULT_TEMPLATE_NAMES,
  resolveDefaultTemplateId,
  TEMPLATE_DISPLAY_ORDER,
  TEMPLATE_ONE_LINERS,
  type ScoringTemplateRow,
  type TemplateSummary,
} from './scoring-template-picker-ops'

/**
 * The 8-row fetch fixture: the authored templates.ts objects (the exact
 * rules 058 + 106 + 108 seed and templates-db.test.ts proves DB-equivalent)
 * with synthetic row ids, DELIBERATELY shuffled out of §7.3.3 order — the
 * DB query promises no order (and NEITHER Scout row sits first, so
 * positional "resolution" cannot pass the natural-key pins below).
 */
const FIXTURE_ROWS: ScoringTemplateRow[] = [3, 7, 0, 5, 2, 6, 4, 1].map((i) => ({
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
  // Scout Standard (App B.5 as marked up 2026-08-31; SC.1 — renamed at
  // SC.4): no PPR as a STATED difference, INT −2, flat FG 3s with
  // fg_missed −1 (FG-specific — pat_missed omitted), ESPN split D/ST.
  'Scout Standard': {
    ppr: 0,
    int: -2,
    kicking: { fg0_39: 3, fg40_49: 3, fg50Plus: 3, patMade: 1, fgMissed: -1, patMissed: null },
    dstModel: 'split',
  },
  // Scout PPR (App B.5.1 as marked up 2026-09-01; SC.4): the same body one
  // value apart — ppr 0.2 is the pair's ONE divergence.
  'Scout PPR': {
    ppr: 0.2,
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

describe('buildTemplateCards — exactly 8, §7.3.3 order, no invented slots', () => {
  const cards = buildTemplateCards(FIXTURE_ROWS)

  it('renders exactly one card per fetched row (8), in §7.3.3 table order — the Scout pair first', () => {
    expect(cards).toHaveLength(8)
    // Stored literal — the §7.3.3 table order, not derived from the input.
    expect(cards.map((c) => c.name)).toEqual([
      'Scout Standard',
      'Scout PPR',
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

  it('carries the card one-liners as stored literals — six §7.3.3-verbatim, Scout Standard from B.5\'s approved copy trimmed (SC.3/D282), Scout PPR approved as drafted (SC.4/B.5.1)', () => {
    const oneLiners = Object.fromEntries(cards.map((c) => [c.name, c.oneLiner]))
    expect(oneLiners).toEqual({
      // App B.5's Chris-approved "why it's better" copy, trimmed to card
      // length — every phrase from the approved text, no claim changed; the
      // approved copy's remaining sentences ride the row DESCRIPTION on the
      // same card (pinned byte-identical below).
      'Scout Standard':
        'One clean rule set — every TD is 6, every FG is 3, no PPR. Yardage ' +
        'at flat, memorable rates.',
      // The §7.3.3 table row's one-liner, APPROVED as drafted by Chris
      // 2026-09-01 (App B.5.1).
      'Scout PPR':
        "The catch counts — volume alone still can't outscore production.",
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

  it('SC.3/SC.4: unfiltered, EXACTLY the Scout Standard card carries the "FieldScout\'s default" marker — the system default (B.5\'s subtitle, the R73 possessive pattern)', () => {
    expect(DEFAULT_TEMPLATE_NAME).toBe('Scout Standard')
    expect(DEFAULT_TEMPLATE_MARKER).toBe("FieldScout's default")
    expect(
      cards.filter((c) => c.defaultMarker !== null).map((c) => c.name),
    ).toEqual(['Scout Standard'])
    expect(cards[0].defaultMarker).toBe("FieldScout's default")
    // The default marker and the platform markers never share a card.
    for (const card of cards) {
      expect(card.defaultMarker !== null && card.platformDefaultMarker !== null).toBe(false)
    }
  })

  it('SC.4 (B.5.1\'s marker law): a family moves the marker to its OWN Scout — exactly one marked card per family, never both', () => {
    expect(DEFAULT_TEMPLATE_NAMES).toEqual({
      no_ppr: 'Scout Standard',
      ppr: 'Scout PPR',
    })
    const noPprCards = buildTemplateCards(FIXTURE_ROWS, 'no_ppr')
    expect(
      noPprCards.filter((c) => c.defaultMarker !== null).map((c) => c.name),
    ).toEqual(['Scout Standard'])
    const pprCards = buildTemplateCards(FIXTURE_ROWS, 'ppr')
    expect(
      pprCards.filter((c) => c.defaultMarker !== null).map((c) => c.name),
    ).toEqual(['Scout PPR'])
    // The PPR family's marked card is the one its filtered view SHOWS
    // (summary.ppr > 0) — a badge on a filtered-out card marks nothing.
    const marked = pprCards.find((c) => c.defaultMarker !== null)!
    expect(marked.summary.ppr).toBe(0.2)
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
    expect(withStray).toHaveLength(9)
    const last = withStray[8]
    expect(last.name).toBe('Mystery Template')
    expect(last.oneLiner).toBe('0.5 PPR')
    expect(last.isPlatformDefault).toBe(false)
    expect(last.defaultMarker).toBeNull()
    expect(last.description).toBe('')
  })

  it('ops metadata covers the 8 §7.3.3 names exactly (drift guard vs templates.ts)', () => {
    expect(TEMPLATE_DISPLAY_ORDER).toEqual(SCORING_TEMPLATES.map((t) => t.name))
    expect(Object.keys(TEMPLATE_ONE_LINERS).sort()).toEqual(
      SCORING_TEMPLATES.map((t) => t.name).sort(),
    )
  })
})

describe('SC.3/SC.4 — the §7.3.3 default preselection ops, per family', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves Scout Standard by NATURAL KEY from a shuffled fixture — the name decides, never the input position (family omitted = the system default)', () => {
    // FIXTURE_ROWS is deliberately out of §7.3.3 order (neither Scout row
    // is the first input row), so an implementation that grabbed rows[0] —
    // or any position — reds here; only name-resolution yields Scout
    // Standard's id.
    expect(FIXTURE_ROWS[0].name).not.toBe(DEFAULT_TEMPLATE_NAME)
    const scoutRow = FIXTURE_ROWS.find((r) => r.name === DEFAULT_TEMPLATE_NAME)!
    expect(resolveDefaultTemplateId(FIXTURE_ROWS)).toBe(scoutRow.id)
    // …and the resolved id is an opaque row id, not a name (what the mounts
    // pass as `scoring_system_id` — a uuid in a real environment, so a
    // hardcoded id could never have worked across environments).
    expect(resolveDefaultTemplateId([...FIXTURE_ROWS].reverse())).toBe(scoutRow.id)
  })

  it('the FAMILY dimension picks the half (v2.16.11): no_ppr → Scout Standard, ppr → Scout PPR — each by natural key, position-independent', () => {
    const standardRow = FIXTURE_ROWS.find((r) => r.name === 'Scout Standard')!
    const pprRow = FIXTURE_ROWS.find((r) => r.name === 'Scout PPR')!
    expect(FIXTURE_ROWS[0].name).not.toBe('Scout PPR')
    expect(resolveDefaultTemplateId(FIXTURE_ROWS, 'no_ppr')).toBe(standardRow.id)
    expect(resolveDefaultTemplateId(FIXTURE_ROWS, 'ppr')).toBe(pprRow.id)
    expect(resolveDefaultTemplateId([...FIXTURE_ROWS].reverse(), 'ppr')).toBe(pprRow.id)
    // The two halves never resolve to the same row — the family law is a
    // real fork, not a synonym.
    expect(standardRow.id).not.toBe(pprRow.id)
  })

  it('still-loading rows (undefined) resolve to null with NO warning — nothing to resolve is not a failure (both families)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveDefaultTemplateId(undefined)).toBeNull()
    expect(resolveDefaultTemplateId(undefined, 'ppr')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a loaded set WITHOUT the family\'s Scout row degrades LOUDLY: null + a console.warn naming the MISSING HALF — never a silent un-default ("nothing happened" rule)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const withoutStandard = FIXTURE_ROWS.filter((r) => r.name !== DEFAULT_TEMPLATE_NAME)
    expect(resolveDefaultTemplateId(withoutStandard)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(DEFAULT_TEMPLATE_NAME)
    expect(String(warn.mock.calls[0][0])).toContain('migration 108')
    // The OTHER half missing warns with ITS name (whichever half is absent
    // is the one the degradation names) — and a set missing only Scout PPR
    // still resolves the no_ppr family fine (no warn for a half not asked
    // for).
    warn.mockClear()
    const withoutPpr = FIXTURE_ROWS.filter((r) => r.name !== 'Scout PPR')
    expect(resolveDefaultTemplateId(withoutPpr, 'no_ppr')).not.toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(resolveDefaultTemplateId(withoutPpr, 'ppr')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('Scout PPR')
    // What renders instead is STATED, not left to inference: with a null
    // default the effective selection is explicit-only — the pre-SC.3 flow,
    // where both submit gates keep refusing until the user picks a card
    // (pinned at toCreateInput/toMockLaunchInput in their own suites).
    expect(effectiveTemplateSelection(null, null)).toBeNull()
  })

  it('effectiveTemplateSelection: an explicit pick ALWAYS wins; the default fills only an empty pick (all four combos)', () => {
    expect(effectiveTemplateSelection('explicit-id', 'default-id')).toBe('explicit-id')
    expect(effectiveTemplateSelection('explicit-id', null)).toBe('explicit-id')
    expect(effectiveTemplateSelection(null, 'default-id')).toBe('default-id')
    expect(effectiveTemplateSelection(null, null)).toBeNull()
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
