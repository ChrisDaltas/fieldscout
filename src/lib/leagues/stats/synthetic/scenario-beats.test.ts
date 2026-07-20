import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { VirtualClock } from '../../time/virtual-clock'
import { DegradationTracker } from '../degradation'
import type { ScenarioId } from './scenario'
import { DEFAULT_SEED, makeScenario } from './scenarios'
import {
  CHARTED_PLACEHOLDER_KEY,
  SyntheticStatsProvider,
  TRACKING_PLACEHOLDER_KEY,
} from './synthetic-stats-provider'

// ── §23.6 exit-criterion guard: ZERO external calls, mechanically proven ────
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('synthetic tier made an external call — §23.6 violation')
    }),
  )
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const SEASON = 2026
const WEEK = 2
const WEEK_START = new Date('2026-09-16T04:00:00Z')
const G1 = '2026-wk02-DAL@PHI'
const G2 = '2026-wk02-BUF@KC'
const G3 = '2026-wk02-SEA@SF'

function makeProvider(id: ScenarioId) {
  const clock = new VirtualClock(WEEK_START)
  const scenario = makeScenario(id, DEFAULT_SEED)
  const provider = new SyntheticStatsProvider(scenario, clock)
  return { provider, clock, scenario }
}

async function statsFor(provider: SyntheticStatsProvider, playerId: string) {
  const rows = await provider.getWeekStats(SEASON, WEEK)
  return rows.find((r) => r.playerId === playerId)
}

async function gameState(provider: SyntheticStatsProvider, gameId: string) {
  const states = await provider.getGameStates(SEASON, WEEK)
  return states.find((s) => s.gameId === gameId)
}

async function scheduleGame(provider: SyntheticStatsProvider, gameId: string) {
  const games = await provider.getSchedule(SEASON)
  return games.find((g) => g.gameId === gameId)
}

