import { describe, expect, it } from 'vitest'

import { reconcileDraftOrder } from './draft-order-editor-ops'

describe('reconcileDraftOrder (L.B3.4 — the manual/custom editor list)', () => {
  const active = ['t1', 't2', 't3', 't4']

  it('a full valid save keeps its order', () => {
    expect(reconcileDraftOrder(['t3', 't1', 't4', 't2'], active)).toEqual(['t3', 't1', 't4', 't2'])
  })

  it('no save ⇒ franchises in list order (a complete editable list, never empty)', () => {
    expect(reconcileDraftOrder(null, active)).toEqual(active)
  })

  it('a stale save drops departed ids and appends unknown franchises — always a full permutation', () => {
    // t9 retired since the save; t4 joined since.
    expect(reconcileDraftOrder(['t9', 't2', 't1'], active)).toEqual(['t2', 't1', 't3', 't4'])
  })

  it('duplicate saved ids collapse to first occurrence', () => {
    expect(reconcileDraftOrder(['t2', 't2', 't1'], active)).toEqual(['t2', 't1', 't3', 't4'])
  })

  it('result is ALWAYS a permutation of the active set (the draft_start contract)', () => {
    for (const saved of [null, [], ['t9'], ['t4', 't4', 't2'], ['t1', 't2', 't3', 't4']]) {
      const out = reconcileDraftOrder(saved, active)
      expect([...out].sort()).toEqual([...active].sort())
    }
  })
})
