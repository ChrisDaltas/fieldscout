/**
 * score-week-invoker.test.ts — the PURE half of the score-week wiring
 * (L.D2.3; spec §14 / §22.3 / §24.1; PROGRESS F263(f), R873 / R874 / R875;
 * D322). The loop runs over a fake drain and a fake `sleep` on a
 * VirtualClock; the classifier is pinned on hand-built reports.
 */
import { describe, expect, it } from 'vitest'

import { VirtualClock } from '../time/virtual-clock'
import {
  classifyDrain,
  CLOCK_SKEW_SECONDS,
  DRAIN_INTERVAL_MS,
  runScoreWeekInvocation,
  SCORE_WEEK_BUDGET_MS,
  SCORE_WEEK_LEASE_SECONDS,
  SCORE_WEEK_MAX_DURATION_SECONDS,
} from './score-week-invoker'
import type { BatchReport, LeagueWeekReport } from './score-week-worker'

function report(over: Partial<BatchReport> = {}): BatchReport {
  return {
    ran_at: '2099-09-13T20:00:00.000Z',
    claim_token: null,
    claimed: 0,
    more: false,
    not_ready: 0,
    unmapped: 0,
    out_of_scope: 0,
    held: 0,
    deferred: 0,
    drained: 0,
    released: 0,
    ack_missed: { restamped: 0, lease_lost: 0, gone: 0 },
    leagues: [],
    written: 0,
    no_change: 0,
    nothing_writable: 0,
    skipped: 0,
    failed: 0,
    problems: [],
    reason: null,
    ...over,
  }
}

function entry(over: Partial<LeagueWeekReport>): LeagueWeekReport {
  return {
    league_id: 'L1',
    season: 2099,
    week: 1,
    mode: 'h2h',
    outcome: 'written',
    mapped_player_ids: [],
    affected_team_ids: [],
    provisional_team_ids: [],
    bench_player_ids: [],
    commish_edited_team_ids: [],
    teams: [],
    pending_kept_provisional: [],
    problems: [],
    ...over,
  }
}

describe('the lease precondition (F263(f) / R874) — the constants the route pins', () => {
  it('lease ≥ maxDuration + clock skew, and the budget sits below maxDuration', () => {
    expect(SCORE_WEEK_LEASE_SECONDS).toBeGreaterThanOrEqual(SCORE_WEEK_MAX_DURATION_SECONDS + CLOCK_SKEW_SECONDS)
    expect(SCORE_WEEK_BUDGET_MS).toBeLessThan(SCORE_WEEK_MAX_DURATION_SECONDS * 1000)
    // The literal pair on the record: 120 ≥ 60 + 30.
    expect([SCORE_WEEK_LEASE_SECONDS, SCORE_WEEK_MAX_DURATION_SECONDS, CLOCK_SKEW_SECONDS]).toEqual([120, 60, 30])
  })
})

describe('classifyDrain — the loud surface', () => {
  it('lease_lost + gone > 0 is ONE alert on the SUM (R873); lease_lost alone and gone alone each alert', () => {
    expect(classifyDrain(report({ ack_missed: { restamped: 0, lease_lost: 1, gone: 2 } })).alerts).toEqual([expect.stringMatching(/^STALE-WRITE WINDOW: lease_lost 1 \+ gone 2 = 3 row/)])
    expect(classifyDrain(report({ ack_missed: { restamped: 0, lease_lost: 0, gone: 1 } })).alerts).toHaveLength(1)
    expect(classifyDrain(report({ ack_missed: { restamped: 0, lease_lost: 1, gone: 0 } })).alerts).toHaveLength(1)
    expect(classifyDrain(report({ ack_missed: { restamped: 3, lease_lost: 0, gone: 0 } })).alerts).toEqual([])
  })

  it('a re-stamp is informational (D321(2)); all_leased / all_deferred are informational (R875 / R872); a deferral is informational', () => {
    const v = classifyDrain(report({ ack_missed: { restamped: 2, lease_lost: 0, gone: 0 }, reason: 'all_leased', deferred: 3 }))
    expect(v.alerts).toEqual([])
    expect(v.infos).toEqual([
      'drain claimed nothing: all_leased (R875 — informational)',
      '2 row(s) re-stamped mid-drain — released; the next drain scores the newer line (D321(2))',
      '3 held row(s) deferred (R872)',
    ])
    expect(classifyDrain(report({ reason: 'all_deferred' })).infos).toEqual(['drain claimed nothing: all_deferred (R875 — informational)'])
    expect(classifyDrain(report({ reason: 'queue_empty' })).infos).toEqual([])
  })

  it('a quarantined league-week and a nothing_writable week ALERT with league_id; held / skipped are infos', () => {
    const v = classifyDrain(
      report({
        leagues: [
          entry({ league_id: 'L3', outcome: 'failed', error: 'snapshot_corrupt: Bounds … pass_yards' }),
          entry({ league_id: 'L1', outcome: 'nothing_writable' }),
          entry({ league_id: 'L2', outcome: 'held', skip_reason: 'week_not_open' }),
          entry({ league_id: 'L4', outcome: 'skipped', skip_reason: 'week_final' }),
          entry({ league_id: 'L5', outcome: 'no_change' }),
        ],
      }),
    )
    expect(v.alerts).toEqual([
      'league_id=L3 week=1 QUARANTINED: snapshot_corrupt: Bounds … pass_yards (D292 — nothing written for it)',
      'league_id=L1 week=1 the door wrote NOTHING where a score was expected (F259(e))',
    ])
    expect(v.infos).toEqual(['league_id=L2 week=1 held: week_not_open', 'league_id=L4 week=1 skipped: week_final'])
  })
})

