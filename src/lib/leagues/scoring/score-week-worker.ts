/**
 * score-week-worker — the `score-league-week` worker (spec §22.2 worker
 * half, §7.3.3 snapshot + precision law, §23.5/E61 pending semantics, §11.4
 * live scoring; tasks-M4-inseason.md §5/§6 L.D2.2; PROGRESS D292 / D295 /
 * D321; discharges F22 + F23; honours F218 / F241(b) / F257(a′) / F259(d)(e)
 * / F262(d)).
 *
 * ONE drain, in this order (`runScoreWeekBatch`):
 *
 *   1. CLAIM — read up to `batchSize` `score_fanout` rows (oldest first).
 *      Each row is `(season, week, player_id, enqueued_at)`; the stamp is
 *      the claim ticket (step 7).
 *   2. READINESS (F218) — a queued player whose `player_stats` row is older
 *      than its queue row, or absent, is a delta whose stats have not landed
 *      (ingestion writes the queue BEFORE the stats — R706); it stays
 *      queued and is NEVER scored from the stale row.
 *   3. MAP (§22.2 / D292) — ready players → leagues through
 *      `idx_league_rosters_player` ∩ leagues `in_season | playoffs` of the
 *      row's season. The LEAGUE comes from the roster index; the TEAM does
 *      not (step 5).
 *   4. THE WEEK'S DOOR STATE — per league-week the `league_weeks` row is the
 *      datum (§23.3; no calendar arithmetic here): missing ⇒
 *      `week_not_scheduled` (a mid-season-entry league whose plan starts
 *      later — consumed, named); `final` ⇒ `week_final` (D295(b): a
 *      post-window delta lands in `player_stats` and changes NO league cell
 *      — consumed, named); `upcoming` ⇒ `week_not_open` (HELD in the queue
 *      until `league_week_advance` opens it — named every drain).
 *   5. AFFECTED TEAMS — through the WEEK'S `team_lineups` rows, never the
 *      current roster (F262(d)): the team whose stored `slot_map` STARTS
 *      the player owns the delta. A retired franchise's past-week row keeps
 *      its id (120 re-points only weeks ≥ `retired_at_week`), so a past-week
 *      correction lands on the predecessor's book and a successor is never
 *      minted a row for a week it did not play. A rostered player no lineup
 *      starts is bench — no recompute (§22.2's incremental rule). Bench and
 *      IR slots are excluded; the roster's `ir_slots` keys say which.
 *   6. RECOMPUTE (the one pipeline — D33/D57/F23) — per affected team, every
 *      starter through
 *        `scorePlayerWeek(resolveRules(snapshot, position),
 *                         deriveTierIndicators(deliveredLine(row, position), cuts))`
 *      — `deriveTierIndicators` composed BEFORE `scorePlayerWeek` (F23), the
 *      FROZEN `scoring_rules_snapshot` resolved per position (rule 9), the
 *      format-2 document's OWN `tier_cuts` (§7.3.3.1(a)). Per-player points
 *      are `roundHalfUp`'d (the §7.3.3 stored precision); a team's score is
 *      the sum of those ROUNDED per-player values (§7.3.3 verbatim), snapped
 *      through `roundHalfUp` once more only to collapse float noise — the
 *      door REFUSES a third decimal rather than rounding (F22: no path lets
 *      the DB round a divergent value).
 *      `total_points` leagues: every seated team without a
 *      `team_week_results` row is computed too — the provisional row per
 *      seated team at the first batch (F241(b); the book-owner walk keeps a
 *      successor off a predecessor's week, F262(d)).
 *   7. WRITE — ONE `score_write_week_batch` call per league-week per drain
 *      (§22.2's coalesce rule: one UPDATE ⇒ one `matchups` event, 119). The
 *      door's REPORT is read (F259(e)): `nothing_writable` on a week the
 *      worker expected to score is a PROBLEM, never success; `no_change` is
 *      the idempotency count; every `skipped[]` entry is named.
 *   8. ACK — the claimed rows are deleted BY STAMP (`enqueued_at` equal to
 *      the value read at step 1). Ingestion re-stamps an existing queue row
 *      on every real delta (D321(2) — the enqueue is `ON CONFLICT DO UPDATE`
 *      on the stamp), so a delta that lands while a drain is in flight
 *      moves the stamp, the conditional delete misses, and the row survives
 *      for the next drain — a delta is never lost between "scored from the
 *      old row" and "deleted". Rows held at steps 2/4 are not touched.
 *
 * PENDING, NEVER ZERO (E61; D295) — the three states a starter can be in,
 * kept apart on purpose:
 *   * SCORED — a stat line exists; every APPLICABLE rules key is delivered.
 *   * PENDING — a stat line exists but an applicable rules key has no
 *     delivered stat (the charted/tracking two-phase case, §23.5 — the
 *     `charted_late` scenario's surface). The player is pending, so the TEAM
 *     is pending: the door is sent `points: null` (NULL on the cell; a
 *     `total_points` row is not written — F259(d)).
 *   * NO STAT LINE — the provider emitted nothing for him this week: not yet
 *     kicked off, a bye, an inactive/scratch, a DNP, a game postponed out
 *     of the week (§23.3/E43 "score 0"; D293's bye/OUT "score 0"; the
 *     synthetic provider's own contract: "scratched — never plays, never
 *     scores"). He scores 0 and is NAMED (`no_stat_row`) — never pending,
 *     because pending would hold every league whose starter sat out from
 *     ever finalizing. PROGRESS Q42 records this reading for Chris.
 *   Applicability is POSITION-SCOPED by the validator's own law
 *   (`POSITION_SCORABLE_KEYS`, guardrail 3): a format-1 template pays K and
 *   D/ST keys a QB can never deliver, and L.A1.10's parity fixtures already
 *   model a position's line as its own keys (a QB line never carries
 *   `def_points_allowed`). A rules key outside the position's scope is
 *   INAPPLICABLE — neither delivered nor pending. Advanced keys (§23.5
 *   storage `advanced`) apply to every position until the registry says
 *   otherwise (F263).
 *
 * CORRUPT SNAPSHOT (D292's posture, decided): a snapshot that does not
 * resolve (`resolveRules` throws on a bad envelope) or does not score
 * (`scorePlayerWeek` throws on a non-finite coefficient — R59/D58), or is
 * NULL, QUARANTINES THE LEAGUE-WEEK: a `failed` entry naming the cause,
 * nothing written for it, siblings in the same drain score. Absence with a
 * name, never a plausible 0.00 (CLAUDE.md).
 *
 * The worker is a pure module with injected IO (D12's `IngestIo` shape):
 * time only via `time` (the D3 ESLint fence covers this file — it reads no
 * clock for any decision; `ran_at` is the report's stamp), the DB only via
 * `db` (a service-role client — the door refuses a JWT-bearing caller
 * in-body). No provider read here: the queue and `player_stats` ARE the
 * provider's output (L.D2.1). The route/cron that invokes it is L.D2.3's.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { STAT_KEYS } from '../stats/stat-keys'
import type { TimeProvider } from '../time/time-provider'
import { roundHalfUp, scorePlayerWeek } from './calculator'
import { deriveTierIndicators } from './derive-stats'
import {
  isFormat1Doc,
  resolveRules,
  SCORING_POSITIONS,
  type ScoringPosition,
  type ScoringRulesDoc,
} from './rules-doc'
import type { TierCuts } from './tier-cuts'
import { POSITION_SCORABLE_KEYS } from './validate-rules-doc'

// ── Registry-derived surfaces (one namespace, D33) ─────────────────────────

/** Canonical key → `player_stats` column, for every column-stored key. */
const COLUMN_BY_KEY: ReadonlyMap<string, string> = new Map(
  STAT_KEYS.filter((def) => def.storage === 'column' && def.column !== undefined).map((def) => [
    def.key,
    def.column as string,
  ]),
)

