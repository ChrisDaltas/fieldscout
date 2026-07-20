/**
 * M0 gate harness (task L.A0.6) — the milestone exit criteria from delivery
 * plan §3 (M0 row), as executable assertions:
 *
 *  1. A recorded week replays through the ingestion path (syncLiveStats,
 *     the L.A0.2b seam) at 1×/4×/64× deterministically — D11 reading:
 *     full-week step-driven ×3 identical + a wall-paced ≥3-poll-interval
 *     slice equivalent to step mode; the real 2025-wk2 fixture cross-checks.
 *  2. Every §23.6 synthetic scenario (all nine, library v2) runs to a
 *     passing assertion with zero external calls (fetch throws suite-wide).
 *  3. Calendar composition (gate item 2c): the scenario slate and the
 *     migration-039 nfl_weeks seed agree — asserted against the checked-in
 *     migration artifact itself (no DB, no network).
 *  4. R26: writer-side cumulative back-fill after an outage window, asserted
 *     against the capturing client (not just provider-side).
 *  5. R30/D29: replayed ingestion writes an honest `source` by default;
 *     byte-identical source semantics only via the deliberate
 *     impersonateRecordedProvider opt-in — and no silent path exists.
 *
 * Run as the tagged subset: `npm run test:gate`.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { syncLiveStats } from '@/lib/sync/live-stats'
import type { SyncClient } from '@/lib/sync/types'

import { DegradationTracker } from '../stats/degradation'
import { parseFixture, serializeFixture, type FixtureRecording } from '../stats/fixtures/fixture-format'
import {
  FixtureReplayProvider,
  impersonateRecordedProvider,
} from '../stats/fixtures/fixture-replay-provider'
import type { StatsProvider } from '../stats/stats-provider'
import type { ScenarioId } from '../stats/synthetic/scenario'
import { DEFAULT_SEED, makeScenario } from '../stats/synthetic/scenarios'
import {
  CHARTED_PLACEHOLDER_KEY,
  SyntheticStatsProvider,
} from '../stats/synthetic/synthetic-stats-provider'
import { VirtualClock } from '../time/virtual-clock'
import type { TimeProvider } from '../time/time-provider'
import {
  FIXTURE_SEASON,
  FIXTURE_WEEK,
  pollSchedule,
  recordHappyPathSession,
} from './m0-fixture-session'

// ── Zero external calls, mechanically proven (M0 exit criterion 2) ─────────
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('M0 gate violation: something made an external call')
    }),
  )
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const MIN = 60_000
const T = (s: string) => new Date(s)

// ── Golden pins (falsifiability: a changed world fails these literally) ─────
// SHA-256 of the serialized multi-poll fixture — pins scenario library v2 +
// fixture format v1. A deliberate behavior change regenerates via
// `npm run record:synthetic-fixture` and updates these literals in the same
// commit as the version bump (the D26/R23 contract, enforced mechanically).
const GOLDEN_FIXTURE_SHA256 =
  '093b83a04e7c5668eb99faf2968812691a39558b73755645b6bdb0781635f59f'
// SHA-256 of the full replayed upsert-batch sequence through the seam.
const GOLDEN_UPSERT_SHA256 =
  '44401b238dd71d9479d32bfc68d69b806295f095f4d4e2f5e453412ceeee2ccd'
const GOLDEN_UPSERT_BATCH_COUNT = 35

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ── Stateful capturing SyncClient ───────────────────────────────────────────
// Mirrors the three query shapes the seam runs (players page scan, per-week
// is_live count, player_stats upsert) but keeps real row state, so is_live
// rows written by a live pass genuinely linger and the finalize pass fires —
// the writer-side realism R26 asks for.
interface GateClientOpts {
  knownIds: string[]
  /** Pre-existing live rows (e.g. a prior session's) so a finalize-only
   *  replay has something to finalize. */
  seedLiveRows?: Array<{ season: number; week: number }>
}

