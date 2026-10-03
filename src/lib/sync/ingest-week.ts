/**
 * ingestWeek — the in-season ingestion fan-out: provider → tables → queue
 * (spec §22.2 top half, §23.1–23.3, E42/E45; tasks-M4-inseason.md §5/§6
 * L.D2.1; PROGRESS D300/D303). TS only — no migration, no RPC.
 *
 * One poll, three writes, one enqueue, in this order (the stats + queue pair
 * — and, since migration 167, the correction events — go through ONE door in
 * ONE transaction; see "THE INGEST DOOR" below):
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
 * THE INGEST DOOR (M6 L.E2.1, migration 167 — F267 taken, tasks-M6 TD2 /
 * TD3). `ingest_write_batch(p_rows, p_now)` writes a batch's lines, their
 * `stat_correction_events` and their `score_fanout` enqueue in ONE
 * transaction, all stamped with the poll's instant — the readiness predicate
 * below is then true by construction. THIS module still computes the whole
 * diff (TS stays the one diff) and CLASSIFIES each insert / update (TD2):
 * a CORRECTION is a moved scoring key of a line whose game was already
 * `final` in the stored `nfl_games` read BEFORE this poll's writes — never
 * the state this poll brings (the poll that first sees a game final carries
 * its last in-game changes, and those are not corrections) — or a first line
 * for such a game (a provider gap filled late, F269(a)). A `metaOnly`
 * rewrite is never one. With no game id on the line (production's Sleeper
 * lines carry none — PROGRESS F468(a)) the WEEK stands in: every in-week game
 * final before this poll. The door records each named key with the OLD value
 * it reads from the stored line under the week's lock and the NEW one it
 * writes; a final week's line still moves (research, Q81) and nothing here
 * touches a league table (158's lock; the worker's `week_final`).
 *
 * THE SETTLE GRACE (M6 L.E2.2 — F511, TD2 amended; PROGRESS D453(6)): a
 * change to a final game's line within `SETTLE_GRACE_MS` (6 h) of the game
 * first being seen final — or, with no game on the line, of the week's last
 * game being seen final — is ordinary post-game settling: written, queued and
 * re-scored as always, never recorded as a correction (`corrections.settled`
 * counts it and a reason line says so).
 *
 * The door is the ONLY write path (F508, 2026-10-03): the pre-167 two-call
 * fallback was retired once production carried 167 and slates had run
 * through it. A door answering "no such function" (PGRST202) is a plain
 * failure — the poll throws, nothing written, never a quiet second path.
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
import { NULL_IS_PENDING_KEYS, STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import type {
  ProviderGame,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'
import { weekReleaseFloor } from '@/lib/leagues/time/release-floor'
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

/** Migration 167's one-transaction ingest door (F267, tasks-M6 TD3). */
export const INGEST_DOOR = 'ingest_write_batch'

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

/** How this poll's lines and queue rows were written. */
export interface IngestWriteReport {
  /** `door` — `ingest_write_batch` (167): lines + events + queue, one
   *  transaction per batch; `none` — nothing to write. */
  path: 'door' | 'none'
  /** The door this poll asked for. */
  door: string
}

/** One key the diff classified as a correction (TD2), as this poll saw it. */
export interface DetectedCorrection {
  player_id: string
  /** The canonical registry key (D33). */
  stat_key: string
  /** The stored value before this poll (null: no line stored — a gap filled late — or not delivered). */
  old: number | null
  new: number | null
}

/** `stat_correction_events` for this poll (TD2 / TD3). */
export interface IngestCorrectionsReport {
  /** Keys classified as corrections and sent to the door. */
  detected: number
  /** Players whose line carried at least one. */
  players: number
  /** Events the door wrote. */
  recorded: number
  /** Named keys already recorded at this instant (the natural key — a replayed batch). */
  replayed: number
  /** Named keys whose stored value already equalled the new one at write (a concurrent poll landed it first). */
  unchangedAtWrite: number
  /** M6 L.E2.2 (F511, D453 — the TD2 amendment): keys that moved on a final game's line
   *  inside the SETTLE GRACE after the game was first seen final — ordinary post-game
   *  settling: written, queued and re-scored as always, never recorded as a correction. */
  settled: number
  /** The door's week state at detection (null when nothing was sent to it). */
  weekState: 'open' | 'final' | null
  keys: DetectedCorrection[]
  /** Why the numbers are what they are — never an unexplained zero. */
  reason: string
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
  write: IngestWriteReport
  corrections: IngestCorrectionsReport
  /** Why a section wrote nothing — never an empty success by default. */
  reasons: string[]
}

