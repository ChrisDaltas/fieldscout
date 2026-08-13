/**
 * Commissioner-panel view pins (M2 task L.B3.3; spec §8.7 — the undo
 * confirm dialog lists EXACTLY what reverts; E4 cascade; §17 role gate;
 * R160 — T=1 is the legal full rewind, wire 0).
 */

import { describe, expect, it } from 'vitest'

import type { DraftPickSummary } from '@/hooks/use-draft'

import {
  canUseCommishPanel,
  cascadeTargetBounds,
  moveOrderEntry,
  pickTimerLabel,
  undoCascadePreview,
  undoLastPreview,
} from './commish-panel-ops'

function pick(n: number, over: Partial<DraftPickSummary> = {}): DraftPickSummary {
  return {
    id: `p${n}`,
    pick_number: n,
    round: 1,
    team_id: `t${n}`,
    player_id: `pl-${n}`,
    is_auto: false,
    is_undone: false,
    made_via: 'manual',
    created_at: null,
    ...over,
  }
}

// 8 picks, pick 5 already undone (audit row — never "revertable" again)
const PICKS = [
  pick(1),
  pick(2),
  pick(3),
  pick(4),
  pick(5, { is_undone: true }),
  pick(5, { player_id: 'pl-5b' }), // the re-pick at the reopened number
  pick(6),
  pick(7),
  pick(8),
]

describe('canUseCommishPanel (§17)', () => {
  it('commissioner + co-commissioner hold the panel; managers and outsiders never', () => {
    expect(canUseCommishPanel('commissioner')).toBe(true)
    expect(canUseCommishPanel('co_commissioner')).toBe(true)
    expect(canUseCommishPanel('manager')).toBe(false)
    expect(canUseCommishPanel(null)).toBe(false)
    expect(canUseCommishPanel(undefined)).toBe(false)
  })
})

describe('undoLastPreview (§8.7 single undo)', () => {
  it('targets the most recent LIVE pick with the single-undo wire form (no to_pick_number)', () => {
    const preview = undoLastPreview(PICKS)
    expect(preview.reverts.map((p) => p.pick_number)).toEqual([8])
    expect(preview.toPickNumber).toBeNull()
  })

  it('an undone row is never "the last pick" — with pick 8 removed the target is 7, not the undone 5', () => {
    const preview = undoLastPreview(PICKS.filter((p) => p.pick_number !== 8))
    expect(preview.reverts.map((p) => p.pick_number)).toEqual([7])
  })

  it('no live picks ⇒ empty preview (confirm disabled)', () => {
    expect(undoLastPreview([pick(1, { is_undone: true })]).reverts).toEqual([])
  })
})

describe('undoCascadePreview (E4 — "exactly what reverts")', () => {
  it('lists EXACTLY the live picks ≥ T ascending, excludes undone audit rows, and wires to_pick_number = T − 1', () => {
    const preview = undoCascadePreview(PICKS, 5)
    // Pick 5 appears ONCE (the live re-pick) — the undone original is audit
    // history, already reverted, and must not be listed as reverting again.
    expect(preview.reverts.map((p) => `${p.pick_number}:${p.player_id}`)).toEqual([
      '5:pl-5b',
      '6:pl-6',
      '7:pl-7',
      '8:pl-8',
    ])
    expect(preview.toPickNumber).toBe(4)
  })

  it('T = 1 is the FULL rewind: every live pick listed, wire value 0 (R160 — legal, deliberate)', () => {
    const preview = undoCascadePreview(PICKS, 1)
    expect(preview.reverts).toHaveLength(8) // 8 live picks (undone row excluded)
    expect(preview.toPickNumber).toBe(0)
  })

  it('a T past the board reverts nothing (caller disables confirm)', () => {
    expect(undoCascadePreview(PICKS, 99).reverts).toEqual([])
  })
})

describe('cascadeTargetBounds', () => {
  it('1 … highest live pick; null with no live picks', () => {
    expect(cascadeTargetBounds(PICKS)).toEqual({ min: 1, max: 8 })
    expect(cascadeTargetBounds([pick(3, { is_undone: true })])).toBeNull()
  })
})

describe('moveOrderEntry (the E31 explicit-order editor)', () => {
  const ORDER = ['a', 'b', 'c'] as const

  it('swaps one step; ends are inert (same reference back)', () => {
    expect(moveOrderEntry(ORDER, 1, 'up')).toEqual(['b', 'a', 'c'])
    expect(moveOrderEntry(ORDER, 1, 'down')).toEqual(['a', 'c', 'b'])
    expect(moveOrderEntry(ORDER, 0, 'up')).toBe(ORDER)
    expect(moveOrderEntry(ORDER, 2, 'down')).toBe(ORDER)
  })
})

describe('pickTimerLabel (E15 catalog labels)', () => {
  it('renders the §7.3.8 catalog honestly, 0 = untimed', () => {
    expect(pickTimerLabel(0)).toBe('No clock (untimed)')
    expect(pickTimerLabel(30)).toBe('30 seconds')
    expect(pickTimerLabel(90)).toBe('1:30 min')
    expect(pickTimerLabel(120)).toBe('2 min')
    expect(pickTimerLabel(3600)).toBe('1 hour')
    expect(pickTimerLabel(86400)).toBe('24 hours')
  })
})