describe('happy_path (§23.6 golden week)', () => {
  it('walks pre-kickoff → live (monotone) → final → T+1 charted, on exact instants', async () => {
    const { provider, clock } = makeProvider('happy_path')

    // Wednesday: full slate scheduled with real kickoff timestamps; no data.
    expect(await provider.getWeekStats(SEASON, WEEK)).toEqual([])
    expect(await provider.getInjuries(SEASON, WEEK)).toEqual([])
    expect(await provider.getInactives(SEASON, WEEK)).toEqual([])
    const wedG1 = await scheduleGame(provider, G1)
    expect(wedG1).toMatchObject({
      status: 'scheduled',
      kickoffAt: new Date('2026-09-20T17:00:00Z'),
      gameDate: '2026-09-20',
    })

    // Friday 20:00Z: the WR's questionable designation appears, honestly dated.
    clock.advanceTo(new Date('2026-09-18T19:59:59Z'))
    expect(await provider.getInjuries(SEASON, WEEK)).toEqual([])
    clock.advanceTo(new Date('2026-09-18T20:00:00Z'))
    expect(await provider.getInjuries(SEASON, WEEK)).toEqual([
      {
        playerId: 'syn-g1-wr',
        designation: 'questionable',
        gameId: G1,
        reportedAt: new Date('2026-09-18T20:00:00Z'),
      },
    ])

    // G1 inactives publish at exactly kickoff − 90 min (§23.1).
    clock.advanceTo(new Date('2026-09-20T15:29:59Z'))
    expect(await provider.getInactives(SEASON, WEEK)).toEqual([])
    clock.advanceTo(new Date('2026-09-20T15:30:00Z'))
    expect(await provider.getInactives(SEASON, WEEK)).toEqual([
      { gameId: G1, playerIds: [], publishedAt: new Date('2026-09-20T15:30:00Z') },
    ])

    // Kickoff boundary: scheduled at T−1s, live at T.
    clock.advanceTo(new Date('2026-09-20T16:59:59Z'))
    expect((await scheduleGame(provider, G1))?.status).toBe('scheduled')
    clock.advanceTo(new Date('2026-09-20T17:00:00Z'))
    expect((await scheduleGame(provider, G1))?.status).toBe('live')

    // In-game: lines exist, tracking accrues live, charted stays ABSENT.
    clock.advanceTo(new Date('2026-09-20T18:00:00Z'))
    const early = await statsFor(provider, 'syn-g1-wr')
    expect(early).toBeDefined()
    expect(early?.advanced[TRACKING_PLACEHOLDER_KEY]).toBeGreaterThanOrEqual(0)
    expect(early?.advanced).not.toHaveProperty(CHARTED_PLACEHOLDER_KEY)
    expect((await gameState(provider, G1))?.advancedFinalAt).toBeNull()

    // Monotone in-game deltas: every key at 19:30 ≥ its 18:00 value, and the
    // line has genuinely moved.
    clock.advanceTo(new Date('2026-09-20T19:30:00Z'))
    const late = await statsFor(provider, 'syn-g1-wr')
    const earlyStats = early?.stats ?? {}
    const lateStats = late?.stats ?? {}
    expect(Object.keys(lateStats).sort()).toEqual(Object.keys(earlyStats).sort())
    for (const [key, value] of Object.entries(earlyStats)) {
      expect(lateStats[key], key).toBeGreaterThanOrEqual(value as number)
    }
    expect(lateStats.receiving_yards).toBeGreaterThan(earlyStats.receiving_yards as number)

    // Final at kickoff + 3h20m; the settled line never moves afterwards.
    clock.advanceTo(new Date('2026-09-20T20:20:00Z'))
    expect((await scheduleGame(provider, G1))?.status).toBe('final')
    const settled = await statsFor(provider, 'syn-g1-wr')
    clock.advanceTo(new Date('2026-09-21T02:00:00Z'))
    expect(await statsFor(provider, 'syn-g1-wr')).toEqual(settled)

    // T+1 charted arrival at exactly chartedPostAt: value appears whole and
    // advancedFinalAt posts on the game state (§23.5 two-phase).
    clock.advanceTo(new Date('2026-09-21T14:59:59Z'))
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced).not.toHaveProperty(
      CHARTED_PLACEHOLDER_KEY,
    )
    clock.advanceTo(new Date('2026-09-21T15:00:00Z'))
    const posted = await statsFor(provider, 'syn-g1-wr')
    expect(posted?.advanced[CHARTED_PLACEHOLDER_KEY]).toBeGreaterThan(0)
    expect((await gameState(provider, G1))?.advancedFinalAt).toEqual(
      new Date('2026-09-21T15:00:00Z'),
    )
  })

  it('publishes the scratched TE on G2 inactives and never emits a line for him', async () => {
    const { provider, clock } = makeProvider('happy_path')
    clock.advanceTo(new Date('2026-09-20T18:55:00Z')) // G2 kickoff − 90 min
    const g2 = (await provider.getInactives(SEASON, WEEK)).find((i) => i.gameId === G2)
    expect(g2).toEqual({
      gameId: G2,
      playerIds: ['syn-g2-te'],
      publishedAt: new Date('2026-09-20T18:55:00Z'),
    })
    clock.advanceTo(new Date('2026-09-25T12:00:00Z')) // long after everything
    expect(await statsFor(provider, 'syn-g2-te')).toBeUndefined()
    expect(await statsFor(provider, 'syn-g2-qb')).toBeDefined() // teammates play
  })
})

