/**
 * The TRANSACTION invariant sweep — M5 task L.D3.8 (tasks-M5-transactions.md
 * §6 L.D3.8; TD2 / TD3 / TD4; spec §13.1–§13.3, §12.2, §12.10, §12.19,
 * §7.2.1). The season sweep (`season-invariants.ts`) keeps its ten; a run with
 * `--transact` adds these four, and each is REPORTED WITH ITS POPULATION —
 * the task row's own words: "each invariant reported with its non-zero
 * population count". A population of 0 is a run PROBLEM (the runner raises
 * it), never a green:
 *
 *   T1 `transaction-exclusivity` — every player a transaction of this run
 *      moved is on exactly the roster the ACKNOWLEDGED operations put him on
 *      (the harness's own record of each 200 / settled run / executed trade /
 *      reversal, in issue order), and on at most one roster (spec §13.2
 *      "player exclusivity"; CLAUDE.md rule 7). The DB's UNIQUE(league_id,
 *      player_id) makes the "at most one" half structural (D267 — declared,
 *      not decorative); the "the RIGHT one" half is what a roster write with
 *      no transaction behind it breaks. Population: players moved.
 *   T2 `faab-ledger` — TD2's equation, per franchise:
 *        budget at draft start − Σ won bids ± Σ trade legs (and reversal
 *        legs) + Σ commissioner deltas = balance now.
 *      Every term is read from a RECEIPT the server wrote (TD2: "no new
 *      ledger table: every balance change writes a receipt"): a won claim's
 *      `transactions` row (`faab_before` / `faab_after`, and its `faab_bid`
 *      must equal the debit), a trade's `payload.faab[]` legs, a reversal's
 *      `payload.reversal.faab[]` legs, and `commissioner_actions`
 *      `edit_faab` before / after. A balance that moved with no receipt
 *      breaks it. Population: franchises whose ledger has >= 1 term.
 *   T3 pool ⇔ roster mirror — the season sweep's invariant 4
 *      (`checkPoolMirror`, unchanged); a transacting run gives it a NON-EMPTY
 *      pool for the first time (F300). Its population (pool rows by state) is
 *      counted here, and the runner requires both arms to be reached: >= 1
 *      `rostered` row and >= 1 row in a non-rostered state.
 *   T4 `claim-privacy` — no claim is visible to a non-owner (TD3 / TD4 / E13:
 *      "blind means blind, after processing too"). Read THROUGH EACH VIEWER'S
 *      OWN JWT (RLS is the thing under test): a non-commissioner sees only
 *      his own team's claims and sees ALL of them (the positive control —
 *      without it "sees nothing" would pass an RLS that hides everything); a
 *      commissioner sees every claim; a former member (the Ghost) sees none.
 *      Population: (viewer, other team's claim) pairs asserted hidden.
 *
 * And the Ghost's arm (F211; delivery plan §4.2 "vacate → orphan/autopilot
 * weeks → seat-invite claim → takeover"):
 *   G  `ghost-takeover` — the franchise's FAAB is carried through vacate and
 *      the seat claim (L.D2.6 / C72: "a team that spent $60 of $100 keeps $40
 *      through … vacate + re-claim"), the ghost's access is gone the instant
 *      he is vacated (he reads no claim and his submit is refused), the
 *      orphaned seat was seated by the SERVER while it had no manager (the
 *      tick named it in `autopiloted[]`), and the stint history reads ghost
 *      (closed) then successor (open).
 *
 * Every function is PURE over a snapshot the runner collected, and each is
 * falsifiable alone (`transaction-invariants.test.ts` breaks exactly one
 * field per invariant) as well as against the live chain (`--probe`, which
 * plants the matching fault in the sim's own league and must turn the run
 * RED by that invariant's name).
 */
import type { SeasonInvariantFailure } from './season-invariants'

export const TRANSACTION_INVARIANTS: readonly string[] = [
  'transaction-exclusivity',
  'faab-ledger',
  'claim-privacy',
  'ghost-takeover',
]

/** The four break probes `--probe` accepts — one per invariant (T1–T4). */
export const TRANSACTION_PROBES = ['exclusivity', 'faab-ledger', 'pool-mirror', 'claim-privacy'] as const
export type TransactionProbe = (typeof TRANSACTION_PROBES)[number]

