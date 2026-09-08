/**
 * The IN-SEASON invariant sweep — M4 task L.D6.1 item 2 (tasks-M4-inseason.md
 * §6 L.D6.1; delivery plan §4.2; spec §11.1/§11.2/§11.5/§23.2/§23.4).
 *
 * The task row names SEVEN invariants (plus a determinism clause, which is
 * the CLI's, not this file's):
 *
 *   1. exclusivity                        (spec §11.1; CLAUDE.md rule 7)
 *   2. roster/lineup legality — bipartite (spec §11.1/§11.2; E16; D293)
 *   3. standings ≡ recompute-from-scratch (spec §11.5/§7.3.7; D297/D314)
 *   4. pool/roster mirror                 (spec §12.19; D294)
 *   5. PF counted once per week           (spec §11.7; D297)
 *   6. zero final-cell rewrites           (spec §23.4; D295(b))
 *   7. zero unhandled worker errors       (spec §23.2)
 *
 * SAME SHAPE AS THE DRAFT SWEEP (`invariants.ts`): every invariant is a PURE
 * function over an audit snapshot the runner collected with a service-role
 * harness client, every failure NAMES its league AND its week, and each
 * function is falsifiable alone (unit pins in `season-invariants.test.ts`,
 * one `it()` per invariant mutating exactly one field) as well as against the
 * live chain (`season-sweep-db.test.ts` plants each violation in the database
 * and asserts the sweep reddens — D267: no decorative checks).
 *
 * ── WHAT THE SWEEP DELIBERATELY DOES NOT ASSERT ────────────────────────────
 * R801: a definition the spec lacks is a QUESTION, not an annotation. Four
 * live questions touch this surface and NONE of them is encoded here:
 *
 *   - Q38 (Points Against) is explicitly PROVISIONAL — PA is a reading the
 *     L.D1.7 Builder chose where the spec was silent, and there is no PA
 *     column. Invariant 5 asserts PF ONCE and nothing about PA; in
 *     particular it never asserts Σ PF ≡ Σ PA, which would ratify unruled law.
 *   - Q42 (a starter with no stat line) is OPEN: the worker's built reading
 *     is "scores 0 and is NAMED (`no_stat_row`)", option (b) (pending until
 *     the game is final, then 0) is live. The sweep asserts the worker's
 *     REPORT — never the arithmetic consequence of either reading — and the
 *     §23.6 world publishes lines for eighteen players, so a lawful
 *     `no_stat_row` is the COMMON case in a sim league, counted and printed.
 *   - Q37 (a game that never goes final holds its week, lawfully) is OPEN:
 *     `classifyHeldWeeks` NAMES a held week with its lawful explanation and
 *     the sweep never counts one as a failure.
 *   - Q40 (what a lock countdown targets) is OPEN: nothing here asserts
 *     against `team_lineups.locked_at`, which is a RECORD, not the lock.
 *
 * ── F273: WHAT "UNSCORED" MEANS TODAY, AND WHAT IT DOES NOT ────────────────
 * 109:162-163 declares `matchups.home_score`/`away_score` `NUMERIC DEFAULT 0`
 * and 110's `league_generate_schedule` inserts without the columns, so a
 * NEVER-SCORED regular matchup reads `0.00` — indistinguishable from a
 * legitimately-scored zero. R890 asks L.D6.1's sweep to assert "an unscored
 * regular row is NULL until its first batch"; on the CURRENT chain that
 * assertion RED-FAILS by construction, and closing it is a migration
 * (110's INSERT writing NULL, or 109's DEFAULT dropped — F273's own
 * closers). L.D6.1 is a gate task, not a schema task, so **the hole is NAMED
 * and left open, not papered over**:
 *
 *   THE SWEEP NEVER READS A `0` AS "UNSCORED". Invariant 5 sums
 *   `team_week_results.points` — the worker's own output — and never the
 *   matchups' score columns, precisely because a `0` there cannot be
 *   distinguished from a DEFAULT. Treating it as "nothing happened, so it
 *   worked" is the exact failure CLAUDE.md forbids, and hardening it into a
 *   gate condition would be worse than leaving the hole visible.
 *
 * ── INVARIANT 1's LIVE ARM CANNOT FAIL, AND THAT IS SAID OUT LOUD ──────────
 * Roster exclusivity is enforced by `UNIQUE(league_id, player_id)` on
 * `league_rosters` (072:147): a service-role INSERT is refused, so the
 * violation cannot be PLANTED in the database and a live check for it can
 * never redden. Under D267 that half is declared, not shipped decorative —
 * the CONSTRAINT is the proof, and the checker's falsifiability lives in the
 * unit pin (a doctored audit with one player on two teams). Invariant 1
 * therefore also carries two arms that CAN fail live, because nothing
 * constrains them: a started player who is not on the starting team's roster,
 * and one player started by two teams in the same league-week
 * (`team_lineups.slot_map` is JSONB with no cross-team constraint).
 *
 * ── RECONCILE FINDINGS ARE EVIDENCE; THREE OF THEM ARE INVARIANTS ──────────
 * `reconcileSeason` (L.D2.3) already implements part of this surface. The
 * sweep PROMOTES exactly the findings that restate one of the seven:
 * `drift` + `twr_mirror_drift` → invariant 3, `pool_mirror_broken` →
 * invariant 4. Every other finding is REPORTED with its severity and count
 * and, if it is an alert, listed in the run's `problems[]` — loud, visible,
 * and not silently promoted into a gate condition the task row did not name.
 * `starter_final_game_no_line` in particular fires by construction here (see
 * Q42 above): the §23.6 world has eighteen players and three games, so every
 * OTHER starter on a scenario club has a final game and no line.
 */
