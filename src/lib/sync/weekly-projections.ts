/**
 * weekly-projections — THIS WEEK's projected stat lines from Sleeper into
 * `player_weekly_projections` (M6A task L.E1.19; migration 136; PROGRESS Q62
 * (RULED 2026-09-27), F379 first third, D373; spec §12.27 / §14's
 * `sync-weekly-projections` row).
 *
 * The weekly counterpart of `projections.ts` (the preseason SEASON line on
 * `players`). It stores stat LINES, never points — L.E1.20 scores them
 * through the league's own scoring (calculator.ts, D33).
 *
 * WHAT ONE RUN DOES
 *   1. PLAN from `nfl_weeks` at the injected instant (§23.3 — never
 *      wall-clock week math, never Sleeper's `state` call): the CURRENT
 *      calendar week (the greatest `starts_at <= now`, week 1 before the
 *      season) and the NEXT one — so the coming week's lines are in place
 *      from Wednesday 00:00 ET, before Thursday's first lock, while the
 *      current week keeps tracking injury news through Monday. Past the last
 *      week's correction window the season is over and the plan is EMPTY
 *      WITH A NAMED REASON (never an empty success).
 *   2. FETCH each planned week, all six positions (plain `fetch` of the
 *      public endpoint — no scraping service, project rule), each request
 *      bounded by FETCH_TIMEOUT_MS: a hang is a named per-position failure,
 *      never a stalled run (R1109).
 *   3. VALIDATE before writing anything for the week. MEASURED 2026-09-27
 *      (src/lib/sync/fixtures/sleeper-weekly-projections-2026.json, `_note`): the endpoint answers HTTP 200 with
 *      hundreds of FILLER rows (`stats = {adp_dd_ppr: 1000}`) for players it
 *      did not project — and for a week that does not exist it answers 200
 *      with NOTHING BUT filler. So "rows came back" proves nothing; the count
 *      that matters is PROJECTED rows (a row carrying Sleeper's own point
 *      totals). A position with ZERO projected rows is a FAILURE for the
 *      week (a partial response — every real week projects every position),
 *      and nothing is written for that week. A row whose `week` is not the
 *      week asked for is a failure too.
 *   4. COMPARE with what is STORED for the week (R1105): the stored lines
 *      are read first, attributed to a position through `players.position`,
 *      and any position whose fresh projected count falls BELOW HALF of a
 *      non-trivial stored count (>= DROP_GUARD_MIN_STORED) fails the week by
 *      name — a degraded 200 that keeps one projected row per position must
 *      not let the stale delete wipe the rest. A week's first sync (nothing
 *      stored) is unaffected.
 *   5. WRITE (service role): upsert the week's projected rows for KNOWN
 *      players, then delete that week's stored rows the fresh fetch no longer
 *      projects (a player ruled out drops to filler — a stale line would
 *      outrank him forever). Every write asserts its own row count; a count
 *      that does not match fails the week by name — a 0-row write is never
 *      "done", and a short upsert issues NO delete.
 *   6. REPORT loudly: unknown Sleeper ids (not in `players`) are counted AND
 *      named, duplicates counted, every failure named; `ok` is false when
 *      any planned week failed or nothing was planned for a reason other
 *      than the season being over.
 *
 * Time only via the injected TimeProvider (D3 — this file is under the
 * ESLint time guard); the fetch is injectable so tests make ZERO external
 * calls (M0 rule).
 */
import { mapToCanonicalKeys } from '@/lib/leagues/stats/sleeper-stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { pageAll } from '@/lib/supabase/page-all'

import { fetchKnownPlayerIds } from './projections'
import type { SyncClient, SyncSummary } from './types'

export const WEEKLY_PROJECTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type WeeklyProjectionPosition = (typeof WEEKLY_PROJECTION_POSITIONS)[number]

export const WEEKLY_PROJECTIONS_SOURCE = 'sleeper'
export const WEEKLY_PROJECTIONS_TABLE = 'player_weekly_projections'

