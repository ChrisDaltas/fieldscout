/**
 * Bid-feed doctrine — the PURE half of the auction bid feed (M3 task L.C1.6;
 * spec §9.2/§9.3, §12.5 (`voided_at` — v2.12.2/v2.12.4), §16.2's
 * auction-block feed; migration 088 banner items 2/3/6; D133/D134/D162;
 * PROGRESS F69).
 *
 * Colocated ops split (the use-draft-chat-ops.ts precedent): no client, no
 * React, no wall-clock read. Bid rows arrive two ways — the feed's own RLS
 * SELECT (live history: `voided_at IS NULL`) and the room channel's
 * `draft_bids` broadcast — and both meet here.
 *
 * THE WIRE CONTRACT (088, one event name, two operations — D109(1): event =
 * table name, the operation discriminates):
 *  - `operation: 'INSERT'`, record = ONE bid row — exactly
 *    {nomination_seq, player_id, team_id, amount, created_at, voided_at}
 *    (never action_id / ids). `voided_at` is always NULL on an INSERT (no
 *    writer stamps at insert) — carried so the record has one shape.
 *  - `operation: 'UPDATE'`, record = ONE void summary per void STATEMENT —
 *    {voided_at, voided_count, nominations: [{nomination_seq, player_id}…]}
 *    (the F69 decision: a void emits an event, per statement never per row;
 *    a reset's whole-run sweep is ONE event naming every live nomination).
 *
 * WHAT THE FEED HOLDS: LIVE rows only (`voided_at IS NULL`). A void STRIKES
 * the named nominations out of the cache rather than marking them — the
 * D97 system post carries the human-readable record of the cancel/undo/
 * reset, and a live-only feed is run-pure by construction (088 banner item
 * 3: no run key rides the wire; after a reset the sweep's event empties the
 * cache and the next join refetch reads the new run alone).
 *
 * IDENTITY: a bid row is identified on the wire by its full tuple (no `id`
 * is broadcast — D109(2)); (nomination_seq, player_id, team_id, amount,
 * created_at) is unique in practice (raises strictly increase within a
 * nomination; a D143 renomination at the same seq/player/amount differs by
 * created_at). A void names WHOLE nominations by (seq, player): at any
 * instant at most one nomination's rows are live at a given seq (the D162
 * invariant), so the pair names an unambiguous row set.
 */

// ---------------------------------------------------------------------------
// Row + broadcast shapes
// ---------------------------------------------------------------------------

/** The bid row slice the feed renders — identical to 088's INSERT payload. */
export interface DraftBidRow {
  nomination_seq: number
  player_id: string
  team_id: string
  amount: number
  created_at: string | null
  voided_at: string | null
}

/** One voided nomination as the void summary names it. */
export interface VoidedNomination {
  nomination_seq: number
  player_id: string
}

/** 088's per-statement VOID summary (operation 'UPDATE'). */
export interface DraftBidVoidRecord {
  voided_at: string | null
  voided_count: number
  nominations: VoidedNomination[]
}

/** One `draft_bids` broadcast off the room topic, as the hook hands it in. */
export interface DraftBidBroadcast {
  operation?: string
  record?: unknown
}

export interface BidFeedReduceResult {
  /** Next cached rows — the SAME reference when nothing was applied. */
  rows: readonly DraftBidRow[]
  /** True ⇒ the hook must refetch the feed (§9.3 doubt ⇒ refetch). */
  refetch: boolean
}

/** Shape guard for an INSERT record (the six broadcast keys, typed). */
export function isBidRecord(record: unknown): record is DraftBidRow {
  if (typeof record !== 'object' || record === null) return false
  const row = record as Partial<DraftBidRow>
  return (
    typeof row.nomination_seq === 'number' &&
    typeof row.player_id === 'string' &&
    typeof row.team_id === 'string' &&
    typeof row.amount === 'number'
  )
}