import type { InvariantFailure } from './sim-types'

/** A sweep failure, in the draft sweep's shape plus the week (spec §23.2:
 *  "any (with league_id context)"). */
export interface SeasonInvariantFailure {
  invariant: string
  leagueLabel: string
  leagueId: string
  /** null for a league-wide failure (exclusivity, the mirror, the standings). */
  week: number | null
  detail: string
}

export interface AuditRosterRow {
  team_id: string
  player_id: string
}

/**
 * `league_player_pool` has NO team column (109:268-288: PK `(league_id,
 * player_id)`, plus `state` / `waivers_until` / `locked_until`). The MIRROR
 * is therefore between the pool's STATE and the existence of a roster row —
 * which is exactly what D294 asserts and all §12.19 allows anyone to assert.
 */
export interface AuditPoolRow {
  player_id: string
  state: string
}

/** One stored `team_lineups` row plus the oracle's verdict on it. */
export interface AuditLineup {
  team_id: string
  week: number
  /** `<slot_key>:<index>` → player_id, as stored (§12.13). null = unreadable. */
  slot_map: Record<string, string> | null
  /** IR instance keys of this league's roster (excluded from starters). */
  ir_keys: readonly string[]
  /**
   * `lineup_fit_internal`'s verdict on the stored map, obtained by calling
   * THE MATCHER as service role — never a TS mirror of it (D289/D33).
   * `null` when the row carries no map to check.
   */
  fit: { unplaced: string[]; rearranged: boolean } | null
}

export interface AuditStanding {
  team_id: string
  points_for: number
}

export interface AuditWeekResult {
  team_id: string
  week: number
  points: number | null
  is_final: boolean
}

export interface AuditWeek {
  week: number
  status: string
}

/**
 * One matchup cell of a week, rendered at the instant the week reached
 * `final` and again at run end. Byte-identity of the two renderings IS
 * invariant 6 — the temporal check nothing else in the chain performs.
 */
export interface AuditFinalCell {
  week: number
  matchup_id: string
  /** `(home_score, away_score, result, status, is_overridden)` + the week's
   *  `team_week_results`, rendered stably. */
  at_final: string
  at_end: string
}

