/**
 * Pure ops for the League settings panel (the `*-ops.ts` pattern — no React,
 * no DOM; pinned by `settings-panel-ops.test.ts`).
 *
 * `DIVISION_OPTIONS` — spec §7.3.1 `divisions` row, v2.16.12 (Q30 RULED (d),
 * Chris 2026-09-02): divisions are CUT from v1. The setting stays in the
 * catalog (Zod keeps its 1–2 parse range so stored rows stay valid — PROGRESS
 * F221's return path is additive), the schedule engine IGNORES the value
 * (migration 110, pinned in pgTAP 058), and the select renders EXACTLY ONE
 * option. This constant is the one home of that pin (tasks-M4 L.D1.2 item 1,
 * R719/R723): when divisions return, the option list grows here and the
 * engine's ignore-pin flips in the same change.
 */
import type { SettingPolicies, SettingPolicy } from '@/hooks/use-commish-setting-policy'
import type { CommishChangeSettingResult } from '@/lib/leagues/api/commish-setting-service'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import type { Json } from '@/types/database'

export const DIVISION_OPTIONS = [1] as const

/** `{value,label}` list for the Divisions select — the same shape `numOptions` builds. */
export function divisionSelectOptions(): ReadonlyArray<{ value: string; label: string }> {
  return DIVISION_OPTIONS.map((v) => ({ value: String(v), label: String(v) }))
}

/**
 * Q39 (C) — spec §7.3.1 / §11.7 v2.16.25 (RULED by Chris 2026-09-07; migration
 * 118): a total-points league has NO playoff bracket — the season-long points
 * race IS its playoff. The Playoff-teams select is DISABLED under
 * `schedule_mode = 'total_points'` and its hint says why; switching the
 * schedule to total-points writes `playoff_teams: 0` in the SAME patch so the
 * form never holds a value the validator (and the DB) refuse.
 */
export const PLAYOFF_TEAMS_TOTAL_POINTS_HINT =
  'Total-points leagues have no bracket — the season-long points race is the playoff.'
export const PLAYOFF_TEAMS_DEFAULT_HINT = '0 = points-only champion.'

export function playoffTeamsControl(scheduleMode: LeagueSettings['schedule_mode']): { disabled: boolean; hint: string } {
  return scheduleMode === 'total_points'
    ? { disabled: true, hint: PLAYOFF_TEAMS_TOTAL_POINTS_HINT }
    : { disabled: false, hint: PLAYOFF_TEAMS_DEFAULT_HINT }
}

/** The settings patch for a schedule-mode change — total-points carries `playoff_teams: 0` with it. */
export function scheduleModePatch(mode: LeagueSettings['schedule_mode']): Partial<LeagueSettings> {
  return mode === 'total_points' ? { schedule_mode: mode, playoff_teams: 0 } : { schedule_mode: mode }
}

// ---------------------------------------------------------------------------
// IN-SEASON EDITING — a face of COMMISSIONER OVERRIDE MODE (M6A L.E1.13 item
// 3; spec §15.4:1701 → `commish_change_setting`, migration 129; PROGRESS §3
// STANDING RULE (h); D347 / D360; Q64; Q66).
//
// Past `scheduled` the ordinary PATCH is refused (§7.1); the commissioner's
// route is 129's verb — ONE KEY PER CALL, each its own receipt and post. The
// panel keeps its one working draft and its one Save; this file turns the
// draft into the per-key calls, and turns 129's per-key POLICY TABLE
// (`commish_setting_policy`, read not mirrored — D360(10)) into which
// controls are open and what a closed one says. There is no reason anywhere
// (Q66) and no panel-local "override" toggle (rule (h)) — the switch is
// `OverrideModeBar`, the one the team and matchup pages mount.
// ---------------------------------------------------------------------------

export type { SettingPolicies, SettingPolicy }

/** `leagues.scoring_system_id` — a setting to 129, a sibling of the settings
 *  document to the panel. */
