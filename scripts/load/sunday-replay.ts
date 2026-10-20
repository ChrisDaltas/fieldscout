/**
 * sunday-replay — §22.6 scenario (3), the FEEDER half (M7 L.F2.1; spec
 * §22.6 v2.16.100, §22.2, §23.1/§23.2).
 *
 *   npx tsx scripts/load/seed-staging.ts  --target test --profile y2026 --scenario leagues --recording <rec>
 *   npx tsx scripts/load/sunday-replay.ts --target test --profile y2026 --recording <rec> --speed 1 [--worker self|external]
 *   (re-seed, then the same with --speed 4 — each speed replays onto fresh leagues)
 *
 * "Replay a recorded real NFL Sunday's stat deltas at 1× and 4× speed
 * across N seeded leagues — assert scoring lag p95 < 15 s behind ingestion,
 * no missed corrections."
 *
 * HOW. The recording is a `fieldscout-fixture` time series (D6) replayed by
 * the production `FixtureReplayProvider` on a `VirtualClock` at the chosen
 * speed — stats only via StatsProvider, time only via TimeProvider. A thin
 * remap (`LoadSeasonProvider`) moves the recorded (season, week) onto the
 * harness's own `LOAD_SEASON` / `LOAD_WEEK`, prefixes every game id
 * (`nfl_games.id` is a global key — a replayed id must never overwrite a
 * real game row) and shifts every instant by one constant so the recorded
 * Sunday lands inside that week. Every `pollSec` wall seconds the feeder
 * runs the PRODUCTION ingestion (`ingestWeek`: diff → the 167 door → the
 * `score_fanout` queue); with `--worker self` it also runs the PRODUCTION
 * worker (`runScoreWeekBatch`) every `workerSec` (§22.2's 5–10 s cron), and
 * with `--worker external` it leaves scoring to the target's own scheduled
 * worker and only measures.
 *
 * WHAT IS MEASURED. Scoring lag, per poll that produced deltas: wall time
 * from the poll's return to the moment no `score_fanout` row stamped at or
 * before that poll remains — i.e. every line that poll ingested has been
 * scored into its leagues. A poll still unscored after `LAG_TIMEOUT_MS` is
 * recorded AT the timeout and counted, so a stuck queue can never read as a
 * fast one. "No missed corrections": after the replay drains, the
 * reconciliation job (`reconcileSeason`, §23.2) compares every stored cell
 * with a fresh recompute from the stored lines — zero alerts — and the
 * corrections the ingest door recorded are reported beside it.
 *
 * THE RECORDING. Only a recording made DURING a real Sunday (polls every
 * ~20 s across the slate — `record:fixtures` run through the day) is a
 * "recorded real NFL Sunday". The repo holds none yet (PROGRESS F700): its
 * real captures are single snapshots. The local exercise replays the
 * synthetic 2026 week-2 time series instead and says so.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Database } from '@/types/database'
import { pageAll } from '@/lib/supabase/page-all'
import { reconcileSeason } from '@/lib/leagues/scoring/reconcile'
import { runScoreWeekBatch } from '@/lib/leagues/scoring/score-week-worker'
import { syntheticNflWeeks } from '@/lib/leagues/sim/synthetic-season'
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { FixtureRecording } from '@/lib/leagues/stats/fixtures/fixture-format'
import { FixtureReplayProvider } from '@/lib/leagues/stats/fixtures/fixture-replay-provider'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import { ingestWeek } from '@/lib/sync/ingest-week'

import { LOAD_GAME_PREFIX, LOAD_SEASON, LOAD_WEEK, SCORING_LAG_P95_MS, resolveProfile, sizeBanner, type LoadProfile } from '../../load/k6/config'
import { describeTrend, percentile, renderAsserts, allPass, type AssertLine } from '../../load/k6/lib/checks'
import { parseManifest } from '../../load/k6/lib/manifest'
import { firstCompletePoll, loadRecording } from './recording'
import { manifestPath } from './seed-staging'
import { resolveTarget } from './target'

type Supabase = SupabaseClient<Database>

const LAG_TIMEOUT_MS = 120_000
const DRAIN_GRACE_MS = 180_000

// ---------------------------------------------------------------------------
// The remap: recorded (season, week) → (LOAD_SEASON, LOAD_WEEK)
// ---------------------------------------------------------------------------

function shiftDate(d: Date | null | undefined, ms: number): Date | null {
  return d === null || d === undefined ? null : new Date(d.getTime() + ms)
}

export class LoadSeasonProvider implements StatsProvider {
  readonly name: string
  readonly capabilities: StatsProvider['capabilities']
  constructor(
    private readonly inner: StatsProvider,
    private readonly recSeason: number,
    private readonly recWeek: number,
    private readonly shiftMs: number,
  ) {
    this.name = inner.name
    this.capabilities = inner.capabilities
  }
  private check(season: number, week?: number): void {
    if (season !== LOAD_SEASON || (week !== undefined && week !== LOAD_WEEK)) {
      throw new Error(`LoadSeasonProvider serves only ${LOAD_SEASON} week ${LOAD_WEEK} (asked ${season}/${week ?? '-'})`)
    }
  }
  private gid(id: string | undefined): string | undefined {
    return id === undefined ? undefined : `${LOAD_GAME_PREFIX}${id}`
  }
  async getSchedule(season: number): Promise<ProviderGame[]> {
    this.check(season)
    const games = await this.inner.getSchedule(this.recSeason)
    return games
      .filter((g) => g.week === this.recWeek)
      .map((g) => ({
        ...g,
        gameId: this.gid(g.gameId)!,
        season: LOAD_SEASON,
        week: LOAD_WEEK,
        kickoffAt: shiftDate(g.kickoffAt, this.shiftMs),
        gameDate: g.kickoffAt ? shiftDate(g.kickoffAt, this.shiftMs)!.toISOString().slice(0, 10) : g.gameDate,
      }))
  }
  async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    this.check(season, week)
    const states = await this.inner.getGameStates(this.recSeason, this.recWeek)
    return states.map((s) => ({ ...s, gameId: this.gid(s.gameId)!, advancedFinalAt: shiftDate(s.advancedFinalAt, this.shiftMs) }))
  }
  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    this.check(season, week)
    const lines = await this.inner.getWeekStats(this.recSeason, this.recWeek)
    return lines.map((l) => ({ ...l, season: LOAD_SEASON, week: LOAD_WEEK, gameId: this.gid(l.gameId) }))
  }
  async getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    this.check(season, week)
    const rows = await this.inner.getInjuries(this.recSeason, this.recWeek)
    return rows.map((r) => ({ ...r, gameId: this.gid(r.gameId), reportedAt: shiftDate(r.reportedAt, this.shiftMs)! }))
  }
  async getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    this.check(season, week)
    const rows = await this.inner.getInactives(this.recSeason, this.recWeek)
    return rows.map((r) => ({ ...r, gameId: this.gid(r.gameId)!, publishedAt: shiftDate(r.publishedAt, this.shiftMs)! }))
  }
}

/** The constant that moves the recorded week's start onto LOAD_WEEK's. */
export function shiftFor(recSeason: number, recWeek: number): number {
  const rec = syntheticNflWeeks(recSeason)[recWeek - 1]
  const load = syntheticNflWeeks(LOAD_SEASON)[LOAD_WEEK - 1]
  if (!rec || !load) throw new Error(`no calendar row for ${recSeason} week ${recWeek}`)
  return Date.parse(load.starts_at) - Date.parse(rec.starts_at)
}