/** One `rebuild_team_week_results` probe (invariant 3). */
export interface AuditRebuild {
  week: number
  /** The week's `league_weeks.status` when the probe ran. */
  week_status: string
  changed: boolean | null
  reason: string | null
  digest_before: string | null
  digest_after: string | null
  /** A refusal's message (P0001/P0002) when the RPC raised. */
  refusal: string | null
}

export interface AuditReconcileFinding {
  kind: string
  severity: string
  week: number | null
  message: string
}

export interface SeasonAudit {
  leagueLabel: string
  leagueId: string
  season: number
  scheduleMode: 'h2h' | 'total_points'
  weeksDriven: readonly number[]
  rosters: readonly AuditRosterRow[]
  pool: readonly AuditPoolRow[]
  lineups: readonly AuditLineup[]
  standings: readonly AuditStanding[]
  results: readonly AuditWeekResult[]
  weeks: readonly AuditWeek[]
  finalCells: readonly AuditFinalCell[]
  rebuilds: readonly AuditRebuild[]
  reconcileFindings: readonly AuditReconcileFinding[]
  /** Loud lines from the jobs and the worker, already carrying league context. */
  workerErrors: readonly string[]
  /** Starters the worker reported as `no_stat_row` — Q42's count, never an
   *  assertion (see the banner). */
  noStatRowStarters: number
}

function fail(a: SeasonAudit, invariant: string, week: number | null, detail: string): SeasonInvariantFailure {
  return { invariant, leagueLabel: a.leagueLabel, leagueId: a.leagueId, week, detail }
}

/** Starters of a stored map: every value under a non-IR slot key (§12.13). */
export function startersOfMap(
  slotMap: Record<string, string> | null,
  irKeys: readonly string[],
): string[] {
  if (slotMap === null) return []
  const ir = new Set(irKeys)
  const out: string[] = []
  for (const [slot, value] of Object.entries(slotMap)) {
    if (typeof value !== 'string' || value.length === 0) continue
    if (ir.has(slot.split(':')[0]!)) continue
    out.push(value)
  }
  return out
}

// ── 1. Exclusivity (spec §11.1; CLAUDE.md rule 7) ──────────────────────────

export function checkExclusivity(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []

  // (a) The constraint's own law, restated. `UNIQUE(league_id, player_id)`
  //     (072:147) makes this unfalsifiable AT THE DATABASE — declared, not
  //     decorative (D267; the banner).
  const ownerByPlayer = new Map<string, string>()
  for (const row of a.rosters) {
    const prior = ownerByPlayer.get(row.player_id)
    if (prior !== undefined && prior !== row.team_id) {
      out.push(
        fail(a, 'exclusivity', null, `player ${row.player_id} is rostered by teams ${prior} and ${row.team_id}`),
      )
      continue
    }
    ownerByPlayer.set(row.player_id, row.team_id)
  }

  // (b) + (c) The arms nothing constrains: a started player must be on the
  //     starting team's roster, and no two teams may start one player in a
  //     week (`team_lineups.slot_map` is unconstrained JSONB).
  const startersByWeek = new Map<number, Map<string, string>>()
  for (const lineup of a.lineups) {
    let seen = startersByWeek.get(lineup.week)
    if (seen === undefined) {
      seen = new Map()
      startersByWeek.set(lineup.week, seen)
    }
    for (const playerId of startersOfMap(lineup.slot_map, lineup.ir_keys)) {
      const owner = ownerByPlayer.get(playerId)
      if (owner !== lineup.team_id) {
        out.push(
          fail(
            a,
            'exclusivity',
            lineup.week,
            `team ${lineup.team_id} starts ${playerId} in week ${lineup.week}, but the roster owner is ` +
              `${owner ?? '(nobody — the player is not on any roster of this league)'}`,
          ),
        )
      }
      const other = seen.get(playerId)
      if (other !== undefined && other !== lineup.team_id) {
        out.push(
          fail(
            a,
            'exclusivity',
            lineup.week,
            `player ${playerId} is started by BOTH team ${other} and team ${lineup.team_id} in week ${lineup.week}`,
          ),
        )
      }
      seen.set(playerId, lineup.team_id)
    }
  }
  return out
}

