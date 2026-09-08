/**
 * Pure helpers for `use-matchups.ts` (M4 task L.D4.1; spec §11.4/§9.3;
 * PROGRESS D296/D298) — the `-ops` split (`use-league-channel-ops.ts`,
 * `use-draft-ops.ts`): everything decidable without a socket lives here so
 * it is node-testable, and the hook keeps only React Query + the spine.
 *
 * THE REDUCER. A `league:<id>` broadcast is a HINT, never authority (§9.3):
 * the matchups hook never patches its cache from a payload — D296's payloads
 * are column-selected (`matchups` UPDATE ships id/week/scores/status, never
 * per-player lines) and cannot reconstruct a week — so the only decision the
 * hook makes per event is REFETCH or IGNORE. `matchupsEventEffect` is that
 * decision, and it has exactly three arms:
 *
 *   1. an event the matchups surface does not listen to — a roster move, a
 *      chat post, a name change, or a name this build has never seen — is
 *      IGNORED. Unknown events are inert (the M2 forward-compat pattern): a
 *      trigger added to this topic after this client shipped cannot make it
 *      refetch, error or misbehave;
 *   2. a listened-to event whose record names ANOTHER week is IGNORED — the
 *      week-N view does not refetch because week N+1's scores ticked (the
 *      score worker runs a batch per league per drain, §22.2, and a league
 *      page may hold last week's final view open beside this week's live
 *      one);
 *   3. a listened-to event that names THIS week — or that carries no week at
 *      all — REFETCHES. The no-week arm is deliberately conservative: a
 *      payload shape this build cannot read is treated as "something about
 *      this league's weeks changed", and the cost of a spare refetch is far
 *      below the cost of a stale score. (`league_weeks` UPDATE and
 *      `team_week_results` rows both carry `week`; `matchups` UPDATE does
 *      too — D296. A future column-selection that dropped it would land
 *      here, loudly, as a refetch, never as silence.)
 *
 * The week comparison is NUMERIC on purpose (`Number(record.week)`): 070's
 * envelope renders integers as JSON numbers, but a stringly-rendered week
 * must still match its own view rather than fall through to a refetch.
 */
import {
  invalidatingHandlers,
  matchupsEventInvalidates,
  type LeagueBroadcastEnvelope,
  type LeagueChannelEvent,
} from './use-league-channel-ops'

export type MatchupsEventEffect = 'refetch' | 'ignore'

/**
 * The query keys ONE week's refetch names (L.D5.2): the week's matchups
 * (`use-matchups.ts`) AND every box score of the week (`use-box-score.ts`)
 * — §11.4's sentence, "the matchup view refetches box-score lines on
 * `scores_updated`", as a list the hook iterates rather than a second
 * handler map. Pure so the pairing is pinned in node: drop the box key here
 * and a driven batch really does stop refreshing the starters' lines while
 * the team score still moves.
 */
export function matchupsInvalidationKeys(leagueId: string, week: number): ReadonlyArray<readonly unknown[]> {
  return [
    ['league-matchups', leagueId, week],
    ['league-box', leagueId, week],
  ]
}

/** The week named by a broadcast record, or `null` when it names none (or
 *  names something that is not a week). */
export function eventWeek(envelope: LeagueBroadcastEnvelope | null | undefined): number | null {
  const raw = envelope?.record?.week
  if (raw === null || raw === undefined) return null
  const week = Number(raw)
  return Number.isInteger(week) ? week : null
}

export function matchupsEventEffect(
  event: string,
  envelope: LeagueBroadcastEnvelope | null | undefined,
  week: number,
): MatchupsEventEffect {
  if (!matchupsEventInvalidates(event)) return 'ignore'
  const named = eventWeek(envelope)
  if (named !== null && named !== week) return 'ignore'
  return 'refetch'
}

/**
 * The handler map `use-matchups.ts` hands to `useLeagueChannel`: every event
 * `matchupsEventInvalidates` admits, each routed through the reducer with
 * the view's week, calling `invalidate` only on a `refetch`. Derived, not
 * hand-listed (R773) — remove `matchups` from
 * `MATCHUPS_INVALIDATING_EVENTS` and the score tick really does stop
 * refetching (the DoD's probe).
 */
export function matchupsHandlers(
  week: number,
  invalidate: () => void,
): Partial<Record<LeagueChannelEvent, (payload: LeagueBroadcastEnvelope) => void>> {
  const handlers: Partial<Record<LeagueChannelEvent, (payload: LeagueBroadcastEnvelope) => void>> = {}
  for (const event of Object.keys(invalidatingHandlers(matchupsEventInvalidates, invalidate)) as LeagueChannelEvent[]) {
    handlers[event] = (payload) => {
      if (matchupsEventEffect(event, payload, week) === 'refetch') invalidate()
    }
  }
  return handlers
}
