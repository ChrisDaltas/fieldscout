/**
 * ingestWeek — the in-season ingestion fan-out: provider → tables → queue
 * (spec §22.2 top half, §23.1–23.3, E42/E45; tasks-M4-inseason.md §5/§6
 * L.D2.1; PROGRESS D300/D303). TS only — no migration, no RPC.
 *
 * One poll, three writes, one enqueue, in this order:
 *
 *   1. `getSchedule(season)` → `nfl_games` (idempotent, diff-aware — the
 *      table's FIRST writer, C58) → `nfl_weeks.first_kickoff_at` /
 *      `last_game_ends_at` for every week the schedule touches AND the
 *      calendar knows (F9's columns, live-updated at last — NULL ×18 since
 *      039 until now). A schedule week with no `nfl_weeks` row is skipped
 *      and counted (`weeks.outsideCalendar` — postseason weeks 19–22 once
 *      L.D3.1's feed carries them; 039 seeds 1–18) UNLESS it is the week
 *      being ingested, which throws before any write (R707).
 *   2. `getWeekStats(season, week)` is diffed against the stored rows: only
 *      REAL deltas — a new row, or a row whose scoring inputs (box columns
 *      or `advanced`) moved — enqueue `(season, week, player_id)` into
 *      `score_fanout` (§23.2 "the fan-out queue only sees real deltas"; the
 *      PK dedupes a hot player within a drain window, D292). A row whose
 *      only change is metadata (`is_live`, `game_id`, `source`) is written
 *      but NOT enqueued — nothing a scorer reads moved.
 *   3. THEN `player_stats` (box columns via the registry map + the §23.5
 *      `advanced` JSONB for registry-canonical advanced keys — the D15
 *      placeholders today), `source = provider.name` (F13: honest
 *      provenance, the synthetic gate's zero-real-data instrument),
 *      `updated_at` from the INJECTED clock (D12).
 *
 * Why the queue is written BEFORE the stats (R706 — at-least-once): the two
 * are separate PostgREST calls, not one transaction (no RPC in this task —
 * the single-transaction door is F218). If the invocation dies between them,
 * the stored stat row is still stale, so the NEXT poll re-detects the same
 * delta and re-enqueues it (the PK dedupes an undrained row). Stats-first
 * would lose that delta forever: the stored row would already equal the
 * incoming one, the diff would read `unchanged`, and §23.2's reconciliation
 * only ALERTS on drift — it never re-enqueues. Both stamps come from the one
 * injected instant, so `player_stats.updated_at >= score_fanout.enqueued_at`
 * is the worker's readiness predicate (L.D2.2, F218): a queued player whose
 * stat row is older than its queue row (or absent) is a delta whose stats
 * have not landed yet — leave it queued, never score it stale.
 *
 * Why a re-enqueue RE-STAMPS an existing queue row (L.D2.2, D321(2)): the
 * worker claims a row by reading it, scores, and then deletes it BY STAMP
 * (`enqueued_at` equal to what it read). With a pure `DO NOTHING` enqueue a
 * delta landing between the worker's stats read and its delete would fold
 * into the still-queued row WITHOUT moving anything, the worker would delete
 * the row having scored the OLD line, and nothing would ever re-enqueue it
 * (the next poll's diff reads the stored row as current) — a silently stale
 * score. `ON CONFLICT DO UPDATE SET enqueued_at` closes that: the stamp
 * moves, the worker's conditional delete misses, the row is re-drained. One
 * row per (season, week, player) either way — the PK dedupe stands. Since
 * 122 the same upsert also clears `deferred_until` (the worker's R872 hold
 * on a not-ready / week-not-open row): a fresh delta never waits out a hold.
 *
 * The last-poll surface (F217 / F218 R714 / F263(e)): this module does NOT
 * persist anything about the poll itself — the caller-owned tracker is the
 * in-process flag, and the ROUTE (L.D2.3, `ingest-flags.ts`) writes
 * `system_flags` after a poll returns: the degraded count across
 * invocations and `ingest_poll:<season>:<week>.completed_at = polledAt`
 * (the worker's orphan escape reads that key). Kept out of here so the
 * harness / sim / gates run this function against nothing but the tables
 * it owns.
 *
 * Never partial data (§23.2): every provider read happens BEFORE the first
 * DB write, and a failed read writes nothing and records ONE failed poll on
 * the caller-owned `DegradationTracker` — the `stats_degraded` flag surface
 * (M0's degradation.ts, "reused by the real incident plumbing later"). After
 * 3 consecutive failures the flag is up; the first successful poll clears it
 * and, because every tier's stat lines are cumulative, that poll's diff IS
 * the back-fill (E45; the M0 R26 writer-side back-fill reading). Persisting
 * the flag across serverless invocations is the wiring task's (L.D2.3 —
 * ledger F216).
 *
 * Loud emptiness (CLAUDE.md): every skip is counted and every empty section
 * carries its reason in `report.reasons`; every upsert asserts the returned
 * row count equals what it sent; every read pages past the PostgREST cap.
 *
 * Time only via `time` (the D3 ESLint fence covers this file); provider
 * reads only via `provider` — zero `fetch` here. The provider is bound by
 * the entry point (the cron route / the gate harness), never in here.
 */

