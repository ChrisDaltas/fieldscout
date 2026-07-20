import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TimeProvider } from '../../time/time-provider'
import { VirtualClock } from '../../time/virtual-clock'
import { STAT_KEYS } from '../stat-keys'
import type { StatsProvider } from '../stats-provider'
import {
  FIXTURE_FORMAT,
  FIXTURE_FORMAT_VERSION,
  parseFixture,
  reviveDates,
  serializeFixture,
  type FixtureRecording,
} from './fixture-format'
import { FixtureReplayProvider, ReplayedFailureError } from './fixture-replay-provider'
import { MemoryFixtureSink, RecordingStatsProvider } from './recording-stats-provider'

// ── Zero external calls, mechanically proven ────────────────────────────────
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('fixture layer made an external call — L.A0.4 violation')
    }),
  )
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const SEASON = 2026
const WEEK = 2
const REC_START = new Date('2026-09-20T17:00:00Z')
const MIN = 60_000

/**
 * Inline stub provider (deliberately NOT SyntheticStatsProvider — the
 * recorder↔synthetic composition proof lives in L.A0.6, keeping L.A0.4
 * parallel with L.A0.3). World state is a pure function of elapsed virtual
 * time; every §23.1 method throws inside the [5min, 10min) failure window.
 */
function makeStub(time: TimeProvider): StatsProvider {
  const elapsed = () => time.now().getTime() - REC_START.getTime()
  const failIfDown = () => {
    const e = elapsed()
    if (e >= 5 * MIN && e < 10 * MIN) {
      throw new Error(`stub outage at +${Math.floor(e / MIN)}min`)
    }
  }
  return {
    name: 'stub',
    capabilities: new Set(['core_box']),
    async getSchedule(season) {
      failIfDown()
      return [
        {
          gameId: 'stub-g1',
          season,
          week: WEEK,
          homeTeam: 'PHI',
          awayTeam: 'DAL',
          kickoffAt: REC_START, // a real Date — must survive replay as a Date
          gameDate: '2026-09-20', // a date-only string — must STAY a string
          status: elapsed() < 200 * MIN ? 'live' : 'final',
        },
      ]
    },
    async getGameStates() {
      failIfDown()
      return [{ gameId: 'stub-g1', status: 'live', advancedFinalAt: null }]
    },
    async getWeekStats(season, week) {
      failIfDown()
      return [
        {
          playerId: 'stub-rb',
          season,
          week,
          gameId: 'stub-g1',
          stats: { rush_yards: Math.floor(elapsed() / MIN), rush_attempts: Math.floor(elapsed() / (2 * MIN)) },
          advanced: {},
        },
      ]
    },
    async getInjuries() {
      failIfDown()
      return [
        {
          playerId: 'stub-rb',
          designation: 'questionable',
          gameId: 'stub-g1',
          reportedAt: new Date('2026-09-18T20:00:00Z'),
        },
      ]
    },
    async getInactives() {
      failIfDown()
      return [{ gameId: 'stub-g1', playerIds: ['stub-te'], publishedAt: new Date('2026-09-20T15:30:00Z') }]
    },
  }
}

interface TranscriptEntry {
  offsetMin: number
  method: string
  ok: boolean
  body?: unknown
  error?: string
}

const METHODS = ['getSchedule', 'getGameStates', 'getWeekStats', 'getInjuries', 'getInactives'] as const

async function pollAll(
  provider: StatsProvider,
  offsetMin: number,
  transcript: TranscriptEntry[],
): Promise<void> {
  for (const method of METHODS) {
    try {
      const body =
        method === 'getSchedule'
          ? await provider.getSchedule(SEASON)
          : await provider[method](SEASON, WEEK)
      transcript.push({ offsetMin, method, ok: true, body })
    } catch (err) {
      transcript.push({ offsetMin, method, ok: false, error: (err as Error).message })
    }
  }
}

/** Poll offsets (minutes from session start): brackets the failure window
 *  [5, 10) with in-window polls at 6/8 and the recovery poll at 10. */
const POLL_OFFSETS = [0, 2, 4, 6, 8, 10, 12, 14]

/** Record a full stub session once; both the recording and the live
 *  transcript come back for comparison. */
