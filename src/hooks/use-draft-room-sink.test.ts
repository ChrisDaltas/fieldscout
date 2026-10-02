/**
 * The ROOM STATE's fetch window — F560 (PROGRESS D472; spec §9.3: "fetch
 * authoritative state … Each broadcast carries a monotonic `state_version`").
 *
 * The M6 gate's run at `e2e/auction-storm.spec.ts:399`, from the evidence:
 * the manager's refused mid-storm bid settled (onSettled ⇒ room refetch), the
 * refetch's SELECT read the HELD lot (`updated_at …19.871235`, deadline
 * 18:25:19.91), the award committed 7 ms later and its `drafts` broadcast
 * (`updated_at …19.982053`, the manager on the clock) was patched onto the
 * cache — and then the refetch RESOLVED and React Query REPLACED the cache
 * with its pre-award snapshot. The room rendered the sold lot again (trace:
 * 0:00 at the award, 1:58 two seconds later — the hold's deadline, back)
 * until a heartbeat could notice the gap. The room-state query was the one
 * cache on the `draft:<id>` channel R401 / F75 never put behind the sink.
 *
 * These pins drive a REAL `QueryClient` through `applyRoomBroadcast` and
 * `createRoomStateSink` — the exact pair `use-draft.ts` wires — with the real
 * room reducer. Against the pre-fix handler (patch straight onto the cache)
 * the window pins go RED (the §4.3 floor; shown in the PR).
 */

import { QueryClient } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { Draft } from '@/types/database'

import type { DraftState } from './use-draft'
import { applyDraftRoomEvent, type DraftRoomBroadcast } from './use-draft-ops'
import { applyRoomBroadcast, createRoomStateSink } from './use-draft-feed-sink'

// ---------------------------------------------------------------------------
// Rig — the gate's own instants, as stored literals
// ---------------------------------------------------------------------------

const DRAFT = '3d89120e-6816-4485-b617-fe7805e1929d'
const KEY = ['draft', DRAFT] as const
const COMMISH_TEAM = 'a4148ff0-b471-4382-81f7-f8682e12534a'
const MANAGER_TEAM = 'c394e17e-2eb7-4419-8ff8-1af3d8f82cbd'
const NOMINATION = { player_id: '9221', high_bid: 25 }

/** The held lot — what the refused bid's refetch read (the stored response). */
function heldLot(): DraftState {
  return {
    draft: {
      id: DRAFT,
      status: 'live',
      draft_type: 'auction',
      current_pick_number: 1,
      current_round: 1,
      on_clock_team_id: COMMISH_TEAM,
      current_deadline: '2026-10-02T18:25:19.91+00:00',
      paused_at: null,
      deadline_remaining_ms: null,
      updated_at: '2026-10-02T18:23:19.871235+00:00',
      current_nomination: NOMINATION,
      budget_adjustments: {},
    } as unknown as Draft,
    picks: [],
  }
}

/** The award's `drafts` broadcast (realtime.messages, 18:23:19.982). */
const award: DraftRoomBroadcast = {
  event: 'drafts',
  operation: 'UPDATE',
  record: {
    id: DRAFT,
    status: 'live',
    current_pick_number: 2,
    current_round: 1,
    on_clock_team_id: MANAGER_TEAM,
    current_deadline: '2026-10-02T18:24:19.982053+00:00',
    paused_at: null,
    deadline_remaining_ms: null,
    updated_at: '2026-10-02T18:23:19.982053+00:00',
    current_nomination: null,
    budget_adjustments: {},
  },
}