/** A TimeProvider that reads another one, shifted by a constant. */
export function shifted(base: TimeProvider, ms: number): TimeProvider {
  return { now: () => new Date(base.now().getTime() + ms) }
}

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

export interface ReplayInput {
  service: Supabase
  profile: LoadProfile
  recording: FixtureRecording
  speed: number
  leagueIds: readonly string[]
  worker: 'self' | 'external'
  /** Override the profile's clip (minutes of recorded time), null = all. */
  clipMinutes?: number | null
  /** Override the poll cadence (wall seconds). */
  pollSec?: number
  /** Wall time + sleep — the injection boundary (scripts/, never league code). */
  wallClock: TimeProvider
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
}

export interface ReplayResult {
  polls: number
  pollsWithDeltas: number
  deltas: number
  lagMs: number[]
  lagTimeouts: number
  workerBatches: number
  workerProblems: string[]
  correctionsDetected: number
  correctionsRecorded: number
  correctionEventsStored: number
  /** Alerts that judge this replay's scores, by kind. */
  reconcileAlerts: Record<string, number>
  /** Alerts that do not (calendar; unrostered players' queue rows), by kind. */
  reconcileOther: Record<string, number>
  reconcileCells: number
  reconcileReason: string | null
  scoredLeagues: number
}

/**
 * Queue rows stamped at or before `polledAt` for players the LOAD leagues
 * roster. Scoped to those players on purpose: the feeder's worker is scoped
 * to the load leagues (it must never write another league's cells on a
 * shared database), and a SCOPED drain never consumes a row no league in its
 * scope rosters — it releases it (`out_of_scope`, `score-week-worker.ts`'s
 * "a scoped drain consumes only what it scores"), where the unscoped
 * production drain would consume it as `unmapped`. Those rows stay queued
 * and are not this run's lag (measured locally: 260 of 384 rows each run).
 */