import type { DegradationTracker } from '@/lib/leagues/stats/degradation'
import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import type {
  ProviderGame,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { pageAll, type PageResponse } from '@/lib/supabase/page-all'

import { STAT_COLUMN_BY_KEY, toStatColumns } from './live-stats'
import { fetchKnownPlayerIds } from './projections'
import type { SyncClient } from './types'

// ── Contract ───────────────────────────────────────────────────────────────

export interface IngestIo {
  /** Service-role client — this writer lives in sync territory, never a
   *  client-callable route (tasks-M4 §4 rule 9). */
  db: SyncClient
  /** Caller-owned across polls: the §23.2 `stats_degraded` flag surface. */
  degradation: DegradationTracker
  season: number
  week: number
}

export interface IngestGamesReport {
  /** Games the provider returned for the season. */
  seen: number
  /** Games with no kickoff timestamp (the sleeper tier, Q1) — `nfl_games.
   *  kickoff_at` is NOT NULL, so these cannot be written; F11's nflverse
   *  adapter supplies them (L.D3.1). */
  withoutKickoff: number
  inserted: number
  updated: number
  unchanged: number
}

export interface IngestWeeksReport {
  /** Distinct (season, week) keys among the writable games
   *  (= updated + unchanged + outsideCalendar). */
  touched: number
  updated: number
  unchanged: number
  /** Touched weeks with no `nfl_weeks` row (039 seeds 1–18; a postseason
   *  week from a fuller feed lands here) — their bounds are skipped, never
   *  invented. The week being ingested is never counted here: it throws. */
  outsideCalendar: number
}

export interface IngestStatsReport {
  /** Rows the provider returned for (season, week). */
  seen: number
  /** Rows for a player_id the `players` table does not know (FK target). */
  unknownPlayer: number
  /** Rows carrying neither a mapped box column nor a canonical advanced key. */
  empty: number
  /** Advanced keys dropped because they are not registry-canonical (D33). */
  droppedAdvancedKeys: number
  inserted: number
  /** Existing rows whose scoring inputs (box columns / advanced) moved. */
  updated: number
  /** Existing rows written for a metadata-only change (is_live / game_id /
   *  source) — no scoring input moved, so NOT enqueued. */
  metaOnly: number
  unchanged: number
  /** inserted + updated — the rows that enqueue. */
  deltas: number
  /** NEW queue rows this poll created (deltas minus the PK dedupe). */
  enqueued: number
  /** Deltas whose queue row ALREADY existed (undrained): one row still — the
   *  PK dedupe (D292) — but its `enqueued_at` is RE-STAMPED to this poll's
   *  instant (D321(2)): the worker acks a claimed row by stamp, so a delta
   *  landing while a drain is in flight moves the stamp and survives it. */
  restamped: number
}

export interface IngestReport {
  provider: string
  season: number
  week: number
  /** The injected poll instant (ISO) — every stamp this poll wrote. */
  polledAt: string
  /** false ⇒ a provider read failed; nothing was written (§23.2). */
  ok: boolean
  /** The `stats_degraded` flag after this poll (§23.2/E45). */
  degraded: boolean
  error?: string
  games: IngestGamesReport
  weeks: IngestWeeksReport
  stats: IngestStatsReport
  /** Why a section wrote nothing — never an empty success by default. */
  reasons: string[]
}

// ── Column surfaces (derived from the registry — one namespace, D33) ───────

/** Every `player_stats` box column the registry maps, plus the summed
 *  `two_point_conversions` derivation toStatColumns writes (D24/D56(4)).
 *  Every written row carries the WHOLE surface (absent provider keys → 0,
 *  the columns' own DEFAULT), so rows are homogeneous and the diff exact. */
export const STAT_COLUMN_SURFACE: readonly string[] = [
  ...new Set([...Object.values(STAT_COLUMN_BY_KEY), 'two_point_conversions']),
].sort()

/** Registry keys stored in `player_stats.advanced` (§23.5) — the D15
 *  placeholder pair today; a future key joins by registry edit, no migration. */
export const ADVANCED_KEYS: ReadonlySet<string> = new Set(
  STAT_KEYS.filter((def) => def.storage === 'advanced').map((def) => def.key),
)

/** One game per §23.6 postponement: a `postponed` game has left the week
 *  (E43) — it never bounds the week's first kickoff or last game end. */
const IN_WEEK_STATUSES: ReadonlySet<ProviderGame['status']> = new Set([
  'scheduled',
  'live',
  'final',
])

/** An in-week game whose stats can still move: `scheduled` or `live`. A
 *  `final` game is closed; a `postponed` game has left the week (E43) and is
 *  NOT open — its players are never `is_live` (R710). */
function isOpenStatus(status: ProviderGame['status']): boolean {
  return IN_WEEK_STATUSES.has(status) && status !== 'final'
}

/** PostgREST's per-response row cap (supabase/config.toml `max_rows`). A
 *  single-shot read that comes back AT the cap may have been truncated —
 *  the reader refuses rather than trusts it (tasks-M4 §4 rule 10). */
const POSTGREST_ROW_CAP = 1000

// ── Row shapes (what the tables hold; what the diff compares) ──────────────

export interface GameRow {
  id: string
  season: number
  week: number
  home_team: string
  away_team: string
  /** ISO-8601 UTC (`toISOString()` form) — normalized on both sides. */
  kickoff_at: string
  status: ProviderGame['status']
}

export interface WeekBounds {
  first_kickoff_at: string | null
  last_game_ends_at: string | null
}

export interface StatRow {
  player_id: string
  game_id: string | null
  is_live: boolean
  source: string
  /** The full STAT_COLUMN_SURFACE, every column present. */
  columns: Record<string, number>
  /** Registry-canonical advanced keys only. */
  advanced: Record<string, number>
}

// ── Pure helpers (unit-tested in ingest-week.test.ts) ──────────────────────

function isoOf(value: string | Date): string {
  return new Date(value).toISOString()
}

/** Provider game → table row; null when the tier carries no kickoff. */
export function toGameRow(game: ProviderGame): GameRow | null {
  if (game.kickoffAt === null) return null
  return {
    id: game.gameId,
    season: game.season,
    week: game.week,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    kickoff_at: isoOf(game.kickoffAt),
    status: game.status,
  }
}

function sameGame(a: GameRow, b: GameRow): boolean {
  return (
    a.season === b.season &&
    a.week === b.week &&
    a.home_team === b.home_team &&
    a.away_team === b.away_team &&
    a.kickoff_at === b.kickoff_at &&
    a.status === b.status
  )
}

export interface GameDiff {
  inserts: GameRow[]
  updates: GameRow[]
  unchanged: number
}

/** Diff-aware: only new or changed games are written (§23.2). */
export function diffGames(incoming: GameRow[], existing: ReadonlyMap<string, GameRow>): GameDiff {
  const out: GameDiff = { inserts: [], updates: [], unchanged: 0 }
  for (const row of incoming) {
    const prior = existing.get(row.id)
    if (!prior) out.inserts.push(row)
    else if (sameGame(prior, row)) out.unchanged += 1
    else out.updates.push(row)
  }
  return out
}

/**
 * `nfl_weeks` bounds for one week from its games (§12.20; F9's columns):
 *   first_kickoff_at  = min kickoff over the week's in-week games (a
 *                       postponed-out game never bounds it, E43);
 *   last_game_ends_at = "updated as games finish" — set to the injected
 *                       poll instant on the FIRST poll that observes every
 *                       in-week game `final`, kept while they all STAY
 *                       final, NULL while any in-week game is still ahead
 *                       or live.
 * The stamp is DERIVED from the games on every poll, never sticky (R709,
 * D303(4)): a later non-final in-week game — one moved INTO the week, or a
 * provider status regression — re-opens the week (NULL) and the stamp is
 * re-taken at the next all-final observation. A week that is genuinely
 * still playing must not read as ended.
 * A week with no in-week games bounds nothing (both NULL).
 */
export function weekBounds(games: readonly GameRow[], prior: WeekBounds | null, now: Date): WeekBounds {
  const inWeek = games.filter((g) => IN_WEEK_STATUSES.has(g.status))
  if (inWeek.length === 0) return { first_kickoff_at: null, last_game_ends_at: null }
  const first = inWeek.map((g) => g.kickoff_at).sort()[0]
  const allFinal = inWeek.every((g) => g.status === 'final')
  return {
    first_kickoff_at: first,
    last_game_ends_at: allFinal ? (prior?.last_game_ends_at ?? isoOf(now)) : null,
  }
}

export function sameBounds(a: WeekBounds, b: WeekBounds): boolean {
  return a.first_kickoff_at === b.first_kickoff_at && a.last_game_ends_at === b.last_game_ends_at
}

export interface ToStatRowContext {
  providerName: string
  /** Provider status per game id (from this poll's schedule). */
  gameStatus: ReadonlyMap<string, ProviderGame['status']>
  /** Fallback for rows without a game id (the sleeper tier): is any in-week
   *  game of this week still ahead or live? */
  anyGameOpen: boolean
}

export interface ToStatRowResult {
  row: StatRow | null
  droppedAdvancedKeys: number
}

/**
 * Provider stat line → table row over the whole column surface. Returns a
 * null row when the line carries nothing storable (no mapped box key, no
 * canonical advanced key). `is_live` = the player's game is OPEN (scheduled
 * or live — not `final`, and not `postponed`, R710); falls back to the week
 * when the tier carries no game id.
 */
export function toStatRow(stats: ProviderPlayerWeekStats, ctx: ToStatRowContext): ToStatRowResult {
  const mapped = toStatColumns(stats.stats)
  const advanced: Record<string, number> = {}
  let droppedAdvancedKeys = 0
  for (const [key, value] of Object.entries(stats.advanced)) {
    if (typeof value !== 'number') continue
    if (ADVANCED_KEYS.has(key)) advanced[key] = value
    else droppedAdvancedKeys += 1
  }
  if (Object.keys(mapped).length === 0 && Object.keys(advanced).length === 0) {
    return { row: null, droppedAdvancedKeys }
  }
  const columns: Record<string, number> = {}
  for (const column of STAT_COLUMN_SURFACE) columns[column] = mapped[column] ?? 0

  const gameId = stats.gameId ?? null
  const status = gameId === null ? undefined : ctx.gameStatus.get(gameId)
  const isLive = status === undefined ? ctx.anyGameOpen : isOpenStatus(status)

  return {
    row: {
      player_id: stats.playerId,
      game_id: gameId,
      is_live: isLive,
      source: ctx.providerName,
      columns,
      advanced,
    },
    droppedAdvancedKeys,
  }
}

function sameNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false
  }
  return true
}

