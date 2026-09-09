/**
 * Doctrine pins for the draft-room realtime reducer (M2 task L.B3.1; spec
 * §9.3 — fetch-then-subscribe, state_version gap ⇒ refetch, broadcasts as
 * cache hints; tasks-M2 §4.5). These are the repo's first realtime-client
 * pins: every §9.3 client rule that is pure logic is falsifiable here
 * without a socket. Golden values are stored literals (tasks-M1 §4.3).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Draft } from '@/types/database'

import type { DraftPickSummary, DraftState } from './use-draft'
import {
  applyDraftRoomEvent,
  bestClockOffsetMs,
  chatEventInvalidatesLeagueDetail,
  computeClockOffsetMs,
  connectionAfterJoinFailure,
  draftHasBeenFetched,
  FIRST_JOIN_FAILURES_FOR_BANNER,
  HEARTBEAT_SILENCE_MS,
  heartbeatSignalsGap,
  heartbeatSilenceExceeded,
  maxKnownPickNumber,
  presenceTeamForDraft,
  ROOM_WATCHDOG_MS,
  roomWatchdogWantsRefetch,
  type DraftsBroadcastRecord,
  type PickBroadcastRecord,
} from './use-draft-ops'

// ---------------------------------------------------------------------------
// Fixtures — a real-shaped 8-team live draft, 3 picks in
// ---------------------------------------------------------------------------

const T = (n: number) => `00000000-0000-4000-8000-00000000t${n}` // team ids (opaque strings to the reducer)

function draftRow(over: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    league_id: 'lg1',
    draft_type: 'snake',
    status: 'live',
    is_mock: false,
    config: {},
    draft_order: null,
    total_rounds: 15,
    current_pick_number: 4,
    current_round: 1,
    on_clock_team_id: T(4),
    current_deadline: '2026-08-13T00:01:00.000Z',
    deadline_remaining_ms: null,
    paused_at: null,
    started_at: '2026-08-13T00:00:00.000Z',
    completed_at: null,
    current_nomination: null,
    nomination_order: null,
    budget_adjustments: {},
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:30.000Z',
    ...over,
  } as Draft
}

function pick(n: number, playerId: string, over: Partial<DraftPickSummary> = {}): DraftPickSummary {
  return {
    id: `p${n}`,
    pick_number: n,
    round: 1,
    team_id: T(n),
    player_id: playerId,
    is_auto: false,
    is_undone: false,
    price: null, // 088/D134 — snake fixtures carry NULL (066's literal NULL)
    made_via: 'manual',
    created_at: '2026-08-13T00:00:10.000Z',
    ...over,
  }
}

function baseState(over: Partial<DraftState> = {}): DraftState {
  return {
    draft: draftRow(),
    picks: [pick(1, 'pl-a'), pick(2, 'pl-b'), pick(3, 'pl-c')],
    ...over,
  }
}

/** A drafts broadcast record advancing to pick 5 (a version bump). */
function draftsRecord(over: Partial<DraftsBroadcastRecord> = {}): DraftsBroadcastRecord {
  return {
    status: 'live',
    current_pick_number: 5,
    current_round: 1,
    on_clock_team_id: T(5),
    current_deadline: '2026-08-13T00:02:00.000Z',
    paused_at: null,
    deadline_remaining_ms: null,
    updated_at: '2026-08-13T00:00:45.000Z',
    ...over,
  }
}