/** Keys stored in `player_stats.advanced` (§23.5) — pending when ABSENT. */
export const ADVANCED_KEYS: ReadonlySet<string> = new Set(
  STAT_KEYS.filter((def) => def.storage === 'advanced').map((def) => def.key),
)

/** The D/ST tier families' raw sources (registry `context`): delivered to a
 *  D/ST line so `deriveTierIndicators` can one-hot the families (D44). */
const DST_SOURCE_KEYS: readonly string[] = ['def_points_allowed', 'def_yards_allowed']

/** Every `player_stats` column the worker reads — the select list. */
export const STAT_LINE_COLUMNS: readonly string[] = [
  ...new Set([...COLUMN_BY_KEY.values()]),
].sort()

// ── Position vocabulary ────────────────────────────────────────────────────

const POSITION_SET: ReadonlySet<string> = new Set(SCORING_POSITIONS)

/**
 * `players.position` speaks the feed's vocabulary (Sleeper's `DEF`); the
 * scoring document speaks §7.3.3.1's (`DST`). One bridge, the same one 086's
 * draft completion uses (`CASE WHEN position = 'DEF' THEN 'DST'`).
 */
export function normalizePosition(raw: string): string {
  const upper = raw.trim().toUpperCase()
  return upper === 'DEF' ? 'DST' : upper
}

function isScoringPosition(position: string): position is ScoringPosition {
  return POSITION_SET.has(position)
}

/**
 * The rules keys a player of `position` can DELIVER — the validator's
 * position-scope law (§7.3.3.1 guardrail 3) plus the advanced keys. A rules
 * key outside this set is inapplicable to him: not delivered, not pending.
 * A position outside the six (an IDP slot) has no scorable key in the
 * registry; only advanced keys can apply.
 */
export function applicableKeys(position: string): ReadonlySet<string> {
  const scoped = isScoringPosition(position) ? POSITION_SCORABLE_KEYS[position] : []
  return new Set([...scoped, ...ADVANCED_KEYS])
}

// ── Stat lines ─────────────────────────────────────────────────────────────

/** A `player_stats` row as the worker reads it (the column surface + `advanced`). */
export interface StatLineRow {
  player_id: string
  updated_at: string
  advanced: Record<string, unknown> | null
  [column: string]: unknown
}

