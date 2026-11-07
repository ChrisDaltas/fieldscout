/**
 * score-week-invoker.test.ts — the PURE half of the score-week wiring
 * (L.D2.3; spec §14 / §22.3 / §24.1; PROGRESS F263(f), R873 / R874 / R875;
 * D322). The loop runs over a fake drain and a fake `sleep` on a
 * VirtualClock; the classifier is pinned on hand-built reports.
 */
import { describe, expect, it } from 'vitest'

import { VirtualClock } from '../time/virtual-clock'
import {
  classifyClose,
  classifyDrain,
  classifyStatFix,
  CLOCK_SKEW_SECONDS,
  closePassErrorAlert,
  DRAIN_INTERVAL_MS,
  runScoreWeekInvocation,
  SCORE_WEEK_BUDGET_MS,
  SCORE_WEEK_LEASE_SECONDS,
  SCORE_WEEK_MAX_DURATION_SECONDS,
  statFixPassErrorAlert,
} from './score-week-invoker'
import { type BatchReport, type CloseScoringReport, type LeagueWeekReport, PRE_216_CLOSE_SENTENCE, runCloseScoring } from './score-week-worker'
import { runStatFixPass, type StatFixPassReport } from './stat-fix-rescore'

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
    failed_deferred: 0,
    deferred: 0,
    drained: 0,
    released: 0,
    ack_missed: { restamped: 0, lease_lost: 0, gone: 0 },
    leagues: [],
    corrections_applied: { read: 0, sent: 0, stamped: 0, already_applied: 0, reason: 'no event read — no ready player carries an unapplied correction' },
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
    // R1757: the alert names a league restore as a known benign lease_lost (212's re-arm takes the lease back).
    expect(classifyDrain(report({ ack_missed: { restamped: 0, lease_lost: 1, gone: 0 } })).alerts[0]).toMatch(/Known benign cause of lease_lost: a league RESTORE takes back the lease/)
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

const emptyClose: CloseScoringReport = { ran_at: '2099-09-13T20:00:00.000Z', available: true, weeks: [], closed: 0, failed: 0, problems: [] }
const emptyFix: StatFixPassReport = { ran_at: '2099-09-13T20:00:00.000Z', available: true, weeks: [], applied: 0, problems: [] }

describe('runCloseScoring on a database without 216 (deploy before push)', () => {
  it('says so by name and does nothing', async () => {
    const db = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.league_weeks_to_close(p_limit, p_now) in the schema cache' } }) } as never
    const out = await runCloseScoring({ db, time: new VirtualClock(new Date('2099-09-13T20:00:00.000Z')) })
    expect([out.available, out.weeks, out.problems]).toEqual([false, [], [PRE_216_CLOSE_SENTENCE]])
    expect(classifyClose(out)).toEqual({ alerts: [], infos: [PRE_216_CLOSE_SENTENCE] })
  })

  it('any other error is not "not deployed": it throws', async () => {
    const db = { rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) } as never
    await expect(runCloseScoring({ db, time: new VirtualClock(new Date('2099-09-13T20:00:00.000Z')) })).rejects.toThrow('league_weeks_to_close: permission denied')
  })
})

describe('classifyClose (F863)', () => {
  it('names each outcome: failed alerts, the rest inform', () => {
    const v = classifyClose({
      ...emptyClose,
      weeks: [
        { league_id: 'A', season: 2099, week: 1, reason: 'no_stat_lines', outcome: 'no_stat_lines' },
        { league_id: 'B', season: 2099, week: 1, reason: 'never_closed', outcome: 'closed' },
        { league_id: 'C', season: 2099, week: 1, reason: 'lines_moved', outcome: 'lines_moved' },
      ],
    })
    expect(v.alerts).toEqual([])
    expect(v.infos.map((l) => l.slice(0, 22))).toEqual(['league_id=A week=1 not', 'league_id=B week=1 sco', 'league_id=C week=1 not'])
  })
})

