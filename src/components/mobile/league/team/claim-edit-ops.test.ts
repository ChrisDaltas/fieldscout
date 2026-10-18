/**
 * claim-edit-ops.test.ts — editing a pending claim on the phone (gap list
 * §3 #13): where the edit starts, who the drop may name, when Save is live
 * and what it sends, and the claim order's arrows (the desktop drag's rule:
 * FAAB claims move only among equal bids).
 */
import { describe, expect, it } from 'vitest'

import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'

import {
  claimBidBounds,
  claimDropChoices,
  claimEditChange,
  claimEditStart,
  claimEditState,
  claimOrderCaption,
  claimOrderMeta,
  claimOrderRows,
  dropGoneCopy,
  takenDrops,
} from './claim-edit-ops'

function rp(id: string, full_name: string, locked = false): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position: 'WR',
    nfl_team: 'KC',
    status: 'Active',
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: locked ? { state: 'locked_release_unrecorded', until: null } : { state: 'unlocked', until: null },
  }
}

const P = (id: string, name: string) => ({ player_id: id, full_name: name, position: 'WR', nfl_team: 'KC' })

function claim(id: string, over: Partial<WaiverClaimView> = {}): WaiverClaimView {
  return {
    id,
    team_id: 't1',
    add: P(`add-${id}`, `Add ${id}`),
    drop: null,
    faab_bid: 5,
    claim_order: 1,
    status: 'pending',
    result_reason: null,
    process_at: null,
    processed_at: null,
    created_at: '2099-10-10T10:00:00.000Z',
    created_by: 'u',
    cancelled_at: null,
    ...over,
  }
}

const ROSTER = [rp('a', 'Amon-Ra St. Brown'), rp('b', 'Jordan Love', true), rp('c', 'Dalton Kincaid')]
const isLocked = (p: RosterPlayer) => p.game_lock.state !== 'unlocked'

describe('claimBidBounds', () => {
  it('a FAAB league bids from the minimum to the balance; a priority league has no bid', () => {
    expect(claimBidBounds({ waiver_type: 'faab', faab_min_bid: 1, faab_balance: 60 })).toEqual({ min: 1, max: 60 })
    expect(claimBidBounds({ waiver_type: 'faab', faab_min_bid: 0, faab_balance: null })).toEqual({ min: 0, max: null })
    expect(claimBidBounds({ waiver_type: 'rolling', faab_min_bid: 0, faab_balance: 100 })).toBeNull()
  })
})

describe('claimEditStart', () => {
  it('starts from the claim as it stands', () => {
    expect(claimEditStart(claim('x', { faab_bid: 9, drop: P('c', 'Dalton Kincaid') }), ROSTER)).toEqual({ bid: 9, dropId: 'c', dropGone: null })
    expect(claimEditStart(claim('x'), ROSTER)).toEqual({ bid: 5, dropId: null, dropGone: null })
  })

  it('a drop who has left the roster can’t be kept: the drop starts empty and he is named', () => {
    expect(claimEditStart(claim('x', { drop: P('gone', 'Tyler Allgeier') }), ROSTER)).toEqual({ bid: 5, dropId: null, dropGone: 'Tyler Allgeier' })
    expect(dropGoneCopy('Tyler Allgeier')).toBe('Tyler Allgeier isn’t on your roster any more.')
  })
})

describe('claimDropChoices', () => {
  it('offers only unlocked players — the claim flow’s rule', () => {
    expect(claimDropChoices(ROSTER, null, isLocked).map((p) => p.player_id)).toEqual(['a', 'c'])
  })

  it('keeps the claim’s current drop even once his game has started (keeping it is not a new move)', () => {
    expect(claimDropChoices(ROSTER, 'b', isLocked).map((p) => p.player_id)).toEqual(['a', 'b', 'c'])
  })

  it('leaves out a drop another claim for the same player already names — two claims can’t be the same claim', () => {
    expect(claimDropChoices(ROSTER, null, isLocked, new Set(['c'])).map((p) => p.player_id)).toEqual(['a'])
  })
})

describe('takenDrops', () => {
  it('the drops of your OTHER pending claims for the same player (null = one with no drop)', () => {
    const same = { add: P('add-x', 'Puka Nacua') }
    const claims = [
      claim('x', { ...same, drop: P('a', 'A') }),
      claim('y', { ...same, drop: P('c', 'C') }),
      claim('z', { ...same }),
      claim('settled', { ...same, status: 'lost', drop: P('b', 'B') }),
      claim('other', { drop: P('b', 'B') }),
    ]
    expect([...takenDrops(claims, claims[0]!)]).toEqual(['c', null])
    expect([...takenDrops(claims, claims[4]!)]).toEqual([])
  })
})

