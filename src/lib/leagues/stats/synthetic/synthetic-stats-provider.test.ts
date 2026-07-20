import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { VirtualClock } from '../../time/virtual-clock'
import { STAT_KEYS } from '../stat-keys'
import type { ScenarioId } from './scenario'
import { SCENARIO_IDS } from './scenario'
import { DEFAULT_SEED, makeScenario, SCENARIO_LIBRARY_VERSION } from './scenarios'
import { SyntheticStatsProvider } from './synthetic-stats-provider'

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

const WEEK_START = new Date('2026-09-16T04:00:00Z') // Wed 00:00 ET, 2026 wk2
const WEEK_END = new Date('2026-09-26T04:00:00Z')
const SEASON = 2026
const WEEK = 2

function makeProvider(id: ScenarioId, seed: number = DEFAULT_SEED, startAt: Date = WEEK_START) {
  const clock = new VirtualClock(startAt)
  const provider = new SyntheticStatsProvider(makeScenario(id, seed), clock)
  return { provider, clock }
}

const METHODS = [
  'getSchedule',
  'getGameStates',
  'getWeekStats',
  'getInjuries',
  'getInactives',
] as const

/** Poll all five methods hourly across the whole week; recorded failures are
 *  part of the transcript (outage windows replay as failures, D6 spirit). */
async function fullWeekTranscript(id: ScenarioId, seed: number): Promise<unknown[]> {
  const { provider, clock } = makeProvider(id, seed)
  const transcript: unknown[] = []
  const HOUR = 60 * 60 * 1000
  for (let t = WEEK_START.getTime(); t <= WEEK_END.getTime(); t += HOUR) {
    clock.advanceTo(new Date(t))
    for (const method of METHODS) {
      try {
        const body =
          method === 'getSchedule'
            ? await provider.getSchedule(SEASON)
            : await provider[method](SEASON, WEEK)
        transcript.push({ t, method, ok: true, body: JSON.parse(JSON.stringify(body)) })
      } catch (err) {
        transcript.push({ t, method, ok: false, error: (err as Error).message })
      }
    }
  }
  return transcript
}

/** Blank out every numeric stat value, keeping keys and all event timing —
 *  the "event skeleton" that must be seed-independent. */
function skeletonOf(transcript: unknown[]): unknown[] {
  return JSON.parse(
    JSON.stringify(transcript, (key, value) =>
      typeof value === 'number' && key !== 't' ? 'X' : value,
    ),
  )
}

describe('SyntheticStatsProvider contract', () => {
  it('declares the synthetic identity and all three §23.5 capability tiers', () => {
    const { provider } = makeProvider('happy_path')
    expect(provider.name).toBe('synthetic')
    expect([...provider.capabilities].sort()).toEqual(['charted', 'core_box', 'tracking'])
  })

  it('scopes every read to the scenario season/week — mismatches return empty', async () => {
    const { provider, clock } = makeProvider('happy_path')
    clock.advanceTo(new Date('2026-09-20T18:00:00Z')) // mid-game, data exists
    expect(await provider.getSchedule(2025)).toEqual([])
    expect(await provider.getGameStates(SEASON, 3)).toEqual([])
    expect(await provider.getWeekStats(2025, WEEK)).toEqual([])
    expect(await provider.getInjuries(SEASON, 1)).toEqual([])
    expect(await provider.getInactives(2027, WEEK)).toEqual([])
    // ...and the matching (season, week) is non-empty at the same instant.
    expect((await provider.getWeekStats(SEASON, WEEK)).length).toBeGreaterThan(0)
  })

  it('emits only registry-canonical keys — core_box in stats, D15 placeholders in advanced (L.A0.2a cross-invariant)', async () => {
    const byKey = new Map(STAT_KEYS.map((def) => [def.key, def]))
    for (const id of SCENARIO_IDS) {
      const { provider, clock } = makeProvider(id)
      clock.advanceTo(new Date('2026-09-25T12:00:00Z')) // post-charted, post-corrections
      const rows = await provider.getWeekStats(SEASON, WEEK)
      expect(rows.length, id).toBeGreaterThan(0)
      for (const row of rows) {
        for (const key of Object.keys(row.stats)) {
          const def = byKey.get(key)
          expect(def, `${id}: unregistered stats key ${key}`).toBeDefined()
          expect(def?.tier, `${id}: ${key}`).toBe('core_box')
        }
        for (const key of Object.keys(row.advanced)) {
          const def = byKey.get(key)
          expect(def, `${id}: unregistered advanced key ${key}`).toBeDefined()
          expect(def?.placeholder, `${id}: ${key} must be a D15 placeholder`).toBe(true)
        }
      }
    }
  })

  it('ships all nine §23.6 scenarios, versioned', () => {
    expect(SCENARIO_IDS).toHaveLength(9)
    expect(SCENARIO_LIBRARY_VERSION).toBe(2)
    for (const id of SCENARIO_IDS) {
      const scenario = makeScenario(id)
      expect(scenario.id).toBe(id)
      expect(scenario.version).toBe(2)
      expect(scenario.seed).toBe(DEFAULT_SEED)
    }
  })
})