function pickRecord(over: Partial<PickBroadcastRecord> = {}): PickBroadcastRecord {
  return {
    pick_number: 4,
    round: 1,
    team_id: T(4),
    player_id: 'pl-d',
    is_auto: false,
    is_undone: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// drafts events — state_version discipline (§9.3; updated_at = D92's version)
// ---------------------------------------------------------------------------

describe('applyDraftRoomEvent · drafts', () => {
  it('applies a newer state_version as a cache patch (no refetch when no gap)', () => {
    const state = baseState({ picks: [...baseState().picks, pick(4, 'pl-d')] })
    const result = applyDraftRoomEvent(state, { event: 'drafts', operation: 'UPDATE', record: draftsRecord() })
    expect(result.refetch).toBe(false)
    expect(result.state.draft?.current_pick_number).toBe(5)
    expect(result.state.draft?.on_clock_team_id).toBe(T(5))
    expect(result.state.draft?.current_deadline).toBe('2026-08-13T00:02:00.000Z')
    expect(result.state.draft?.updated_at).toBe('2026-08-13T00:00:45.000Z')
  })

  it('ignores a STALE state_version (older updated_at) — the newer state stays', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ updated_at: '2026-08-13T00:00:29.000Z', current_pick_number: 2 }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state) // same reference — nothing applied
  })

  // FLIPPED at L.C5.1 (was "ignores an EQUAL state_version"): one engine
  // transaction can UPDATE the drafts row twice with ONE now() — the
  // auction completion does (live/no-clock → complete, both at the same
  // updated_at, measured by the E2E's probe) — and dropping the equal
  // version wedged every auction room at completion forever. Equal
  // versions now APPLY in delivery order (realtime delivers a topic in
  // commit order, so last-write-wins IS the server's truth); a genuine
  // replay re-applies identical fields, which is a no-op by construction.
  it('applies an EQUAL state_version in delivery order (same-transaction pair — L.C5.1)', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({
        updated_at: '2026-08-13T00:00:30.000Z',
        status: 'complete',
        current_pick_number: 3, // no gap — the pair's second write, alone
      }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state.draft?.status).toBe('complete')
  })

  it('a replayed broadcast (equal version, identical fields) is a no-op copy', () => {
    const state = baseState({ picks: [...baseState().picks, pick(4, 'pl-d')] })
    const identical = draftsRecord()
    const once = applyDraftRoomEvent(state, { event: 'drafts', operation: 'UPDATE', record: identical })
    const twice = applyDraftRoomEvent(once.state, { event: 'drafts', operation: 'UPDATE', record: identical })
    expect(twice.refetch).toBe(false)
    expect(twice.state.draft).toEqual(once.state.draft)
  })

  // R565 (recorded at L.C5.1's review, taken at L.C6.1): the no-op above
  // used to mint a NEW state object per redelivery — one wasted render per
  // replay. An identical-field equal-version replay now short-circuits to
  // the SAME reference; a same-version event whose fields DIFFER (the
  // same-transaction pair the flip above exists for) must still apply.
  it('R565: an identical-field replay returns the SAME state reference', () => {
    const state = baseState({ picks: [...baseState().picks, pick(4, 'pl-d')] })
    const identical = draftsRecord()
    const once = applyDraftRoomEvent(state, { event: 'drafts', operation: 'UPDATE', record: identical })
    const twice = applyDraftRoomEvent(once.state, { event: 'drafts', operation: 'UPDATE', record: identical })
    expect(twice.state).toBe(once.state) // reference equality — zero re-render
    // The short-circuit must NOT swallow a same-version field change:
    const changed = applyDraftRoomEvent(once.state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ status: 'complete', current_pick_number: 5 }),
    })
    expect(changed.state).not.toBe(once.state)
    expect(changed.state.draft?.status).toBe('complete')
  })

  it('GAP ⇒ refetch: a drafts advance past picks we never received', () => {
    // We hold picks 1–3; the server says pick 6 is on the clock — picks 4–5
    // never arrived. The hint still applies (render freshest), but the
    // reducer demands a refetch (§9.3 gap ⇒ refetch).
    const result = applyDraftRoomEvent(baseState(), {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ current_pick_number: 6 }),
    })
    expect(result.refetch).toBe(true)
    expect(result.state.draft?.current_pick_number).toBe(6)
  })

  it('no gap at the exact boundary: current_pick_number == max known + 1', () => {
    // Picks 1–3 held; pick 4 on the clock is exactly the expected next.
    const result = applyDraftRoomEvent(baseState(), {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ current_pick_number: 4, updated_at: '2026-08-13T00:00:31.000Z' }),
    })
    expect(result.refetch).toBe(false)
  })

  it('refetches when there is no baseline draft to patch', () => {
    const result = applyDraftRoomEvent({ draft: null, picks: [] }, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord(),
    })
    expect(result.refetch).toBe(true)
  })

  it('an unparsable state_version is doubt ⇒ refetch, nothing applied', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ updated_at: 'not-a-timestamp' }),
    })
    expect(result.refetch).toBe(true)
    expect(result.state).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// draft_picks events — hint rows, replays, undo flips, gaps
// ---------------------------------------------------------------------------

describe('applyDraftRoomEvent · draft_picks INSERT', () => {
  it('appends the expected next pick as an id-less hint row, sorted', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'INSERT',
      record: pickRecord(),
    })
    expect(result.refetch).toBe(false)
    expect(result.state.picks.map((p) => p.pick_number)).toEqual([1, 2, 3, 4])
    const hint = result.state.picks[3]
    expect(hint.player_id).toBe('pl-d')
    expect(hint.id).toBeNull() // D109(2): broadcasts carry no id
  })

  it('GAP ⇒ refetch: a pick number that skips ahead means a missed INSERT', () => {
    // Picks 1–3 held; pick 5 arrives — pick 4 was lost. Hint applies, refetch demanded.
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'INSERT',
      record: pickRecord({ pick_number: 5, player_id: 'pl-e', team_id: T(5) }),
    })
    expect(result.refetch).toBe(true)
    expect(result.state.picks.map((p) => p.pick_number)).toEqual([1, 2, 3, 5])
  })

  it('ignores a replayed INSERT we already hold (no duplicate row)', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'draft_picks',
      operation: 'INSERT',
      record: pickRecord({ pick_number: 3, player_id: 'pl-c', team_id: T(3) }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
    expect(result.state.picks).toHaveLength(3)
  })

  it('a RE-PICK after an undo (number ≤ max known) is an append, never a gap', () => {
    // Pick 3 was undone; the re-pick arrives as a fresh INSERT reusing
    // pick_number 3 with a different player. Both rows coexist (§12.4 audit).
    const state = baseState({
      picks: [pick(1, 'pl-a'), pick(2, 'pl-b'), pick(3, 'pl-c', { is_undone: true })],
    })
    const result = applyDraftRoomEvent(state, {
      event: 'draft_picks',
      operation: 'INSERT',
      record: pickRecord({ pick_number: 3, player_id: 'pl-x', team_id: T(3) }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state.picks).toHaveLength(4)
    expect(
      result.state.picks.filter((p) => p.pick_number === 3).map((p) => [p.player_id, p.is_undone]),
    ).toEqual([
      ['pl-c', true],
      ['pl-x', false],
    ])
  })
})