function sameAdvanced(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length) return false
  return ka.every((key, i) => key === kb[i] && a[key] === b[key])
}

export interface StatDiff {
  inserts: StatRow[]
  /** Scoring inputs moved — written AND enqueued. */
  updates: StatRow[]
  /** Only is_live / game_id / source moved — written, NOT enqueued. */
  metaOnly: StatRow[]
  unchanged: number
}

/**
 * The §23.2 diff. A scoring delta is a new row or a moved box column /
 * advanced value (a NULL stored column and an absent key both read as 0 —
 * the columns' DEFAULT; an advanced key that is ABSENT is pending and is
 * distinct from one that is present at 0, §23.5).
 */
export function diffStats(incoming: StatRow[], existing: ReadonlyMap<string, StatRow>): StatDiff {
  const out: StatDiff = { inserts: [], updates: [], metaOnly: [], unchanged: 0 }
  for (const row of incoming) {
    const prior = existing.get(row.player_id)
    if (!prior) {
      out.inserts.push(row)
      continue
    }
    const scoringMoved =
      !sameNumbers(prior.columns, row.columns) || !sameAdvanced(prior.advanced, row.advanced)
    if (scoringMoved) {
      out.updates.push(row)
      continue
    }
    const metaMoved =
      prior.is_live !== row.is_live || prior.game_id !== row.game_id || prior.source !== row.source
    if (metaMoved) out.metaOnly.push(row)
    else out.unchanged += 1
  }
  return out
}

