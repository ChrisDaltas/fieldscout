/**
 * lineup-service.test.ts — the PURE half of the lineup route (M4 task
 * L.D4.1; F224(e)): the wire schema's shape and the placement half of the
 * F65(b) identity guard. The live half (auth matrix, the verbatim lock
 * refusal, replay, reuse) is `lineup-api-db.test.ts` over the stack.
 */
import { describe, expect, it } from 'vitest'

import { placementMatches, setLineupInputSchema } from './lineup-service'

const QB = 'p-qb'
const RB1 = 'p-rb1'
const RB2 = 'p-rb2'
const WR1 = 'p-wr1'
const IR = 'p-ir'

describe('setLineupInputSchema — the FULL canonical map, one action_id, an optional reason (F224(e))', () => {
  const ok = {
    week: 3,
    slot_map: { 'qb:0': QB, 'rb:0': RB1, 'ir:0': IR },
    action_id: 'AFA00000-0000-4000-8000-000000000001',
  }

  it('accepts the map whole and LOWER-CASES the action_id (R768)', () => {
    const parsed = setLineupInputSchema.parse(ok)
    expect(parsed.slot_map).toStrictEqual(ok.slot_map)
    expect(parsed.action_id).toBe('afa00000-0000-4000-8000-000000000001')
    expect(parsed.reason).toBeUndefined()
  })

  it('an EMPTY map is legal — bench everyone / clear IR is a lineup (112 accepts {})', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: {} }).success).toBe(true)
  })

  it('an empty slot is an ABSENT key — a null value is refused here before 112 refuses it with 22023', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': null } }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': '' } }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, slot_map: { 'qb:0': 7 } }).success).toBe(false)
  })

  it('week is an integer on the NFL calendar (1–18); the league\'s own bounds are 112\'s 404-class refusal', () => {
    for (const week of [0, 19, 1.5, '3', null]) {
      expect(setLineupInputSchema.safeParse({ ...ok, week }).success, String(week)).toBe(false)
    }
    expect(setLineupInputSchema.safeParse({ ...ok, week: 1 }).success).toBe(true)
    expect(setLineupInputSchema.safeParse({ ...ok, week: 18 }).success).toBe(true)
  })

  it('action_id is REQUIRED and a uuid', () => {
    const without: Partial<typeof ok> = { ...ok }
    delete without.action_id
    expect(setLineupInputSchema.safeParse(without).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, action_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('reason is optional, trimmed, ≤ 500 (the league_chat bound 112 enforces too)', () => {
    expect(setLineupInputSchema.parse({ ...ok, reason: '  manager away  ' }).reason).toBe('manager away')
    expect(setLineupInputSchema.safeParse({ ...ok, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, reason: null }).success).toBe(true)
  })

  it('is STRICT — a stray key (a client-supplied starters[] or locked_at) is refused, not ignored', () => {
    expect(setLineupInputSchema.safeParse({ ...ok, starters: [] }).success).toBe(false)
    expect(setLineupInputSchema.safeParse({ ...ok, locked_at: null }).success).toBe(false)
  })
})

describe('placementMatches — the placement half of the F65(b) guard', () => {
  it('a map honored VERBATIM matches', () => {
    const map = { 'qb:0': QB, 'rb:0': RB1, 'rb:1': RB2 }
    expect(placementMatches(map, { ...map }, [])).toBe(true)
  })

  it('a re-seat named in moved[] matches (E16: from = the submitted key)', () => {
    const submitted = { 'flex:0': WR1, 'wr:0': RB1 }
    const canonical = { 'wr:0': WR1, 'rb:0': RB1 }
    const moved = [
      { player_id: WR1, from: 'flex:0', to: 'wr:0' },
      { player_id: RB1, from: 'wr:0', to: 'rb:0' },
    ]
    expect(placementMatches(submitted, canonical, moved)).toBe(true)
  })

  it('a re-seat NOT named in moved[] does not match — the map came from a different submit', () => {
    const submitted = { 'flex:0': WR1, 'wr:0': RB1 }
    const canonical = { 'wr:0': WR1, 'rb:0': RB1 }
    expect(placementMatches(submitted, canonical, [])).toBe(false)
    expect(placementMatches(submitted, canonical, [{ player_id: WR1, from: 'wr:1', to: 'wr:0' }])).toBe(false)
  })

  it('a swapped player is refused even when every surviving key still matches', () => {
    const submitted = { 'qb:0': QB, 'rb:0': RB1 }
    expect(placementMatches(submitted, { 'qb:0': QB, 'rb:0': RB2 }, [])).toBe(false)
  })

  it('a superset or subset of players is refused — an IR removal is a different lineup from an IR placement', () => {
    expect(placementMatches({ 'qb:0': QB }, { 'qb:0': QB, 'ir:0': IR }, [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB, 'ir:0': IR }, { 'qb:0': QB }, [])).toBe(false)
  })

  it('a non-object canonical map never matches', () => {
    expect(placementMatches({ 'qb:0': QB }, null, [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB }, [], [])).toBe(false)
    expect(placementMatches({ 'qb:0': QB }, 'qb', [])).toBe(false)
  })

  it('an empty submit matches an empty canonical map and nothing else', () => {
    expect(placementMatches({}, {}, [])).toBe(true)
    expect(placementMatches({}, { 'qb:0': QB }, [])).toBe(false)
  })
})
