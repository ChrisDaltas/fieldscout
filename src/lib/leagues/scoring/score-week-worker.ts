/**
 * score-week-worker — the `score-league-week` worker (spec §22.2 worker
 * half, §7.3.3 snapshot + precision law, §23.5/E61 pending semantics, §11.4
 * live scoring; §22.3 job architecture; tasks-M4-inseason.md §5/§6 L.D2.2;
 * PROGRESS D292 / D295 / D321 (+ (10), the #267 fix round: R866–R869);
 * discharges F22 + F23; honours F218 / F241(b) / F257(a′) / F259(d)(e) /
 * F262(d); F263(d) built — the claim RPC, migration 121).
 *
 * ONE drain, in this order (`runScoreWeekBatch`):
 *
 *   1. CLAIM — `score_fanout_claim(batchSize, leaseSeconds, time.now())`
 *      (121): the oldest unleased rows (or rows whose lease has expired)
 *      are LEASED to this drain under one token — `FOR UPDATE SKIP LOCKED`
 *      in-database (§22.3's idiom), `claimed_at = the injected instant`
 *      (D291: the lease decision reads no clock the worker does not). Each
 *      row is `(season, week, player_id, enqueued_at)`; the stamp is kept
 *      VERBATIM as PostgREST rendered it — it is the ack's key (step 8;
 *      R867). A leased row is invisible to every other drain until this one
 *      acks or releases it, or the lease expires (the crash backstop).
 *   2. READINESS (F218) — a queued player whose `player_stats` row is older
 *      than its queue row, or absent, is a delta whose stats have not landed
 *      (ingestion writes the queue BEFORE the stats — R706); it stays
 *      queued and is NEVER scored from the stale row. R714's orphan escape:
 *      when the injected `lastPollCompletedAt(season, week)` says a later
 *      poll completed after the stamp, an older line is the truth and the
 *      row is ready (F217's surface — L.D2.3 binds it).
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
 *      (5b) PLUS every team whose week lineup carries `edited_by_commish`
 *      (R965): a commissioner edit moves the STARTER SET, and the starter it
 *      removes is by definition no longer reachable through step (5) — the
 *      queued player starts nowhere, `affected` is empty and the row would be
 *      consumed with the stale points left standing. The flag is the only
 *      signal of that in the drain's own reads. It costs one idempotent extra
 *      team per drain of an OPEN week and changes nothing for a stat-driven
 *      drain.
 *   6. RECOMPUTE (the one pipeline — D33/D57/F23) — per affected team, every
 *      starter through
 *        `scorePlayerWeek(resolveRules(snapshot, position),
 *                         deriveTierIndicators(deliveredLine(row, position), cuts))`
 *      — `deriveTierIndicators` composed BEFORE `scorePlayerWeek` (F23), the
 *      WEEK's frozen rules (`league_weeks.scoring_rules_snapshot`, 144 /
 *      F397 — read through `weekScoringRules`, never the league's current
 *      snapshot) resolved per position (rule 9), the
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
 *      (M5 L.D3.11 / migration 158 — PROGRESS F405, Chris 2026-09-28: "okay
 *      lets stay in line with standard platforms".) Each team also carries
 *      its per-player rows (`players` — slot, player, points, pending,
 *      reason: the terms of its score) and the door stores them WITH the
 *      score in one transaction, so a scored week's box score always adds up
 *      to the stored score (`league_week_player_points`). A pre-158 door
 *      ignores the key and its report carries no `player_points`: the drain
 *      names that (`player_points: not_stored_pre_158`, a problem line) and
 *      everything else is exactly as before — deploy before push.
 *   8. ACK — ONE `score_fanout_ack(token, consumed, deferred, deferUntil)`
 *      call (121; 122): every consumed row still carrying THIS token at the
 *      stamp the claim returned is deleted; the HELD rows (the not-ready of
 *      step 2, the held of step 4) are handed back DEFERRED to
 *      `time.now() + deferSeconds` (122 — R872's starvation closer: the
 *      claim skips them until then, and ingestion's re-stamp clears the
 *      hold); everything else under the token is RELEASED (the out-of-scope
 *      and the re-stamped). Ingestion re-stamps an existing queue row on every
 *      real delta (D321(2) — the enqueue is `ON CONFLICT DO UPDATE` on the
 *      stamp; the lease columns are not in its payload, so the lease
 *      SURVIVES the re-stamp), so a delta that lands while a drain is in
 *      flight moves the stamp, the delete misses, the row is released, and
 *      the next drain scores the newer line — a delta is never lost between
 *      "scored from the old row" and "deleted". The ack reports what it
 *      MEASURED for every miss (R869): `restamped` (our token, a newer
 *      stamp), `lease_lost` (another drain re-claimed it after our lease
 *      expired — the one window a stale write can land in, bounded and
 *      named), `gone` (consumed by that drain). A drain that throws
 *      mid-way releases its lease in `finally` (an empty ack) so a transient
 *      error costs no lease wait; if that release fails too, the lease
 *      expiry is the backstop.
 *
 * STAT CORRECTIONS (M6 L.E2.2 — migration 172; spec §23.4 v2.16.83; tasks-M6
 * TD6 / TD7 / TD8 as ruled by Q81 — PROGRESS D438 / D439 / D440 / D453).
 * (2b) the drain reads the UNAPPLIED `stat_correction_events` of its ready
 * players; (7) a team whose starters include one of them names those events
 * (`corrections`) and the door records the league's correction IN the
 * re-score's transaction — the starter filter, the "no points moved" test,
 * the league post and the result-flip notifications are the door's; (7b) a
 * re-score of the last regular-season week or a playoff round runs the
 * bracket sync at once (`score_bracket_resync`, F476); (8a′) BEFORE the ack
 * the events of every CONSUMED row are stamped `applied_at` at this drain's
 * instant (R1342 — an event is sent once). Since F529 (production on 172+)
 * a door report without `corrections` when corrections were sent, or either
 * new door missing, is a plain failure — the pre-172 absence arms are
 * retired. A final week is still `week_final` (nothing records).
 *
 * TWO DRAINS AT ONCE (§22.3 "concurrent invocations are safe by
 * construction" — R866, the reviewer's interleaving, a permanent stack
 * cell): before 121 the drain was read-then-ack and nothing stopped a
 * second drain from reading the same player mid-flight — A read K at S1
 * and the OLD line; a poll re-stamped K to S2 and landed the NEW line; B
 * read K at S2, scored, wrote, deleted K@S2; A then wrote its OLD score
 * over B's (the door is last-writer-wins — idempotence for identical
 * re-sends, not ordering) and its ack missed: a STALE score and an EMPTY
 * queue, and nothing re-enqueues it. With the lease, B's claim SKIPS K
 * (A holds it; the re-stamp kept the lease), B reports `all_leased`, A
 * writes the old line's score (a transient the next drain corrects), A's
 * ack misses by stamp and RELEASES K@S2, and the next drain scores the
 * newer line. Per-row, in-flight processing is serialized by the lease;
 * deltas are serialized by the stamp. The residual is the lease expiry: a
 * drain SLOWER than `leaseSeconds` can be re-claimed while alive and its
 * late write is stale for that row — measured (`lease_lost`), reported,
 * and closed by L.D2.3 setting the lease ≥ the invoker's hard timeout
 * (F263(f), a precondition on the wiring task).
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

import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'
import { type PageResponse, pageAll } from '@/lib/supabase/page-all'

import { NULL_IS_PENDING_KEYS, STAT_KEYS } from '../stats/stat-keys'
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

// ── Instants (R867) ────────────────────────────────────────────────────────

const INSTANT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/**
 * An ISO-8601 / PostgREST-rendered instant → microseconds since the epoch.
 * Postgres stamps carry up to SIX fractional digits (`DEFAULT now()`, any
 * SQL-side enqueue) and PostgREST renders them verbatim (trailing zeros
 * trimmed, `+00:00` or `Z`); a millisecond `Date` round-trip would collapse
 * `…00.123456` and `…00.123789` onto one instant and read a line 333 µs
 * OLDER than its queue row as landed. Every readiness comparison (F218)
 * goes through this; the ack never compares a rendering at all (121 casts
 * the claim's own string back to `timestamptz`, exact).
 */