/** Upsert / delete chunk sizes (PostgREST bodies and `in.(…)` URLs stay small). */
const UPSERT_CHUNK = 500
const DELETE_CHUNK = 200
/** How many unknown ids a warning names before it summarises the rest. */
const UNKNOWN_NAMED = 10

/** Per-request bound on the Sleeper fetch (R1109). Two planned weeks fetch
 *  sequentially, six positions in parallel, so the worst case is ~30 s —
 *  inside the cron route's `maxDuration = 60`. */
export const FETCH_TIMEOUT_MS = 15_000

/**
 * The sharp-drop guard's floor (R1105): a position is compared only when at
 * least this many lines are STORED for it. Measured 2026-09-27 (week 4, full
 * responses): QB 33 / RB 108 / WR 169 / TE 106 / K 33 / DEF 32 projected, and
 * a bye week removes at most a handful of teams — so every real position
 * stores well above 5 and the floor exempts nothing real. Below it the stored
 * set is not a real week (a test plant, a hand run of one player), where
 * "below half" is one or two players' noise, not a degraded response.
 */
export const DROP_GUARD_MIN_STORED = 5

// ── The endpoint ───────────────────────────────────────────────────────────

/** The weekly counterpart of `projections.ts`'s season URL — verified
 *  2026-09-27 (the fixture's `_note` records the measurement). */
export function sleeperWeeklyProjectionsUrl(season: number, week: number, position: WeeklyProjectionPosition): string {
  return `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&position[]=${position}`
}

export type FetchWeeklyProjections = (season: number, week: number, position: WeeklyProjectionPosition) => Promise<unknown>

/**
 * The production fetch — plain `fetch`, loud on a non-2xx, and bounded: the
 * request AND the body read share one `AbortSignal.timeout`, so a hang ends as
 * a named error (R1109) rather than a stalled run. `fetchImpl` / `timeoutMs`
 * are injectable so the timeout is pinned with zero external calls.
 */
export function makeSleeperWeeklyFetch(opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): FetchWeeklyProjections {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  return async (season, week, position) => {
    const fetchImpl = opts.fetchImpl ?? fetch
    try {
      const res = await fetchImpl(sleeperWeeklyProjectionsUrl(season, week, position), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
      return await res.json()
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(`timed out after ${timeoutMs} ms (${err.name})`)
      }
      throw err
    }
  }
}

export const fetchSleeperWeeklyProjections: FetchWeeklyProjections = makeSleeperWeeklyFetch()

// ── The plan (pure) ────────────────────────────────────────────────────────

export interface ProjectionCalendarWeek {
  season: number
  week: number
  starts_at: string
  correction_window_ends_at: string | null
}

export interface ProjectionWeekPlan {
  weeks: number[]
  currentWeek: number | null
  /** Why the plan is what it is — always set, never an empty success. */
  reason: string
  /** True only when the plan is empty because the season is OVER (a named, expected idle). */
  seasonComplete: boolean
}

export function planProjectionWeeks(calendar: ProjectionCalendarWeek[], now: Date): ProjectionWeekPlan {
  const weeks = [...calendar].sort((a, b) => a.week - b.week)
  if (weeks.length === 0) {
    return { weeks: [], currentWeek: null, reason: 'no nfl_weeks rows for the season — nothing to plan (the calendar is empty)', seasonComplete: false }
  }
  const nowMs = now.getTime()
  let current = weeks[0]
  let started = false
  for (const w of weeks) {
    if (Date.parse(w.starts_at) <= nowMs) {
      current = w
      started = true
    }
  }
  const last = weeks[weeks.length - 1]
  if (current.week === last.week && last.correction_window_ends_at !== null && nowMs >= Date.parse(last.correction_window_ends_at)) {
    return {
      weeks: [],
      currentWeek: current.week,
      reason: `season complete: past week ${last.week}'s correction window (${last.correction_window_ends_at}) — no week left to project`,
      seasonComplete: true,
    }
  }
  const next = weeks.find((w) => w.week > current.week)
  const planned = next ? [current.week, next.week] : [current.week]
  const lead = started ? `current calendar week ${current.week}` : `before the season — week ${current.week} (clamped)`
  return {
    weeks: planned,
    currentWeek: current.week,
    reason: next ? `${lead} and the next, week ${next.week}` : `${lead} (the season's last week — no next)`,
    seasonComplete: false,
  }
}