/**
 * The delivered line for a player of `position`: his position's scorable
 * keys read from their columns (a NULL column is the column DEFAULT 0 —
 * ingestion writes the whole surface, D303; a stored 0 is a DELIVERED zero,
 * never pending), the D/ST raw sources for a D/ST line (the derive inputs),
 * and every registry advanced key PRESENT in `advanced` (an absent key is
 * pending — §23.5's storage rule). Keys outside the scope are left out so
 * a QB's `def_points_allowed = 0` can never one-hot a shutout tier.
 */
export function deliveredLine(row: StatLineRow, position: string): Record<string, number> {
  const raw: Record<string, number> = {}
  const scoped = isScoringPosition(position) ? POSITION_SCORABLE_KEYS[position] : []
  const columnKeys = position === 'DST' ? [...scoped, ...DST_SOURCE_KEYS] : scoped
  for (const key of columnKeys) {
    const column = COLUMN_BY_KEY.get(key)
    if (column === undefined) continue // a derived tier key — derive emits it
    const value = row[column]
    raw[key] = value === null || value === undefined ? 0 : Number(value)
  }
  const advanced = row.advanced ?? {}
  for (const key of ADVANCED_KEYS) {
    const value = advanced[key]
    if (typeof value === 'number' && Number.isFinite(value)) raw[key] = value
  }
  return raw
}

/** A format-2 document scores against its OWN tiers (§7.3.3.1(a); D174). */
export function cutsOf(snapshot: ScoringRulesDoc): TierCuts | undefined {
  return isFormat1Doc(snapshot) ? undefined : snapshot.tier_cuts
}

/**
 * Prove the snapshot resolves and scores for every position BEFORE any
 * team is computed — the D292 quarantine gate. Throws the calculator's /
 * resolver's own TypeError (a corrupt snapshot names its key), or a
 * `snapshot_missing` error for NULL.
 */
export function assertSnapshotScorable(snapshot: unknown): asserts snapshot is ScoringRulesDoc {
  if (snapshot === null || snapshot === undefined || typeof snapshot !== 'object') {
    throw new TypeError('snapshot_missing: leagues.scoring_rules_snapshot is not a document — the league was never frozen (§7.3.3)')
  }
  for (const position of SCORING_POSITIONS) {
    scorePlayerWeek(resolveRules(snapshot as ScoringRulesDoc, position), {})
  }
}

// ── Per-starter / per-team scoring (pure; the D62 literals pin these) ───────

export interface StarterScore {
  player_id: string
  position: string
  /** `roundHalfUp` of the full-precision dot product — the per-player
   *  STORED precision (§7.3.3); 0 for a starter with no stat line. */
  points: number
  /** Applicable rules keys with no delivered stat (E61). Non-empty ⇒ the
   *  starter is PENDING and so is his team. */
  pending: string[]
  reason: 'scored' | 'no_stat_row'
}

/**
 * THE production composition (F23's discharge site):
 *   scorePlayerWeek(resolveRules(snapshot, position), deriveTierIndicators(line, cuts))
 * Skipping the derive leaves every tier rules key of a D/ST line pending
 * and its tier points delivered as ZERO — the negative control in the test
 * file shows that signature.
 */
export function scoreStarter(
  snapshot: ScoringRulesDoc,
  playerId: string,
  position: string,
  row: StatLineRow | null,
): StarterScore {
  const rules = resolveRules(snapshot, position)
  if (row === null) {
    return { player_id: playerId, position, points: 0, pending: [], reason: 'no_stat_row' }
  }
  const line = deriveTierIndicators(deliveredLine(row, position), cutsOf(snapshot))
  const breakdown = scorePlayerWeek(rules, line)
  const applicable = applicableKeys(position)
  return {
    player_id: playerId,
    position,
    points: breakdown.total, // already roundHalfUp'd by the calculator
    pending: breakdown.pending.filter((key) => applicable.has(key)),
    reason: 'scored',
  }
}

export interface TeamWeekScore {
  team_id: string
  /** Σ of the starters' ROUNDED points (§7.3.3), or null when any starter is
   *  pending (E61 — the door's NULL). */
  points: number | null
  starters: StarterScore[]
  pending: Array<{ player_id: string; keys: string[] }>
  no_stat_row: string[]
}

export interface StarterRef {
  player_id: string
  position: string
}

/**
 * A team's week: the sum of its STARTERS' stored (rounded) points. The
 * outer `roundHalfUp` only collapses binary-float noise in a sum of
 * two-decimal values (`0.1 + 0.2`); the per-player rounding is what the law
 * prescribes and it happens FIRST (pinned: two starters at 10.005 each are
 * 10.01 + 10.01 = 20.02, not 20.01).
 */
