/**
 * matchup-override-ops.ts — the PURE half of the commissioner's matchup
 * override panel (M6A task L.E1.12; spec §15.4:1692-1693, §10.3; PROGRESS §3
 * STANDING RULE (h), D342, Q61, Q66; tasks-M6A §4 rule 15 / R971).
 *
 * Nothing here computes a score, a result or a standing — every word below is
 * a rendering of a field 126's result document already carries
 * (`commish-matchup-service.ts` → `CommishMatchupOverrideResult`). The panel
 * (`matchup-override-panel.tsx`) owns the hooks; this owns the words and the
 * two decisions that must be pinnable without a browser: which consequence
 * sentence a result document earns, and why Save is disabled when it is.
 *
 * THERE IS NO REASON ANYWHERE IN THIS FILE, ON PURPOSE (Q66, spec v2.16.41;
 * F343): the commissioner is never prompted, the request carries none, and
 * since migration 131 the verb stores NULL and still writes the receipt.
 */
import type { CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'

export const OVERRIDE_BAR_OFF_COPY =
  'Commissioner — override mode lets you correct this matchup: set both scores, or declare a winner. It stays on until you turn it off, and every change is recorded.'
export const OVERRIDE_BAR_ON_COPY =
  'You can correct this matchup below. Every change is recorded — who changed what, when — and posted to the league. Exit when you’re done.'

export const OVERRIDE_PANEL_TITLE = 'Correct this matchup'
/** D342: `is_overridden` is ONE flag on the whole row, so a score correction
 *  always restates BOTH sides — said on the panel, not discovered. */
export const BOTH_SCORES_COPY =
  'Both scores are saved together — correcting one side restates the other as written here.'
export const DECLARE_WINNER_COPY =
  'Or leave the numbers alone and declare the winner. For a tie, save equal scores instead.'
/**
 * A BYE row (no away side). 126 refuses BOTH arms through today's routes: the
 * result arm by design (`131:1052-1057` — a bye has no winner), and the score
 * arm because the verb wants `p_away` NULL (`131:1058-1062`) while the
 * `/commish/score` schema requires a number — PROGRESS F366, the route's to
 * fix. Until then the panel says so by name instead of offering a Save that
 * can only be refused.
 */
export const BYE_ROW_COPY =
  'This is a bye — there is no opponent, so there is no winner to declare, and correcting a bye’s score isn’t available from this screen yet.'

// ---------------------------------------------------------------------------
// The consequence copy — §4 rule 15: never a bare "Saved."
// ---------------------------------------------------------------------------

export type OverrideOutcomeBranch =
  | 'no_changes'
  | 'will_be_overwritten'
  | 'live_scoring_stopped'
  | 'standings_rebuilt'
  | 'standings_at_finalization'

export interface OverrideOutcome {
  branch: OverrideOutcomeBranch
  tone: 'positive' | 'caution' | 'neutral'
  text: string
}

export const NO_CHANGES_COPY =
  'Nothing changed — this matchup already had that score and result, so nothing was recorded and nothing was posted.'
export const WILL_BE_OVERWRITTEN_COPY =
  'Saved — but it will NOT hold: live scoring is still running for this matchup and will overwrite this number on its next update.'
export const LIVE_SCORING_STOPPED_COPY =
  'Saved, and live scoring for this matchup has stopped for the rest of the week — these numbers stand as written. Standings will follow at finalization.'
export const STANDINGS_REBUILT_COPY = 'Saved, standings rebuilt — this week was already final, so the table reflects it now.'
export const STANDINGS_AT_FINALIZATION_COPY = 'Saved, standings will follow at finalization.'

type OutcomeFields = Pick<
  CommishMatchupOverrideResult,
  'no_changes' | 'live_scoring_frozen' | 'live_scoring_frozen_why' | 'standings_rebuilt'
>

/**
 * Which sentence a result document earns. ORDER IS THE CONTRACT:
 *
 *  1. `no_changes` is its own state and must NOT say "saved" — nothing was
 *     written, no receipt, no post (Chris's one condition; §3(b)).
 *  2. THE CONSEQUENCE ARMS COME FIRST among the "it saved" branches (R971 /
 *     §4 rule 15). `will_be_overwritten` is 126's `not_frozen` state — the
 *     write landed and will not survive the next drain; it is unreachable
 *     under the shipped flag (126:533-536) and rendered anyway, because a
 *     client that says "Saved" over it is the defect the rule names.
 *  3. `live_scoring_stopped` is Q61's freeze: the number stands because live
 *     scoring now skips the row — said out loud, since it is a consequence
 *     the commissioner did not ask for by name.
 *  4. Then the standings: rebuilt in-body for a FINAL week (D344), or carried
 *     at finalization for an open one.
 */
export function overrideOutcome(result: OutcomeFields): OverrideOutcome {
  if (result.no_changes) return { branch: 'no_changes', tone: 'neutral', text: NO_CHANGES_COPY }
  if (!result.live_scoring_frozen && (result.live_scoring_frozen_why ?? '').startsWith('not_frozen')) {
    return { branch: 'will_be_overwritten', tone: 'caution', text: WILL_BE_OVERWRITTEN_COPY }
  }
  if (result.live_scoring_frozen) {
    return { branch: 'live_scoring_stopped', tone: 'caution', text: LIVE_SCORING_STOPPED_COPY }
  }
  if (result.standings_rebuilt) return { branch: 'standings_rebuilt', tone: 'positive', text: STANDINGS_REBUILT_COPY }
  return { branch: 'standings_at_finalization', tone: 'positive', text: STANDINGS_AT_FINALIZATION_COPY }
}

/** `bypassed[]` rendered back — the rules the override walked past, by the
 *  verb's own names. Null when it walked past nothing. */
export function bypassedCopy(bypassed: readonly string[] | null | undefined): string | null {
  if (!bypassed || bypassed.length === 0) return null
  return `This correction walked past: ${bypassed.join(', ')}.`
}

// ---------------------------------------------------------------------------
// The score draft — what is typed, and why Save is (not) available
// ---------------------------------------------------------------------------

/** A fantasy score as typed: an optional sign, digits, up to two decimals
 *  (the stored NUMERIC's rendering). Anything else is null — never NaN, never
 *  a silently-coerced 0 (an empty field is NOT a zero). */
export function parseScoreDraft(text: string): number | null {
  const trimmed = text.trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** The stored number as the field's starting text; a pending (NULL) score
 *  starts EMPTY — an absent score is not 0 (E61's posture). */
export function scoreDraftOf(score: number | null): string {
  return score === null ? '' : String(score)
}

export type ScoreGate =
  | { ok: true; home: number; away: number }
  | { ok: false; why: string }

/**
 * Why Save is disabled, SAID (standing rule (h): *"a disabled control with no
 * stated precondition is the same class as an empty result read as
 * success"*). The only precondition is that the numbers are numbers. An
 * UNCHANGED pair is deliberately NOT gated here: whether a submit is a no-op
 * is the verb's to decide across every dimension it can change (the flag
 * included — §4 rule 12), and it answers `no_changes` by name.
 *
 * A bye row never reaches this gate — the panel renders `BYE_ROW_COPY`
 * instead of the form (F366).
 */
export function scoreGate(args: { homeDraft: string; awayDraft: string; homeName: string; awayName: string }): ScoreGate {
  const home = parseScoreDraft(args.homeDraft)
  if (home === null) return { ok: false, why: `Enter ${args.homeName}’s score as a number (up to two decimals) to save.` }
  const away = parseScoreDraft(args.awayDraft)
  if (away === null) return { ok: false, why: `Enter ${args.awayName}’s score as a number (up to two decimals) to save.` }
  return { ok: true, home, away }
}