/** Its sibling pick INSERT (same txn). */
const awardPick: DraftRoomBroadcast = {
  event: 'draft_picks',
  operation: 'INSERT',
  record: {
    pick_number: 1,
    round: 1,
    team_id: 'bot-6-team',
    player_id: '9221',
    is_auto: false,
    is_undone: false,
    price: 25,
    made_via: 'auction',
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function rig(seed?: DraftState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed) client.setQueryData(KEY, seed)
  const sink = createRoomStateSink(client, KEY)
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  let refetches = 0
  const route = (broadcast: DraftRoomBroadcast) =>
    applyRoomBroadcast({
      queryClient: client,
      queryKey: KEY,
      sink,
      broadcast,
      refetch: () => {
        refetches += 1
      },
    })
  const startFetch = () => {
    const d = deferred<DraftState>()
    const done = client.fetchQuery({ queryKey: KEY, queryFn: () => d.promise, staleTime: 0 })
    return { ...d, done }
  }
  const state = () => client.getQueryData<DraftState>(KEY)
  return {
    client,
    sink,
    route,
    startFetch,
    state,
    refetches: () => refetches,
    /** Refetches the SINK requested (a reducer's doubt, or R1452's settle refetch). */
    sinkRefetches: () => invalidate.mock.calls.length,
  }
}

// ---------------------------------------------------------------------------
// 0. The mechanism (control) — why the window exists
// ---------------------------------------------------------------------------

describe('the mechanism (control): a patch made while the room fetch is in flight is REPLACED', () => {
  it('the pre-fix shape — apply straight onto the cache — loses the award to the stale resolve', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, heldLot())
    const d = deferred<DraftState>()
    const done = client.fetchQuery({ queryKey: KEY, queryFn: () => d.promise, staleTime: 0 })
    const current = client.getQueryData<DraftState>(KEY)!
    client.setQueryData(KEY, applyDraftRoomEvent(current, award).state)
    expect(client.getQueryData<DraftState>(KEY)!.draft!.on_clock_team_id).toBe(MANAGER_TEAM)
    d.resolve(heldLot())
    await done
    // …and the sold lot is back. This is F560's red, in miniature.
    expect(client.getQueryData<DraftState>(KEY)!.draft!.on_clock_team_id).toBe(COMMISH_TEAM)
  })
})

// ---------------------------------------------------------------------------
// 1. The window, closed
// ---------------------------------------------------------------------------

describe('F560: the room state survives a refetch that read the pre-award snapshot', () => {
  it('the award landing mid-fetch is held, then replayed onto the fetched state', async () => {
    const r = rig(heldLot())
    const f = r.startFetch()
    r.route(award)
    r.route(awardPick)
    // The drafts event is held behind the in-flight fetch; the pick event is
    // NOT (R1452 — unversioned, so not replayable) and asks for one refetch.
    expect(r.sink.held()).toBe(1)
    f.resolve(heldLot())
    await f.done
    await new Promise((res) => setTimeout(res, 0))
    const s = r.state()!
    expect(s.draft!.on_clock_team_id).toBe(MANAGER_TEAM)
    expect(s.draft!.current_nomination).toBeNull()
    expect(s.draft!.updated_at).toBe('2026-10-02T18:23:19.982053+00:00')
    expect(s.picks).toEqual([]) // the pick arrives with the follow-up refetch
    expect(r.sinkRefetches()).toBe(1) // ONE: the award's gap refetch covers the dropped pick
    expect(r.sink.held()).toBe(0)
  })

  it('a held event the fetched snapshot already POST-dates is ignored on replay (the version rule)', async () => {
    const r = rig(heldLot())
    const f = r.startFetch()
    // A stale hint — older than the snapshot the fetch will return.
    r.route({
      event: 'drafts',
      operation: 'UPDATE',
      record: { ...(award.record as object), updated_at: '2026-10-02T18:23:19.500000+00:00' },
    })
    const fetched = heldLot()
    fetched.draft = { ...fetched.draft!, updated_at: '2026-10-02T18:23:19.982053+00:00', on_clock_team_id: MANAGER_TEAM, current_nomination: null } as Draft
    f.resolve(fetched)
    await f.done
    await new Promise((res) => setTimeout(res, 0))
    expect(r.state()!.draft!.updated_at).toBe('2026-10-02T18:23:19.982053+00:00')
  })

  it('with no fetch in flight the event applies at once (the common path is unchanged)', () => {
    const r = rig(heldLot())
    r.route(award)
    expect(r.state()!.draft!.on_clock_team_id).toBe(MANAGER_TEAM)
    expect(r.sink.held()).toBe(0)
  })

  it('no cache and no fetch ⇒ fetch one (§9.3 baseline rule, unchanged); nothing is pushed', () => {
    const r = rig()
    r.route(award)
    expect(r.refetches()).toBe(1)
    expect(r.sink.held()).toBe(0)
  })

  it('no cache but the FIRST fetch in flight ⇒ held and applied onto its result (was: a redundant refetch)', async () => {
    const r = rig()
    const f = r.startFetch()
    r.route(award)
    expect(r.refetches()).toBe(0)
    expect(r.sink.held()).toBe(1)
    f.resolve(heldLot())
    await f.done
    await new Promise((res) => setTimeout(res, 0))
    expect(r.state()!.draft!.on_clock_team_id).toBe(MANAGER_TEAM)
  })
})

// ---------------------------------------------------------------------------
// 1b. Pick events are NOT replayed onto a fetched snapshot (R1452)
// ---------------------------------------------------------------------------