describe('applyDraftRoomEvent · draft_picks UPDATE', () => {
  it('an undo flip patches the matching live row in place', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 3, player_id: 'pl-c', team_id: T(3), is_undone: true }),
    })
    expect(result.refetch).toBe(false)
    const row = result.state.picks.find((p) => p.pick_number === 3)
    expect(row?.is_undone).toBe(true)
    expect(row?.id).toBe('p3') // patched in place — the fetched id survives
  })

  it('an UPDATE for a row we never held is doubt ⇒ refetch', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 9, player_id: 'pl-z', is_undone: true }),
    })
    expect(result.refetch).toBe(true)
  })

  it('an UPDATE already reflected in the cache is an inert replay', () => {
    const state = baseState({
      picks: [pick(1, 'pl-a'), pick(2, 'pl-b'), pick(3, 'pl-c', { is_undone: true })],
    })
    const result = applyDraftRoomEvent(state, {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 3, player_id: 'pl-c', team_id: T(3), is_undone: true }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
  })

  it('an unknown operation on a rendered table is doubt ⇒ refetch', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'DELETE', // never emitted (append-only + soft undo) — doubt
      record: pickRecord(),
    })
    expect(result.refetch).toBe(true)
  })

  it('a commissioner reassign/move (team changes, undone-ness does not) patches the row — never a dropped event (R260)', () => {
    // 069's draft_reassign_pick / draft_move_player UPDATE team_id WITHOUT
    // touching is_undone; 070 broadcasts both as draft_picks UPDATE. The M2
    // batch-12 probe shape: cache holds pick 3 on T(3); the UPDATE arrives
    // with T(7). A (pick_number, player_id, is_undone) triple match is NOT
    // row identity — dropping this event left the board wrong for the rest
    // of the draft (§9.3 refetch-on-doubt, violated pre-fix).
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 3, player_id: 'pl-c', team_id: T(7), is_undone: false }),
    })
    expect(result.refetch).toBe(false)
    const row = result.state.picks.find((p) => p.pick_number === 3)
    expect(row?.team_id).toBe(T(7))
    expect(row?.is_undone).toBe(false)
    expect(row?.id).toBe('p3') // patched in place — the fetched id survives
  })

  it('a reassign that swapped the PLAYER has no (pick_number, player_id) row to patch ⇒ doubt ⇒ refetch (R260)', () => {
    // draft_reassign_pick can also change player_id; the cached row then
    // describes a player the draft no longer holds at that pick — only the
    // authoritative fetch can reconcile it.
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 3, player_id: 'pl-swapped', team_id: T(3), is_undone: false }),
    })
    expect(result.refetch).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Non-room events — deliberately inert
// ---------------------------------------------------------------------------

