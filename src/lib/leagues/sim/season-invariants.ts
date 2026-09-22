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
 * M6A L.E1.14 (tasks-M6A §6; D345; F335/F336) adds an EIGHTH and teaches the
 * sixth:
 *
 *   8. unmanaged seats are seated by the SERVER (spec §7.2.1(c) `spec:185`;
 *      migration 125's arm (c); F334's second half) — see
 *      `checkUnmanagedSeatsAutopiloted`, whose PREMISE (≥ 1 unmanaged seat
 *      in the run) is asserted by the runner, never assumed (§4 rule 14(c)).
 *   6. learns PROVENANCE, never an exemption — a lawful commissioner override
 *      re-baselines the cell under its `commissioner_actions.id`; anything
 *      else that moves a final cell still fails. See `checkFinalCellsImmutable`.
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
  /**
   * D345 / F336 — the cell's PROVENANCE, as a SEQUENCE. `baselines[0]` is the
   * at-finalize rendering with `licensed_by = null`. Every later entry is a
   * rendering the runner recorded AT AN AUDITED EVENT:
   *
   *   - `licensed_by = <commissioner_actions.id>` — the rendering read back
   *     right after an audited verb returned that receipt;
   *   - `licensed_by = null` at index ≥ 1 — the runner re-read the cell just
   *     BEFORE an audited verb and found it no longer byte-equal to the
   *     previous baseline: DRIFT BETWEEN BASELINES, recorded so that a
   *     re-baseline can never launder a rewrite that preceded it.
   *
   * A sequence and not one `licensed_by` field: one field supports exactly
   * one re-baseline, and the assertion is about CONSECUTIVE baselines.
   */
  baselines: Array<{ rendered: string; licensed_by: string | null }>
}

/** One `commissioner_actions` row of the league — invariant 6's licence
 *  ledger (§12.12; D336's `target_type` / `target_id`). */
export interface AuditCommissionerAction {
  id: string
  /** `commissioner_actions.action_type`. Only 126's two matchup verbs may
   *  license a final cell — see `FINAL_CELL_LICENSING_ACTION_TYPES` (R1077). */
  action_type: string
  target_type: string | null
  target_id: string | null
  /** The receipt's `after` document, as stored (126:878-882 / 131:1180-1184:
   *  `{home_score, away_score, result, …}`). `unknown` on purpose: the
   *  invariant PARSES it and a malformed receipt fails by name (R1077). */
  after: unknown
}

/**
 * The ONLY `action_type` values that may lawfully move a final matchup cell:
 * 126's shared internal maps `commish_edit_score` → `edit_score` and
 * `commish_set_result` → `set_result` (`126:663`, re-stated at `131:968`).
 * Any other verb's receipt — however well-aimed its `target_id` — licenses
 * nothing here (R1077).
 */
export const FINAL_CELL_LICENSING_ACTION_TYPES: readonly string[] = ['edit_score', 'set_result']

/**
 * The three REASON strings `lineup_autopilot_internal` emits into
 * `unfillable[]` (`125:637-643`), as `prefix + UPPER(slot) + suffix`. Pinned
 * against the migration's FILE TEXT by `season-invariants.test.ts`, so a
 * wording change in a later migration reds a test instead of silently
 * un-excusing — or over-excusing — a slot (R1076).
 */
export const AUTOPILOT_UNFILLABLE_REASONS = {
  /** THE ONLY ARM INVARIANT 8 EXCUSES: a healthy candidate does not exist and
   *  the league forbids seating an unhealthy one. */
  forbidsIllegal: { prefix: 'no healthy eligible player at ', suffix: '; league forbids illegal lineups' },
  /** Never excused: the harness ticks before any kickoff. */
  lockedOut: { prefix: 'no unlocked eligible player at ', suffix: "; every candidate's game had kicked off" },
  /** Never excused beside a bench witness: the witness refutes it. */
  nobodyEligible: { prefix: 'no eligible player at ', suffix: ' on the roster' },
} as const

/** True iff `reason` is 125's "league forbids illegal lineups" arm. */
export function isForbidsIllegalReason(reason: string): boolean {
  const { prefix, suffix } = AUTOPILOT_UNFILLABLE_REASONS.forbidsIllegal
  return reason.startsWith(prefix) && reason.endsWith(suffix) && reason.length > prefix.length + suffix.length
}