// ── 2. Roster/lineup legality — the bipartite recheck (§11.1/§11.2; E16) ───

/**
 * The ORACLE is `lineup_fit_internal` (112:439, the E16 matcher), called as
 * service role over the STORED map and the league's own starting slots; a
 * green fit re-places every started player where he already sits.
 *
 * Legality here is slot ELIGIBILITY, not availability: `allow_illegal_lineups`
 * (default true) legally starts a bye/OUT player, who scores 0 and is
 * FLAGGED — that is a §11.3 concern and is deliberately not asserted.
 */
export function checkLineupLegality(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  for (const lineup of a.lineups) {
    if (lineup.slot_map === null) {
      out.push(
        fail(a, 'lineup-legality', lineup.week, `team ${lineup.team_id} week ${lineup.week}: slot_map is not a readable object`),
      )
      continue
    }
    if (lineup.fit === null) continue // nothing started this week — no fit to check
    if (lineup.fit.unplaced.length > 0) {
      out.push(
        fail(
          a,
          'lineup-legality',
          lineup.week,
          `team ${lineup.team_id} week ${lineup.week}: lineup_fit_internal cannot seat ${lineup.fit.unplaced.join(', ')} ` +
            `in the league's starting slots (the stored map is not a legal bipartite assignment — §11.1/E16)`,
        ),
      )
    }
    if (lineup.fit.rearranged) {
      out.push(
        fail(
          a,
          'lineup-legality',
          lineup.week,
          `team ${lineup.team_id} week ${lineup.week}: lineup_fit_internal REARRANGED the stored map — ` +
            `a canonical stored lineup is already its own fit (§11.2 as-built; D293)`,
        ),
      )
    }
  }
  return out
}

// ── 3. Standings ≡ recompute-from-scratch (§11.5/§7.3.7; D297/D314) ────────

/**
 * The oracle is `rebuild_team_week_results(league, week)` (117:758), the SAME
 * `week_results_write_internal` finalization calls (D137). A FINAL week must
 * rebuild to byte-identical rows: `changed = false`, and the digests equal.
 *
 * THIS PROBE WRITES. 117:855 re-runs the results math unconditionally and
 * 117:858-866 UPDATEs `league_weeks.median_score` every time; `changed:false`
 * means the resulting ROWS are byte-identical, NOT that nothing was written.
 * The runner therefore takes invariant 6's final-cell snapshot BEFORE calling
 * it — a sweep that tripped its own invariant would be worse than no sweep.
 *
 * The rebuild refuses a non-final week BY NAME (`week_not_final`,
 * `pending_scores`, `pending_results`, `matchup_not_final`, `result_drift`).
 * A refusal on a non-final week is the RPC working and is skipped; a refusal
 * on a FINAL week is a failure and carries the refusal's own words.
 */
export function checkStandingsRecompute(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  for (const probe of a.rebuilds) {
    if (probe.refusal !== null) {
      if (probe.week_status === 'final') {
        out.push(
          fail(a, 'standings-recompute', probe.week, `rebuild refused a FINAL week: ${probe.refusal}`),
        )
      }
      continue
    }
    if (probe.week_status !== 'final') continue
    if (probe.changed !== false) {
      out.push(
        fail(
          a,
          'standings-recompute',
          probe.week,
          `rebuild_team_week_results changed a final week (changed=${String(probe.changed)}, reason=${probe.reason ?? 'null'}): ` +
            `digest_before=${probe.digest_before ?? 'null'} digest_after=${probe.digest_after ?? 'null'} — ` +
            `stored standings are not the recompute-from-scratch (§11.5/D297)`,
        ),
      )
      continue
    }
    if (probe.digest_before !== probe.digest_after) {
      out.push(
        fail(
          a,
          'standings-recompute',
          probe.week,
          `rebuild reported changed=false but the digests differ (${probe.digest_before ?? 'null'} → ${probe.digest_after ?? 'null'})`,
        ),
      )
    }
  }
  for (const f of a.reconcileFindings) {
    if (f.kind !== 'drift' && f.kind !== 'twr_mirror_drift') continue
    out.push(fail(a, 'standings-recompute', f.week, `reconcile ${f.kind}: ${f.message}`))
  }
  return out
}