function gateSyncClient(opts: GateClientOpts) {
  const store = new Map<string, Record<string, unknown>>()
  for (const [i, row] of (opts.seedLiveRows ?? []).entries()) {
    store.set(`__seed${i}|${row.season}|${row.week}`, {
      player_id: `__seed${i}`,
      season: row.season,
      week: row.week,
      is_live: true,
    })
  }
  const batches: Array<Array<Record<string, unknown>>> = []
  const client = {
    from(table: string) {
      return {
        select() {
          if (table === 'players') {
            return {
              order: () => ({
                range: async (from: number) => ({
                  data: from === 0 ? opts.knownIds.map((id) => ({ id })) : [],
                  error: null,
                }),
              }),
            }
          }
          const filters: Record<string, unknown> = {}
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value
              return chain
            },
            then(resolve: (value: { count: number; error: null }) => void) {
              let count = 0
              for (const row of store.values()) {
                if (
                  row.season === filters.season &&
                  row.week === filters.week &&
                  row.is_live === filters.is_live
                ) {
                  count++
                }
              }
              resolve({ count, error: null })
            },
          }
          return chain
        },
        upsert: async (rows: Array<Record<string, unknown>>) => {
          for (const row of rows) {
            store.set(`${row.player_id}|${row.season}|${row.week}`, { ...row })
          }
          batches.push(rows.map((row) => ({ ...row })))
          return { error: null }
        },
      }
    },
  }
  return { client: client as unknown as SyncClient, batches, store }
}

/** Fixture replay with IDENTITY time anchoring: the virtual clock starts at
 *  the recording's first stamp, so time.now() during replay equals the
 *  recorded wall time and the seam's calendar logic behaves as it did live. */
function identityReplay(
  recording: FixtureRecording,
  opts: { speed?: number; wallClock?: TimeProvider } = {},
) {
  const start = new Date(recording.entries[0].t)
  const clock = new VirtualClock(start, opts)
  const provider = new FixtureReplayProvider(recording, clock)
  return { clock, provider }
}

const SYNTHETIC_KNOWN_IDS = makeScenario('happy_path').players.map((p) => p.playerId)

async function replayFullWeek(recording: FixtureRecording) {
  const { clock, provider } = identityReplay(recording)
  const { client, batches } = gateSyncClient({ knownIds: SYNTHETIC_KNOWN_IDS })
  for (const instant of pollSchedule()) {
    clock.advanceTo(instant)
    await syncLiveStats(client, provider, FIXTURE_SEASON, FIXTURE_WEEK, clock)
  }
  return batches
}

// ── The checked-in fixtures ─────────────────────────────────────────────────
const SYNTHETIC_FIXTURE_PATH = join(
  process.cwd(),
  'fixtures/nfl/2026/wk02/synthetic.jsonl.gz',
)
const REAL_2025_FIXTURE_PATH = join(process.cwd(), 'fixtures/nfl/2025/wk02/sleeper.jsonl.gz')

function loadFixture(path: string): FixtureRecording {
  return parseFixture(gunzipSync(readFileSync(path)).toString('utf8'))
}

// ── Gate item 1: the multi-poll determinism fixture (L.A0.6 item 1) ─────────

describe('M0 gate · multi-poll fixture (recorder↔synthetic composition, D7)', () => {
  it('is checked in and byte-identical to a fresh in-process re-record', async () => {
    expect(
      existsSync(SYNTHETIC_FIXTURE_PATH),
      `missing ${SYNTHETIC_FIXTURE_PATH} — regenerate: npm run record:synthetic-fixture`,
    ).toBe(true)
    const onDisk = serializeFixture(loadFixture(SYNTHETIC_FIXTURE_PATH))
    const reRecorded = serializeFixture(await recordHappyPathSession())
    // Byte equality: the fixture is fully derived from the versioned scenario
    // library — a tampered file OR an unversioned library change fails here.
    expect(onDisk).toBe(reRecorded)
  })

  it('matches the golden pin (scenario library v2 under fixture format v1)', () => {
    const recording = loadFixture(SYNTHETIC_FIXTURE_PATH)
    expect(recording.header).toEqual({
      format: 'fieldscout-fixture',
      version: 1,
      provider: 'synthetic',
      season: FIXTURE_SEASON,
      week: FIXTURE_WEEK,
    })
    expect(recording.entries).toHaveLength(pollSchedule().length * 5)
    expect(sha256(serializeFixture(recording))).toBe(GOLDEN_FIXTURE_SHA256)
  })
})

