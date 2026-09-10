/**
 * activity-feed-ops.test.ts — the feed's sentences from STORED payloads
 * (spec §13.4, §16.2 `activity-feed`; PROGRESS D310(5), D324).
 */
import { describe, expect, it } from 'vitest'

import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'

import * as ops from './activity-feed-ops'
import { COMMISSIONER_LABEL, SYSTEM_LABEL, feedLines, transactionText } from './activity-feed-ops'

function tx(over: Partial<TransactionActivityItem>): TransactionActivityItem {
  return { kind: 'transaction', id: 'tx1', created_at: '2099-09-10T12:00:00Z', type: 'add_drop', status: 'complete', week: 3, team_id: 't1', actor_id: 'u1', action_id: 'a1', payload: {}, ...over }
}

describe('transactionText — 113’s payload names, nothing computed', () => {
  it('add + drop with position · team tags', () => {
    const item = tx({ payload: { add: { name: 'Nine', player_id: 'p9', position: 'WR', nfl_team: 'AAA' }, drop: { name: 'One', player_id: 'p1', position: 'RB', nfl_team: 'BBB' } } })
    expect(transactionText(item)).toBe('added Nine (WR · AAA), dropped One (RB · BBB)')
  })
  it('add only · drop only · a name missing falls back to the id', () => {
    expect(transactionText(tx({ payload: { add: { name: 'Nine', player_id: 'p9' }, drop: null } }))).toBe('added Nine')
    expect(transactionText(tx({ payload: { add: null, drop: { player_id: 'p1' } } }))).toBe('dropped p1')
  })
  it('a payload without names, or another writer’s type, is labelled — never hidden', () => {
    expect(transactionText(tx({ payload: {} }))).toBe('Roster move')
    expect(transactionText(tx({ type: 'waiver_claim', status: 'pending', payload: {} }))).toBe('Waiver claim (pending)')
    expect(transactionText(tx({ type: 'some_future_type', payload: null }))).toBe('some future type')
  })
})

describe('feedLines — transactions carry their team + week; a system post carries the commissioner treatment ONLY when an actor wrote it', () => {
  const names = new Map([['t1', 'Alpha']])
  const items: ActivityItem[] = [
    tx({ payload: { add: { name: 'Nine', player_id: 'p9' }, drop: null } }),
    { kind: 'system', id: 'c1', created_at: '2099-09-11T12:00:00Z', context: 'league', message: 'Schedule remixed (seed 42).', actor_id: 'u2' },
    tx({ id: 'tx2', type: 'commissioner_move', team_id: 't9', payload: {} }),
    // R895: the week worker's notice (116→118 `finalize_matchups`, the
    // postponed-game arm) is written with `user_id NULL` — the engine's
    // post, not a commissioner's act.
    { kind: 'system', id: 'c2', created_at: '2099-09-12T12:00:00Z', context: 'league', message: 'Week 3 finalized with a postponed game.', actor_id: null },
  ]
  it('the shapes — an actor’s system post is the commissioner’s; a NULL actor is the system’s; a named team carries its id, an unnameable one carries none', () => {
    // `teamId` rides beside `team` so the rendered name can be a door to the
    // team page (§16.1). tx2's `t9` is NOT in `names`, so the line has no name
    // AND no id: a franchise we cannot name gets no link, never a dead one.
    expect(feedLines(items, names)).toEqual([
      { id: 'tx1', kind: 'transaction', text: 'added Nine', team: 'Alpha', teamId: 't1', week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: false },
      { id: 'c1', kind: 'system', text: 'Schedule remixed (seed 42).', team: null, teamId: null, week: null, createdAt: '2099-09-11T12:00:00Z', commissioner: true },
      { id: 'tx2', kind: 'transaction', text: 'Commissioner move', team: null, teamId: null, week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: true },
      { id: 'c2', kind: 'system', text: 'Week 3 finalized with a postponed game.', team: null, teamId: null, week: null, createdAt: '2099-09-12T12:00:00Z', commissioner: false },
    ])
    expect(COMMISSIONER_LABEL).toBe('✸ commissioner')
    expect(SYSTEM_LABEL).toBe('system')
  })
})

describe('no ledger code in any end-user copy (F277(a))', () => {
  it('every exported string constant is free of Q/E/F/D/R numbers', () => {
    for (const [name, value] of Object.entries(ops)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
    }
  })
})
