/**
 * Roster-slot-builder ops — the builder's pure state-transition layer
 * (M1 task L.A2.2; spec §7.3.2).
 *
 * Every op takes the canonical §7.3.2 `roster_settings` JSONB (typed
 * `RosterSettings`) and returns a NEW object emitted through
 * `rosterSettingsSchema.parse`, so the builder can never hand its consumers
 * a non-canonical shape. VALIDATION does not live here — cross-field rules
 * (§7.3.8: slot-sum 1–20, unique keys, designation rules…) are the L.A1.6
 * contract's `validateLeagueSettings`, which the component renders inline.
 * This module owns only what the task text assigns the builder itself:
 * unique key generation, canonical ordering, and preset application.
 *
 * Key-generation rules (D65 — derived from the spec's own printed two-flex
 * example, which keys two generic flexes `flex1`/`flex2` while the
 * QB/WR/RB/TE flex keeps the product name `superflex`):
 *   - custom flex → `superflex` when the eligible set is exactly
 *     {QB, WR, RB, TE} and that key is free; otherwise `flexN` with the
 *     smallest free N ≥ 1;
 *   - plain IR spot → smallest free `irN`; DL-preset spot → smallest free
 *     `dlN` (the shape the §7.3 round-trip fixture uses).
 *
 * Eligible sets are emitted in the §7.3.2 preset-table order
 * (QB, WR, RB, TE, K, DST, DL, LB, DB — WR before RB, exactly as the
 * printed example and the canonical default order them), regardless of the
 * order the commissioner clicked positions in.
 *
 * Deterministic by construction: no clock reads, no randomness (D3 spirit).
 */
import {
  DL_PRESET,
  IR_DESIGNATIONS,
  rosterSettingsSchema,
  type IrDesignation,
  type IrSlot,
  type RosterPosition,
  type RosterSettings,
  type StartingSlot,
} from '@/lib/leagues/settings/league-settings'

// ---------------------------------------------------------------------------
// Canonical ordering
// ---------------------------------------------------------------------------

/**
 * Emission order for eligible-position sets — the §7.3.2 preset-table order
 * (flex "WR, RB, TE"; superflex "QB, WR, RB, TE"). NOT the same as
 * ROSTER_POSITIONS (which lists RB before WR for research surfaces).
 */
export const FLEX_ELIGIBLE_ORDER: readonly RosterPosition[] = [
  'QB',
  'WR',
  'RB',
  'TE',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
]

/** The SUPERFLEX eligible set (§7.3.2 preset table), in canonical order. */
export const SUPERFLEX_ELIGIBLE: readonly RosterPosition[] = ['QB', 'WR', 'RB', 'TE']

/** Dedupe + sort a position selection into the canonical §7.3.2 order. */
export function canonicalizeEligible(positions: readonly RosterPosition[]): RosterPosition[] {
  return [...new Set(positions)].sort(
    (a, b) => FLEX_ELIGIBLE_ORDER.indexOf(a) - FLEX_ELIGIBLE_ORDER.indexOf(b),
  )
}

/** A flex is any slot whose eligible set has 2+ positions (§7.3.2). */
export function isFlexSlot(slot: StartingSlot): boolean {
  return slot.eligible.length >= 2
}

function isSuperflexSet(eligible: readonly RosterPosition[]): boolean {
  return (
    eligible.length === SUPERFLEX_ELIGIBLE.length &&
    SUPERFLEX_ELIGIBLE.every((p) => eligible.includes(p))
  )
}

/**
 * Display/emission group order for starting slots (§7.3.2 preset table +
 * display rule): offense singles (QB, RB, WR, TE), then every flex, then
 * K, D/ST, then the IDP singles. Hot Swap renders between the flex group
 * and K in the UI but is not a starting slot.
 */
const SLOT_GROUP_ORDER: readonly (RosterPosition | 'flex')[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'flex',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
]

function slotGroupIndex(slot: StartingSlot): number {
  return SLOT_GROUP_ORDER.indexOf(isFlexSlot(slot) ? 'flex' : slot.eligible[0])
}

/** Insert a slot at its canonical position (stable within its group). */
function insertSlot(slots: readonly StartingSlot[], slot: StartingSlot): StartingSlot[] {
  const group = slotGroupIndex(slot)
  const at = slots.findIndex((s) => slotGroupIndex(s) > group)
  const next = [...slots]
  next.splice(at === -1 ? next.length : at, 0, slot)
  return next
}

// ---------------------------------------------------------------------------
// Key + label generation
// ---------------------------------------------------------------------------

