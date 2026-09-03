/**
 * SQLSTATE → HTTP mapping for the IN-SEASON route family (M4 task L.D4.2;
 * L.D4.1 composes onto the same helper).
 *
 * The family's mapping is written down in TWO ledger rows, independently, by
 * two different Builders — PROGRESS **F224(e)** (L.D1.4's lineup-route
 * contract) and **F227(f)** (L.D1.5's transactions-route contract) — in the
 * same words:
 *
 *     42501 → 403 · P0001 → 409 · 22023 → 400 · P0002 → 404
 *
 * **It differs from the members/draft families on ONE arm, deliberately, and
 * the difference is recorded rather than smoothed over (PROGRESS D310(2)).**
 * `members-service.ts:56` and `draft-service.ts:124` both map P0001 → 400,
 * and both ledger rows cite "the members-api precedent" while printing 409.
 * Read as a whole the two rows are a family contract, not a slip: the P0001
 * refusals 111/112/113 raise are *state* conflicts — this player is on
 * another roster, his game has kicked off, the roster is full, the week is
 * live, the league is not `in_season` — none of which is a defect in the
 * submitted request. A 400 tells a client "you sent something malformed" for
 * a request that was perfectly well formed and simply lost a race. 22023
 * (genuinely a malformed argument) keeps 400, which is what makes the split
 * carry information.
 *
 * The MESSAGE is UX copy either way and is passed through verbatim (the 063
 * convention; `client-fetch.ts:userFacingMessage` strips the raiser's
 * `<fn>: ` prefix and the trailing `(§x.y)` at the one surfacing layer).
 * F227(f) is explicit that the text must survive: the E32 message names the
 * kickoff, the datum arm and when the week clears; the waiver message names
 * `waivers_until`; the cap message names used/cap/week. Nothing here
 * re-words a refusal into a generic failure.
 *
 * No Date/random read here (the `src/lib/leagues/**` ESLint fences) — pure
 * error plumbing.
 */
import type { ServiceResult } from './leagues-service'

/** The SQLSTATEs 111/112/113 actually raise (measured 2026-09-03 over the
 *  migration text: 113 raises P0001/42501/22023 only; 111 adds P0002). */
export interface RpcErrorLike {
  code?: string
  message: string
}

/**
 * @param forbiddenMessage copy for the 42501 arm — the RPCs raise ONE no-leak
 *   42501 for "nonexistent league / not a member / not this team's manager /
 *   not the commissioner", so the string must not distinguish those cases.
 */
export function mapInSeasonRpcError(
  error: RpcErrorLike,
  forbiddenMessage: string,
): ServiceResult {
  if (error.code === '42501') {
    return { status: 403, body: { error: forbiddenMessage } }
  }
  // BEFORE the P0001 arm (R87's ordering rule): a missing/soft-deleted league
  // — or, for the matchup verbs, a matchup that is not this league's — is not
  // a conflict about league state.
  if (error.code === 'P0002') {
    return { status: 404, body: { error: error.message } }
  }
  // The family arm. Every P0001 these RPCs raise is a refusal ABOUT THE
  // LEAGUE'S CURRENT STATE, and the message is the UX copy.
  if (error.code === 'P0001') {
    return { status: 409, body: { error: error.message } }
  }
  // Argument shape (a null action_id, add === drop, a seed outside the space)
  // — a genuine 400, and the one arm that keeps its house value.
  if (error.code === '22023') {
    return { status: 400, body: { error: error.message } }
  }
  return { status: 500, body: { error: error.message } }
}
