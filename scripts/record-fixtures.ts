/**
 * record:fixtures — capture a live provider session to a replayable fixture
 * (M0 task L.A0.4; format per D6, identity header per D27).
 *
 * Usage: npm run record:fixtures -- <season> <week> [minutes]
 *        npm run record:fixtures -- <season> <week> --snapshot final [--overwrite]
 *        npm run record:fixtures -- <season> <week> --snapshot window-end --window-end <ISO> [--overwrite]
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
 *
 * TWO-SNAPSHOT MODE (M6 L.E2.5, tasks-M6 §6; spec §23.4; PROGRESS D458) —
 * `--snapshot final` once the week's last game is final, `--snapshot
 * window-end` at / after its correction window's end (the next week's first
 * kickoff, passed as `--window-end`; the run refuses before it). One poll of
 * the five methods through the PRODUCTION provider — `withNflverseCalendar(
 * sleeper, nflverse)`, exactly what `sync-live` binds — so the pair replays
 * through the real `ingestWeek` with production's game ids and kickoffs (a
 * plain Sleeper schedule has no kickoff, and `toGameRow` stores no game
 * without one). Written as
 *   fixtures/nfl/<season>/wk<NN>/<provider>.<snapshot>.jsonl.gz   (the fixture, D6 / D27)
 *   fixtures/nfl/<season>/wk<NN>/<provider>.<snapshot>.lines.json (the line sidecar)
 * The sidecar (correction-line-meta.ts) names each line's player, team, game
 * date and Sleeper's last-modified stamp — public NFL data, no stat value.
 * Refused, writing nothing: a failed provider read (a snapshot missing a read
 * is not a snapshot), an in-week game not final, a window-end run before the
 * window's end, an existing file without `--overwrite`. Then
 * `npm run diff:fixtures -- --season <yyyy> --week <n>` names every change
 * between the two.
 */
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { NflverseProvider, withNflverseCalendar } from '../src/lib/leagues/stats/nflverse/nflverse-provider'
import { SleeperStatsProvider } from '../src/lib/leagues/stats/sleeper-stats-provider'
import type { ProviderGameState, ProviderPlayerWeekStats, StatsProvider } from '../src/lib/leagues/stats/stats-provider'
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
import { fetchLinesSidecar } from './correction-line-meta'

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

function flagValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(2)
  }
  return value
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

/** One poll of the five methods; returns how many reads failed. */
async function pollOnce(provider: StatsProvider, season: number, week: number, polls: number): Promise<number> {
  let failures = 0
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
      failures++
      console.warn(`  poll ${polls}: recorded failure — ${(err as Error).message}`)
    }
  }
  return failures
}

function writeFixture(outPath: string, provider: StatsProvider, season: number, week: number, sink: MemoryFixtureSink): void {
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
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, gzipSync(jsonl))
}

type Snapshot = 'final' | 'window-end'

/** L.E2.5's two-snapshot mode — one poll, every refusal before any write. */
async function recordSnapshot(season: number, week: number, snapshot: Snapshot): Promise<void> {
  const now = systemTime.now()
  if (snapshot === 'window-end') {
    const raw = flagValue('--window-end')
    const windowEnd = raw === undefined ? NaN : Date.parse(raw)
    if (!Number.isFinite(windowEnd)) {
      console.error("--snapshot window-end needs --window-end <ISO instant> (the next week's first kickoff — production's nfl_weeks.correction_window_ends_at)")
      process.exit(2)
    }
    if (now.getTime() < windowEnd) {
      console.error(`refused: it is ${now.toISOString()}, before the window's end ${new Date(windowEnd).toISOString()} — nothing recorded`)
      process.exit(1)
    }
  }
  const dir = `fixtures/nfl/${season}/wk${String(week).padStart(2, '0')}`
  const sink = new MemoryFixtureSink()
  const provider = new RecordingStatsProvider(
    withNflverseCalendar(new SleeperStatsProvider(systemTime), new NflverseProvider(systemTime)),
    sink,
    systemTime,
  )
  const fixturePath = resolve(process.cwd(), `${dir}/${provider.name}.${snapshot}.jsonl.gz`)
  const linesPath = resolve(process.cwd(), `${dir}/${provider.name}.${snapshot}.lines.json`)
  const overwrite = process.argv.includes('--overwrite')
  for (const path of [fixturePath, linesPath]) {
    if (existsSync(path) && !overwrite) {
      console.error(`refused: ${path} exists (add --overwrite to replace it) — nothing recorded`)
      process.exit(1)
    }
  }

  const failures = await pollOnce(provider, season, week, 1)
  if (failures > 0) {
    console.error(`refused: ${failures} provider read(s) failed — a snapshot missing a read is not a snapshot; nothing written`)
    process.exit(1)
  }
  const states = sink.entries.find((e) => e.method === 'getGameStates')?.body as ProviderGameState[]
  const inWeek = states.filter((g) => g.status !== 'postponed')
  const open = inWeek.filter((g) => g.status !== 'final')
  if (inWeek.length === 0 || open.length > 0) {
    const why = inWeek.length === 0 ? 'the week has no in-week game' : `${open.length} in-week game(s) not final — ${open.map((g) => `${g.gameId} ${g.status}`).join(', ')}`
    console.error(`refused: ${why} — the "${snapshot}" snapshot is taken only once every game of the week is final; nothing written`)
    process.exit(1)
  }
  const statsEntry = sink.entries.find((e) => e.method === 'getWeekStats')
  const stats = statsEntry?.body as ProviderPlayerWeekStats[]
  const sidecar = await fetchLinesSidecar(season, week, new Set(stats.map((l) => l.playerId)), systemTime.now(), fetch)
  const unnamed = stats.filter((l) => sidecar.lines[l.playerId]?.team == null).length

  writeFixture(fixturePath, provider, season, week, sink)
  writeFileSync(linesPath, JSON.stringify(sidecar, null, 1) + '\n')
  console.log(
    `Done [record:fixtures --snapshot ${snapshot}] ${season} wk${week}: ${inWeek.length} in-week games, all final; ${stats.length} lines at ${statsEntry?.t}; sidecar ${Object.keys(sidecar.lines).length} lines (${unnamed} without a team) → ${fixturePath}, ${linesPath}`,
  )
}

async function main() {
  const season = intArg(0, 'season')
  const week = intArg(1, 'week')
  const snapshot = flagValue('--snapshot')
  if (snapshot !== undefined) {
    if (snapshot !== 'final' && snapshot !== 'window-end') {
      console.error(`--snapshot must be "final" or "window-end", not "${snapshot}"`)
      process.exit(2)
    }
    await recordSnapshot(season, week, snapshot)
    return
  }
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
    await pollOnce(provider, season, week, polls)
    console.log(`poll ${polls} complete (${sink.entries.length} entries)`)
    if (Date.now() < endAt) await sleep(POLL_INTERVAL_MS)
  } while (Date.now() < endAt)

  const outPath = resolve(
    process.cwd(),
    `fixtures/nfl/${season}/wk${String(week).padStart(2, '0')}/${provider.name}.jsonl.gz`,
  )
  writeFixture(outPath, provider, season, week, sink)
  console.log(`Done [record:fixtures] ${polls} polls, ${sink.entries.length} entries → ${outPath}`)
}

main().catch(fail)