describe('runScoreWeekInvocation — the minute-invocation loop', () => {
  function harness(
    drains: BatchReport[],
    hot: boolean,
    closeReport: CloseScoringReport | (() => Promise<CloseScoringReport>) = emptyClose,
    fixReport: StatFixPassReport | (() => Promise<StatFixPassReport>) = emptyFix,
  ) {
    let closes = 0
    let fixes = 0
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
      closeWeeks: async () => {
        closes += 1
        return typeof closeReport === 'function' ? closeReport() : closeReport
      },
      statFix: async () => {
        fixes += 1
        return typeof fixReport === 'function' ? fixReport() : fixReport
      },
      drain: async (_deps, opts) => {
        calls.push(`${opts?.leaseSeconds}/${opts?.batchSize}/${opts?.deferSeconds}`)
        const r = drains[Math.min(i, drains.length - 1)]
        i += 1
        clock.advanceBy(1_000) // a drain takes a second
        return r
      },
    })
    return { promise, calls, sleeps, closes: () => closes, fixes: () => fixes }
  }

  it('an empty queue outside a game window ends the invocation after ONE drain — one claim RPC per idle minute', async () => {
    const h = harness([report({ reason: 'queue_empty' })], false)
    const out = await h.promise
    expect(out.drains).toHaveLength(1)
    expect(out.stopped).toBe('queue_empty_idle')
    expect(h.sleeps).toEqual([])
    expect(h.calls).toEqual([`${SCORE_WEEK_LEASE_SECONDS}/500/30`]) // the lease + batch + defer the route passes
  })

  it('F863: the close pass runs exactly once per invocation, even on an idle stop', async () => {
    const idle = harness([report({ reason: 'queue_empty' })], false)
    expect((await idle.promise).close).toBe(emptyClose)
    expect(idle.closes()).toBe(1)
    const hot = harness([report({ reason: 'queue_empty' })], true)
    const out = await hot.promise
    expect(out.drains.length).toBeGreaterThan(1)
    expect(hot.closes()).toBe(1)
  })

  it('F863: a week the pass cannot close is an ALERT by name on the invocation', async () => {
    const h = harness([report({ reason: 'queue_empty' })], false, {
      ...emptyClose,
      failed: 1,
      weeks: [{ league_id: 'L', season: 2099, week: 9, reason: 'never_closed', outcome: 'failed', error: 'snapshot_missing' }],
    })
    const out = await h.promise
    expect(out.alerts).toEqual(['league_id=L week=9 CLOSE FAILED: snapshot_missing — the week stays held (F863); retried next pass'])
  })

  // R1790: before the fix a throwing close pass rejected the whole invocation
  // after its FIRST drain (the route answered 500) — in a game window scoring
  // fell from every 5 s to once a minute for as long as the cause lasted.
  it('R1790: a close pass that THROWS is one alert; a hot window keeps draining for the whole budget', async () => {
    const timeout = new Error('league_weeks_to_close: canceling statement due to statement timeout')
    const h = harness([report({ reason: 'queue_empty' })], true, async () => {
      throw timeout
    })
    const out = await h.promise
    expect(out.drains).toHaveLength(8) // the same 8 drains as the no-error hot window below
    expect(out.stopped).toBe('budget')
    expect(h.closes()).toBe(1) // tried once per invocation, not once per drain
    expect(out.close).toBeNull()
    expect(out.alerts).toEqual([closePassErrorAlert(timeout)])
    expect(out.alerts[0]).toBe(
      'CLOSE PASS ERROR: league_weeks_to_close: canceling statement due to statement timeout — the pass stopped there; any week it had not closed stays held (scores_owed) and is retried next invocation; draining continues (F863 / R1790)',
    )
  })

  it('R1790: the real pass over a timing-out read (57014) — the invocation resolves, it does not reject', async () => {
    const clock = new VirtualClock(new Date('2099-09-13T20:00:00.000Z'))
    let drains = 0
    const timingOut = { rpc: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) } as never
    const out = await runScoreWeekInvocation({
      db: {} as never,
      time: clock,
      sleep: async (ms) => {
        clock.advanceBy(ms)
      },
      lastPollCompletedAt: async () => null,
      isHot: async () => true,
      closeWeeks: (deps) => runCloseScoring({ ...deps, db: timingOut }),
      statFix: async () => emptyFix,
      drain: async () => {
        drains += 1
        clock.advanceBy(1_000)
        return report({ reason: 'queue_empty' })
      },
    })
    expect(drains).toBe(8)
    expect(out.alerts).toEqual(['CLOSE PASS ERROR: league_weeks_to_close: canceling statement due to statement timeout — the pass stopped there; any week it had not closed stays held (scores_owed) and is retried next invocation; draining continues (F863 / R1790)'])
  })

  it('R1790: idle, a throwing pass still ends the invocation normally after one drain', async () => {
    const h = harness([report({ reason: 'queue_empty' })], false, async () => {
      throw new Error('league_week_close_stamp (L week 9): connection reset')
    })
    const out = await h.promise
    expect([out.drains.length, out.stopped, out.close]).toEqual([1, 'queue_empty_idle', null])
    expect(out.alerts).toHaveLength(1)
    expect(out.alerts[0]).toMatch(/^CLOSE PASS ERROR: league_week_close_stamp \(L week 9\): connection reset/)
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

// ---------------------------------------------------------------------------
// 222 (D836 — Chris 2026-11-07: "the stats need to be correct. that should be
// done automatically"): our own stat fixes, once per invocation
// ---------------------------------------------------------------------------

describe('the stat-fix pass (222) on the invocation', () => {
  const clock = () => new VirtualClock(new Date('2099-09-13T20:00:00.000Z'))
  const idle = (statFix: () => Promise<StatFixPassReport>) =>
    runScoreWeekInvocation({
      db: {} as never,
      time: clock(),
      sleep: async () => {},
      lastPollCompletedAt: async () => null,
      isHot: async () => false,
      closeWeeks: async () => emptyClose,
      statFix,
      drain: async () => report({ reason: 'queue_empty' }),
    })

  it('runs exactly once per invocation, after the close, and its report rides on the invocation', async () => {
    let calls = 0
    const out = await idle(async () => {
      calls += 1
      return emptyFix
    })
    expect(calls).toBe(1)
    expect(out.stat_fix).toBe(emptyFix)
    expect([out.alerts, out.infos]).toEqual([[], []])
  })

  it('a pass that THROWS is ONE alert by name and the invocation resolves (it never costs the minute its scoring)', async () => {
    const boom = new Error('stat_fix_targets: canceling statement due to statement timeout')
    const out = await idle(async () => {
      throw boom
    })
    expect(out.stat_fix).toBeNull()
    expect(out.stopped).toBe('queue_empty_idle')
    expect(out.alerts).toEqual([statFixPassErrorAlert(boom)])
    expect(out.alerts[0]).toBe(
      'STAT FIX PASS ERROR: stat_fix_targets: canceling statement due to statement timeout — the pass stopped there; every fix it had not applied stays owed and is retried next invocation; draining continues (D836)',
    )
  })

  it('a database WITHOUT 222 (the real pass over PGRST202): a SILENT no-op — no alert, no info, nothing thrown', async () => {
    const pre222 = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.stat_fix_targets(p_limit, p_owed_only) in the schema cache' } }) } as never
    const pass = await runStatFixPass({ db: pre222, time: clock() })
    expect(pass).toEqual({ ran_at: '2099-09-13T20:00:00.000Z', available: false, weeks: [], applied: 0, problems: [] })
    const out = await idle(() => runStatFixPass({ db: pre222, time: clock() }))
    expect([out.alerts, out.infos, out.stat_fix?.available]).toEqual([[], [], false])
  })

  it('any other error from the targets read is not "not deployed": the pass throws, the invocation alerts', async () => {
    const denied = { rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied for function stat_fix_targets' } }) } as never
    await expect(runStatFixPass({ db: denied, time: clock() })).rejects.toThrow('stat_fix_targets: permission denied for function stat_fix_targets')
    const out = await idle(() => runStatFixPass({ db: denied, time: clock() }))
    expect(out.alerts).toEqual(['STAT FIX PASS ERROR: stat_fix_targets: permission denied for function stat_fix_targets — the pass stopped there; every fix it had not applied stays owed and is retried next invocation; draining continues (D836)'])
  })

  it('classifyStatFix: a refused league-week ALERTS by name and stays owed; an applied / unchanged one informs', () => {
    const v = classifyStatFix({
      ...emptyFix,
      applied: 2,
      weeks: [
        { fix_id: 'F', league_id: 'A', week: 1, verdict: 'applied', players_changed: 2, scores_changed: 1, results_changed: 1, refusal: null },
        { fix_id: 'F', league_id: 'B', week: 1, verdict: 'no_changes', players_changed: 0, scores_changed: 0, results_changed: 0, refusal: null },
        { fix_id: 'F', league_id: 'C', week: 1, verdict: 'refused', players_changed: 0, scores_changed: 0, results_changed: 0, refusal: 'rows_drift' },
      ],
      problems: ['fix F league_id=C week 1: apply_stat_fix_week refused — rows_drift'],
    })
    expect(v.alerts).toEqual(['STAT FIX NOT APPLIED: fix F league_id=C week 1: apply_stat_fix_week refused — rows_drift — no receipt, so it stays owed and the next pass tries again (D836)'])
    expect(v.infos).toEqual([
      'league_id=A week=1 stat fix F applied: 2 player row(s), 1 team score(s), 1 result(s) moved',
      'league_id=B week=1 stat fix F: nothing in the week moves — receipt written',
    ])
    expect(classifyStatFix({ ...emptyFix, available: false })).toEqual({ alerts: [], infos: [] })
  })
})
