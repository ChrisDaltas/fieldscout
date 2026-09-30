/**
 * live-poll.test.ts — the PURE half of the sync-live wiring (L.D2.3; spec
 * §23.2 / §23.3 / E42 / E45; PROGRESS F216 (R711's observation-closes-the-
 * window rule), F228, F238; D322).
 *
 * The plan is decided from the tables and an injected instant; every
 * literal below is a stored instant and the boundaries are D146 pairs
 * (kickoff − lead exactly ⇒ hot; one second earlier ⇒ idle). The loop is
 * driven with a fake `ingest`, a fake tracker store and a fake `sleep`
 * over an in-memory calendar — no stack, no clock.
 */
import { describe, expect, it } from 'vitest'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import type { FlagsClient, StatsDegradedFlag } from './ingest-flags'
import type { IngestReport } from './ingest-week'
import {
  type CalendarGame,
  type CalendarWeek,
  currentCalendarWeek,
  FINAL_WEEK_REPOLL_DAYS,
  FINAL_WEEK_REPOLL_UTC_HOUR,
  finalWeeksForRepoll,
  LIVE_POLL_BUDGET_MS,
  planLivePoll,
  weeksInCorrectionWindow,
  POLL_CADENCE_MS,
  POLL_LEAD_MS,
  runLivePollInvocation,
  withScheduleMemo,
} from './live-poll'

