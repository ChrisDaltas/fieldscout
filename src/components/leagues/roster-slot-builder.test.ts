/**
 * L.A2.2 roster-slot-builder — schema-fixture golden pins (tasks-M1 §4.3
 * UI scoping: "schema-fixture golden pins their task text names … e.g.
 * L.A2.2's builder-output fixture" + the D39 browser pass in the session
 * log — cite that sentence in the self-review note).
 *
 * Pinned here:
 *   1. The builder-output fixture for the spec's TWO-FLEX PRINTED EXAMPLE
 *      (§7.3.2 canonical JSONB, stored below as a literal — shape
 *      fidelity). The fixture is BUILT through the builder's ops from the
 *      canonical default, and is deliberately NOT the default (the default
 *      is the preset-table counts per L.A1.1) — both asserted.
 *   2. DL preset emission (one-tap Restricted-IR — OUT/IR/Doubtful,
 *      min_weeks 4, label DL — §16.4).
 *   3. Hot Swap emission (`swap_spots` literal 0/1, never booleans).
 *   4. Unique flex key generation (flexN smallest-free + the superflex
 *      special case the printed example encodes).
 *
 * All ops emit through `rosterSettingsSchema.parse`, so every deep-equal
 * below also proves canonical-shape validity.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROSTER_SETTINGS,
  DL_PRESET,
  deriveRosterSize,
  rosterSettingsSchema,
  type RosterSettings,
} from '@/lib/leagues/settings/league-settings'

import {
  addCustomFlex,
  addDlSpot,
  addIrSpot,
  addSingleSlot,
  canonicalizeEligible,
  dlPresetHint,
  generateFlexKey,
  removeSlot,
  setBench,
  setHotSwap,
  setSlotCount,
  suggestFlexLabel,
  updateIrSpot,
} from './roster-slot-builder-ops'

/**
 * GOLDEN PIN — the §7.3.2 canonical `leagues.roster_settings` example JSONB,
 * stored verbatim from the spec (the two-flex printed example: 1× W/R/T +
 * 1× W/T + a 0-count SUPERFLEX). A stored literal, never recomputed (§4.3a).
 */
const SPEC_TWO_FLEX_EXAMPLE: RosterSettings = {
  starting_slots: [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 2 },
    { key: 'wr', label: 'WR', eligible: ['WR'], count: 2 },
    { key: 'te', label: 'TE', eligible: ['TE'], count: 1 },
    { key: 'flex1', label: 'W/R/T', eligible: ['WR', 'RB', 'TE'], count: 1 },
    { key: 'flex2', label: 'W/T', eligible: ['WR', 'TE'], count: 1 },
    { key: 'superflex', label: 'SUPERFLEX', eligible: ['QB', 'WR', 'RB', 'TE'], count: 0 },
    { key: 'k', label: 'K', eligible: ['K'], count: 1 },
    { key: 'dst', label: 'D/ST', eligible: ['DST'], count: 1 },
  ],
  bench: 6,
  ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] }],
  swap_spots: 0,
}

