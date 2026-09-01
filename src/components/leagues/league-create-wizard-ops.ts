/**
 * Create-wizard ops (M1 task L.A2.1; spec §16.2, §7.3, §7.3.8, §16.5.1).
 *
 * Pure, framework-free layer for `league-create-wizard.tsx` — every settings
 * transform the wizard performs lives here so it can be golden-pinned in
 * vitest without rendering React (the roster-slot-builder-ops / scoring-
 * template-picker-ops precedent). The React component holds only step
 * navigation and control wiring; this module owns the settings algebra.
 *
 * The derived/dependent-field rules the wizard enforces (F27's read-only
 * `playoff_start_week`, the §7.3.5 veto re-default, R108's re-clamps) live in
 * the SHARED `derived-settings` module so the wizard and the L.A2.4 settings
 * panel can never diverge; they are re-exported here for the wizard's existing
 * callers (`league-create-wizard.tsx` + this file's test).
 */
import {
  derivePlayoffStartWeek,
  PLAYOFF_TEAMS_OPTIONS,
  reconcileDerived,
} from '@/lib/leagues/settings/derived-settings'
import {
  defaultsForTeamCount,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'

import { effectiveTemplateSelection } from './scoring-template-picker-ops'

export { derivePlayoffStartWeek, PLAYOFF_TEAMS_OPTIONS, reconcileDerived }

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
 * object. `scoringSystemId` holds the user's EXPLICIT pick only, null while
 * none exists — the §7.3.3 default preselection (the active family's Scout:
 * No PPR → Scout Standard, PPR → Scout PPR; SC.3/SC.4) is a DERIVED
 * fallback the modal resolves from the fetched template rows and passes
 * into `toCreateInput`, never a value written into this draft (so an
 * explicit pick and the default can never be confused, and the default can
 * never overwrite a pick).
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
 * module constant). Name/team blank; no EXPLICIT template pick yet — the
 * §7.3.3 Scout preselection is derived at the modal from the fetched rows
 * (SC.3), never stored into a fresh draft.
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
 * The create payload the wizard POSTs (minus `action_id`, which the
 * `useCreateLeague` hook stamps per-submit for idempotency — D68). Returns
 * null while the draft is not submittable (no name, or no template chosen
 * NOR defaulted): the invite/create step disables its button on null.
 *
 * SC.3/SC.4 (§7.3.3's system-default bullet): `defaultScoringSystemId` is
 * the active family's Scout id the modal resolves by natural key
 * (`resolveDefaultTemplateId` with the style family — No PPR → Scout
 * Standard, PPR → Scout PPR), filling an empty pick through the shared
 * `effectiveTemplateSelection` rule — an explicit pick always wins, and the
 * payload always carries an EXPLICIT template id either way (`create_league`
 * knows nothing of preselection; a preselection, never a silent write).
 * Null (rows not loaded, or a seed without that Scout row) degrades to the
 * pre-SC.3 explicit-only gate.
 *
 * `team_name` is omitted when blank — the RPC derives "<username>'s Team"
 * (leagues-service treats ''/whitespace as absent).
 */
export interface WizardCreateInput {
  name: string
  season: number
  scoring_system_id: string
  team_name?: string
  settings: LeagueSettings
}

export function toCreateInput(
  draft: WizardDraft,
  defaultScoringSystemId: string | null = null,
): WizardCreateInput | null {
  const name = draft.name.trim()
  const scoringSystemId = effectiveTemplateSelection(
    draft.scoringSystemId,
    defaultScoringSystemId,
  )
  if (name.length === 0 || scoringSystemId === null) return null
  const teamName = draft.teamName.trim()
  return {
    name,
    season: draft.season,
    scoring_system_id: scoringSystemId,
    ...(teamName.length > 0 ? { team_name: teamName } : {}),
    settings: draft.settings,
  }
}