async function queuedAtOrBefore(service: Supabase, polledAt: string, players: readonly string[]): Promise<number> {
  let total = 0
  for (let i = 0; i < players.length; i += 150) {
    const { count, error } = await service
      .from('score_fanout')
      .select('player_id', { count: 'exact', head: true })
      .eq('season', LOAD_SEASON)
      .eq('week', LOAD_WEEK)
      .lte('enqueued_at', polledAt)
      .in('player_id', players.slice(i, i + 150))
    if (error) throw new Error(`score_fanout count failed: ${error.message}`)
    total += count ?? 0
  }
  return total
}

async function rosteredPlayers(service: Supabase, leagueIds: readonly string[]): Promise<string[]> {
  const out = new Set<string>()
  for (let i = 0; i < leagueIds.length; i += 100) {
    const rows = await pageAll<{ player_id: string }>((from, to) =>
      service
        .from('league_rosters')
        .select('player_id', { count: 'exact' })
        .in('league_id', leagueIds.slice(i, i + 100))
        .order('player_id')
        .range(from, to),
    )
    for (const r of rows) out.add(r.player_id)
  }
  return [...out]
}

/** Reconcile kinds that judge the CALENDAR, not a score. */
export const CALENDAR_KINDS: ReadonlySet<string> = new Set(['no_game_rows', 'all_final_unstamped', 'game_not_final_late'])

/**
 * Split reconcile's alerts into the ones that judge this replay's scores
 * (asserted) and the rest (reported): calendar findings — the harness seeds
 * a whole season but replays one week — and `stuck_queue` rows for players
 * no load league rosters, which a scoped drain leaves queued by design (see
 * `queuedAtOrBefore`).
 */
export function splitAlerts(
  findings: ReadonlyArray<{ kind: string; severity: string; player_id?: string }>,
  rostered: ReadonlySet<string>,
): { scored: Record<string, number>; other: Record<string, number> } {
  const scored: Record<string, number> = {}
  const other: Record<string, number> = {}
  for (const f of findings) {
    if (f.severity !== 'alert') continue
    const notOurs = CALENDAR_KINDS.has(f.kind) || (f.kind === 'stuck_queue' && (f.player_id === undefined || !rostered.has(f.player_id)))
    const bucket = notOurs ? other : scored
    bucket[f.kind] = (bucket[f.kind] ?? 0) + 1
  }
  return { scored, other }
}

function kindsLine(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? 'none' : entries.map(([k, n]) => `${k} ${n}`).join(', ')
}

export { loadRecording }

