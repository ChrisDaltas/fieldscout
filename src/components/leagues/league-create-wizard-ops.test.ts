/**
 * L.A2.1 create-wizard ops — schema-fixture golden pins (tasks-M1 §4.3 UI
 * scoping: "schema-fixture golden pins where the wizard produces a canonical
 * settings object … the F27 derived-value invariant pinned"; cited in the
 * self-review note + the D39 browser pass in the session log).
 *
 * Pinned here:
 *   1. `initialWizardDraft` pre-fills EVERY §7.3 field from the creation
 *      defaults (the happy-path <2 min goal) and hands out a fresh MUTABLE
 *      settings object, with the §7.3.5 derived veto default correct (⌈12/2⌉).
 *   2. **F27 (Q10/v2.8.6): `playoff_start_week` is read-only-derived =
 *      `regular_season_weeks + 1` on every emission** — the derivation, the
 *      reconcile enforcing it (even over a hostile free value), and a
 *      DELIBERATE-BREAK golden pin (the 14→15 literal) that flips when the
 *      derivation is broken.
 *   3. The §7.3.5 veto re-default on a team_count change (untouched → follows;
 *      customized → preserved).
 *   4. A non-default full wizard emission deep-equals what `splitSettings`
 *      expects — `mergeSettings(splitSettings(x)) ≡ x` — and stays valid.
 *   5. `toCreateInput` gates on name + template and shapes the create payload.
 */
import { describe, expect, it } from 'vitest'