export function computeTeamWeek(
  snapshot: ScoringRulesDoc,
  teamId: string,
  starters: readonly StarterRef[],
  statsByPlayer: ReadonlyMap<string, StatLineRow>,
): TeamWeekScore {
  const scored = starters.map((s) => scoreStarter(snapshot, s.player_id, s.position, statsByPlayer.get(s.player_id) ?? null))
  const pending = scored.filter((s) => s.pending.length > 0).map((s) => ({ player_id: s.player_id, keys: s.pending }))
  const sum = scored.reduce((acc, s) => acc + s.points, 0)
  return {
    team_id: teamId,
    points: pending.length > 0 ? null : roundHalfUp(sum),
    starters: scored,
    pending,
    no_stat_row: scored.filter((s) => s.reason === 'no_stat_row').map((s) => s.player_id),
  }
}

// ── Lineups ────────────────────────────────────────────────────────────────

/** The IR spot keys of a league's `roster_settings` (§7.3.2 `ir_slots[].key`). */
export function irKeysOf(rosterSettings: unknown): ReadonlySet<string> {
  const keys = new Set<string>()
  const slots = (rosterSettings as { ir_slots?: unknown } | null)?.ir_slots
  if (Array.isArray(slots)) {
    for (const slot of slots) {
      const key = (slot as { key?: unknown })?.key
      if (typeof key === 'string' && key.length > 0) keys.add(key)
    }
  }
  return keys
}

/**
 * Starters from a canonical `slot_map` (§12.13 `"<slot_key>:<index>" →
 * player_id`): every value under a STARTING slot key. IR keys (`"<ir_key>:0"`)
 * are excluded; bench players are not in the map at all. Returns null for a
 * row whose map is not an object (a 001-era row) — the caller names it.
 */
export function startersOf(slotMap: unknown, irKeys: ReadonlySet<string>): string[] | null {
  if (slotMap === null || typeof slotMap !== 'object' || Array.isArray(slotMap)) return null
  const out: string[] = []
  for (const [slot, value] of Object.entries(slotMap as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length === 0) continue
    const key = slot.split(':')[0]
    if (irKeys.has(key)) continue
    out.push(value)
  }
  return out
}

// ── Lineage (F262(d)) ──────────────────────────────────────────────────────

export interface TeamRow {
  id: string
  status: string
  retired_at_week: number | null
  successor_team_id: string | null
}

/**
 * The franchise whose BOOK a week belongs to, for a seated team: walk
 * `successor_team_id` backward while the predecessor's `retired_at_week`
 * lies beyond the week (its weeks before the seal are its own — E49; 120
 * re-points only weeks ≥ `retired_at_week`). Depth-capped like 120's walk.
 */
export function bookOwnerForWeek(teamId: string, week: number, teams: ReadonlyMap<string, TeamRow>): string {
  let owner = teamId
  for (let depth = 0; depth < 64; depth++) {
    let predecessor: TeamRow | undefined
    for (const t of teams.values()) {
      if (t.successor_team_id === owner && t.status === 'retired') {
        predecessor = t
        break
      }
    }
    if (!predecessor || predecessor.retired_at_week === null || predecessor.retired_at_week <= week) return owner
    owner = predecessor.id
  }
  return owner
}

// ── The drain ──────────────────────────────────────────────────────────────

export type ScoreWorkerClient = SupabaseClient<Database>

export interface ScoreWorkerDeps {
  /** The report's `ran_at`; no scoring decision reads it (§23.3 — the
   *  week's own status is the datum). */
  time: TimeProvider
  /** Service-role client: the queue is service-role-only (109) and the
   *  door refuses a signed-in caller (119). */
  db: ScoreWorkerClient
}

export interface ScoreWorkerOptions {
  /** Queue rows claimed per drain; capped at the PostgREST row cap (1000)
   *  so a claim can never be silently truncated (rule 10). Default 500. */
  batchSize?: number
  /**
   * The stack-lane scope seam (D313(2)'s shape): when set, only these
   * leagues are scored and a queue row is consumed only if it maps to one
   * of them — other suites' rows on the shared stack are left untouched.
   * Production passes nothing.
   */
  leagueIds?: readonly string[]
}

export interface DoorSkip {
  reason: string
  team_id?: string
  matchup_id?: string
  round_type?: string
}

export interface DoorReport {
  league_id: string
  season: number
  week: number
  mode: string
  received: number
  writable: number
  written: number
  unchanged: number
  skipped: DoorSkip[]
  reason: 'nothing_writable' | 'no_change' | null
}

export type LeagueWeekOutcome =
  | 'written'
  | 'no_change'
  | 'nothing_writable'
  | 'skipped'
  | 'held'
  | 'failed'

export interface LeagueWeekReport {
  league_id: string
  season: number
  week: number
  mode: 'h2h' | 'total_points'
  outcome: LeagueWeekOutcome
  /** `skipped` / `held`: the named reason (the week's door state). */
  skip_reason?: 'week_not_scheduled' | 'week_final' | 'week_not_open'
  /** `failed`: the quarantine cause (`snapshot_missing`, `snapshot_corrupt: …`,
   *  `door: <SQLSTATE> …`). */
  error?: string
  /** Ready players this league rosters (the map's hits). */
  mapped_player_ids: string[]
  /** Teams whose WEEK lineup starts a mapped player (F262(d)). */
  affected_team_ids: string[]
  /** `total_points`: seated teams computed for their first provisional row (F241(b)). */
  provisional_team_ids: string[]
  /** Mapped players no lineup of the week starts (bench / unstarted). */
  bench_player_ids: string[]
  teams: TeamWeekScore[]
  /** `total_points` teams sent pending while a provisional row already
   *  exists — the door keeps the last value (F259(d); F263). */
  pending_kept_provisional: string[]
  door?: DoorReport
  problems: string[]
}