function smallestFreeKey(existing: ReadonlySet<string>, prefix: string): string {
  let n = 1
  while (existing.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

/**
 * Unique key for a new flex slot: `superflex` for the QB/WR/RB/TE set while
 * free, else the smallest free `flexN` (the spec example's `flex1`/`flex2`).
 */
export function generateFlexKey(
  existingKeys: readonly string[],
  eligible: readonly RosterPosition[],
): string {
  const taken = new Set(existingKeys)
  if (isSuperflexSet(eligible) && !taken.has('superflex')) return 'superflex'
  return smallestFreeKey(taken, 'flex')
}

/** Short display letters for flex-label suggestions (§7.3.2 label style). */
const POSITION_LETTERS: Record<RosterPosition, string> = {
  QB: 'Q',
  RB: 'R',
  WR: 'W',
  TE: 'T',
  K: 'K',
  DST: 'D',
  DL: 'DL',
  LB: 'LB',
  DB: 'DB',
}

/**
 * Suggested label for a flex eligible set, in the spec's own label style:
 * "W/R/T", "W/T", "SUPERFLEX". The commissioner can override (the label is
 * commissioner-named; the suggestion just makes the happy path fast).
 */
export function suggestFlexLabel(eligible: readonly RosterPosition[]): string {
  const canonical = canonicalizeEligible(eligible)
  if (isSuperflexSet(canonical)) return 'SUPERFLEX'
  return canonical.map((p) => POSITION_LETTERS[p]).join('/')
}

// ---------------------------------------------------------------------------
// Single-position preset rows (§7.3.2 preset table)
// ---------------------------------------------------------------------------

/** Preset key + label for each single-position slot (§7.3.2 preset table). */
export const SINGLE_POSITION_PRESETS: Record<
  RosterPosition,
  { key: string; label: string }
> = {
  QB: { key: 'qb', label: 'QB' },
  RB: { key: 'rb', label: 'RB' },
  WR: { key: 'wr', label: 'WR' },
  TE: { key: 'te', label: 'TE' },
  K: { key: 'k', label: 'K' },
  DST: { key: 'dst', label: 'D/ST' },
  DL: { key: 'dl', label: 'DL' },
  LB: { key: 'lb', label: 'LB' },
  DB: { key: 'db', label: 'DB' },
}

// ---------------------------------------------------------------------------
// Ops — each returns a fresh schema-parsed RosterSettings
// ---------------------------------------------------------------------------

function emit(candidate: RosterSettings): RosterSettings {
  return rosterSettingsSchema.parse(candidate)
}

const clampInt = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.trunc(n)))

/** Set a starting slot's count (clamped to the §7.3.2 range 0–10). */
export function setSlotCount(roster: RosterSettings, key: string, count: number): RosterSettings {
  return emit({
    ...roster,
    starting_slots: roster.starting_slots.map((s) =>
      s.key === key ? { ...s, count: clampInt(count, 0, 10) } : s,
    ),
  })
}

/**
 * Add a single-position preset row (used when a ghost row — a preset
 * position absent from the JSONB — is stepped above 0). Inserted at its
 * canonical position so emissions stay in preset-table order.
 */
export function addSingleSlot(
  roster: RosterSettings,
  position: RosterPosition,
  count = 1,
): RosterSettings {
  const preset = SINGLE_POSITION_PRESETS[position]
  if (roster.starting_slots.some((s) => s.key === preset.key)) {
    return setSlotCount(roster, preset.key, count)
  }
  return emit({
    ...roster,
    starting_slots: insertSlot(roster.starting_slots, {
      key: preset.key,
      label: preset.label,
      eligible: [position],
      count: clampInt(count, 0, 10),
    }),
  })
}

/**
 * "Add Custom Flex" (§7.3.2): position multi-select of ≥ 2, commissioner-
 * named label (falls back to the suggestion), generated unique key. New
 * flexes join the flex group in add order — reproducing the spec's printed
 * two-flex ordering (qb…te, flex1, flex2, superflex, k, dst).
 */
export function addCustomFlex(
  roster: RosterSettings,
  input: { eligible: readonly RosterPosition[]; label?: string; count?: number },
): RosterSettings {
  const eligible = canonicalizeEligible(input.eligible)
  if (eligible.length < 2) {
    throw new Error('A flex slot accepts at least 2 positions (§7.3.2) — pick 2 or more.')
  }
  const label = input.label?.trim() || suggestFlexLabel(eligible)
  return emit({
    ...roster,
    starting_slots: insertSlot(roster.starting_slots, {
      key: generateFlexKey(
        roster.starting_slots.map((s) => s.key),
        eligible,
      ),
      label,
      eligible,
      count: clampInt(input.count ?? 1, 0, 10),
    }),
  })
}

