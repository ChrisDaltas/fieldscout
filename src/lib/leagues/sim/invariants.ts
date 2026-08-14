/**
 * Post-run invariant sweep — M2 task L.B6.1 item 3 (tasks-M2 §5 sketch
 * list; delivery plan §4.2 "assertions after every scenario").
 *
 * Every invariant is a PURE function over an audit snapshot (the runner
 * collects the rows; a service-role harness client performs those reads —
 * harness-only, recorded in the runner banner) and every failure NAMES its
 * draft — a sweep that says "something failed somewhere" is useless at 25
 * leagues. Each function is falsifiable alone (unit pins), and the sweep
 * as a whole is demonstrated falsifiable once in the task log (a
 * deliberately suppressed final pick → `board-complete` names the draft —
 * §4.3's break-probe floor).
 *
 * The sketch list (tasks-M2 §5):
 *   zero duplicate live picks per draft · every board complete
 *   (teams × total_rounds) · zero stuck clocks (grace-aware, D102) ·
 *   per-team pick count == total_rounds · league_rosters count == picks
 *   count · status == 'in_season' · zero unhandled worker errors.
 * Plus two E14-substance invariants at any size: pick numbers contiguous
 * 1..N (no dropped or duplicated turns) and the whole board matching the
 * stored order under the parity-pinned TS order mirror (D90 — one TS
 * implementation, `teamForPick`, already pinned against the SQL).
 */
import { roundForPick, teamForPick } from '@/components/draft/draft-order'

import type { InvariantFailure } from './sim-types'

export interface AuditPick {
  pick_number: number
  round: number
  team_id: string
  player_id: string
}

export interface AuditRoster {
  team_id: string
  player_id: string
}

/** Everything the sweep needs about one finished draft (collected by the
 *  runner's service-role harness reads — harness-only, recorded). */
export interface DraftAudit {
  leagueLabel: string
  draftId: string
  teamCount: number
  totalRounds: number
  draftOrder: readonly string[]
  snakeReversal: boolean
  /** Non-undone picks ordered by pick_number. */
  picks: readonly AuditPick[]
  rosters: readonly AuditRoster[]
  leagueStatus: string
  draftStatus: string
  workerErrors: readonly string[]
}

function fail(a: DraftAudit, invariant: string, detail: string): InvariantFailure {
  return { invariant, leagueLabel: a.leagueLabel, draftId: a.draftId, detail }
}

export function checkDraftComplete(a: DraftAudit): InvariantFailure[] {
  return a.draftStatus === 'complete'
    ? []
    : [fail(a, 'draft-complete', `draft status is '${a.draftStatus}', expected 'complete'`)]
}

export function checkNoDuplicatePlayers(a: DraftAudit): InvariantFailure[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const p of a.picks) {
    const prior = seen.get(p.player_id)
    if (prior !== undefined) dupes.push(`${p.player_id} at picks ${prior} and ${p.pick_number}`)
    else seen.set(p.player_id, p.pick_number)
  }
  return dupes.length === 0
    ? []
    : [fail(a, 'zero-duplicate-picks', `duplicate players: ${dupes.join('; ')}`)]
}

export function checkBoardComplete(a: DraftAudit): InvariantFailure[] {
  const expected = a.teamCount * a.totalRounds
  return a.picks.length === expected
    ? []
    : [
        fail(
          a,
          'board-complete',
          `${a.picks.length} live picks, expected ${a.teamCount} teams × ${a.totalRounds} rounds = ${expected}`,
        ),
      ]
}

/** E14 substance: no dropped or duplicated turns — pick numbers are exactly
 *  1..N in order. */
export function checkPickNumbersContiguous(a: DraftAudit): InvariantFailure[] {
  const bad: string[] = []
  a.picks.forEach((p, i) => {
    if (p.pick_number !== i + 1) bad.push(`slot ${i + 1} holds pick_number ${p.pick_number}`)
  })
  return bad.length === 0
    ? []
    : [fail(a, 'pick-numbers-contiguous', bad.slice(0, 5).join('; '))]
}

export function checkPerTeamCounts(a: DraftAudit): InvariantFailure[] {
  const byTeam = new Map<string, number>()
  for (const p of a.picks) byTeam.set(p.team_id, (byTeam.get(p.team_id) ?? 0) + 1)
  const bad: string[] = []
  for (const teamId of a.draftOrder) {
    const n = byTeam.get(teamId) ?? 0
    if (n !== a.totalRounds) bad.push(`team ${teamId} has ${n} picks, expected ${a.totalRounds}`)
  }
  if (byTeam.size !== a.teamCount) {
    bad.push(`${byTeam.size} distinct teams picked, expected ${a.teamCount}`)
  }
  return bad.length === 0 ? [] : [fail(a, 'per-team-counts', bad.join('; '))]
}

/** The whole board matches the stored order under the D90-parity TS mirror
 *  (snake / 3RR; the M2 sim matrix is snake-only). */