// ── Column surfaces (derived from the registry — one namespace, D33) ───────

/** Every `player_stats` box column the registry maps, plus the summed
 *  `two_point_conversions` derivation toStatColumns writes (D24/D56(4)).
 *  Every written row carries the WHOLE surface (absent provider keys → 0,
 *  the columns' own DEFAULT — or NULL for a `NULL_IS_PENDING_COLUMNS`
 *  column, F390), so rows are homogeneous and the diff exact. */
export const STAT_COLUMN_SURFACE: readonly string[] = [
  ...new Set([...Object.values(STAT_COLUMN_BY_KEY), 'two_point_conversions']),
].sort()

/**
 * L.E1.26 / F390 — the surface columns whose ABSENCE is written as NULL,
 * not 0: the columns of the registry's `null_is_pending` keys (exactly
 * `def_yards_allowed`; its DEFAULT is dropped by migration 143). A provider
 * line without the key stores NULL — "not delivered", which the scorer reads
 * as pending — and the diff tells NULL from a delivered 0 for these columns
 * (every other column keeps "NULL ≡ absent ≡ 0", D303(5)).
 */
export const NULL_IS_PENDING_COLUMNS: ReadonlySet<string> = new Set(
  [...NULL_IS_PENDING_KEYS].map((key) => {
    const column = STAT_COLUMN_BY_KEY[key]
    if (column === undefined) throw new Error(`null_is_pending key ${key} has no player_stats column`)
    return column
  }),
)

/** A surface column's value when the provider line lacks it. */
function absentValue(column: string): number | null {
  return NULL_IS_PENDING_COLUMNS.has(column) ? null : 0
}

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
  /** The full STAT_COLUMN_SURFACE, every column present — NULL only for a
   *  `NULL_IS_PENDING_COLUMNS` column the line did not deliver (F390). */
  columns: Record<string, number | null>
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
 *   last_game_ends_at = the week's RELEASE INSTANT (Q50) — the LATER of the
 *                       poll that first observes every in-week game `final`
 *                       and the week's Tuesday 00:00 Pacific FLOOR; NULL
 *                       while any in-week game is still ahead or live.
 *
 * Q50 (Chris, 2026-09-09): *"players release when every game in the week has
 * finished, never before Tuesday 00:00 Pacific"*. The TRIGGER is unchanged —
 * every in-week game final — and the FLOOR only prevents that trigger landing
 * early. Past the floor the max() yields the observation, so a Monday game
 * postponed into Tuesday releases as soon as it ends (*"we would basically
 * want it to be as soon as the game has ended since we are past the normal
 * unlock time"*) rather than waiting a further week — which is why the floor
 * is derived from `weekStartsAt` and never from a kickoff. The ceiling
 * (Wednesday 00:00 Pacific) is Q50(c)'s and is NOT built here.
 *
 * Stamping the FLOOR — an instant that can sit in the FUTURE at write time —
 * rather than holding NULL is deliberate. Every SQL reader compares this
 * column to `p_at` (115:270/:309, 118:1846), so a future stamp keeps players
 * locked and the week `live` with no migration; `lineup_lock_tick` writes
 * that real instant instead of `'infinity'` (116:59-66); and, decisively,
 * the all-final-and-NULL state stays what it has always meant — F238, the
 * `all_final_unstamped` ALERT (`scoring/reconcile.ts:388`). Holding NULL for
 * the ~3.3 h before the floor would page every league every week and let
 * "nothing happened" read as "it worked".
 *
 * The stamp is DERIVED from the games on every poll, never sticky (R709,
 * D303(4)): a later non-final in-week game — one moved INTO the week, or a
 * provider status regression — re-opens the week (NULL) and the stamp is
 * re-taken at the next all-final observation. A week that is genuinely
 * still playing must not read as ended. `prior` still wins outright, so the
 * floor shapes only the FIRST stamp and the instant never moves once written.
 * A week with no in-week games bounds nothing (both NULL).
 *
 * `weekStartsAt` is the week's `nfl_weeks.starts_at` (Wednesday 00:00 ET,
 * `NOT NULL` seeded reference data — 039:34-36/:45).
 */