/** Remove a starting slot (the UI exposes this for flex rows only). */
export function removeSlot(roster: RosterSettings, key: string): RosterSettings {
  return emit({
    ...roster,
    starting_slots: roster.starting_slots.filter((s) => s.key !== key),
  })
}

/** Set the bench count (clamped to the §7.3.2 range 0–20). */
export function setBench(roster: RosterSettings, bench: number): RosterSettings {
  return emit({ ...roster, bench: clampInt(bench, 0, 20) })
}

const MAX_IR_SPOTS = 6

/**
 * Add a plain IR spot — the canonical default configuration (Unrestricted,
 * OUT/IR — the §7.3.2 default designations), keyed `irN`.
 */
export function addIrSpot(roster: RosterSettings): RosterSettings {
  if (roster.ir_slots.length >= MAX_IR_SPOTS) {
    throw new Error('A league can have at most 6 IR spots (§7.3.2).')
  }
  const spot: IrSlot = {
    key: smallestFreeKey(new Set(roster.ir_slots.map((s) => s.key)), 'ir'),
    type: 'unrestricted',
    eligible_designations: ['OUT', 'IR'],
  }
  return emit({ ...roster, ir_slots: [...roster.ir_slots, spot] })
}

/**
 * One-tap "DL" preset (§7.3.2 / §16.4 — the product promise): a Restricted
 * IR spot labeled DL — designations OUT, IR, Doubtful; min_weeks 4 — applied
 * verbatim from the contract's `DL_PRESET`, keyed `dlN`.
 */
export function addDlSpot(roster: RosterSettings): RosterSettings {
  if (roster.ir_slots.length >= MAX_IR_SPOTS) {
    throw new Error('A league can have at most 6 IR spots (§7.3.2).')
  }
  const spot = {
    key: smallestFreeKey(new Set(roster.ir_slots.map((s) => s.key)), 'dl'),
    ...DL_PRESET,
  } as IrSlot
  return emit({ ...roster, ir_slots: [...roster.ir_slots, spot] })
}

/** Remove an IR spot. */
export function removeIrSpot(roster: RosterSettings, key: string): RosterSettings {
  return emit({ ...roster, ir_slots: roster.ir_slots.filter((s) => s.key !== key) })
}

/** Dedupe + sort designations into the contract's IR_DESIGNATIONS order. */
function canonicalizeDesignations(designations: readonly IrDesignation[]): IrDesignation[] {
  return [...new Set(designations)].sort(
    (a, b) => IR_DESIGNATIONS.indexOf(a) - IR_DESIGNATIONS.indexOf(b),
  )
}

/**
 * Reconfigure an IR spot. Type conversion keeps the strict §7.3.2 shape:
 * restricted → unrestricted drops `min_weeks` (the canonical unrestricted
 * shape carries no such key); unrestricted → restricted starts at the
 * default stint of 4 weeks. Designation sets are emitted deduped, in the
 * contract's IR_DESIGNATIONS order, regardless of toggle order.
 */
export function updateIrSpot(
  roster: RosterSettings,
  key: string,
  patch: {
    type?: IrSlot['type']
    eligible_designations?: IrSlot['eligible_designations']
    min_weeks?: number
  },
): RosterSettings {
  return emit({
    ...roster,
    ir_slots: roster.ir_slots.map((s): IrSlot => {
      if (s.key !== key) return s
      const type = patch.type ?? s.type
      const eligible_designations = canonicalizeDesignations(
        patch.eligible_designations ?? s.eligible_designations,
      )
      if (type === 'unrestricted') {
        return {
          key: s.key,
          ...(s.label !== undefined ? { label: s.label } : {}),
          type,
          eligible_designations,
        }
      }
      const current = s.type === 'restricted' ? s.min_weeks : 4
      return {
        key: s.key,
        ...(s.label !== undefined ? { label: s.label } : {}),
        type,
        eligible_designations,
        min_weeks: clampInt(patch.min_weeks ?? current, 1, 17),
      }
    }),
  })
}

/**
 * The Hot Swap toggle (§7.3.2 Swap spot — surfaced as "Hot Swap" in ALL UI
 * copy, §16.4). Stored as `swap_spots` 0/1: on/off, one swap per team.
 */
export function setHotSwap(roster: RosterSettings, on: boolean): RosterSettings {
  return emit({ ...roster, swap_spots: on ? 1 : 0 })
}
