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
// Auction sweep — L.C4.1 (spec §8.6.7–8.6.9; tasks-M3 §5 invariant list).
// Same shape as the snake sweep: pure functions over an audit snapshot,
// every failure names its draft, each function falsifiable alone (unit
// pins in invariants.test.ts) and the sweep demonstrated falsifiable once
// against a live planted engine bug (the task-log psql probe).
// ---------------------------------------------------------------------------

/** One pick row of an auction board (round is NULL there — D126). */
export interface AuctionAuditPick {
  pick_number: number
  team_id: string
  player_id: string
  price: number | null
  is_undone: boolean
}

export interface AuctionAuditBid {
  nomination_seq: number
  team_id: string
  player_id: string
  amount: number
}

/** `draft_team_budget`'s four columns for one franchise, read at audit time
 *  by the service-role harness (the fn is REVOKEd from authenticated). */
export interface AuctionAuditBudget {
  team_id: string
  remaining: number
  open_slots: number
  max_bid: number
  committed: number
}

export interface AuctionDraftAudit {
  leagueLabel: string
  draftId: string
  teamCount: number
  /** The per-team roster capacity (D91/D126 — `drafts.total_rounds`). */
  totalRounds: number
  budget: number
  /** The §8.6.1 per-slot reserve — 0 with $0 nominations ON, else 1. */
  reserve: 0 | 1
  budgetAdjustments: Readonly<Record<string, number>>
  /** EVERY pick row, undone included, ordered by pick_number. */
  picks: readonly AuctionAuditPick[]
  bids: readonly AuctionAuditBid[]
  /** SQL truth per active franchise (the parity oracle). */
  sqlBudgets: readonly AuctionAuditBudget[]
  rosters: readonly AuditRoster[]
  /** Manual nomination order pin: what the runner SET vs what `draft_start`
   *  hydrated (null when the league planned `same_as_draft_order`). */
  nominationOrderPin: { expected: readonly string[]; stored: readonly string[] } | null
  leagueStatus: string
  draftStatus: string
  workerErrors: readonly string[]
}

function afail(a: AuctionDraftAudit, invariant: string, detail: string): InvariantFailure {
  return { invariant, leagueLabel: a.leagueLabel, draftId: a.draftId, detail }
}

function livePicks(a: AuctionDraftAudit): AuctionAuditPick[] {
  return a.picks.filter((p) => !p.is_undone)
}

export function checkAuctionComplete(a: AuctionDraftAudit): InvariantFailure[] {
  const out: InvariantFailure[] = []
  if (a.draftStatus !== 'complete') {
    out.push(afail(a, 'auction-draft-complete', `draft status is '${a.draftStatus}', expected 'complete'`))
  }
  if (a.leagueStatus !== 'in_season') {
    out.push(afail(a, 'auction-league-in-season', `league status is '${a.leagueStatus}', expected 'in_season'`))
  }
  return out
}

/** Every roster full and legal by count (§8.6.6/§18 Phase C: "every team
 *  completes a legal roster") — live picks per team == capacity, exactly. */
export function checkAuctionBoardComplete(a: AuctionDraftAudit): InvariantFailure[] {
  const live = livePicks(a)
  const bad: string[] = []
  const byTeam = new Map<string, number>()
  for (const p of live) byTeam.set(p.team_id, (byTeam.get(p.team_id) ?? 0) + 1)
  for (const [teamId, n] of byTeam) {
    if (n !== a.totalRounds) bad.push(`team ${teamId} holds ${n} players, capacity ${a.totalRounds}`)
  }
  if (byTeam.size !== a.teamCount) bad.push(`${byTeam.size} teams bought players, expected ${a.teamCount}`)
  if (live.length !== a.teamCount * a.totalRounds) {
    bad.push(`${live.length} live picks vs ${a.teamCount} × ${a.totalRounds}`)
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-board-complete', bad.slice(0, 5).join('; '))]
}

export function checkAuctionNoDuplicatePlayers(a: AuctionDraftAudit): InvariantFailure[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const p of livePicks(a)) {
    const prior = seen.get(p.player_id)
    if (prior !== undefined) dupes.push(`${p.player_id} at picks ${prior} and ${p.pick_number}`)
    else seen.set(p.player_id, p.pick_number)
  }
  return dupes.length === 0
    ? []
    : [afail(a, 'auction-zero-duplicate-players', `duplicate players: ${dupes.join('; ')}`)]
}