export async function runSundayReplay(input: ReplayInput): Promise<ReplayResult> {
  const { service, recording, log } = input
  const header = recording.header
  if (typeof header.season !== 'number' || typeof header.week !== 'number') {
    throw new Error('recording header carries no season/week')
  }
  const stamps = recording.entries.map((e) => Date.parse(e.t))
  const recStart = Math.min(...stamps)
  const clip = input.clipMinutes === undefined ? input.profile.replayClipMinutes : input.clipMinutes
  const recEnd = clip === null ? Math.max(...stamps) : Math.min(Math.max(...stamps), recStart + clip * 60_000)
  const shiftMs = shiftFor(header.season, header.week)

  const virtual = new VirtualClock(new Date(recStart), { speed: input.speed, wallClock: input.wallClock })
  // D6 anchor: the provider maps virtual-at-construction to the recording's
  // first stamp — so construct at recStart, THEN step to the first instant
  // a full poll has answers for.
  const replay = new FixtureReplayProvider(recording, virtual)
  virtual.advanceBy(Math.max(0, firstCompletePoll(recording) - recStart))
  const provider = new LoadSeasonProvider(replay, header.season, header.week, shiftMs)
  const clock = shifted(virtual, shiftMs)
  const degradation = new DegradationTracker()
  const io = { db: service, degradation, season: LOAD_SEASON, week: LOAD_WEEK }

  const result: ReplayResult = {
    polls: 0,
    pollsWithDeltas: 0,
    deltas: 0,
    lagMs: [],
    lagTimeouts: 0,
    workerBatches: 0,
    workerProblems: [],
    correctionsDetected: 0,
    correctionsRecorded: 0,
    correctionEventsStored: 0,
    reconcileAlerts: {},
    reconcileOther: {},
    reconcileCells: 0,
    reconcileReason: null,
    scoredLeagues: 0,
  }
  const rostered = await rosteredPlayers(service, input.leagueIds)
  if (rostered.length === 0) throw new Error('the load leagues roster nobody — re-seed with --scenario leagues')
  const pending: Array<{ polledAt: string; wallAt: number }> = []
  let lastPollCompleted: string | null = null
  let feeding = true
  const scored = new Set<string>()
  const pollMs = (input.pollSec ?? input.profile.pollSec) * 1000
  const wall = (): number => input.wallClock.now().getTime()

  log(
    `sunday-replay: ${sizeBanner(input.profile)} · ${input.speed}× · recording ${header.provider} ${header.season} wk${header.week} ` +
      `(${Math.round((recEnd - recStart) / 60_000)} recorded min → ${Math.round((recEnd - recStart) / input.speed / 60_000)} wall min) · ` +
      `${input.leagueIds.length} leagues · worker ${input.worker}`,
  )

  const feed = async (): Promise<void> => {
    // Poll until one poll has run PAST the recording's end (that poll serves
    // the last capture — a loop that stopped at the end could miss it).
    for (let crossed = false; !crossed; ) {
      crossed = virtual.now().getTime() > recEnd
      const started = wall()
      try {
        const report = await ingestWeek(provider, clock, io)
        result.polls += 1
        if (report.ok) lastPollCompleted = report.polledAt
        result.correctionsDetected += report.corrections.detected
        result.correctionsRecorded += report.corrections.recorded
        if (report.stats.deltas > 0) {
          result.pollsWithDeltas += 1
          result.deltas += report.stats.deltas
          pending.push({ polledAt: report.polledAt, wallAt: wall() })
        }
        if (!report.ok) log(`  poll ${result.polls}: provider read failed (${report.error ?? '?'}) — nothing written (§23.2)`)
      } catch (e) {
        // "no recorded response yet" before the first capture is expected on
        // the very first instant only; anything else is a real failure.
        log(`  poll ${result.polls + 1} threw: ${(e as Error).message}`)
      }
      const wait = pollMs - (wall() - started)
      if (!crossed && wait > 0) await input.sleep(wait)
    }
    feeding = false
  }

  const work = async (): Promise<void> => {
    if (input.worker !== 'self') return
    const workMs = input.profile.workerSec * 1000
    const drainEnd = (): boolean => !feeding && pending.length === 0
    let idleSince: number | null = null
    while (true) {
      const started = wall()
      const batch = await runScoreWeekBatch(
        { time: clock, db: service, lastPollCompletedAt: async () => lastPollCompleted },
        { batchSize: 1000, leagueIds: [...input.leagueIds] },
      )
      result.workerBatches += 1
      result.workerProblems.push(...batch.problems)
      for (const l of batch.leagues) if (l.outcome === 'written' || l.outcome === 'no_change') scored.add(l.league_id)
      if (drainEnd()) {
        idleSince ??= wall()
        if (wall() - idleSince > 2 * workMs) return
      }
      const wait = workMs - (wall() - started)
      if (wait > 0) await input.sleep(wait)
    }
  }

  const measure = async (): Promise<void> => {
    let drainDeadline: number | null = null
    while (feeding || pending.length > 0) {
      const head = pending[0]
      if (head !== undefined) {
        const left = await queuedAtOrBefore(service, head.polledAt, rostered)
        const age = wall() - head.wallAt
        if (left === 0) {
          result.lagMs.push(age)
          pending.shift()
          continue
        }
        if (age >= LAG_TIMEOUT_MS) {
          result.lagMs.push(age)
          result.lagTimeouts += 1
          log(`  lag TIMEOUT: poll ${head.polledAt} still has ${left} queued row(s) after ${Math.round(age / 1000)} s`)
          pending.shift()
          continue
        }
      }
      if (!feeding) {
        drainDeadline ??= wall() + DRAIN_GRACE_MS
        if (wall() > drainDeadline) break
      }
      await input.sleep(500)
    }
  }

  await Promise.all([feed(), work(), measure()])

  const events = await service
    .from('stat_correction_events')
    .select('id', { count: 'exact', head: true })
    .eq('season', LOAD_SEASON)
  if (events.error) throw new Error(`stat_correction_events count failed: ${events.error.message}`)
  result.correctionEventsStored = events.count ?? 0
  const rec = await reconcileSeason({ time: clock, db: service }, { season: LOAD_SEASON, leagueIds: [...input.leagueIds] })
  const split = splitAlerts(rec.findings, new Set(rostered))
  result.reconcileAlerts = split.scored
  result.reconcileOther = split.other
  result.reconcileCells = rec.cells
  result.reconcileReason = rec.reason
  result.scoredLeagues = scored.size
  return result
}

