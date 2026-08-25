/**
 * Panel-action → route wiring pins (M2 task L.B3.3; spec §8.7 over the
 * L.B2.3 routes — D114's dispatch pipeline). Each §8.7 control maps to
 * exactly one path + body shape; the pins are the falsifiable half of "the
 * panel drives the real control surface": force-pick's REQUIRED wire-side
 * action_id (D114(4)), undo's R160 zero-is-legal full rewind, and the
 * post-start order dispatch's structural reason requirement (D114(3)).
 */

import { describe, expect, it } from 'vitest'

import {
  adjustBudgetRequest,
  cancelNominationRequest,
  endDraftRequest,
  forcePickRequest,
  memberAutodraftRequest,
  movePlayerRequest,
  orderRequest,
  pauseResumeRequest,
  reassignRequest,
  resetRequest,
  reverseWonBidRequest,
  setClockRequest,
  undoRequest,
} from './use-draft-controls-ops'

const LG = '00000000-0000-4000-8000-00000000lg01'
const D = '00000000-0000-4000-8000-00000000dd01'

describe('control request wiring (§8.7 → the L.B2.3 routes)', () => {
  it('pause/resume: ONE route, the verb in the body', () => {
    expect(pauseResumeRequest(LG, D, 'pause')).toEqual({
      path: `/api/leagues/${LG}/draft/pause`,
      body: { draft_id: D, action: 'pause' },
    })
    expect(pauseResumeRequest(LG, D, 'resume', 'court is back').body).toEqual({
      draft_id: D,
      action: 'resume',
      reason: 'court is back',
    })
  })

  it('clock edit: the dedicated verb (D114(2)); extend_current only when true', () => {
    expect(setClockRequest(LG, D, 90, false)).toEqual({
      path: `/api/leagues/${LG}/draft/clock`,
      body: { draft_id: D, pick_timer_seconds: 90 },
    })
    expect(setClockRequest(LG, D, 0, true).body).toEqual({
      draft_id: D,
      pick_timer_seconds: 0,
      extend_current: true,
    })
  })

  it('undo single omits to_pick_number; cascade carries it — and 0 (the R160 full rewind) is sent, not dropped', () => {
    expect(undoRequest(LG, D, null).body).toEqual({ draft_id: D })
    expect(undoRequest(LG, D, 3, 'wrong player storm').body).toEqual({
      draft_id: D,
      to_pick_number: 3,
      reason: 'wrong player storm',
    })
    // The R160 pin: 0 is a legal, DELIBERATE wire value (full rewind) — a
    // falsy-check regression would silently turn it into a single undo.
    expect(undoRequest(LG, D, 0).body).toEqual({ draft_id: D, to_pick_number: 0 })
  })

  it('reassign: pick_id + only the fields being corrected', () => {
    expect(reassignRequest(LG, D, 'p1', { teamId: 't2' }).body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      team_id: 't2',
    })
    expect(reassignRequest(LG, D, 'p1', { playerId: 'pl-9' }).body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      player_id: 'pl-9',
    })
  })

  it('force-pick CARRIES the caller-minted action_id (REQUIRED wire-side — D114(4)/D68(1))', () => {
    const request = forcePickRequest(LG, D, 'pl-1', 'aaaaaaaa-0000-4000-8000-000000000001')
    expect(request.path).toBe(`/api/leagues/${LG}/draft/force-pick`)
    expect(request.body).toEqual({
      draft_id: D,
      player_id: 'pl-1',
      action_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    })
  })

  it('move-player: player + both teams', () => {
    expect(movePlayerRequest(LG, D, 'pl-1', 't1', 't2').body).toEqual({
      draft_id: D,
      player_id: 'pl-1',
      from_team: 't1',
      to_team: 't2',
    })
  })

  it('reset targets the draft explicitly', () => {
    expect(resetRequest(LG, D).body).toEqual({ draft_id: D })
  })

  it('order dispatch: the PATCH body always carries the reason (D114(3)) AND the target draft (MS.7/D222 — the R468 mis-target was this one builder omitting draft_id)', () => {
    const request = orderRequest(LG, D, ['t2', 't1'], '  seat swap fix  ')
    expect(request.path).toBe(`/api/leagues/${LG}/draft`)
    expect(request.body).toEqual({ draft_id: D, order: ['t2', 't1'], reason: 'seat swap fix' })
  })

  it('member autodraft toggle: ONE verb in the body (the members-PATCH contract)', () => {
    expect(memberAutodraftRequest(LG, 'm1', true)).toEqual({
      path: `/api/leagues/${LG}/members/m1`,
      body: { is_autodraft: true },
    })
    expect(memberAutodraftRequest(LG, 'm1', false).body).toEqual({ is_autodraft: false })
  })

  it('a whitespace-only reason is dropped, never sent (the routes trim-validate min 1)', () => {
    expect(pauseResumeRequest(LG, D, 'pause', '   ').body).toEqual({
      draft_id: D,
      action: 'pause',
    })
  })
})

// ---------------------------------------------------------------------------
// L.C2.2 — the AUCTION commissioner verbs (§8.7's auction rows over the
// L.C2.2 routes; spec §15.2 via the C40 erratum; 087's priced/timer arms
// on the existing verbs).
// ---------------------------------------------------------------------------

