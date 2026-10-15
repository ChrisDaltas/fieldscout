import { describe, expect, it } from 'vitest'

import type { ActivityFeed, ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'

import { involvedTeamIds, mergeStreamPage, streamKeeps } from './use-mobile-league-activity'

const item = (id: string, minute: number): ActivityItem => ({
  kind: 'transaction',
  id,
  created_at: `2026-10-11T12:${String(minute).padStart(2, '0')}:00.000Z`,
  type: 'add_drop',
  status: 'complete',
  week: 5,
  team_id: null,
  actor_id: null,
  action_id: null,
  payload: {},
})
const feed = (items: ActivityItem[], hasMore: boolean): ActivityFeed => ({
  items,
  limit: items.length,
  has_more: hasMore,
  next_before: null,
  next_before_id: null,
})
const top = { cursor: null, done: false }

describe('mergeStreamPage — several team reads, one ordered list', () => {
  it('one stream is plain paging', () => {
    const page = mergeStreamPage([top], [feed([item('a', 50), item('b', 40)], true)])
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(page.next).toEqual([{ cursor: { before: item('b', 40).created_at, beforeId: 'b' }, done: false }])
  })

  it('shows only what is certainly in order; the rest is read again from its cursor', () => {
    // Stream 0 has more below minute 40; stream 1 has more below minute 30.
    const page = mergeStreamPage(
      [top, top],
      [feed([item('a1', 55), item('a2', 40)], true), feed([item('b1', 50), item('b2', 30)], true)],
    )
    // Anything older than minute 40 might have an unread neighbour in stream 0.
    expect(page.items.map((i) => i.id)).toEqual(['a1', 'b1', 'a2'])
    expect(page.next?.[0]).toEqual({ cursor: { before: item('a2', 40).created_at, beforeId: 'a2' }, done: false })
    expect(page.next?.[1]).toEqual({ cursor: { before: item('b1', 50).created_at, beforeId: 'b1' }, done: false })
  })

  it('finishes when every stream is read out', () => {
    const page = mergeStreamPage([top, top], [feed([item('a1', 55)], false), feed([item('b1', 50)], false)])
    expect(page.items.map((i) => i.id)).toEqual(['a1', 'b1'])
    expect(page.next).toBeNull()
  })

  it('a finished stream is not read again', () => {
    const page = mergeStreamPage([{ cursor: null, done: true }, top], [null, feed([item('b1', 50)], false)])
    expect(page.items.map((i) => i.id)).toEqual(['b1'])
    expect(page.next).toBeNull()
  })
})

describe('a team filter keeps the moves that NAME the team, not only the ones it started', () => {
  const trade: ActivityItem = {
    ...(item('t1', 45) as TransactionActivityItem),
    type: 'trade',
    team_id: 'A',
    payload: {
      proposer_team_id: 'A',
      recipient_team_id: 'B',
      players: [{ player_id: 'p', from_team_id: 'B', to_team_id: 'A' }],
      drops: [{ player_id: 'q', team_id: 'C' }],
    },
  }
  const commish: ActivityItem = { ...(item('c1', 44) as TransactionActivityItem), type: 'commissioner_move', team_id: null, payload: { from_team_id: 'D', to_team_id: 'E' } }

  it('reads every team id the stored move records', () => {
    expect([...involvedTeamIds(trade)].sort()).toEqual(['A', 'B', 'C'])
    expect([...involvedTeamIds(commish)].sort()).toEqual(['D', 'E'])
  })

  it('a received trade stays in the recipient’s list; a stream without parties keeps all', () => {
    expect(streamKeeps({ parties: ['B'] }, trade)).toBe(true)
    expect(streamKeeps({ parties: ['Z'] }, trade)).toBe(false)
    expect(streamKeeps({ teamId: 'A' }, trade)).toBe(true)
  })

  it('shows each kept item once; the cursors still follow everything read', () => {
    const page = mergeStreamPage(
      [top, top],
      [feed([item('a1', 55), trade], true), feed([trade, commish], true)],
      (i, s) => (s === 1 ? streamKeeps({ parties: ['B'] }, i) : true),
    )
    expect(page.items.map((i) => i.id)).toEqual(['a1', 't1'])
    expect(page.next?.[1]).toEqual({ cursor: { before: trade.created_at, beforeId: 't1' }, done: false })
  })
})