describe('applyDraftRoomEvent · other events', () => {
  it('league_chat is inert in the ROOM reducer — chat is not room state (its consumer is the chat cache reducer, L.B3.3)', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'league_chat',
      operation: 'INSERT',
      record: { id: 'c1', message: 'hi', is_system: false },
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
  })

  it('draft_bids is inert in the ROOM reducer — the bid FEED has its own cache reducer (use-draft-bids-ops.ts, the chat precedent; 088 banner item 6) — both operations, real 088 shapes', () => {
    const state = baseState()
    const insert = applyDraftRoomEvent(state, {
      event: 'draft_bids',
      operation: 'INSERT',
      record: {
        nomination_seq: 1, player_id: 'pl-x', team_id: T(1), amount: 12,
        created_at: '2026-08-13T00:00:50.000Z', voided_at: null,
      },
    })
    expect(insert.refetch).toBe(false)
    expect(insert.state).toBe(state)
    const voided = applyDraftRoomEvent(state, {
      event: 'draft_bids',
      operation: 'UPDATE',
      record: { voided_at: '2026-08-13T00:01:00.000Z', voided_count: 2, nominations: [{ nomination_seq: 1, player_id: 'pl-x' }] },
    })
    expect(voided.refetch).toBe(false)
    expect(voided.state).toBe(state)
  })

  it('L.C3.1: the AUCTION ROOM landing did not make the room reducer a bid consumer — the centrepiece rides the `drafts` event, not `draft_bids`', () => {
    // The room now RENDERS the auction (auction-block.tsx). Its high bid and
    // phase come from `current_nomination` on the `drafts` payload (D134),
    // and its ladder comes from the separate feed cache — so a bid event
    // must still leave room state byte-identical and ask for nothing. A
    // reducer that started patching `current_nomination` off a bid row
    // would be inventing state the server never sent.
    const state = baseState()
    const before = state.draft?.current_nomination
    const result = applyDraftRoomEvent(state, {
      event: 'draft_bids',
      operation: 'INSERT',
      record: {
        nomination_seq: 3, player_id: 'pl-live', team_id: T(2), amount: 41,
        created_at: '2026-08-13T00:02:00.000Z', voided_at: null,
      },
    })
    expect(result.state).toBe(state)
    expect(result.state.draft?.current_nomination).toBe(before)
    expect(result.refetch).toBe(false)
  })

  it('unknown events (additive surfaces) never refetch-loop an older client — the M2 pin, kept: a pre-088 client fed the literal event name stays inert', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'draft_bids', // M3's — inert to the M2-era reducer; still inert post-088 (the feed reducer owns it)
      operation: 'INSERT',
      record: { amount: 12 },
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
    const future = applyDraftRoomEvent(state, { event: 'some_future_table', operation: 'INSERT', record: {} })
    expect(future.refetch).toBe(false)
    expect(future.state).toBe(state)
  })

  it('a malformed record on a rendered table is doubt ⇒ refetch', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'INSERT',
      record: { nonsense: true },
    })
    expect(result.refetch).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 088/D134 — the auction keys on the drafts/draft_picks events, and the
// forward/backward compat claim made falsifiable in BOTH directions.
// tasks-M3 §2 called these "non-strict Zod parses" — they are plain
// interfaces + structural guards (corrected in use-draft-ops.ts' header);
// the property that matters is pinned here: additive keys never leak into
// the cache (named-field copy), missing keys never clobber it (presence-gated).
// ---------------------------------------------------------------------------

describe('088/D134 · drafts event carries current_nomination + budget_adjustments', () => {
  const nomination = { player_id: 'pl-x', high_bid: 7, high_bidder_team_id: T(2) }

  it('patches current_nomination (the room centerpiece) and budget_adjustments into the cached draft', () => {
    const state = baseState({ picks: [...baseState().picks, pick(4, 'pl-d')] })
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ current_nomination: nomination, budget_adjustments: { [T(2)]: 5 } }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state.draft?.current_nomination).toEqual(nomination)
    expect(result.state.draft?.budget_adjustments).toEqual({ [T(2)]: 5 })
  })

  it('a NULL current_nomination on the wire clears the cached one (the phase flip to nominating — D126; the cancel/award accompaniment)', () => {
    const state = baseState({
      draft: draftRow({ current_nomination: nomination }),
      picks: [...baseState().picks, pick(4, 'pl-d')],
    })
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ current_nomination: null, budget_adjustments: {} }),
    })
    expect(result.state.draft?.current_nomination).toBeNull()
  })

  it('BACKWARD compat: a pre-088 record (no D134 keys) patches the eight and leaves the cached auction pair UNTOUCHED — never clobbered with undefined/null', () => {
    const state = baseState({
      draft: draftRow({ current_nomination: nomination, budget_adjustments: { [T(3)]: -2 } }),
      picks: [...baseState().picks, pick(4, 'pl-d')],
    })
    const record = draftsRecord() // the 070 eight only
    expect('current_nomination' in record).toBe(false)
    const result = applyDraftRoomEvent(state, { event: 'drafts', operation: 'UPDATE', record })
    expect(result.state.draft?.current_pick_number).toBe(5)
    expect(result.state.draft?.current_nomination).toEqual(nomination)
    expect(result.state.draft?.budget_adjustments).toEqual({ [T(3)]: -2 })
  })

  it('FORWARD compat: additive unknown keys on the wire never leak into the cache (named-field copy — the corrected tasks-M3 §2 claim)', () => {
    const state = baseState({ picks: [...baseState().picks, pick(4, 'pl-d')] })
    const before = Object.keys(state.draft!).sort()
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: { ...draftsRecord(), some_future_key: 'x', another: 1 } as DraftsBroadcastRecord,
    })
    expect(Object.keys(result.state.draft!).sort()).toEqual(before)
    expect(result.state.draft).not.toHaveProperty('some_future_key')
  })
})

