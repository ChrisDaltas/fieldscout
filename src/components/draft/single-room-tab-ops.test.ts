import { describe, expect, it } from 'vitest'

import {
  claimBeats,
  isRoomTabClaim,
  outcomeForClaim,
  parseStoredClaim,
  roomTabKey,
  type RoomTabClaim,
  type RoomTabOutcome,
  type RoomTabRole,
} from './single-room-tab-ops'

/**
 * The DR.6 leader-election pins (tasks-DR DR.6 DoD; D156; spec §9.3 v2.12).
 * **The ruling under every pin here: "The most recent one takes over and
 * the others disconnect" (Chris, 2026-08-17 — Q14).** Newest wins is the
 * law; oldest-wins, first-wins, or both-hold are the defects these pins
 * exist to catch.
 *
 * Break probes recorded in the DR.6 PR (shown RED, then reverted):
 *   - probe A inverts `claimBeats` to prefer the OLDER claim (first-tab-
 *     wins — the exact opposite of the ruling); the newest-wins pins and
 *     every sequence built on them redden at the recorded count.
 *   - probe B bypasses the release gate in `draft-room.tsx` (a released
 *     tab keeps feeding the channel-owning hook); that is
 *     `single-room-tab.test.ts`'s gate pin, not this file's.
 */

const claim = (tab_id: string, claimed_at: number, seq = 1): RoomTabClaim => ({
  tab_id,
  claimed_at,
  seq,
})

describe('claimBeats — newest wins (the Q14 ruling as an ordering)', () => {
  it('one tick apart: the newer claim wins, in both directions', () => {
    // The one-unit pin: two claims a single millisecond apart.
    expect(claimBeats(claim('a', 1001), claim('b', 1000))).toBe(true)
    expect(claimBeats(claim('b', 1000), claim('a', 1001))).toBe(false)
  })

  it('a same-instant tie breaks on tab_id — exactly one direction wins', () => {
    const a = claim('tab-a', 5000)
    const b = claim('tab-b', 5000)
    expect(claimBeats(b, a)).toBe(true) // 'tab-b' > 'tab-a'
    expect(claimBeats(a, b)).toBe(false)
  })

  it('an OLDER claim never beats a newer one regardless of tab_id order', () => {
    // tab_id is only a tie-breaker — recency always dominates it.
    expect(claimBeats(claim('zzz', 999), claim('aaa', 1000))).toBe(false)
    expect(claimBeats(claim('aaa', 1000), claim('zzz', 999))).toBe(true)
  })

  it('seq never participates in the election (transport nonce only)', () => {
    // A huge seq on an older claim buys it nothing; a stale seq on a newer
    // claim costs it nothing.
    expect(claimBeats(claim('a', 999, 9999), claim('b', 1000, 1))).toBe(false)
    expect(claimBeats(claim('a', 1001, 1), claim('b', 1000, 9999))).toBe(true)
    // Same tab, same instant, different seq (a defend re-announce): a
    // claim never beats itself.
    expect(claimBeats(claim('a', 1000, 7), claim('a', 1000, 2))).toBe(false)
  })
})

describe('outcomeForClaim — release / defend / echo', () => {
  const mine = claim('tab-mine', 2000)

  it('a newer incoming claim releases a holder (the takeover)', () => {
    expect(outcomeForClaim(mine, 'holding', claim('tab-new', 2001))).toEqual({
      role: 'released',
      defend: false,
    })
  })

  it('a newer incoming claim keeps a released tab released (third tab opens)', () => {
    expect(outcomeForClaim(mine, 'released', claim('tab-newer', 3000))).toEqual({
      role: 'released',
      defend: false,
    })
  })

  it('a HOLDER defends against a losing claim (the clock-skew guard)', () => {
    // A claimant whose clock is behind must learn it lost — the defend is
    // what re-announces the winning claim to it.
    expect(outcomeForClaim(mine, 'holding', claim('tab-skewed', 1500))).toEqual({
      role: 'holding',
      defend: true,
    })
  })

  it('a RELEASED tab never defends — the current holder speaks for itself', () => {
    expect(outcomeForClaim(mine, 'released', claim('tab-skewed', 1500))).toEqual({
      role: 'released',
      defend: false,
    })
  })

  it('own echo changes nothing in either role (idempotent double delivery)', () => {
    // Both buses can deliver the same claim; storage may replay our own.
    expect(outcomeForClaim(mine, 'holding', claim('tab-mine', 2000, 5))).toEqual({
      role: 'holding',
      defend: false,
    })
    expect(outcomeForClaim(mine, 'released', claim('tab-mine', 2000, 5))).toEqual({
      role: 'released',
      defend: false,
    })
  })

  it('receiving the same claim twice yields the same outcome (idempotence)', () => {
    const incoming = claim('tab-new', 2001)
    const first = outcomeForClaim(mine, 'holding', incoming)
    const second = outcomeForClaim(mine, first.role, incoming)
    expect(first).toEqual({ role: 'released', defend: false })
    expect(second).toEqual({ role: 'released', defend: false })
  })
})