export interface BatchReport {
  ran_at: string
  /** Queue rows read this drain. */
  claimed: number
  /** The claim came back full — more rows are waiting. */
  more: boolean
  /** Rows whose stats have not landed (F218) — left queued. */
  not_ready: number
  /** Ready rows no in-season league rosters — consumed, nothing to score. */
  unmapped: number
  /** Ready rows mapping only to leagues outside `leagueIds` — untouched. */
  out_of_scope: number
  /** Rows held for a `week_not_open` league — left queued. */
  held: number
  /** Queue rows deleted (by stamp). */
  drained: number
  leagues: LeagueWeekReport[]
  written: number
  no_change: number
  nothing_writable: number
  skipped: number
  failed: number
  /** Every loud thing, one line each — a clean drain has none. */
  problems: string[]
  /** Why nothing was scored — never an empty success by default. */
  reason: 'queue_empty' | 'nothing_ready' | 'nothing_mapped' | 'nothing_in_scope' | null
}

const DEFAULT_BATCH = 500
const POSTGREST_ROW_CAP = 1000
const IN_CHUNK = 150

interface QueueRow {
  season: number
  week: number
  player_id: string
  enqueued_at: string
}

interface LeagueRow {
  id: string
  status: string
  season: number
  settings: Json
  roster_settings: Json
  scoring_rules_snapshot: Json
  deleted_at: string | null
}

interface LineupRow {
  team_id: string
  slot_map: Json
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null) throw new Error(`${what}: no data`)
  return result.data
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** A deterministic (state) error from the door or the pipeline — recorded
 *  per league-week. Transport errors are NOT this and abort the drain. */
class LeagueWeekFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeagueWeekFailure'
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/

async function readQueue(db: ScoreWorkerClient, limit: number): Promise<QueueRow[]> {
  const rows = must(
    await db
      .from('score_fanout')
      .select('season, week, player_id, enqueued_at')
      .order('enqueued_at', { ascending: true })
      .order('season', { ascending: true })
      .order('week', { ascending: true })
      .order('player_id', { ascending: true })
      .limit(limit),
    'score_fanout read',
  )
  return rows.map((r) => ({ ...r, enqueued_at: new Date(r.enqueued_at).toISOString() }))
}

async function readStatLines(
  db: ScoreWorkerClient,
  season: number,
  week: number,
  playerIds: readonly string[],
): Promise<Map<string, StatLineRow>> {
  const select = ['player_id', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', ')
  const out = new Map<string, StatLineRow>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = must(
      (await db
        .from('player_stats')
        .select(select)
        .eq('season', season)
        .eq('week', week)
        .in('player_id', ids)) as unknown as { data: StatLineRow[] | null; error: { message: string } | null },
      'player_stats read',
    )
    if (rows.length >= POSTGREST_ROW_CAP) {
      throw new Error(`player_stats read returned ${rows.length} rows for a ${ids.length}-id chunk — at the PostgREST cap, refusing to trust it`)
    }
    for (const row of rows) {
      out.set(row.player_id, { ...row, updated_at: new Date(row.updated_at).toISOString() })
    }
  }
  return out
}

async function readRosterLeagues(
  db: ScoreWorkerClient,
  playerIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byPlayer = new Map<string, Set<string>>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = must(
      await db.from('league_rosters').select('league_id, player_id').in('player_id', ids),
      'league_rosters read',
    )
    if (rows.length >= POSTGREST_ROW_CAP) {
      throw new Error(`league_rosters read returned ${rows.length} rows for a ${ids.length}-id chunk — at the PostgREST cap, refusing to trust it`)
    }
    for (const row of rows) {
      let set = byPlayer.get(row.player_id)
      if (!set) {
        set = new Set()
        byPlayer.set(row.player_id, set)
      }
      set.add(row.league_id)
    }
  }
  return byPlayer
}

async function readLeagues(db: ScoreWorkerClient, ids: readonly string[]): Promise<Map<string, LeagueRow>> {
  const out = new Map<string, LeagueRow>()
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = must(
      await db
        .from('leagues')
        .select('id, status, season, settings, roster_settings, scoring_rules_snapshot, deleted_at')
        .in('id', part),
      'leagues read',
    )
    for (const row of rows) out.set(row.id, row as LeagueRow)
  }
  return out
}

async function readPositions(db: ScoreWorkerClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = must(await db.from('players').select('id, position').in('id', part), 'players read')
    for (const row of rows) out.set(row.id, normalizePosition(row.position))
  }
  return out
}

