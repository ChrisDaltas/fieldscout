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