describe('flex_move (E42)', () => {
  it('reveals the moved kickoff only from the announcement, and stats follow the new slot', async () => {
    const { provider, clock } = makeProvider('flex_move')

    clock.advanceTo(new Date('2026-09-17T19:59:59Z')) // 1s before the announcement
    expect(await scheduleGame(provider, G3)).toMatchObject({
      kickoffAt: new Date('2026-09-21T00:20:00Z'),
      gameDate: '2026-09-20', // SNF: UTC Monday, but the ET Sunday (R25/library v2)
      status: 'scheduled',
    })

    clock.advanceTo(new Date('2026-09-17T20:00:00Z')) // announcement instant
    expect(await scheduleGame(provider, G3)).toMatchObject({
      kickoffAt: new Date('2026-09-20T21:05:00Z'),
      gameDate: '2026-09-20',
      status: 'scheduled',
    })

    // Inactives publish 90 min before the NEW kickoff.
    clock.advanceTo(new Date('2026-09-20T19:35:00Z'))
    const g3Inactives = (await provider.getInactives(SEASON, WEEK)).find((i) => i.gameId === G3)
    expect(g3Inactives?.publishedAt).toEqual(new Date('2026-09-20T19:35:00Z'))

    // 22:00Z is mid-game in the NEW slot — under the original Mon 00:20Z
    // kickoff there would be no line yet. The move moved the world.
    clock.advanceTo(new Date('2026-09-20T22:00:00Z'))
    expect((await scheduleGame(provider, G3))?.status).toBe('live')
    expect(await statsFor(provider, 'syn-g3-qb')).toBeDefined()
  })
})

describe('postponement (E43)', () => {
  it('postpones G2 out of the week at the announcement; its players score 0 all week', async () => {
    const { provider, clock } = makeProvider('postponement')

    clock.advanceTo(new Date('2026-09-20T14:59:59Z'))
    expect((await scheduleGame(provider, G2))?.status).toBe('scheduled')

    clock.advanceTo(new Date('2026-09-20T15:00:00Z'))
    expect(await scheduleGame(provider, G2)).toMatchObject({
      status: 'postponed',
      kickoffAt: new Date('2026-09-27T20:25:00Z'), // beyond the week — locks release downstream (§23.3)
      gameDate: '2026-09-27',
    })

    // No official inactives list for a postponed game; through the original
    // slot and to week's end its players emit nothing, others play on.
    clock.advanceTo(new Date('2026-09-20T22:00:00Z')) // would-be mid-G2
    expect((await provider.getInactives(SEASON, WEEK)).map((i) => i.gameId)).not.toContain(G2)
    expect(await statsFor(provider, 'syn-g2-qb')).toBeUndefined()
    expect(await statsFor(provider, 'syn-g1-qb')).toBeDefined()

    clock.advanceTo(new Date('2026-09-25T12:00:00Z'))
    expect(await statsFor(provider, 'syn-g2-qb')).toBeUndefined()
  })
})

describe('mass_inactives', () => {
  it('publishes the mass scratch list on the normal ~90-min schedule and none of them ever score', async () => {
    const { provider, clock } = makeProvider('mass_inactives')

    clock.advanceTo(new Date('2026-09-20T15:30:00Z')) // G1 kickoff − 90
    const g1 = (await provider.getInactives(SEASON, WEEK)).find((i) => i.gameId === G1)
    expect(g1?.playerIds).toEqual(['syn-g1-rb', 'syn-g1-wr', 'syn-g1-te', 'syn-g1-k'])

    clock.advanceTo(new Date('2026-09-20T18:55:00Z')) // G2 kickoff − 90
    const g2 = (await provider.getInactives(SEASON, WEEK)).find((i) => i.gameId === G2)
    expect(g2?.playerIds).toEqual(['syn-g2-qb', 'syn-g2-rb', 'syn-g2-wr'])

    clock.advanceTo(new Date('2026-09-25T12:00:00Z'))
    const rows = await provider.getWeekStats(SEASON, WEEK)
    const scratched = [...(g1?.playerIds ?? []), ...(g2?.playerIds ?? [])]
    expect(scratched).toHaveLength(7)
    for (const playerId of scratched) {
      expect(rows.find((r) => r.playerId === playerId), playerId).toBeUndefined()
    }
    // The games still played — the remaining G1/G2 players all have lines.
    expect(rows.filter((r) => r.gameId === G1).map((r) => r.playerId).sort()).toEqual([
      'syn-g1-def',
      'syn-g1-qb',
    ])
    expect(rows.filter((r) => r.gameId === G2).map((r) => r.playerId).sort()).toEqual([
      'syn-g2-def',
      'syn-g2-k',
      'syn-g2-te',
    ])
  })
})