describe('088/D134 · draft_picks event carries price', () => {
  it('an INSERT hint carries the wire price (an auction award)', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'INSERT',
      record: pickRecord({ round: null, price: 17 }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state.picks.find((p) => p.pick_number === 4)?.price).toBe(17)
  })

  it('a pre-088 INSERT record (no price key) hints price NULL — and an unknown extra key never leaks into the hint row', () => {
    const result = applyDraftRoomEvent(baseState(), {
      event: 'draft_picks',
      operation: 'INSERT',
      record: { ...pickRecord(), extra_key: true } as PickBroadcastRecord,
    })
    const hint = result.state.picks.find((p) => p.pick_number === 4)!
    expect(hint.price).toBeNull()
    expect(hint).not.toHaveProperty('extra_key')
  })

  it('an UPDATE that changes ONLY the price (D142 priced move / reassign — 087) is APPLIED, never dropped as "already reflected"', () => {
    const state = baseState({ picks: [pick(1, 'pl-a', { round: null, price: 10 }), pick(2, 'pl-b'), pick(3, 'pl-c')] })
    const result = applyDraftRoomEvent(state, {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 1, round: null, team_id: T(1), player_id: 'pl-a', price: 14 }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state).not.toBe(state)
    expect(result.state.picks.find((p) => p.pick_number === 1)?.price).toBe(14)
  })

  it('an UPDATE already reflected INCLUDING price is an inert replay', () => {
    const state = baseState({ picks: [pick(1, 'pl-a', { round: null, price: 14 }), pick(2, 'pl-b'), pick(3, 'pl-c')] })
    const result = applyDraftRoomEvent(state, {
      event: 'draft_picks',
      operation: 'UPDATE',
      record: pickRecord({ pick_number: 1, round: null, team_id: T(1), player_id: 'pl-a', price: 14 }),
    })
    expect(result.state).toBe(state)
  })

  it('BACKWARD compat: a pre-088 UPDATE record (no price key) patches the six and leaves the cached price UNTOUCHED', () => {
    const state = baseState({ picks: [pick(1, 'pl-a', { round: null, price: 14 }), pick(2, 'pl-b'), pick(3, 'pl-c')] })
    const record = pickRecord({ pick_number: 1, round: null, team_id: T(1), player_id: 'pl-a', is_undone: true })
    expect('price' in record).toBe(false)
    const result = applyDraftRoomEvent(state, { event: 'draft_picks', operation: 'UPDATE', record })
    const row = result.state.picks.find((p) => p.pick_number === 1)!
    expect(row.is_undone).toBe(true)
    expect(row.price).toBe(14)
  })
})

// ---------------------------------------------------------------------------
// Heartbeat — offset + the missed-update detector (068 ARM 3; §9.3 correction)
// ---------------------------------------------------------------------------

