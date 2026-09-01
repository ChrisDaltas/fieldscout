import { describe, expect, it, vi } from 'vitest'

import { LeaguePatchError } from '@/hooks/use-league'
import type { ScoringRulesDocV2 } from '@/lib/leagues/scoring/rules-doc'
import {
  DEF_PA_PREFIX,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  tierKeysFromCuts,
  YA_CUTS,
} from '@/lib/leagues/scoring/tier-cuts'
import {
  POSITION_SCORABLE_KEYS,
  SCORABLE_KEYS,
} from '@/lib/leagues/scoring/validate-rules-doc'
import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'

import {
  allPositionsOn,
  applyAllPositionsOn,
  applyEdit,
  buildSavePayload,
  canonicalDocEqual,
  canonicalDocJson,
  composeCatalog,
  describeSaveRefusal,
  format1View,
  isCustomScoringReference,
  parseCoefficientInput,
  positionLabel,
  renderableFields,
  saveScoringDoc,
  SCORING_EDITOR_SECTIONS,
  scoringEditorAccess,
  sectionFieldStates,
  sectionsForPosition,
  STEPPER_POSITIONS,
  type ScoringSectionDef,
} from './scoring-editor-ops'

/**
 * SE.7 ops pins (spec §7.3.3.1; tasks-SE §5 SE.7(3); F136's discharge shape).
 *
 * Falsifiability notes (D267/D272(20)):
 *  - the prescribed break probe — forcing `allPositionsOn` to ignore
 *    overrides — reds the truth-table goldens below (shown on the PR).
 *  - every golden here is a stored literal, never `expect(f(x)).toBe(f(x))`.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A small format-2 fork doc in normal form: shared-family cuts, no overrides. */
const freshDoc = (): ScoringRulesDocV2 => ({
  format: 2,
  base: {
    pass_yards: 0.04,
    pass_tds: 4,
    rush_yards: 0.1,
    rush_tds: 6,
    receptions: 1,
    receiving_yards: 0.1,
    return_td: 6,
    interceptions: -2,
    fumbles_lost: -2,
    fg_0_39: 3,
    def_sack: 1,
  },
  positions: {},
  tier_cuts: { def_pa: [...SHARED_PA_CUTS], def_ya: [...YA_CUTS] },
})

const withOverrides = (
  positions: ScoringRulesDocV2['positions'],
): ScoringRulesDocV2 => ({ ...freshDoc(), positions })

/** The 20 cut-generated tier keys — the D/ST tier tables' keys, which render
 *  as SE.8's tables and are deliberately NOT grid fields. */
const TIER_KEYS = new Set([
  ...tierKeysFromCuts(DEF_PA_PREFIX, SHARED_PA_CUTS),
  ...tierKeysFromCuts(DEF_PA_PREFIX, ESPN_PA_CUTS),
  ...tierKeysFromCuts(DEF_YA_PREFIX, YA_CUTS),
])

const ungatedKeys = (sections: readonly ScoringSectionDef[]): string[] =>
  sections.flatMap((s) => renderableFields(s).map((f) => f.key))

// ---------------------------------------------------------------------------
// A. The stepper
// ---------------------------------------------------------------------------

describe('the position stepper', () => {
  it('runs QB → RB → WR → TE → K → D/ST, literally (§7.3.3.1)', () => {
    expect([...STEPPER_POSITIONS]).toStrictEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
  })

  it("prints DST as D/ST and everything else as itself", () => {
    expect(positionLabel('DST')).toBe('D/ST')
    expect(positionLabel('QB')).toBe('QB')
    expect(positionLabel('K')).toBe('K')
  })
})

// ---------------------------------------------------------------------------
// B. The catalog — composed from the engine map, never a second transcription
// ---------------------------------------------------------------------------

