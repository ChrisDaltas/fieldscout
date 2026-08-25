/**
 * Mock-launcher view pins (M2 task L.B3.5; spec §8.8 launch, §16.5.2 mock
 * workflow row — the cap messaging, §22.5 caps; D103/D110(6)). Golden values
 * are stored literals (tasks-M1 §4.3).
 */

import { describe, expect, it } from 'vitest'

import type { MockDraftSummary } from '@/hooks/use-mock-drafts'

import {
  defaultMockSeatId,
  leagueMockOpenBlocked,
  MOCK_REPORT_HIDDEN_NOTE,
  launchDisabledReason,
  MOCK_ACTIVE_CAP,
  MOCK_CAP_NOTE,
  MOCK_HOURLY_CAP,
  mockProgressLabel,
  mockSeatOptions,
} from './mock-launcher-ops'

// ---------------------------------------------------------------------------
// Caps (§22.5 — the printed numbers; the RPC enforces, the launcher informs)
// ---------------------------------------------------------------------------

describe('cap messaging (§16.5.2 "3-active cap message"; §22.5)', () => {
  it('the printed caps are 3 active / 5 per hour — the RPC’s numbers (071), mirrored for copy', () => {
    expect(MOCK_ACTIVE_CAP).toBe(3)
    expect(MOCK_HOURLY_CAP).toBe(5)
    expect(MOCK_CAP_NOTE).toBe(
      'Up to 3 practice drafts running at once, 5 launches per hour.',
    )
  })

  it('under the active cap the launch is offered (no client-side reason)', () => {
    expect(launchDisabledReason(0)).toBeNull()
    expect(launchDisabledReason(2)).toBeNull()
  })

  it('AT the active cap the launch disables with the 3-active message — honest BEFORE a refused round-trip (complete recaps never count: the caller passes active.length, live|paused only)', () => {
    expect(launchDisabledReason(3)).toBe(
      'You already have 3 practice drafts running — finish or delete one to start another.',
    )
    expect(launchDisabledReason(4)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Seat picker (§8.8: "their real seat by default (any seat selectable)")
// ---------------------------------------------------------------------------

const TEAMS = [
  { id: 't1', name: 'Alpha', status: 'active' },
  { id: 't2', name: 'Bravo', status: 'active' },
  { id: 't3', name: 'Retired FC', status: 'retired' },
  { id: 't4', name: 'Delta', status: 'active' },
]
const MEMBERS = [
  { user_id: 'u1', team_id: 't2' },
  { user_id: 'u2', team_id: 't4' },
  { user_id: 'u3', team_id: null },
]

describe('mockSeatOptions / defaultMockSeatId', () => {
  it('offers every NON-retired franchise (071’s exact filter — placeholders and other members’ franchises are legal seats, D103(2)) and flags the launcher’s own', () => {
    const options = mockSeatOptions(TEAMS, MEMBERS, 'u1')
    expect(options.map((o) => o.teamId)).toEqual(['t1', 't2', 't4'])
    expect(options.find((o) => o.teamId === 't2')?.isMine).toBe(true)
    expect(options.filter((o) => o.isMine)).toHaveLength(1)
  })

  it('defaults to the launcher’s REAL seat (§8.8)', () => {
    expect(defaultMockSeatId(mockSeatOptions(TEAMS, MEMBERS, 'u1'))).toBe('t2')
    expect(defaultMockSeatId(mockSeatOptions(TEAMS, MEMBERS, 'u2'))).toBe('t4')
  })

  it('a teamless member defaults to the first seat (they must still pick one — 071 refuses NULL for the teamless with its own message)', () => {
    expect(defaultMockSeatId(mockSeatOptions(TEAMS, MEMBERS, 'u3'))).toBe('t1')
    expect(defaultMockSeatId([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Resume-card labels (§16.5.2)
// ---------------------------------------------------------------------------

function mockRow(over: Partial<MockDraftSummary> = {}): MockDraftSummary {
  return {
    id: 'm1',
    league_id: 'l1',
    status: 'paused',
    draft_type: 'snake',
    created_at: '2026-08-13T00:00:00.000Z',
    started_at: '2026-08-13T00:00:00.000Z',
    completed_at: null,
    current_pick_number: 37,
    current_round: 4,
    total_rounds: 12,
    config: {},
    ...over,
  }
}

describe('mockProgressLabel', () => {
  it('a paused mock states its position against the full board (8 seats × 12 rounds = 96)', () => {
    expect(mockProgressLabel(mockRow(), 8)).toBe('Paused · pick 37 of 96')
  })

  it('a live mock leads Live; missing totals degrade honestly (never an invented denominator)', () => {
    expect(mockProgressLabel(mockRow({ status: 'live' }), 8)).toBe('Live · pick 37 of 96')
    expect(mockProgressLabel(mockRow({ total_rounds: null }), 8)).toBe('Paused · pick 37')
    expect(mockProgressLabel(mockRow(), null)).toBe('Paused · pick 37')
    expect(mockProgressLabel(mockRow({ current_pick_number: null }), 8)).toBe('Paused')
  })
})

describe('leagueMockOpenBlocked — the leagues ON / mockDrafts OFF cell (MP.8 / R540)', () => {
  // R515's defect in the MIRROR direction, and the one flag combination no
  // suite drove before this test existed: `/app/mocks/[id]/report` lives
  // inside the practice gate, so with practice OFF a finished league mock's
  // *View report* is a live control that silently bounces to `/app`.
  const row = (status: MockDraftSummary['status']) => ({ status })

  it('a FINISHED row is blocked, with a reason, when practice is OFF', () => {
    expect(leagueMockOpenBlocked(row('complete'), false)).toBe(MOCK_REPORT_HIDDEN_NOTE)
  })

  it('…and is NOT blocked when practice is on — the report renders', () => {
    expect(leagueMockOpenBlocked(row('complete'), true)).toBeNull()
  })

  it('an UNFINISHED row is never blocked by the PRACTICE flag, either way', () => {
    // Its *Rejoin* goes to `/app/leagues/…`, which this flag has nothing to
    // do with. Blocking it here would be the same lie one row over.
    for (const enabled of [true, false]) {
      expect(leagueMockOpenBlocked(row('live'), enabled)).toBeNull()
      expect(leagueMockOpenBlocked(row('paused'), enabled)).toBeNull()
    }
  })

  it('the reason says what is hidden, not what a mock draft is (§4 rule 16)', () => {
    expect(MOCK_REPORT_HIDDEN_NOTE).toBe('Practice drafts are hidden right now.')
  })
})