/** A receipt row, as `transactions` stores it (the columns the ledger reads). */
export interface AuditTxn {
  id: string
  type: string
  status: string
  initiator_team_id: string | null
  payload: Record<string, unknown>
}

export interface AuditFaabLeg {
  amount: number
  from_team_id: string
  to_team_id: string
}

export interface AuditCommishFaabEdit {
  target_id: string
  before: number | null
  after: number | null
}

export interface AuditClaimRow {
  id: string
  team_id: string
  status: string
}

/** One viewer's read of `waiver_claims`, through his own client. */
export interface AuditClaimView {
  viewer: string
  /** The viewer's team in this league (membership truth), or null. */
  teamId: string | null
  /** commissioner / co_commissioner: sees every claim (TD4). */
  commissioner: boolean
  /** A former member (the Ghost, after vacate): must see nothing. */
  former: boolean
  visible: readonly AuditClaimRow[]
}

export interface AuditGhost {
  teamId: string
  ghostUserId: string
  successorUserId: string | null
  /** The franchise's won-claim spend before the ghost left (the premise). */
  spentBeforeVacate: number
  balanceAtVacate: number | null
  balanceAfterTakeover: number | null
  budget: number
  /** Rows the ghost's own JWT read from the league's claims after vacate. */
  ghostVisibleClaims: number
  /** The status the ghost's claim submit answered after vacate (403 wanted). */
  ghostSubmitStatus: number | null
  /** The week(s) the seat had no manager, and whether the tick named the
   *  seat in `autopiloted[]` for each. */
  orphanWeeks: ReadonlyArray<{ week: number; autopilotedByServer: boolean }>
  /** team_managers for the franchise, oldest first. */
  stints: ReadonlyArray<{ user_id: string | null; started_at: string; ended_at: string | null }>
  /** Why the arm did not complete, when it did not (a loud failure). */
  incomplete: string | null
}

export interface TransactionAudit {
  leagueLabel: string
  leagueId: string
  faabBudget: number
  /** league_members: team → faab_balance (seats with a team only). */
  balances: ReadonlyArray<{ team_id: string; faab_balance: number | null }>
  rosters: ReadonlyArray<{ team_id: string; player_id: string }>
  /** Every `transactions` row of the league. */
  txns: readonly AuditTxn[]
  commishFaabEdits: readonly AuditCommishFaabEdit[]
  /** The harness's own record: player → the team the acknowledged ops put
   *  him on (null = dropped / nobody), in issue order. */
  expectedHolder: ReadonlyMap<string, string | null>
  /** Every claim of the league (service read — the ground truth T4 compares
   *  each viewer's read against). */
  claims: readonly AuditClaimRow[]
  views: readonly AuditClaimView[]
  pool: ReadonlyArray<{ player_id: string; state: string }>
  ghost: AuditGhost | null
}

function fail(a: TransactionAudit, invariant: string, detail: string): SeasonInvariantFailure {
  return { invariant, leagueLabel: a.leagueLabel, leagueId: a.leagueId, week: null, detail }
}

// ── T1 ──────────────────────────────────────────────────────────────────────

export function checkTransactionExclusivity(a: TransactionAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const holders = new Map<string, string[]>()
  for (const r of a.rosters) holders.set(r.player_id, [...(holders.get(r.player_id) ?? []), r.team_id])
  for (const [playerId, teams] of holders) {
    if (teams.length > 1) {
      out.push(fail(a, 'transaction-exclusivity', `player ${playerId} is rostered by ${teams.length} teams (${teams.join(', ')})`))
    }
  }
  for (const [playerId, expected] of a.expectedHolder) {
    const actual = holders.get(playerId) ?? []
    if (expected === null) {
      if (actual.length > 0) {
        out.push(
          fail(
            a,
            'transaction-exclusivity',
            `player ${playerId} was DROPPED by an acknowledged transaction but team ${actual.join(', ')} rosters him — a roster write no receipt explains`,
          ),
        )
      }
      continue
    }
    if (actual.length !== 1 || actual[0] !== expected) {
      out.push(
        fail(
          a,
          'transaction-exclusivity',
          `player ${playerId}: the acknowledged transactions put him on team ${expected}, but the rosters hold him on ` +
            `${actual.length === 0 ? 'NO roster' : actual.join(', ')}`,
        ),
      )
    }
  }
  return out
}