export const SCORING_SYSTEM_KEY = 'scoring_system_id'

/** The keys the in-season panel needs a policy for: the settings document's
 *  own top-level keys + the scoring reference. */
export function settingPolicyKeys(settings: LeagueSettings): string[] {
  return [...Object.keys(settings), SCORING_SYSTEM_KEY].sort()
}

/** 129 refuses the BRACKET class once the bracket has been seeded. */
const BRACKET_SEEDED_STATUSES: ReadonlySet<string> = new Set(['playoffs', 'complete'])

/**
 * Why a key cannot be changed in-season — 129's OWN copy, VERBATIM (item 3:
 * *"renders the refusal copy verbatim for keys marked refused-in-season"*) —
 * or null when it can. `refused` is refused always; `bracket` only once the
 * league's status says the bracket exists (D360(5)); a key with no policy
 * row is NOT pre-judged here.
 */
export function inSeasonRefusal(policy: SettingPolicy | null | undefined, leagueStatus: string): string | null {
  if (!policy) return null
  if (policy.class === 'refused') return policy.refused_why ?? 'This setting cannot be changed in-season.'
  if (policy.class === 'bracket' && BRACKET_SEEDED_STATUSES.has(leagueStatus)) {
    return policy.refused_why ?? 'This setting cannot be changed once the playoffs have started.'
  }
  return null
}

export interface InSeasonChange {
  key: string
  value: Json
}

export interface InSeasonChangePlan {
  /** One `commish_change_setting` call each, in key order. */
  send: InSeasonChange[]
  /** Changed in the draft but refused in-season — NEVER sent; shown with
   *  129's copy. Reachable only through a dependent re-clamp or a control
   *  this file's callers failed to close; listed rather than dropped. */
  refused: Array<{ key: string; why: string }>
}

/**
 * The working draft → the per-key calls. A key is "changed" when its JSON
 * differs from the persisted baseline (the same compare the panel's `dirty`
 * uses). Whether a change is a NO-OP across JSON types is 129's call, not
 * this file's (D360(4)) — it answers `no_changes` by name.
 */
export function inSeasonChangePlan(args: {
  baseline: LeagueSettings
  working: LeagueSettings
  baselineScoringId: string | null
  scoringId: string | null
  policies: SettingPolicies
  leagueStatus: string
}): InSeasonChangePlan {
  const plan: InSeasonChangePlan = { send: [], refused: [] }
  const consider = (key: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    const why = inSeasonRefusal(args.policies[key], args.leagueStatus)
    if (why !== null) plan.refused.push({ key, why })
    else plan.send.push({ key, value: after as Json })
  }
  const baseline = args.baseline as unknown as Record<string, unknown>
  const working = args.working as unknown as Record<string, unknown>
  for (const key of Object.keys(working).sort()) consider(key, baseline[key], working[key])
  if (args.scoringId !== null) consider(SCORING_SYSTEM_KEY, args.baselineScoringId, args.scoringId)
  return plan
}

export const SETTINGS_OVERRIDE_BAR_OFF_COPY =
  'Commissioner — settings lock once the draft starts. Override mode lets you change the ones that can still change mid-season. It stays on until you turn it off, and every change is recorded.'
export const SETTINGS_OVERRIDE_BAR_ON_COPY =
  'You can change settings below. Each setting you change is saved as its own recorded change — who changed what, when — and posted to the league. Settings that can’t change mid-season say why. Exit when you’re done.'
export const SETTINGS_POLICY_PROBLEM_COPY =
  'Couldn’t read which settings can change mid-season, so editing stays closed — this is a failed read, not a locked league.'
export const SETTINGS_POLICY_LOADING_COPY = 'Reading which settings can change mid-season…'
export const RESCORE_TOGGLE_LABEL = 'Re-score this season’s open weeks under the new scoring'
export const RESCORE_TOGGLE_HINT =
  'Off: weeks already scored keep their points. On: open weeks are re-scored — and if any week is already final the whole change is refused, because a final week can’t be re-scored yet.'