async function recordStubSession(): Promise<{
  recording: FixtureRecording
  liveTranscript: TranscriptEntry[]
}> {
  const clock = new VirtualClock(REC_START)
  const sink = new MemoryFixtureSink()
  const recorder = new RecordingStatsProvider(makeStub(clock), sink, clock)
  const liveTranscript: TranscriptEntry[] = []
  for (const offsetMin of POLL_OFFSETS) {
    clock.advanceTo(new Date(REC_START.getTime() + offsetMin * MIN))
    await pollAll(recorder, offsetMin, liveTranscript)
  }
  return {
    recording: {
      header: { format: FIXTURE_FORMAT, version: FIXTURE_FORMAT_VERSION, provider: 'stub', season: SEASON, week: WEEK },
      entries: sink.entries,
    },
    liveTranscript,
  }
}

/** A replay session anchored at a completely different virtual date — the
 *  D6 first-timestamp anchoring is what makes this legal. */
const REPLAY_ANCHOR = new Date('2026-10-01T00:00:00Z')

function makeReplay(recording: FixtureRecording, opts: { speed?: number; wallClock?: TimeProvider } = {}) {
  const clock = new VirtualClock(REPLAY_ANCHOR, opts)
  const provider = new FixtureReplayProvider(recording, clock)
  return { provider, clock }
}

describe('record → replay round trip (D6)', () => {
  it('reproduces the live transcript exactly — bodies, Dates, and failure windows included', async () => {
    const { recording, liveTranscript } = await recordStubSession()
    // Serialize → parse first, so the round trip covers the on-disk format.
    const parsed = parseFixture(serializeFixture(recording))

    const { provider, clock } = makeReplay(parsed)
    const replayTranscript: TranscriptEntry[] = []
    for (const offsetMin of POLL_OFFSETS) {
      clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + offsetMin * MIN))
      await pollAll(provider, offsetMin, replayTranscript)
    }
    expect(replayTranscript).toEqual(liveTranscript)
  })

  it('revives full ISO timestamps as Dates and leaves date-only strings alone', async () => {
    const { recording } = await recordStubSession()
    const { provider } = makeReplay(parseFixture(serializeFixture(recording)))
    const [game] = await provider.getSchedule(SEASON)
    expect(game.kickoffAt).toBeInstanceOf(Date)
    expect(game.kickoffAt).toEqual(REC_START)
    expect(game.gameDate).toBe('2026-09-20') // never revived into a Date
    const [injury] = await provider.getInjuries(SEASON, WEEK)
    expect(injury.reportedAt).toEqual(new Date('2026-09-18T20:00:00Z'))
  })

  it('reports fixture identity honestly (D27/D28): name is fixture:<source>, recorded name exposed', async () => {
    const { recording } = await recordStubSession()
    const { provider } = makeReplay(recording)
    expect(provider.name).toBe('fixture:stub')
    expect(provider.recordedProviderName).toBe('stub')
  })
})

describe('latest-response-≤-virtual-now semantics (D6)', () => {
  it('serves the previous poll until the exact instant the next one was captured', async () => {
    const { recording } = await recordStubSession()
    const { provider, clock } = makeReplay(recording)

    clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 3 * MIN + 59_000)) // 3:59 — before the 4min poll...
    const between = await provider.getWeekStats(SEASON, WEEK)
    expect(between[0].stats.rush_yards).toBe(2) // still the 2-min poll's value

    clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 4 * MIN)) // exactly the 4-min stamp
    const at = await provider.getWeekStats(SEASON, WEEK)
    expect(at[0].stats.rush_yards).toBe(4)
  })

  it('is poll-cadence independent: jumping straight to an instant equals walking there', async () => {
    const { recording } = await recordStubSession()

    const walked = makeReplay(recording)
    for (const offsetMin of POLL_OFFSETS) {
      walked.clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + offsetMin * MIN))
      try {
        await walked.provider.getWeekStats(SEASON, WEEK)
      } catch {
        // in-window failures are part of the walk
      }
    }
    const jumped = makeReplay(recording)
    jumped.clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 14 * MIN))

    expect(await jumped.provider.getWeekStats(SEASON, WEEK)).toEqual(
      await walked.provider.getWeekStats(SEASON, WEEK),
    )
  })

  it('throws (never invents) before the first recorded response for a call', async () => {
    const { recording } = await recordStubSession()
    // Drop the first two getInactives polls so its earliest entry is at +4min.
    const pruned: FixtureRecording = {
      header: recording.header,
      entries: recording.entries.filter(
        (e) => e.method !== 'getInactives' || new Date(e.t).getTime() >= REC_START.getTime() + 4 * MIN,
      ),
    }
    const { provider } = makeReplay(pruned) // virtual now = anchor = recording start
    await expect(provider.getInactives(SEASON, WEEK)).rejects.toThrow(/no recorded response yet/)
    // ...while an already-recorded call at the same instant still serves.
    expect((await provider.getWeekStats(SEASON, WEEK))[0].stats.rush_yards).toBe(0)
  })

  it('throws on calls the session never recorded instead of guessing', async () => {
    const { recording } = await recordStubSession()
    const { provider } = makeReplay(recording)
    await expect(provider.getWeekStats(SEASON, 3)).rejects.toThrow(/never recorded getWeekStats\(2026,3\)/)
  })
})