// ── 4. Pool/roster mirror (§12.19; D294) ───────────────────────────────────

/**
 * D294: `rostered` pool rows mirror `league_rosters`, and the mirror is
 * ASSERTED, never trusted. Both directions — with the lazy-row rule intact:
 * a roster row with NO pool row is LEGAL (§12.19; rows are created on first
 * transition), so its absence is not a violation and a naive sweep
 * false-positives here.
 */
export function checkPoolMirror(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const ownerByPlayer = new Map<string, string>()
  for (const row of a.rosters) ownerByPlayer.set(row.player_id, row.team_id)

  for (const row of a.pool) {
    const owner = ownerByPlayer.get(row.player_id)
    if (row.state === 'rostered' || row.state === 'locked_in_game') {
      if (owner === undefined) {
        out.push(
          fail(
            a,
            'pool-roster-mirror',
            null,
            `pool says ${row.player_id} is '${row.state}', but no league_rosters row of this league holds him`,
          ),
        )
      }
      continue
    }
    if (owner !== undefined) {
      out.push(
        fail(
          a,
          'pool-roster-mirror',
          null,
          `pool says ${row.player_id} is '${row.state}', but team ${owner} rosters him`,
        ),
      )
    }
  }
  for (const f of a.reconcileFindings) {
    if (f.kind !== 'pool_mirror_broken') continue
    out.push(fail(a, 'pool-roster-mirror', f.week, `reconcile pool_mirror_broken: ${f.message}`))
  }
  return out
}

// ── 5. PF counted once per week (§11.7; D297) ──────────────────────────────

/** Two stored-precision values agree when they agree to the cent. */
function sameCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * §11.7 / spec:1353: a team's points are counted ONCE per week for Points
 * For, regardless of median or second-opponent games. The standings payload's
 * `points_for` must therefore equal the plain sum of that team's
 * `team_week_results.points` over its FINAL weeks — the median game's extra
 * result moves `wins/losses`, never `points_for`.
 *
 * READS `team_week_results`, NEVER `matchups.home_score` — see the banner's
 * F273 note: a `0` in the matchups columns cannot be distinguished from
 * 109's DEFAULT, and "nothing happened" must never be read as "it worked".
 * A NULL `points` (E61 pending) contributes nothing and is NAMED, not summed
 * as zero.
 */
export function checkPointsForOnce(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const finalWeeks = new Set(a.weeks.filter((w) => w.status === 'final').map((w) => w.week))
  const sums = new Map<string, number>()
  const pendings = new Map<string, number[]>()
  for (const r of a.results) {
    if (!finalWeeks.has(r.week)) continue
    if (r.points === null) {
      const list = pendings.get(r.team_id) ?? []
      list.push(r.week)
      pendings.set(r.team_id, list)
      continue
    }
    sums.set(r.team_id, (sums.get(r.team_id) ?? 0) + r.points)
  }
  for (const standing of a.standings) {
    const pendingWeeks = pendings.get(standing.team_id)
    if (pendingWeeks !== undefined && pendingWeeks.length > 0) {
      out.push(
        fail(
          a,
          'pf-once-per-week',
          pendingWeeks[0]!,
          `team ${standing.team_id} has a FINAL week with a NULL team_week_results.points (weeks ${pendingWeeks.join(', ')}) — ` +
            `a finalized week must carry a score, and PF cannot be checked against a pending cell (E61/§23.2)`,
        ),
      )
      continue
    }
    const expected = sums.get(standing.team_id) ?? 0
    if (!sameCents(standing.points_for, expected)) {
      out.push(
        fail(
          a,
          'pf-once-per-week',
          null,
          `team ${standing.team_id}: standings points_for = ${standing.points_for}, but Σ team_week_results.points over ` +
            `final weeks = ${expected.toFixed(2)} — points are counted once per week regardless of median/second games (§11.7)`,
        ),
      )
    }
  }
  return out
}

