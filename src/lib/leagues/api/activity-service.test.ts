/**
 * activity-service.test.ts — the feed's PURE halves: the query surface and
 * the two-stream merge (M4 task L.D4.2; spec §13.4/§15.3).
 *
 * `transactions-api-db.test.ts` drives the whole read over the real stack.
 * What lives here is the arithmetic a stack suite proves only by accident:
 * the paging over a UNION of two streams, where an off-by-one silently drops
 * an event and every assertion still looks green because the feed is
 * *plausible*. That is the failure CLAUDE.md's "never let 'nothing happened'
 * mean 'it worked'" rule is about, one layer up.
 */
import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  activityQuerySchema,
  mergeActivity,
  type SystemActivityItem,
  type TransactionActivityItem,
} from './activity-service'

function txn(id: string, createdAt: string | null): TransactionActivityItem {
  return {
    kind: 'transaction',
    id,
    created_at: createdAt,
    type: 'add_drop',
    status: 'complete',
    week: 1,
    team_id: null,
    actor_id: null,
    action_id: null,
    payload: {},
  }
}

function post(id: string, createdAt: string | null): SystemActivityItem {
  return {
    kind: 'system',
    id,
    created_at: createdAt,
    context: 'league',
    message: 'Schedule remixed',
    actor_id: null,
  }
}

describe('activityQuerySchema — the filters are validated, never silently dropped', () => {
  it('defaults to the whole feed at the default page size', () => {
    const parsed = activityQuerySchema.parse({})
    expect(parsed).toMatchObject({ kind: 'all', limit: ACTIVITY_DEFAULT_LIMIT })
    expect(parsed.type).toBeUndefined()
  })

  it('coerces the string values a query string actually delivers', () => {
    const parsed = activityQuerySchema.parse({ week: '7', limit: '10' })
    expect(parsed.week).toBe(7)
    expect(parsed.limit).toBe(10)
  })

  it('splits a csv `type` into the §12.9 vocabulary', () => {
    expect(activityQuerySchema.parse({ type: 'add_drop, trade' }).type).toEqual([
      'add_drop',
      'trade',
    ])
  })

  it('REFUSES a type outside §12.9 rather than widening the feed', () => {
    // The failure this prevents: an unknown value silently dropped from the
    // `in` list, so the caller's filter matches everything.
    expect(activityQuerySchema.safeParse({ type: 'add_drop,promotion' }).success).toBe(false)
    expect(activityQuerySchema.safeParse({ type: '' }).success).toBe(false)
  })

  it('caps the page size far below PostgREST\'s 1000-row ceiling', () => {
    expect(ACTIVITY_MAX_LIMIT).toBeLessThan(1000)
    // …and the over-fetch of limit+1 still cannot reach it.
    expect(ACTIVITY_MAX_LIMIT + 1).toBeLessThan(1000)
    expect(activityQuerySchema.safeParse({ limit: String(ACTIVITY_MAX_LIMIT + 1) }).success).toBe(
      false,
    )
    expect(activityQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it('refuses an unrecognized query key instead of ignoring it', () => {
    expect(activityQuerySchema.safeParse({ kinds: 'system' }).success).toBe(false)
  })

  it('requires a real instant for the cursor', () => {
    expect(activityQuerySchema.safeParse({ before: '2026-09-03T12:00:00Z' }).success).toBe(true)
    expect(activityQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false)
  })
})

describe('mergeActivity — the two streams interleave by instant, newest first', () => {
  const t1 = txn('t1', '2026-09-01T10:00:00+00:00')
  const t2 = txn('t2', '2026-09-01T12:00:00+00:00')
  const p1 = post('p1', '2026-09-01T11:00:00+00:00')
  const p2 = post('p2', '2026-09-01T13:00:00+00:00')

  it('interleaves rather than concatenating', () => {
    const feed = mergeActivity([t2, t1], [p2, p1], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['p2', 't2', 'p1', 't1'])
    expect(feed.has_more).toBe(false)
    expect(feed.next_before).toBeNull()
  })

  it('reports has_more from the OVER-FETCH, never from a short page', () => {
    // Both streams were fetched at limit+1 = 3; the union of 4 exceeds the
    // page of 3, so there is provably more. `next_before` is the last
    // RETURNED item's instant, so the next page resumes exactly there.
    const feed = mergeActivity([t2, t1], [p2, p1], 3)
    expect(feed.items.map((i) => i.id)).toEqual(['p2', 't2', 'p1'])
    expect(feed.has_more).toBe(true)
    expect(feed.next_before).toBe('2026-09-01T11:00:00+00:00')
  })

  it('a full page with nothing beyond it is NOT has_more', () => {
    const feed = mergeActivity([t2], [p2], 2)
    expect(feed.items).toHaveLength(2)
    expect(feed.has_more).toBe(false)
  })

  it('an empty feed is empty, not a lie about there being more', () => {
    expect(mergeActivity([], [], 25)).toEqual({
      items: [],
      limit: 25,
      has_more: false,
      next_before: null,
    })
  })

  it('ties break on id, deterministically — the same page twice is the same page', () => {
    const a = txn('aaa', '2026-09-01T10:00:00+00:00')
    const b = post('bbb', '2026-09-01T10:00:00+00:00')
    expect(mergeActivity([a], [b], 10).items.map((i) => i.id)).toEqual(['bbb', 'aaa'])
    expect(mergeActivity([a], [b], 10).items.map((i) => i.id)).toEqual(['bbb', 'aaa'])
  })

  it('a NULL created_at sorts LAST — never as the newest event', () => {
    // Both columns are DEFAULT NOW() but nullable. A naive comparator turns
    // NULL into 0 or NaN; either one puts a mystery row at the top of the
    // feed, which is the most visible surface in the league.
    const orphan = txn('nul', null)
    const feed = mergeActivity([t2, orphan], [p1], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['t2', 'p1', 'nul'])
  })

  it('an unparseable created_at is treated like NULL, not like NaN', () => {
    const bad = txn('bad', 'not-a-timestamp')
    const feed = mergeActivity([t2, bad], [], 10)
    expect(feed.items.map((i) => i.id)).toEqual(['t2', 'bad'])
  })
})