export function replayAsserts(r: ReplayResult, speed: number, leagues: number): AssertLine[] {
  const p95 = percentile(r.lagMs, 95)
  const scoredAlerts = Object.values(r.reconcileAlerts).reduce((a, b) => a + b, 0)
  return [
    {
      name: `§22.6 (3) scoring lag p95 < ${SCORING_LAG_P95_MS / 1000} s behind ingestion (${speed}×)`,
      pass: p95 !== null && p95 < SCORING_LAG_P95_MS && r.lagTimeouts === 0,
      detail: `${describeTrend(r.lagMs)} · ${r.lagTimeouts} poll(s) past the ${LAG_TIMEOUT_MS / 1000} s timeout`,
    },
    {
      name: '§22.6 (3) no missed corrections — reconcile: every stored cell equals a fresh recompute',
      pass: scoredAlerts === 0 && r.reconcileCells > 0,
      detail:
        `${scoredAlerts} score alert(s) (${kindsLine(r.reconcileAlerts)}) over ${r.reconcileCells} cell(s)` +
        `${r.reconcileReason ? ` (${r.reconcileReason})` : ''} · ` +
        `corrections: ${r.correctionsDetected} detected, ${r.correctionsRecorded} recorded, ${r.correctionEventsStored} stored`,
    },
    {
      name: 'reconcile alerts that do not judge this replay (the harness calendar; queue rows for players no load league rosters)',
      pass: true,
      info: true,
      detail: kindsLine(r.reconcileOther),
    },
    {
      name: 'the replay produced deltas and every league scored (harness — else the asserts above are vacuous)',
      pass: r.pollsWithDeltas > 0 && r.scoredLeagues === leagues,
      detail: `${r.polls} polls · ${r.pollsWithDeltas} with deltas · ${r.deltas} deltas · ${r.scoredLeagues}/${leagues} leagues scored · ${r.workerBatches} worker batches`,
    },
    {
      name: 'worker problems',
      pass: true,
      info: true,
      detail: r.workerProblems.length === 0 ? 'none' : `${r.workerProblems.length}: ${r.workerProblems.slice(0, 3).join(' | ')}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const known = new Set(['--target', '--profile', '--recording', '--speed', '--worker', '--clip-minutes', '--poll-sec'])
  for (let i = 0; i < argv.length; i += 2) if (!known.has(argv[i]!)) throw new Error(`unknown argument '${argv[i]}' (refused, never ignored)`)
  const target = resolveTarget(flag('--target'))
  const profile = resolveProfile(flag('--profile'))
  const manifest = parseManifest(readFileSync(manifestPath('leagues'), 'utf8'))
  if (manifest.profile !== profile.name || manifest.target !== target.kind) {
    throw new Error(`the leagues manifest was seeded for ${manifest.profile}/${manifest.target}, not ${profile.name}/${target.kind}`)
  }
  const recordingPath = flag('--recording')
  if (!recordingPath) throw new Error('--recording <fixture.jsonl.gz> is required (a recorded Sunday time series)')
  const worker = (flag('--worker') ?? 'self') as 'self' | 'external'
  if (worker !== 'self' && worker !== 'external') throw new Error('--worker is self | external')
  const service = createClient<Database>(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // ONE speed per run: a second replay onto the same leagues would find every
  // line already stored and measure nothing (re-seed between speeds).
  const speed = Number(flag('--speed'))
  if (!profile.replaySpeed.includes(speed) && profile.name !== 'smoke') {
    throw new Error(`--speed is required: one of ${profile.replaySpeed.join(' | ')} (spec §22.6 (3))`)
  }
  if (!(speed > 0)) throw new Error('--speed must be a positive number')
  const clip = flag('--clip-minutes')
  let green = true
  {
    const r = await runSundayReplay({
      service,
      profile,
      recording: loadRecording(recordingPath),
      speed,
      leagueIds: manifest.leagues.map((l) => l.leagueId),
      worker,
      clipMinutes: clip === undefined ? undefined : clip === 'all' ? null : Number(clip),
      pollSec: flag('--poll-sec') ? Number(flag('--poll-sec')) : undefined,
      wallClock: { now: () => new Date() },
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      log: (line) => console.log(line),
    })
    const lines = replayAsserts(r, speed, manifest.leagues.length)
    for (const line of renderAsserts(`SCENARIO 3 — Sunday replay at ${speed}× · ${sizeBanner(profile)}`, lines)) console.log(line)
    green &&= allPass(lines)
  }
  process.exit(green ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((e) => {
    console.error(`sunday-replay: ${(e as Error).message}`)
    process.exit(1)
  })
}
