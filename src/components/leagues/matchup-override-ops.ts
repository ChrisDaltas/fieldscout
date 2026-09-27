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
import type { CommishMatchupEditLock, CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'

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
 * A BYE row (no away side). The result arm is refused by design
 * (`131:1052-1057` — a bye has no winner) and is not offered; the SCORE arm
 * is the team's points alone, sent with `away_score: null` (PROGRESS F366,
 * fixed by L.E1.16: the schema is nullable and the service sends
 * `p_away: null`, which is what `131:1058-1062` asks for). This line sits
 * where the declare-a-winner arm would be.
 */
export const BYE_ROW_COPY = 'This is a bye — there is no opponent and no winner to declare. Only the team’s score can be corrected.'

// ---------------------------------------------------------------------------
// The consequence copy — §4 rule 15: never a bare "Saved."
// ---------------------------------------------------------------------------

export type OverrideOutcomeBranch =
  | 'no_changes'
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
 *  2. THE CONSEQUENCE ARM COMES FIRST among the "it saved" branches (R971 /
 *     §4 rule 15). (A `will_be_overwritten` arm for 126's `not_frozen` state
 *     was REMOVED by L.E1.18: Q61 is ruled — no edit lands while a starter
 *     is still playing — and the verb sets the flag as the literal TRUE, so
 *     that state cannot come back from the server; pgTAP 083 F8/F9 pin it.)
 *  3. `live_scoring_stopped` is the freeze: the number stands because live
 *     scoring now skips the row — said out loud, since it is a consequence
 *     the commissioner did not ask for by name.
 *  4. Then the standings: rebuilt in-body for a FINAL week (D344), or carried
 *     at finalization for an open one.
 */
export function overrideOutcome(result: OutcomeFields): OverrideOutcome {
  if (result.no_changes) return { branch: 'no_changes', tone: 'neutral', text: NO_CHANGES_COPY }
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
 *  (the stored NUMERIC's rendering) — INCLUDING the two shapes a person
 *  types on the way to a number, `.5` and `12.` (R1063: refusing them left
 *  Save disabled under copy that never mentioned a leading digit). Anything
 *  else is null — never NaN, never a silently-coerced 0 (an empty field, a
 *  bare `.` and a bare `-` are NOT a zero). */
export function parseScoreDraft(text: string): number | null {
  const trimmed = text.trim()
  if (!/^-?(\d+\.?\d{0,2}|\.\d{1,2})$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** The stored number as the field's starting text; a pending (NULL) score
 *  starts EMPTY — an absent score is not 0 (E61's posture). */
export function scoreDraftOf(score: number | null): string {
  return score === null ? '' : String(score)
}

/**
 * What a score field SHOWS (R1064). Until the commissioner types in it the
 * field FOLLOWS the stored score — so a live-scoring tick that lands while
 * override mode is open is what Save would restate, not the pair that was on
 * screen at mount. Once he has typed (`typed !== null`, the empty string
 * included — clearing a field is typing) his text is NEVER overwritten.
 */
export function shownScoreDraft(typed: string | null, stored: number | null): string {
  return typed ?? scoreDraftOf(stored)
}

export type ScoreGate =
  | { ok: true; home: number; away: number | null } // away null = a BYE row (F366)
  | { ok: false; why: string }

/**
 * Why Save is disabled, SAID (standing rule (h): *"a disabled control with no
 * stated precondition is the same class as an empty result read as
 * success"*). The only precondition is that the numbers are numbers. An
 * UNCHANGED pair is deliberately NOT gated here: whether a submit is a no-op
 * is the verb's to decide across every dimension it can change (the flag
 * included — §4 rule 12), and it answers `no_changes` by name.
 *
 * A BYE row (`awayName` null) is gated on the home number alone (F366).
 */
export function scoreGate(args: { homeDraft: string; awayDraft: string; homeName: string; awayName: string | null }): ScoreGate {
  const home = parseScoreDraft(args.homeDraft)
  if (home === null) return { ok: false, why: `Enter ${args.homeName}’s score as a number (up to two decimals) to save.` }
  // A BYE row (F366): there is no away side — the gate is the home number alone.
  if (args.awayName === null) return { ok: true, home, away: null }
  const away = parseScoreDraft(args.awayDraft)
  if (away === null) return { ok: false, why: `Enter ${args.awayName}’s score as a number (up to two decimals) to save.` }
  return { ok: true, home, away }
}

// ---------------------------------------------------------------------------
// Q61, AS RULED (L.E1.18, migration 135) — the controls wait for the games
// ---------------------------------------------------------------------------

/**
 * What the panel may offer, from the ONE server read (`commish_matchup_edit_lock`
 * — the same SQL helper the verbs refuse on). Nothing here decides whether a
 * game has finished: `locked` carries the server's own sentence, verbatim.
 *
 *  - `checking` — the read has not answered: no controls yet (offering them
 *    would be a guess).
 *  - `locked`   — a starter is still playing, a side has no lineup set
 *    (`lineup_not_set`, R1097), or a side's lineup holds no starter with a
 *    game (`no_starter_game`, Q67 — migration 142): no controls, the server's
 *    line verbatim —
 *    whichever reason the server gave, the panel renders its sentence.
 *  - `open`     — the controls.
 *  - `unknown`  — the read FAILED: the failure is said and NO controls are
 *    offered (R1098 — the panel offers no score or winner control until the
 *    server has said the matchup is editable; spec v2.16.43).
 */
export type OverrideLockState =
  | { kind: 'checking' }
  | { kind: 'locked'; message: string }
  | { kind: 'open' }
  | { kind: 'unknown'; message: string }

export const LOCK_CHECKING_COPY = 'Checking whether this matchup’s games have finished…'

export function overrideLockState(read: {
  data: Pick<CommishMatchupEditLock, 'editable' | 'message'> | undefined
  error: Error | null
}): OverrideLockState {
  if (read.data) {
    if (read.data.editable) return { kind: 'open' }
    return { kind: 'locked', message: read.data.message ?? 'This matchup can be corrected once every starter’s game has finished.' }
  }
  if (read.error) return { kind: 'unknown', message: `Couldn’t check this matchup’s games — ${read.error.message}` }
  return { kind: 'checking' }
}