// ── DB reads (paged past the PostgREST cap — page-all.ts) ──────────────────

interface DbGameRow {
  id: string
  season: number
  week: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: string
}

async function readGames(db: SyncClient, season: number): Promise<Map<string, GameRow>> {
  const rows = await pageAll<DbGameRow>((from, to) =>
    db
      .from('nfl_games')
      .select('id, season, week, home_team, away_team, kickoff_at, status', { count: 'exact' })
      .eq('season', season)
      .order('id')
      .range(from, to),
  )
  const out = new Map<string, GameRow>()
  for (const row of rows) {
    out.set(row.id, {
      id: row.id,
      season: row.season,
      week: row.week,
      home_team: row.home_team,
      away_team: row.away_team,
      kickoff_at: isoOf(row.kickoff_at),
      status: row.status as ProviderGame['status'],
    })
  }
  return out
}

interface DbWeekRow {
  season: number
  week: number
  first_kickoff_at: string | null
  last_game_ends_at: string | null
}

function weekKey(season: number, week: number): string {
  return `${season}:${week}`
}

async function readWeeks(db: SyncClient, season: number): Promise<Map<string, WeekBounds>> {
  const { data, error } = await db
    .from('nfl_weeks')
    .select('season, week, first_kickoff_at, last_game_ends_at')
    .eq('season', season)
  if (error) throw new Error(`nfl_weeks read failed (${season}): ${error.message}`)
  const rows = (data ?? []) as DbWeekRow[]
  // 18 rows per season today — vacuous, but no reader trusts a result set at
  // the cap boundary (rule 10, R712); the other readers page via pageAll.
  if (rows.length >= POSTGREST_ROW_CAP) {
    throw new Error(`nfl_weeks read for ${season} returned ${rows.length} rows — at the PostgREST cap, refusing to trust it`)
  }
  const out = new Map<string, WeekBounds>()
  for (const row of rows) {
    out.set(weekKey(row.season, row.week), {
      first_kickoff_at: row.first_kickoff_at === null ? null : isoOf(row.first_kickoff_at),
      last_game_ends_at: row.last_game_ends_at === null ? null : isoOf(row.last_game_ends_at),
    })
  }
  return out
}

