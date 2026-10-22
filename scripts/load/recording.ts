/**
 * Load a `fieldscout-fixture` recording for the Sunday replay (M7 L.F2.1).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { parseFixture, type FixtureRecording } from '@/lib/leagues/stats/fixtures/fixture-format'

/**
 * One recording, or several of the SAME (provider, season, week) joined into
 * one time series (comma-separated paths) — e.g. a slate's final capture and
 * its window-end capture, whose differences are the week's corrections.
 */
export function loadRecording(paths: string): FixtureRecording {
  const parts = paths.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
  const recordings = parts.map((path) => {
    const raw = readFileSync(resolve(process.cwd(), path))
    return parseFixture((path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'))
  })
  const first = recordings[0]
  if (!first) throw new Error('no recording path given')
  for (const r of recordings.slice(1)) {
    if (r.header.provider !== first.header.provider || r.header.season !== first.header.season || r.header.week !== first.header.week) {
      throw new Error('joined recordings must share provider, season and week')
    }
  }
  return { header: first.header, entries: recordings.flatMap((r) => r.entries) }
}

/** The first instant at which BOTH reads ingestion makes have a recorded
 *  answer (a poll before it is a replayed "nothing recorded yet" failure). */
export function firstCompletePoll(recording: FixtureRecording): number {
  const first = (method: string): number => {
    const ts = recording.entries.filter((e) => e.method === method).map((e) => Date.parse(e.t))
    if (ts.length === 0) throw new Error(`recording has no ${method} entries`)
    return Math.min(...ts)
  }
  return Math.max(first('getSchedule'), first('getWeekStats'))
}

