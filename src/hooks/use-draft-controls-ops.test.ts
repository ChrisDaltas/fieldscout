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
  forcePickRequest,
  memberAutodraftRequest,
  movePlayerRequest,
  orderRequest,
  pauseResumeRequest,
  reassignRequest,
  resetRequest,
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

  it('order dispatch: the PATCH body always carries the reason (D114(3) — the signature makes it structural)', () => {
    const request = orderRequest(LG, ['t2', 't1'], '  seat swap fix  ')
    expect(request.path).toBe(`/api/leagues/${LG}/draft`)
    expect(request.body).toEqual({ order: ['t2', 't1'], reason: 'seat swap fix' })
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
