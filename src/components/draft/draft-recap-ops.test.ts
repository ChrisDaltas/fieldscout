/**
 * Draft-recap derivation pins (M2 task L.B3.5; spec §8.8 recap, §16.1
 * `/draft/recap` real & mock; D103 — a mock writes NO league_rosters, so
 * BOTH variants derive rosters from the picks sheet). Golden values are
 * stored literals (tasks-M1 §4.3).
 */

import { describe, expect, it } from 'vitest'

import type { DraftPickSummary } from '@/hooks/use-draft'
import type { Draft } from '@/types/database'

import {
  recapBuysInOrder,
  recapRostersFromPicks,
  recapTeamOrder,
  recapTeamSpend,
  recapVariant,
} from './draft-recap-ops'

function pick(n: number, teamId: string, playerId: string, over: Partial<DraftPickSummary> = {}): DraftPickSummary {
  return {
    id: `p${n}`,
    pick_number: n,
    round: 1,
    team_id: teamId,
    player_id: playerId,
    is_auto: false,
    is_undone: false,
    price: null, // 088/D134 — snake fixtures carry NULL (066's literal NULL)
    made_via: 'manual',
    created_at: null,
    ...over,
  }
}

// A finished 3-team, 2-round board with a mid-draft undo+re-pick at pick 4:
// the undone row (pl-x on t1) is audit history — its player went BACK to the
// pool and pl-4b was drafted at the reopened number.
const PICKS: DraftPickSummary[] = [
  pick(1, 't1', 'pl-1'),
  pick(2, 't2', 'pl-2'),
  pick(3, 't3', 'pl-3'),
  pick(4, 't1', 'pl-x', { is_undone: true }),
  pick(4, 't3', 'pl-4b'), // reassoned re-pick landed on t3 (order-edit shape)
  pick(5, 't2', 'pl-5'),
  pick(6, 't1', 'pl-6'),
]

describe('recapRostersFromPicks (the ONE roster source — draft_picks, never league_rosters; D103)', () => {
  it('groups LIVE picks per team, ascending by pick number', () => {
    const rosters = recapRostersFromPicks(PICKS)
    expect(rosters.get('t1')?.map((p) => p.player_id)).toEqual(['pl-1', 'pl-6'])
    expect(rosters.get('t2')?.map((p) => p.player_id)).toEqual(['pl-2', 'pl-5'])
    expect(rosters.get('t3')?.map((p) => p.player_id)).toEqual(['pl-3', 'pl-4b'])
  })

  it('an UNDONE pick appears on NO roster — audit history, its player returned to the pool (E4); only the re-pick rosters', () => {
    const rosters = recapRostersFromPicks(PICKS)
    const allRostered = [...rosters.values()].flat().map((p) => p.player_id)
    expect(allRostered).not.toContain('pl-x')
    expect(allRostered).toHaveLength(6) // 7 rows − 1 undone
  })

  it('empty picks ⇒ empty map (an honest empty recap, never a throw)', () => {
    expect(recapRostersFromPicks([]).size).toBe(0)
  })
})

describe('recapVariant (mock vs real; the delete affordance is launcher-only — §8.8/D110(1))', () => {
  const mockDraft = {
    is_mock: true,
    config: { mock: { human_team_id: 't2', launched_by: 'u-launcher', cpu_speed: 'fast' } },
  } as unknown as Pick<Draft, 'is_mock' | 'config'>

  it('a mock recap anchors the HUMAN seat and offers delete to the LAUNCHER alone', () => {
    expect(recapVariant(mockDraft, 'u-launcher', 't9')).toEqual({
      kind: 'mock',
      humanTeamId: 't2',
      canDelete: true,
    })
  })

  it('any other viewer of a mock recap gets NO delete affordance (the RPC refuses them — the UI must not offer it)', () => {
    expect(recapVariant(mockDraft, 'u-other', 't2')).toEqual({
      kind: 'mock',
      humanTeamId: 't2',
      canDelete: false,
    })
    expect(recapVariant(mockDraft, null, null)).toEqual({
      kind: 'mock',
      humanTeamId: 't2',
      canDelete: false,
    })
  })

  it('a malformed mock config renders undifferentiated and offers delete to no one', () => {
    const bare = { is_mock: true, config: {} } as unknown as Pick<Draft, 'is_mock' | 'config'>
    expect(recapVariant(bare, 'u-launcher', null)).toEqual({
      kind: 'mock',
      humanTeamId: null,
      canDelete: false,
    })
  })

  it('a real draft is the real variant — NO delete key exists on it at all (2b: a real record is nobody’s to erase)', () => {
    const variant = recapVariant(
      { is_mock: false, config: {} } as unknown as Pick<Draft, 'is_mock' | 'config'>,
      'u1',
      't1',
    )
    expect(variant).toEqual({ kind: 'real', myTeamId: 't1' })
    expect('canDelete' in variant).toBe(false)
  })
})

describe('recapTeamOrder ("your roster vs the CPUs’" — anchor first; §8.8)', () => {
  const rosters = recapRostersFromPicks(PICKS)

  it('anchor seat leads, then the stored order without repeating it', () => {
    expect(recapTeamOrder(['t1', 't2', 't3'], rosters, 't2')).toEqual(['t2', 't1', 't3'])
  })

  it('no anchor ⇒ the stored order stands (a seatless real viewer)', () => {
    expect(recapTeamOrder(['t1', 't2', 't3'], rosters, null)).toEqual(['t1', 't2', 't3'])
  })

  it('a team present only in picks still renders (defensive — no roster silently drops)', () => {
    expect(recapTeamOrder(['t1', 't2'], rosters, null)).toEqual(['t1', 't2', 't3'])
  })
})

// ---------------------------------------------------------------------------
// Auction spend (M3 task L.C3.2 item 3 — "prices on the final board, per-team
// total spent + biggest buy")
// ---------------------------------------------------------------------------

describe('recapTeamSpend — what a team paid, and for whom', () => {
  const buys = [
    pick(3, 't1', 'chase', { price: 50 }),
    pick(7, 't1', 'gibbs', { price: 12 }),
    pick(9, 't1', 'kelce', { price: 50 }),
    // Undone rows are audit history — reversed money is not spent (D131).
    pick(11, 't1', 'refunded', { price: 99, is_undone: true }),
  ]

  it('totals the live buys only', () => {
    expect(recapTeamSpend(buys).total).toBe(112)
  })

  it('the biggest buy breaks ties on the EARLIER nomination', () => {
    expect(recapTeamSpend(buys).biggest?.player_id).toBe('chase')
    expect(recapTeamSpend(buys).biggest?.price).toBe(50)
  })

  it('a team that bought nothing has no biggest buy', () => {
    expect(recapTeamSpend([])).toEqual({ total: 0, biggest: null })
  })

  it('a null price contributes 0 rather than NaN (a hint row mid-reconcile)', () => {
    expect(recapTeamSpend([pick(1, 't1', 'x', { price: null })]).total).toBe(0)
  })
})

describe('recapBuysInOrder — the auction final board is the spend, in order', () => {
  const picks = [
    pick(4, 't2', 'b', { price: 3 }),
    pick(1, 't1', 'a', { price: 40 }),
    pick(2, 't3', 'gone', { price: 9, is_undone: true }),
  ]

  it('live buys ascending by nomination sequence', () => {
    expect(recapBuysInOrder(picks).map((p) => p.player_id)).toEqual(['a', 'b'])
  })

  it('an ended-early auction with no buys returns nothing to render', () => {
    expect(recapBuysInOrder([])).toEqual([])
  })
})