/** T1's population: players the run's acknowledged transactions moved. */
export function exclusivityPopulation(a: TransactionAudit): number {
  return a.expectedHolder.size
}

// ── T2 ──────────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function legsOf(raw: unknown): AuditFaabLeg[] {
  if (!Array.isArray(raw)) return []
  const out: AuditFaabLeg[] = []
  for (const leg of raw) {
    const l = leg as Record<string, unknown>
    const amount = num(l.amount)
    if (amount === null || typeof l.from_team_id !== 'string' || typeof l.to_team_id !== 'string') continue
    out.push({ amount, from_team_id: l.from_team_id, to_team_id: l.to_team_id })
  }
  return out
}

export interface FaabLedgerTerm {
  team_id: string
  kind: 'won_claim' | 'trade_leg' | 'reversal_leg' | 'commissioner_edit'
  delta: number
  receipt: string
}

/** Every FAAB movement a RECEIPT records, per franchise (TD2's terms). */
export function faabLedgerTerms(a: TransactionAudit): { terms: FaabLedgerTerm[]; receiptErrors: string[] } {
  const terms: FaabLedgerTerm[] = []
  const receiptErrors: string[] = []
  for (const t of a.txns) {
    if (t.status !== 'complete') continue
    if (t.type === 'waiver_claim') {
      const before = num(t.payload.faab_before)
      const after = num(t.payload.faab_after)
      const bid = num(t.payload.faab_bid) ?? 0
      if (t.initiator_team_id === null) {
        receiptErrors.push(`waiver_claim receipt ${t.id} names no initiator team`)
        continue
      }
      if (before === null || after === null) {
        if (bid !== 0) receiptErrors.push(`waiver_claim receipt ${t.id} carries a $${bid} bid but no faab_before / faab_after`)
        continue
      }
      if (before - after !== bid) {
        receiptErrors.push(`waiver_claim receipt ${t.id}: faab_before ${before} − faab_after ${after} ≠ faab_bid ${bid}`)
      }
      if (after !== before) terms.push({ team_id: t.initiator_team_id, kind: 'won_claim', delta: after - before, receipt: t.id })
    } else if (t.type === 'trade') {
      for (const leg of legsOf(t.payload.faab)) {
        terms.push({ team_id: leg.from_team_id, kind: 'trade_leg', delta: -leg.amount, receipt: t.id })
        terms.push({ team_id: leg.to_team_id, kind: 'trade_leg', delta: leg.amount, receipt: t.id })
      }
    } else if (t.type === 'commissioner_move' && t.payload.kind === 'trade_reversal') {
      const reversal = (t.payload.reversal ?? {}) as Record<string, unknown>
      for (const leg of legsOf(reversal.faab)) {
        terms.push({ team_id: leg.from_team_id, kind: 'reversal_leg', delta: -leg.amount, receipt: t.id })
        terms.push({ team_id: leg.to_team_id, kind: 'reversal_leg', delta: leg.amount, receipt: t.id })
      }
    }
  }
  for (const e of a.commishFaabEdits) {
    if (e.before === null || e.after === null) {
      receiptErrors.push(`commissioner edit_faab on team ${e.target_id} carries before ${e.before} / after ${e.after}`)
      continue
    }
    if (e.after !== e.before) terms.push({ team_id: e.target_id, kind: 'commissioner_edit', delta: e.after - e.before, receipt: 'commissioner_actions' })
  }
  return { terms, receiptErrors }
}