const WEEKS: CalendarWeek[] = [
  { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00.000Z' },
  { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00.000Z' },
  { season: 2026, week: 3, starts_at: '2026-09-23T04:00:00.000Z' },
]

/** Week 1's Thursday opener (the real 2026 wk-1 first kickoff — F11's 2026-09-10T00:20Z). */
const TNF = '2026-09-10T00:20:00.000Z'
const SNF = '2026-09-14T00:20:00.000Z'

function game(week: number, kickoff_at: string, status: string | null = 'scheduled'): CalendarGame {
  return { season: 2026, week, kickoff_at, status }
}

describe('currentCalendarWeek — the §23.3 datum (greatest starts_at <= now)', () => {
  it('week 1 before the season; the greatest started week in season; the last week after it', () => {
    expect(currentCalendarWeek(WEEKS, new Date('2026-09-01T00:00:00Z'))).toBe(1)
    expect(currentCalendarWeek(WEEKS, new Date('2026-09-09T03:59:59Z'))).toBe(1)
    expect(currentCalendarWeek(WEEKS, new Date('2026-09-09T04:00:00Z'))).toBe(1)
    expect(currentCalendarWeek(WEEKS, new Date('2026-09-16T04:00:00Z'))).toBe(2)
    expect(currentCalendarWeek(WEEKS, new Date('2026-12-01T00:00:00Z'))).toBe(3)
    expect(currentCalendarWeek([], new Date('2026-12-01T00:00:00Z'))).toBe(1)
  })
})

describe('planLivePoll — hot / sweep / idle from the tables', () => {
  it('HOT exactly at kickoff − lead (D146: one second earlier is idle)', () => {
    const games = [game(1, TNF)]
    const atLead = new Date(new Date(TNF).getTime() - POLL_LEAD_MS)
    const hot = planLivePoll(games, WEEKS, atLead)
    expect(hot.mode).toBe('hot')
    expect(hot.weeks).toEqual([1])
    expect(hot.dueGames).toBe(1)
    expect(hot.openPastKickoff).toBe(0)
    const idle = planLivePoll(games, WEEKS, new Date(atLead.getTime() - 1000), { sweepMinute: 59 })
    expect(idle.mode).toBe('idle')
    expect(idle.weeks).toEqual([])
    expect(idle.reasons[0]).toMatch(/^idle: no in-week game within 15 min/)
  })

  it('the window closes on OBSERVATION, never the clock (R711): a game five hours past kickoff and still live keeps the week hot; observed final ⇒ idle', () => {
    const fiveHoursLater = new Date(new Date(TNF).getTime() + 5 * 3_600_000)
    const live = planLivePoll([game(1, TNF, 'live')], WEEKS, fiveHoursLater, { sweepMinute: 59 })
    expect(live.mode).toBe('hot')
    expect(live.openPastKickoff).toBe(1)
    const stillScheduled = planLivePoll([game(1, TNF, 'scheduled')], WEEKS, fiveHoursLater, { sweepMinute: 59 })
    expect(stillScheduled.mode).toBe('hot') // the provider never flipped it — polled until it does (Q37's cost, named)
    const final = planLivePoll([game(1, TNF, 'final')], WEEKS, fiveHoursLater, { sweepMinute: 59 })
    expect(final.mode).toBe('idle')
    const postponed = planLivePoll([game(1, TNF, 'postponed')], WEEKS, fiveHoursLater, { sweepMinute: 59 })
    expect(postponed.mode).toBe('idle') // E43: a postponed game has left the window
    const nullStatus = planLivePoll([game(1, TNF, null)], WEEKS, fiveHoursLater, { sweepMinute: 59 })
    expect(nullStatus.mode).toBe('hot') // 001's nullable column reads as scheduled
  })

  it('a lingering unfinished game in an EARLIER week is polled beside the current one (weeks ascending) — F238: the stamp needs an observing poll', () => {
    const now = new Date(new Date(SNF).getTime() + 60_000)
    const plan = planLivePoll([game(1, TNF, 'live'), game(2, SNF, 'scheduled')], WEEKS, now)
    expect(plan.mode).toBe('hot')
    expect(plan.weeks).toEqual([1, 2])
    expect(plan.dueGames).toBe(2)
  })

  it('SWEEP on the top-of-hour minute when nothing is due; idle off it; the current week is the sweep target', () => {
    const games = [game(1, TNF, 'final'), game(2, SNF, 'scheduled')]
    const sweep = planLivePoll(games, WEEKS, new Date('2026-09-11T15:00:30Z'))
    expect(sweep.mode).toBe('sweep')
    expect(sweep.weeks).toEqual([1])
    expect(sweep.reasons[0]).toMatch(/top-of-hour schedule refresh of week 1/)
    const idle = planLivePoll(games, WEEKS, new Date('2026-09-11T15:01:00Z'))
    expect(idle.mode).toBe('idle')
  })

  it('F270 (L.D3.11): the sweep ALSO re-polls an earlier week still inside its correction window — and stops at the window’s end', () => {
    const games = [game(1, TNF, 'final')]
    const weeks = [
      { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00Z', correction_window_ends_at: '2026-09-18T00:15:00Z' }, // week 2's first kickoff
      { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00Z', correction_window_ends_at: '2026-09-25T00:15:00Z' },
    ]
    const inside = planLivePoll(games, weeks, new Date('2026-09-17T15:00:30Z')) // Thu 11:00 ET — after the OLD 06:00 close
    expect([inside.mode, inside.weeks]).toEqual(['sweep', [2, 1]]) // R1265: the current week first
    expect(inside.reasons[0]).toMatch(/week\(s\) 1 still inside their stat-correction window/)
    const atClose = planLivePoll(games, weeks, new Date('2026-09-18T01:00:00Z'))
    expect(atClose.weeks).toEqual([2])
    // a week with no window (pre-039 fixture) is never re-polled
    expect(planLivePoll(games, [{ ...weeks[0], correction_window_ends_at: null }, weeks[1]], new Date('2026-09-17T15:00:30Z')).weeks).toEqual([2])
  })

  it('an EMPTY calendar sweeps on every invocation (F228: the composite provider can land the rows), targeting the current week', () => {
    const plan = planLivePoll([], WEEKS, new Date('2026-09-17T15:07:00Z'))
    expect(plan.mode).toBe('sweep')
    expect(plan.weeks).toEqual([2])
    expect(plan.reasons[0]).toMatch(/NO nfl_games rows/)
  })
})

// ── The loop ───────────────────────────────────────────────────────────────

interface FakeWorld {
  games: CalendarGame[]
  polls: Array<{ week: number; at: string; failures: number }>
  flag: StatsDegradedFlag
  sleeps: number[]
  scheduleReads: number
  /** The calendar the fake db serves (default WEEKS). */
  weeks?: CalendarWeek[]
}

function fakeReport(season: number, week: number, polledAt: string, ok: boolean, degraded: boolean): IngestReport {
  return {
    provider: 'fake',
    season,
    week,
    polledAt,
    ok,
    degraded,
    error: ok ? undefined : 'boom',
    games: { seen: 1, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 1 },
    weeks: { touched: 1, updated: 0, unchanged: 1, outsideCalendar: 0 },
    stats: { seen: 0, unknownPlayer: 0, empty: 0, droppedAdvancedKeys: 0, inserted: 0, updated: 0, metaOnly: 0, unchanged: 0, deltas: 0, enqueued: 0, restamped: 0 },
    write: { path: 'none', door: 'ingest_write_batch' },
    corrections: { detected: 0, players: 0, recorded: 0, replayed: 0, unchangedAtWrite: 0, weekState: null, keys: [], reason: 'nothing written — no line to classify' },
    reasons: ok ? [] : ['provider poll failed — nothing written (§23.2 never partial data)'],
  }
}

/** A `db` whose only duty here is `readCalendar` — the loop's plan input. */
function fakeDb(world: FakeWorld): FlagsClient {
  const builder = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: () => chain,
      then: (onFulfilled: (v: { data: unknown; error: null; count?: number }) => unknown) => {
        if (table === 'nfl_games') return Promise.resolve({ data: world.games, error: null, count: world.games.length }).then(onFulfilled)
        if (table === 'nfl_weeks') return Promise.resolve({ data: world.weeks ?? WEEKS, error: null }).then(onFulfilled)
        throw new Error(`fake db: unexpected table ${table}`)
      },
    }
    return chain
  }
  return { from: builder } as unknown as FlagsClient
}

function fakeProvider(world: FakeWorld): StatsProvider {
  return {
    name: 'fake',
    capabilities: new Set(),
    getSchedule: async () => {
      world.scheduleReads += 1
      return []
    },
    getGameStates: async () => [],
    getWeekStats: async () => [],
    getInjuries: async () => [],
    getInactives: async () => [],
  }
}

function makeWorld(games: CalendarGame[]): FakeWorld {
  return {
    games,
    polls: [],
    flag: { degraded: false, consecutive_failures: 0, last_failure_at: null, last_success_at: null, last_error: null, provider: null },
    sleeps: [],
    scheduleReads: 0,
  }
}

function run(
  world: FakeWorld,
  clock: VirtualClock,
  opts: { failPolls?: boolean; onPoll?: (week: number) => void; budgetMs?: number; mutate?: (r: IngestReport) => IngestReport } = {},
) {
  return runLivePollInvocation({
    db: fakeDb(world),
    provider: fakeProvider(world),
    time: clock,
    season: 2026,
    budgetMs: opts.budgetMs,
    sleep: async (ms) => {
      world.sleeps.push(ms)
      clock.advanceBy(ms)
    },
    ingest: async (provider, time, io) => {
      await provider.getSchedule(io.season) // what the real ingestWeek does first — the memo is measured through it
      const ok = !opts.failPolls
      io.degradation.recordPollResult(ok)
      world.polls.push({ week: io.week, at: time.now().toISOString(), failures: io.degradation.consecutiveFailures })
      opts.onPoll?.(io.week)
      const report = fakeReport(io.season, io.week, time.now().toISOString(), ok, io.degradation.degraded)
      return opts.mutate ? opts.mutate(report) : report
    },
    loadTracker: async () => new DegradationTracker(world.flag.consecutive_failures),
    persist: async (_db, tracker, report) => {
      world.flag = {
        degraded: tracker.degraded,
        consecutive_failures: tracker.consecutiveFailures,
        last_failure_at: report.ok ? world.flag.last_failure_at : report.polledAt,
        last_success_at: report.ok ? report.polledAt : world.flag.last_success_at,
        last_error: report.ok ? null : (report.error ?? null),
        provider: report.provider,
      }
      return world.flag
    },
  })
}

describe('runLivePollInvocation — the minute-invocation loop', () => {
  it('IDLE: no provider call, no poll, the reason named', async () => {
    const world = makeWorld([game(1, TNF, 'final')])
    const report = await run(world, new VirtualClock(new Date('2026-09-11T15:01:00Z')))
    expect(report.reason).toBe('idle')
    expect(report.rounds).toEqual([])
    expect(world.polls).toEqual([])
    expect(world.scheduleReads).toBe(0)
    expect(report.problems).toEqual([expect.stringMatching(/^polled nothing: idle/)])
  })

  it('HOT: polls at the cadence for the budget — 45 s budget ⇒ three rounds 20 s apart (0 s, 20 s, 40 s); one schedule read per round (the memo); stops before a round would start past the budget', async () => {
    const world = makeWorld([game(1, TNF, 'live')])
    const clock = new VirtualClock(new Date('2026-09-10T01:07:00Z'))
    const report = await run(world, clock)
    expect(report.reason).toBeNull()
    expect(report.rounds).toHaveLength(3)
    expect(world.polls.map((p) => p.at)).toEqual(['2026-09-10T01:07:00.000Z', '2026-09-10T01:07:20.000Z', '2026-09-10T01:07:40.000Z'])
    expect(world.sleeps).toEqual([POLL_CADENCE_MS, POLL_CADENCE_MS])
    expect(world.scheduleReads).toBe(3)
    expect([POLL_CADENCE_MS, LIVE_POLL_BUDGET_MS]).toEqual([20_000, 45_000])
    // D146 at the budget: a budget of exactly 40 s + cadence admits the 40 s round; one millisecond less does not.
    const three = makeWorld([game(1, TNF, 'live')])
    await run(three, new VirtualClock(new Date('2026-09-10T01:07:00Z')), { budgetMs: 40_000 + 1 })
    expect(three.polls).toHaveLength(3)
    const two = makeWorld([game(1, TNF, 'live')])
    await run(two, new VirtualClock(new Date('2026-09-10T01:07:00Z')), { budgetMs: 40_000 })
    expect(two.polls).toHaveLength(2)
  })

  it('HOT with two due weeks: both polled in ONE round sharing ONE schedule read', async () => {
    const world = makeWorld([game(1, TNF, 'live'), game(2, SNF, 'scheduled')])
    const clock = new VirtualClock(new Date(new Date(SNF).getTime() + 7 * 60_000)) // off the sweep minute
    const report = await run(world, clock)
    expect(report.rounds[0].polls.map((p) => p.week)).toEqual([1, 2])
    expect(world.scheduleReads).toBe(3) // three rounds, one read each — not six
  })

  it('the window closes on OBSERVATION mid-invocation: the first poll sees the last game final ⇒ the re-plan is idle and the loop ends after ONE round (the observing poll is the one that stamps last_game_ends_at — F238)', async () => {
    const world = makeWorld([game(1, TNF, 'live')])
    const clock = new VirtualClock(new Date('2026-09-10T04:07:00Z')) // off the sweep minute
    const report = await run(world, clock, { onPoll: () => (world.games = [game(1, TNF, 'final')]) })
    expect(report.rounds).toHaveLength(1)
    expect(world.sleeps).toEqual([POLL_CADENCE_MS]) // slept once, re-planned idle, stopped
    expect(report.reason).toBeNull() // something WAS polled — not an empty invocation
    // On the sweep minute the same observation is followed by ONE sweep round, then the loop ends.
    const sweepWorld = makeWorld([game(1, TNF, 'live')])
    const swept = await run(sweepWorld, new VirtualClock(new Date('2026-09-10T04:00:00Z')), { onPoll: () => (sweepWorld.games = [game(1, TNF, 'final')]) })
    expect(swept.rounds.map((r) => r.plan.mode)).toEqual(['hot', 'sweep'])
  })

  it('SWEEP: exactly one poll, no sleep', async () => {
    const world = makeWorld([])
    const report = await run(world, new VirtualClock(new Date('2026-09-11T15:07:00Z')))
    expect(report.rounds).toHaveLength(1)
    expect(report.rounds[0].plan.mode).toBe('sweep')
    expect(world.polls).toHaveLength(1)
    expect(world.sleeps).toEqual([])
  })

  it('F217: the failure count PERSISTS across invocations — three failed polls in three separate invocations raise the flag; the next success clears it', async () => {
    const world = makeWorld([game(1, TNF, 'live')])
    for (let i = 1; i <= 3; i++) {
      const clock = new VirtualClock(new Date(`2026-09-10T01:0${i}:00Z`))
      const report = await runLivePollInvocation({
        db: fakeDb(world),
        provider: fakeProvider(world),
        time: clock,
        season: 2026,
        budgetMs: 1, // one round per invocation
        sleep: async () => {},
        ingest: async (_p, time, io) => {
          io.degradation.recordPollResult(false)
          return fakeReport(io.season, io.week, time.now().toISOString(), false, io.degradation.degraded)
        },
        loadTracker: async () => new DegradationTracker(world.flag.consecutive_failures),
        persist: async (_db, tracker, r) => {
          world.flag = { ...world.flag, degraded: tracker.degraded, consecutive_failures: tracker.consecutiveFailures, last_failure_at: r.polledAt, last_error: r.error ?? null, provider: r.provider }
          return world.flag
        },
      })
      expect(world.flag.consecutive_failures).toBe(i)
      expect(world.flag.degraded).toBe(i >= 3)
      expect(report.problems[0]).toMatch(i >= 3 ? /stats_degraded RAISED/ : /consecutive failures/)
    }
    const recovered = await run(world, new VirtualClock(new Date('2026-09-10T01:04:00Z')), { budgetMs: 1 })
    expect(world.flag).toMatchObject({ degraded: false, consecutive_failures: 0, last_success_at: '2026-09-10T01:04:00.000Z', last_error: null })
    expect(recovered.problems).toEqual([])
  })
})

describe('withScheduleMemo', () => {
  it('one read per season until reset; the other methods pass through', async () => {
    let reads = 0
    const base: StatsProvider = {
      name: 'b',
      capabilities: new Set(),
      getSchedule: async () => {
        reads += 1
        return []
      },
      getGameStates: async () => [],
      getWeekStats: async () => [],
      getInjuries: async () => [],
      getInactives: async () => [],
    }
    const memo = withScheduleMemo(base)
    await memo.getSchedule(2026)
    await memo.getSchedule(2026)
    expect(reads).toBe(1)
    await memo.getSchedule(2025)
    expect(reads).toBe(2)
    memo.resetScheduleMemo()
    await memo.getSchedule(2025)
    expect(reads).toBe(3)
    expect(memo.name).toBe('b')
  })
})

// ── M6 L.E2.1 — TD5's daily re-poll of FINAL weeks + the fallback, named ───

describe('TD5 (L.E2.1) — a final week is re-polled once a day for 7 days after it locks, and never more', () => {
  // Week 1 locks at week 2's first kickoff (158's window); week 2 at week 3's.
  const W1_ENDS = '2026-09-18T00:15:00.000Z'
  const weeks: CalendarWeek[] = [
    { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00Z', correction_window_ends_at: W1_ENDS },
    { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00Z', correction_window_ends_at: '2026-09-25T00:15:00Z' },
    { season: 2026, week: 3, starts_at: '2026-09-23T04:00:00Z', correction_window_ends_at: '2026-10-02T00:15:00Z' },
  ]
  const at = (iso: string) => new Date(iso)
  const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms)

  it('R1 finalWeeksForRepoll: from the window’s end INCLUSIVE to end + 7 days EXCLUSIVE (D146 pairs); the current week and an open window never', () => {
    expect([FINAL_WEEK_REPOLL_DAYS, FINAL_WEEK_REPOLL_UTC_HOUR]).toEqual([7, 11])
    expect(finalWeeksForRepoll(weeks, 2, plus(W1_ENDS, -1000))).toEqual([]) // one second before the lock: still F270's
    expect(finalWeeksForRepoll(weeks, 2, at(W1_ENDS))).toEqual([1]) // at the lock
    expect(finalWeeksForRepoll([weeks[0]], 3, plus(W1_ENDS, 7 * 86_400_000 - 1000))).toEqual([1]) // the last second of day 7
    expect(finalWeeksForRepoll([weeks[0]], 3, plus(W1_ENDS, 7 * 86_400_000))).toEqual([]) // day 8: out of TD5's reach
    expect(finalWeeksForRepoll(weeks, 1, at('2026-09-30T00:00:00Z'))).toEqual([]) // never the current week or later
    expect(finalWeeksForRepoll([{ ...weeks[0], correction_window_ends_at: null }], 2, at('2026-09-20T00:00:00Z'))).toEqual([])
  })

  it('R2 the sweep at 11:00Z adds the final week(s) AFTER the current week and the open-window weeks; any other hour does not; off the sweep minute nothing', () => {
    const games = [game(1, TNF, 'final'), game(2, SNF, 'final')]
    // Thu 2026-09-24 11:00:30Z: week 3 current, week 2 inside its window, week 1 locked 6.5 days ago.
    const sweep = planLivePoll(games, weeks, at('2026-09-24T11:00:30Z'))
    expect([sweep.mode, sweep.weeks]).toEqual(['sweep', [3, 2, 1]])
    expect(sweep.reasons[0]).toContain('and final week(s) 1 — the daily re-poll of weeks locked within 7 days (TD5 — a late correction is recorded, never scored)')
    const otherHour = planLivePoll(games, weeks, at('2026-09-24T12:00:30Z'))
    expect(otherHour.weeks).toEqual([3, 2]) // F270's set only
    expect(otherHour.reasons[0]).not.toContain('final week')
    expect(planLivePoll(games, weeks, at('2026-09-24T11:01:00Z')).mode).toBe('idle') // one sweep a day, not an hour of polls
    // the hour is a plan option (the gates' clocks), and a final week never doubles an open-window one
    expect(planLivePoll(games, weeks, at('2026-09-24T12:00:30Z'), { finalRepollHourUtc: 12 }).weeks).toEqual([3, 2, 1])
  })

  it('R3 cheap: over a whole season of daily 11:00Z sweeps, each final week is re-polled on exactly 7 mornings', () => {
    const season: CalendarWeek[] = Array.from({ length: 18 }, (_, i) => ({
      season: 2026,
      week: i + 1,
      starts_at: new Date(Date.parse('2026-09-09T04:00:00Z') + i * 7 * 86_400_000).toISOString(),
      correction_window_ends_at: new Date(Date.parse('2026-09-18T00:15:00Z') + i * 7 * 86_400_000).toISOString(),
    }))
    const count = new Map<number, number>()
    let maxPerDay = 0
    for (let d = 0; d < 140; d++) {
      const now = new Date(Date.parse('2026-09-10T11:00:30Z') + d * 86_400_000)
      const plan = planLivePoll([game(1, TNF, 'final')], season, now)
      const current = plan.currentWeek
      const extra = plan.weeks.filter((w) => w < current && !weeksInCorrectionWindow(season, current, now).includes(w))
      maxPerDay = Math.max(maxPerDay, extra.length)
      for (const w of extra) count.set(w, (count.get(w) ?? 0) + 1)
    }
    expect(maxPerDay).toBe(1)
    for (let w = 1; w <= 16; w++) expect(count.get(w), `week ${w}`).toBe(7)
  })
})

describe('TD15 (L.E2.1) — the pre-167 two-call path is NAMED in the invocation’s problems, every poll', () => {
  it('a poll that wrote through the fallback is a problem line (with the correction keys it could not record); a door poll is not', async () => {
    const world = makeWorld([game(1, TNF, 'final')])
    const fallback = await run(world, new VirtualClock(new Date('2026-09-11T15:00:30Z')), {
      mutate: (r) => ({ ...r, write: { path: 'two_call_fallback', door: 'ingest_write_batch' }, corrections: { ...r.corrections, detected: 2 } }),
    })
    expect(fallback.problems).toEqual([
      'week 1: wrote through the pre-167 two-call path — ingest_write_batch is absent (PGRST202; push migration 167); 2 stat correction key(s) NOT recorded',
    ])
    const door = await run(makeWorld([game(1, TNF, 'final')]), new VirtualClock(new Date('2026-09-11T15:00:30Z')), {
      mutate: (r) => ({ ...r, write: { path: 'door', door: 'ingest_write_batch' } }),
    })
    expect(door.problems).toEqual([])
  })
})

describe('R1314 (L.E2.1) — one sweep’s failures count ONCE toward stats_degraded (§23.2’s three polls are three polls in time)', () => {
  const weeks: CalendarWeek[] = [
    { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00Z', correction_window_ends_at: '2026-09-18T00:15:00.000Z' },
    { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00Z', correction_window_ends_at: '2026-09-25T00:15:00Z' },
    { season: 2026, week: 3, starts_at: '2026-09-23T04:00:00Z', correction_window_ends_at: '2026-10-02T00:15:00Z' },
  ]

  it('the 11:00Z sweep polls three weeks; a provider blip fails all three — ONE failure is persisted, stats_degraded stays down, the other two are named', async () => {
    const world = { ...makeWorld([game(1, TNF, 'final'), game(2, SNF, 'final')]), weeks }
    const report = await run(world, new VirtualClock(new Date('2026-09-24T11:00:30Z')), { failPolls: true })
    expect(report.rounds[0]!.plan.weeks).toEqual([3, 2, 1])
    expect(world.polls.map((p) => p.week)).toEqual([3, 2, 1]) // every week still asked
    expect([world.flag.consecutive_failures, world.flag.degraded]).toEqual([1, false])
    expect(report.problems).toEqual([
      'week 3: provider poll FAILED (boom) — nothing written; consecutive failures 1',
      'week 2: provider poll FAILED again in the same sweep (boom) — nothing written; counted once per sweep toward stats_degraded (R1314)',
      'week 1: provider poll FAILED again in the same sweep (boom) — nothing written; counted once per sweep toward stats_degraded (R1314)',
    ])
    // Three SWEEPS in a row (three hours) still raise it on the third — the threshold itself is unchanged.
    await run(world, new VirtualClock(new Date('2026-09-24T12:00:30Z')), { failPolls: true })
    expect([world.flag.consecutive_failures, world.flag.degraded]).toEqual([2, false])
    await run(world, new VirtualClock(new Date('2026-09-24T13:00:30Z')), { failPolls: true })
    expect([world.flag.consecutive_failures, world.flag.degraded]).toEqual([3, true])
  })
})