// ── Gate item 2a: replay determinism at 1×/4×/64× (D11) ────────────────────

describe('M0 gate · 2a replay determinism through the ingestion seam (D11)', () => {
  it('step-driven full week ×3 → identical upsert sequences, matching the golden pin', async () => {
    const recording = loadFixture(SYNTHETIC_FIXTURE_PATH)
    const hashes: string[] = []
    for (let run = 0; run < 3; run++) {
      const batches = await replayFullWeek(recording)
      expect(batches).toHaveLength(GOLDEN_UPSERT_BATCH_COUNT)
      hashes.push(sha256(JSON.stringify(batches)))
    }
    expect(hashes[1]).toBe(hashes[0])
    expect(hashes[2]).toBe(hashes[0])
    expect(hashes[0]).toBe(GOLDEN_UPSERT_SHA256)
  })

  it('writes live rows during the window, then exactly one finalize pass', async () => {
    const batches = await replayFullWeek(loadFixture(SYNTHETIC_FIXTURE_PATH))
    const liveBatches = batches.filter((b) => b.every((row) => row.is_live === true))
    const finalBatches = batches.filter((b) => b.every((row) => row.is_live === false))
    expect(liveBatches.length + finalBatches.length).toBe(batches.length)
    expect(liveBatches.length).toBe(batches.length - 1)
    expect(finalBatches).toHaveLength(1)
    // The finalize pass covers every active player with settled numbers, and
    // the D12 stamp advances with virtual time across the sequence.
    expect(finalBatches[0]).toHaveLength(17) // 18 players − 1 happy_path inactive
    const stamps = batches.map((b) => b[0].updated_at as string)
    expect([...stamps].sort()).toEqual(stamps)
    expect(new Set(stamps).size).toBeGreaterThan(30)
  })

  it.each([1, 4, 64])(
    'wall-paced %d× over a ≥3-poll-interval slice ≡ step mode (D17 stub wall)',
    async (speed) => {
      const recording = loadFixture(SYNTHETIC_FIXTURE_PATH)
      const SLICE_START = T('2026-09-20T17:00:00Z')
      const INTERVALS = 3 // 4 polls, 20 virtual minutes apart

      // Step-mode comparator over the same slice.
      const step = identityReplay(recording)
      const stepClient = gateSyncClient({ knownIds: SYNTHETIC_KNOWN_IDS })
      for (let k = 0; k <= INTERVALS; k++) {
        step.clock.advanceTo(new Date(SLICE_START.getTime() + k * 20 * MIN))
        await syncLiveStats(stepClient.client, step.provider, FIXTURE_SEASON, FIXTURE_WEEK, step.clock)
      }

      // Wall-paced run: virtual time flows at `speed` × a stubbed wall.
      let wallMs = 0
      const wallClock: TimeProvider = { now: () => new Date(wallMs) }
      const paced = identityReplay(recording, { wallClock })
      const pacedClient = gateSyncClient({ knownIds: SYNTHETIC_KNOWN_IDS })
      paced.clock.advanceTo(SLICE_START)
      paced.clock.setSpeed(speed)
      for (let k = 0; k <= INTERVALS; k++) {
        if (k > 0) wallMs += (20 * MIN) / speed // wall advances 1/speed as fast
        await syncLiveStats(pacedClient.client, paced.provider, FIXTURE_SEASON, FIXTURE_WEEK, paced.clock)
      }

      expect(pacedClient.batches).toEqual(stepClient.batches)
      expect(pacedClient.batches.length).toBeGreaterThan(0)
    },
  )
})

// ── Gate item 2a cross-check + R30: the real 2025 week ─────────────────────

