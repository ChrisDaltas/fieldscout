import { describe, expect, it } from 'vitest'

import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'

import type { FeedLine } from './activity-feed-ops'
import { mergeTransactions } from './team-transactions-ops'

function claim(id: string, created_at: string, status: WaiverClaimView['status'] = 'pending'): WaiverClaimView {
  return {
    id,
    team_id: 't',
    add: { player_id: `p-${id}`, full_name: `Player ${id}`, position: 'WR', nfl_team: 'AAA' },
    drop: null,
    faab_bid: 5,
    claim_order: 1,
    status,
    result_reason: null,
    process_at: null,
    processed_at: null,
    created_at,
    created_by: 'u',
    cancelled_at: null,
  }
}
function line(id: string, createdAt: string | null, kind: FeedLine['kind'] = 'transaction'): FeedLine {
  return { id, kind, text: 'added X', team: 'T', teamId: 't', week: 1, createdAt, commissioner: false, commishActionId: null, actorUsername: null }
}

describe('mergeTransactions — ONE feed, newest first (Chris 2026-10-04)', () => {
  it('claims and moves interleave by their own instants, newest at the top', () => {
    const merged = mergeTransactions(
      [claim('c1', '2026-10-02T12:00:00.000Z'), claim('c2', '2026-10-04T09:00:00.000Z')],
      [line('m1', '2026-10-03T12:00:00.000Z'), line('m2', '2026-10-01T12:00:00.000Z')],
    )
    expect(merged.map((e) => e.id)).toEqual(['claim:c2', 'move:m1', 'claim:c1', 'move:m2'])
  })
  it('only PENDING claims join (a claim that went through is already a move); system posts never join', () => {
    const merged = mergeTransactions(
      [claim('won', '2026-10-04T00:00:00.000Z', 'won'), claim('lost', '2026-10-04T00:00:00.000Z', 'lost'), claim('open', '2026-10-01T00:00:00.000Z')],
      [line('post', '2026-10-05T00:00:00.000Z', 'system')],
    )
    expect(merged.map((e) => e.id)).toEqual(['claim:open'])
  })
  it('an entry with no instant sorts last; equal instants keep claims first', () => {
    const at = '2026-10-03T00:00:00.000Z'
    expect(mergeTransactions([claim('c', at)], [line('none', null), line('m', at)]).map((e) => e.id)).toEqual(['claim:c', 'move:m', 'move:none'])
  })
})
