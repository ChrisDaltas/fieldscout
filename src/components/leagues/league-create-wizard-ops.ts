/**
 * Create-wizard ops (M1 task L.A2.1; spec §16.2, §7.3, §7.3.8, §16.5.1).
 *
 * Pure, framework-free layer for `league-create-wizard.tsx` — every settings
 * transform the wizard performs lives here so it can be golden-pinned in
 * vitest without rendering React (the roster-slot-builder-ops / scoring-
 * template-picker-ops precedent). The React component holds only step
 * navigation and control wiring; this module owns the settings algebra.
 *
 * The one derived-field rule the wizard MUST enforce (ledger F27, Q10 ruling
 * (a) / spec v2.8.6): `playoff_start_week` is **read-only-derived** =
 * `regular_season_weeks + 1` (strict continuity, §7.3.1/§7.3.8). The stored
 * value is kept for §12.1 compat and must equal the derived value on every
 * emission — the contract's `validateLeagueSettings` seam check is the
 * backstop, but the wizard never offers a free input for the field, so the
 * two can never diverge here. `reconcileDerived` re-applies the derivation
 * after every settings edit.
 */
import {
  defaultsForTeamCount,
  deriveDefaultVetoVotes,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'

/**
 * The upcoming NFL season the wizard creates leagues for. Single active
 * season in this preseason window (2026 seed — migration 039 / PROGRESS
 * "preseason data state"); the create RPC accepts 2020–2100, and the wizard
 * lets the commissioner bump to next year for an off-season setup.
 */
export const CURRENT_SEASON = 2026
export const SEASON_RANGE = [CURRENT_SEASON, CURRENT_SEASON + 1] as const

/** The default team_count the wizard opens on (§7.3.1 "D" column). */
export const DEFAULT_WIZARD_TEAM_COUNT = 12

/**
 * The wizard's whole draft: the create-arg fields (name/season/team_name +
 * the §7.3.3 template choice, which is a §12.1 typed column carried ALONGSIDE
 * the settings split, never inside it) plus the full §7.3 `LeagueSettings`
 * object. `scoringSystemId` is null until the scoring step picks one.
 */
export interface WizardDraft {
  name: string
  season: number
  teamName: string
  scoringSystemId: string | null
  settings: LeagueSettings
}

/**
 * A fresh draft with every §7.3 setting pre-filled from the creation defaults
 * (the "happy path is <2 min" goal, §7.3): defaults come through the
 * contract's `defaultsForTeamCount` so the §7.3.5 derived `trade_veto_votes`
 * default (⌈team_count/2⌉, R63) is correct rather than a hard-coded 6, and
 * the returned settings object is a fresh MUTABLE clone (never the frozen
 * module constant). Name/team blank; no template chosen yet.
 */
export function initialWizardDraft(): WizardDraft {
  return {
    name: '',
    season: CURRENT_SEASON,
    teamName: '',
    scoringSystemId: null,
    settings: defaultsForTeamCount(DEFAULT_WIZARD_TEAM_COUNT),
  }
}

/**
 * F27 (Q10/v2.8.6): the derived playoff start — the week after the regular
 * season ends. The wizard renders this read-only next to `regular_season_weeks`
 * and never as a free input.
 */
export function derivePlayoffStartWeek(regularSeasonWeeks: number): number {
  return regularSeasonWeeks + 1
}

/**
 * Re-apply the wizard's derived-field rules after a settings edit, given the
 * PREVIOUS settings (to detect what changed):
 *
 *   1. **F27 — always:** `playoff_start_week = regular_season_weeks + 1`. The
 *      field has no wizard control, so this keeps the stored value consistent
 *      on every emission (the seam check backstops it).
 *   2. **§7.3.5 derived default — on team_count change, when untouched:** if
 *      `trade_veto_votes` was still sitting at the OLD ⌈team_count/2⌉ default,
 *      follow it to the NEW one (the contract's `defaultsForTeamCount`
 *      derivation, R63). A commissioner who customized the veto count keeps
 *      their value — the equality check is what distinguishes the two.
 *
 * Pure: returns a fresh object, never mutates `next`.
 */
export function reconcileDerived(prev: LeagueSettings, next: LeagueSettings): LeagueSettings {
  const reconciled: LeagueSettings = {
    ...next,
    playoff_start_week: derivePlayoffStartWeek(next.regular_season_weeks),
  }
  if (
    next.team_count !== prev.team_count &&
    prev.trade_veto_votes === deriveDefaultVetoVotes(prev.team_count)
  ) {
    reconciled.trade_veto_votes = deriveDefaultVetoVotes(next.team_count)
  }
  return reconciled
}

/**
 * The create payload the wizard POSTs (minus `action_id`, which the
 * `useCreateLeague` hook stamps per-submit for idempotency — D68). Returns
 * null while the draft is not submittable (no name, or no template chosen):
 * the invite/create step disables its button on null.
 *
 * `team_name` is omitted when blank — the RPC derives "<display name>'s Team"
 * (leagues-service treats ''/whitespace as absent).
 */
export interface WizardCreateInput {
  name: string
  season: number
  scoring_system_id: string
  team_name?: string
  settings: LeagueSettings
}

export function toCreateInput(draft: WizardDraft): WizardCreateInput | null {
  const name = draft.name.trim()
  if (name.length === 0 || draft.scoringSystemId === null) return null
  const teamName = draft.teamName.trim()
  return {
    name,
    season: draft.season,
    scoring_system_id: draft.scoringSystemId,
    ...(teamName.length > 0 ? { team_name: teamName } : {}),
    settings: draft.settings,
  }
}
