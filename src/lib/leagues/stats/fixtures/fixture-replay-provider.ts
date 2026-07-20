/**
 * FixtureReplayProvider — the replay half of the M0 fixture pair (D6; task
 * L.A0.4). Implements the same §23.1 contract as every other tier.
 *
 * Semantics (D6): the recording's FIRST timestamp is anchored to the virtual
 * clock's reading at construction; every call serves the LATEST recorded
 * response with capture-time ≤ virtual now for that (method, args) —
 * deterministic under any poll cadence or replay speed. Recorded failures
 * replay as thrown failures; asking for something the session never recorded
 * (or hasn't recorded *yet* at the current virtual time) throws a
 * descriptive error rather than inventing data (§23.2 "never wrong numbers").
 *
 * Identity (D28): `name` is `fixture:<recorded provider>` — honest about
 * data origin, per the §4 sketch. Consumers that need to reproduce a live
 * session's rows byte-for-byte (source column included) read
 * `recordedProviderName` and opt in deliberately; the replayer never
 * impersonates its source silently.
 */

import type { TimeProvider } from '../../time/time-provider'
import type { StatTier } from '../stat-keys'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '../stats-provider'
import type { FixtureEntry, FixtureMethod, FixtureRecording } from './fixture-format'
import { reviveDates } from './fixture-format'

function callKey(method: FixtureMethod, args: number[]): string {
  return `${method}(${args.join(',')})`
}

/** A replayed recorded failure. Carries the recorded HTTP-ish `status` so a
 *  consumer branching on it sees the same information live and replayed —
 *  the recorder captures it, so replay must not drop it (D6/R29). */
export class ReplayedFailureError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ReplayedFailureError'
  }
}

export class FixtureReplayProvider implements StatsProvider {
  readonly name: string
  /** The identity the fixture was recorded from (header, D27/D28). */
  readonly recordedProviderName: string
  /** Replay carries whatever the recording carried — tier gating (M1, D5)
   *  should treat a fixture as its source tier. */
  readonly capabilities: ReadonlySet<StatTier>

  private readonly byCall = new Map<string, FixtureEntry[]>()
  private readonly recordingStartMs: number
  private readonly virtualStartMs: number

  constructor(
    recording: FixtureRecording,
    private readonly time: TimeProvider,
    opts: { capabilities?: ReadonlySet<StatTier> } = {},
  ) {
    if (recording.entries.length === 0) {
      throw new Error('FixtureReplayProvider: recording has no entries')
    }
    this.recordedProviderName = recording.header.provider
    this.name = `fixture:${recording.header.provider}`
    this.capabilities = opts.capabilities ?? new Set<StatTier>(['core_box'])

    for (const entry of recording.entries) {
      const key = callKey(entry.method, entry.args)
      const bucket = this.byCall.get(key)
      if (bucket) bucket.push(entry)
      else this.byCall.set(key, [entry])
    }
    // Defensive: serve by capture order even if the file was concatenated.
    for (const bucket of this.byCall.values()) {
      bucket.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    }
    this.recordingStartMs = Math.min(
      ...recording.entries.map((e) => new Date(e.t).getTime()),
    )
    // D6 anchor: virtual time at construction ≙ the recording's first stamp.
    this.virtualStartMs = time.now().getTime()
  }

  /** The recording-timeline instant corresponding to virtual now. */
  private cutoffMs(): number {
    return this.recordingStartMs + (this.time.now().getTime() - this.virtualStartMs)
  }

  private replay<T>(method: FixtureMethod, args: number[]): T {
    const key = callKey(method, args)
    const bucket = this.byCall.get(key)
    if (!bucket) {
      throw new Error(
        `FixtureReplayProvider: session never recorded ${key} (fixture: ${this.recordedProviderName})`,
      )
    }
    const cutoff = this.cutoffMs()
    let latest: FixtureEntry | undefined
    for (const entry of bucket) {
      if (new Date(entry.t).getTime() > cutoff) break
      latest = entry
    }
    if (!latest) {
      throw new Error(
        `FixtureReplayProvider: no recorded response yet for ${key} at virtual ${new Date(
          this.time.now().getTime(),
        ).toISOString()} (first recorded ${bucket[0].t})`,
      )
    }
    if (!latest.ok) {
      // Recorded failure windows replay as failures (D6), status included (R29).
      throw new ReplayedFailureError(
        latest.error ?? `recorded failure for ${key} at ${latest.t}`,
        latest.status,
      )
    }
    return reviveDates(latest.body) as T
  }

  async getSchedule(season: number): Promise<ProviderGame[]> {
    return this.replay('getSchedule', [season])
  }

  async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    return this.replay('getGameStates', [season, week])
  }

  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    return this.replay('getWeekStats', [season, week])
  }

  async getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    return this.replay('getInjuries', [season, week])
  }

  async getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    return this.replay('getInactives', [season, week])
  }
}