export function checkFaabLedger(a: TransactionAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const { terms, receiptErrors } = faabLedgerTerms(a)
  for (const e of receiptErrors) out.push(fail(a, 'faab-ledger', e))
  const net = new Map<string, number>()
  for (const t of terms) net.set(t.team_id, (net.get(t.team_id) ?? 0) + t.delta)
  const seated = new Set(a.balances.map((b) => b.team_id))
  for (const teamId of net.keys()) {
    if (!seated.has(teamId)) out.push(fail(a, 'faab-ledger', `a receipt moves FAAB for team ${teamId}, which holds no seat in this league`))
  }
  for (const b of a.balances) {
    if (b.faab_balance === null) {
      out.push(fail(a, 'faab-ledger', `team ${b.team_id}'s seat holds a NULL balance in a league with a $${a.faabBudget} budget (§12.2)`))
      continue
    }
    if (b.faab_balance < 0) out.push(fail(a, 'faab-ledger', `team ${b.team_id} holds a NEGATIVE balance ($${b.faab_balance})`))
    const expected = a.faabBudget + (net.get(b.team_id) ?? 0)
    if (b.faab_balance !== expected) {
      out.push(
        fail(
          a,
          'faab-ledger',
          `team ${b.team_id}: budget $${a.faabBudget} ${(net.get(b.team_id) ?? 0) >= 0 ? '+' : '−'} ` +
            `$${Math.abs(net.get(b.team_id) ?? 0)} of receipted movement = $${expected}, but the seat holds $${b.faab_balance} ` +
            `— a balance changed with no receipt behind it (TD2)`,
        ),
      )
    }
  }
  return out
}

export function faabLedgerPopulation(a: TransactionAudit): {
  teams: number
  byKind: Record<FaabLedgerTerm['kind'], number>
} {
  const { terms } = faabLedgerTerms(a)
  const byKind: Record<FaabLedgerTerm['kind'], number> = { won_claim: 0, trade_leg: 0, reversal_leg: 0, commissioner_edit: 0 }
  for (const t of terms) byKind[t.kind] += 1
  return { teams: new Set(terms.map((t) => t.team_id)).size, byKind }
}

// ── T3 (population only — the check is invariant 4) ─────────────────────────

export function poolPopulation(a: TransactionAudit): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of a.pool) out[r.state] = (out[r.state] ?? 0) + 1
  return out
}

// ── T4 ──────────────────────────────────────────────────────────────────────

export function checkClaimPrivacy(a: TransactionAudit): SeasonInvariantFailure[] {
  const out: SeasonInvariantFailure[] = []
  const truth = new Map(a.claims.map((c) => [c.id, c]))
  for (const v of a.views) {
    const seen = new Set(v.visible.map((c) => c.id))
    for (const row of v.visible) {
      const real = truth.get(row.id)
      if (real === undefined) {
        out.push(fail(a, 'claim-privacy', `${v.viewer} read claim ${row.id}, which is not a claim of this league`))
        continue
      }
      if (v.former) {
        out.push(fail(a, 'claim-privacy', `${v.viewer} is no longer in the league but still reads claim ${row.id} (team ${real.team_id})`))
        continue
      }
      if (!v.commissioner && real.team_id !== v.teamId) {
        out.push(
          fail(
            a,
            'claim-privacy',
            `${v.viewer} (team ${v.teamId ?? 'none'}) reads team ${real.team_id}'s ${real.status} claim ${row.id} — a blind bid is visible to a non-owner (TD3 / E13)`,
          ),
        )
      }
    }
    if (v.former) continue
    // The positive control: the rows this viewer MUST see are all there.
    for (const c of a.claims) {
      const owed = v.commissioner || c.team_id === v.teamId
      if (owed && !seen.has(c.id)) {
        out.push(
          fail(
            a,
            'claim-privacy',
            `${v.viewer} ${v.commissioner ? '(commissioner)' : `(team ${v.teamId})`} cannot read ${c.team_id === v.teamId ? 'his OWN' : "a league"} ` +
              `${c.status} claim ${c.id} — the read hides what it must show, so "sees nothing" would prove nothing`,
          ),
        )
      }
    }
  }
  return out
}

export function claimPrivacyPopulation(a: TransactionAudit): {
  hiddenPairs: number
  ownVisible: number
  commissionerVisible: number
  formerViewers: number
  lost: number
} {
  let hiddenPairs = 0
  let ownVisible = 0
  let commissionerVisible = 0
  let formerViewers = 0
  for (const v of a.views) {
    if (v.former) {
      formerViewers += 1
      hiddenPairs += a.claims.length
      continue
    }
    if (v.commissioner) {
      commissionerVisible += v.visible.length
      continue
    }
    hiddenPairs += a.claims.filter((c) => c.team_id !== v.teamId).length
    ownVisible += v.visible.filter((c) => c.team_id === v.teamId).length
  }
  return { hiddenPairs, ownVisible, commissionerVisible, formerViewers, lost: a.claims.filter((c) => c.status === 'lost').length }
}

