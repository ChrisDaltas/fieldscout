/**
 * Standalone practice-draft launch ops (MP task MP.4; spec v2.16 §8.8;
 * tasks-MP §4 rule 12 / D229).
 *
 * Pure, framework-free settings algebra for `mock-launch-dialog.tsx` — the
 * `league-create-wizard-ops` precedent, and for the same reason: the dialog
 * holds step navigation and control wiring, this module owns everything that
 * can be golden-pinned in vitest without rendering React.
 *
 * ---------------------------------------------------------------------------
 * THE SEAM (§4 rule 12 / D229(5)) — AND HOW YOU KNOW IT IS ONE.
 * ---------------------------------------------------------------------------
 * `create_mock_draft`'s standalone arm takes a settings OBJECT; where the
 * object came from is the caller's business (095 says so in its own body).
 * The rule this module has to keep is that **league inheritance later is a
 * new SOURCE, not a rewrite** — so the object is never built out of a
 * template lookup, it is built out of `LeagueSettings`:
 *
 *     mockLaunchSettings(settings: LeagueSettings, scoringSystemId) → payload
 *
 * `LeagueSettings` is the ONE §7.3 catalog every league already stores
 * (`leagues.team_count` + `leagues.roster_settings` + `leagues.settings->
 * 'draft'`, reassembled by `mergeSettings`). The template path calls it with
 * `defaultsForTeamCount(...)`; the deferred league path calls the SAME
 * function with `mergeSettings(leagueRow)` and changes nothing else. That is
 * the whole cost of the deferred feature at this layer, and
 * `mock-launch-ops.test.ts` proves it by driving this function from a
 * league-shaped settings object that shares no field value with the
 * defaults — no new code path, same payload shape, still accepted by the
 * server's own schema.
 *
 * The template choice rides the payload as `draft.scoring_system_id`, which
 * lands in `drafts.config->>'scoring_system_id'` — the same place MP.2 put
 * `config->'roster'`, and for the same reason (the draft row describes its
 * own settings). Adding it needed no signature change, exactly as D236(4)
 * predicted.
 *
 * Defaults are NOT restated here. `initialMockLaunchDraft()` returns
 * `defaultsForTeamCount(...)` — the contract's own parsed defaults — so
 * D229(3)'s **"no mock-specific default of any kind"** is structural rather
 * than a promise: there is no expression in this module that could produce
 * one. (The claim is exactly that, and no wider — R507 corrected a first cut
 * that said "no numeric literal for any clock anywhere in the new code",
 * which one `grep` disproves: option labels and input bounds are numbers, and
 * they are OFFERED values, not defaults. Verified against
 * `league-settings.ts` rather than copied from the task text: pick clock 90,
 * nomination 30, bid 20, anti-snipe 10, `DEFAULT_ROSTER_SETTINGS` — pinned in
 * the colocated test.)
 */