describe('M0 gate · 2025 real-week cross-check (D7) + source semantics (D28/R30/D29)', () => {
  function real2025() {
    return loadFixture(REAL_2025_FIXTURE_PATH)
  }

  /** Known ids straight from the fixture so the writer-side filter is not
   *  the variable under test. */
  function knownIdsOf(recording: FixtureRecording): string[] {
    const stats = recording.entries.filter((e) => e.method === 'getWeekStats' && e.ok)
    const last = stats[stats.length - 1].body as Array<{ playerId: string }>
    return last.map((row) => row.playerId)
  }

  async function replayFinalize(provider: StatsProvider, clock: VirtualClock, knownIds: string[]) {
    // Single-poll fixture: the five stamps span the poll's wall duration and
    // the anchor maps to the FIRST stamp — step past the poll before reading
    // (D28, pinned in the L.A0.4 cross-check test).
    clock.advanceBy(10 * MIN)
    const { client, batches } = gateSyncClient({
      knownIds,
      seedLiveRows: [{ season: 2025, week: 2 }],
    })
    const summary = await syncLiveStats(client, provider, 2025, 2, clock)
    return { batches, summary }
  }

  it('replays deterministically ×3 through the seam (finalize pass over settled finals)', async () => {
    const recording = real2025()
    const knownIds = knownIdsOf(recording)
    const hashes: string[] = []
    let rowCount = 0
    for (let run = 0; run < 3; run++) {
      const { provider, clock } = identityReplay(recording)
      const { batches, summary } = await replayFinalize(provider, clock, knownIds)
      expect(summary.counts['finalized-wk2']).toBeGreaterThan(100) // a real NFL week
      rowCount = batches.flat().length
      hashes.push(sha256(JSON.stringify(batches)))
    }
    expect(hashes[1]).toBe(hashes[0])
    expect(hashes[2]).toBe(hashes[0])
    expect(rowCount).toBeGreaterThan(100)
  })

  it('writes an HONEST source by default: fixture:sleeper, never sleeper', async () => {
    const recording = real2025()
    const { provider, clock } = identityReplay(recording)
    expect(provider.name).toBe('fixture:sleeper')
    const { batches } = await replayFinalize(provider, clock, knownIdsOf(recording))
    for (const row of batches.flat()) {
      expect(row.source).toBe('fixture:sleeper')
    }
  })

  it('reproduces byte-identical live-session rows ONLY via the deliberate opt-in (D29)', async () => {
    const recording = real2025()
    const knownIds = knownIdsOf(recording)

    const honest = identityReplay(recording)
    const honestRun = await replayFinalize(honest.provider, honest.clock, knownIds)

    const wrapped = identityReplay(recording)
    const impersonating = impersonateRecordedProvider(wrapped.provider)
    expect(impersonating.name).toBe('sleeper')
    const wrappedRun = await replayFinalize(impersonating, wrapped.clock, knownIds)

    const stripSource = (rows: Array<Record<string, unknown>>) =>
      rows.map((row) => {
        const rest = { ...row }
        delete rest.source
        return rest
      })
    for (const row of wrappedRun.batches.flat()) {
      expect(row.source).toBe('sleeper') // byte-identical to the live session (D24)
    }
    expect(wrappedRun.batches.map(stripSource)).toEqual(honestRun.batches.map(stripSource))
  })

  it('has no silent path to the recorded identity (D29)', () => {
    const recording = real2025()
    // Every FixtureReplayProvider construction path yields the prefixed name…
    const plain = identityReplay(recording).provider
    expect(plain.name.startsWith('fixture:')).toBe(true)
    const withOpts = new FixtureReplayProvider(recording, new VirtualClock(new Date(recording.entries[0].t)), {
      capabilities: new Set(['core_box']),
    })
    expect(withOpts.name.startsWith('fixture:')).toBe(true)
    // …and the opt-in refuses to relabel anything that is not a replayer.
    const notAReplayer = {
      name: 'attacker',
      recordedProviderName: 'sleeper',
    } as unknown as FixtureReplayProvider
    expect(() => impersonateRecordedProvider(notAReplayer)).toThrow(
      /only a FixtureReplayProvider/,
    )
  })
})

// ── Gate item 2b: all nine synthetic scenarios (re-run as the gate) ─────────