describe('the section catalog (F136 discharge)', () => {
  it('renders sections in the §7.3.3.1 product-shape order, K and D/ST one page each', () => {
    expect(SCORING_EDITOR_SECTIONS.map((s) => s.id)).toStrictEqual([
      'rushing',
      'passing',
      'receiving',
      'special_teams',
      'turnovers',
      'kicking',
      'dst_events',
    ])
    expect(sectionsForPosition('QB').map((s) => s.id)).toStrictEqual([
      'rushing',
      'passing',
      'receiving',
      'special_teams',
      'turnovers',
    ])
    for (const p of ['RB', 'WR', 'TE'] as const) {
      expect(sectionsForPosition(p).map((s) => s.id)).toStrictEqual(
        sectionsForPosition('QB').map((s) => s.id),
      )
    }
    expect(sectionsForPosition('K').map((s) => s.id)).toStrictEqual(['kicking'])
    expect(sectionsForPosition('DST').map((s) => s.id)).toStrictEqual(['dst_events'])
  })

  it('every ungated key is legal for every position whose page renders it (⊆ POSITION_SCORABLE_KEYS)', () => {
    for (const section of SCORING_EDITOR_SECTIONS) {
      for (const field of renderableFields(section)) {
        for (const position of section.positions) {
          expect(
            POSITION_SCORABLE_KEYS[position],
            `${section.id}/${field.key} on the ${position} page`,
          ).toContain(field.key)
        }
      }
    }
  })

  it('the offense pages UNION to exactly the engine map for QB/RB/WR/TE (set equality, both ways)', () => {
    for (const p of ['QB', 'RB', 'WR', 'TE'] as const) {
      const rendered = new Set(ungatedKeys(sectionsForPosition(p)))
      expect(rendered).toStrictEqual(new Set(POSITION_SCORABLE_KEYS[p]))
    }
  })

  it('the K page is exactly POSITION_SCORABLE_KEYS.K', () => {
    expect(new Set(ungatedKeys(sectionsForPosition('K')))).toStrictEqual(
      new Set(POSITION_SCORABLE_KEYS.K),
    )
  })

  it('the D/ST page is POSITION_SCORABLE_KEYS.DST minus the tier keys (which are SE.8 tier tables, not grid rows)', () => {
    const expected = new Set(
      POSITION_SCORABLE_KEYS.DST.filter((key) => !TIER_KEYS.has(key)),
    )
    expect(new Set(ungatedKeys(sectionsForPosition('DST')))).toStrictEqual(expected)
  })

  it('catalog completeness: the ungated catalog ≡ the registry scorable set minus gated minus tier keys', () => {
    const catalog = new Set(ungatedKeys(SCORING_EDITOR_SECTIONS))
    const expected = new Set(
      [...SCORABLE_KEYS].filter((key) => !TIER_KEYS.has(key)),
    )
    expect(catalog).toStrictEqual(expected)
  })

  it('every ungated label is the STAT_KEYS registry label (composed, not re-written)', () => {
    for (const section of SCORING_EDITOR_SECTIONS) {
      for (const field of renderableFields(section)) {
        const def = STAT_KEYS.find((d) => d.key === field.key)
        expect(def, field.key).toBeDefined()
        expect(field.label).toBe(def?.label)
      }
    }
  })
})