/** Shape guard for a VOID summary (operation 'UPDATE'). */
export function isBidVoidRecord(record: unknown): record is DraftBidVoidRecord {
  if (typeof record !== 'object' || record === null) return false
  const summary = record as Partial<DraftBidVoidRecord>
  return (
    typeof summary.voided_count === 'number' &&
    Array.isArray(summary.nominations) &&
    summary.nominations.every(
      (n) =>
        typeof n === 'object' &&
        n !== null &&
        typeof (n as VoidedNomination).nomination_seq === 'number' &&
        typeof (n as VoidedNomination).player_id === 'string',
    )
  )
}

// ---------------------------------------------------------------------------
// Ordering + identity
// ---------------------------------------------------------------------------

/** The feed's total order: nomination, then amount, then created_at — the
 *  same order the RLS read returns (`idx_draft_bids_nom` serves it). */
export function compareBidRows(a: DraftBidRow, b: DraftBidRow): number {
  if (a.nomination_seq !== b.nomination_seq) return a.nomination_seq - b.nomination_seq
  if (a.amount !== b.amount) return a.amount - b.amount
  return (a.created_at ?? '').localeCompare(b.created_at ?? '')
}

function sameBidRow(a: DraftBidRow, b: DraftBidRow): boolean {
  return (
    a.nomination_seq === b.nomination_seq &&
    a.player_id === b.player_id &&
    a.team_id === b.team_id &&
    a.amount === b.amount &&
    (a.created_at ?? null) === (b.created_at ?? null)
  )
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

function reduceBidInsert(rows: readonly DraftBidRow[], record: DraftBidRow): BidFeedReduceResult {
  // An INSERT never carries a stamp (088 banner item 1); one that does is a
  // shape this client does not understand ⇒ doubt.
  if (record.voided_at != null) return { rows, refetch: true }
  // Replay / own-echo of a row we already hold ⇒ inert.
  if (rows.some((r) => sameBidRow(r, record))) return { rows, refetch: false }
  const next = [...rows, normalizeBidRow(record)].sort(compareBidRows)
  return { rows: next, refetch: false }
}

function normalizeBidRow(record: DraftBidRow): DraftBidRow {
  // Copy NAMED fields only — additive wire keys never leak into the cache
  // (the same posture the room reducer takes; 088 banner item 6).
  return {
    nomination_seq: record.nomination_seq,
    player_id: record.player_id,
    team_id: record.team_id,
    amount: record.amount,
    created_at: record.created_at ?? null,
    voided_at: null,
  }
}

function reduceBidVoid(
  rows: readonly DraftBidRow[],
  summary: DraftBidVoidRecord,
): BidFeedReduceResult {
  // Strike every row of every named nomination. Rows we never held (a client
  // that joined after those bids) are simply not there — no doubt: the void
  // means they are gone regardless, and the next join refetch reconciles.
  const struck = new Set(summary.nominations.map((n) => `${n.nomination_seq}|${n.player_id}`))
  if (struck.size === 0) return { rows, refetch: false }
  const next = rows.filter((r) => !struck.has(`${r.nomination_seq}|${r.player_id}`))
  if (next.length === rows.length) return { rows, refetch: false }
  return { rows: next, refetch: false }
}

/**
 * Apply one `draft_bids` broadcast to the cached live-bid rows. Pure; the
 * hook writes the returned rows into the React Query cache and refetches
 * when told to.
 */
export function reduceBidEvent(
  rows: readonly DraftBidRow[],
  broadcast: DraftBidBroadcast,
): BidFeedReduceResult {
  if (broadcast.operation === 'INSERT') {
    if (!isBidRecord(broadcast.record)) return { rows, refetch: true }
    return reduceBidInsert(rows, broadcast.record)
  }
  if (broadcast.operation === 'UPDATE') {
    if (!isBidVoidRecord(broadcast.record)) return { rows, refetch: true }
    return reduceBidVoid(rows, broadcast.record)
  }
  // An operation we don't recognize on our own table ⇒ doubt (§9.3).
  return { rows, refetch: true }
}

/** The live rows of one nomination, highest bid first — what the auction
 *  block renders as the current nomination's bid list. */
export function bidsForNomination(
  rows: readonly DraftBidRow[],
  nominationSeq: number,
  playerId: string,
): DraftBidRow[] {
  return rows
    .filter((r) => r.nomination_seq === nominationSeq && r.player_id === playerId)
    .sort((a, b) => b.amount - a.amount || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}