describe('runScoreWeekInvocation — the minute-invocation loop', () => {
  function harness(drains: BatchReport[], hot: boolean) {
    const clock = new VirtualClock(new Date('2099-09-13T20:00:00.000Z'))
    const calls: string[] = []
    const sleeps: number[] = []
    let i = 0
    const promise = runScoreWeekInvocation({
      db: {} as never,
      time: clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock.advanceBy(ms)
      },
      lastPollCompletedAt: async () => null,
      isHot: async () => hot,
      drain: async (_deps, opts) => {
        calls.push(`${opts?.leaseSeconds}/${opts?.batchSize}/${opts?.deferSeconds}`)
        const r = drains[Math.min(i, drains.length - 1)]
        i += 1
        clock.advanceBy(1_000) // a drain takes a second
        return r
      },
    })
    return { promise, calls, sleeps }
  }

  it('an empty queue outside a game window ends the invocation after ONE drain — one claim RPC per idle minute', async () => {
    const h = harness([report({ reason: 'queue_empty' })], false)
    const out = await h.promise
    expect(out.drains).toHaveLength(1)
    expect(out.stopped).toBe('queue_empty_idle')
    expect(h.sleeps).toEqual([])
    expect(h.calls).toEqual([`${SCORE_WEEK_LEASE_SECONDS}/500/30`]) // the lease + batch + defer the route passes
  })

  it('an empty queue INSIDE a game window keeps draining every 5 s for the budget (§14: 5–10 s)', async () => {
    const h = harness([report({ reason: 'queue_empty' })], true)
    const out = await h.promise
    expect(out.stopped).toBe('budget')
    expect(h.sleeps.every((ms) => ms === DRAIN_INTERVAL_MS)).toBe(true)
    // 50 s budget, 1 s per drain + 5 s sleep ⇒ 8 drains (t = 0, 6, 12, …, 42), the 9th would overrun.
    expect(out.drains).toHaveLength(8)
  })

  it('a FULL claim (`more`) drains again immediately, no sleep', async () => {
    const h = harness([report({ claimed: 500, more: true, drained: 500 }), report({ claimed: 500, more: true, drained: 500 }), report({ reason: 'queue_empty' })], false)
    const out = await h.promise
    expect(out.drains).toHaveLength(3)
    expect(h.sleeps).toEqual([]) // two full claims back-to-back, then the empty one ends it
    expect(out.stopped).toBe('queue_empty_idle')
  })

  it('alerts and infos accumulate across drains', async () => {
    const h = harness([report({ claimed: 1, drained: 0, ack_missed: { restamped: 0, lease_lost: 0, gone: 1 } }), report({ reason: 'all_deferred' }), report({ reason: 'queue_empty' })], false)
    const out = await h.promise
    expect(out.alerts).toHaveLength(1)
    expect(out.alerts[0]).toMatch(/gone 1/)
    expect(out.infos).toEqual(['drain claimed nothing: all_deferred (R875 — informational)'])
  })
})