/**
 * The matchup columns of a cell rendering (`season-runner.ts` `renderCells`:
 * `home=<n> away=<n> result=<s> status=…`). `null` when the rendering does
 * not carry them — which, for a LICENSED baseline, is itself a failure.
 */
export function parseRenderedCell(
  rendered: string,
): { home: number | null; away: number | null; result: string | null } | null {
  const m = /^home=(\S+) away=(\S+) result=(\S+)(?: |$)/.exec(rendered)
  if (m === null) return null
  const num = (raw: string): number | null | undefined => {
    if (raw === 'null') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  const home = num(m[1]!)
  const away = num(m[2]!)
  if (home === undefined || away === undefined) return null
  return { home, away, result: m[3] === 'null' ? null : m[3]! }
}

/** Why a receipt's `after` does NOT equal the observed cell, or `null` when it
 *  does. Scores compare NUMERICALLY at cent precision (PostgREST renders a
 *  NUMERIC as a JSON number — `12.5`, never `12.50` — while a JSONB `after`
 *  keeps the verb's own scale). */
function afterMismatch(after: unknown, rendered: string): string | null {
  const cell = parseRenderedCell(rendered)
  if (cell === null) return `the post-event rendering carries no home/away/result to compare`
  if (after === null || typeof after !== 'object' || Array.isArray(after)) {
    return `the receipt's \`after\` is ${after === null ? 'NULL' : `not an object (${JSON.stringify(after)})`}`
  }
  const doc = after as Record<string, unknown>
  const score = (raw: unknown): number | null | undefined => {
    if (raw === null) return null
    if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
    if (typeof raw === 'string' && raw.trim() === '') return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  const diffs: string[] = []
  for (const [side, key, seen] of [
    ['home', 'home_score', cell.home],
    ['away', 'away_score', cell.away],
  ] as const) {
    const said = key in doc ? score(doc[key]) : undefined
    if (said === undefined) diffs.push(`after.${key} is missing or not numeric (${JSON.stringify(doc[key])})`)
    else if (said === null || seen === null ? said !== seen : Math.round(said * 100) !== Math.round(seen * 100)) {
      diffs.push(`${side}: receipt says ${String(said)}, the cell reads ${String(seen)}`)
    }
  }
  const saidResult = 'result' in doc ? doc.result : undefined
  if (saidResult !== null && typeof saidResult !== 'string') {
    diffs.push(`after.result is missing or not a string (${JSON.stringify(saidResult)})`)
  } else if (saidResult !== cell.result) {
    diffs.push(`result: receipt says ${String(saidResult)}, the cell reads ${String(cell.result)}`)
  }
  return diffs.length === 0 ? null : diffs.join('; ')
}

/** A starting-slot INSTANCE of the league (`<slot_key>:<index>`), as stored. */
export interface AuditStartingSlot {
  key: string
  eligible: readonly string[]
}

/**
 * A seat the SERVER must seat (invariant 8). `shape` is WHY it is unmanaged:
 * `member_row_user_id_null` is 125's predicate (D339 — a placeholder or a
 * vacated seat); `no_member_row` is D339's UNSAFE direction, which arm (c)
 * DECLINES by name (`skipped[]`) — such a seat is still listed here so that
 * its empty lineup is a loud failure and never a quiet zero.
 */
export interface AuditUnmanagedSeat {
  team_id: string
  shape: 'member_row_user_id_null' | 'no_member_row'
  /** The seat's roster, positions in the roster vocabulary (DEF → DST). */
  roster: ReadonlyArray<{ player_id: string; position: string }>
}

/** One `autopilot_unfillable[]` entry a `lineup_lock_tick` pass reported
 *  (`125:630-642`) — the SERVER naming a slot it could not fill, and why. */
export interface AuditAutopilotUnfillable {
  team_id: string
  week: number
  slot: string
  reason: string
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
  /**
   * `leagues.regular_season_weeks` as STORED — the oracle's own window, read
   * from the database, never derived from the plan (R920). Invariant 5's
   * oracle (`league_standings_internal`, 118:641-643/684-690) counts only
   * `[min(league_weeks.week) … + regular_season_weeks − 1]`, so the sweep has
   * to know where the regular season ends or it sums a wider window than the
   * value it compares against.
   */
  regularSeasonWeeks: number
  weeksDriven: readonly number[]
  rosters: readonly AuditRosterRow[]
  pool: readonly AuditPoolRow[]
  lineups: readonly AuditLineup[]
  standings: readonly AuditStanding[]
  results: readonly AuditWeekResult[]
  weeks: readonly AuditWeek[]
  finalCells: readonly AuditFinalCell[]
  /** Every `commissioner_actions` row of the league (invariant 6's ledger). */
  commissionerActions: readonly AuditCommissionerAction[]
  /** `settings.allow_illegal_lineups` AS STORED (invariant 8's one excuse). */
  allowIllegalLineups: boolean
  /** The league's starting-slot instances (invariant 8). */
  startingSlots: readonly AuditStartingSlot[]
  /** Seats with no manager — read from `league_members`, never from
   *  `teams.status` (D339). */
  unmanagedSeats: readonly AuditUnmanagedSeat[]
  /** What the tick itself NAMED unfillable, latest pass per (team, week, slot). */
  autopilotUnfillable: readonly AuditAutopilotUnfillable[]
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
 *
 * RECORDED, NOT FIXED (M6A L.E1.14 item 3; PROGRESS Q59 / F324): this check
 * has the SAME provenance blindness invariant 6 had before D345 — an
 * `AuditLineup` carries no channel saying "a commissioner wrote this map", so
 * a lawful `commish_edit_lineup` and a corrupt write are indistinguishable
 * here. It is harmless TODAY only because Q59 ruled that a commissioner may
 * lift TIMING and never positional LEGALITY, so every lawful map is still its
 * own fit. If F324's legality half is ever ruled the other way, this check
 * must be TAUGHT (a licence per lineup row), never exempted.
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
 *
 * **F300 — READ THIS BEFORE TRUSTING A PASS FROM THIS FUNCTION IN A SEASON
 * RUN.** `league_player_pool` is a SPARSE table whose only writers are
 * `roster_add_drop_internal`'s two INSERTs (113:713/734, 115:646/667). The
 * season harness drives NO add/drop traffic, so `a.pool` is EMPTY for every
 * sim league and the loop below iterates nothing: this function returns `[]`
 * without having asserted a single thing, and it would return `[]` just the
 * same with the mirror rule deleted. That is a vacuous pass, and the fix is
 * NOT to dress it up here.
 *
 * The claim is withdrawn instead of faked, and the withdrawal is MACHINE-
 * CHECKED rather than left as a comment: the run reports `poolRows` (0 by
 * construction), `seasonCoverageGaps` declares the hole in words on every
 * report, and `gate-m4-evidence.ts` FAILS the gate if either the number or the
 * declaration goes missing — so nobody can read invariant 4's silence as
 * coverage, and the day the pool stops being empty the gate reds and forces
 * this arm to be re-reasoned. Real coverage is M5's transactions/waivers work
 * (F300's discharge); the `roster_add_drop` door itself is walked today by
 * pgTAP and by L.D6.2's `inseason-lock.spec.ts`, not from here.
 *
 * R950 (#278 review) CORRECTS WHAT STOOD HERE. This paragraph used to say the
 * `reconcileFindings` half at the bottom was "NOT vacuous … the only part of
 * this function that can currently fail", because `pool_mirror_broken` comes
 * from the reconcile library and that "runs over the real population". IT IS
 * DEAD FOR THE SAME REASON: reconcile builds its `poolState` from
 * `league_player_pool` (reconcile.ts:645-647) over the SAME leagues this run
 * seeded (`season-runner.ts` scopes `reconcileSeason` to `leagueIds`), so with
 * the table empty its first loop iterates nothing (:648) and its second fires
 * only on `state !== undefined && state !== 'rostered'`, which an empty map
 * never produces (:660-662). A season run cannot emit that finding at all, and
 * that false clause sat inside the string `gate-m4-evidence.ts` machine-checks
 * — restoring the very "silence reads as coverage" impression this withdrawal
 * exists to destroy, and inviting F300 to be closed on coverage that does not
 * exist. REAL coverage is where the paragraph above says it is: the
 * `roster_add_drop` door is walked by pgTAP and by L.D6.2's
 * `inseason-lock.spec.ts`; the mirror itself waits on M5's
 * transactions/waivers sim work (F300's discharge). Nothing in THIS function
 * can currently fail.
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
 *
 * THE WINDOW IS THE ORACLE'S OWN (R920 — PR #273 review). `points_for` is
 * summed by `league_standings_internal` over `r.week BETWEEN v_first AND
 * v_first + regular_season_weeks − 1 AND r.is_final` (118:641-643, 684-690).
 * This check previously summed every week whose `league_weeks.status` was
 * `final`, which is a WIDER window: a run driven past the regular season
 * (`--weeks ≥ 13` on a 12-week league) finalizes bracket weeks too, and every
 * bracket participant's PF then failed deterministically on a chain behaving
 * exactly to §11.7. So the window is bounded here to the oracle's, and the
 * row-level predicate is `team_week_results.is_final` — the same column the
 * oracle reads — rather than the week's status.
 */
export function checkPointsForOnce(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  // v_first: the league's own first week (110 maps completion onto week 1),
  // read from the SAME table the oracle reads it from.
  const first = a.weeks.length === 0 ? null : Math.min(...a.weeks.map((w) => w.week))
  if (first === null) return out
  const last = first + a.regularSeasonWeeks - 1
  const inWindow = (week: number): boolean => week >= first && week <= last
  const sums = new Map<string, number>()
  const pendings = new Map<string, number[]>()
  for (const r of a.results) {
    if (!inWindow(r.week) || !r.is_final) continue
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
          `team ${standing.team_id} has an is_final regular-season week with a NULL team_week_results.points ` +
            `(weeks ${pendingWeeks.join(', ')}; window ${first}-${last}) — a finalized week must carry a score, ` +
            `and PF cannot be checked against a pending cell (E61/§23.2)`,
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
            `is_final regular-season weeks ${first}-${last} = ${expected.toFixed(2)} — points are counted once per week ` +
            `regardless of median/second games (§11.7)`,
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
 *
 * ── D345 / F336: TAUGHT PROVENANCE, NEVER EXEMPTED ─────────────────────────
 * **There is no `if (m.is_overridden) continue` here and there must never be
 * one.** The paragraph above is the refusal: reconcile already excludes
 * overridden cells, so exempting them here too would leave NOTHING watching
 * an overridden final cell. Instead the cell carries a SEQUENCE of baselines
 * (`AuditFinalCell.baselines`) and the law is, per cell:
 *
 *   (a) `baselines[0]` is the at-finalize rendering, licensed by nobody;
 *   (b) every LATER baseline must be licensed by EXACTLY ONE
 *       `commissioner_actions` row, and that row's target must be THIS
 *       matchup (`target_type = 'matchup'`, `target_id = matchup_id`) — a
 *       missing row fails, a duplicated id fails, a row aimed at a different
 *       matchup fails, and one receipt cannot license two baselines. The row
 *       must ALSO be one of 126's two matchup verbs (`edit_score` /
 *       `set_result`) and its `after` must EQUAL the post-event cell's
 *       home / away / result, compared numerically (R1077);
 *   (c) a later baseline with `licensed_by = null` is DRIFT BETWEEN
 *       BASELINES — the cell was not byte-identical between the previous
 *       baseline and the instant just before the audited event — and fails;
 *   (d) the LAST baseline must be byte-identical to the run-end rendering.
 *
 * With no override, (a) + (d) are exactly yesterday's check; with one, every
 * byte of movement is accounted for or the sweep is red. Strictly stronger.
 */
export function checkFinalCellsImmutable(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const actionsById = new Map<string, AuditCommissionerAction[]>()
  for (const action of a.commissionerActions) {
    const list = actionsById.get(action.id) ?? []
    list.push(action)
    actionsById.set(action.id, list)
  }
  for (const cell of a.finalCells) {
    const where = `matchup ${cell.matchup_id}`
    const first = cell.baselines[0]
    if (first === undefined || first.licensed_by !== null || first.rendered !== cell.at_final) {
      out.push(
        fail(
          a,
          'final-cell-immutable',
          cell.week,
          `${where}: baselines[0] must be the at-finalize rendering with no licence (got ` +
            `${first === undefined ? 'no baseline at all' : `[${first.rendered}] licensed_by=${String(first.licensed_by)}`}; ` +
            `at finalize [${cell.at_final}]) — the provenance record itself is malformed (D345)`,
        ),
      )
      continue
    }
    const spent = new Set<string>()
    for (let i = 1; i < cell.baselines.length; i++) {
      const prior = cell.baselines[i - 1]!
      const next = cell.baselines[i]!
      if (next.licensed_by === null) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where} DRIFTED BETWEEN BASELINES: baseline ${i - 1} [${prior.rendered}] → [${next.rendered}] ` +
              `with no audited event between them — a later re-baseline cannot launder it (§23.4/D295(b); D345)`,
          ),
        )
        continue
      }
      // THE AUDIT-ROW REQUIREMENT (D345) — BEGIN. The L.E1.14 break probe
      // deletes this block and watches the "no audit row" and "different
      // matchup" pins redden by name.
      const licences = actionsById.get(next.licensed_by) ?? []
      if (licences.length !== 1) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where} was re-baselined [${prior.rendered}] → [${next.rendered}] under licence ${next.licensed_by}, ` +
              `but ${licences.length} commissioner_actions row(s) carry that id (exactly 1 required) — ` +
              `a final cell moved with NO audit row accounting for it (§12.12/§23.4; D345)`,
          ),
        )
        continue
      }
      const licence = licences[0]!
      if (licence.target_type !== 'matchup' || licence.target_id !== cell.matchup_id) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where} was re-baselined [${prior.rendered}] → [${next.rendered}] under licence ${next.licensed_by}, ` +
              `but that audit row targets ${String(licence.target_type)} ${String(licence.target_id)} — ` +
              `an override of a DIFFERENT target does not license this cell (D345)`,
          ),
        )
        continue
      }
      // THE AUDIT-ROW REQUIREMENT (D345) — END.
      if (spent.has(next.licensed_by)) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where}: licence ${next.licensed_by} is spent TWICE — one audit row accounts for exactly one baseline change (D345)`,
          ),
        )
        continue
      }
      // THE RECEIPT MUST SAY WHAT THE CELL NOW READS (R1077) — BEGIN. Binding
      // id + target alone let a licensed cell read ANYTHING: the receipt has
      // to be one of the two verbs that may move a final cell, and its `after`
      // has to EQUAL the post-event home/away/result.
      if (!FINAL_CELL_LICENSING_ACTION_TYPES.includes(licence.action_type)) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where} was re-baselined [${prior.rendered}] → [${next.rendered}] under licence ${next.licensed_by}, ` +
              `but that audit row's action_type is '${licence.action_type}' — only ` +
              `${FINAL_CELL_LICENSING_ACTION_TYPES.join(' / ')} (126:663) may move a final cell (R1077)`,
          ),
        )
        continue
      }
      const mismatch = afterMismatch(licence.after, next.rendered)
      if (mismatch !== null) {
        out.push(
          fail(
            a,
            'final-cell-immutable',
            cell.week,
            `${where} was re-baselined [${prior.rendered}] → [${next.rendered}] under licence ${next.licensed_by}, ` +
              `but the receipt's AFTER does not equal the cell — ${mismatch}. A receipt licenses the value it ` +
              `RECORDED, not whatever the cell reads next (§12.12; R1077)`,
          ),
        )
        continue
      }
      // THE RECEIPT MUST SAY WHAT THE CELL NOW READS (R1077) — END.
      spent.add(next.licensed_by)
    }
    const last = cell.baselines[cell.baselines.length - 1]!
    if (last.rendered === cell.at_end) continue
    out.push(
      fail(
        a,
        'final-cell-immutable',
        cell.week,
        `${where} changed after its ` +
          `${cell.baselines.length === 1 ? 'week went final' : `last audited baseline (licence ${String(last.licensed_by)})`}: ` +
          `at finalize [${cell.at_final}] → last baseline [${last.rendered}] → at run end [${cell.at_end}] (§23.4/D295(b))`,
      ),
    )
  }
  return out
}