import {
  deriveDefaultVetoVotes,
  LEAGUE_SETTINGS_DEFAULTS,
  mergeSettings,
  splitSettings,
  validateLeagueSettings,
  type LeagueRow,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'
import { ROUND_TRIP_SETTINGS } from '@/lib/leagues/settings/round-trip-fixture'

import {
  CURRENT_SEASON,
  derivePlayoffStartWeek,
  initialWizardDraft,
  reconcileDerived,
  toCreateInput,
  type WizardDraft,
} from './league-create-wizard-ops'

const SCORING_ID = '00000000-0000-4000-8000-00000000c0de'

/** Rebuild a full settings object from a split — the exact shape the create
 *  RPC receives (typed columns + `settings` blob) — and merge it back. */
function roundTrip(settings: LeagueSettings): LeagueSettings {
  const { columns, blob } = splitSettings(settings)
  const row = { ...columns, settings: blob } as LeagueRow
  return mergeSettings(row)
}

describe('initialWizardDraft — defaults pre-filled (happy path)', () => {
  it('opens on the §7.3 creation defaults with blank name/team, no template', () => {
    const draft = initialWizardDraft()
    expect(draft.name).toBe('')
    expect(draft.teamName).toBe('')
    expect(draft.scoringSystemId).toBeNull()
    expect(draft.season).toBe(CURRENT_SEASON)
    // Every §7.3 setting equals the creation defaults — the commissioner
    // only changes what they care about.
    expect(draft.settings).toEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('hands out a fresh MUTABLE settings object (never the frozen constant)', () => {
    const draft = initialWizardDraft()
    expect(Object.isFrozen(draft.settings)).toBe(false)
    // Two calls do not share structure.
    expect(draft.settings).not.toBe(initialWizardDraft().settings)
  })

  it('carries the §7.3.5 DERIVED veto default (⌈12/2⌉ = 6), not a hard-coded 6', () => {
    expect(initialWizardDraft().settings.trade_veto_votes).toBe(deriveDefaultVetoVotes(12))
    expect(initialWizardDraft().settings.trade_veto_votes).toBe(6)
  })
})

describe('F27 — playoff_start_week is read-only-derived (Q10/v2.8.6)', () => {
  it('derivePlayoffStartWeek = regular_season_weeks + 1 across the range', () => {
    expect(derivePlayoffStartWeek(12)).toBe(13)
    expect(derivePlayoffStartWeek(13)).toBe(14)
    expect(derivePlayoffStartWeek(14)).toBe(15) // GOLDEN PIN (default) — the deliberate-break target
    expect(derivePlayoffStartWeek(15)).toBe(16)
  })

  it('reconcile re-derives playoff_start_week whenever regular_season_weeks changes', () => {
    const base = initialWizardDraft().settings
    for (const rsw of [12, 13, 14, 15]) {
      const next = reconcileDerived(base, { ...base, regular_season_weeks: rsw })
      expect(next.playoff_start_week).toBe(rsw + 1)
      // The emission always satisfies the contract's seam check.
      expect(validateLeagueSettings(next).valid).toBe(true)
    }
  })

  it('reconcile OVERRIDES a hostile free playoff_start_week value (never an input)', () => {
    const base = initialWizardDraft().settings // rsw 14
    const tampered = { ...base, playoff_start_week: 99 as LeagueSettings['playoff_start_week'] }
    expect(reconcileDerived(base, tampered).playoff_start_week).toBe(15)
  })

  it('the default league emits the consistent pair (14 → start 15)', () => {
    const s = initialWizardDraft().settings
    expect(s.regular_season_weeks).toBe(14)
    expect(s.playoff_start_week).toBe(15)
  })
})

describe('§7.3.5 — veto default follows a team_count change only while untouched', () => {
  it('untouched veto (= old ⌈team_count/2⌉) follows to the new default', () => {
    const base = initialWizardDraft().settings // team_count 12, veto 6
    const next = reconcileDerived(base, { ...base, team_count: 16 })
    expect(next.trade_veto_votes).toBe(deriveDefaultVetoVotes(16)) // 8
  })

  it('a customized veto is preserved across a team_count change', () => {
    const base = { ...initialWizardDraft().settings, trade_veto_votes: 3 }
    const next = reconcileDerived(base, { ...base, team_count: 16 })
    expect(next.trade_veto_votes).toBe(3)
  })

  it('an unchanged team_count never touches the veto count', () => {
    const base = { ...initialWizardDraft().settings, trade_veto_votes: 6 }
    const next = reconcileDerived(base, { ...base, faab_budget: 250 })
    expect(next.trade_veto_votes).toBe(6)
  })
})

describe('non-default wizard emission ≡ what splitSettings expects', () => {
  it('a realistic non-default settings object round-trips through split/merge', () => {
    // ROUND_TRIP_SETTINGS is the canonical every-leaf-non-default fixture; it
    // is exactly the shape a fully-driven wizard emits.
    expect(roundTrip(ROUND_TRIP_SETTINGS)).toEqual(ROUND_TRIP_SETTINGS)
    expect(validateLeagueSettings(ROUND_TRIP_SETTINGS).valid).toBe(true)
  })

  it('reconcile is idempotent on a consistent non-default object', () => {
    // playoff_start_week 14 = 13+1 stays; the custom veto (5) is preserved
    // (team_count unchanged) — reconcile corrupts nothing.
    expect(reconcileDerived(ROUND_TRIP_SETTINGS, ROUND_TRIP_SETTINGS)).toEqual(ROUND_TRIP_SETTINGS)
  })
})

describe('toCreateInput — submit gating + payload shape', () => {
  const ready = (overrides: Partial<WizardDraft> = {}): WizardDraft => ({
    ...initialWizardDraft(),
    name: 'Sunday Legends',
    scoringSystemId: SCORING_ID,
    ...overrides,
  })

  it('is null until a name AND a template exist', () => {
    expect(toCreateInput(initialWizardDraft())).toBeNull() // no name, no template
    expect(toCreateInput(ready({ name: '   ' }))).toBeNull() // whitespace name
    expect(toCreateInput(ready({ scoringSystemId: null }))).toBeNull() // no template
  })

  it('trims the name, omits a blank team_name, and carries season + template + settings', () => {
    const input = toCreateInput(ready({ name: '  Sunday Legends  ', teamName: '  ' }))
    expect(input).not.toBeNull()
    expect(input!.name).toBe('Sunday Legends')
    expect(input!.team_name).toBeUndefined()
    expect(input!.season).toBe(CURRENT_SEASON)
    expect(input!.scoring_system_id).toBe(SCORING_ID)
    expect(input!.settings).toEqual(LEAGUE_SETTINGS_DEFAULTS)
  })

  it('includes a provided team_name (trimmed)', () => {
    const input = toCreateInput(ready({ teamName: '  The Steel Curtain ' }))
    expect(input!.team_name).toBe('The Steel Curtain')
  })

  it('the emitted settings always satisfy the F27 seam (start = weeks + 1)', () => {
    const input = toCreateInput(ready())
    expect(input!.settings.playoff_start_week).toBe(input!.settings.regular_season_weeks + 1)
  })
})