export function checkBoardOrder(a: DraftAudit): InvariantFailure[] {
  const bad: string[] = []
  for (const p of a.picks) {
    const expectedTeam = teamForPick(p.pick_number, a.draftOrder, 'snake', a.snakeReversal)
    if (expectedTeam !== p.team_id) {
      bad.push(`pick ${p.pick_number}: team ${p.team_id}, order math says ${expectedTeam}`)
    }
    const expectedRound = roundForPick(p.pick_number, a.teamCount)
    if (expectedRound !== p.round) {
      bad.push(`pick ${p.pick_number}: round ${p.round}, math says ${expectedRound}`)
    }
  }
  return bad.length === 0 ? [] : [fail(a, 'board-order', bad.slice(0, 5).join('; '))]
}

/** Completion txn integrity (072/D88): rosters ≡ non-undone picks. */
export function checkRostersMatchPicks(a: DraftAudit): InvariantFailure[] {
  const bad: string[] = []
  if (a.rosters.length !== a.picks.length) {
    bad.push(`${a.rosters.length} roster rows vs ${a.picks.length} picks`)
  }
  const pickSet = new Set(a.picks.map((p) => `${p.team_id}:${p.player_id}`))
  const rosterSet = new Set(a.rosters.map((r) => `${r.team_id}:${r.player_id}`))
  for (const key of pickSet) {
    if (!rosterSet.has(key)) bad.push(`picked but not rostered: ${key}`)
  }
  for (const key of rosterSet) {
    if (!pickSet.has(key)) bad.push(`rostered but never picked: ${key}`)
  }
  return bad.length === 0 ? [] : [fail(a, 'rosters-consistent', bad.slice(0, 5).join('; '))]
}

export function checkLeagueInSeason(a: DraftAudit): InvariantFailure[] {
  return a.leagueStatus === 'in_season'
    ? []
    : [fail(a, 'league-in-season', `league status is '${a.leagueStatus}', expected 'in_season'`)]
}

export function checkNoWorkerErrors(a: DraftAudit): InvariantFailure[] {
  return a.workerErrors.length === 0
    ? []
    : [fail(a, 'zero-worker-errors', a.workerErrors.slice(0, 3).join('; '))]
}

/** The full sweep for one draft. */
export function sweepAudit(a: DraftAudit): InvariantFailure[] {
  return [
    ...checkDraftComplete(a),
    ...checkNoDuplicatePlayers(a),
    ...checkBoardComplete(a),
    ...checkPickNumbersContiguous(a),
    ...checkPerTeamCounts(a),
    ...checkBoardOrder(a),
    ...checkRostersMatchPicks(a),
    ...checkLeagueInSeason(a),
    ...checkNoWorkerErrors(a),
  ]
}

// ---------------------------------------------------------------------------
// Stuck-clock invariant (grace-aware — D102; live watchdog, not post-run)
// ---------------------------------------------------------------------------

/** The tick cadence the stuck allowance absorbs (D87 — pg_cron every 5s). */
export const TICK_MS = 5_000
/** Slack over the tick for scheduler jitter + HTTP round-trips. */
export const EPSILON_MS = 3_000

export interface StuckClockInput {
  /** `drafts.current_deadline` in epoch ms; null = untimed/no clock. */
  deadlineMs: number | null
  /**
   * The D102 grace allowance for the ON-CLOCK seat: `disconnect_grace_seconds
   * × 1000` for a claimed human seat that is not autodraft (a STALE human's
   * pick is HELD open through grace); 0 for autodraft and no-user seats
   * (they autopick AT the deadline).
   */
  allowanceMs: number
  /**
   * The runner's latest driving/progress instant for this draft: when the
   * pick last advanced, or when the harness last rewound-and-ticked it.
   * Rewinds shove `current_deadline` deep into the past ON PURPOSE, so
   * overdue-ness is measured from whichever is LATER — the grace-adjusted
   * deadline or our own last action — else every harness rewind would read
   * as an instant stuck clock.
   */
  lastProgressMs: number
  nowMs: number
}

/** D102 grace-aware stuck detection: a clock is stuck only when it has been
 *  past `deadline + allowance` AND past our latest driving action by more
 *  than a tick + ε without advancing. */
export function isStuckClock(input: StuckClockInput): boolean {
  if (input.deadlineMs === null) return false
  const overdueFrom = Math.max(input.deadlineMs + input.allowanceMs, input.lastProgressMs)
  return input.nowMs > overdueFrom + TICK_MS + EPSILON_MS
}

// ---------------------------------------------------------------------------
// F54 detector (chaos double-tap queue replaces — observe + record)
// ---------------------------------------------------------------------------

/** Ranks that appear more than once in one seat's queue rows — the F54
 *  signature (two interleaved whole-queue replaces; 065 has no
 *  `(draft_id, team_id, rank)` unique and the L.B2.2 replace spans no
 *  transaction). */
export function duplicateQueueRanks(rows: ReadonlyArray<{ rank: number }>): number[] {
  const seen = new Set<number>()
  const dupes = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.rank)) dupes.add(row.rank)
    else seen.add(row.rank)
  }
  return [...dupes].sort((a, b) => a - b)
}