describe('provider_outage (§23.2 / E45)', () => {
  it('throws from every method inside the window; DegradationTracker degrades after 3 failed polls and clears on recovery', async () => {
    const { provider, clock } = makeProvider('provider_outage')
    const tracker = new DegradationTracker()

    async function poll(): Promise<boolean> {
      try {
        await provider.getWeekStats(SEASON, WEEK)
        tracker.recordPollResult(true)
        return true
      } catch {
        tracker.recordPollResult(false)
        return false
      }
    }

    // Healthy poll just before the outage.
    clock.advanceTo(new Date('2026-09-20T17:59:35Z'))
    expect(await poll()).toBe(true)
    expect(tracker.degraded).toBe(false)

    // Inside the window every contract method throws — all five checked.
    clock.advanceTo(new Date('2026-09-20T18:00:00Z'))
    await expect(provider.getSchedule(SEASON)).rejects.toThrow(/outage/)
    await expect(provider.getGameStates(SEASON, WEEK)).rejects.toThrow(/outage/)
    await expect(provider.getWeekStats(SEASON, WEEK)).rejects.toThrow(/outage/)
    await expect(provider.getInjuries(SEASON, WEEK)).rejects.toThrow(/outage/)
    await expect(provider.getInactives(SEASON, WEEK)).rejects.toThrow(/outage/)

    // Three consecutive failed polls on the game-window cadence → degraded
    // exactly at the third, not before (§23.2).
    for (const [iso, expectedDegraded] of [
      ['2026-09-20T18:00:25Z', false],
      ['2026-09-20T18:00:50Z', false],
      ['2026-09-20T18:01:15Z', true],
      ['2026-09-20T18:20:00Z', true], // stays degraded while the outage runs
    ] as const) {
      clock.advanceTo(new Date(iso))
      expect(await poll()).toBe(false)
      expect(tracker.degraded, iso).toBe(expectedDegraded)
    }

    // First poll at the window's end succeeds and clears the flag.
    clock.advanceTo(new Date('2026-09-20T18:40:00Z'))
    expect(await poll()).toBe(true)
    expect(tracker.degraded).toBe(false)
  })

  it('back-fills cumulative lines on recovery — the recovered read equals an outage-free world', async () => {
    const at = new Date('2026-09-20T18:45:00Z') // 5 min after recovery, mid-G1
    const outage = makeProvider('provider_outage')
    const clean = makeProvider('happy_path') // same seed ⇒ same lines
    outage.clock.advanceTo(at)
    clean.clock.advanceTo(at)
    const g1Rows = async (provider: SyntheticStatsProvider) =>
      (await provider.getWeekStats(SEASON, WEEK)).filter((r) => r.gameId === G1)
    const recovered = await g1Rows(outage.provider)
    expect(recovered.length).toBeGreaterThan(0)
    expect(recovered).toEqual(await g1Rows(clean.provider))
  })
})

describe('correction_in_window (E44 / E10)', () => {
  it('moves the corrected key by the delta from the honestly-dated event time, inside the window', async () => {
    const { provider, clock, scenario } = makeProvider('correction_in_window')
    const correction = scenario.corrections[0]
    expect(correction.at.getTime()).toBeLessThan(scenario.correctionWindowEndsAt.getTime())

    clock.advanceTo(new Date('2026-09-21T12:00:00Z')) // Monday: final, uncorrected
    const before = await statsFor(provider, 'syn-g1-wr')
    const uncorrected = before?.stats.receiving_yards as number

    clock.advanceTo(new Date('2026-09-22T15:59:59Z')) // 1s before the correction
    expect((await statsFor(provider, 'syn-g1-wr'))?.stats.receiving_yards).toBe(uncorrected)

    clock.advanceTo(new Date('2026-09-22T16:00:00Z')) // correction instant
    const after = await statsFor(provider, 'syn-g1-wr')
    expect(after?.stats.receiving_yards).toBe(uncorrected + 7)
    // Only the corrected key moved.
    expect({ ...after?.stats, receiving_yards: uncorrected }).toEqual(before?.stats)
  })
})

