/**
 * Doctrine pins for the auction bid-feed reducer (M3 task L.C1.6; migration
 * 088's wire contract — INSERT = one bid row, UPDATE = one per-statement
 * VOID summary (the F69 decision); spec §9.3 cache-hint semantics; D162's
 * whole-nomination voids). Golden values are stored literals (§4.3). The
 * SQL half of the same contract is pgTAP 037 (exact key sets + real-verb
 * event goldens) and the wire half is auction-realtime-db.test.ts.
 */

import { describe, expect, it } from 'vitest'

import {
  bidsForNomination,
  compareBidRows,
  isBidRecord,
  isBidVoidRecord,
  reduceBidEvent,
  type DraftBidRow,
} from './use-draft-bids-ops'

const T = (n: number) => `00000000-0000-4000-8000-00000000t${n}`

function bid(seq: number, player: string, team: number, amount: number, at: string): DraftBidRow {
  return {
    nomination_seq: seq,
    player_id: player,
    team_id: T(team),
    amount,
    created_at: at,
    voided_at: null,
  }
}

/** A live feed: seq 1 awarded (t1 $5 → t2 $7 → t1 $9), seq 2 live (t2 $3). */
function feed(): readonly DraftBidRow[] {
  return [
    bid(1, 'pl-a', 1, 5, '2026-08-19T12:00:01.000Z'),
    bid(1, 'pl-a', 2, 7, '2026-08-19T12:00:02.000Z'),
    bid(1, 'pl-a', 1, 9, '2026-08-19T12:00:03.000Z'),
    bid(2, 'pl-b', 2, 3, '2026-08-19T12:01:00.000Z'),
  ]
}

describe('reduceBidEvent · INSERT (one bid row per event — 088 item 2)', () => {
  it('appends a raise, kept sorted by (nomination_seq, amount, created_at)', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'INSERT',
      record: bid(2, 'pl-b', 3, 4, '2026-08-19T12:01:05.000Z'),
    })
    expect(result.refetch).toBe(false)
    expect(result.rows).toHaveLength(5)
    expect(result.rows.map((r) => `${r.nomination_seq}:${r.amount}`)).toEqual(['1:5', '1:7', '1:9', '2:3', '2:4'])
  })

  it('a replay / own-echo of a row already held is inert (same reference)', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'INSERT',
      record: bid(1, 'pl-a', 2, 7, '2026-08-19T12:00:02.000Z'),
    })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(false)
  })

  it('the D143 tie: a renomination at the SAME seq/player/team/amount is a NEW row — created_at separates it (the D162 case, on the client)', () => {
    // After a cancel struck seq 2, the same nominator renominates pl-b at $3.
    const rows = feed().filter((r) => r.nomination_seq !== 2)
    const result = reduceBidEvent(rows, {
      operation: 'INSERT',
      record: bid(2, 'pl-b', 2, 3, '2026-08-19T12:02:00.000Z'),
    })
    expect(result.rows).toHaveLength(4)
    expect(result.rows[3]?.created_at).toBe('2026-08-19T12:02:00.000Z')
  })

  it('additive unknown wire keys never leak into the cached row (named-field copy)', () => {
    const result = reduceBidEvent([], {
      operation: 'INSERT',
      record: { ...bid(1, 'pl-a', 1, 5, '2026-08-19T12:00:01.000Z'), action_id: 'leak', extra: 1 },
    })
    expect(result.rows[0]).toEqual(bid(1, 'pl-a', 1, 5, '2026-08-19T12:00:01.000Z'))
    expect(result.rows[0]).not.toHaveProperty('action_id')
  })

  it('an INSERT carrying a non-null voided_at is a shape this client does not know ⇒ doubt ⇒ refetch, nothing applied', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'INSERT',
      record: { ...bid(3, 'pl-c', 1, 1, '2026-08-19T12:03:00.000Z'), voided_at: '2026-08-19T12:03:01.000Z' },
    })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(true)
  })

  it('a malformed INSERT record is doubt ⇒ refetch', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, { operation: 'INSERT', record: { amount: 12 } })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(true)
  })
})