// ── Parse + validate one week (pure) ───────────────────────────────────────

interface SleeperWeeklyRow {
  player_id?: unknown
  week?: unknown
  stats?: unknown
  updated_at?: unknown
  player?: { first_name?: unknown; last_name?: unknown; position?: unknown; team?: unknown } | null
}

export interface WeeklyProjectionRow {
  season: number
  week: number
  player_id: string
  stats: Record<string, number>
  raw_stats: Record<string, unknown>
  source: string
  source_updated_at: string | null
  fetched_at: string
}

export interface PositionCounts {
  rows: number
  projected: number
  filler: number
}

export interface WeekParse {
  week: number
  /** Projected rows for KNOWN players — what the write would store. */
  rows: WeeklyProjectionRow[]
  perPosition: Record<WeeklyProjectionPosition, PositionCounts>
  /** Projected rows whose Sleeper id is not in `players` — counted AND named. */
  unknown: Array<{ player_id: string; label: string }>
  /** Player ids projected more than once in the week (the first is kept). */
  duplicates: string[]
  /** Anything that makes the week unwritable. Non-empty ⇒ NOTHING is written for the week. */
  failures: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A PROJECTED row carries Sleeper's own point totals; a filler row does not
 *  (measured: filler stats are `{adp_dd_ppr: 1000}` alone). */
export function isProjectedRow(stats: unknown): stats is Record<string, unknown> {
  return isRecord(stats) && (finite(stats.pts_ppr) || finite(stats.pts_std) || finite(stats.pts_half_ppr))
}

function labelOf(row: SleeperWeeklyRow): string {
  const p = row.player ?? null
  const name = [p?.first_name, p?.last_name].filter((s) => typeof s === 'string' && s !== '').join(' ')
  const pos = typeof p?.position === 'string' ? p.position : '?'
  const team = typeof p?.team === 'string' ? p.team : 'FA'
  return `${String(row.player_id)} (${name || 'unnamed'} ${pos} ${team})`
}

function sourceUpdatedAt(value: unknown): string | null {
  if (!finite(value)) return null
  const d = new Date(value as number)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function parseWeeklyProjections(input: {
  season: number
  week: number
  responses: Record<WeeklyProjectionPosition, unknown>
  known: ReadonlySet<string>
  fetchedAt: string
}): WeekParse {
  const { season, week, known, fetchedAt } = input
  const out: WeekParse = {
    week,
    rows: [],
    perPosition: {} as Record<WeeklyProjectionPosition, PositionCounts>,
    unknown: [],
    duplicates: [],
    failures: [],
  }
  const seen = new Set<string>()
  for (const position of WEEKLY_PROJECTION_POSITIONS) {
    const body = input.responses[position]
    const counts: PositionCounts = { rows: 0, projected: 0, filler: 0 }
    out.perPosition[position] = counts
    if (!Array.isArray(body)) {
      out.failures.push(`week ${week} ${position}: the response is not an array (${body === null ? 'null' : typeof body}) — nothing written for the week`)
      continue
    }
    for (const raw of body as SleeperWeeklyRow[]) {
      counts.rows++
      if (!isRecord(raw) || typeof raw.player_id !== 'string' || raw.player_id === '') {
        out.failures.push(`week ${week} ${position}: a row with no player_id — a malformed response, nothing written for the week`)
        continue
      }
      if (!isProjectedRow(raw.stats)) {
        counts.filler++
        continue
      }
      counts.projected++
      if (raw.week !== undefined && Number(raw.week) !== week) {
        out.failures.push(`week ${week} ${position}: player ${raw.player_id} came back labelled week ${String(raw.week)} — a misrouted response, nothing written for the week`)
        continue
      }
      const id = raw.player_id
      if (seen.has(id)) {
        out.duplicates.push(id)
        continue
      }
      seen.add(id)
      if (!known.has(id)) {
        out.unknown.push({ player_id: id, label: labelOf(raw) })
        continue
      }
      out.rows.push({
        season,
        week,
        player_id: id,
        stats: mapToCanonicalKeys(raw.stats as Record<string, number | null>) as Record<string, number>,
        raw_stats: raw.stats,
        source: WEEKLY_PROJECTIONS_SOURCE,
        source_updated_at: sourceUpdatedAt(raw.updated_at),
        fetched_at: fetchedAt,
      })
    }
    if (counts.projected === 0) {
      out.failures.push(
        `week ${week} ${position}: ZERO projected rows (${counts.rows} row(s), ${counts.filler} filler) — every real week projects every position, so this is a partial or empty response; nothing written for the week`,
      )
    }
  }
  return out
}

// ── The run ────────────────────────────────────────────────────────────────

export interface WeekReport {
  week: number
  ok: boolean
  perPosition: Record<WeeklyProjectionPosition, PositionCounts> | null
  projected: number
  stored: number
  removed: number
  unknown: number
  duplicates: number
  failures: string[]
}

export interface WeeklyProjectionsReport extends SyncSummary {
  season: number
  plan: ProjectionWeekPlan
  weeks: WeekReport[]
  failures: string[]
  /** False when any planned week failed, or nothing was planned for any reason but a completed season. */
  ok: boolean
  fetched_at: string
}

export interface WeeklyProjectionsDeps {
  db: SyncClient
  time: TimeProvider
  fetchWeek?: FetchWeeklyProjections
  /** Injectable for tests; production reads `players` (paged). */
  knownPlayerIds?: (db: SyncClient) => Promise<Set<string>>
}

export async function readProjectionCalendar(db: SyncClient, season: number): Promise<ProjectionCalendarWeek[]> {
  const { data, error } = await db
    .from('nfl_weeks')
    .select('season, week, starts_at, correction_window_ends_at')
    .eq('season', season)
    .order('week')
  if (error) throw new Error(`nfl_weeks read (${season}): ${error.message}`)
  return (data ?? []) as ProjectionCalendarWeek[]
}

export interface StoredLine {
  player_id: string
  /** `players.position` of the stored line's player (null when it has none). */
  position: string | null
}

/** Every line stored for (season, week), with its player's position — paged
 *  past PostgREST's 1000-row cap with an exact count (pageAll). */
async function storedLines(db: SyncClient, season: number, week: number): Promise<StoredLine[]> {
  // A many-to-one embed arrives as an object at runtime; the untyped sync
  // client infers an array — both are accepted, neither is assumed.
  type Embed = { position: string | null }
  const rows = await pageAll<{ player_id: string; players: Embed | Embed[] | null }>((from, to) =>
    db
      .from(WEEKLY_PROJECTIONS_TABLE)
      .select('player_id, players(position)', { count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .order('player_id')
      .range(from, to),
  )
  return rows.map((r) => {
    const p = Array.isArray(r.players) ? r.players[0] : r.players
    return { player_id: r.player_id, position: p?.position ?? null }
  })
}

/**
 * The sharp-drop guard (R1105), pure: per position, the fresh PROJECTED count
 * against the STORED count. Stored >= DROP_GUARD_MIN_STORED and fresh below
 * half of it ⇒ a named failure (position, stored n, fresh n). Nothing stored
 * (a week's first sync) never trips it.
 */
export function sharpDrops(
  week: number,
  perPosition: Record<WeeklyProjectionPosition, PositionCounts>,
  stored: readonly StoredLine[],
): string[] {
  const storedBy = new Map<string, number>()
  for (const s of stored) if (s.position !== null) storedBy.set(s.position, (storedBy.get(s.position) ?? 0) + 1)
  const out: string[] = []
  for (const position of WEEKLY_PROJECTION_POSITIONS) {
    const s = storedBy.get(position) ?? 0
    const f = perPosition[position].projected
    if (s >= DROP_GUARD_MIN_STORED && f * 2 < s) {
      out.push(
        `week ${week} ${position}: the fresh response projects ${f} player(s) where ${s} are stored — a drop below half reads as a degraded response, not the news; nothing written or deleted for the week`,
      )
    }
  }
  return out
}

async function writeWeek(
  db: SyncClient,
  season: number,
  week: number,
  rows: WeeklyProjectionRow[],
  before: readonly StoredLine[],
): Promise<{ stored: number; removed: number }> {
  let stored = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error, count } = await db
      .from(WEEKLY_PROJECTIONS_TABLE)
      .upsert(chunk, { onConflict: 'season,week,player_id', count: 'exact' })
    if (error) throw new Error(`week ${week} upsert failed: ${error.message}`)
    if (count !== chunk.length) {
      throw new Error(`week ${week} upsert wrote ${String(count)} row(s) for ${chunk.length} sent — refusing to call that done`)
    }
    stored += count
  }

  // Stale = stored BEFORE this run's upsert and not in the fresh fetch (every
  // row the upsert added is fresh by construction).
  const fresh = new Set(rows.map((r) => r.player_id))
  const stale = before.map((s) => s.player_id).filter((id) => !fresh.has(id))
  let removed = 0
  for (let i = 0; i < stale.length; i += DELETE_CHUNK) {
    const chunk = stale.slice(i, i + DELETE_CHUNK)
    const { error, count } = await db
      .from(WEEKLY_PROJECTIONS_TABLE)
      .delete({ count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .in('player_id', chunk)
    if (error) throw new Error(`week ${week} stale delete failed: ${error.message}`)
    if (count !== chunk.length) {
      throw new Error(`week ${week} stale delete removed ${String(count)} row(s) for ${chunk.length} named — refusing to call that done`)
    }
    removed += count
  }
  return { stored, removed }
}

function namedUnknown(week: number, unknown: WeekParse['unknown']): string {
  const shown = unknown.slice(0, UNKNOWN_NAMED).map((u) => u.label)
  const rest = unknown.length - shown.length
  return `week ${week}: ${unknown.length} projected player(s) not in players — NOT stored (run sync:players): ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`
}

/**
 * One run. `weeks` overrides the plan (the CLI's explicit-week form); the
 * default plans from `nfl_weeks` at `time.now()`.
 */
export async function syncWeeklyProjections(
  deps: WeeklyProjectionsDeps,
  opts: { season: number; weeks?: number[] },
): Promise<WeeklyProjectionsReport> {
  const { db, time } = deps
  const fetchWeek = deps.fetchWeek ?? fetchSleeperWeeklyProjections
  const now = time.now()
  const calendar = await readProjectionCalendar(db, opts.season)

  const inCalendar = new Set(calendar.map((w) => w.week))
  const missing = (opts.weeks ?? []).filter((w) => !inCalendar.has(w))
  let plan: ProjectionWeekPlan
  if (opts.weeks && opts.weeks.length > 0) {
    plan = {
      weeks: opts.weeks.filter((w) => inCalendar.has(w)),
      currentWeek: null,
      reason: `explicit week(s) ${opts.weeks.join(', ')}${missing.length ? ` — NOT in nfl_weeks for ${opts.season}: ${missing.join(', ')}` : ''}`,
      seasonComplete: false,
    }
  } else {
    plan = planProjectionWeeks(calendar, now)
  }

  const report: WeeklyProjectionsReport = {
    name: 'weekly-projections',
    season: opts.season,
    plan,
    weeks: [],
    failures: [],
    counts: { weeks: 0, projected: 0, stored: 0, removed: 0, unknownPlayer: 0, duplicates: 0, failedWeeks: 0 },
    warnings: [],
    ok: true,
    fetched_at: now.toISOString(),
  }

  for (const w of missing) {
    report.failures.push(`week ${w}: not in nfl_weeks for season ${opts.season} — the calendar decides which weeks exist (§23.3); nothing fetched`)
  }
  if (plan.weeks.length === 0 && !plan.seasonComplete && report.failures.length === 0) {
    report.failures.push(`nothing planned: ${plan.reason}`)
  }

  const known = plan.weeks.length > 0 ? await (deps.knownPlayerIds ?? fetchKnownPlayerIds)(db) : new Set<string>()
  if (plan.weeks.length > 0 && known.size === 0) {
    report.failures.push('players is EMPTY — every projection would be an unknown id; run sync:players first (nothing fetched, nothing written)')
    return finish(report)
  }

  for (const week of plan.weeks) {
    const fetchedAt = time.now().toISOString()
    const responses = {} as Record<WeeklyProjectionPosition, unknown>
    const fetchFailures: string[] = []
    await Promise.all(
      WEEKLY_PROJECTION_POSITIONS.map(async (position) => {
        try {
          responses[position] = await fetchWeek(opts.season, week, position)
        } catch (err) {
          responses[position] = undefined
          fetchFailures.push(`week ${week} ${position}: fetch failed — ${err instanceof Error ? err.message : String(err)}; nothing written for the week`)
        }
      }),
    )
    if (fetchFailures.length > 0) {
      report.weeks.push(emptyWeekReport(week, fetchFailures.sort()))
      continue
    }

    const parsed = parseWeeklyProjections({ season: opts.season, week, responses, known, fetchedAt })
    const projected = Object.values(parsed.perPosition).reduce((n, c) => n + c.projected, 0)
    const wr: WeekReport = {
      week,
      ok: parsed.failures.length === 0,
      perPosition: parsed.perPosition,
      projected,
      stored: 0,
      removed: 0,
      unknown: parsed.unknown.length,
      duplicates: parsed.duplicates.length,
      failures: [...parsed.failures],
    }
    if (parsed.unknown.length > 0) report.warnings.push(namedUnknown(week, parsed.unknown))
    if (parsed.duplicates.length > 0) {
      report.warnings.push(`week ${week}: ${parsed.duplicates.length} player id(s) projected more than once (first kept): ${parsed.duplicates.slice(0, UNKNOWN_NAMED).join(', ')}`)
    }
    if (wr.ok) {
      try {
        const before = await storedLines(db, opts.season, week)
        const drops = sharpDrops(week, parsed.perPosition, before)
        if (drops.length > 0) {
          wr.ok = false
          wr.failures.push(...drops)
        } else {
          const written = await writeWeek(db, opts.season, week, parsed.rows, before)
          wr.stored = written.stored
          wr.removed = written.removed
        }
      } catch (err) {
        wr.ok = false
        wr.failures.push(err instanceof Error ? err.message : String(err))
      }
    }
    report.weeks.push(wr)
  }
  return finish(report)
}

function emptyWeekReport(week: number, failures: string[]): WeekReport {
  return { week, ok: false, perPosition: null, projected: 0, stored: 0, removed: 0, unknown: 0, duplicates: 0, failures }
}

function finish(report: WeeklyProjectionsReport): WeeklyProjectionsReport {
  for (const w of report.weeks) {
    report.counts.weeks++
    report.counts.projected += w.projected
    report.counts.stored += w.stored
    report.counts.removed += w.removed
    report.counts.unknownPlayer += w.unknown
    report.counts.duplicates += w.duplicates
    if (!w.ok) {
      report.counts.failedWeeks++
      report.failures.push(...w.failures)
    }
  }
  report.ok = report.failures.length === 0
  return report
}