type DbStatRow = {
  player_id: string
  game_id: string | null
  is_live: boolean | null
  source: string | null
  advanced: Record<string, unknown> | null
} & Record<string, unknown>

async function readStats(db: SyncClient, season: number, week: number): Promise<Map<string, StatRow>> {
  const select = ['player_id', 'game_id', 'is_live', 'source', 'advanced', ...STAT_COLUMN_SURFACE].join(', ')
  const rows = await pageAll<DbStatRow>(
    (from, to) =>
      db
        .from('player_stats')
        .select(select, { count: 'exact' })
        .eq('season', season)
        .eq('week', week)
        .order('player_id')
        .range(from, to) as unknown as PageResponse<DbStatRow>,
  )
  const out = new Map<string, StatRow>()
  for (const row of rows) {
    const columns: Record<string, number> = {}
    for (const column of STAT_COLUMN_SURFACE) {
      const value = row[column]
      columns[column] = value === null || value === undefined ? 0 : Number(value)
    }
    const advanced: Record<string, number> = {}
    for (const [key, value] of Object.entries(row.advanced ?? {})) {
      if (typeof value === 'number') advanced[key] = value
    }
    out.set(row.player_id, {
      player_id: row.player_id,
      game_id: row.game_id,
      is_live: row.is_live ?? false,
      source: row.source ?? '',
      columns,
      advanced,
    })
  }
  return out
}