// ---------------------------------------------------------------------------
// The consequence copy — §4 rule 15 / R971: never a bare "Saved."
// ---------------------------------------------------------------------------

export type SettingOutcomeBranch =
  | 'no_changes'
  | 'rescore_not_performed'
  | 'score_stale'
  | 'lineups_not_refit'
  | 'faab_not_reseeded'
  | 'saved'

export interface SettingOutcome {
  branch: SettingOutcomeBranch
  tone: 'positive' | 'caution' | 'neutral'
  text: string
}

interface ConsequencesShape {
  score_stale?: unknown
  score_stale_reason?: unknown
  lineups_not_refit?: unknown
  faab_seats_off_budget?: unknown
}

type SettingOutcomeFields = Pick<CommishChangeSettingResult, 'key' | 'no_changes' | 'no_changes_why' | 'rescore_not_performed_why' | 'consequences'>

const label = (key: string) => key.replace(/_/g, ' ')

/**
 * Which sentence a 129 document earns. ORDER IS THE CONTRACT:
 *  1. `no_changes` never says "saved" — nothing was written, no receipt.
 *  2. `rescore_not_performed_why` is rendered FIRST among the success arms,
 *     in 129's own words, NEVER swallowed (the task's PROOF line; D360(10)):
 *     a scoring change that did not re-score is the consequence a
 *     commissioner most needs and least expects.
 *  3. then a MIXED open week (`score_stale`), un-refit lineups (a MEASURED
 *     count), and balances a budget change did not touch (D360(6));
 *  4. then the plain save.
 */
export function settingOutcome(result: SettingOutcomeFields): SettingOutcome {
  const name = label(result.key)
  if (result.no_changes) {
    const why = result.rescore_not_performed_why ?? result.no_changes_why
    return { branch: 'no_changes', tone: 'neutral', text: `${name}: nothing changed, so nothing was recorded and nothing was posted${why ? ` — ${why}` : ''}.` }
  }
  if (result.rescore_not_performed_why) {
    return { branch: 'rescore_not_performed', tone: 'caution', text: `${name}: saved — but scores were NOT re-scored: ${result.rescore_not_performed_why}.` }
  }
  const c = (result.consequences ?? {}) as ConsequencesShape
  if (c.score_stale === true) {
    return { branch: 'score_stale', tone: 'caution', text: `${name}: saved — but an open week now mixes points scored under the old and new rules${typeof c.score_stale_reason === 'string' ? ` (${c.score_stale_reason})` : ''}.` }
  }
  if (typeof c.lineups_not_refit === 'number' && c.lineups_not_refit > 0) {
    return { branch: 'lineups_not_refit', tone: 'caution', text: `${name}: saved — ${c.lineups_not_refit} lineup${c.lineups_not_refit === 1 ? '' : 's'} already set for open weeks ${c.lineups_not_refit === 1 ? 'was' : 'were'} NOT re-fit to the new shape; each is re-fit the next time it is set.` }
  }
  if (typeof c.faab_seats_off_budget === 'number' && c.faab_seats_off_budget > 0) {
    return { branch: 'faab_not_reseeded', tone: 'caution', text: `${name}: saved — team balances were NOT changed; ${c.faab_seats_off_budget} team${c.faab_seats_off_budget === 1 ? '’s balance differs' : 's’ balances differ'} from the new budget.` }
  }
  return { branch: 'saved', tone: 'positive', text: `${name}: saved — recorded and posted to the league.` }
}

/** One key's result in the panel's list: 129's document, or its refusal. */
export type SettingSaveResult =
  | { key: string; ok: true; outcome: SettingOutcome; bypassed: readonly string[] }
  | { key: string; ok: false; refusal: string }