describe('reduceBidEvent · UPDATE (the per-statement VOID summary — F69 / 088 item 2)', () => {
  it('a cancel strikes every row of the named nomination and nothing else', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'UPDATE',
      record: { voided_at: '2026-08-19T12:05:00.000Z', voided_count: 1, nominations: [{ nomination_seq: 2, player_id: 'pl-b' }] },
    })
    expect(result.refetch).toBe(false)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((r) => r.nomination_seq === 1)).toBe(true)
  })

  it('the BULK case (a reset\'s whole-run sweep — one event naming every live nomination) empties the feed in one step', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'UPDATE',
      record: {
        voided_at: '2026-08-19T12:05:00.000Z',
        voided_count: 4,
        nominations: [
          { nomination_seq: 1, player_id: 'pl-a' },
          { nomination_seq: 2, player_id: 'pl-b' },
        ],
      },
    })
    expect(result.rows).toEqual([])
    expect(result.refetch).toBe(false)
  })

  it('a void names (seq, player) — a DIFFERENT player at the same seq is left alone (the D162 identity)', () => {
    // A feed that (after an earlier void + renomination) holds seq 2 for pl-c.
    const rows = [...feed().filter((r) => r.nomination_seq !== 2), bid(2, 'pl-c', 2, 3, '2026-08-19T12:02:00.000Z')]
    const result = reduceBidEvent(rows, {
      operation: 'UPDATE',
      record: { voided_at: '2026-08-19T12:05:00.000Z', voided_count: 1, nominations: [{ nomination_seq: 2, player_id: 'pl-b' }] },
    })
    expect(result.rows).toBe(rows)
  })

  it('a void naming nominations we never held is inert (same reference, no refetch — the rows are gone regardless; the join refetch reconciles)', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, {
      operation: 'UPDATE',
      record: { voided_at: '2026-08-19T12:05:00.000Z', voided_count: 3, nominations: [{ nomination_seq: 9, player_id: 'pl-z' }] },
    })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(false)
  })

  it('a malformed void summary is doubt ⇒ refetch (we may be holding struck rows)', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, { operation: 'UPDATE', record: { voided_at: 'x', nominations: 'nope' } })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(true)
  })
})

describe('reduceBidEvent · unknown operation', () => {
  it('an operation we do not recognize on our own table is doubt ⇒ refetch', () => {
    const rows = feed()
    const result = reduceBidEvent(rows, { operation: 'DELETE', record: {} })
    expect(result.rows).toBe(rows)
    expect(result.refetch).toBe(true)
  })
})

describe('guards + selectors', () => {
  it('isBidRecord / isBidVoidRecord discriminate the two 088 record shapes', () => {
    expect(isBidRecord(bid(1, 'pl-a', 1, 5, null as unknown as string))).toBe(true)
    expect(isBidRecord({ voided_at: 'x', voided_count: 1, nominations: [] })).toBe(false)
    expect(isBidVoidRecord({ voided_at: 'x', voided_count: 1, nominations: [{ nomination_seq: 1, player_id: 'a' }] })).toBe(true)
    expect(isBidVoidRecord({ voided_at: 'x', voided_count: 1, nominations: [{ nomination_seq: '1' }] })).toBe(false)
    expect(isBidVoidRecord(null)).toBe(false)
  })

  it('bidsForNomination: the live rows of one nomination, highest first', () => {
    expect(bidsForNomination(feed(), 1, 'pl-a').map((r) => r.amount)).toEqual([9, 7, 5])
    expect(bidsForNomination(feed(), 1, 'pl-z')).toEqual([])
  })

  it('compareBidRows: nomination, then amount, then created_at (stored order)', () => {
    const a = bid(1, 'pl-a', 1, 5, '2026-08-19T12:00:01.000Z')
    const b = bid(1, 'pl-a', 2, 5, '2026-08-19T12:00:02.000Z')
    const c = bid(2, 'pl-b', 1, 1, '2026-08-19T11:00:00.000Z')
    expect([c, b, a].sort(compareBidRows)).toEqual([a, b, c])
  })
})
