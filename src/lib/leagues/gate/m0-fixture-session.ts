/**
 * M0 gate — the multi-poll determinism session (task L.A0.6 item 1; D7).
 *
 * Records a full synthetic happy_path week through RecordingStatsProvider —
 * the recorder↔synthetic composition proof deferred from L.A0.4. The checked-
 * in fixture at fixtures/nfl/2026/wk02/synthetic.jsonl.gz is EXACTLY this
 * function's output (scripts/record-synthetic-fixture.ts is a thin fs/gzip
 * shell); the gate re-records in-process and compares byte-for-byte, so any
 * unversioned scenario-library behavior change — or a tampered fixture —
 * fails loudly (same spirit as the R23 golden pins).
 *
 * Pure engine code (D1): no fs, no network, no wall clock — everything runs
 * on a VirtualClock over the §23.6 synthetic tier.
 */

import { VirtualClock } from '../time/virtual-clock'
import {
  FIXTURE_FORMAT,
  FIXTURE_FORMAT_VERSION,
  type FixtureRecording,
} from '../stats/fixtures/fixture-format'
import {
  MemoryFixtureSink,
  RecordingStatsProvider,
} from '../stats/fixtures/recording-stats-provider'
import { makeScenario } from '../stats/synthetic/scenarios'
import { SyntheticStatsProvider } from '../stats/synthetic/synthetic-stats-provider'

const MIN = 60_000

export const FIXTURE_SEASON = 2026
export const FIXTURE_WEEK = 2

/**
 * The canonical poll schedule for the recorded week — every instant inside
 * the seeded nfl_weeks (2026, 2) bounds (039: starts Wed 2026-09-16 00:00 ET,
 * correction window closes Thu 2026-09-24 06:00 ET; gate item 2c asserts
 * this containment against the migration itself).
 *
 * Shape: sparse polls at the week's pre-game event instants, a §23.2-style
 * cadence (20 virtual minutes) across the whole Sunday slate, then the
 * window-close/finalize/charted-post/correction beats. Multi-poll in-game
 * coverage is the point — only it exercises intra-week delta replay (D7).
 */
export function pollSchedule(): Date[] {
  const instants: Date[] = [
    new Date('2026-09-16T04:00:00Z'), // week starts (Wed 00:00 ET)
    new Date('2026-09-18T20:00:00Z'), // Friday injury report lands
    new Date('2026-09-20T15:30:00Z'), // G1 inactives publish (kickoff − 90m)
    new Date('2026-09-20T16:00:00Z'), // pre-kickoff
  ]
  // Sunday slate: first kickoff 17:00Z through SNF end (~03:40Z), every 20min.
  const slateStart = new Date('2026-09-20T17:00:00Z').getTime()
  const slateEnd = new Date('2026-09-21T04:00:00Z').getTime()
  for (let t = slateStart; t <= slateEnd; t += 20 * MIN) {
    instants.push(new Date(t))
  }
  instants.push(
    new Date('2026-09-21T12:00:00Z'), // ingestion window closes (inclusive edge)
    new Date('2026-09-21T12:20:00Z'), // first out-of-window poll → finalize pass
    new Date('2026-09-21T15:00:00Z'), // charted feed posts for G1/G2 (Mon AM)
    new Date('2026-09-22T15:00:00Z'), // charted feed posts for G3 (T+1)
    new Date('2026-09-22T16:00:00Z'), // Tuesday settled read
    new Date('2026-09-24T10:00:00Z'), // correction window closes (Thu 06:00 ET)
  )
  return instants
}

/**
 * Record the happy_path week over the canonical schedule. Deterministic:
 * same code + same library version → identical FixtureRecording, always.
 */
export async function recordHappyPathSession(): Promise<FixtureRecording> {
  const schedule = pollSchedule()
  const clock = new VirtualClock(schedule[0])
  const sink = new MemoryFixtureSink()
  const recorder = new RecordingStatsProvider(
    new SyntheticStatsProvider(makeScenario('happy_path'), clock),
    sink,
    clock,
  )

  for (const instant of schedule) {
    clock.advanceTo(instant)
    // Await each call before the clock moves again so sink entries land in
    // poll order. happy_path has no outage, but recording failures non-fatally
    // is the recorder's contract — keep the session honest about it.
    await recorder.getSchedule(FIXTURE_SEASON).catch(() => undefined)
    await recorder.getGameStates(FIXTURE_SEASON, FIXTURE_WEEK).catch(() => undefined)
    await recorder.getWeekStats(FIXTURE_SEASON, FIXTURE_WEEK).catch(() => undefined)
    await recorder.getInjuries(FIXTURE_SEASON, FIXTURE_WEEK).catch(() => undefined)
    await recorder.getInactives(FIXTURE_SEASON, FIXTURE_WEEK).catch(() => undefined)
  }

  return {
    header: {
      format: FIXTURE_FORMAT,
      version: FIXTURE_FORMAT_VERSION,
      provider: recorder.name, // 'synthetic' — never hardcoded (D27/R27)
      season: FIXTURE_SEASON,
      week: FIXTURE_WEEK,
    },
    entries: sink.entries,
  }
}