// ── DB writes (every one asserts its own row count — loud emptiness) ───────

const BATCH = 500

async function upsertCounted(
  db: SyncClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
  returning: string,
  label: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { data, error } = await db.from(table).upsert(batch, { onConflict }).select(returning)
    if (error) throw new Error(`${label} upsert failed: ${error.message}`)
    const returned = (data ?? []).length
    if (returned !== batch.length) {
      throw new Error(`${label} upsert wrote ${returned} of ${batch.length} rows — refusing to call that success`)
    }
  }
}

// ── The poll ───────────────────────────────────────────────────────────────

function emptyReport(provider: StatsProvider, io: IngestIo, polledAt: Date, degraded: boolean): IngestReport {
  return {
    provider: provider.name,
    season: io.season,
    week: io.week,
    polledAt: isoOf(polledAt),
    ok: true,
    degraded,
    games: { seen: 0, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 0 },
    weeks: { touched: 0, updated: 0, unchanged: 0, outsideCalendar: 0 },
    stats: {
      seen: 0,
      unknownPlayer: 0,
      empty: 0,
      droppedAdvancedKeys: 0,
      inserted: 0,
      updated: 0,
      metaOnly: 0,
      unchanged: 0,
      deltas: 0,
      enqueued: 0,
      restamped: 0,
    },
    reasons: [],
  }
}

/** Player ids already queued for (season, week) — so the report can tell a
 *  NEW queue row from a RE-STAMPED one (paged past the cap). */