describe('golden pins (R23 — the version-bump tripwire)', () => {
  // WHY THESE LITERALS EXIST: the determinism tests above compare two
  // in-process runs of the same code, so an *unintended* behavior change — a
  // draw-order refactor in finalLine, a range tweak, a PRNG edit — would
  // change every scenario's "deterministic" world while the suite stayed
  // green, silently diverging anything pinned against the current library
  // version. These hardcoded DEFAULT_SEED outputs (scenario library v2) fail
  // on ANY such change, making the D26/§23.6 contract mechanical: if a pin
  // breaks, either revert the behavior change or bump SCENARIO_LIBRARY_VERSION
  // (+ per-scenario versions) and update the pins deliberately in the same
  // commit. Never "fix" a pin without a version bump.

  it('pins the settled DEFAULT_SEED stat line for one player per position (happy_path, post-charted)', async () => {
    const { provider, clock } = makeProvider('happy_path')
    clock.advanceTo(new Date('2026-09-25T12:00:00Z')) // settled + charted posted
    const rows = await provider.getWeekStats(SEASON, WEEK)
    const g1 = ['syn-g1-qb', 'syn-g1-rb', 'syn-g1-wr', 'syn-g1-te', 'syn-g1-k', 'syn-g1-def']
    expect(rows.filter((r) => g1.includes(r.playerId))).toEqual([
      {
        playerId: 'syn-g1-qb',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: {
          pass_attempts: 36,
          pass_completions: 23,
          pass_yards: 188,
          pass_tds: 0,
          interceptions: 0,
          qb_sack_taken: 3,
          rush_attempts: 5,
          rush_yards: 4,
        },
        advanced: { example_tracking_yards: 123 },
      },
      {
        playerId: 'syn-g1-rb',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: {
          rush_attempts: 18,
          rush_yards: 100,
          rush_tds: 1,
          targets: 3,
          receptions: 0,
          receiving_yards: 36,
          fumbles_lost: 1,
        },
        advanced: { example_tracking_yards: 46, example_charted_yards: 32 },
      },
      {
        playerId: 'syn-g1-wr',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: {
          targets: 12,
          receptions: 5,
          receiving_yards: 122,
          receiving_tds: 2,
          rush_yards: 10,
        },
        advanced: { example_tracking_yards: 66, example_charted_yards: 51 },
      },
      {
        playerId: 'syn-g1-te',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: { targets: 8, receptions: 7, receiving_yards: 47, receiving_tds: 0 },
        advanced: { example_tracking_yards: 31, example_charted_yards: 15 },
      },
      {
        playerId: 'syn-g1-k',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: {
          fg_attempted: 1,
          fg_made: 1,
          fg_40_49: 0,
          fg_50_plus: 1,
          pat_made: 3,
          pat_attempted: 3,
        },
        advanced: {},
      },
      {
        playerId: 'syn-g1-def',
        season: SEASON,
        week: WEEK,
        gameId: '2026-wk02-DAL@PHI',
        stats: {
          def_sack: 4,
          def_int: 1,
          def_fumble_rec: 1,
          def_td: 0,
          def_safety: 0,
          def_points_allowed: 30,
        },
        advanced: {},
      },
    ])
  })

  it('pins a mid-game partial line — the floor(final × progress) path (happy_path, 18:00Z)', async () => {
    const { provider, clock } = makeProvider('happy_path')
    clock.advanceTo(new Date('2026-09-20T18:00:00Z')) // 1h into G1's 3h20m
    const qb = (await provider.getWeekStats(SEASON, WEEK)).find((r) => r.playerId === 'syn-g1-qb')
    expect(qb).toEqual({
      playerId: 'syn-g1-qb',
      season: SEASON,
      week: WEEK,
      gameId: '2026-wk02-DAL@PHI',
      stats: {
        pass_attempts: 10,
        pass_completions: 6,
        pass_yards: 56,
        pass_tds: 0,
        interceptions: 0,
        qb_sack_taken: 0,
        rush_attempts: 1,
        rush_yards: 1,
      },
      advanced: { example_tracking_yards: 36 },
    })
  })

  it('pins the corrected value at the correction instant (correction_in_window)', async () => {
    const { provider, clock } = makeProvider('correction_in_window')
    clock.advanceTo(new Date('2026-09-22T16:00:00Z')) // exactly the correction event
    const wr = (await provider.getWeekStats(SEASON, WEEK)).find((r) => r.playerId === 'syn-g1-wr')
    // Settled 122 + delta 7 — same seed world as the happy_path pin above.
    expect(wr?.stats.receiving_yards).toBe(129)
  })
})

describe('determinism (§23.6 — same seed = same world)', () => {
  it('produces deep-equal full-week transcripts for the same (scenario, seed) — all nine scenarios', async () => {
    for (const id of SCENARIO_IDS) {
      const first = await fullWeekTranscript(id, DEFAULT_SEED)
      const second = await fullWeekTranscript(id, DEFAULT_SEED)
      expect(second, id).toEqual(first)
    }
  }, 30_000)

  it('changes stat lines but not the event skeleton under a different seed', async () => {
    const base = await fullWeekTranscript('happy_path', DEFAULT_SEED)
    const reseeded = await fullWeekTranscript('happy_path', 777)
    expect(reseeded).not.toEqual(base) // lines differ...
    expect(skeletonOf(reseeded)).toEqual(skeletonOf(base)) // ...skeleton identical
  })

  it('keeps stat lines scenario-independent for the same seed (back-fill comparability)', async () => {
    // Same seed, different scenario id → identical G1 lines at the same
    // instant (prng streams are keyed by seed+player only; scenarios only
    // add events). provider_outage relies on this in its back-fill proof.
    const at = new Date('2026-09-20T19:00:00Z')
    const happy = makeProvider('happy_path')
    const outage = makeProvider('provider_outage')
    happy.clock.advanceTo(at)
    outage.clock.advanceTo(at)
    const g1 = (rows: Awaited<ReturnType<SyntheticStatsProvider['getWeekStats']>>) =>
      rows.filter((r) => r.gameId === '2026-wk02-DAL@PHI')
    expect(g1(await outage.provider.getWeekStats(SEASON, WEEK))).toEqual(
      g1(await happy.provider.getWeekStats(SEASON, WEEK)),
    )
  })
})