describe('the composition guard (composeCatalog) has teeth', () => {
  const legal: ScoringSectionDef = {
    id: 'rushing',
    title: 'Rushing',
    positions: ['QB'],
    fields: [{ key: 'rush_yards', label: 'Rushing Yards' }],
  }

  it('accepts a catalog whose ungated keys the engine map allows', () => {
    expect(() => composeCatalog([legal])).not.toThrow()
  })

  it('refuses an ungated key the validator would refuse (the F136 drift, made unloadable)', () => {
    const drifted: ScoringSectionDef = {
      ...legal,
      fields: [{ key: 'fg_0_39', label: 'FG Made (0–39)' }],
    }
    expect(() => composeCatalog([drifted])).toThrow(/POSITION_SCORABLE_KEYS\[QB\]/)
  })

  it('refuses one key in two sections', () => {
    expect(() => composeCatalog([legal, { ...legal, id: 'passing' }])).toThrow(
      /two sections/,
    )
  })

  it('exempts a GATED key from the membership check (return_yards has no registry entry until F71 lands)', () => {
    const gated: ScoringSectionDef = {
      ...legal,
      fields: [{ key: 'return_yards', label: 'Return Yards', gated: true }],
    }
    expect(() => composeCatalog([gated])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// C. D173 — return_yards is a catalog flag, and the flag ships OFF
// ---------------------------------------------------------------------------

describe('return_yards gating (Q13/D173)', () => {
  const specialTeams = SCORING_EDITOR_SECTIONS.find((s) => s.id === 'special_teams')

  it('the catalog carries return_yards, gated, on Special Teams — the ONLY place the field exists', () => {
    const field = specialTeams?.fields.find((f) => f.key === 'return_yards')
    expect(field).toBeDefined()
    expect(field?.gated).toBe(true)
    // No registry entry exists until the data task lands (the Q9/E61 lesson);
    // when F71 adds one and flips the gate, this cell flips with it — that
    // red is the reminder that the two moves are one change.
    expect(STAT_KEYS.some((d) => d.key === 'return_yards')).toBe(false)
    for (const position of STEPPER_POSITIONS) {
      expect(POSITION_SCORABLE_KEYS[position]).not.toContain('return_yards')
    }
  })

  it('a gated field renders nothing: renderableFields excludes it, return_td stays', () => {
    expect(specialTeams).toBeDefined()
    const rendered = renderableFields(specialTeams as ScoringSectionDef).map((f) => f.key)
    expect(rendered).toStrictEqual(['return_td'])
  })

  it('the filter discriminates on the flag, not the key name (a synthetic gated field is filtered too)', () => {
    const synthetic: ScoringSectionDef = {
      id: 'rushing',
      title: 'Rushing',
      positions: ['QB'],
      fields: [
        { key: 'rush_yards', label: 'Rushing Yards' },
        { key: 'rush_tds', label: 'Rushing TDs', gated: true },
      ],
    }
    expect(renderableFields(synthetic).map((f) => f.key)).toStrictEqual(['rush_yards'])
  })
})

// ---------------------------------------------------------------------------
// D. The All-Positions switch — derived state, truth table (§7.3.3.1 verbatim)
// ---------------------------------------------------------------------------

describe('allPositionsOn truth table', () => {
  it('ON when no position override exists at all', () => {
    const doc = freshDoc()
    for (const id of ['rushing', 'passing', 'receiving', 'special_teams', 'turnovers'] as const) {
      expect(allPositionsOn(doc, id), id).toBe(true)
    }
  })

  it('OFF the moment one of the section keys carries one position override', () => {
    const doc = withOverrides({ QB: { pass_tds: 6 } })
    expect(allPositionsOn(doc, 'passing')).toBe(false)
  })

  it("an override on ANOTHER section's key does not flip this section (per-section derivation)", () => {
    const doc = withOverrides({ QB: { pass_tds: 6 } })
    expect(allPositionsOn(doc, 'rushing')).toBe(true)
    expect(allPositionsOn(doc, 'receiving')).toBe(true)
    expect(allPositionsOn(doc, 'turnovers')).toBe(true)
  })

  it('the MIXED case: one key overridden for one position, the rest clean → OFF', () => {
    const doc = withOverrides({ RB: { rush_yards: 0.2 } })
    expect(allPositionsOn(doc, 'rushing')).toBe(false)
    expect(allPositionsOn(doc, 'passing')).toBe(true)
  })

  it('derivation is PRESENCE-based: an override equal in value to base still reads OFF (raw doc, pre-normal-form)', () => {
    // The save path strips this no-op (normal form) — the derivation itself
    // must not value-compare, or the strip and the switch would disagree
    // about what the strip exists to guarantee.
    const doc = withOverrides({ WR: { receptions: 1 } })
    expect(allPositionsOn(doc, 'receiving')).toBe(false)
  })

  it('derives for the single-position sections too (the UI hides their switch; the math stays total)', () => {
    expect(allPositionsOn(withOverrides({ K: { fg_0_39: 5 } }), 'kicking')).toBe(false)
    expect(allPositionsOn(freshDoc(), 'kicking')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E. applyEdit — arm goldens
// ---------------------------------------------------------------------------

describe('applyEdit', () => {
  it("scope 'all' writes base and touches no override", () => {
    const next = applyEdit(freshDoc(), {
      section: 'passing',
      key: 'pass_tds',
      scope: 'all',
      value: 6,
    })
    expect(next.base.pass_tds).toBe(6)
    expect(next.positions).toStrictEqual({})
  })

  it('scope P writes positions[P] and leaves base alone', () => {
    const next = applyEdit(freshDoc(), {
      section: 'passing',
      key: 'pass_tds',
      scope: 'QB',
      value: 6,
    })
    expect(next.base.pass_tds).toBe(4)
    expect(next.positions.QB).toStrictEqual({ pass_tds: 6 })
    expect(allPositionsOn(next, 'passing')).toBe(false)
  })

  it('output is NORMALIZED: editing an override back to the base value strips it, and the switch derives ON again', () => {
    const doc = freshDoc()
    const off = applyEdit(doc, { section: 'passing', key: 'pass_tds', scope: 'QB', value: 6 })
    const back = applyEdit(off, { section: 'passing', key: 'pass_tds', scope: 'QB', value: 4 })
    expect(back.positions).toStrictEqual({})
    expect(allPositionsOn(back, 'passing')).toBe(true)
    expect(canonicalDocEqual(back, doc)).toBe(true)
  })

  it('an explicit 0 override SURVIVES normalization when base differs — the D59(4) off-switch, never stripped', () => {
    const next = applyEdit(freshDoc(), {
      section: 'receiving',
      key: 'receptions',
      scope: 'TE',
      value: 0,
    })
    expect(next.positions.TE).toStrictEqual({ receptions: 0 })
  })

  it("null under scope 'all' un-scores the category (key leaves base); null under scope P reverts to shared", () => {
    const unscored = applyEdit(freshDoc(), {
      section: 'turnovers',
      key: 'fumbles_lost',
      scope: 'all',
      value: null,
    })
    expect('fumbles_lost' in unscored.base).toBe(false)

    const overridden = applyEdit(freshDoc(), {
      section: 'passing',
      key: 'pass_tds',
      scope: 'QB',
      value: 6,
    })
    const reverted = applyEdit(overridden, {
      section: 'passing',
      key: 'pass_tds',
      scope: 'QB',
      value: null,
    })
    expect(reverted.positions).toStrictEqual({})
    expect(reverted.base.pass_tds).toBe(4)
  })

  it('never mutates its input', () => {
    const doc = freshDoc()
    const snapshot = structuredClone(doc)
    applyEdit(doc, { section: 'passing', key: 'pass_tds', scope: 'QB', value: 6 })
    expect(doc).toStrictEqual(snapshot)
  })

  it('throws on edits the grid can never produce (gated key, foreign key, foreign page, unknown section)', () => {
    const doc = freshDoc()
    expect(() =>
      applyEdit(doc, { section: 'special_teams', key: 'return_yards', scope: 'all', value: 1 }),
    ).toThrow(/not an editable field/)
    expect(() =>
      applyEdit(doc, { section: 'rushing', key: 'pass_tds', scope: 'all', value: 1 }),
    ).toThrow(/not an editable field/)
    expect(() =>
      applyEdit(doc, { section: 'passing', key: 'pass_tds', scope: 'K', value: 1 }),
    ).toThrow(/does not render on the K page/)
    expect(() =>
      // @ts-expect-error — unknown section id is a type error AND a runtime throw
      applyEdit(doc, { section: 'bonuses', key: 'pass_tds', scope: 'all', value: 1 }),
    ).toThrow(/unknown scoring-editor section/)
  })
})

// ---------------------------------------------------------------------------
// F. Flipping All-Positions ON — screen-stable adoption
// ---------------------------------------------------------------------------

describe('applyAllPositionsOn', () => {
  it("adopts the VIEWING position's effective values into base and strips the section overrides", () => {
    const doc = withOverrides({ QB: { pass_tds: 6 } })
    const fromQb = applyAllPositionsOn(doc, 'passing', 'QB')
    expect(fromQb.base.pass_tds).toBe(6)
    expect(fromQb.positions).toStrictEqual({})

    const fromRb = applyAllPositionsOn(doc, 'passing', 'RB')
    expect(fromRb.base.pass_tds).toBe(4)
    expect(fromRb.positions).toStrictEqual({})
  })

  it("the mixed case: the section collapses to the viewed values; other sections' overrides survive", () => {
    const doc = withOverrides({
      QB: { pass_tds: 6 },
      RB: { pass_yards: 0.05, rush_yards: 0.2 },
    })
    const next = applyAllPositionsOn(doc, 'passing', 'QB')
    expect(next.base.pass_tds).toBe(6)
    expect(next.base.pass_yards).toBe(0.04)
    expect(next.positions).toStrictEqual({ RB: { rush_yards: 0.2 } })
    expect(allPositionsOn(next, 'passing')).toBe(true)
    expect(allPositionsOn(next, 'rushing')).toBe(false)
  })

  it('a key the viewed position does not score ends absent everywhere ("these values" includes the absences)', () => {
    const doc = withOverrides({ RB: { qb_sack_taken: -1 } })
    const next = applyAllPositionsOn(doc, 'passing', 'QB')
    expect('qb_sack_taken' in next.base).toBe(false)
    expect(next.positions).toStrictEqual({})
  })

  it('throws for a section the page does not render', () => {
    expect(() => applyAllPositionsOn(freshDoc(), 'kicking', 'QB')).toThrow(
      /does not render on the QB page/,
    )
  })
})

// ---------------------------------------------------------------------------
// G. Per-field input rules — §7.3.3.1 bounds, boundary instants pinned
// ---------------------------------------------------------------------------

describe('parseCoefficientInput (guardrail 5, client mirror)', () => {
  it('boundary instants: 100 and -100 pass untouched; one step past clamps-with-error', () => {
    expect(parseCoefficientInput('100')).toStrictEqual({
      kind: 'value',
      value: 100,
      adjusted: null,
    })
    expect(parseCoefficientInput('-100')).toStrictEqual({
      kind: 'value',
      value: -100,
      adjusted: null,
    })
    expect(parseCoefficientInput('100.01')).toStrictEqual({
      kind: 'value',
      value: 100,
      adjusted: 'clamped',
    })
    expect(parseCoefficientInput('-100.01')).toStrictEqual({
      kind: 'value',
      value: -100,
      adjusted: 'clamped',
    })
    expect(parseCoefficientInput('150')).toStrictEqual({
      kind: 'value',
      value: 100,
      adjusted: 'clamped',
    })
  })

  it('rounds to the 0.01 step and says so', () => {
    expect(parseCoefficientInput('3.456')).toStrictEqual({
      kind: 'value',
      value: 3.46,
      adjusted: 'rounded',
    })
    expect(parseCoefficientInput('0.04')).toStrictEqual({
      kind: 'value',
      value: 0.04,
      adjusted: null,
    })
  })

  it('scientific notation is a number like any other (Number(), then the bounds)', () => {
    expect(parseCoefficientInput('1e3')).toStrictEqual({
      kind: 'value',
      value: 100,
      adjusted: 'clamped',
    })
  })

  it('empty clears; junk and non-finite commit nothing', () => {
    expect(parseCoefficientInput('')).toStrictEqual({ kind: 'cleared' })
    expect(parseCoefficientInput('   ')).toStrictEqual({ kind: 'cleared' })
    expect(parseCoefficientInput('abc')).toStrictEqual({ kind: 'invalid' })
    expect(parseCoefficientInput('Infinity')).toStrictEqual({ kind: 'invalid' })
  })
})

// ---------------------------------------------------------------------------
// H. The grid read model
// ---------------------------------------------------------------------------

describe('sectionFieldStates', () => {
  it('reads override-over-base per key, with the base kept for reference', () => {
    const doc = withOverrides({ QB: { pass_tds: 6 } })
    const states = sectionFieldStates(doc, 'passing', 'QB')
    expect(states.map((s) => s.key)).toStrictEqual([
      'pass_yards',
      'pass_tds',
      'pass_2pt',
      'qb_sack_taken',
    ])
    const passTds = states.find((s) => s.key === 'pass_tds')
    expect(passTds).toStrictEqual({
      key: 'pass_tds',
      label: 'Passing TDs',
      value: 6,
      baseValue: 4,
      overridden: true,
    })
    // Same doc, another position: no override, base shows.
    const rbPassTds = sectionFieldStates(doc, 'passing', 'RB').find(
      (s) => s.key === 'pass_tds',
    )
    expect(rbPassTds).toStrictEqual({
      key: 'pass_tds',
      label: 'Passing TDs',
      value: 4,
      baseValue: 4,
      overridden: false,
    })
  })

  it('an absent key reads undefined — "not scored", which is not 0', () => {
    const state = sectionFieldStates(freshDoc(), 'passing', 'QB').find(
      (s) => s.key === 'pass_2pt',
    )
    expect(state?.value).toBeUndefined()
    expect(state?.overridden).toBe(false)
  })

  it('a format-1 document reads through format1View: every value all-positions, no override anywhere', () => {
    const view = format1View({ pass_yards: 0.04, pass_tds: 4 })
    const states = sectionFieldStates(view, 'passing', 'QB')
    expect(states.find((s) => s.key === 'pass_tds')).toStrictEqual({
      key: 'pass_tds',
      label: 'Passing TDs',
      value: 4,
      baseValue: 4,
      overridden: false,
    })
    expect(states.every((s) => !s.overridden)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I. Canonical equality (the dirty flag)
// ---------------------------------------------------------------------------

describe('canonicalDocEqual', () => {
  it('is key-order-insensitive (jsonb equality, client twin)', () => {
    const a: ScoringRulesDocV2 = freshDoc()
    const b: ScoringRulesDocV2 = JSON.parse(
      canonicalDocJson(a),
    ) as ScoringRulesDocV2
    expect(canonicalDocEqual(a, b)).toBe(true)
    const reordered = { ...a, base: Object.fromEntries(Object.entries(a.base).reverse()) }
    expect(canonicalDocEqual(a, reordered)).toBe(true)
  })

  it('a changed value is dirty', () => {
    const a = freshDoc()
    const b = { ...a, base: { ...a.base, pass_tds: 5 } }
    expect(canonicalDocEqual(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// J+K. The save door — normalization is the CLIENT's save-time duty
// ---------------------------------------------------------------------------

/** Deliberately UN-normalized: a no-op override (equals base) and an empty
 *  override object — exactly what `scoring_update_rules` refuses. */
const unnormalizedDoc = (): ScoringRulesDocV2 => ({
  ...freshDoc(),
  positions: { QB: { pass_tds: 4 }, RB: {} },
})

describe('buildSavePayload (the normal-form strip at the door)', () => {
  it('strips no-op and empty overrides from a doc fed straight in (NOT via applyEdit)', () => {
    const payload = buildSavePayload(unnormalizedDoc())
    expect(payload.positions).toStrictEqual({})
    expect(payload.base).toStrictEqual(freshDoc().base)
  })

  it('keeps a real override intact', () => {
    const doc = withOverrides({ QB: { pass_tds: 6 } })
    expect(buildSavePayload(doc).positions).toStrictEqual({ QB: { pass_tds: 6 } })
  })
})

describe('saveScoringDoc', () => {
  it('sends the NORMALIZED document — the door normalizes, not the caller', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ scoring_system_id: 'sys-1' })
    const outcome = await saveScoringDoc({ working: unnormalizedDoc(), mutateAsync })
    expect(outcome).toStrictEqual({ ok: true, scoringSystemId: 'sys-1' })
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const sent = mutateAsync.mock.calls[0]?.[0] as ScoringRulesDocV2
    expect(sent.positions).toStrictEqual({})
    expect(sent.base).toStrictEqual(freshDoc().base)
  })

  it('a refusal returns ONLY a classification — no document to revert with, and no second send', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new LeaguePatchError(409, 'window closed'))
    const outcome = await saveScoringDoc({ working: freshDoc(), mutateAsync })
    expect(outcome.ok).toBe(false)
    expect(Object.keys(outcome).sort()).toStrictEqual(['ok', 'refusal'])
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })
})

describe('describeSaveRefusal — WHICH layer refused decides the kind (the SE.6 rung)', () => {
  it('a 400 with per-field errors is a VALIDATION refusal (route Zod or the SQL guardrail mirror — both key by document path)', () => {
    const refusal = describeSaveRefusal(
      new LeaguePatchError(400, 'Some scoring values need attention.', {
        'rules.base.def_pa_14_20': ['Tier exclusivity (§7.3.3.1)'],
      }),
    )
    expect(refusal).toStrictEqual({
      kind: 'validation',
      message: 'Some scoring values need attention.',
      fieldErrors: { 'rules.base.def_pa_14_20': ['Tier exclusivity (§7.3.3.1)'] },
    })
    expect(refusal.kind).not.toBe('refused')
  })

  it("a 403 is the RPC's refusal, message passed through VERBATIM — only that layer mints it (D275(3))", () => {
    const refusal = describeSaveRefusal(
      new LeaguePatchError(403, "Only the commissioner can change this league's scoring."),
    )
    expect(refusal).toStrictEqual({
      kind: 'refused',
      status: 403,
      message: "Only the commissioner can change this league's scoring.",
    })
  })

  it("a 409 is the RPC's window/state refusal — 105's own sentence, untouched", () => {
    const refusal = describeSaveRefusal(
      new LeaguePatchError(
        409,
        'scoring can only be edited while the league is in setup or scheduled',
      ),
    )
    expect(refusal.kind).toBe('refused')
    expect(refusal).toMatchObject({ status: 409 })
  })

  it('a 404 is the id fence — refused, not network', () => {
    expect(describeSaveRefusal(new LeaguePatchError(404, 'League not found'))).toStrictEqual({
      kind: 'refused',
      status: 404,
      message: 'League not found',
    })
  })

  it('a 5xx arrived and failed; a thrown fetch never arrived — and the two render differently', () => {
    expect(describeSaveRefusal(new LeaguePatchError(500, 'boom'))).toStrictEqual({
      kind: 'failed',
      status: 500,
      message: 'boom',
    })
    expect(describeSaveRefusal(new TypeError('fetch failed'))).toStrictEqual({
      kind: 'network',
      message: 'fetch failed',
    })
  })
})

// ---------------------------------------------------------------------------
// L. Access — the §7.3 window, enumerated on both sides (the D272(20) posture)
// ---------------------------------------------------------------------------

describe('scoringEditorAccess', () => {
  it('both in-window statuses edit, for commissioner and co-commissioner', () => {
    for (const status of ['setup', 'scheduled']) {
      for (const role of ['commissioner', 'co_commissioner']) {
        expect(scoringEditorAccess(role, status)).toStrictEqual({
          isCommissioner: true,
          inEditWindow: true,
          canEdit: true,
        })
      }
    }
  })

  it('all four out-of-window statuses lock — and the WINDOW is what refused, not the role', () => {
    for (const status of ['drafting', 'in_season', 'playoffs', 'complete']) {
      const access = scoringEditorAccess('commissioner', status)
      expect(access.canEdit, status).toBe(false)
      expect(access.isCommissioner, status).toBe(true)
      expect(access.inEditWindow, status).toBe(false)
    }
  })

  it('a member (or no role) never edits, in-window or not — and the ROLE is what refused', () => {
    for (const role of ['manager', null]) {
      const access = scoringEditorAccess(role, 'setup')
      expect(access.canEdit).toBe(false)
      expect(access.inEditWindow).toBe(true)
      expect(access.isCommissioner).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// M. Reachability — customized iff not one of the seeded templates (D169)
// ---------------------------------------------------------------------------

describe('isCustomScoringReference', () => {
  const templates = ['t-1', 't-2']
  it('a template reference is not customized; a non-template reference is the league fork (D169 closed the world)', () => {
    expect(isCustomScoringReference('t-1', templates)).toBe(false)
    expect(isCustomScoringReference('fork-9', templates)).toBe(true)
    expect(isCustomScoringReference(null, templates)).toBe(false)
  })
})