// ── G ───────────────────────────────────────────────────────────────────────

export function checkGhostTakeover(a: TransactionAudit): SeasonInvariantFailure[] {
  const g = a.ghost
  if (g === null) return []
  const out: SeasonInvariantFailure[] = []
  if (g.incomplete !== null) {
    out.push(fail(a, 'ghost-takeover', `the Ghost's lifecycle did not complete on team ${g.teamId}: ${g.incomplete}`))
    return out
  }
  if (g.spentBeforeVacate <= 0) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId} spent $${g.spentBeforeVacate} before the ghost left — the carry arm has nothing to carry`))
  }
  const owed = g.budget - g.spentBeforeVacate
  if (g.balanceAtVacate !== owed) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId} held $${g.balanceAtVacate} at the vacate, expected budget $${g.budget} − spent $${g.spentBeforeVacate} = $${owed}`))
  }
  if (g.balanceAfterTakeover !== g.balanceAtVacate) {
    out.push(
      fail(
        a,
        'ghost-takeover',
        `team ${g.teamId}'s FAAB was NOT carried through vacate → seat claim: $${g.balanceAtVacate} at the vacate, $${g.balanceAfterTakeover} after the takeover (L.D2.6 / C72)`,
      ),
    )
  }
  if (g.ghostVisibleClaims !== 0) {
    out.push(fail(a, 'ghost-takeover', `the ghost still reads ${g.ghostVisibleClaims} claim(s) of the league after being vacated — access was not revoked`))
  }
  if (g.ghostSubmitStatus !== 403) {
    out.push(fail(a, 'ghost-takeover', `the ghost's claim for his old team answered ${g.ghostSubmitStatus} after the vacate — expected 403 (no longer its manager)`))
  }
  if (g.orphanWeeks.length === 0) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId} spent no driven week unmanaged — the orphan arm was never exercised`))
  }
  // The week the seat was orphaned INTO has no lineup until the tick writes
  // one (the draft seeds none), so arm (c) must have WRITTEN it — named in
  // `autopiloted[]`. A later orphan week inherits it by the carry (D293) and
  // the tick lawfully finds nothing to write, so only the first is demanded.
  // (Invariant 8 judges the seat's slot fill; this names the orphan arm.)
  if (g.orphanWeeks.length > 0 && !g.orphanWeeks[0]!.autopilotedByServer) {
    out.push(
      fail(
        a,
        'ghost-takeover',
        `team ${g.teamId} had no manager in week ${g.orphanWeeks[0]!.week}, but no tick named it in autopiloted[] — the orphaned seat was not seated by the server (§7.2.1(c))`,
      ),
    )
  }
  const ghostStint = g.stints.find((s) => s.user_id === g.ghostUserId)
  const successorStint = g.stints.find((s) => s.user_id === g.successorUserId)
  if (ghostStint === undefined || ghostStint.ended_at === null) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId}'s stint history has no CLOSED stint for the ghost (${JSON.stringify(g.stints)})`))
  }
  if (successorStint === undefined || successorStint.ended_at !== null) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId}'s stint history has no OPEN stint for the successor (${JSON.stringify(g.stints)})`))
  }
  if (
    ghostStint !== undefined &&
    ghostStint.ended_at !== null &&
    successorStint !== undefined &&
    Date.parse(successorStint.started_at) < Date.parse(ghostStint.ended_at)
  ) {
    out.push(fail(a, 'ghost-takeover', `team ${g.teamId}'s successor stint starts before the ghost's closed — two managers at once`))
  }
  return out
}

export function sweepTransactionAudit(a: TransactionAudit): SeasonInvariantFailure[] {
  return [...checkTransactionExclusivity(a), ...checkFaabLedger(a), ...checkClaimPrivacy(a), ...checkGhostTakeover(a)]
}
