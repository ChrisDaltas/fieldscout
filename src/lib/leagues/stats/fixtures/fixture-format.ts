/**
 * Fixture format for recorded StatsProvider sessions (D6; M0 task L.A0.4).
 *
 * JSONL, one line per provider call, gzipped on disk under
 * `fixtures/nfl/<season>/wk<NN>/<provider>.jsonl.gz`. The recorder captures
 * CANONICAL §23.1 method responses only — record/replay reproduces exactly
 * what a live session saw through the contract; nothing outside the payload
 * exists to replay (the D24 rationale depends on this property).
 *
 * Line 1 is a metadata header carrying the recorded provider's identity
 * (D27 — additive to D6's per-call format; see PROGRESS): downstream
 * consumers must be able to know what source a fixture reproduces without
 * guessing from its path. Every subsequent line is a call entry
 * `{ t, method, args, ok, status, body | error }` with `t` = capture-time
 * ISO from the recorder's injected TimeProvider.
 *
 * This module is pure (D1): serialization only — fs/gzip live in the CLI
 * and test harnesses.
 */

export const FIXTURE_FORMAT = 'fieldscout-fixture'
export const FIXTURE_FORMAT_VERSION = 1

export type FixtureMethod =
  | 'getSchedule'
  | 'getGameStates'
  | 'getWeekStats'
  | 'getInjuries'
  | 'getInactives'

export interface FixtureHeader {
  format: typeof FIXTURE_FORMAT
  version: number
  /** The recorded provider's `name` — fixture identity (D27/D24). */
  provider: string
  season: number
  week: number
}

export interface FixtureEntry {
  /** Capture-time ISO timestamp (recorder's injected TimeProvider). */
  t: string
  method: FixtureMethod
  args: number[]
  ok: boolean
  /** HTTP-ish status when the failure carried one; null otherwise. */
  status: number | null
  /** Present iff ok (JSON-serialized §23.1 payload; Dates as ISO strings). */
  body?: unknown
  /** Present iff !ok — replays as a thrown Error with this message. */
  error?: string
}

export interface FixtureRecording {
  header: FixtureHeader
  entries: FixtureEntry[]
}

export function serializeFixture(recording: FixtureRecording): string {
  const lines = [JSON.stringify(recording.header)]
  for (const entry of recording.entries) lines.push(JSON.stringify(entry))
  return lines.join('\n') + '\n'
}

export function parseFixture(jsonl: string): FixtureRecording {
  const lines = jsonl.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) throw new Error('fixture parse: empty file')
  const header = JSON.parse(lines[0]) as FixtureHeader
  if (header.format !== FIXTURE_FORMAT) {
    throw new Error(`fixture parse: unrecognized format ${JSON.stringify(header.format)}`)
  }
  if (header.version !== FIXTURE_FORMAT_VERSION) {
    throw new Error(`fixture parse: unsupported version ${header.version}`)
  }
  // D27's identity guarantee is only total if the header carries it whole —
  // a missing provider would otherwise flow to `name = 'fixture:undefined'`.
  if (typeof header.provider !== 'string' || header.provider.length === 0) {
    throw new Error('fixture parse: header missing provider identity (D27)')
  }
  if (!Number.isInteger(header.season) || !Number.isInteger(header.week)) {
    throw new Error('fixture parse: header missing season/week (D27)')
  }
  const entries = lines.slice(1).map((line) => JSON.parse(line) as FixtureEntry)
  return { header, entries }
}

/** Strict full-ISO-timestamp shape (what Date#toISOString emits). Date-only
 *  strings like ProviderGame.gameDate ('YYYY-MM-DD') deliberately do NOT
 *  match — they must survive replay as strings. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * Recursively revive JSON-serialized §23.1 payloads: every full ISO
 * timestamp string becomes a Date (kickoffAt, reportedAt, publishedAt,
 * advancedFinalAt live at varying depths across the five methods; a strict
 * shape match beats per-method field lists that rot when payloads grow).
 */
export function reviveDates(value: unknown): unknown {
  if (typeof value === 'string') {
    return ISO_TIMESTAMP.test(value) ? new Date(value) : value
  }
  if (Array.isArray(value)) return value.map(reviveDates)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reviveDates(v)]),
    )
  }
  return value
}