export function weekBounds(
  games: readonly GameRow[],
  prior: WeekBounds | null,
  now: Date,
  weekStartsAt: string,
): WeekBounds {
  const inWeek = games.filter((g) => IN_WEEK_STATUSES.has(g.status))
  if (inWeek.length === 0) return { first_kickoff_at: null, last_game_ends_at: null }
  const first = inWeek.map((g) => g.kickoff_at).sort()[0]
  const allFinal = inWeek.every((g) => g.status === 'final')
  const release = allFinal
    ? (prior?.last_game_ends_at ??
      isoOf(new Date(Math.max(now.getTime(), weekReleaseFloor(weekStartsAt).getTime()))))
    : null
  return { first_kickoff_at: first, last_game_ends_at: release }
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
  const columns: Record<string, number | null> = {}
  for (const column of STAT_COLUMN_SURFACE) columns[column] = mapped[column] ?? absentValue(column)

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

function sameNumbers(a: Record<string, number | null>, b: Record<string, number | null>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    // A NULL_IS_PENDING column compares NULL exactly (NULL ≠ 0 — "not
    // delivered" vs a delivered zero, F390); every other column keeps
    // NULL ≡ absent ≡ 0.
    if ((a[key] ?? absentValue(key)) !== (b[key] ?? absentValue(key))) return false
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
 * the columns' DEFAULT — except a `NULL_IS_PENDING_COLUMNS` column, where
 * NULL is "not delivered" and differs from 0, F390; an advanced key that is ABSENT is pending and is
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

// ── Correction classification (TD2 — pure; ingest-week.test.ts's table) ────

/** player_stats column → canonical key, for every column-stored registry key
 *  (one-to-one — D33; the summed `two_point_conversions` derivation has no
 *  key: its per-type keys carry any change). */
export const STAT_KEY_BY_COLUMN: ReadonlyMap<string, string> = new Map(
  Object.entries(STAT_COLUMN_BY_KEY).map(([key, column]) => [column, key]),
)

/** One moved key: where it is stored (a box column, or `advanced` when
 *  `column` is null) and the values either side, as this poll read them. */
export interface MovedKey {
  stat_key: string
  column: string | null
  old: number | null
  new: number | null
}

/**
 * The scoring keys that differ between the stored line (`prior`; absent = no
 * line — every key reads absent) and the incoming one, under the diff's own
 * equality (`sameNumbers` / `sameAdvanced`: absent ≡ 0 except a
 * NULL_IS_PENDING column; an absent advanced key is pending, distinct from a
 * present 0). Registry keys only (D33), in registry order.
 */
export function movedStatKeys(prior: StatRow | undefined, row: StatRow): MovedKey[] {
  const out: MovedKey[] = []
  for (const [column, statKey] of STAT_KEY_BY_COLUMN) {
    const before = prior === undefined ? absentValue(column) : (prior.columns[column] ?? absentValue(column))
    const after = row.columns[column] ?? absentValue(column)
    if (before !== after) out.push({ stat_key: statKey, column, old: prior === undefined ? null : before, new: after })
  }
  for (const statKey of ADVANCED_KEYS) {
    const before = prior?.advanced[statKey]
    const after = row.advanced[statKey]
    if (before !== after) out.push({ stat_key: statKey, column: null, old: before ?? null, new: after ?? null })
  }
  return out
}

/**
 * Was this line's game already `final` BEFORE this poll? `gamesBeforePoll` is
 * the stored `nfl_games` as read before this poll wrote anything — never the
 * state this poll brings (TD2; the break probe feeds it the merged state and
 * the live → final cell reds). The line's own game when it names one (a game
 * not yet stored was not final); otherwise the WEEK stands in — every
 * in-week game of (season, week) final before this poll (F468(a): production's
 * lines carry no game id). A postponed game has left the week (E43).
 */
export function finalBeforePoll(
  row: StatRow,
  prior: StatRow | undefined,
  gamesBeforePoll: ReadonlyMap<string, GameRow>,
  weekAllFinalBeforePoll: boolean,
): boolean {
  const gameId = row.game_id ?? prior?.game_id ?? null
  if (gameId !== null) return gamesBeforePoll.get(gameId)?.status === 'final'
  return weekAllFinalBeforePoll
}

/** Every in-week game of (season, week) stored `final` (and at least one). */
export function weekAllFinal(games: ReadonlyMap<string, GameRow>, season: number, week: number): boolean {
  const inWeek = [...games.values()].filter((g) => g.season === season && g.week === week && IN_WEEK_STATUSES.has(g.status))
  return inWeek.length > 0 && inWeek.every((g) => g.status === 'final')
}

/**
 * TD2 — the corrections in a poll's diff: for each INSERT (a gap filled late)
 * and UPDATE whose game was final before this poll, its moved keys. A
 * `metaOnly` row is never one; an insert / update of an open game is an
 * ordinary live delta. Keyed by player id.
 */
export function classifyCorrections(
  diff: StatDiff,
  existing: ReadonlyMap<string, StatRow>,
  gamesBeforePoll: ReadonlyMap<string, GameRow>,
  season: number,
  week: number,
): Map<string, MovedKey[]> {
  const weekFinal = weekAllFinal(gamesBeforePoll, season, week)
  const out = new Map<string, MovedKey[]>()
  for (const row of [...diff.inserts, ...diff.updates]) {
    const prior = existing.get(row.player_id)
    if (!finalBeforePoll(row, prior, gamesBeforePoll, weekFinal)) continue
    const moved = movedStatKeys(prior, row)
    if (moved.length > 0) out.set(row.player_id, moved)
  }
  return out
}

/**
 * THE SETTLE GRACE (M6 L.E2.2 — F511, an amendment to TD2 / D434; PROGRESS
 * D453(6)). A finished game's line routinely settles after the whistle — the
 * provider's post-game cleanup of a yard or a target, seen by the first
 * sweeps after fast polling stops (R711). The standard platforms re-score
 * that silently and announce only real corrections, so a change to a final
 * game's line inside this window after the game was FIRST SEEN FINAL is not
 * a correction: it is written, queued and re-scored exactly as before, and
 * no `stat_correction_events` row is made (so no league record, post or
 * notification follows, and L.E2.5 cannot mistake it for a real one). At
 * the boundary and after, it is a correction. "First seen final" is the
 * stored `nfl_games.updated_at` of the line's game (the poll that flipped it
 * to final stamped it; a final game's row is rewritten only if it changes);
 * with no game on the line (production's feed, F468(a)) the week stands in —
 * the latest such instant over its in-week games, i.e. when its last game
 * was seen final. An unknown instant (NULL) grants no grace.
 *
 * Six hours: every production week so far settled inside the poll that saw
 * its last game final (2026 wks 1–3: the whole week rewritten at that poll,
 * then no line moved in the 31 hourly sweeps measured after week 3 — PROGRESS
 * D453(6)); the platforms' official corrections come days later (Tuesday
 * onward), so the grace covers the overnight cleanup without swallowing
 * them. L.E2.5 re-measures it on the first real corrections.
 */
export const SETTLE_GRACE_MS = 6 * 60 * 60_000

/** When this line's game (or, with no game id, its week's last game) was first seen final — null when unknown. */
export function finalObservedAt(
  row: StatRow,
  prior: StatRow | undefined,
  gamesBeforePoll: ReadonlyMap<string, GameRow>,
  observedAt: ReadonlyMap<string, string | null>,
  season: number,
  week: number,
): string | null {
  const gameId = row.game_id ?? prior?.game_id ?? null
  if (gameId !== null) return observedAt.get(gameId) ?? null
  let latest: string | null = null
  for (const g of gamesBeforePoll.values()) {
    if (g.season !== season || g.week !== week || !IN_WEEK_STATUSES.has(g.status)) continue
    const at = observedAt.get(g.id) ?? null
    if (at === null) return null
    if (latest === null || Date.parse(at) > Date.parse(latest)) latest = at
  }
  return latest
}

export interface SettleContext {
  /** This poll's instant. */
  polledAt: Date
  /** `nfl_games.updated_at` by game id, as stored BEFORE this poll (ISO). */
  observedAt: ReadonlyMap<string, string | null>
  graceMs: number
}

/**
 * TD2 as amended by F511: the corrections of a poll's diff (`classifyCorrections`)
 * split into those past the settle grace (`corrections` — recorded) and those
 * inside it (`settled` — ordinary settling, not recorded).
 */
export function classifyCorrectionsWithSettle(
  diff: StatDiff,
  existing: ReadonlyMap<string, StatRow>,
  gamesBeforePoll: ReadonlyMap<string, GameRow>,
  season: number,
  week: number,
  settle: SettleContext,
): { corrections: Map<string, MovedKey[]>; settled: Map<string, MovedKey[]> } {
  const all = classifyCorrections(diff, existing, gamesBeforePoll, season, week)
  const rows = new Map([...diff.inserts, ...diff.updates].map((r) => [r.player_id, r]))
  const corrections = new Map<string, MovedKey[]>()
  const settled = new Map<string, MovedKey[]>()
  for (const [playerId, keys] of all) {
    const row = rows.get(playerId)!
    const at = finalObservedAt(row, existing.get(playerId), gamesBeforePoll, settle.observedAt, season, week)
    const inGrace = at !== null && settle.polledAt.getTime() < Date.parse(at) + settle.graceMs
    ;(inGrace ? settled : corrections).set(playerId, keys)
  }
  return { corrections, settled }
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
  updated_at: string | null
}

/** The stored games (the diff's shape) — and, into `observedAt`, each row's
 *  `updated_at` (F511's settle grace: when a final game was first seen final). */
async function readGames(db: SyncClient, season: number, observedAt?: Map<string, string | null>): Promise<Map<string, GameRow>> {
  const rows = await pageAll<DbGameRow>((from, to) =>
    db
      .from('nfl_games')
      .select('id, season, week, home_team, away_team, kickoff_at, status, updated_at', { count: 'exact' })
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
    observedAt?.set(row.id, row.updated_at === null || row.updated_at === undefined ? null : isoOf(row.updated_at))
  }
  return out
}

interface DbWeekRow {
  season: number
  week: number
  /** Q50's floor anchor — Wednesday 00:00 ET, `NOT NULL` (039:34-36/:45). */
  starts_at: string
  first_kickoff_at: string | null
  last_game_ends_at: string | null
}

/** What the poll needs about a stored week: the bounds it DIFFS against, plus
 *  the calendar datum the Q50 floor is derived from. `starts_at` is carried
 *  BESIDE `WeekBounds` rather than inside it on purpose — `WeekBounds` is the
 *  write payload as well as the read shape, and `sameBounds` drives the diff,
 *  so a read-only calendar column added to it would be written back into
 *  `nfl_weeks` and would poison the unchanged/changed comparison. */
interface StoredWeek {
  bounds: WeekBounds
  startsAt: string
}

function weekKey(season: number, week: number): string {
  return `${season}:${week}`
}

async function readWeeks(db: SyncClient, season: number): Promise<Map<string, StoredWeek>> {
  const { data, error } = await db
    .from('nfl_weeks')
    .select('season, week, starts_at, first_kickoff_at, last_game_ends_at')
    .eq('season', season)
  if (error) throw new Error(`nfl_weeks read failed (${season}): ${error.message}`)
  const rows = (data ?? []) as DbWeekRow[]
  // 18 rows per season today — vacuous, but no reader trusts a result set at
  // the cap boundary (rule 10, R712); the other readers page via pageAll.
  if (rows.length >= POSTGREST_ROW_CAP) {
    throw new Error(`nfl_weeks read for ${season} returned ${rows.length} rows — at the PostgREST cap, refusing to trust it`)
  }
  const out = new Map<string, StoredWeek>()
  for (const row of rows) {
    out.set(weekKey(row.season, row.week), {
      bounds: {
        first_kickoff_at: row.first_kickoff_at === null ? null : isoOf(row.first_kickoff_at),
        last_game_ends_at: row.last_game_ends_at === null ? null : isoOf(row.last_game_ends_at),
      },
      startsAt: isoOf(row.starts_at),
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
    const columns: Record<string, number | null> = {}
    for (const column of STAT_COLUMN_SURFACE) {
      const value = row[column]
      columns[column] = value === null || value === undefined ? absentValue(column) : Number(value)
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
    write: { path: 'none', door: INGEST_DOOR },
    corrections: {
      detected: 0,
      players: 0,
      recorded: 0,
      replayed: 0,
      unchangedAtWrite: 0,
      settled: 0,
      weekState: null,
      keys: [],
      reason: 'nothing written — no line to classify',
    },
    reasons: [],
  }
}

/** A line as the door writes it. */
function statPayload(row: StatRow, season: number, week: number): Record<string, unknown> {
  return {
    player_id: row.player_id,
    season,
    week,
    stat_type: 'weekly',
    game_id: row.game_id,
    is_live: row.is_live,
    source: row.source, // provider.name — honest provenance (F13/D300)
    advanced: row.advanced,
    ...row.columns,
  }
}

interface DoorReport {
  stats_written: number
  enqueued: number
  restamped: number
  events_written: number
  events_replayed: number
  events_unchanged: number
  week_state: 'open' | 'final' | null
}

/**
 * Migration 167's door (F267, TD3): each batch's lines, their correction
 * events and their enqueue in ONE transaction. Any error — a missing door
 * (PGRST202) included, since F508 — throws by name. Every count is asserted
 * — loud, never a quiet zero.
 */
async function writeThroughDoor(
  db: SyncClient,
  door: string,
  season: number,
  week: number,
  stamp: string,
  statWrites: StatRow[],
  deltaIds: ReadonlySet<string>,
  corrections: ReadonlyMap<string, MovedKey[]>,
  report: IngestReport,
): Promise<void> {
  for (let i = 0; i < statWrites.length; i += BATCH) {
    const batch = statWrites.slice(i, i + BATCH)
    const rows = batch.map((row) => ({
      stat: statPayload(row, season, week),
      enqueue: deltaIds.has(row.player_id),
      corrections: (corrections.get(row.player_id) ?? []).map((k) =>
        k.column === null ? { stat_key: k.stat_key, advanced: true } : { stat_key: k.stat_key, column: k.column },
      ),
    }))
    const { data, error } = await db.rpc(door, { p_rows: rows, p_now: stamp })
    if (error) {
      throw new Error(`${door} failed (${season} week ${week}, lines ${i + 1}–${i + batch.length}): ${error.message}`)
    }
    const r = data as DoorReport | null
    if (r === null || typeof r !== 'object' || r.stats_written !== batch.length) {
      throw new Error(`${door} wrote ${r?.stats_written ?? 'no report'} of ${batch.length} lines — refusing to call that success`)
    }
    const sent = rows.filter((x) => x.enqueue).length
    if (r.enqueued + r.restamped !== sent) {
      throw new Error(`${door} enqueued ${r.enqueued + r.restamped} of ${sent} deltas — refusing to call that success`)
    }
    const named = rows.reduce((n, x) => n + x.corrections.length, 0)
    if (r.events_written + r.events_replayed + r.events_unchanged !== named) {
      throw new Error(`${door} accounted for ${r.events_written + r.events_replayed + r.events_unchanged} of ${named} correction keys — refusing to call that success`)
    }
    report.stats.enqueued += r.enqueued
    report.stats.restamped += r.restamped
    report.corrections.recorded += r.events_written
    report.corrections.replayed += r.events_replayed
    report.corrections.unchangedAtWrite += r.events_unchanged
    if (r.week_state !== null) report.corrections.weekState = r.week_state
  }
}

/** Why `report.corrections` reads as it does (CLAUDE.md: never an unexplained zero). */
function correctionsReason(report: IngestReport, deltas: number, writes: number): string {
  const c = report.corrections
  if (writes === 0) return 'nothing written — no line to classify'
  if (deltas === 0) return 'no scoring delta — a metadata-only rewrite is never a correction'
  if (c.detected === 0 && c.settled > 0)
    return `${deltas} scoring delta(s): ${c.settled} key(s) moved within ${SETTLE_GRACE_MS / 3_600_000} h of the game being seen final — ordinary post-game settling, re-scored, not a correction (F511)`
  if (c.detected === 0) return `${deltas} scoring delta(s), none to a line whose game was final before this poll — ordinary live deltas, no correction`
  if (c.recorded === 0) return `${c.detected} detected, none recorded — ${c.replayed} already recorded at this instant, ${c.unchangedAtWrite} already equal when written`
  return `${c.recorded} recorded`
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

  const gamesObservedAt = new Map<string, string | null>()
  const [existingGames, existingWeeks, known, existingStats] = await Promise.all([
    readGames(db, season, gamesObservedAt),
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
    const bounds = weekBounds(games, prior.bounds, polledAt, prior.startsAt)
    if (sameBounds(prior.bounds, bounds)) report.weeks.unchanged += 1
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
  // TD2 — against the games as stored BEFORE this poll (`existingGames`),
  // never `merged`: the poll that first sees a game final carries its last
  // in-game changes, and those are not corrections.
  // M6 L.E2.2 (F511 — the TD2 amendment): a change inside the settle grace
  // after the game was first seen final is ordinary settling, not recorded.
  const { corrections, settled } = classifyCorrectionsWithSettle(statDiff, existingStats, existingGames, season, week, {
    polledAt,
    observedAt: gamesObservedAt,
    graceMs: SETTLE_GRACE_MS,
  })
  for (const keys of settled.values()) report.corrections.settled += keys.length

  // ── Writes: games → weeks → (stats + events + queue: one door call per batch) ──
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

  const deltas = [...statDiff.inserts, ...statDiff.updates]
  report.stats.deltas = deltas.length
  const statWrites = [...statDiff.inserts, ...statDiff.updates, ...statDiff.metaOnly]
  const door = INGEST_DOOR
  const detected: DetectedCorrection[] = []
  for (const [player_id, keys] of corrections) {
    for (const k of keys) detected.push({ player_id, stat_key: k.stat_key, old: k.old, new: k.new })
  }
  report.corrections.detected = detected.length
  report.corrections.players = corrections.size
  report.corrections.keys = detected
  if (statWrites.length > 0) {
    await writeThroughDoor(db, door, season, week, stamp, statWrites, new Set(deltas.map((r) => r.player_id)), corrections, report)
    report.write.path = 'door'
  }
  report.corrections.reason = correctionsReason(report, deltas.length, statWrites.length)

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
  // M6 L.E2.1 — the poll's corrections when it found any.
  if (report.corrections.settled > 0) {
    report.reasons.push(
      `stat settle: ${report.corrections.settled} key(s) on a final game's line moved within ${SETTLE_GRACE_MS / 3_600_000} h of the game being seen final — ordinary post-game settling (F511): re-scored as always, not recorded as a correction`,
    )
  }
  if (report.corrections.detected > 0) {
    const c = report.corrections
    report.reasons.push(
      `stat_correction_events: ${c.recorded} recorded for ${c.players} player(s) (week ${c.weekState ?? '?'})` +
        (c.replayed > 0 ? `; ${c.replayed} already recorded at this instant` : '') +
        (c.unchangedAtWrite > 0 ? `; ${c.unchangedAtWrite} already equal when written` : ''),
    )
  }

  return report
}