describe('auction control request wiring (§8.7 auction rows → the L.C2.2 routes)', () => {
  it('reverse-bid: pick_id + the REQUIRED reason (trimmed) — Manual Edit Mode "Reset pick" (D142(a))', () => {
    expect(reverseWonBidRequest(LG, D, 'p1', '  mis-click on the award  ')).toEqual({
      path: `/api/leagues/${LG}/draft/reverse-bid`,
      body: { draft_id: D, pick_id: 'p1', reason: 'mis-click on the award' },
    })
  })

  it('budget: team_id + an integer delta + the REQUIRED action_id (099/AP.6 — E69/D68) + the REQUIRED reason; a negative delta is sent as-is (the RPC composes cumulatively)', () => {
    expect(adjustBudgetRequest(LG, D, 't2', -25, 'a0a0a0a0-0000-4000-8000-000000000001', 'typo at setup')).toEqual({
      path: `/api/leagues/${LG}/draft/budget`,
      body: {
        draft_id: D,
        team_id: 't2',
        delta: -25,
        action_id: 'a0a0a0a0-0000-4000-8000-000000000001',
        reason: 'typo at setup',
      },
    })
    // 0 is SENT, not dropped — the RPC's own 22023 refusal is the honest
    // answer and the builder must not mask it (a falsy-check regression).
    expect(adjustBudgetRequest(LG, D, 't2', 0, 'a0a0a0a0-0000-4000-8000-000000000002', 'oops').body).toEqual({
      draft_id: D,
      team_id: 't2',
      delta: 0,
      action_id: 'a0a0a0a0-0000-4000-8000-000000000002',
      reason: 'oops',
    })
  })

  it('cancel-nomination and end: draft + the REQUIRED reason, nothing else (D143 / C41 — no confirm phrase rides the wire)', () => {
    expect(cancelNominationRequest(LG, D, 'wrong player nominated')).toEqual({
      path: `/api/leagues/${LG}/draft/cancel-nomination`,
      body: { draft_id: D, reason: 'wrong player nominated' },
    })
    expect(endDraftRequest(LG, D, 'calling it at 2am')).toEqual({
      path: `/api/leagues/${LG}/draft/end`,
      body: { draft_id: D, reason: 'calling it at 2am' },
    })
  })

  it('the REQUIRED reason is structural: an empty/whitespace reason is SENT as "" so the route 400s (the orderRequest treatment), never silently dropped', () => {
    expect(reverseWonBidRequest(LG, D, 'p1', '   ').body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      reason: '',
    })
    expect(endDraftRequest(LG, D, '').body).toEqual({ draft_id: D, reason: '' })
  })

  it('reassign / move-player carry the auction price ONLY when given (087 priced arms — D142; snake bodies unchanged)', () => {
    expect(reassignRequest(LG, D, 'p1', { teamId: 't2', price: 40 }).body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      team_id: 't2',
      price: 40,
    })
    // A price-only correction is a legal body (the RPC's same-team arm).
    expect(reassignRequest(LG, D, 'p1', { price: 12 }).body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      price: 12,
    })
    expect(movePlayerRequest(LG, D, 'pl-1', 't1', 't2', 'swap', 30).body).toEqual({
      draft_id: D,
      player_id: 'pl-1',
      from_team: 't1',
      to_team: 't2',
      price: 30,
      reason: 'swap',
    })
    // $0 is a legal price (a league that allows $0 nominations — 092/AP.1)
    // — sent, not dropped.
    expect(movePlayerRequest(LG, D, 'pl-1', 't1', 't2', undefined, 0).body).toEqual({
      draft_id: D,
      player_id: 'pl-1',
      from_team: 't1',
      to_team: 't2',
      price: 0,
    })
    // The shipped snake shapes are byte-identical (no price key appears).
    expect(reassignRequest(LG, D, 'p1', { teamId: 't2' }).body).toEqual({
      draft_id: D,
      pick_id: 'p1',
      team_id: 't2',
    })
    expect(movePlayerRequest(LG, D, 'pl-1', 't1', 't2').body).toEqual({
      draft_id: D,
      player_id: 'pl-1',
      from_team: 't1',
      to_team: 't2',
    })
  })

  it('clock: the auction timers ride the SAME route; a null pick timer omits pick_timer_seconds (an auction has no pick clock); 0 timers are sent', () => {
    expect(
      setClockRequest(LG, D, null, false, 'faster bidding', {
        nominationSeconds: 60,
        bidSeconds: 25,
        antiSnipeSeconds: 0,
      }),
    ).toEqual({
      path: `/api/leagues/${LG}/draft/clock`,
      body: {
        draft_id: D,
        nomination_seconds: 60,
        bid_seconds: 25,
        anti_snipe_seconds: 0,
        reason: 'faster bidding',
      },
    })
    // One timer alone is a legal body (each omitted key = unchanged at the RPC).
    expect(setClockRequest(LG, D, null, false, undefined, { bidSeconds: 20 }).body).toEqual({
      draft_id: D,
      bid_seconds: 20,
    })
    // The shipped snake shape is byte-identical.
    expect(setClockRequest(LG, D, 90, false).body).toEqual({ draft_id: D, pick_timer_seconds: 90 })
  })
})