describe('M0 gate · 2b all nine §23.6 scenarios pass with zero external calls', () => {
  const WEEK_START = T('2026-09-16T04:00:00Z')
  const SETTLED = T('2026-09-24T10:00:00Z')

  function world(id: ScenarioId) {
    const scenario = makeScenario(id, DEFAULT_SEED)
    const clock = new VirtualClock(WEEK_START)
    return { scenario, clock, provider: new SyntheticStatsProvider(scenario, clock) }
  }

  it('happy_path: full week settles; inactive never scores; feeds publish on schedule', async () => {
    const { clock, provider } = world('happy_path')
    clock.advanceTo(SETTLED)
    const rows = await provider.getWeekStats(2026, 2)
    expect(rows).toHaveLength(17) // 18 players − the inactive TE
    expect(rows.find((r) => r.playerId === 'syn-g2-te')).toBeUndefined()
    const inactives = await provider.getInactives(2026, 2)
    const g2 = inactives.find((list) => list.gameId === '2026-wk02-BUF@KC')
    expect(g2?.playerIds).toEqual(['syn-g2-te'])
    expect(g2?.publishedAt).toEqual(T('2026-09-20T18:55:00Z')) // kickoff − 90m
    const injuries = await provider.getInjuries(2026, 2)
    expect(injuries).toEqual([
      {
        playerId: 'syn-g1-wr',
        designation: 'questionable',
        gameId: '2026-wk02-DAL@PHI',
        reportedAt: T('2026-09-18T20:00:00Z'),
      },
    ])
  })

  it('flex_move: the kickoff moves only from the announcement instant (E42)', async () => {
    const { clock, provider } = world('flex_move')
    clock.advanceTo(T('2026-09-17T19:59:59Z'))
    let g3 = (await provider.getSchedule(2026)).find((g) => g.gameId === '2026-wk02-SEA@SF')
    expect(g3?.kickoffAt).toEqual(T('2026-09-21T00:20:00Z')) // original SNF slot
    clock.advanceTo(T('2026-09-17T20:00:00Z'))
    g3 = (await provider.getSchedule(2026)).find((g) => g.gameId === '2026-wk02-SEA@SF')
    expect(g3?.kickoffAt).toEqual(T('2026-09-20T21:05:00Z')) // flexed to Sun late
    clock.advanceTo(T('2026-09-20T22:00:00Z')) // live in the NEW slot only
    g3 = (await provider.getSchedule(2026)).find((g) => g.gameId === '2026-wk02-SEA@SF')
    expect(g3?.status).toBe('live')
  })

  it('postponement: game leaves the week, its players score nothing (E43)', async () => {
    const { clock, provider } = world('postponement')
    clock.advanceTo(T('2026-09-20T14:59:59Z'))
    let g2 = (await provider.getSchedule(2026)).find((g) => g.gameId === '2026-wk02-BUF@KC')
    expect(g2?.status).toBe('scheduled')
    clock.advanceTo(SETTLED)
    g2 = (await provider.getSchedule(2026)).find((g) => g.gameId === '2026-wk02-BUF@KC')
    expect(g2?.status).toBe('postponed')
    expect(g2?.kickoffAt).toEqual(T('2026-09-27T20:25:00Z')) // outside week 2
    const rows = await provider.getWeekStats(2026, 2)
    expect(rows.some((r) => r.gameId === '2026-wk02-BUF@KC')).toBe(false)
    expect(rows).toHaveLength(12) // both other games' players still score
  })

  it('mass_inactives: every scratched player is listed and never scores', async () => {
    const { scenario, clock, provider } = world('mass_inactives')
    const scratched = scenario.players.filter((p) => p.inactive).map((p) => p.playerId)
    expect(scratched).toHaveLength(7)
    clock.advanceTo(SETTLED)
    const rows = await provider.getWeekStats(2026, 2)
    expect(rows).toHaveLength(11) // 18 − 7
    for (const playerId of scratched) {
      expect(rows.find((r) => r.playerId === playerId)).toBeUndefined()
    }
    const listed = (await provider.getInactives(2026, 2)).flatMap((l) => l.playerIds)
    expect([...listed].sort()).toEqual([...scratched].sort())
  })

  it('provider_outage: all five methods throw inside the window; DegradationTracker flips at exactly the 3rd failed poll and clears on recovery (§23.2)', async () => {
    const { clock, provider } = world('provider_outage')
    clock.advanceTo(T('2026-09-20T18:20:00Z')) // inside [18:00, 18:40)
    await expect(provider.getSchedule(2026)).rejects.toThrow(/outage/)
    await expect(provider.getGameStates(2026, 2)).rejects.toThrow(/outage/)
    await expect(provider.getWeekStats(2026, 2)).rejects.toThrow(/outage/)
    await expect(provider.getInjuries(2026, 2)).rejects.toThrow(/outage/)
    await expect(provider.getInactives(2026, 2)).rejects.toThrow(/outage/)

    const tracker = new DegradationTracker()
    const poll = async (instant: string) => {
      clock.advanceTo(T(instant))
      try {
        await provider.getWeekStats(2026, 2)
        tracker.recordPollResult(true)
      } catch {
        tracker.recordPollResult(false)
      }
    }
    await poll('2026-09-20T18:21:00Z')
    await poll('2026-09-20T18:22:00Z')
    expect(tracker.degraded).toBe(false) // 2 consecutive failures — not yet
    await poll('2026-09-20T18:23:00Z')
    expect(tracker.degraded).toBe(true) // exactly the 3rd
    await poll('2026-09-20T18:40:00Z') // outage window is [start, end)
    expect(tracker.degraded).toBe(false) // clears on first success
  })

  it('correction_in_window: the value moves by +7 from its honestly-dated instant, inside the window (E44/E10)', async () => {
    const { scenario, clock, provider } = world('correction_in_window')
    const at = scenario.corrections[0].at
    expect(at.getTime()).toBeLessThan(scenario.correctionWindowEndsAt.getTime())
    clock.advanceTo(new Date(at.getTime() - 1000))
    const before = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    clock.advanceTo(at)
    const after = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    expect(after?.stats.receiving_yards).toBe((before?.stats.receiving_yards ?? NaN) + 7)
  })

  it('correction_post_window: dated after the window closes; nothing moves before it (E44)', async () => {
    const { scenario, clock, provider } = world('correction_post_window')
    const at = scenario.corrections[0].at
    expect(at.getTime()).toBeGreaterThan(scenario.correctionWindowEndsAt.getTime())
    clock.advanceTo(SETTLED) // window close — correction not yet applied
    const settled = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    clock.advanceTo(at)
    const applied = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    expect(applied?.stats.receiving_yards).toBe((settled?.stats.receiving_yards ?? NaN) - 6)
  })

  it('charted_late: the post slips its SLA — pending (absent, never 0) until it lands (E55/E57)', async () => {
    const { scenario, clock, provider } = world('charted_late')
    const g1 = scenario.games[0]
    expect(g1.chartedPostAt.getTime()).toBeGreaterThan(g1.chartedSlaAt.getTime()) // the slip IS the observable
    clock.advanceTo(T('2026-09-22T12:00:00Z')) // past the Mon SLA, before the Wed post
    let wr = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    expect(wr?.advanced[CHARTED_PLACEHOLDER_KEY]).toBeUndefined()
    const g1State = (await provider.getGameStates(2026, 2)).find((s) => s.gameId === g1.gameId)
    expect(g1State?.advancedFinalAt).toBeNull()
    clock.advanceTo(g1.chartedPostAt)
    wr = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    expect(typeof wr?.advanced[CHARTED_PLACEHOLDER_KEY]).toBe('number')
  })

  it('charted_revision: an already-posted charted value revises by +9 at the revision instant (E56)', async () => {
    const { scenario, clock, provider } = world('charted_revision')
    const revision = scenario.chartedRevisions[0]
    clock.advanceTo(T('2026-09-21T15:00:00Z')) // first posting (Mon AM)
    const posted = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    const first = posted?.advanced[CHARTED_PLACEHOLDER_KEY]
    expect(typeof first).toBe('number')
    clock.advanceTo(revision.at)
    const revised = (await provider.getWeekStats(2026, 2)).find((r) => r.playerId === 'syn-g1-wr')
    expect(revised?.advanced[CHARTED_PLACEHOLDER_KEY]).toBe((first as number) + 9)
  })
})