// ── 6. Zero final-cell rewrites (§23.4; D295(b)) ───────────────────────────

/**
 * The temporal check nothing else performs: the cell rendered at the instant
 * its week reached `final`, re-read at run end, must be BYTE-IDENTICAL.
 *
 * Not substitutable by reconcile's `drift`: reconcile EXCLUDES overridden
 * cells (`reconcile.ts:57,:698-701`) and `post_window_correction` is a WARN
 * that stops drift-checking a final cell from its first post-window mover
 * onward (R876/F268). And a `final` week's queue rows are CONSUMED with no
 * cell changed (`score-week-worker-db.test.ts:921`), so "no error fired" is
 * not the assertion — the STORED VALUE being byte-unchanged is.
 */
export function checkFinalCellsImmutable(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  for (const cell of a.finalCells) {
    if (cell.at_final === cell.at_end) continue
    out.push(
      fail(
        a,
        'final-cell-immutable',
        cell.week,
        `matchup ${cell.matchup_id} changed after its week went final: ` +
          `at finalize [${cell.at_final}] → at run end [${cell.at_end}] (§23.4/D295(b))`,
      ),
    )
  }
  return out
}

// ── 7. Zero unhandled worker errors (§23.2) ────────────────────────────────

export function checkNoWorkerErrors(a: SeasonAudit): SeasonInvariantFailure[] {
  return a.workerErrors.map((line) => fail(a, 'zero-worker-errors', null, line))
}

// ── Held weeks: CLASSIFIED, never counted (Q37) ─────────────────────────────

export interface HeldWeek {
  week: number
  status: string
  explanation: string
}

/**
 * A week the run left short of `final` is NAMED with its lawful explanation
 * — reconcile's own posture. Q37 is OPEN: a cancelled game holds a week
 * forever and lawfully, there is no `cancelled` state and `nfl_games.status`
 * is unconstrained (001:92). "Zero orphaned deadlines" therefore CLASSIFIES;
 * it never fails.
 */
export function classifyHeldWeeks(a: SeasonAudit): HeldWeek[] {
  const driven = new Set(a.weeksDriven)
  return a.weeks
    .filter((w) => driven.has(w.week) && w.status !== 'final')
    .map((w) => ({
      week: w.week,
      status: w.status,
      explanation:
        w.status === 'correction_window'
          ? 'the correction window has not been walked past yet (the run ends inside it)'
          : w.status === 'live'
            ? 'the week is still live — its games are not all final'
            : `the week is '${w.status}'`,
    }))
}

/** The full in-season sweep for one league. */
export function sweepSeasonAudit(a: SeasonAudit): SeasonInvariantFailure[] {
  return [
    ...checkExclusivity(a),
    ...checkLineupLegality(a),
    ...checkStandingsRecompute(a),
    ...checkPoolMirror(a),
    ...checkPointsForOnce(a),
    ...checkFinalCellsImmutable(a),
    ...checkNoWorkerErrors(a),
  ]
}

/** The seven invariant names, in the row's order — the report's vocabulary. */
export const SEASON_INVARIANTS: readonly string[] = [
  'exclusivity',
  'lineup-legality',
  'standings-recompute',
  'pool-roster-mirror',
  'pf-once-per-week',
  'final-cell-immutable',
  'zero-worker-errors',
]

/** Adapter so a season failure can ride the draft sweep's printer if needed. */
export function toInvariantFailure(f: SeasonInvariantFailure): InvariantFailure {
  return {
    invariant: f.invariant,
    leagueLabel: f.leagueLabel,
    draftId: f.week === null ? f.leagueId : `${f.leagueId} week ${f.week}`,
    detail: f.detail,
  }
}
