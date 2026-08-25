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
  mockIdentityLabel,
  mockProgressLabel,
  mockSeatOptions,
  drawnOrderSlotReason,
  mockSlotOptions,
  RANDOM_SLOT,
  slotFromPickerValue,
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

describe('mockIdentityLabel — MP.10: a list of identical rows is not a list', () => {
  // The defect this exists for, measured on the local stack: three rows at
  // the §22.5 cap all read "Practice draft", two of them "Live · pick 1 of
  // 16". Nothing separated the 12-team snake from the 8-team auction.
  it('names the format and the size, from data already on the row', () => {
    expect(mockIdentityLabel({ draft_type: 'auction' }, 8)).toBe('Auction · 8 teams')
    expect(mockIdentityLabel({ draft_type: 'snake' }, 12)).toBe('Snake · 12 teams')
    expect(mockIdentityLabel({ draft_type: 'linear' }, 10)).toBe('Linear · 10 teams')
  })

  it('with no derivable seat count it prints the format alone — never an invented total', () => {
    // A LEAGUE-attached row hands `mockSeatCount` a null, exactly as
    // `mockProgressLabel` receives it, and answers the same way.
    expect(mockIdentityLabel({ draft_type: 'auction' }, null)).toBe('Auction')
    expect(mockIdentityLabel({ draft_type: 'snake' }, 0)).toBe('Snake')
  })

  it('an unrecognised draft type falls back to the NOUN — a raw enum never reaches a user', () => {
    // The size half is still true and still useful, so it stays; what must
    // never render is `salary_cap` itself.
    expect(mockIdentityLabel({ draft_type: 'salary_cap' }, 8)).toBe('Practice draft · 8 teams')
    expect(mockIdentityLabel({ draft_type: '' }, null)).toBe('Practice draft')
  })
})

describe('MS.8 — the slot picker (D223/E77): options, wire value, drawn-order reason', () => {
  it('offers Random first, then 1st..Nth — one option per seat, none past the board', () => {
    const options = mockSlotOptions(8)
    expect(options).toHaveLength(9)
    expect(options[0]).toEqual({ value: RANDOM_SLOT, label: 'Random' })
    expect(options[1]).toEqual({ value: '1', label: '1st' })
    expect(options[8]).toEqual({ value: '8', label: '8th' })
  })

  it('English ordinals hold through the v1 ceiling — 11th/12th/13th are not 11st/12nd/13rd', () => {
    const labels = mockSlotOptions(16).map((o) => o.label)
    expect(labels.slice(1)).toEqual([
      '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th',
      '9th', '10th', '11th', '12th', '13th', '14th', '15th', '16th',
    ])
  })

  it('Random maps to undefined on the wire — the key is OMITTED so the RPC default (NULL = the pre-MS.8 shuffle) runs', () => {
    expect(slotFromPickerValue(RANDOM_SLOT)).toBeUndefined()
    expect(slotFromPickerValue('3')).toBe(3)
  })

  it('a drawn manual/custom order disables the picker with the inheritance reason (§8.8 fidelity)', () => {
    const order = Array.from({ length: 8 }, (_, i) => `t${i}`)
    for (const mode of ['manual', 'custom']) {
      expect(
        drawnOrderSlotReason({
          team_count: 8,
          draft: { draft_order_mode: mode, draft_order: order },
        }),
      ).toBe(
        'This league’s draft order is already set — your practice draft inherits it, your actual slot included.',
      )
    }
  })

  it('random mode, a missing order, or a partial order leaves the choice live — the normal preseason case', () => {
    const order = Array.from({ length: 8 }, (_, i) => `t${i}`)
    // random mode: the mode whose stored settings field the resolver ignores
    // (R123/R126) — no reason, whatever the field holds.
    expect(
      drawnOrderSlotReason({ team_count: 8, draft: { draft_order_mode: 'random', draft_order: order } }),
    ).toBeNull()
    // manual but nothing stored, or stored short of the board: the server
    // would refuse the launch on its own terms; the slot is not the blocker.
    expect(
      drawnOrderSlotReason({ team_count: 8, draft: { draft_order_mode: 'manual', draft_order: null } }),
    ).toBeNull()
    expect(
      drawnOrderSlotReason({
        team_count: 8,
        draft: { draft_order_mode: 'manual', draft_order: order.slice(0, 7) },
      }),
    ).toBeNull()
  })
})