describe('heartbeat', () => {
  it('bestClockOffsetMs: the windowed MAX — a delay-biased sample cannot drag the clock', () => {
    // A beat that sat queued through a reconnect reads ~40s LOW (delay only
    // subtracts — server_now is stamped at emit). The established offset wins.
    expect(bestClockOffsetMs([120, 95, -40_000])).toBe(120)
    expect(bestClockOffsetMs([-500, -350])).toBe(-350)
    expect(bestClockOffsetMs([])).toBeNull()
  })

  it('heartbeatSilenceExceeded: boundary at the stored 45s literal', () => {
    const t0 = Date.parse('2026-08-13T00:00:00.000Z')
    expect(HEARTBEAT_SILENCE_MS).toBe(45_000)
    expect(heartbeatSilenceExceeded(t0, t0 + 45_000)).toBe(false)
    expect(heartbeatSilenceExceeded(t0, t0 + 45_001)).toBe(true)
  })

  it('computeClockOffsetMs: server ahead of client ⇒ positive offset (stored literal)', () => {
    // Server 00:00:10.500, client sampled at 00:00:10.000 ⇒ +500ms.
    expect(
      computeClockOffsetMs('2026-08-13T00:00:10.500Z', Date.parse('2026-08-13T00:00:10.000Z')),
    ).toBe(500)
  })

  it('computeClockOffsetMs: client ahead ⇒ negative; malformed ⇒ null', () => {
    expect(
      computeClockOffsetMs('2026-08-13T00:00:09.000Z', Date.parse('2026-08-13T00:00:10.000Z')),
    ).toBe(-1000)
    expect(computeClockOffsetMs('garbage', 0)).toBeNull()
  })

  it('a heartbeat deadline matching ours signals no gap', () => {
    expect(
      heartbeatSignalsGap(baseState(), { current_deadline: '2026-08-13T00:01:00.000Z' }),
    ).toBe(false)
  })

  it('a heartbeat deadline we do not hold ⇒ gap (missed drafts UPDATE)', () => {
    expect(
      heartbeatSignalsGap(baseState(), { current_deadline: '2026-08-13T00:02:00.000Z' }),
    ).toBe(true)
  })

  it('a beat while we believe the draft paused (NULL deadline) ⇒ gap — the missed-resume recovery', () => {
    const paused = baseState({
      draft: draftRow({ status: 'paused', current_deadline: null, deadline_remaining_ms: 42_000 }),
    })
    expect(heartbeatSignalsGap(paused, { current_deadline: '2026-08-13T00:03:00.000Z' })).toBe(true)
  })

  it('both-null deadlines (untimed draft) agree — no gap', () => {
    const untimed = baseState({ draft: draftRow({ current_deadline: null }) })
    expect(heartbeatSignalsGap(untimed, { current_deadline: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The room watchdog — F56's gate half (the pre-start reconcile)
// ---------------------------------------------------------------------------

describe('roomWatchdogWantsRefetch (F56)', () => {
  const t0 = Date.parse('2026-08-13T00:00:00.000Z')

  it('the cadence is the stored 5s literal — D94\u2019s own number for this flip', () => {
    expect(ROOM_WATCHDOG_MS).toBe(5_000)
  })

  it('SCHEDULED asks on every beat — a scheduled draft emits NO beats, so silence proves nothing', () => {
    // The F56 shape: the room believes the draft has not started, the only
    // thing that can tell it otherwise is one broadcast, and that broadcast
    // can be lost (D109(9)/F74). The room must ASK — including on the very
    // first beat, with no beat ever received.
    expect(roomWatchdogWantsRefetch({ status: 'scheduled', lastBeatAtMs: null, nowMs: t0 })).toBe(
      true,
    )
    expect(
      roomWatchdogWantsRefetch({ status: 'scheduled', lastBeatAtMs: t0, nowMs: t0 + 1 }),
    ).toBe(true)
  })

  it('LIVE keeps the silence rule EXACTLY — boundary at the stored 45s literal', () => {
    expect(
      roomWatchdogWantsRefetch({ status: 'live', lastBeatAtMs: t0, nowMs: t0 + HEARTBEAT_SILENCE_MS }),
    ).toBe(false)
    expect(
      roomWatchdogWantsRefetch({
        status: 'live',
        lastBeatAtMs: t0,
        nowMs: t0 + HEARTBEAT_SILENCE_MS + 1,
      }),
    ).toBe(true)
  })

  it('LIVE with no beat yet never fires — the join has not had its first beat', () => {
    expect(
      roomWatchdogWantsRefetch({ status: 'live', lastBeatAtMs: null, nowMs: t0 + 600_000 }),
    ).toBe(false)
  })

  it('every other status is inert — paused, complete, and no draft at all', () => {
    for (const status of ['paused', 'complete', null, undefined]) {
      expect(
        roomWatchdogWantsRefetch({ status, lastBeatAtMs: t0, nowMs: t0 + 600_000 }),
        `status ${String(status)}`,
      ).toBe(false)
    }
  })
})

describe('use-draft.ts drives its watchdog from the rule — source pin (F56)', () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft.ts'), 'utf8')
  /** The watchdog interval body: from `const silenceTimer` to its cadence. */
  const start = source.indexOf('const silenceTimer = setInterval(')
  const body = source.slice(start, source.indexOf('}, ROOM_WATCHDOG_MS)', start))

  it('the watchdog exists and asks the pure rule', () => {
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain('roomWatchdogWantsRefetch({')
    expect(source).toContain('}, ROOM_WATCHDOG_MS)')
  })

  it('the pre-fix inline condition is GONE — no re-declared status/silence test in the effect', () => {
    // The bug this pin protects: the watchdog\u2019s condition was inline and
    // gated on `status === 'live'`, which is why the SCHEDULED room had no
    // reconciliation at all. If someone re-inlines it, this reddens.
    expect(body).not.toContain("=== 'live'")
    expect(body).not.toContain('heartbeatSilenceExceeded(')
  })

  it('the cadence is the named constant, not a re-typed literal', () => {
    expect(source).not.toContain('}, 5_000)')
  })
})

// ---------------------------------------------------------------------------
// R943 — a failed beat must not disarm the NEXT beat (PR #279 fix round)
// ---------------------------------------------------------------------------

describe('draftHasBeenFetched — the §9.3 fetch-then-subscribe gate (R943)', () => {
  it('a FAILED refetch over a cache that still holds the row keeps the gate OPEN', () => {
    // The whole of R943 in one line. React Query's reducer sets
    // `status: 'error'` unconditionally and RETAINS `data`, so this is
    // exactly the state one failed beat produces. `query.isSuccess` alone
    // answered `false` here — and that false re-ran the channel effect into
    // its guard, whose cleanup cleared the watchdog interval AND removed the
    // channel, with nothing left alive to ask again.
    expect(draftHasBeenFetched({ isSuccess: false, hasData: true })).toBe(true)
  })

  it('a healthy query is open, and a room holding NOTHING is still closed', () => {
    expect(draftHasBeenFetched({ isSuccess: true, hasData: true })).toBe(true)
    // Fetch-then-subscribe is not weakened: with no row in hand the channel
    // still must not open (§9.3). A mount whose FIRST fetch fails renders
    // `DraftRoomProblem` with a retry — honest, and not this bug's shape.
    expect(draftHasBeenFetched({ isSuccess: false, hasData: false })).toBe(false)
    expect(draftHasBeenFetched({ isSuccess: true, hasData: false })).toBe(true)
  })
})

describe('a failed beat does not disarm the next beat (R943 — effect lifecycle)', () => {
  /**
   * A minimal `useEffect` driver: shallow-compare the dep array, and on a
   * change run the previous cleanup and then the effect. That is the ONLY
   * React semantic this bug turns on, and it is modelled here rather than
   * rendered because the repo carries no DOM test environment.
   *
   * What keeps this honest: the driver runs the REAL predicate for the arm
   * that matters, and the second arm re-states the PRE-FIX expression
   * (`query.isSuccess`) literally, so the file demonstrates both directions.
   * The source pins below hold the driver to the shipped effect's shape, and
   * the browser measurement is in D333(8).
   */
  function driveWatchdog(fetchedOf: (q: { isSuccess: boolean; hasData: boolean }) => boolean) {
    let cleanup: (() => void) | null = null
    let lastDeps: readonly unknown[] | null = null
    let intervalAlive = false
    let beatsIssued = 0
    const events: string[] = []

    const runEffect = (deps: readonly unknown[]) => {
      if (lastDeps && lastDeps.length === deps.length && lastDeps.every((d, i) => d === deps[i])) {
        return
      }
      if (cleanup) cleanup()
      lastDeps = deps
      const [draftId, fetched] = deps as [string | undefined, boolean]
      if (!draftId || !fetched) {
        cleanup = null
        return
      }
      intervalAlive = true
      events.push('armed')
      cleanup = () => {
        intervalAlive = false
        events.push('clearInterval + removeChannel')
      }
    }
    const beat = () => {
      if (!intervalAlive) return
      beatsIssued += 1
      events.push(`beat#${beatsIssued}`)
    }
    const render = (q: { isSuccess: boolean; hasData: boolean }) =>
      runEffect(['draft-1', fetchedOf(q)])

    return { render, beat, events, beats: () => beatsIssued }
  }

  /** The exact render sequence the browser produces: first fetch lands, a
   *  beat fires, that beat's fetch (and its single retry) fail, and then
   *  connectivity is restored with the cache still holding the row. */
  function outage(driver: ReturnType<typeof driveWatchdog>) {
    driver.render({ isSuccess: true, hasData: true }) // first fetch landed
    driver.beat() // beat #1 — issues the refetch that will fail
    driver.render({ isSuccess: false, hasData: true }) // it failed; data retained
    driver.beat() // beat #2 — 5s later, connectivity is back
  }

  it('the SHIPPED gate: the interval survives the failed beat and beat #2 fires', () => {
    const driver = driveWatchdog(draftHasBeenFetched)
    outage(driver)
    expect(driver.beats()).toBe(2)
    expect(driver.events).toEqual(['armed', 'beat#1', 'beat#2'])
    expect(driver.events).not.toContain('clearInterval + removeChannel')
  })

  it('the PRE-FIX gate (`query.isSuccess`) disarms itself — beat #2 never fires', () => {
    const driver = driveWatchdog((q) => q.isSuccess)
    outage(driver)
    expect(driver.beats()).toBe(1)
    expect(driver.events).toEqual(['armed', 'beat#1', 'clearInterval + removeChannel'])
  })
})

describe('use-draft.ts asks the right gate question — source pin (R943)', () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft.ts'), 'utf8')

  it('the gate is the pure predicate, and the bare `query.isSuccess` is GONE', () => {
    expect(source).toContain('const fetched = draftHasBeenFetched({')
    expect(source).not.toContain('const fetched = query.isSuccess')
  })

  it('the gate still reads BOTH halves — success OR a row already in hand', () => {
    const start = source.indexOf('const fetched = draftHasBeenFetched({')
    const gate = source.slice(start, source.indexOf('})', start))
    expect(gate).toContain('isSuccess: query.isSuccess')
    expect(gate).toContain('hasData: query.data !== undefined')
  })

  it('the effect the driver models is still the shape it models', () => {
    // `fetched` gates the channel effect, whose cleanup clears the watchdog
    // interval and removes the channel — the chain R943 broke. If any link
    // moves, the driver above stops standing for anything and this reddens.
    expect(source).toContain('if (!draftId || !fetched) return')
    expect(source).toContain('clearInterval(silenceTimer)')
    expect(source).toContain('if (channel) void supabase.removeChannel(channel)')
    expect(source).toContain('}, [draftId, fetched, presenceTeamId, presenceUserId, queryClient])')
  })
})

// ---------------------------------------------------------------------------
// Connection honesty — the R263 mount-during-outage shape (M2 batch 12)
// ---------------------------------------------------------------------------

describe('connectionAfterJoinFailure (R263)', () => {
  it('the mount-during-outage shape: 1st failed FIRST join stays connecting (the backoff retry may heal a boot race invisibly); the 2nd surfaces the reconnecting banner', () => {
    expect(FIRST_JOIN_FAILURES_FOR_BANNER).toBe(2) // the recorded N
    expect(connectionAfterJoinFailure(false, 1)).toBe('connecting')
    expect(connectionAfterJoinFailure(false, 2)).toBe('reconnecting')
    // The outage persists — the banner stays.
    expect(connectionAfterJoinFailure(false, 3)).toBe('reconnecting')
  })

  it('an ever-subscribed room is reconnecting on ANY failure (the L.B3.1 behavior, unchanged)', () => {
    expect(connectionAfterJoinFailure(true, 1)).toBe('reconnecting')
  })

  it('a successful join resets the count — the next single failure is connecting again only if never subscribed', () => {
    // The hook zeroes failedJoins on SUBSCRIBED; everSubscribed also flips
    // true there, so post-success failures always take the reconnecting arm.
    // This pin documents the pure function's half of that contract: with the
    // count reset and everSubscribed true, one failure ⇒ 'reconnecting'.
    expect(connectionAfterJoinFailure(true, 0)).toBe('reconnecting')
  })
})

// ---------------------------------------------------------------------------
// maxKnownPickNumber
// ---------------------------------------------------------------------------

describe('maxKnownPickNumber', () => {
  it('counts undone rows (re-picks reuse numbers ≤ max — never a gap)', () => {
    expect(
      maxKnownPickNumber([pick(1, 'a'), pick(2, 'b', { is_undone: true }), pick(3, 'c')]),
    ).toBe(3)
    expect(maxKnownPickNumber([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Presence seat resolution — the R264 mock shape (M2 batch 12 → L.B3.5)
// ---------------------------------------------------------------------------

describe('presenceTeamForDraft (R264)', () => {
  const MOCK = draftRow({
    is_mock: true,
    config: { mock: { human_team_id: T(3), launched_by: 'u-launcher', cpu_speed: 'fast' } },
  })

  it('a REAL draft tracks the viewer’s own franchise (unchanged)', () => {
    expect(presenceTeamForDraft(draftRow(), T(2), 'u-any')).toBe(T(2))
    expect(presenceTeamForDraft(draftRow(), null, 'u-any')).toBeNull()
  })

  it('in a MOCK the launcher tracks the HUMAN seat, never their real franchise — the R264 probe: launcher seated at T(1), human seat T(3) ⇒ presence keys T(3)', () => {
    expect(presenceTeamForDraft(MOCK, T(1), 'u-launcher')).toBe(T(3))
  })

  it('a non-launcher viewer in a mock tracks NO seat (spectator — D103(2); their real franchise chip must not light up in a practice room)', () => {
    expect(presenceTeamForDraft(MOCK, T(2), 'u-other')).toBeNull()
    expect(presenceTeamForDraft(MOCK, T(2), null)).toBeNull()
  })

  it('a malformed mock config tracks no seat (never a guessed one)', () => {
    expect(presenceTeamForDraft(draftRow({ is_mock: true, config: {} }), T(1), 'u-launcher')).toBeNull()
    expect(presenceTeamForDraft(draftRow({ is_mock: true, config: null }), T(1), 'u-launcher')).toBeNull()
  })

  it('a null draft (pre-fetch) falls back to the member team — fetch-then-subscribe means this arm is never the one that tracks', () => {
    expect(presenceTeamForDraft(null, T(2), 'u-any')).toBe(T(2))
  })
})

// ---------------------------------------------------------------------------
// League-detail staleness on system posts — R271 (M2 batch 14 → L.B3.5)
// ---------------------------------------------------------------------------

describe('chatEventInvalidatesLeagueDetail (R271)', () => {
  it('a SYSTEM post invalidates league detail (the "a commissioner action landed" signal — the §16.5.4 Auto badge reads league_members, which 072 broadcasts nowhere)', () => {
    expect(chatEventInvalidatesLeagueDetail({ is_system: true })).toBe(true)
  })

  it('ordinary member chatter never invalidates anything (a chat burst must not hammer the league detail)', () => {
    expect(chatEventInvalidatesLeagueDetail({ is_system: false })).toBe(false)
    expect(chatEventInvalidatesLeagueDetail({ is_system: null })).toBe(false)
  })
})