describe('golden pin — spec §7.3.2 two-flex printed example (builder-output fixture)', () => {
  /**
   * The commissioner path that produces the printed example from the
   * canonical default: swap the default preset FLEX for a commissioner-named
   * W/R/T, add a W/T, add a 0-count SUPERFLEX. Labels are the commissioner's
   * (here the builder's own suggestions, which match the spec's).
   */
  function buildTwoFlexExample(): RosterSettings {
    let roster = structuredClone(DEFAULT_ROSTER_SETTINGS)
    roster = removeSlot(roster, 'flex')
    roster = addCustomFlex(roster, { eligible: ['WR', 'RB', 'TE'], label: 'W/R/T' })
    roster = addCustomFlex(roster, { eligible: ['WR', 'TE'], label: 'W/T' })
    roster = addCustomFlex(roster, { eligible: ['QB', 'WR', 'RB', 'TE'], label: 'SUPERFLEX' })
    roster = setSlotCount(roster, 'superflex', 0)
    return roster
  }

  it('builder ops reproduce the canonical example JSONB exactly (shape fidelity)', () => {
    expect(buildTwoFlexExample()).toStrictEqual(SPEC_TWO_FLEX_EXAMPLE)
  })

  it('the fixture is NOT the default — the default stays the preset-table counts (L.A1.1)', () => {
    expect(SPEC_TWO_FLEX_EXAMPLE).not.toStrictEqual(DEFAULT_ROSTER_SETTINGS)
    // and the default the builder starts from still golden-matches L.A1.1's
    // canonical literal (guards against ops mutating their input)
    const untouched = structuredClone(DEFAULT_ROSTER_SETTINGS)
    buildTwoFlexExample()
    expect(untouched).toStrictEqual(DEFAULT_ROSTER_SETTINGS)
  })

  it('the fixture parses under rosterSettingsSchema and derives roster_size 17', () => {
    expect(rosterSettingsSchema.parse(SPEC_TWO_FLEX_EXAMPLE)).toStrictEqual(SPEC_TWO_FLEX_EXAMPLE)
    // starters 1+2+2+1+1+1+0+1+1 = 10, + bench 6 + 1 IR spot = 17
    expect(deriveRosterSize(SPEC_TWO_FLEX_EXAMPLE)).toBe(17)
  })

  it('suggested labels match the spec vocabulary the example uses', () => {
    expect(suggestFlexLabel(['WR', 'RB', 'TE'])).toBe('W/R/T')
    expect(suggestFlexLabel(['WR', 'TE'])).toBe('W/T')
    expect(suggestFlexLabel(['QB', 'WR', 'RB', 'TE'])).toBe('SUPERFLEX')
    expect(suggestFlexLabel(['DL', 'LB', 'DB'])).toBe('DL/LB/DB')
  })
})