// ── 7. Zero unhandled worker errors (§23.2) ────────────────────────────────

export function checkNoWorkerErrors(a: SeasonAudit): SeasonInvariantFailure[] {
  return a.workerErrors.map((line) => fail(a, 'zero-worker-errors', null, line))
}

// ── 8. Unmanaged seats are seated by the SERVER (§7.2.1(c); 125; F334/F335) ─

/**
 * `spec:185`: a seat with no manager has its "lineups auto-set". Until M6A
 * L.E1.14 the HARNESS did that (`seedLineups`' `manager ?? commishClient`
 * fallback — F335), so every synthetic run was green over a production gap
 * eleven seats wide. The harness no longer touches an unmanaged seat; this
 * check is what notices when the SERVER does not either.
 *
 * For every unmanaged seat and every driven week that has OPENED
 * (`status <> 'upcoming'`):
 *
 *   - a `team_lineups` row EXISTS (D354 — arm (c) materializes a seat that
 *     has none);
 *   - its starting map is NON-EMPTY whenever the roster could start anybody;
 *   - NO starting slot is empty while an eligible rostered player sits
 *     unstarted. That is a MAXIMALITY WITNESS, not a mirror of the matcher
 *     (D289/D33): an empty slot beside an eligible bench player is a
 *     length-one augmenting path, so no maximum matching leaves it — and
 *     nothing here says WHICH player should start where.
 *
 * THE ONE EXCUSE, and it needs ALL THREE halves: the league stores
 * `allow_illegal_lineups = false` (125 item 4c — a blocking designation or a
 * bye is a HARD filter on seating someone new), the tick's LATEST pass over
 * that team-week NAMED that slot in `autopilot_unfillable[]`, AND the reason
 * it gave is 125's "no healthy eligible player …; league forbids illegal
 * lineups" arm (`isForbidsIllegalReason` — R1076). The other two reasons
 * (locked out / nobody eligible) excuse nothing. A league that allows
 * illegal lineups has no excuse at all (125 seats the unhealthy tail LAST
 * rather than leave a zero), and a slot the server never named is never
 * excused — "nothing happened" is not "it worked".
 *
 * A seat that is empty because every candidate's game had already kicked off
 * FAILS here on purpose: the harness ticks at the week's open instant, before
 * any kickoff, so a locked-out seat in a sim run means the tick did not run
 * when it should have.
 *
 * KNOWN LIMIT (F376, measured): 125 tests a candidate's LOCK before his
 * health (`125:549-557`), so the slot it named "forbids illegal lineups" at
 * the week-open pass is re-worded "every candidate's game had kicked off" at
 * every pass after that kickoff — and the latest evaluating pass is the one
 * judged. An OFF league whose seat has a blocked ONLY-candidate is therefore
 * red here after kickoff. That world is F374's (the live pool's
 * `players.status` leaking into the sim); it is REPORTED, not excused.
 *
 * NO WITNESS IS NOT A PASS (R1078): an unmanaged seat with an EMPTY roster,
 * or one carrying a player whose position the audit could not resolve (`''`),
 * cannot produce a bench witness for any slot — so it FAILS by name instead
 * of walking through green.
 *
 * PREMISE (§4 rule 14(c)): over zero unmanaged SEAT-WEEKS this returns `[]`
 * having asserted nothing — zero seats, or seats whose every driven week is
 * still `upcoming` (R1079). `countUnmanagedSeatWeeksAsserted` is that count;
 * the RUNNER sums it and makes zero a run PROBLEM (`season-runner.ts`).
 */