describe('failure-window replay (D6 / §23.2)', () => {
  it('replays recorded failures as throws with the recorded message, then recovers on schedule', async () => {
    const { recording } = await recordStubSession()
    const { provider, clock } = makeReplay(recording)

    clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 6 * MIN))
    await expect(provider.getWeekStats(SEASON, WEEK)).rejects.toThrow('stub outage at +6min')
    clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 8 * MIN))
    await expect(provider.getSchedule(SEASON)).rejects.toThrow('stub outage at +8min')

    // The 10-min poll recovered — replay serves the cumulative back-fill.
    clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + 10 * MIN))
    expect((await provider.getWeekStats(SEASON, WEEK))[0].stats.rush_yards).toBe(10)
  })

  it('carries the recorded status on replayed failures — not just the message (R29)', async () => {
    const recording: FixtureRecording = {
      header: {
        format: FIXTURE_FORMAT,
        version: FIXTURE_FORMAT_VERSION,
        provider: 'stub',
        season: SEASON,
        week: WEEK,
      },
      entries: [
        {
          t: REC_START.toISOString(),
          method: 'getWeekStats',
          args: [SEASON, WEEK],
          ok: false,
          status: 429,
          error: 'rate limited',
        },
      ],
    }
    const { provider } = makeReplay(parseFixture(serializeFixture(recording)))
    const err = await provider.getWeekStats(SEASON, WEEK).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReplayedFailureError)
    expect((err as ReplayedFailureError).message).toBe('rate limited')
    expect((err as ReplayedFailureError).status).toBe(429)
  })
})

describe('replay pacing equivalence (M0 exit criterion 1: 1×/4×/64×)', () => {
  it.each([1, 4, 64])('wall-paced %d× matches step mode at the same virtual instants', async (speed) => {
    const { recording } = await recordStubSession()

    const step = makeReplay(recording)
    let wallMs = 0
    const wallClock: TimeProvider = { now: () => new Date(wallMs) }
    const paced = makeReplay(recording, { speed, wallClock })

    for (const offsetMin of [0, 2, 6, 10, 14]) {
      step.clock.advanceTo(new Date(REPLAY_ANCHOR.getTime() + offsetMin * MIN))
      wallMs = (offsetMin * MIN) / speed // wall advances 1/speed as fast

      const results = await Promise.allSettled([
        step.provider.getWeekStats(SEASON, WEEK),
        paced.provider.getWeekStats(SEASON, WEEK),
      ])
      expect(results[1].status, `offset ${offsetMin}`).toBe(results[0].status)
      if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
        expect(results[1].value).toEqual(results[0].value)
      } else if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        expect((results[1].reason as Error).message).toBe((results[0].reason as Error).message)
      }
    }
  })
})