function modeOf(settings: Json): 'h2h' | 'total_points' {
  const mode = (settings as { schedule_mode?: unknown } | null)?.schedule_mode
  return mode === 'total_points' ? 'total_points' : 'h2h'
}

interface LeagueWeekInput {
  league: LeagueRow
  season: number
  week: number
  /** Ready players this league rosters. */
  players: string[]
  statsByPlayer: ReadonlyMap<string, StatLineRow>
}

/**
 * One league-week: the door state, the affected teams through the week's
 * lineups, the recompute, ONE door call. Throws `LeagueWeekFailure` for a
 * deterministic refusal (recorded by the caller); anything else propagates
 * (a transport error aborts the drain with the queue intact).
 */
async function scoreLeagueWeek(db: ScoreWorkerClient, input: LeagueWeekInput): Promise<LeagueWeekReport> {
  const { league, season, week } = input
  const report: LeagueWeekReport = {
    league_id: league.id,
    season,
    week,
    mode: modeOf(league.settings),
    outcome: 'skipped',
    mapped_player_ids: [...input.players].sort(),
    affected_team_ids: [],
    provisional_team_ids: [],
    bench_player_ids: [],
    teams: [],
    pending_kept_provisional: [],
    problems: [],
  }

  // (4) The week's door state — the league_weeks row is the datum (§23.3).
  const weekRows = must(
    await db.from('league_weeks').select('status').eq('league_id', league.id).eq('season', season).eq('week', week),
    'league_weeks read',
  )
  if (weekRows.length === 0) {
    report.skip_reason = 'week_not_scheduled'
    return report
  }
  const status = weekRows[0].status
  if (status === 'final') {
    report.skip_reason = 'week_final'
    return report
  }
  if (status === 'upcoming') {
    report.outcome = 'held'
    report.skip_reason = 'week_not_open'
    return report
  }

  // (6a) The snapshot gate — quarantine BEFORE any team is computed.
  let snapshot: ScoringRulesDoc
  try {
    assertSnapshotScorable(league.scoring_rules_snapshot)
    snapshot = league.scoring_rules_snapshot
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new LeagueWeekFailure(message.startsWith('snapshot_missing') ? message : `snapshot_corrupt: ${message}`)
  }

  // (5) Teams + the WEEK's lineups.
  const teamRows = must(
    await db.from('teams').select('id, status, retired_at_week, successor_team_id').eq('league_id', league.id),
    'teams read',
  )
  const teams = new Map<string, TeamRow>(teamRows.map((t) => [t.id, t]))
  const lineupRows: LineupRow[] = []
  for (const part of chunk([...teams.keys()], IN_CHUNK)) {
    const rows = must(
      await db.from('team_lineups').select('team_id, slot_map').eq('season', season).eq('week', week).in('team_id', part),
      'team_lineups read',
    )
    lineupRows.push(...rows)
  }
  const irKeys = irKeysOf(league.roster_settings)
  const startersByTeam = new Map<string, string[]>()
  for (const row of lineupRows) {
    const starters = startersOf(row.slot_map, irKeys)
    if (starters === null) {
      report.problems.push(`team ${row.team_id}: team_lineups.slot_map is not an object — the row is unreadable, the team is not scored`)
      continue
    }
    startersByTeam.set(row.team_id, starters)
  }

  const mapped = new Set(input.players)
  const affected = new Set<string>()
  const started = new Set<string>()
  for (const [teamId, starters] of startersByTeam) {
    for (const pid of starters) {
      if (mapped.has(pid)) {
        affected.add(teamId)
        started.add(pid)
      }
    }
  }
  report.affected_team_ids = [...affected].sort()
  report.bench_player_ids = input.players.filter((pid) => !started.has(pid)).sort()

  // (6b) total_points: the provisional row per seated team (F241(b)) —
  //      through the book owner so a successor never gets a predecessor's
  //      week (F262(d)); a seated team with no lineup row is NAMED, not
  //      zero-filled (its absence holds finalization by name — R788).
  const toCompute = new Set(affected)
  if (report.mode === 'total_points') {
    const existing = must(
      await db.from('team_week_results').select('team_id').eq('league_id', league.id).eq('season', season).eq('week', week),
      'team_week_results read',
    )
    const haveRow = new Set(existing.map((r) => r.team_id))
    const provisional = new Set<string>()
    for (const t of teams.values()) {
      if (t.status === 'retired') continue
      const owner = bookOwnerForWeek(t.id, week, teams)
      if (haveRow.has(owner) || toCompute.has(owner)) continue
      if (!startersByTeam.has(owner)) {
        report.problems.push(`team ${owner}: no team_lineups row for week ${week} — no provisional row written (the week is held by name until one exists, F241(b))`)
        continue
      }
      provisional.add(owner)
      toCompute.add(owner)
    }
    report.provisional_team_ids = [...provisional].sort()
    // Pending after a provisional row exists: the door keeps the last
    // value (F259(d)) — named here, F263 carries the withdraw question.
    report.pending_kept_provisional = []
    for (const teamId of affected) if (haveRow.has(teamId)) report.pending_kept_provisional.push(teamId)
  }

  if (toCompute.size === 0) {
    report.outcome = 'skipped'
    report.problems.push(`no team starts a mapped player this week (${report.mapped_player_ids.length} mapped, all bench/unstarted) — nothing to recompute`)
    return report
  }

  // (6c) Every starter of every computed team: positions + stat lines.
  const starterIds = new Set<string>()
  for (const teamId of toCompute) for (const pid of startersByTeam.get(teamId) ?? []) starterIds.add(pid)
  const missingStats = [...starterIds].filter((pid) => !input.statsByPlayer.has(pid))
  const extraStats = missingStats.length > 0 ? await readStatLines(db, season, week, missingStats) : new Map<string, StatLineRow>()
  const statsByPlayer = new Map<string, StatLineRow>([...input.statsByPlayer, ...extraStats])
  const positions = await readPositions(db, [...starterIds])

  const scores: TeamWeekScore[] = []
  try {
    for (const teamId of [...toCompute].sort()) {
      const starters: StarterRef[] = (startersByTeam.get(teamId) ?? []).map((pid) => {
        const position = positions.get(pid)
        if (position === undefined) {
          throw new LeagueWeekFailure(`player ${pid} started by team ${teamId} has no players row — the roster references a player the table does not know`)
        }
        return { player_id: pid, position }
      })
      scores.push(computeTeamWeek(snapshot, teamId, starters, statsByPlayer))
    }
  } catch (err) {
    if (err instanceof LeagueWeekFailure) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new LeagueWeekFailure(`snapshot_corrupt: ${message}`)
  }
  report.teams = scores
  report.pending_kept_provisional = report.pending_kept_provisional.filter((teamId) =>
    scores.some((s) => s.team_id === teamId && s.points === null),
  )

  // (7) ONE door call per league-week per drain.
  const batch = scores.map((s) => ({ team_id: s.team_id, points: s.points }))
  const { data, error } = await db.rpc('score_write_week_batch', {
    p_league_id: league.id,
    p_week: week,
    p_scores: batch as unknown as Json,
  })
  if (error) {
    const code = (error as { code?: string }).code
    if (typeof code === 'string' && SQLSTATE.test(code)) {
      throw new LeagueWeekFailure(`door: ${code} ${error.message}`)
    }
    throw new Error(`score_write_week_batch (${league.id} week ${week}): ${error.message}`)
  }
  const door = data as unknown as DoorReport
  report.door = door
  for (const skip of door.skipped ?? []) {
    report.problems.push(`door skipped ${skip.team_id ?? skip.matchup_id ?? '?'}: ${skip.reason}`)
  }
  if (door.reason === 'nothing_writable') {
    report.outcome = 'nothing_writable'
    report.problems.push(`door wrote NOTHING for league ${league.id} week ${week}: every touched row protected / pending / row-less (${door.skipped?.length ?? 0} skips) — not a success`)
  } else if (door.reason === 'no_change') {
    report.outcome = 'no_change'
  } else {
    report.outcome = 'written'
  }
  return report
}