export function checkUnmanagedSeatsAutopiloted(a: SeasonAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const openedWeeks = openedDrivenWeeks(a)
  // R1076: ONLY the "league forbids illegal lineups" arm is an excuse.
  const named = new Set(
    a.autopilotUnfillable.filter((u) => isForbidsIllegalReason(u.reason)).map((u) => `${u.team_id}|${u.week}|${u.slot}`),
  )
  const namedOtherwise = new Map(
    a.autopilotUnfillable
      .filter((u) => !isForbidsIllegalReason(u.reason))
      .map((u) => [`${u.team_id}|${u.week}|${u.slot}`, u.reason] as const),
  )
  for (const seat of a.unmanagedSeats) {
    const shapeNote =
      seat.shape === 'no_member_row'
        ? ' [this team has NO league_members row at all — arm (c) DECLINES such a seat by name (125, D339), so nothing will ever seat it]'
        : ''
    // R1078: a seat that can produce NO witness must not pass for want of one.
    const unresolved = seat.roster.filter((p) => p.position === '')
    if (openedWeeks.length > 0 && (seat.roster.length === 0 || unresolved.length > 0)) {
      out.push(
        fail(
          a,
          'unmanaged-seat-autopilot',
          openedWeeks[0]!,
          seat.roster.length === 0
            ? `unmanaged team ${seat.team_id} has an EMPTY roster — no bench witness can exist, so this invariant ` +
                `could assert nothing about the seat; an empty seat in a driven league is a harness fault, never a pass (R1078)${shapeNote}`
            : `unmanaged team ${seat.team_id} rosters player(s) with NO resolvable position ` +
                `(${unresolved.map((p) => p.player_id).join(', ')}) — they can witness no slot, so an empty slot beside ` +
                `them would pass unseen (R1078)${shapeNote}`,
        ),
      )
      continue
    }
    for (const week of openedWeeks) {
      const lineup = a.lineups.find((l) => l.team_id === seat.team_id && l.week === week)
      if (lineup === undefined) {
        out.push(
          fail(
            a,
            'unmanaged-seat-autopilot',
            week,
            `unmanaged team ${seat.team_id} has NO team_lineups row for week ${week} — the tick's arm (c) ` +
              `materializes and fills such a seat (125/D354)${shapeNote}`,
          ),
        )
        continue
      }
      const map = lineup.slot_map ?? {}
      const started = startersOfMap(lineup.slot_map, lineup.ir_keys)
      const held = new Set(Object.values(map).filter((v): v is string => typeof v === 'string'))
      const bench = seat.roster.filter((p) => !held.has(p.player_id))
      const shortfall: string[] = []
      for (const slot of a.startingSlots) {
        const occupant = map[slot.key]
        if (typeof occupant === 'string' && occupant.length > 0) continue
        const witnesses = bench.filter((p) => slot.eligible.includes(p.position))
        if (witnesses.length === 0) continue // nobody on the roster could take it — lawful; F288's run PROBLEM names the key
        if (!a.allowIllegalLineups && named.has(`${seat.team_id}|${week}|${slot.key}`)) continue
        const other = namedOtherwise.get(`${seat.team_id}|${week}|${slot.key}`)
        shortfall.push(
          `${slot.key} (eligible and unstarted: ${witnesses.map((p) => p.player_id).join(', ')}` +
            `${other === undefined ? '' : `; the tick named it with a reason that excuses NOTHING: "${other}"`})`,
        )
      }
      if (shortfall.length === 0) continue
      out.push(
        fail(
          a,
          'unmanaged-seat-autopilot',
          week,
          started.length === 0
            ? `unmanaged team ${seat.team_id} week ${week}: the starting map is EMPTY — nobody seated this seat, so it ` +
                `scores a zero (spec:185; F334). Unfilled: ${shortfall.join('; ')}${shapeNote}`
            : `unmanaged team ${seat.team_id} week ${week}: starting slot(s) left empty that the roster could fill — ` +
                `${shortfall.join('; ')}` +
                `${a.allowIllegalLineups ? '' : " — and the tick's latest pass never named them in autopilot_unfillable[] with the 'league forbids illegal lineups' reason"}${shapeNote}`,
        ),
      )
    }
  }
  return out
}

/** The driven weeks that have OPENED — the only weeks invariant 8 asserts on. */
export function openedDrivenWeeks(a: SeasonAudit): number[] {
  const driven = new Set(a.weeksDriven)
  return a.weeks.filter((w) => driven.has(w.week) && w.status !== 'upcoming').map((w) => w.week)
}

/** Invariant 8's premise: the (seat, week) pairs it actually asserts on. */
export function countUnmanagedSeatWeeksAsserted(a: SeasonAudit): number {
  return a.unmanagedSeats.length * openedDrivenWeeks(a).length
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
    ...checkUnmanagedSeatsAutopiloted(a),
  ]
}

/** The invariant names — L.D6.1's seven in the row's order, then M6A
 *  L.E1.14's eighth — the report's vocabulary. */
export const SEASON_INVARIANTS: readonly string[] = [
  'exclusivity',
  'lineup-legality',
  'standings-recompute',
  'pool-roster-mirror',
  'pf-once-per-week',
  'final-cell-immutable',
  'zero-worker-errors',
  'unmanaged-seat-autopilot',
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
