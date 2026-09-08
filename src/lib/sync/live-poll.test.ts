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
  LIVE_POLL_BUDGET_MS,
  planLivePoll,
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
        if (table === 'nfl_weeks') return Promise.resolve({ data: WEEKS, error: null }).then(onFulfilled)
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

function run(world: FakeWorld, clock: VirtualClock, opts: { failPolls?: boolean; onPoll?: (week: number) => void; budgetMs?: number } = {}) {
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
      return fakeReport(io.season, io.week, time.now().toISOString(), ok, io.degradation.degraded)
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