describe('claimEditState — Save is live only for a real, valid change', () => {
  const bounds = { min: 1, max: 20 }
  const c = claim('x', { faab_bid: 5, drop: P('a', 'Amon-Ra St. Brown') })

  it('nothing changed: Save stays off', () => {
    expect(claimEditState({ claim: c, bounds, bid: 5, dropId: 'a', needsDrop: false })).toEqual({ changed: false, ready: false })
  })

  it('a new bid or a new drop (or no drop) turns it on', () => {
    expect(claimEditState({ claim: c, bounds, bid: 8, dropId: 'a', needsDrop: false }).ready).toBe(true)
    expect(claimEditState({ claim: c, bounds, bid: 5, dropId: 'c', needsDrop: false }).ready).toBe(true)
    expect(claimEditState({ claim: c, bounds, bid: 5, dropId: null, needsDrop: false }).ready).toBe(true)
  })

  it('a full roster must still name a drop', () => {
    expect(claimEditState({ claim: c, bounds, bid: 8, dropId: null, needsDrop: true })).toEqual({ changed: true, ready: false })
  })

  it('a bid outside the bounds (a balance that shrank since) can’t be saved', () => {
    const over = claim('x', { faab_bid: 30 })
    expect(claimEditState({ claim: over, bounds, bid: 30, dropId: 'c', needsDrop: false })).toEqual({ changed: true, ready: false })
    expect(claimEditState({ claim: over, bounds, bid: 20, dropId: null, needsDrop: false }).ready).toBe(true)
  })

  it('a drop another claim for the same player names can’t be saved', () => {
    expect(claimEditState({ claim: c, bounds, bid: 5, dropId: null, needsDrop: false, taken: new Set([null]) })).toEqual({ changed: true, ready: false })
    expect(claimEditState({ claim: c, bounds, bid: 5, dropId: 'c', needsDrop: false, taken: new Set([null]) }).ready).toBe(true)
  })

  it('a priority league ignores the bid', () => {
    expect(claimEditState({ claim: c, bounds: null, bid: 99, dropId: 'a', needsDrop: false }).changed).toBe(false)
  })
})

describe('claimEditChange — the body the edit route gets', () => {
  it('SETS the bid and the drop in a FAAB league', () => {
    expect(claimEditChange(true, 8, 'c')).toEqual({ faab_bid: 8, drop_player_id: 'c' })
  })

  it('a priority league always sends $0 — even when the claim carries a stray bid from its FAAB days', () => {
    const stray = claim('x', { faab_bid: 12 })
    const start = claimEditStart(stray, [])
    expect(start.bid).toBe(12)
    expect(claimEditChange(false, start.bid, null)).toEqual({ faab_bid: 0, drop_player_id: null })
  })
})

describe('claimOrderRows — the order the run tries, and the arrows', () => {
  it('FAAB: biggest bid first; arrows only between equal bids, sending the neighbour’s stored place', () => {
    const doc = {
      waiver_type: 'faab',
      claims: [
        claim('a', { faab_bid: 12, claim_order: 1 }),
        claim('b', { faab_bid: 7, claim_order: 2 }),
        claim('c', { faab_bid: 7, claim_order: 3 }),
        claim('d', { faab_bid: 3, claim_order: 4 }),
        claim('old', { status: 'lost', faab_bid: 40, claim_order: 1 }),
      ],
    }
    const rows = claimOrderRows(doc)
    expect(rows.map((r) => [r.claim.id, r.rank, r.up, r.down])).toEqual([
      ['a', 1, null, null],
      ['b', 2, null, 3],
      ['c', 3, 2, null],
      ['d', 4, null, null],
    ])
    expect(claimOrderCaption(rows, 'faab')).toBe('Tried biggest bid first. Use the arrows to order claims with the same bid.')
  })

  it('FAAB with no equal bids: no arrow is on, and the caption says what moves a claim', () => {
    const rows = claimOrderRows({ waiver_type: 'faab', claims: [claim('a', { faab_bid: 9 }), claim('b', { faab_bid: 4, claim_order: 2 })] })
    expect(rows.every((r) => r.up === null && r.down === null)).toBe(true)
    expect(claimOrderCaption(rows, 'faab')).toBe('Tried biggest bid first — change a bid to change the order.')
  })

  it('a priority league: any claim moves one place up or down', () => {
    const doc = { waiver_type: 'rolling', claims: [claim('a', { faab_bid: 0, claim_order: 1 }), claim('b', { faab_bid: 0, claim_order: 2 }), claim('c', { faab_bid: 0, claim_order: 3 })] }
    const rows = claimOrderRows(doc)
    expect(rows.map((r) => [r.claim.id, r.up, r.down])).toEqual([
      ['a', null, 2],
      ['b', 1, 3],
      ['c', 2, null],
    ])
    expect(claimOrderCaption(rows, 'rolling')).toBe('Tried top to bottom. Use the arrows to change the order.')
  })

  it('the row’s second line', () => {
    const short = (n: string) => n.toUpperCase()
    expect(claimOrderMeta(claim('x', { faab_bid: 7, drop: P('a', 'Jordan Love') }), true, short)).toBe('$7 bid · drop JORDAN LOVE')
    expect(claimOrderMeta(claim('x', { faab_bid: 7 }), true, short)).toBe('$7 bid · no drop')
    expect(claimOrderMeta(claim('x', { drop: P('a', 'Jordan Love') }), false, short)).toBe('Drop JORDAN LOVE')
    expect(claimOrderMeta(claim('x'), false, short)).toBe('No drop')
  })
})