// ── Gate item 2c: calendar assertion against the migration-039 seed ─────────

describe('M0 gate · 2c scenario slate ↔ seeded nfl_weeks calendar (§12.20, migration 039)', () => {
  // The gate consumes the SEED ARTIFACT itself — the checked-in migration —
  // not a live database (zero external calls). The row shape is pinned; if
  // 039's seed for (2026, 2) is ever edited, this parse fails loudly (D30).
  function seededWeek2(): { startsAt: Date; correctionWindowEndsAt: Date } {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/039_nfl_weeks.sql'),
      'utf8',
    )
    const match = sql.match(/\(2026,\s*2,\s*'([^']+)',\s*NULL,\s*NULL,\s*'([^']+)'\)/)
    if (!match) throw new Error('039_nfl_weeks.sql: (2026, 2) seed row not found — gate item 2c cannot run')
    const toDate = (literal: string) => {
      // '2026-09-16 00:00:00-04' → ISO with a full ±HH:MM offset.
      const iso = literal.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) throw new Error(`unparseable seed timestamp: ${literal}`)
      return date
    }
    return { startsAt: toDate(match[1]), correctionWindowEndsAt: toDate(match[2]) }
  }

  it('the scenario week and the seeded calendar agree exactly (the L.A0.3/D26 composition)', () => {
    const seeded = seededWeek2()
    expect(seeded.startsAt).toEqual(T('2026-09-16T04:00:00Z')) // Wed 00:00 ET
    const scenario = makeScenario('happy_path')
    expect(scenario.season).toBe(2026)
    expect(scenario.week).toBe(2)
    // §23.4 window: the scenario carries the SAME instant the seed carries.
    expect(scenario.correctionWindowEndsAt.getTime()).toBe(
      seeded.correctionWindowEndsAt.getTime(),
    )
  })

  it('every scenario event instant falls inside the seeded week bounds', () => {
    const { startsAt, correctionWindowEndsAt } = seededWeek2()
    const within = (instant: Date, what: string) => {
      expect(instant.getTime(), `${what} before seeded starts_at`).toBeGreaterThanOrEqual(
        startsAt.getTime(),
      )
      expect(
        instant.getTime(),
        `${what} after seeded correction_window_ends_at`,
      ).toBeLessThanOrEqual(correctionWindowEndsAt.getTime())
    }
    const happy = makeScenario('happy_path')
    for (const game of happy.games) {
      within(game.kickoffAt, `${game.gameId} kickoff`)
      within(new Date(game.kickoffAt.getTime() - 90 * MIN), `${game.gameId} inactives publish`)
      within(new Date(game.kickoffAt.getTime() + game.durationMs), `${game.gameId} final`)
      within(game.chartedPostAt, `${game.gameId} charted post`)
      within(game.chartedSlaAt, `${game.gameId} charted SLA`)
    }
    for (const player of happy.players) {
      if (player.injury) within(player.injury.reportedAt, `${player.playerId} injury report`)
    }
    within(makeScenario('correction_in_window').corrections[0].at, 'in-window correction')
    within(makeScenario('charted_late').games[0].chartedPostAt, 'late charted post')
    within(makeScenario('charted_revision').chartedRevisions[0].at, 'charted revision')
    // …and the post-window correction is dated beyond the seeded close — the
    // two sides agree on the far side of the boundary too.
    expect(
      makeScenario('correction_post_window').corrections[0].at.getTime(),
    ).toBeGreaterThan(correctionWindowEndsAt.getTime())
  })

  it('every capture stamp in the replayed fixture falls inside the seeded week bounds', () => {
    const { startsAt, correctionWindowEndsAt } = seededWeek2()
    const recording = loadFixture(SYNTHETIC_FIXTURE_PATH)
    for (const entry of recording.entries) {
      const stamp = new Date(entry.t).getTime()
      expect(stamp).toBeGreaterThanOrEqual(startsAt.getTime())
      expect(stamp).toBeLessThanOrEqual(correctionWindowEndsAt.getTime())
    }
  })
})