/** Nomination sequence integrity: pick_numbers strictly increasing and
 *  unique across ALL rows (undone included — a reversal never reuses its
 *  sequence number; renominations take fresh ones). */
export function checkAuctionSequenceOrdered(a: AuctionDraftAudit): InvariantFailure[] {
  const bad: string[] = []
  for (let i = 1; i < a.picks.length; i++) {
    if (a.picks[i]!.pick_number <= a.picks[i - 1]!.pick_number) {
      bad.push(`pick_number ${a.picks[i]!.pick_number} follows ${a.picks[i - 1]!.pick_number}`)
    }
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-sequence-ordered', bad.slice(0, 5).join('; '))]
}

/**
 * THE §8.6.8 INVARIANT, recomputed in TS from raw rows (never trusting the
 * SQL it audits): for every franchise,
 *   `budget + adjustment − Σ price(live picks) ≥ open_slots × reserve`.
 * At a complete board open_slots is 0 and the floor is `remaining ≥ 0` in
 * both reserve columns; mid-board samples ride the runner's live
 * `draft_auction_solvent` oracle (counted, failures recorded as their own
 * invariant rows).
 */
export function checkAuctionSolvency(a: AuctionDraftAudit): InvariantFailure[] {
  const bad: string[] = []
  // The empty-set trap, loud (CLAUDE.md "nothing happened ≠ it worked"; the
  // 092 bool_and-over-zero-rows precedent): a sweep over zero franchises
  // would pass vacuously, so the team-set size is itself the first check.
  if (a.sqlBudgets.length !== a.teamCount) {
    bad.push(`${a.sqlBudgets.length} franchise budget rows collected, expected ${a.teamCount}`)
  }
  const committed = new Map<string, { spent: number; count: number }>()
  for (const p of livePicks(a)) {
    const c = committed.get(p.team_id) ?? { spent: 0, count: 0 }
    c.spent += p.price ?? 0
    c.count += 1
    committed.set(p.team_id, c)
  }
  for (const b of a.sqlBudgets) {
    const c = committed.get(b.team_id) ?? { spent: 0, count: 0 }
    const remaining = a.budget + (a.budgetAdjustments[b.team_id] ?? 0) - c.spent
    const openSlots = a.totalRounds - c.count
    if (remaining < openSlots * a.reserve) {
      bad.push(
        `team ${b.team_id}: remaining ${remaining} < ${openSlots} open slots × $${a.reserve} reserve`,
      )
    }
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-solvency', bad.slice(0, 5).join('; '))]
}

/** TS recompute ≡ SQL `draft_team_budget`, all four columns, every team —
 *  budget conservation EXACT (committed + remaining = budget + adjustment)
 *  falls out of the same comparison. */
export function checkAuctionBudgetParity(a: AuctionDraftAudit): InvariantFailure[] {
  const bad: string[] = []
  const byTeam = new Map<string, { spent: number; count: number }>()
  for (const p of livePicks(a)) {
    const c = byTeam.get(p.team_id) ?? { spent: 0, count: 0 }
    c.spent += p.price ?? 0
    c.count += 1
    byTeam.set(p.team_id, c)
  }
  for (const b of a.sqlBudgets) {
    const c = byTeam.get(b.team_id) ?? { spent: 0, count: 0 }
    const adjustment = a.budgetAdjustments[b.team_id] ?? 0
    const remaining = a.budget + adjustment - c.spent
    const openSlots = a.totalRounds - c.count
    const maxBid = openSlots <= 0 ? 0 : remaining - (openSlots - 1) * a.reserve
    if (
      b.remaining !== remaining ||
      b.open_slots !== openSlots ||
      b.max_bid !== maxBid ||
      b.committed !== c.spent
    ) {
      bad.push(
        `team ${b.team_id}: SQL (${b.remaining}, ${b.open_slots}, ${b.max_bid}, ${b.committed}) ` +
          `vs TS (${remaining}, ${openSlots}, ${maxBid}, ${c.spent})`,
      )
    }
    if (b.committed + b.remaining !== a.budget + adjustment) {
      bad.push(
        `team ${b.team_id}: conservation broken — committed ${b.committed} + remaining ${b.remaining} ≠ ` +
          `budget ${a.budget} + adjustment ${adjustment}`,
      )
    }
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-budget-parity', bad.slice(0, 5).join('; '))]
}

/** Every live price respects the nomination floor and is a whole non-negative
 *  dollar amount; $0 awards exist only in the $0-nominations column. */
export function checkAuctionPriceFloor(a: AuctionDraftAudit): InvariantFailure[] {
  const bad: string[] = []
  for (const p of livePicks(a)) {
    const price = p.price
    if (price === null || !Number.isInteger(price) || price < a.reserve) {
      bad.push(`pick ${p.pick_number}: price ${price ?? 'NULL'} below the $${a.reserve} floor`)
    }
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-price-floor', bad.slice(0, 5).join('; '))]
}

/**
 * §12.5's uniform history: every live award's price and winner match the
 * TOP bid of its own nomination sequence. Presumes no cancelled
 * nominations (D143 voids merge bids under a reused sequence — pgTAP 035
 * §K owns that disambiguation; the sim never cancels).
 */
export function checkAuctionBidsConsistent(a: AuctionDraftAudit): InvariantFailure[] {
  const topBySeq = new Map<number, AuctionAuditBid>()
  for (const b of a.bids) {
    const top = topBySeq.get(b.nomination_seq)
    if (top === undefined || b.amount > top.amount) topBySeq.set(b.nomination_seq, b)
  }
  const bad: string[] = []
  for (const p of livePicks(a)) {
    const top = topBySeq.get(p.pick_number)
    if (top === undefined) {
      bad.push(`pick ${p.pick_number}: no bid rows for its nomination`)
      continue
    }
    if (top.amount !== (p.price ?? -1) || top.team_id !== p.team_id || top.player_id !== p.player_id) {
      bad.push(
        `pick ${p.pick_number}: awarded (${p.team_id}, $${p.price}) but the top bid is ` +
          `(${top.team_id}, $${top.amount}) on ${top.player_id}`,
      )
    }
  }
  return bad.length === 0 ? [] : [afail(a, 'auction-bids-consistent', bad.slice(0, 5).join('; '))]
}

/** Completion txn integrity (072/D88, auction edition): rosters ≡ live picks. */
export function checkAuctionRostersMatchPicks(a: AuctionDraftAudit): InvariantFailure[] {
  const live = livePicks(a)
  const bad: string[] = []
  if (a.rosters.length !== live.length) {
    bad.push(`${a.rosters.length} roster rows vs ${live.length} live picks`)
  }
  const pickSet = new Set(live.map((p) => `${p.team_id}:${p.player_id}`))
  const rosterSet = new Set(a.rosters.map((r) => `${r.team_id}:${r.player_id}`))
  for (const key of pickSet) if (!rosterSet.has(key)) bad.push(`bought but not rostered: ${key}`)
  for (const key of rosterSet) if (!pickSet.has(key)) bad.push(`rostered but never bought: ${key}`)
  return bad.length === 0 ? [] : [afail(a, 'auction-rosters-consistent', bad.slice(0, 5).join('; '))]
}

/** 098's manual nomination order: what the commissioner SET is what
 *  `draft_start` hydrated, byte for byte. */
export function checkNominationOrderPinned(a: AuctionDraftAudit): InvariantFailure[] {
  if (a.nominationOrderPin === null) return []
  const { expected, stored } = a.nominationOrderPin
  const same = expected.length === stored.length && expected.every((id, i) => id === stored[i])
  return same
    ? []
    : [
        afail(
          a,
          'auction-nomination-order-pinned',
          `set [${expected.join(', ')}] but drafts.nomination_order holds [${stored.join(', ')}]`,
        ),
      ]
}

export function checkAuctionNoWorkerErrors(a: AuctionDraftAudit): InvariantFailure[] {
  return a.workerErrors.length === 0
    ? []
    : [afail(a, 'auction-zero-worker-errors', a.workerErrors.slice(0, 3).join('; '))]
}

/** The full auction sweep for one finished draft. */
export function sweepAuctionAudit(a: AuctionDraftAudit): InvariantFailure[] {
  return [
    ...checkAuctionComplete(a),
    ...checkAuctionBoardComplete(a),
    ...checkAuctionNoDuplicatePlayers(a),
    ...checkAuctionSequenceOrdered(a),
    ...checkAuctionSolvency(a),
    ...checkAuctionBudgetParity(a),
    ...checkAuctionPriceFloor(a),
    ...checkAuctionBidsConsistent(a),
    ...checkAuctionRostersMatchPicks(a),
    ...checkNominationOrderPinned(a),
    ...checkAuctionNoWorkerErrors(a),
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