function pick(n: number, player: string, undone: boolean, op: 'INSERT' | 'UPDATE'): DraftRoomBroadcast {
  return {
    event: 'draft_picks',
    operation: op,
    record: {
      pick_number: n,
      round: 1,
      team_id: MANAGER_TEAM,
      player_id: player,
      is_auto: false,
      is_undone: undone,
      price: 10,
      made_via: 'auction',
    },
  }
}

function row(n: number, player: string, undone: boolean) {
  return {
    id: `row-${n}-${player}-${undone}`,
    pick_number: n,
    round: 1,
    team_id: MANAGER_TEAM,
    player_id: player,
    is_auto: false,
    is_undone: undone,
    price: 10,
    made_via: 'auction',
    created_at: '2026-10-02T18:23:20+00:00',
  }
}

function withPicks(picks: ReturnType<typeof row>[]): DraftState {
  return { ...heldLot(), picks } as unknown as DraftState
}

const settled = () => new Promise((res) => setTimeout(res, 0))

describe('R1452: a pick event held across a fetch never leaves a ghost', () => {
  it("the reviewer's probe: INSERT(#5 P live) + UPDATE(#5 P undone) mid-fetch, snapshot shows #5 P undone ⇒ no live ghost", async () => {
    const r = rig(withPicks([]))
    const f = r.startFetch()
    r.route(pick(5, 'P', false, 'INSERT'))
    r.route(pick(5, 'P', true, 'UPDATE'))
    f.resolve(withPicks([row(5, 'P', true)]))
    await f.done
    await settled()
    const live = r.state()!.picks.filter((p) => !p.is_undone)
    expect(live).toEqual([])
    expect(r.state()!.picks).toHaveLength(1)
    // …and exactly ONE follow-up refetch converges on server truth.
    expect(r.sinkRefetches()).toBe(1)
  })

  it('a settle with nothing dropped requests no refetch (no loop)', async () => {
    const r = rig(withPicks([]))
    const f = r.startFetch()
    // A drafts hint with no pick gap (so the reducer itself has no doubt).
    r.route({ ...award, record: { ...(award.record as object), current_pick_number: 1 } })
    f.resolve(heldLot())
    await f.done
    await settled()
    expect(r.state()!.draft!.on_clock_team_id).toBe(MANAGER_TEAM)
    expect(r.sinkRefetches()).toBe(0)
  })

  it('a RE-PICK after an undo (outside a fetch) appends the new live row beside the undone one', () => {
    const r = rig(withPicks([row(5, 'P', true)]))
    r.route(pick(5, 'Q', false, 'INSERT'))
    expect(r.state()!.picks.map((p) => [p.pick_number, p.player_id, p.is_undone])).toEqual([
      [5, 'P', true],
      [5, 'Q', false],
    ])
    // The SAME player re-picked at the same number is a new row too.
    const r2 = rig(withPicks([row(5, 'P', true)]))
    r2.route(pick(5, 'P', false, 'INSERT'))
    expect(r2.state()!.picks.filter((p) => !p.is_undone).map((p) => p.player_id)).toEqual(['P'])
    expect(r2.state()!.picks).toHaveLength(2)
  })

  it('the undo broadcast arriving just AFTER the fetch resolves applies at once onto the snapshot', async () => {
    const r = rig(withPicks([]))
    const f = r.startFetch()
    f.resolve(withPicks([row(5, 'P', false)]))
    await f.done
    await settled()
    r.route(pick(5, 'P', true, 'UPDATE'))
    expect(r.state()!.picks.map((p) => [p.player_id, p.is_undone])).toEqual([['P', true]])
    expect(r.sinkRefetches()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. The wiring (source pins — the behaviour above drives the same callables)
// ---------------------------------------------------------------------------

describe('use-draft.ts routes drafts / draft_picks through the room sink', () => {
  const source = readFileSync(path.resolve(__dirname, 'use-draft.ts'), 'utf8')
  const start = source.indexOf('const applyBroadcast = ')
  const handler = source.slice(start, source.indexOf('const scheduleReopen', start))

  it('the handler routes through applyRoomBroadcast with the room sink', () => {
    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('applyRoomBroadcast({')
    expect(handler).toContain('sink: roomSink,')
    expect(handler).toContain('queryKey: draftKeys.detail(draftId),')
  })

  it('the handler no longer writes the room cache itself (the pre-fix shape)', () => {
    expect(handler).not.toContain('setQueryData')
    expect(handler).not.toContain('applyDraftRoomEvent(')
  })

  it('the room sink is built over the room key and disposed with the channel', () => {
    expect(source).toContain('const roomSink = createRoomStateSink(queryClient, draftKeys.detail(draftId))')
    expect(source).toContain('roomSink.dispose()')
  })
})