export function instantMicros(raw: string): number {
  const m = INSTANT.exec(raw.trim())
  if (!m) throw new Error(`instantMicros: unparseable instant "${raw}"`)
  const [, date, hms, frac, tz] = m
  const offset = tz === undefined ? 'Z' : tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2').replace(/^([+-]\d{2})$/, '$1:00')
  const baseMs = Date.parse(`${date}T${hms}${offset}`)
  if (!Number.isFinite(baseMs)) throw new Error(`instantMicros: unparseable instant "${raw}"`)
  const micros = frac === undefined ? 0 : Number(`${frac}000000`.slice(0, 6))
  return baseMs * 1000 + micros
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
 *
 * L.E1.26 / F390 — the ONE exception to "NULL reads 0": a key flagged
 * `null_is_pending` in the registry (exactly `def_yards_allowed`) whose
 * column is NULL is left ABSENT, so `deriveTierIndicators` emits none of the
 * def_ya_* family and a template that scores it lands those keys on the
 * calculator's pending path (§23.5 / E61) — never the "<100 yards" tier a
 * NULL-read-as-0 used to pay every week. A stored number (including a real
 * 0) is delivered as before.
 */
export function deliveredLine(row: StatLineRow, position: string): Record<string, number> {
  const raw: Record<string, number> = {}
  const scoped = isScoringPosition(position) ? POSITION_SCORABLE_KEYS[position] : []
  const columnKeys = position === 'DST' ? [...scoped, ...DST_SOURCE_KEYS] : scoped
  for (const key of columnKeys) {
    const column = COLUMN_BY_KEY.get(key)
    if (column === undefined) continue // a derived tier key — derive emits it
    const value = row[column]
    if (value === null || value === undefined) {
      if (NULL_IS_PENDING_KEYS.has(key)) continue // F390: not delivered ⇒ pending, never 0
      raw[key] = 0
    } else {
      raw[key] = Number(value)
    }
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

/** The slice of a `league_weeks` row the per-week rules are read from. */
export interface WeekRulesRow {
  week: number
  status: string
  scoring_rules_snapshot: unknown
}

/**
 * THE ONE READER OF A WEEK'S SCORING RULES (M6A L.E1.27, migration 144;
 * PROGRESS F397 — Chris: "F397 yes build it"; Q69). Every league week stores
 * the rules it is played with (`league_weeks.scoring_rules_snapshot`, stamped
 * when the week opens, re-written only while it is LIVE by a rescore). The
 * worker (live polls AND correction-window stat corrections), the box score,
 * the nightly reconcile and the season-to-date values all read a week's
 * rules through THIS, never the league's current snapshot:
 *   - an OPENED week (live / correction_window / final) ⇒ ITS stored rules;
 *     none stored ⇒ `snapshot_missing` BY NAME (the D292 quarantine / E61
 *     posture) — NEVER a fallback to the league column, which after a
 *     mid-season scoring change holds rules the week was not played with;
 *   - an UPCOMING week holds none (144's CHECK) — it takes the league's rules
 *     when it opens, so the league's snapshot is exactly the rules it WILL
 *     be scored under; only the box score (a projection of a week not yet
 *     played) and the values job reach this arm.
 * Throws a `TypeError` (`snapshot_missing: …`, or the calculator's own for a
 * corrupt document), exactly like `assertSnapshotScorable`.
 */
export function weekScoringRules(week: WeekRulesRow, leagueSnapshot: unknown): ScoringRulesDoc {
  if (week.status === 'upcoming') {
    assertSnapshotScorable(leagueSnapshot)
    return leagueSnapshot
  }
  const rules = week.scoring_rules_snapshot
  if (rules === null || rules === undefined || typeof rules !== 'object') {
    throw new TypeError(
      `snapshot_missing: league_weeks.scoring_rules_snapshot is empty for week ${week.week} (${week.status}) — an opened week is scored only under the rules it was played with, never the league's current rules (§7.3.3 / F397)`,
    )
  }
  assertSnapshotScorable(rules)
  return rules
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
  const slots = starterSlotsOf(slotMap, irKeys)
  return slots === null ? null : slots.map((s) => s.player_id)
}

/**
 * The same starters WITH their slot keys, in the same order — the terms of
 * the team's sum, one per starting slot (M5 L.D3.11 / migration 158: the
 * stored per-player rows are keyed by slot, so they are exactly those terms).
 */
export function starterSlotsOf(slotMap: unknown, irKeys: ReadonlySet<string>): Array<{ slot: string; player_id: string }> | null {
  if (slotMap === null || typeof slotMap !== 'object' || Array.isArray(slotMap)) return null
  const out: Array<{ slot: string; player_id: string }> = []
  for (const [slot, value] of Object.entries(slotMap as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length === 0) continue
    const key = slot.split(':')[0]
    if (irKeys.has(key)) continue
    out.push({ slot, player_id: value })
  }
  return out
}

/** One stored per-player row as the scoring door takes it (158 — `players` on a batch element). */
export interface PlayerPointsRow {
  slot: string
  player_id: string
  points: number
  pending: string[]
  reason: 'scored' | 'no_stat_row'
}

/**
 * A computed team's per-player rows, slot by slot — `team.starters[i]` is
 * the score of `slots[i]` (computeTeamWeek maps its refs in order). The rows
 * ARE the team's score: Σ points = `team.points` when nothing is pending
 * (the door refuses anything else — 158's `player_points_rows_check_internal`).
 */
export function playerPointsRows(slots: ReadonlyArray<{ slot: string; player_id: string }>, team: TeamWeekScore): PlayerPointsRow[] {
  if (slots.length !== team.starters.length) {
    throw new Error(`playerPointsRows: ${slots.length} slots but ${team.starters.length} scored starters for team ${team.team_id}`)
  }
  return slots.map((s, i) => {
    const scored = team.starters[i]
    if (scored.player_id !== s.player_id) {
      throw new Error(`playerPointsRows: slot ${s.slot} holds ${s.player_id} but the score at that position is ${scored.player_id} (team ${team.team_id})`)
    }
    return { slot: s.slot, player_id: s.player_id, points: scored.points, pending: scored.pending, reason: scored.reason }
  })
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
  /**
   * F218/R714's orphan escape — the instant the LAST ingestion poll for
   * (season, week) COMPLETED, or null when unknown. A queued row whose stat
   * line is older than its stamp is normally held (the stats have not
   * landed); but if a later poll completed after the stamp and left the
   * line untouched, the stored line IS the truth (the delta was transient)
   * and the row would otherwise sit `not_ready` forever. The surface that
   * answers this is F217's persisted last-poll instant — L.D2.3 binds it;
   * unbound, the escape is off and an orphan stays loud (`not_ready`).
   */
  lastPollCompletedAt?: (season: number, week: number) => Promise<string | null>
}

export interface ScoreWorkerOptions {
  /** Queue rows claimed per drain; capped at the PostgREST row cap (1000)
   *  so a claim can never be silently truncated (rule 10). Default 500. */
  batchSize?: number
  /**
   * The claim's visibility timeout (121): a row this drain leases and never
   * acks (a crash) returns to the queue after this many seconds. MUST be
   * ≥ the invoker's own hard timeout — a drain that outlives its lease can
   * be re-claimed while alive and its late write is then stale for that row
   * (`lease_lost` on the report; F263(f), L.D2.3's precondition). Default
   * 120.
   */
  leaseSeconds?: number
  /**
   * R872's starvation closer (122 / F263(e)): a HELD row — not ready (F218)
   * or `week_not_open` — is handed back with `deferred_until = time.now() +
   * deferSeconds`, and the claim skips it until then, so a permanently held
   * row costs a slot once per window instead of once per drain. Ingestion's
   * re-stamp clears the deferral (a fresh delta is claimable at once).
   * Default 30.
   */
  deferSeconds?: number
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
  /** 158 (F405): the per-player arm's count. ABSENT on a pre-158 door (119),
   *  which ignores `players` — that absence is how the worker knows. */
  player_points?: { teams_sent: number; teams_written: number; rows_written: number; rows_removed: number }
  /** 172 (L.E2.2): the corrections arm's report — required whenever
   *  corrections were sent (F529: its absence is a plain failure). */
  corrections?: DoorCorrectionsReport
  /** 172 (F476): a re-score of the last regular-season week or a playoff
   *  round owes the bracket its sync now — the worker runs it. */
  bracket_resync_due?: boolean
}

/** One league record the door wrote (172, `league_stat_corrections`). */
export interface DoorCorrectionRecord {
  id: string
  team_id: string
  player_id: string
  event_ids: string[]
  player_points_before: number | null
  player_points_after: number
  team_score_before: number | null
  team_score_after: number | null
}

/** 172 (L.E2.2): what the door did with the `corrections` element. */
export interface DoorCorrectionsReport {
  teams_sent: number
  events_sent: number
  recorded: number
  records: DoorCorrectionRecord[]
  /** Named non-records: `not_started` (the starter filter — a bench player),
   *  `no_points_moved` (a stat the league does not score), `score_not_written`
   *  (an overridden / final row — the commissioner's number stands). */
  skipped: Array<{ team_id: string; player_id?: string; reason: 'not_started' | 'no_points_moved' | 'score_not_written' }>
  /** The week's games are over (`correction_window`) — results are recorded and announced. */
  results_final: boolean
  /** The ONE league post, or null when nothing was recorded. */
  post: string | null
  notified: Array<{ team_id: string; user_id: string; body: string }>
  not_notified: Array<{ team_id: string; why: string }>
  reason: 'none_sent' | 'nothing_recorded' | null
}

/** 172: what became of the corrections sent with a league-week's scores. */
export type CorrectionsStorage = 'none_sent' | 'recorded' | 'nothing_recorded'

/**
 * What the door did with the `corrections` element (pure): nothing sent ⇒
 * `none_sent`; the door's report carries `corrections` — a report without
 * it throws (F529: the pre-172 door is retired, never a quiet "not recorded").
 */
export function correctionsStorageOf(sent: number, door: DoorReport): CorrectionsStorage {
  if (sent === 0) return 'none_sent'
  if (door.corrections === undefined || door.corrections === null) throw new Error(MISSING_CORRECTIONS_REPORT)
  return door.corrections.recorded > 0 ? 'recorded' : 'nothing_recorded'
}

/** The failure a door report without `corrections` earns (F529). */
export const MISSING_CORRECTIONS_REPORT =
  'score_write_week_batch answered without a corrections report though corrections were sent — refusing to call that success'

/** 158 (F405): what became of the per-player rows sent with a league-week's scores. */
export type PlayerPointsStorage = 'stored' | 'not_stored_pre_158'

/**
 * What the door did with the per-player rows (pure): a 158 door's report
 * carries `player_points`; 119's never does (it reads only team_id / points,
 * so the rows were ignored and the scores written as before).
 */
export function playerPointsStorageOf(door: DoorReport): PlayerPointsStorage {
  return door.player_points === undefined || door.player_points === null ? 'not_stored_pre_158' : 'stored'
}

/** The sentence a pre-158 door earns — named on the drain, never silent. */
export const PRE_158_DOOR_SENTENCE =
  'per-player points NOT stored: score_write_week_batch answered without a player_points report — the database predates migration 158 (it ignores `players`); the team scores are written exactly as before and box scores stay live until 158 is pushed'

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
  /** Teams FORCED into the recompute because a commissioner wrote their week
   *  lineup (`team_lineups.edited_by_commish`) — step (5b) / R965. Empty on
   *  every ordinary drain. */
  commish_edited_team_ids: string[]
  teams: TeamWeekScore[]
  /** `total_points` teams sent pending while a provisional row already
   *  exists — the door keeps the last value (F259(d); F263). */
  pending_kept_provisional: string[]
  door?: DoorReport
  /** 158 (F405): set when the door was called — `stored` (the rows went with
   *  the scores) or `not_stored_pre_158` (a pre-158 door; named in problems). */
  player_points?: PlayerPointsStorage
  /** 172 (L.E2.2): set when the door was called — what became of the
   *  unapplied correction events sent with the scores. */
  corrections?: CorrectionsStorage
  /** 172 (L.E2.2): the correction event ids sent, per team (empty = none). */
  corrections_sent?: Record<string, string[]>
  /** 172 (L.E2.2): what the corrections did, in one line — never an
   *  unexplained zero (rule 6). Information, not a problem: a correction that
   *  moves no league score (a stat the league does not score, a benched
   *  player) is ordinary and says why here. */
  corrections_note?: string
  /** 172 (F476): the immediate bracket sync's answer when the door said it
   *  was due (a failure is a named problem; the hourly beat retries). */
  bracket_resync?: Json
  problems: string[]
}

/** Why a consumed row's ack could not delete it — what 121's ack MEASURED (R869). */
export type AckMissReason = 'restamped' | 'lease_lost' | 'gone'

export interface BatchReport {
  ran_at: string
  /** The lease this drain held (121) — null when nothing was claimable. */
  claim_token: string | null
  /** Queue rows LEASED to this drain. */
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
  /** Held rows (not_ready + held) the ack DEFERRED — stamped with
   *  `deferred_until` so the next claims skip them for a beat (122, R872);
   *  a row whose stamp moved mid-drain is released instead (it is ready). */
  deferred: number
  /** Queue rows DELETED by the ack — (token, stamp) matched. */
  drained: number
  /** Claimed rows handed back unconsumed: not-ready, held, out-of-scope,
   *  and the re-stamped (each counted elsewhere on this report). */
  released: number
  /** Consumed rows the ack could NOT delete, by measured cause (R869):
   *  `restamped` — a newer delta moved the stamp mid-drain (the row is
   *  released; the next drain scores the newer line); `lease_lost` — our
   *  lease expired and another drain re-claimed it (the ONE window a stale
   *  write can land in — a problem line); `gone` — that drain consumed it,
   *  which is the SAME window seen from the other side (R873): our lease
   *  lapsed, another drain took the row AND finished before our ack, so our
   *  door write for it may be STALE too. Alert on `lease_lost + gone > 0`. */
  ack_missed: Record<AckMissReason, number>
  leagues: LeagueWeekReport[]
  /** 172 (L.E2.2, §12.21 `applied_at`): the unapplied correction events of
   *  the drained players and what the stamp did with them (before the ack — R1342). */
  corrections_applied: {
    /** Events read for the ready players (unapplied). */
    read: number
    /** Event ids of CONSUMED players sent to the stamp. */
    sent: number
    stamped: number
    /** Named events another drain had already stamped (a lease lost / a replay). */
    already_applied: number
    /** Why the numbers are what they are (never an unexplained zero). */
    reason: string
  }
  written: number
  no_change: number
  nothing_writable: number
  skipped: number
  failed: number
  /** Every loud thing, one line each — a clean drain has none. */
  problems: string[]
  /** Why nothing was scored — never an empty success by default.
   *  `all_leased`: rows exist but every one is held by another drain in
   *  flight (the R866 shape — named, not "empty"); `all_deferred`: rows
   *  exist, none is leased, every one is inside its R872 hold (122). Both
   *  informational (R875), never alerts. */
  reason: 'queue_empty' | 'all_leased' | 'all_deferred' | 'nothing_ready' | 'nothing_mapped' | 'nothing_in_scope' | null
}

const DEFAULT_BATCH = 500
const DEFAULT_LEASE_SECONDS = 120
const DEFAULT_DEFER_SECONDS = 30
const POSTGREST_ROW_CAP = 1000
const IN_CHUNK = 150

interface QueueRow {
  season: number
  week: number
  player_id: string
  /** The stamp VERBATIM as PostgREST rendered it — the ack's key (R867). */
  enqueued_at: string
  /** The same instant at microsecond precision — the readiness comparand. */
  enqueued_micros: number
}

interface LeagueRow {
  id: string
  status: string
  season: number
  settings: Json
  roster_settings: Json
  deleted_at: string | null
}

interface LineupRow {
  team_id: string
  slot_map: Json
  /** 112:276 — TRUE on a row a COMMISSIONER wrote (`set_lineup`'s commissioner
   *  arm, 114:644; the audited override, 123). It is the only signal in the
   *  drain's own reads that a team's STARTER SET moved without a stat delta —
   *  see `scoreLeagueWeek` step (5b). */
  edited_by_commish: boolean
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

interface Claim {
  token: string | null
  rows: QueueRow[]
}

/** Step 1 — `score_fanout_claim` (121): lease up to `limit` rows under one token. */
async function claimQueue(db: ScoreWorkerClient, limit: number, leaseSeconds: number, now: Date): Promise<Claim> {
  const { data, error } = await db.rpc('score_fanout_claim', {
    p_batch: limit,
    p_lease_seconds: leaseSeconds,
    p_now: now.toISOString(),
  })
  if (error) throw new Error(`score_fanout_claim: ${error.message}`)
  const rows = (data ?? []).map((r) => ({
    season: r.season,
    week: r.week,
    player_id: r.player_id,
    enqueued_at: r.enqueued_at, // verbatim — never re-rendered (R867)
    enqueued_micros: instantMicros(r.enqueued_at),
  }))
  return { token: rows.length > 0 ? (data![0].claim_token as string) : null, rows }
}

interface AckResult {
  deleted: number
  deferred: number
  released: number
  missed: Array<{ season: number; week: number; player_id: string; reason: AckMissReason }>
}

function ackRows(rows: readonly QueueRow[]): Json {
  return rows.map((r) => ({
    season: r.season,
    week: r.week,
    player_id: r.player_id,
    enqueued_at: r.enqueued_at,
  })) as unknown as Json
}

/**
 * Step 8 — `score_fanout_ack` (121 / 122): delete the consumed rows by
 * (token, stamp); DEFER the held rows by (token, stamp) to `deferUntil`
 * (R872 — 122); release the rest.
 */
async function ackQueue(
  db: ScoreWorkerClient,
  token: string,
  consumed: readonly QueueRow[],
  deferred: readonly QueueRow[] = [],
  deferUntil: string | null = null,
): Promise<AckResult> {
  const { data, error } = await db.rpc('score_fanout_ack', {
    p_claim_token: token,
    p_consumed: ackRows(consumed),
    ...(deferred.length > 0 && deferUntil !== null ? { p_deferred: ackRows(deferred), p_defer_until: deferUntil } : {}),
  })
  if (error) throw new Error(`score_fanout_ack: ${error.message}`)
  return data as unknown as AckResult
}

interface QueueState {
  total: number
  leased: number
  /** Rows inside their R872 hold at `now` (122). */
  deferred: number
}

/** An empty claim is named: nothing queued, everything leased to another drain (R866), or everything deferred (R872). */
async function queueState(db: ScoreWorkerClient, now: Date): Promise<QueueState> {
  const total = await db.from('score_fanout').select('player_id', { count: 'exact', head: true })
  if (total.error) throw new Error(`score_fanout depth: ${total.error.message}`)
  const leased = await db.from('score_fanout').select('player_id', { count: 'exact', head: true }).not('claim_token', 'is', null)
  if (leased.error) throw new Error(`score_fanout leased: ${leased.error.message}`)
  const deferred = await db.from('score_fanout').select('player_id', { count: 'exact', head: true }).gt('deferred_until', now.toISOString())
  if (deferred.error) throw new Error(`score_fanout deferred: ${deferred.error.message}`)
  return { total: total.count ?? 0, leased: leased.count ?? 0, deferred: deferred.count ?? 0 }
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
      out.set(row.player_id, row) // updated_at verbatim — compared at microsecond precision (R867)
    }
  }
  return out
}

/** 172 (L.E2.2): the unapplied correction events of a week's ready players. */
interface UnappliedEvents {
  byPlayer: Map<string, string[]>
  /** false ⇒ the database has no `stat_correction_events` (pre-167) — named, none sent. */
  available: boolean
}

/**
 * The unapplied `stat_correction_events` of `playerIds` for (season, week)
 * — the ids the scoring door records a league's correction from (172). Read
 * by GET (R1257: a HEAD on a missing table answers 204), paged past the cap
 * with an exact count (pageAll's contract); a database without the table
 * (pre-167 — PGRST205 / 42P01 naming it) answers `available: false`.
 */
async function readUnappliedEvents(db: ScoreWorkerClient, season: number, week: number, playerIds: readonly string[]): Promise<UnappliedEvents> {
  const byPlayer = new Map<string, string[]>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    let offset = 0
    let total: number | null = null
    for (;;) {
      const page = await db
        .from('stat_correction_events')
        .select('id, player_id', { count: 'exact' })
        .eq('season', season)
        .eq('week', week)
        .is('applied_at', null)
        .in('player_id', ids)
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_ROW_CAP - 1)
      if (page.error) {
        if (isMissingSchemaObject(page.error, ['stat_correction_events'])) return { byPlayer: new Map(), available: false }
        throw new Error(`stat_correction_events read: ${page.error.message}`)
      }
      const rows = page.data ?? []
      if (page.count !== null && page.count !== undefined) total = page.count
      for (const row of rows) {
        const list = byPlayer.get(row.player_id)
        if (list) list.push(row.id)
        else byPlayer.set(row.player_id, [row.id])
      }
      offset += rows.length
      if (rows.length === 0 || (total !== null && offset >= total)) break
      if (total === null && rows.length < POSTGREST_ROW_CAP) break
    }
  }
  return { byPlayer, available: true }
}