describe('correction_post_window (E44 late arm)', () => {
  it('dates the correction after correction_window_ends_at and holds the old value through the window', async () => {
    const { provider, clock, scenario } = makeProvider('correction_post_window')
    const correction = scenario.corrections[0]
    // The provider's whole §23.4 obligation: date it honestly, after the
    // window. Flag-vs-auto-apply is downstream behavior, not the provider's.
    expect(correction.at.getTime()).toBeGreaterThan(scenario.correctionWindowEndsAt.getTime())

    clock.advanceTo(new Date('2026-09-21T12:00:00Z'))
    const uncorrected = (await statsFor(provider, 'syn-g1-wr'))?.stats.receiving_yards as number

    clock.advanceTo(scenario.correctionWindowEndsAt) // window closes: still uncorrected
    expect((await statsFor(provider, 'syn-g1-wr'))?.stats.receiving_yards).toBe(uncorrected)

    clock.advanceTo(new Date('2026-09-25T12:00:00Z')) // the late event lands
    expect((await statsFor(provider, 'syn-g1-wr'))?.stats.receiving_yards).toBe(uncorrected - 6)
  })
})

describe('charted_late (E55 / E57)', () => {
  it('misses the declared SLA — pending at slaAt, posting later — while other games settle on time', async () => {
    const { provider, clock, scenario } = makeProvider('charted_late')
    const g1 = scenario.games.find((g) => g.gameId === G1)
    expect(g1).toBeDefined()
    expect(g1?.chartedPostAt.getTime()).toBeGreaterThan(g1?.chartedSlaAt.getTime() ?? Infinity)

    // At G1's SLA instant: charted still absent, advancedFinalAt still null —
    // the honest "charting is late" observable (banner is downstream).
    clock.advanceTo(new Date('2026-09-21T17:00:00Z'))
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced).not.toHaveProperty(
      CHARTED_PLACEHOLDER_KEY,
    )
    expect((await gameState(provider, G1))?.advancedFinalAt).toBeNull()
    // G2 posted on its normal Monday schedule — the lateness is per-game.
    expect((await statsFor(provider, 'syn-g2-wr'))?.advanced[CHARTED_PLACEHOLDER_KEY]).toBeGreaterThan(0)
    expect((await gameState(provider, G2))?.advancedFinalAt).toEqual(
      new Date('2026-09-21T15:00:00Z'),
    )

    // The slipped post finally lands Wednesday.
    clock.advanceTo(new Date('2026-09-23T14:59:59Z'))
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced).not.toHaveProperty(
      CHARTED_PLACEHOLDER_KEY,
    )
    clock.advanceTo(new Date('2026-09-23T15:00:00Z'))
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced[CHARTED_PLACEHOLDER_KEY]).toBeGreaterThan(0)
    expect((await gameState(provider, G1))?.advancedFinalAt).toEqual(
      new Date('2026-09-23T15:00:00Z'),
    )
  })
})

describe('charted_revision (E56)', () => {
  it('revises an already-posted charted value at the revision instant, leaving advancedFinalAt unchanged', async () => {
    const { provider, clock } = makeProvider('charted_revision')

    clock.advanceTo(new Date('2026-09-21T15:00:00Z')) // Monday post
    const posted = (await statsFor(provider, 'syn-g1-wr'))?.advanced[
      CHARTED_PLACEHOLDER_KEY
    ] as number
    expect(posted).toBeGreaterThan(0)

    clock.advanceTo(new Date('2026-09-23T11:59:59Z')) // 1s before the revision
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced[CHARTED_PLACEHOLDER_KEY]).toBe(posted)

    clock.advanceTo(new Date('2026-09-23T12:00:00Z')) // revision lands
    expect((await statsFor(provider, 'syn-g1-wr'))?.advanced[CHARTED_PLACEHOLDER_KEY]).toBe(
      posted + 9,
    )
    // The game's charted post time is unchanged — a revision is a correction
    // (§23.5 → §23.4 machinery downstream), not a re-post.
    expect((await gameState(provider, G1))?.advancedFinalAt).toEqual(
      new Date('2026-09-21T15:00:00Z'),
    )
  })
})