async function readQueuedPlayers(db: SyncClient, season: number, week: number): Promise<Set<string>> {
  const rows = await pageAll<{ player_id: string }>((from, to) =>
    db
      .from('score_fanout')
      .select('player_id', { count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .order('player_id')
      .range(from, to),
  )
  return new Set(rows.map((r) => r.player_id))
}

/**
 * One ingestion poll for (io.season, io.week). See the file banner for the
 * contract. Returns a report; throws only on a DB failure (a provider
 * failure is a REPORTED failed poll, never a throw — the tracker is the
 * flag, and the caller's loop keeps polling).
 */
export async function ingestWeek(
  provider: StatsProvider,
  time: TimeProvider,
  io: IngestIo,
): Promise<IngestReport> {
  const polledAt = time.now()
  const { db, season, week } = io

  // ── Every provider read BEFORE any write (§23.2: never partial data) ──
  let schedule: ProviderGame[]
  let lines: ProviderPlayerWeekStats[]
  try {
    schedule = await provider.getSchedule(season)
    lines = await provider.getWeekStats(season, week)
  } catch (err) {
    io.degradation.recordPollResult(false)
    const report = emptyReport(provider, io, polledAt, io.degradation.degraded)
    report.ok = false
    report.error = err instanceof Error ? err.message : String(err)
    report.reasons.push(
      `provider poll failed — nothing written (§23.2 never partial data); stats_degraded=${report.degraded}`,
    )
    return report
  }
  io.degradation.recordPollResult(true)
  const report = emptyReport(provider, io, polledAt, io.degradation.degraded)
  const stamp = isoOf(polledAt)

  // ── Reads, then the whole diff, then writes ──
  const seasonGames = schedule.filter((g) => g.season === season)
  report.games.seen = seasonGames.length
  const gameRows: GameRow[] = []
  for (const game of seasonGames) {
    const row = toGameRow(game)
    if (row === null) report.games.withoutKickoff += 1
    else gameRows.push(row)
  }

  const [existingGames, existingWeeks, known, existingStats] = await Promise.all([
    readGames(db, season),
    readWeeks(db, season),
    fetchKnownPlayerIds(db),
    readStats(db, season, week),
  ])

  const gameDiff = diffGames(gameRows, existingGames)

  // Week bounds from the union of what is stored and what this poll says
  // (this poll's row wins for a game it carries).
  const merged = new Map<string, GameRow>(existingGames)
  for (const row of gameRows) merged.set(row.id, row)
  const byWeek = new Map<string, GameRow[]>()
  for (const row of gameRows) {
    const key = weekKey(row.season, row.week)
    if (!byWeek.has(key)) byWeek.set(key, [])
  }
  for (const row of merged.values()) {
    const bucket = byWeek.get(weekKey(row.season, row.week))
    if (bucket) bucket.push(row)
  }
  const weekWrites: Array<{ season: number; week: number; bounds: WeekBounds }> = []
  const outsideCalendar: string[] = []
  for (const [key, games] of byWeek) {
    const prior = existingWeeks.get(key)
    if (prior === undefined) {
      if (key === weekKey(season, week)) {
        // The calendar is seeded reference data (039); the week being
        // INGESTED with no calendar row is an integrity problem, not a quiet
        // skip — and it throws here, before the first write (§23.2).
        throw new Error(`nfl_weeks has no row for ${season} week ${week} — the calendar seed is missing`)
      }
      // Any OTHER schedule week the calendar does not know (postseason 19–22
      // from a fuller feed) is skipped and counted, never a poll-wide throw
      // that would leave the live week stale with no banner (R707/E45).
      outsideCalendar.push(key.replace(':', ' week '))
      continue
    }
    const bounds = weekBounds(games, prior, polledAt)
    if (sameBounds(prior, bounds)) report.weeks.unchanged += 1
    else weekWrites.push({ season: games[0].season, week: games[0].week, bounds })
  }
  report.weeks.touched = byWeek.size
  report.weeks.outsideCalendar = outsideCalendar.length

  const gameStatus = new Map<string, ProviderGame['status']>()
  for (const row of merged.values()) gameStatus.set(row.id, row.status)
  const anyGameOpen = [...merged.values()].some(
    (g) => g.season === season && g.week === week && isOpenStatus(g.status),
  )
  const ctx: ToStatRowContext = { providerName: provider.name, gameStatus, anyGameOpen }

  report.stats.seen = lines.length
  const statRows: StatRow[] = []
  for (const line of lines) {
    if (!known.has(line.playerId)) {
      report.stats.unknownPlayer += 1
      continue
    }
    const { row, droppedAdvancedKeys } = toStatRow(line, ctx)
    report.stats.droppedAdvancedKeys += droppedAdvancedKeys
    if (row === null) report.stats.empty += 1
    else statRows.push(row)
  }
  const statDiff = diffStats(statRows, existingStats)

  // ── Writes: games → weeks → stats → queue ──
  const gameWrites = [...gameDiff.inserts, ...gameDiff.updates]
  if (gameWrites.length > 0) {
    await upsertCounted(
      db,
      'nfl_games',
      gameWrites.map((row) => ({ ...row, updated_at: stamp })),
      'id',
      'id',
      `nfl_games (${season})`,
    )
  }
  report.games.inserted = gameDiff.inserts.length
  report.games.updated = gameDiff.updates.length
  report.games.unchanged = gameDiff.unchanged

  for (const w of weekWrites) {
    const { data, error } = await db
      .from('nfl_weeks')
      .update(w.bounds)
      .eq('season', w.season)
      .eq('week', w.week)
      .select('week')
    if (error) throw new Error(`nfl_weeks update failed (${w.season} week ${w.week}): ${error.message}`)
    if ((data ?? []).length !== 1) {
      throw new Error(`nfl_weeks update matched ${(data ?? []).length} rows for ${w.season} week ${w.week}`)
    }
    report.weeks.updated += 1
  }

  // ── Queue BEFORE stats (R706 — see the banner): a crash between the two
  // calls leaves the stored row stale, so the next poll re-detects and
  // re-enqueues the delta. The reverse order loses it permanently.
  const deltas = [...statDiff.inserts, ...statDiff.updates]
  report.stats.deltas = deltas.length
  if (deltas.length > 0) {
    const alreadyQueued = await readQueuedPlayers(db, season, week)
    for (let i = 0; i < deltas.length; i += BATCH) {
      const batch = deltas.slice(i, i + BATCH).map((row) => ({
        season,
        week,
        player_id: row.player_id,
        enqueued_at: stamp, // the SAME instant as the stat row's updated_at below
        // 122 (R872 / F263(e)): a fresh delta CLEARS a deferral the worker
        // put on a held row — it is claimable at once. PostgREST SETs only
        // the payload's columns, so the lease pair is untouched (121).
        deferred_until: null,
      }))
      // ON CONFLICT DO UPDATE SET enqueued_at, deferred_until — one row per
      // PK (D292's dedupe, 109's banner), the stamp moved to THIS delta's
      // instant so the worker's by-stamp ack cannot consume a newer delta
      // (D321(2)); the deferral cleared (122).
      const { data, error } = await db
        .from('score_fanout')
        .upsert(batch, { onConflict: 'season,week,player_id', ignoreDuplicates: false })
        .select('player_id')
      if (error) throw new Error(`score_fanout enqueue failed: ${error.message}`)
      const returned = data ?? []
      if (returned.length !== batch.length) {
        throw new Error(`score_fanout enqueue stamped ${returned.length} of ${batch.length} rows — refusing to call that success`)
      }
      for (const row of returned) {
        if (alreadyQueued.has(row.player_id)) report.stats.restamped += 1
        else report.stats.enqueued += 1
      }
    }
  }

  const statWrites = [...statDiff.inserts, ...statDiff.updates, ...statDiff.metaOnly]
  if (statWrites.length > 0) {
    await upsertCounted(
      db,
      'player_stats',
      statWrites.map((row) => ({
        player_id: row.player_id,
        season,
        week,
        stat_type: 'weekly',
        game_id: row.game_id,
        is_live: row.is_live,
        source: row.source, // provider.name — honest provenance (F13/D300)
        updated_at: stamp, // injected time, never the wall (D12)
        advanced: row.advanced,
        ...row.columns,
      })),
      'player_id,season,week',
      'player_id',
      `player_stats (${season} week ${week})`,
    )
  }
  report.stats.inserted = statDiff.inserts.length
  report.stats.updated = statDiff.updates.length
  report.stats.metaOnly = statDiff.metaOnly.length
  report.stats.unchanged = statDiff.unchanged

  // ── Reasons: an empty section says why ──
  if (report.games.seen === 0) report.reasons.push(`provider returned zero games for ${season}`)
  else if (gameRows.length === 0) {
    report.reasons.push(
      `nfl_games untouched: none of the ${report.games.seen} games carry a kickoff timestamp (${provider.name} tier — F11 supplies them)`,
    )
  } else if (gameWrites.length === 0) {
    report.reasons.push(`nfl_games unchanged: ${gameDiff.unchanged} games identical to stored`)
  }
  if (outsideCalendar.length > 0) {
    report.reasons.push(
      `nfl_weeks: ${outsideCalendar.length} schedule week(s) outside the calendar skipped — ${outsideCalendar.join(', ')} (no nfl_weeks row; 039 seeds 1–18)`,
    )
  }
  if (report.stats.seen === 0) report.reasons.push(`provider returned zero stat rows for ${season} week ${week}`)
  else if (statRows.length === 0) {
    report.reasons.push(
      `player_stats untouched: ${report.stats.unknownPlayer} unknown-player + ${report.stats.empty} empty rows, nothing storable`,
    )
  } else if (statWrites.length === 0) {
    report.reasons.push(`player_stats unchanged: ${statDiff.unchanged} rows identical to stored`)
  }
  if (deltas.length === 0) report.reasons.push('score_fanout: no scoring delta — nothing enqueued')
  else if (report.stats.enqueued === 0) {
    report.reasons.push(
      `score_fanout: all ${deltas.length} deltas already queued (PK dedupe) — re-stamped to ${stamp} (D321(2))`,
    )
  }

  return report
}
