/**
 * RecordingStatsProvider — the "capture real" half of the M0 fixture pair
 * (spec §23.6 build order; D6/D7; task L.A0.4).
 *
 * Wraps any §23.1 provider and writes one fixture entry per call — capture
 * time from the injected TimeProvider (D3: never the wall clock directly),
 * canonical response bodies only, failures recorded as failures — while
 * passing results and errors through to the caller untouched. Pure engine
 * code (D1): the sink is injected; fs/gzip live in the CLI.
 */

import type { TimeProvider } from '../../time/time-provider'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '../stats-provider'
import type { FixtureEntry, FixtureMethod } from './fixture-format'

export interface FixtureSink {
  write(entry: FixtureEntry): void
}

/** In-memory sink — tests and the CLI both collect through this. */
export class MemoryFixtureSink implements FixtureSink {
  readonly entries: FixtureEntry[] = []
  write(entry: FixtureEntry): void {
    this.entries.push(entry)
  }
}

function statusOf(err: unknown): number | null {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

export class RecordingStatsProvider implements StatsProvider {
  readonly name: string
  readonly capabilities: StatsProvider['capabilities']

  constructor(
    private readonly inner: StatsProvider,
    private readonly sink: FixtureSink,
    private readonly time: TimeProvider,
  ) {
    // Transparent wrapper: callers see the inner provider's identity; the
    // fixture header (written by the harness/CLI) records it too (D27).
    this.name = inner.name
    this.capabilities = inner.capabilities
  }

  private async record<T>(method: FixtureMethod, args: number[], call: () => Promise<T>): Promise<T> {
    const t = this.time.now().toISOString()
    try {
      const body = await call()
      // Serialize now so the entry is a faithful JSON snapshot even if the
      // caller later mutates the returned object.
      this.sink.write({ t, method, args, ok: true, status: null, body: JSON.parse(JSON.stringify(body)) })
      return body
    } catch (err) {
      this.sink.write({
        t,
        method,
        args,
        ok: false,
        status: statusOf(err),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  getSchedule(season: number): Promise<ProviderGame[]> {
    return this.record('getSchedule', [season], () => this.inner.getSchedule(season))
  }

  getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    return this.record('getGameStates', [season, week], () =>
      this.inner.getGameStates(season, week),
    )
  }

  getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    return this.record('getWeekStats', [season, week], () =>
      this.inner.getWeekStats(season, week),
    )
  }

  getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    return this.record('getInjuries', [season, week], () => this.inner.getInjuries(season, week))
  }

  getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    return this.record('getInactives', [season, week], () =>
      this.inner.getInactives(season, week),
    )
  }
}