import type { StandaloneMockSettings } from '@/lib/leagues/api/draft-service'
import { reconcileDerived } from '@/lib/leagues/settings/derived-settings'
import {
  defaultsForTeamCount,
  validateLeagueSettings,
  type FieldIssue,
  LEAGUE_SETTINGS_DEFAULTS,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'

/**
 * The team count the dialog opens on — **read off the contract's own parsed
 * defaults**, so it is not a literal at all (R508).
 *
 * The first cut wrote `= 12` and claimed it was "the same constant the create
 * wizard uses". That was false in a way worth recording: `league-settings`'
 * `DEFAULT_TEAM_COUNT` is module-private and the wizard exports its OWN
 * `DEFAULT_WIZARD_TEAM_COUNT`, so the literal here would have been a **third**
 * 12. `LEAGUE_SETTINGS_DEFAULTS` is `leagueSettingsSchema.parse({})`, i.e. the
 * §7.3.1 "D" column itself. The wizard's duplicate is left alone — it is not
 * this task's file — but nothing new joins it.
 */
export const MOCK_DEFAULT_TEAM_COUNT: LeagueSettings['team_count'] =
  LEAGUE_SETTINGS_DEFAULTS.team_count

export type CpuSpeed = 'realistic' | 'fast'

/**
 * The dialog's whole draft: the full §7.3 settings object (only the §7.3.1
 * team count, the §7.3.2 roster and the §7.3.8 draft block are reachable
 * from the form — the rest are season-long rules a practice draft never
 * reads), plus the two launch-only choices.
 */
export interface MockLaunchDraft {
  settings: LeagueSettings
  scoringSystemId: string | null
  cpuSpeed: CpuSpeed
}

/**
 * A fresh draft, every setting pre-filled from the creation defaults through
 * `defaultsForTeamCount` (so §7.3.5's derived `trade_veto_votes` is right and
 * the returned object is a fresh MUTABLE clone, never the frozen module
 * constant). No template chosen yet — D229(1)'s "pick one at launch" is the
 * launcher's pick, so it starts null exactly as the create wizard's does
 * (`initialWizardDraft`), and nothing here invents which of the six is best.
 */
export function initialMockLaunchDraft(): MockLaunchDraft {
  return {
    settings: defaultsForTeamCount(MOCK_DEFAULT_TEAM_COUNT),
    scoringSystemId: null,
    cpuSpeed: 'realistic',
  }
}

/** Apply a settings patch through the SHARED derived-field reconciler, so the
 *  dialog can never drift from the wizard/settings-panel on a dependent
 *  field (a team-count change re-derives what §7.3.5 says it must). */
export function patchMockSettings(
  draft: MockLaunchDraft,
  patch: Partial<LeagueSettings>,
): MockLaunchDraft {
  return {
    ...draft,
    settings: reconcileDerived(draft.settings, { ...draft.settings, ...patch }),
  }
}

/** Apply a §7.3.8 draft-block patch (the clocks, the auction knobs, the
 *  draft type) through the same reconciler. */
export function patchMockDraftConfig(
  draft: MockLaunchDraft,
  patch: Partial<LeagueSettings['draft']>,
): MockLaunchDraft {
  return patchMockSettings(draft, { draft: { ...draft.settings.draft, ...patch } })
}

// ---------------------------------------------------------------------------
// The payload — the settings OBJECT the RPC takes
// ---------------------------------------------------------------------------

/**
 * The `p_settings` object `create_mock_draft`'s standalone arm reads
 * (095 §7): `team_count`, `roster_settings`, and the `draft` block that
 * becomes `drafts.config` verbatim. Its three field shapes are the league's
 * three: `leagues.team_count`, `leagues.roster_settings`,
 * `leagues.settings->'draft'`.
 */
export type MockLaunchSettings = StandaloneMockSettings

export interface MockLaunchInput {
  cpu_speed: CpuSpeed
  settings: MockLaunchSettings
}

/**
 * THE SEAM ITSELF (see the file header). Projects any `LeagueSettings` +
 * a chosen scoring template onto the RPC's settings object. The template
 * path and the deferred *"fill this from league X"* path are the same
 * function with a different first argument.
 *
 * Deliberately NOT a subset of the catalog: the whole §7.3.8 draft block
 * goes over, because that block is exactly what the league arm snapshots
 * into `config` (095: `v_config := COALESCE(v_league.settings->'draft', …)`).
 * A standalone mock's config is therefore shape-identical to a league mock's
 * — which is what makes every engine reader indifferent to which arm minted
 * it, and what makes the deferred feature a source swap.
 */
export function mockLaunchSettings(
  settings: LeagueSettings,
  scoringSystemId: string,
): MockLaunchSettings {
  return {
    team_count: settings.team_count,
    roster_settings: settings.roster_settings,
    draft: { ...settings.draft, scoring_system_id: scoringSystemId },
  }
}

/**
 * The POST body, or null while the draft is not launchable. Null has exactly
 * two causes and `mockLaunchBlockedReason` names both: no template chosen,
 * or a §7.3.8 settings violation. The button disables on null; the server
 * refuses independently (095's `draft_settings_range_guard`), so this is a
 * pre-flight, never the authority.
 */
export function toMockLaunchInput(draft: MockLaunchDraft): MockLaunchInput | null {
  if (draft.scoringSystemId === null) return null
  if (mockLaunchIssues(draft).length > 0) return null
  return {
    cpu_speed: draft.cpuSpeed,
    settings: mockLaunchSettings(draft.settings, draft.scoringSystemId),
  }
}

/**
 * The §7.3.8 violations the form can produce, through the contract's OWN
 * validator — never a second set of messages (`validateLeagueSettings` is
 * the same function the create wizard, the settings panel and the roster
 * builder render). Only the fields this dialog can edit are surfaced: the
 * rest of the catalog is untouched creation defaults and cannot be wrong,
 * and an error naming a waiver rule inside a practice-draft dialog would be
 * a message about a control that is not on screen.
 */
export function mockLaunchIssues(draft: MockLaunchDraft): FieldIssue[] {
  return validateLeagueSettings(draft.settings).errors.filter(
    (issue) =>
      issue.field === 'team_count' ||
      issue.field.startsWith('roster_settings') ||
      issue.field.startsWith('draft'),
  )
}

/**
 * Why the launch button is disabled, or null when it is not. One reason at a
 * time, most-actionable first; the settings message is the contract's own
 * text (§16.5.2 friendly refusals are UX, and re-wording one here would be a
 * second voice for the same rule).
 */
export function mockLaunchBlockedReason(draft: MockLaunchDraft): string | null {
  const issues = mockLaunchIssues(draft)
  if (issues.length > 0) return issues[0]!.message
  if (draft.scoringSystemId === null) return 'Pick a scoring template to start.'
  return null
}