// ── Gate item: R26 — writer-side back-fill after an outage window ───────────

describe('M0 gate · R26 writer-side cumulative back-fill after an outage (§23.2)', () => {
  const OUTAGE_POLLS = [
    '2026-09-20T18:00:00Z',
    '2026-09-20T18:10:00Z',
    '2026-09-20T18:20:00Z',
    '2026-09-20T18:30:00Z',
  ]
  const PRE_POLLS = [
    '2026-09-20T17:00:00Z',
    '2026-09-20T17:10:00Z',
    '2026-09-20T17:20:00Z',
    '2026-09-20T17:30:00Z',
    '2026-09-20T17:40:00Z',
    '2026-09-20T17:50:00Z',
  ]
  const RECOVERY_POLL = '2026-09-20T18:40:00Z' // outage window is [start, end)

  function outageWorld() {
    const clock = new VirtualClock(T('2026-09-20T16:00:00Z'))
    const provider = new SyntheticStatsProvider(makeScenario('provider_outage'), clock)
    const client = gateSyncClient({ knownIds: SYNTHETIC_KNOWN_IDS })
    return { clock, provider, client }
  }

  it('polls in the outage write NOTHING; recovery writes the cumulative catch-up rows', async () => {
    // Run A lives through the outage on a game-window cadence.
    const a = outageWorld()
    const tracker = new DegradationTracker()
    const pollA = async (instant: string) => {
      a.clock.advanceTo(T(instant))
      try {
        await syncLiveStats(a.client.client, a.provider, 2026, 2, a.clock)
        tracker.recordPollResult(true)
      } catch {
        tracker.recordPollResult(false)
      }
    }
    for (const instant of PRE_POLLS) await pollA(instant)
    const batchesBeforeOutage = a.client.batches.length
    const lastPreOutage = a.client.batches[a.client.batches.length - 1]

    for (const [i, instant] of OUTAGE_POLLS.entries()) {
      await pollA(instant)
      expect(tracker.degraded, `after failed poll ${i + 1}`).toBe(i + 1 >= 3)
    }
    // Writer-side: the degraded window produced zero writes (§23.2 —
    // honest staleness, never partial data).
    expect(a.client.batches.length).toBe(batchesBeforeOutage)

    await pollA(RECOVERY_POLL)
    expect(tracker.degraded).toBe(false)
    const recoveryBatch = a.client.batches[a.client.batches.length - 1]
    expect(a.client.batches.length).toBe(batchesBeforeOutage + 1)

    // Run B never polls inside the outage window — the uninterrupted-cadence
    // comparator. Cumulative back-fill means A's first post-recovery WRITE
    // equals B's write at the same instant: the gap left no hole and needed
    // no replayed intermediate polls.
    const b = outageWorld()
    for (const instant of [...PRE_POLLS, RECOVERY_POLL]) {
      b.clock.advanceTo(T(instant))
      await syncLiveStats(b.client.client, b.provider, 2026, 2, b.clock)
    }
    const comparatorBatch = b.client.batches[b.client.batches.length - 1]
    expect(recoveryBatch).toEqual(comparatorBatch)

    // …and the catch-up rows genuinely advanced across the gap: every stat
    // is ≥ its last pre-outage write, strictly greater in aggregate.
    const numericTotal = (rows: Array<Record<string, unknown>>) =>
      rows.reduce((sum, row) => {
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'number' && !['season', 'week'].includes(key)) sum += value
        }
        return sum
      }, 0)
    const preByPlayer = new Map(lastPreOutage.map((row) => [row.player_id, row]))
    for (const row of recoveryBatch) {
      const pre = preByPlayer.get(row.player_id)
      if (!pre) continue // a player whose game kicked off during the gap
      for (const [key, value] of Object.entries(row)) {
        if (typeof value !== 'number' || ['season', 'week'].includes(key)) continue
        expect(value, `${row.player_id}.${key} regressed across the outage`).toBeGreaterThanOrEqual(
          (pre[key] as number | undefined) ?? 0,
        )
      }
    }
    expect(numericTotal(recoveryBatch)).toBeGreaterThan(numericTotal(lastPreOutage))
  })
})