/**
 * One drain of `score_fanout`. See the file banner for the eight steps.
 * Returns a report; throws only on a transport/DB failure (the queue is
 * then intact — at-least-once).
 */
export async function runScoreWeekBatch(deps: ScoreWorkerDeps, opts: ScoreWorkerOptions = {}): Promise<BatchReport> {
  const { db } = deps
  const batchSize = Math.min(opts.batchSize ?? DEFAULT_BATCH, POSTGREST_ROW_CAP)
  const scope = opts.leagueIds ? new Set(opts.leagueIds) : null
  const report: BatchReport = {
    ran_at: deps.time.now().toISOString(),
    claimed: 0,
    more: false,
    not_ready: 0,
    unmapped: 0,
    out_of_scope: 0,
    held: 0,
    drained: 0,
    leagues: [],
    written: 0,
    no_change: 0,
    nothing_writable: 0,
    skipped: 0,
    failed: 0,
    problems: [],
    reason: null,
  }

  // (1) CLAIM
  const queue = await readQueue(db, batchSize)
  report.claimed = queue.length
  report.more = queue.length >= batchSize
  if (queue.length === 0) {
    report.reason = 'queue_empty'
    return report
  }

  // Group by (season, week) — the map and the lines are per week.
  const groups = new Map<string, QueueRow[]>()
  for (const row of queue) {
    const key = `${row.season}:${row.week}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const toDelete: QueueRow[] = []
  let anyReady = false
  let anyMapped = false
  let anyInScope = false

  for (const rows of groups.values()) {
    const { season, week } = rows[0]

    // (2) READINESS (F218)
    const lines = await readStatLines(db, season, week, rows.map((r) => r.player_id))
    const ready: QueueRow[] = []
    for (const row of rows) {
      const line = lines.get(row.player_id)
      if (line === undefined || line.updated_at < row.enqueued_at) report.not_ready += 1
      else ready.push(row)
    }
    if (ready.length === 0) continue
    anyReady = true

    // (3) MAP — roster index ∩ in-season leagues of the season.
    const rosterLeagues = await readRosterLeagues(db, ready.map((r) => r.player_id))
    const candidateIds = new Set<string>()
    for (const set of rosterLeagues.values()) for (const id of set) candidateIds.add(id)
    const leagues = await readLeagues(db, [...candidateIds])
    const playersByLeague = new Map<string, string[]>()
    const heldPlayers = new Set<string>()
    for (const row of ready) {
      const inSeason: string[] = []
      let inScopeHit = false
      for (const leagueId of rosterLeagues.get(row.player_id) ?? []) {
        const league = leagues.get(leagueId)
        if (!league || league.deleted_at !== null) continue
        if (league.season !== season) continue
        if (league.status !== 'in_season' && league.status !== 'playoffs') continue
        if (scope && !scope.has(leagueId)) continue
        inScopeHit = true
        inSeason.push(leagueId)
      }
      if (inSeason.length === 0) {
        if (scope) {
          report.out_of_scope += 1
          continue // a scoped drain consumes only what it scores — the row is the unscoped drain's
        }
        report.unmapped += 1
        toDelete.push(row) // consumed: no in-season league rosters him
        continue
      }
      if (inScopeHit) anyInScope = true
      anyMapped = true
      for (const leagueId of inSeason) {
        const bucket = playersByLeague.get(leagueId)
        if (bucket) bucket.push(row.player_id)
        else playersByLeague.set(leagueId, [row.player_id])
      }
    }

    // (4)–(7) per league-week, quarantined individually.
    for (const [leagueId, players] of [...playersByLeague.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const league = leagues.get(leagueId)!
      let entry: LeagueWeekReport
      try {
        entry = await scoreLeagueWeek(db, { league, season, week, players, statsByPlayer: lines })
      } catch (err) {
        if (!(err instanceof LeagueWeekFailure)) throw err
        entry = {
          league_id: leagueId,
          season,
          week,
          mode: modeOf(league.settings),
          outcome: 'failed',
          error: err.message,
          mapped_player_ids: [...players].sort(),
          affected_team_ids: [],
          provisional_team_ids: [],
          bench_player_ids: [],
          teams: [],
          pending_kept_provisional: [],
          problems: [`QUARANTINED league ${leagueId} week ${week}: ${err.message} — nothing written for it; siblings scored`],
        }
      }
      report.leagues.push(entry)
      switch (entry.outcome) {
        case 'written':
          report.written += 1
          break
        case 'no_change':
          report.no_change += 1
          break
        case 'nothing_writable':
          report.nothing_writable += 1
          break
        case 'skipped':
          report.skipped += 1
          if (entry.skip_reason) entry.problems.push(`league ${leagueId} week ${week} skipped: ${entry.skip_reason}`)
          break
        case 'held':
          for (const pid of players) heldPlayers.add(pid)
          entry.problems.push(`league ${leagueId} week ${week} HELD: week_not_open — the delta stays queued until league_week_advance opens the week`)
          break
        case 'failed':
          report.failed += 1
          break
      }
      for (const problem of entry.problems) report.problems.push(`[${leagueId} wk ${week}] ${problem}`)
    }

    // (8) ACK — every ready row that mapped, unless a league holds it.
    for (const row of ready) {
      if (!playersByLeague.size) break
      const mappedHere = [...playersByLeague.values()].some((ids) => ids.includes(row.player_id))
      if (!mappedHere) continue
      if (heldPlayers.has(row.player_id)) {
        report.held += 1
        continue
      }
      toDelete.push(row)
    }
  }

  // Delete BY STAMP: grouped by (season, week, enqueued_at).
  const byStamp = new Map<string, QueueRow[]>()
  for (const row of toDelete) {
    const key = `${row.season}:${row.week}:${row.enqueued_at}`
    const bucket = byStamp.get(key)
    if (bucket) bucket.push(row)
    else byStamp.set(key, [row])
  }
  for (const rows of byStamp.values()) {
    const { season, week, enqueued_at } = rows[0]
    for (const part of chunk(rows.map((r) => r.player_id), IN_CHUNK)) {
      const deleted = must(
        await db
          .from('score_fanout')
          .delete()
          .eq('season', season)
          .eq('week', week)
          .eq('enqueued_at', enqueued_at)
          .in('player_id', part)
          .select('player_id'),
        'score_fanout delete',
      )
      report.drained += deleted.length
      if (deleted.length !== part.length) {
        report.problems.push(
          `queue ack for ${season} week ${week} @ ${enqueued_at}: ${deleted.length} of ${part.length} rows deleted — the rest were re-stamped by a newer delta mid-drain and stay queued (D321(2))`,
        )
      }
    }
  }

  if (!anyReady) report.reason = 'nothing_ready'
  else if (!anyMapped) report.reason = scope && !anyInScope ? 'nothing_in_scope' : 'nothing_mapped'
  if (report.reason) report.problems.push(`drain scored nothing: ${report.reason} (claimed ${report.claimed}, not_ready ${report.not_ready}, unmapped ${report.unmapped}, out_of_scope ${report.out_of_scope})`)
  return report
}
