/**
 * Doctrine pins for the draft-room realtime reducer (M2 task L.B3.1; spec
 * §9.3 — fetch-then-subscribe, state_version gap ⇒ refetch, broadcasts as
 * cache hints; tasks-M2 §4.5). These are the repo's first realtime-client
 * pins: every §9.3 client rule that is pure logic is falsifiable here
 * without a socket. Golden values are stored literals (tasks-M1 §4.3).
 */

import { describe, expect, it } from 'vitest'

import type { Draft } from '@/types/database'

import type { DraftPickSummary, DraftState } from './use-draft'
import {
  applyDraftRoomEvent,
  bestClockOffsetMs,
  computeClockOffsetMs,
  HEARTBEAT_SILENCE_MS,
  heartbeatSignalsGap,
  heartbeatSilenceExceeded,
  maxKnownPickNumber,
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

  it('ignores an EQUAL state_version (replayed broadcast)', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'drafts',
      operation: 'UPDATE',
      record: draftsRecord({ updated_at: '2026-08-13T00:00:30.000Z' }),
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
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
  it('league_chat is inert until L.B3.3 lands its consumer', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'league_chat',
      operation: 'INSERT',
      record: { id: 'c1', message: 'hi', is_system: false },
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
  })

  it('unknown events (additive surfaces) never refetch-loop an older client', () => {
    const state = baseState()
    const result = applyDraftRoomEvent(state, {
      event: 'draft_bids', // M3's — must be inert to this client
      operation: 'INSERT',
      record: { amount: 12 },
    })
    expect(result.refetch).toBe(false)
    expect(result.state).toBe(state)
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