describe('fixture format', () => {
  it('serialize → parse is lossless and pins the header shape', async () => {
    const { recording } = await recordStubSession()
    const parsed = parseFixture(serializeFixture(recording))
    expect(parsed).toEqual(recording)
    expect(parsed.header).toEqual({
      format: 'fieldscout-fixture',
      version: 1,
      provider: 'stub',
      season: SEASON,
      week: WEEK,
    })
  })

  it('rejects unknown formats and versions loudly', () => {
    expect(() => parseFixture('{"format":"something-else","version":1}\n')).toThrow(/unrecognized format/)
    expect(() => parseFixture(`{"format":"${FIXTURE_FORMAT}","version":99}\n`)).toThrow(/unsupported version/)
    expect(() => parseFixture('')).toThrow(/empty file/)
  })

  it('rejects headers missing the D27 identity fields loudly (R28)', () => {
    // Without this, a provider-less header parses fine and flows downstream
    // as name = 'fixture:undefined'.
    const base = `"format":"${FIXTURE_FORMAT}","version":${FIXTURE_FORMAT_VERSION}`
    expect(() => parseFixture(`{${base},"season":2026,"week":2}\n`)).toThrow(
      /missing provider identity/,
    )
    expect(() => parseFixture(`{${base},"provider":"","season":2026,"week":2}\n`)).toThrow(
      /missing provider identity/,
    )
    expect(() => parseFixture(`{${base},"provider":"sleeper","week":2}\n`)).toThrow(
      /missing season\/week/,
    )
    expect(() => parseFixture(`{${base},"provider":"sleeper","season":2026}\n`)).toThrow(
      /missing season\/week/,
    )
  })

  it('reviveDates is strict: date-only and non-date strings never become Dates', () => {
    expect(reviveDates({ a: '2026-09-20', b: 'PHI', c: '2026-09-20T17:00:00.000Z', d: [null, 3] })).toEqual({
      a: '2026-09-20',
      b: 'PHI',
      c: new Date('2026-09-20T17:00:00.000Z'),
      d: [null, 3],
    })
  })
})

describe('checked-in real 2025 week (D7 cross-check)', () => {
  const FIXTURE_PATH = join(process.cwd(), 'fixtures/nfl/2025/wk02/sleeper.jsonl.gz')

  it('exists, parses, and covers all five §23.1 methods from the sleeper source', () => {
    expect(existsSync(FIXTURE_PATH), `missing ${FIXTURE_PATH} — record via npm run record:fixtures -- 2025 2`).toBe(true)
    const recording = parseFixture(gunzipSync(readFileSync(FIXTURE_PATH)).toString('utf8'))
    expect(recording.header).toMatchObject({ provider: 'sleeper', season: 2025, week: 2 })
    const recordedMethods = new Set(recording.entries.map((e) => e.method))
    expect([...recordedMethods].sort()).toEqual([...METHODS].sort())
  })

  it('replays real week-2 finals with registry-canonical keys (L.A0.2a cross-invariant)', async () => {
    const recording = parseFixture(gunzipSync(readFileSync(FIXTURE_PATH)).toString('utf8'))
    const clock = new VirtualClock(REPLAY_ANCHOR)
    const provider = new FixtureReplayProvider(recording, clock)
    expect(provider.name).toBe('fixture:sleeper')
    // A single-poll session's five stamps span the poll's real wall duration
    // (the anchor maps to the FIRST stamp) — step past the whole poll before
    // reading, exactly as a replay harness would.
    clock.advanceBy(10 * MIN)

    const rows = await provider.getWeekStats(2025, 2)
    expect(rows.length).toBeGreaterThan(100) // a real NFL week, not a stub
    const canonical = new Set(STAT_KEYS.filter((d) => d.tier === 'core_box').map((d) => d.key))
    for (const row of rows) {
      expect(typeof row.playerId).toBe('string')
      for (const key of Object.keys(row.stats)) {
        expect(canonical.has(key), `non-canonical key in real fixture: ${key}`).toBe(true)
      }
    }

    const games = await provider.getSchedule(2025)
    const week2 = games.filter((g) => g.week === 2)
    expect(week2.length).toBeGreaterThanOrEqual(14)
    for (const game of week2) {
      expect(game.kickoffAt).toBeNull() // sleeper_free tier — Q1/D16
      expect(game.gameDate === null || typeof game.gameDate === 'string').toBe(true)
    }
  })
})