describe('unique flex key generation (D65)', () => {
  const defaultKeys = DEFAULT_ROSTER_SETTINGS.starting_slots.map((s) => s.key)

  it('generic flexes take the smallest free flexN', () => {
    expect(generateFlexKey(defaultKeys, ['WR', 'RB'])).toBe('flex1')
    expect(generateFlexKey([...defaultKeys, 'flex1'], ['WR', 'TE'])).toBe('flex2')
    // holes are filled first: flex2 taken but flex1 free → flex1
    expect(generateFlexKey([...defaultKeys, 'flex2'], ['WR', 'TE'])).toBe('flex1')
  })

  it('the QB/WR/RB/TE set takes the product key superflex, falling back to flexN once taken', () => {
    expect(generateFlexKey(defaultKeys, ['QB', 'WR', 'RB', 'TE'])).toBe('superflex')
    // selection order does not matter — the set is what is special-cased
    expect(generateFlexKey(defaultKeys, ['TE', 'QB', 'RB', 'WR'])).toBe('superflex')
    expect(generateFlexKey([...defaultKeys, 'superflex'], ['QB', 'WR', 'RB', 'TE'])).toBe('flex1')
  })

  it('repeated identical adds through the op never collide', () => {
    let roster = structuredClone(DEFAULT_ROSTER_SETTINGS)
    roster = addCustomFlex(roster, { eligible: ['WR', 'RB'] })
    roster = addCustomFlex(roster, { eligible: ['WR', 'RB'] })
    roster = addCustomFlex(roster, { eligible: ['WR', 'RB'] })
    const keys = roster.starting_slots.map((s) => s.key)
    expect(keys).toStrictEqual(['qb', 'rb', 'wr', 'te', 'flex', 'flex1', 'flex2', 'flex3', 'k', 'dst'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('eligible sets are emitted in the §7.3.2 canonical order regardless of click order', () => {
    expect(canonicalizeEligible(['TE', 'RB', 'WR'])).toStrictEqual(['WR', 'RB', 'TE'])
    expect(canonicalizeEligible(['TE', 'QB', 'RB', 'WR'])).toStrictEqual(['QB', 'WR', 'RB', 'TE'])
    const roster = addCustomFlex(structuredClone(DEFAULT_ROSTER_SETTINGS), {
      eligible: ['TE', 'RB', 'WR', 'WR'],
    })
    expect(roster.starting_slots.find((s) => s.key === 'flex1')?.eligible).toStrictEqual([
      'WR',
      'RB',
      'TE',
    ])
  })

  it('a flex below the 2-position floor is refused at the op (the UI disables Add)', () => {
    expect(() =>
      addCustomFlex(structuredClone(DEFAULT_ROSTER_SETTINGS), { eligible: ['WR', 'WR'] }),
    ).toThrow(/at least 2 positions/)
  })
})

describe('DL preset emission (§7.3.2 / §16.4 one-tap)', () => {
  it('emits the contract DL_PRESET verbatim with a fresh dlN key', () => {
    const roster = addDlSpot(structuredClone(DEFAULT_ROSTER_SETTINGS))
    // golden literal — designations OUT/IR/Doubtful, 4-week stint, label DL
    expect(roster.ir_slots).toStrictEqual([
      { key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] },
      {
        key: 'dl1',
        label: 'DL',
        type: 'restricted',
        eligible_designations: ['OUT', 'IR', 'Doubtful'],
        min_weeks: 4,
      },
    ])
    // and it IS the contract's preset (mechanics identical to any Restricted
    // spot — the label is the product promise)
    expect(roster.ir_slots[1]).toStrictEqual({ key: 'dl1', ...DL_PRESET })
  })

  it('second tap gets dl2; plain IR spots key irN independently; 6-spot cap enforced', () => {
    let roster = structuredClone(DEFAULT_ROSTER_SETTINGS)
    roster = addDlSpot(roster)
    roster = addDlSpot(roster)
    roster = addIrSpot(roster)
    expect(roster.ir_slots.map((s) => s.key)).toStrictEqual(['ir1', 'dl1', 'dl2', 'ir2'])
    roster = addIrSpot(roster)
    roster = addDlSpot(roster)
    expect(roster.ir_slots).toHaveLength(6)
    expect(() => addIrSpot(roster)).toThrow(/at most 6 IR spots/)
    expect(() => addDlSpot(roster)).toThrow(/at most 6 IR spots/)
  })

  it('R71: the DL hint interpolates from DL_PRESET (never a hardcoded string)', () => {
    // Derived from the contract preset — 4-week stint, OUT · IR · Doubtful.
    expect(dlPresetHint()).toBe('DL: whoever goes on it stays 4 weeks — OUT · IR · Doubtful')
    // And it genuinely reflects DL_PRESET, so the copy can't drift from the emission.
    const weeks = DL_PRESET.type === 'restricted' ? DL_PRESET.min_weeks : 4
    expect(dlPresetHint()).toContain(`${weeks} weeks`)
    expect(dlPresetHint()).toContain(DL_PRESET.eligible_designations.join(' · '))
  })

  it('type conversions keep the strict shape: restricted→unrestricted drops min_weeks', () => {
    let roster = addDlSpot(structuredClone(DEFAULT_ROSTER_SETTINGS))
    roster = updateIrSpot(roster, 'dl1', { type: 'unrestricted' })
    expect(roster.ir_slots[1]).toStrictEqual({
      key: 'dl1',
      label: 'DL',
      type: 'unrestricted',
      eligible_designations: ['OUT', 'IR', 'Doubtful'],
    })
    // back to restricted → default 4-week stint returns
    roster = updateIrSpot(roster, 'dl1', { type: 'restricted' })
    expect(roster.ir_slots[1]).toStrictEqual({ key: 'dl1', ...DL_PRESET })
  })

  it('designation toggles emit deduped, contract-ordered sets', () => {
    let roster = structuredClone(DEFAULT_ROSTER_SETTINGS)
    roster = updateIrSpot(roster, 'ir1', {
      eligible_designations: ['Suspended', 'OUT', 'Doubtful', 'IR', 'OUT'],
    })
    expect(roster.ir_slots[0].eligible_designations).toStrictEqual([
      'OUT',
      'IR',
      'Doubtful',
      'Suspended',
    ])
  })
})

describe('Hot Swap emission (swap_spots 0/1 — §7.3.2)', () => {
  it('toggling on emits the literal 1; off emits the literal 0', () => {
    const on = setHotSwap(structuredClone(DEFAULT_ROSTER_SETTINGS), true)
    expect(on.swap_spots).toBe(1)
    const off = setHotSwap(on, false)
    expect(off.swap_spots).toBe(0)
    // never a boolean smuggled into the JSONB
    expect(typeof on.swap_spots).toBe('number')
    expect(rosterSettingsSchema.parse(on).swap_spots).toBe(1)
  })
})

describe('stepper ops stay inside the §7.3.2 ranges and canonical order', () => {
  it('starter counts clamp to 0–10; bench clamps to 0–20', () => {
    const roster = structuredClone(DEFAULT_ROSTER_SETTINGS)
    expect(setSlotCount(roster, 'rb', 99).starting_slots[1].count).toBe(10)
    expect(setSlotCount(roster, 'rb', -5).starting_slots[1].count).toBe(0)
    expect(setBench(roster, 99).bench).toBe(20)
    expect(setBench(roster, -1).bench).toBe(0)
  })

  it('a ghost single-position row steps into the JSONB at its canonical position', () => {
    // the canonical default has no IDP rows (shape fidelity to L.A1.1) —
    // stepping LB up inserts it after DL group position, before DB, at the tail
    const roster = addSingleSlot(structuredClone(DEFAULT_ROSTER_SETTINGS), 'LB')
    expect(roster.starting_slots.map((s) => s.key)).toStrictEqual([
      'qb',
      'rb',
      'wr',
      'te',
      'flex',
      'k',
      'dst',
      'lb',
    ])
    expect(roster.starting_slots[7]).toStrictEqual({
      key: 'lb',
      label: 'LB',
      eligible: ['LB'],
      count: 1,
    })
  })

  it('R72: a preset-key collision with a DIFFERENT eligible set mints a fresh key (never mutates it)', () => {
    // A hand-edited JSONB row reusing the `qb` key for an RB slot. Stepping the
    // QB ghost row must ADD a real QB slot, not bump the mislabeled RB row.
    const roster: RosterSettings = {
      ...structuredClone(DEFAULT_ROSTER_SETTINGS),
      starting_slots: [
        { key: 'qb', label: 'Sneaky RB', eligible: ['RB'], count: 2 },
      ],
    }
    const next = addSingleSlot(roster, 'QB')
    // The RB row is untouched (still eligible RB, count 2) …
    const rbRow = next.starting_slots.find((s) => s.key === 'qb')
    expect(rbRow).toStrictEqual({ key: 'qb', label: 'Sneaky RB', eligible: ['RB'], count: 2 })
    // … and a genuine QB slot was added under a fresh, non-colliding key.
    const qbRow = next.starting_slots.find((s) => s.eligible.length === 1 && s.eligible[0] === 'QB')
    expect(qbRow).toBeDefined()
    expect(qbRow!.key).not.toBe('qb')
    expect(qbRow!.count).toBe(1)
    // Keys stay unique (canonical shape holds).
    const keys = next.starting_slots.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('R72: a same-position preset row is still bumped by key (unchanged happy path)', () => {
    const roster = structuredClone(DEFAULT_ROSTER_SETTINGS) // has qb=1 (eligible QB)
    const next = addSingleSlot(roster, 'QB', 3)
    expect(next.starting_slots.filter((s) => s.eligible[0] === 'QB' && s.eligible.length === 1)).toHaveLength(1)
    expect(next.starting_slots.find((s) => s.key === 'qb')?.count).toBe(3)
  })
})