interface RosterHit {
  league_id: string
  player_id: string
}

/**
 * Step 3's index read — `idx_league_rosters_player` ∩ the season's
 * `in_season | playoffs` leagues, SCOPED IN THE QUERY (an `!inner` embed
 * filter on `leagues`, so a player's past-season roster rows never come
 * back) and PAGED with `pageAll` (R868: a 150-player chunk over ≥ 7
 * in-season leagues each is ≥ 1,050 rows — past the PostgREST cap, which
 * the old single read refused loudly and permanently, aborting every
 * drain). `count: 'exact'` is the loud backstop: pageAll finishes on the
 * server's own count, so a page capped below its size can never truncate
 * silently (a short page without a count would). The stable order ends in
 * the UNIQUE (league_id, player_id) pair (109).
 */
async function readRosterLeagues(
  db: ScoreWorkerClient,
  season: number,
  playerIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byPlayer = new Map<string, Set<string>>()
  for (const ids of chunk(playerIds, IN_CHUNK)) {
    const rows = await pageAll<RosterHit>(
      (from, to) =>
        db
          .from('league_rosters')
          .select('league_id, player_id, leagues!inner(id)', { count: 'exact' })
          .eq('leagues.season', season)
          .in('leagues.status', ['in_season', 'playoffs'])
          .is('leagues.deleted_at', null)
          .in('player_id', ids)
          .order('league_id', { ascending: true })
          .order('player_id', { ascending: true })
          .range(from, to) as unknown as PageResponse<RosterHit>,
    )
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
        .select('id, status, season, settings, roster_settings, deleted_at')
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
  /** 172 (L.E2.2): the unapplied `stat_correction_events` ids of the ready
   *  players (empty when none, or on a database without the table). */
  eventsByPlayer: ReadonlyMap<string, readonly string[]>
}

/**
 * One league-week: the door state, the affected teams through the week's
 * lineups, the recompute, ONE door call. Throws `LeagueWeekFailure` for a
 * deterministic refusal (recorded by the caller); anything else propagates
 * (a transport error aborts the drain with the queue intact).
 */
async function scoreLeagueWeek(db: ScoreWorkerClient, time: TimeProvider, input: LeagueWeekInput): Promise<LeagueWeekReport> {
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
    commish_edited_team_ids: [],
    teams: [],
    pending_kept_provisional: [],
    problems: [],
  }

  // (4) The week's door state — the league_weeks row is the datum (§23.3) —
  //     and, from 144 (F397), the rules THIS week is played with.
  const weekRows = must(
    await db.from('league_weeks').select('league_id, week, status, scoring_rules_snapshot').eq('league_id', league.id).eq('season', season).eq('week', week),
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

  // (6a) The snapshot gate — quarantine BEFORE any team is computed. THE
  //      WEEK's rules (144 / F397): a live week's, or a correction-window
  //      week's under every stat correction — never the league's current
  //      snapshot, which a mid-season scoring change re-freezes (Q64 / Q69:
  //      a finished week keeps the rules it was played with).
  let snapshot: ScoringRulesDoc
  try {
    snapshot = weekScoringRules(weekRows[0], null)
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
      await db.from('team_lineups').select('team_id, slot_map, edited_by_commish').eq('season', season).eq('week', week).in('team_id', part),
      'team_lineups read',
    )
    lineupRows.push(...rows)
  }
  const irKeys = irKeysOf(league.roster_settings)
  const startersByTeam = new Map<string, string[]>()
  const slotsByTeam = new Map<string, Array<{ slot: string; player_id: string }>>()
  const commishEdited = new Set<string>()
  for (const row of lineupRows) {
    const slots = starterSlotsOf(row.slot_map, irKeys)
    if (slots === null) {
      report.problems.push(`team ${row.team_id}: team_lineups.slot_map is not an object — the row is unreadable, the team is not scored`)
      continue
    }
    slotsByTeam.set(row.team_id, slots)
    startersByTeam.set(row.team_id, slots.map((s) => s.player_id))
    if (row.edited_by_commish === true) commishEdited.add(row.team_id)
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

  // (5b) THE COMMISSIONER'S EDIT — R965. Steps (3)/(5) reach a team only
  //      through a STARTER of the week, which is exactly the team a lineup
  //      edit can no longer be reached through: bench a kicked-off starter
  //      without replacing him and the queued player starts NOWHERE, so
  //      `affected` is empty, `toCompute.size === 0` returns `skipped` and the
  //      row is consumed — the lineup moved and `team_week_results.points`
  //      keeps the benched player's points for ever (CLAUDE.md: never let
  //      "nothing happened" mean "it worked"). `commish_edit_lineup` (123)
  //      enqueues the changed starters so the drain VISITS this league-week;
  //      the flag on the row it wrote is what makes the drain compute THIS
  //      team once it is here — including the case where a starting slot was
  //      left EMPTY and there is no queued starter to find it by.
  //      Cost and blast radius, measured rather than assumed: the flag is
  //      sticky for the week, so an edited team is recomputed on every drain
  //      of that week — idempotently (the door reports `no_change`) and only
  //      while the week is OPEN, because a `final` week returns at step (4)
  //      above and an `upcoming` week is held. Ordinary stat-driven drains are
  //      untouched: no flag, no force, and a bench player's delta still
  //      recomputes nobody.
  for (const teamId of commishEdited) toCompute.add(teamId)
  report.commish_edited_team_ids = [...commishEdited].sort()

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
    report.problems.push(
      `no team starts a mapped player this week (${report.mapped_player_ids.length} mapped, all bench/unstarted) and no lineup of the week is commissioner-edited — nothing to recompute`,
    )
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

  // (7) ONE door call per league-week per drain. From 158 (F405) every team
  //     carries its per-player rows — the terms of its score, slot by slot —
  //     and the door stores them WITH the score, in the same transaction, so
  //     a scored week's box score always adds up to it. A pre-158 door
  //     ignores the key (119 reads team_id / points only) and says nothing
  //     of it: that silence is named below.
  //     From 172 (L.E2.2 — TD6, D438 / D453) a team whose STARTERS include a
  //     drained player carrying unapplied correction events also names those
  //     events (`corrections`); the door writes the league's record in the
  //     same transaction as the re-score — the starter filter and the "no
  //     points moved" test are the door's (server-authoritative), this only
  //     says which events the drained lines carry. A pre-172 door ignores
  //     the key (158 reads team_id / points / players) — named below.
  const sent: Record<string, string[]> = {}
  const batch = scores.map((s) => {
    const slots = slotsByTeam.get(s.team_id) ?? []
    const eventIds = [...new Set(slots.flatMap((slot) => (mapped.has(slot.player_id) ? [...(input.eventsByPlayer.get(slot.player_id) ?? [])] : [])))].sort()
    if (eventIds.length > 0) sent[s.team_id] = eventIds
    return {
      team_id: s.team_id,
      points: s.points,
      players: playerPointsRows(slots, s),
      ...(eventIds.length > 0 ? { corrections: eventIds } : {}),
    }
  })
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
  report.player_points = playerPointsStorageOf(door)
  if (report.player_points === 'not_stored_pre_158') report.problems.push(PRE_158_DOOR_SENTENCE)
  for (const skip of door.skipped ?? []) {
    report.problems.push(`door skipped ${skip.team_id ?? skip.matchup_id ?? '?'}: ${skip.reason}`)
  }

  // 172 (L.E2.2): what the door did with the corrections — never silent.
  const sentCount = Object.values(sent).reduce((n, ids) => n + ids.length, 0)
  report.corrections_sent = sent
  report.corrections = correctionsStorageOf(sentCount, door)
  if (door.corrections !== undefined && door.corrections !== null && sentCount > 0) {
    // Loud emptiness (rule 6): what the correction did to this league, and why
    // nothing where nothing — information on the report, never a problem.
    const why = (door.corrections.skipped ?? []).map((s) => `${s.team_id}${s.player_id ? `/${s.player_id}` : ''}: ${s.reason}`)
    report.corrections_note =
      report.corrections === 'recorded'
        ? `stat corrections: ${door.corrections.recorded} record(s) written for league ${league.id} week ${week} (${sentCount} event(s) sent), the league post made, ${door.corrections.notified.length} manager(s) notified${why.length > 0 ? `; not recorded: ${why.join('; ')}` : ''}`
        : `stat corrections recorded nothing for league ${league.id} week ${week} (${sentCount} event(s) sent): ${why.join('; ') || 'no reason given'}`
  }

  // 172 (F476): the bracket sync at once after a re-score of the last
  // regular-season week or a playoff round — at THIS drain's injected
  // instant (the jobs' contract). A failure is named, never a rollback of
  // the committed re-score; the hourly beat retries as before.
  if (door.bracket_resync_due === true) {
    const at = time.now().toISOString()
    const resync = await db.rpc('score_bracket_resync', { p_league_id: league.id, p_now: at })
    if (resync.error) {
      report.problems.push(`bracket re-sync FAILED for league ${league.id} week ${week}: ${resync.error.message} — the hourly beat retries`)
    } else {
      report.bracket_resync = resync.data as Json
    }
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
 * Returns a report; throws only on a transport/DB failure — the lease is
 * released on the way out (an empty ack) so the queue is intact and
 * immediately re-claimable (at-least-once); if even that fails, the lease
 * expiry (121) returns the rows.
 */
export async function runScoreWeekBatch(deps: ScoreWorkerDeps, opts: ScoreWorkerOptions = {}): Promise<BatchReport> {
  const { db } = deps
  const batchSize = Math.min(opts.batchSize ?? DEFAULT_BATCH, POSTGREST_ROW_CAP)
  const leaseSeconds = opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const deferSeconds = opts.deferSeconds ?? DEFAULT_DEFER_SECONDS
  const scope = opts.leagueIds ? new Set(opts.leagueIds) : null
  const report: BatchReport = {
    ran_at: deps.time.now().toISOString(),
    claim_token: null,
    claimed: 0,
    more: false,
    not_ready: 0,
    unmapped: 0,
    out_of_scope: 0,
    held: 0,
    deferred: 0,
    drained: 0,
    released: 0,
    ack_missed: { restamped: 0, lease_lost: 0, gone: 0 },
    leagues: [],
    corrections_applied: { read: 0, sent: 0, stamped: 0, already_applied: 0, reason: 'no event read — no ready player carries an unapplied correction' },
    written: 0,
    no_change: 0,
    nothing_writable: 0,
    skipped: 0,
    failed: 0,
    problems: [],
    reason: null,
  }

  // (1) CLAIM — the lease (121). `time.now()` is the claim's instant: the
  //     lease decision reads no clock the worker does not (D291).
  const claimAt = deps.time.now()
  const claim = await claimQueue(db, batchSize, leaseSeconds, claimAt)
  const queue = claim.rows
  report.claim_token = claim.token
  report.claimed = queue.length
  report.more = queue.length >= batchSize
  if (queue.length === 0 || claim.token === null) {
    // Loud emptiness (rule 10): nothing queued, every row another drain's
    // lease right now (the R866 shape), or every row inside its R872 hold
    // (122) — said by name, with the counts.
    const state = await queueState(db, claimAt)
    if (state.total === 0) report.reason = 'queue_empty'
    else if (state.leased === 0 && state.deferred > 0) report.reason = 'all_deferred'
    else report.reason = 'all_leased'
    report.problems.push(
      state.total === 0
        ? `drain scored nothing: ${report.reason}`
        : `drain scored nothing: ${report.reason} (queued ${state.total}, leased by another drain ${state.leased}, deferred ${state.deferred})`,
    )
    return report
  }
  const token = claim.token

  let acked = false
  try {
    // Group by (season, week) — the map and the lines are per week.
    const groups = new Map<string, QueueRow[]>()
    for (const row of queue) {
      const key = `${row.season}:${row.week}`
      const bucket = groups.get(key)
      if (bucket) bucket.push(row)
      else groups.set(key, [row])
    }

    const toDelete: QueueRow[] = []
    // 172 (L.E2.2): the unapplied correction events read for each week's
    // ready players, by `season:week:player` — stamped `applied_at` after
    // the ack for the players this drain CONSUMED (§12.21).
    const eventsByRow = new Map<string, readonly string[]>()
    let eventsMissing = false
    // The HELD rows — not ready (step 2) or week_not_open (step 4) — go back
    // deferred (122, R872) so the next claims skip them for `deferSeconds`.
    const toDefer: QueueRow[] = []
    let anyReady = false
    let anyMapped = false
    let anyInScope = false

    for (const rows of groups.values()) {
      const { season, week } = rows[0]

      // (2) READINESS (F218) — plus R714's orphan escape through the seam.
      //     Both comparands at microsecond precision (R867).
      const lines = await readStatLines(db, season, week, rows.map((r) => r.player_id))
      let lastPollMicros: number | null = null
      if (deps.lastPollCompletedAt) {
        const at = await deps.lastPollCompletedAt(season, week)
        lastPollMicros = at === null ? null : instantMicros(at)
      }
      const ready: QueueRow[] = []
      for (const row of rows) {
        const line = lines.get(row.player_id)
        const landed = line !== undefined && instantMicros(line.updated_at) >= row.enqueued_micros
        const orphanReleased = line !== undefined && lastPollMicros !== null && lastPollMicros >= row.enqueued_micros
        if (landed || orphanReleased) ready.push(row)
        else {
          report.not_ready += 1
          toDefer.push(row)
        }
      }
      if (ready.length === 0) continue
      anyReady = true

      // (2b) 172 (L.E2.2): the ready players' UNAPPLIED correction events —
      //      the door records each league's correction from them.
      const events = await readUnappliedEvents(db, season, week, ready.map((r) => r.player_id))
      if (!events.available) eventsMissing = true
      for (const [pid, ids] of events.byPlayer) {
        eventsByRow.set(`${season}:${week}:${pid}`, ids)
        report.corrections_applied.read += ids.length
      }

      // (3) MAP — roster index ∩ in-season leagues of the season (scoped
      //     and paged in the read — R868).
      const rosterLeagues = await readRosterLeagues(db, season, ready.map((r) => r.player_id))
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
            continue // a scoped drain consumes only what it scores — the row is the unscoped drain's (released by the ack)
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
          entry = await scoreLeagueWeek(db, deps.time, { league, season, week, players, statsByPlayer: lines, eventsByPlayer: events.byPlayer })
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
            commish_edited_team_ids: [],
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

      // (8a) The consumed set — every ready row that mapped, unless a league holds it.
      for (const row of ready) {
        if (!playersByLeague.size) break
        const mappedHere = [...playersByLeague.values()].some((ids) => ids.includes(row.player_id))
        if (!mappedHere) continue
        if (heldPlayers.has(row.player_id)) {
          report.held += 1
          toDefer.push(row)
          continue
        }
        toDelete.push(row)
      }
    }

    // (8b) ONE ack: delete the consumed rows by (token, stamp); release
    //      everything else this drain leased. Every miss is named by what
    //      the ack measured (R869) and counted.
    //      The held rows are DEFERRED to the injected instant + the window
    //      (D291: the deferral reads no clock the worker does not).
    // (8a′) 172 (§12.21 `applied_at`; R1342): the events of every row this
    //      drain is about to CONSUME were delivered to every league the row
    //      maps to — stamped at this drain's instant BEFORE the ack, so none
    //      is ever sent again. A failed stamp throws before the ack: the rows
    //      stay queued, the next drain re-delivers the same events against
    //      the same lines, and nothing moves or is recorded twice (the door's
    //      `no_points_moved` / `already_recorded`). An absent door throws (F529).
    const consumedIds = [...new Set(toDelete.flatMap((row) => [...(eventsByRow.get(`${row.season}:${row.week}:${row.player_id}`) ?? [])]))].sort()
    report.corrections_applied.sent = consumedIds.length
    if (eventsMissing) {
      report.corrections_applied.reason = 'stat_correction_events is absent — the database predates migration 167; no correction event exists to apply'
    } else if (consumedIds.length === 0) {
      report.corrections_applied.reason =
        report.corrections_applied.read === 0 ? 'no event read — no ready player carries an unapplied correction' : `${report.corrections_applied.read} event(s) read, none on a consumed row — they stay unapplied until their row drains`
    } else {
      const stamp = await db.rpc('stat_correction_mark_applied', { p_event_ids: consumedIds, p_now: deps.time.now().toISOString() })
      if (stamp.error) {
        throw new Error(`stat_correction_mark_applied: ${stamp.error.message}`)
      } else {
        const r = stamp.data as unknown as { stamped: number; already_applied: number }
        report.corrections_applied.stamped = r.stamped
        report.corrections_applied.already_applied = r.already_applied
        report.corrections_applied.reason = `${r.stamped} of ${consumedIds.length} stamped applied${r.already_applied > 0 ? `; ${r.already_applied} already applied` : ''}`
      }
    }
    const deferUntil = toDefer.length > 0 ? new Date(deps.time.now().getTime() + deferSeconds * 1000).toISOString() : null
    const ack = await ackQueue(db, token, toDelete, toDefer, deferUntil)
    acked = true
    report.drained = ack.deleted
    report.deferred = ack.deferred
    report.released = ack.released
    if (toDefer.length > 0) {
      report.problems.push(
        `queue hold: ${ack.deferred} of ${toDefer.length} held rows deferred until ${deferUntil} (R872 — not_ready ${report.not_ready}, week_not_open ${report.held}; a row re-stamped mid-drain is released, not deferred)`,
      )
    }
    for (const miss of ack.missed) report.ack_missed[miss.reason] += 1

    if (ack.missed.length > 0) {
      const by = (reason: AckMissReason) => ack.missed.filter((m) => m.reason === reason).map((m) => `${m.season}/${m.week}/${m.player_id}`)
      const restamped = by('restamped')
      const leaseLost = by('lease_lost')
      const gone = by('gone')
      report.problems.push(
        `queue ack: ${ack.deleted} of ${toDelete.length} consumed rows matched by (token, stamp) — ` +
          `${restamped.length} re-stamped by a newer delta mid-drain (released; the next drain scores the newer line: ${restamped.join(', ') || '—'}); ` +
          `${leaseLost.length} lease_lost (this drain outlived its ${leaseSeconds}s lease and another drain re-claimed the row — its door write for that row may be STALE, F263(f): ${leaseLost.join(', ') || '—'}); ` +
          `${gone.length} gone (our lease lapsed and another drain re-claimed AND consumed the row before this ack — its door write for that row may be STALE too, F263(f)/R873: ${gone.join(', ') || '—'})`,
      )
    }

    if (!anyReady) report.reason = 'nothing_ready'
    else if (!anyMapped) report.reason = scope && !anyInScope ? 'nothing_in_scope' : 'nothing_mapped'
    if (report.reason) report.problems.push(`drain scored nothing: ${report.reason} (claimed ${report.claimed}, not_ready ${report.not_ready}, unmapped ${report.unmapped}, out_of_scope ${report.out_of_scope})`)
    return report
  } finally {
    if (!acked) {
      // A transport/DB error mid-drain: hand the lease back now (an empty
      // ack releases every row under the token) rather than waiting out
      // the lease; a failure here is swallowed on purpose — the original
      // error propagates, and the lease expiry returns the rows.
      try {
        await ackQueue(db, token, [])
      } catch {
        /* the lease expiry is the backstop */
      }
    }
  }
}