describe('the election sequences (claim → takeover → re-claim), as goldens', () => {
  /** Replay a tab's inbox against the model, returning the role trace. */
  const trace = (
    mine: RoomTabClaim,
    inbox: RoomTabClaim[],
    start: RoomTabRole = 'holding',
  ): { roles: RoomTabRole[]; outcomes: RoomTabOutcome[] } => {
    let role = start
    const roles: RoomTabRole[] = []
    const outcomes: RoomTabOutcome[] = []
    for (const incoming of inbox) {
      const outcome = outcomeForClaim(mine, role, incoming)
      role = outcome.role
      roles.push(role)
      outcomes.push(outcome)
    }
    return { roles, outcomes }
  }

  it('newest-tab takeover: A holds, B opens, A releases; B never releases', () => {
    const a = claim('tab-a', 1000)
    const b = claim('tab-b', 2000)
    // A's inbox: B's mount claim.
    expect(trace(a, [b]).roles).toEqual(['released'])
    // B's inbox: nothing (BroadcastChannel does not echo) — but even A's
    // stale claim arriving late cannot displace it, only trigger a defend.
    expect(trace(b, [a])).toEqual({
      roles: ['holding'],
      outcomes: [{ role: 'holding', defend: true }],
    })
  })

  it('"Use this tab instead": the released tab re-claims and the roles swap', () => {
    const aReclaim = claim('tab-a', 3000, 2) // A's button press — a FRESH claim
    const b = claim('tab-b', 2000)
    // B (holding) receives A's re-claim → released in turn (DR.6 contract:
    // "and the then-older tab releases in turn").
    expect(trace(b, [aReclaim]).roles).toEqual(['released'])
    // A (was released) hears nothing that beats its fresh claim.
    expect(trace(aReclaim, [b], 'holding')).toEqual({
      roles: ['holding'],
      outcomes: [{ role: 'holding', defend: true }],
    })
  })

  it('three tabs: C newest holds; A and B both sit released', () => {
    const a = claim('tab-a', 1000)
    const b = claim('tab-b', 2000)
    const c = claim('tab-c', 3000)
    expect(trace(a, [b, c]).roles).toEqual(['released', 'released'])
    expect(trace(b, [c]).roles).toEqual(['released'])
    // C receives both stale claims (storage replay order is arbitrary —
    // either order): holds throughout, defends each.
    expect(trace(c, [a, b]).roles).toEqual(['holding', 'holding'])
    expect(trace(c, [b, a]).roles).toEqual(['holding', 'holding'])
  })

  it('same-millisecond mount race settles on exactly ONE holder', () => {
    const a = claim('tab-a', 5000)
    const b = claim('tab-b', 5000)
    // Each receives the other's claim: the tie-break releases exactly one.
    const aOutcome = outcomeForClaim(a, 'holding', b)
    const bOutcome = outcomeForClaim(b, 'holding', a)
    expect([aOutcome.role, bOutcome.role].sort()).toEqual(['holding', 'released'])
    // The survivor defends; the loser stays silent — the exchange
    // terminates instead of ping-ponging.
    const holder = aOutcome.role === 'holding' ? aOutcome : bOutcome
    const loser = aOutcome.role === 'holding' ? bOutcome : aOutcome
    expect(holder.defend).toBe(true)
    expect(loser.defend).toBe(false)
  })
})

describe('the fallback-bus payloads (localStorage carries JSON strings)', () => {
  it('round-trips a claim', () => {
    const mine = claim('tab-a', 1234, 3)
    expect(parseStoredClaim(JSON.stringify(mine))).toEqual(mine)
  })

  it('decodes garbage, null, and wrong shapes to null — never throws', () => {
    expect(parseStoredClaim(null)).toBeNull()
    expect(parseStoredClaim('')).toBeNull()
    expect(parseStoredClaim('not json')).toBeNull()
    expect(parseStoredClaim('42')).toBeNull()
    expect(parseStoredClaim('{"tab_id":"a"}')).toBeNull() // missing fields
    expect(parseStoredClaim('{"tab_id":"","claimed_at":1,"seq":1}')).toBeNull()
    expect(
      parseStoredClaim('{"tab_id":"a","claimed_at":"soon","seq":1}'),
    ).toBeNull()
    expect(parseStoredClaim('{"tab_id":"a","claimed_at":null,"seq":1}')).toBeNull()
  })

  it('isRoomTabClaim rejects non-objects and non-finite instants', () => {
    expect(isRoomTabClaim(null)).toBe(false)
    expect(isRoomTabClaim('claim')).toBe(false)
    expect(isRoomTabClaim({ tab_id: 'a', claimed_at: Infinity, seq: 1 })).toBe(false)
    expect(isRoomTabClaim({ tab_id: 'a', claimed_at: 1, seq: NaN })).toBe(false)
    expect(isRoomTabClaim({ tab_id: 'a', claimed_at: 1, seq: 1 })).toBe(true)
  })
})

describe('the per-draft key (one election per draft, per browser profile)', () => {
  it('is the draft-scoped literal both buses share', () => {
    // The hook names its BroadcastChannel AND its localStorage key with
    // this — one namespace, so a laptop's other drafts (and every other
    // profile/device, by the nature of both buses) are untouched.
    expect(roomTabKey('d-123')).toBe('fieldscout:room-tab:d-123')
  })
})
