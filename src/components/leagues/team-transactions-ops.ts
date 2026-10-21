import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'

import type { FeedLine } from './activity-feed-ops'

/**
 * My Team's Transactions feed (Chris 2026-10-04: "Waivers should be a panel
 * on My Team page, not Players" — then: call it Transactions, ONE feed, the
 * team's pending waiver claims, adds and drops mixed together, newest first).
 * Pure: the merge and the copy, pinned in `team-transactions-ops.test.ts`.
 */

export const TRANSACTIONS_TITLE = 'Transactions'
export const TRANSACTIONS_EMPTY_COPY = 'No transactions yet. Add or claim a player on the Players page.'
export const TRANSACTIONS_ERROR_TITLE = 'Couldn’t load your transactions.'
export const PENDING_CLAIM_LABEL = 'Pending claim'
export const CLAIM_ORDER_LABEL = 'Claim order'
export const CLAIM_ORDER_CLOSE_LABEL = 'Done'
export const SEE_ALL_ADDS_LABEL = 'See all adds and drops'
/** How many completed moves the panel reads (the newest page). */
export const TRANSACTIONS_MOVES_LIMIT = 10

export type TransactionEntry =
  | { kind: 'claim'; id: string; at: string | null; claim: WaiverClaimView }
  | { kind: 'move'; id: string; at: string | null; line: FeedLine }

/** One list, newest at the top. PENDING claims join at the time they were
 *  made; LOST and INVALID ones (Chris 2026-10-05) at the time the run settled
 *  them. A claim that WON is already a move (a `waiver_claim` transaction) and
 *  a cancelled one was the manager's own doing — neither joins. An entry with
 *  no instant sorts last; equal instants keep a stable order (claims first). */
export function mergeTransactions(claims: readonly WaiverClaimView[], lines: readonly FeedLine[]): TransactionEntry[] {
  const entries: TransactionEntry[] = [
    ...claims
      .filter((c) => c.status === 'pending' || c.status === 'lost' || c.status === 'invalid')
      .map((claim): TransactionEntry => ({
        kind: 'claim',
        id: `claim:${claim.id}`,
        at: claim.status === 'pending' ? claim.created_at : (claim.processed_at ?? claim.created_at),
        claim,
      })),
    ...lines
      .filter((l) => l.kind === 'transaction')
      .map((line): TransactionEntry => ({ kind: 'move', id: `move:${line.id}`, at: line.createdAt, line })),
  ]
  return entries
    .map((entry, index) => ({ entry, index, t: entry.at ? Date.parse(entry.at) : Number.NEGATIVE_INFINITY }))
    .sort((a, b) => (b.t === a.t ? a.index - b.index : b.t - a.t))
    .map(({ entry }) => entry)
}

/** How many claims are still waiting — the Claim order door shows at 2+. */
export function pendingClaimCount(claims: readonly WaiverClaimView[]): number {
  return claims.filter((c) => c.status === 'pending').length
}

/** D495 (Chris 2026-10-05): a LOST claim names who won the player and why
 *  yours failed — "Team X won Puka Nacua ($14). Your $9 claim was outbid." /
 *  "Team X won Puka Nacua. Your claim was out-prioritized." The panel renders
 *  the team as a TeamNameLink and the player as a PlayerLink around these
 *  strings. Null when the read carried no winner (an older server, or the
 *  winning move wasn't found) — the panel then keeps `claimOutcome`'s line. */
export interface LostClaimWinner {
  winnerTeamId: string
  winnerTeamName: string
  /** After the player's name: " ($14)." or ".". */
  priceSuffix: string
  /** "Your $9 claim was outbid." / "Your claim was out-prioritized." */
  reason: string
}

export function lostClaimWinner(
  claim: Pick<WaiverClaimView, 'status' | 'faab_bid' | 'result_reason' | 'winner_team_id' | 'winner_team_name' | 'winning_bid'>,
  waiverType: string | null,
): LostClaimWinner | null {
  if (claim.status !== 'lost' || !claim.winner_team_id || !claim.winner_team_name) return null
  const faab = waiverType === 'faab'
  const bid = claim.winning_bid
  return {
    winnerTeamId: claim.winner_team_id,
    winnerTeamName: claim.winner_team_name,
    priceSuffix: faab && typeof bid === 'number' ? ` ($${bid}).` : '.',
    reason: faab && claim.result_reason !== 'lost_on_priority' ? `Your $${claim.faab_bid} claim was outbid.` : 'Your claim was out-prioritized.',
  }
}
