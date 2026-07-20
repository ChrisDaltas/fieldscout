/**
 * record:fixtures — capture a live provider session to a replayable fixture
 * (M0 task L.A0.4; format per D6, identity header per D27).
 *
 * Usage: npm run record:fixtures -- <season> <week> [minutes]
 *
 * Wraps SleeperStatsProvider in RecordingStatsProvider and polls all five
 * §23.1 methods on the §23.2 game-window cadence (25s) for [minutes]
 * (default 0 = one poll — the D7 "settled finals" mode used for the checked-
 * in 2025 cross-check week). Output: fixtures/nfl/<season>/wk<NN>/sleeper.jsonl.gz
 *
 * Known limitation (PROGRESS Q1, resolved — D16): sleeper_free recordings
 * carry injuries but no real-time official inactives and no kickoff
 * timestamps; nflverse back-fills both retroactively (its adapter lands with
 * the first runtime consumer of kickoffs, not M0). Live 2026 capture starts
 * with the season (~Sept 10) — schedule this CLI for game windows then.
 */
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { SleeperStatsProvider } from '../src/lib/leagues/stats/sleeper-stats-provider'
import {
  FIXTURE_FORMAT,
  FIXTURE_FORMAT_VERSION,
  serializeFixture,
} from '../src/lib/leagues/stats/fixtures/fixture-format'
import {
  MemoryFixtureSink,
  RecordingStatsProvider,
} from '../src/lib/leagues/stats/fixtures/recording-stats-provider'
import { systemTime } from '../src/lib/leagues/time/time-provider'
import { fail } from './_sync-cli'

const POLL_INTERVAL_MS = 25_000 // §23.2: 20–30s in game windows

function intArg(index: number, name: string, fallback?: number): number {
  const raw = process.argv[2 + index]
  const value = Number(raw ?? fallback)
  if (!Number.isInteger(value) || value < 0) {
    console.error(`Invalid ${name}: ${raw}`)
    process.exit(1)
  }
  return value
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function main() {
  const season = intArg(0, 'season')
  const week = intArg(1, 'week')
  const minutes = intArg(2, 'minutes', 0)

  const sink = new MemoryFixtureSink()
  const provider = new RecordingStatsProvider(
    new SleeperStatsProvider(systemTime),
    sink,
    systemTime,
  )

  const endAt = Date.now() + minutes * 60_000
  let polls = 0
  do {
    polls++
    // Every method every poll; failures are recorded AND kept non-fatal so a
    // real outage window lands in the fixture instead of killing the run.
    for (const call of [
      () => provider.getSchedule(season),
      () => provider.getGameStates(season, week),
      () => provider.getWeekStats(season, week),
      () => provider.getInjuries(season, week),
      () => provider.getInactives(season, week),
    ]) {
      try {
        await call()
      } catch (err) {
        console.warn(`  poll ${polls}: recorded failure — ${(err as Error).message}`)
      }
    }
    console.log(`poll ${polls} complete (${sink.entries.length} entries)`)
    if (Date.now() < endAt) await sleep(POLL_INTERVAL_MS)
  } while (Date.now() < endAt)

  // Header identity + path read the wrapped provider's name (the recording
  // wrapper is transparent) — never hardcoded, so the fixture can't lie about
  // its source if this CLI ever wraps a different provider (D27/R27).
  const jsonl = serializeFixture({
    header: {
      format: FIXTURE_FORMAT,
      version: FIXTURE_FORMAT_VERSION,
      provider: provider.name,
      season,
      week,
    },
    entries: sink.entries,
  })

  const outPath = resolve(
    process.cwd(),
    `fixtures/nfl/${season}/wk${String(week).padStart(2, '0')}/${provider.name}.jsonl.gz`,
  )
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, gzipSync(jsonl))
  console.log(`Done [record:fixtures] ${polls} polls, ${sink.entries.length} entries → ${outPath}`)
}

main().catch(fail)
