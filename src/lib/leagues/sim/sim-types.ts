/**
 * League Simulator shared types — M2 task L.B6.1 (delivery plan §4.2;
 * tasks-M2 §5 sim sketch; D100).
 *
 * Everything in `src/lib/leagues/sim/` is pure orchestration under the
 * repo's determinism guard (.eslintrc — no wall-clock, no Math.random):
 * time arrives through the injected `SimClock` and entropy through a
 * seeded mulberry32 stream (stats/synthetic/prng.ts — the one PRNG
 * implementation). The CLI boundary (`scripts/sim.ts`, OUTSIDE the guard)
 * supplies both.
 */

/** The four M2 personas (plan §4.2; tasks-M2 §5). The Ghost is M4's
 *  (in-season) — deliberately absent here. */
export type PersonaKind = 'queue-drafter' | 'adp-drafter' | 'afk' | 'chaos'

/**
 * The five M3 auction personas (L.C4.1; tasks-M3 §5 sim sketch; delivery
 * plan §4.2 "sniper who bids at T-1s"):
 *   - `value-bidder`   — seeded per-player dollar values (ADP-rank shaped,
 *     the D132 family curve); raises while `high_bid + 1 ≤ min(value,
 *     max_bid)`, with seeded JUMP bids within value (v2.13 §8.8's two
 *     textures — the nibble and the jump);
 *   - `sniper`         — bids only inside the anti-snipe window; the runner
 *     stages the T-1s instant with a service-role deadline rewind (harness
 *     move, D100) and asserts the clock re-floors (§8.6.3/D128);
 *   - `budget-hoarder` — sits out early markets, hoards cash; the endgame
 *     max-bid clamp (§8.6.7(d)) is what its pile runs into;
 *   - `afk`            — never nominates or bids: every one of its turns is
 *     the §8.6.2 timeout system-nomination and the no-raise award to the
 *     nominator (§8.6.7(b));
 *   - `chaos`          — E2 double-taps bids (same action_id twice → the
 *     same row), fires STALE-identity bids (a previous `nomination_seq` —
 *     the F64 refusal), and over-max bids (the E5 refusal); refusals must
 *     change nothing.
 */
export type AuctionPersonaKind =
  | 'value-bidder'
  | 'sniper'
  | 'budget-hoarder'
  | 'afk'
  | 'chaos'

export type SimDraftType = 'snake' | 'auction'

/** v1 legal sizes (§7.3.8; 040's CHECK — {8,10,12,14,16}). */
export const LEGAL_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
export type LegalTeamCount = (typeof LEGAL_TEAM_COUNTS)[number]

/** One human bot seat in a league: which pool bot mans it, playing what. */
export interface SeatPlan {
  /** Index into the run's bot-user pool. Seat 0's bot is the commissioner. */
  botIndex: number
  persona: PersonaKind
  /** Auction runs seat auction personas instead (`persona` is unused there —
   *  one SeatPlan shape, two matrices, so the runner's seat plumbing is
   *  shared). */
  auctionPersona?: AuctionPersonaKind
}

/** One league of the run matrix (derived deterministically from the seed). */
export interface LeaguePlan {
  index: number
  /** League name — carries the run prefix so cleanup can sweep by name. */
  name: string
  teamCount: LegalTeamCount
  /** Draftable rounds (D91: starters + bench of the compact roster preset).
   *  In an auction this IS the per-team roster capacity (D126). */
  rounds: number
  snakeReversal: boolean
  /** Human seats (seat 0 = commissioner). The rest are placeholder seats. */
  humanSeats: SeatPlan[]
  placeholderCount: number
  /** The all-timeout league (every human seat afk — the gate's requirement). */
  allAfk: boolean
  /** Auction-only knobs (undefined on a snake plan). */
  auction?: AuctionLeaguePlan
}

/** The auction matrix axes L.C4.1 must cover at head (the five-lane rule in
 *  the task charter): BOTH reserve columns (092's $0-nomination toggle),
 *  seeded budgets, and ≥1 manual nomination order (098/AP.5). */
export interface AuctionLeaguePlan {
  /** `auction_zero_dollar_nominations` — reserve $0 (ON) vs $1 (OFF). The
   *  plan guarantees BOTH columns appear whenever the run has ≥2 leagues. */
  zeroDollarNominations: boolean
  /** Seeded from the plan's catalog — [50, 100, 200] (`AUCTION_BUDGET_CHOICES`,
   *  plan.ts) — small budgets make the §8.6.7 endgame clamps bind early, big
   *  ones exercise jump-bids. (R562: this line once said "50..300", which no
   *  code ever drew from.) */
  budget: number
  /** ≥1 'manual' league per multi-league run (098's hydration path); the
   *  runner sets the permutation through the real settings write and the
   *  sweep pins `drafts.nomination_order` against it. */
  nominationOrderMode: 'same_as_draft_order' | 'manual'
  /** Mid-draft commissioner traffic (E28/E69 arms) runs in this league. */
  commishEdits: boolean
}

export interface RunPlan {
  seed: number
  draftType: SimDraftType
  clockSeconds: number
  leagues: LeaguePlan[]
  /** Distinct pool bots the plan references (runner provisions exactly these). */
  botCount: number
}

/** Injected clock (the guard's TimeProvider discipline applied to the sim —
 *  wall time and timers only ever enter through this seam). */
export interface SimClock {
  nowMs(): number
  sleep(ms: number): Promise<void>
}

// ---------------------------------------------------------------------------
// Run report
// ---------------------------------------------------------------------------

export interface InvariantFailure {
  invariant: string
  leagueLabel: string
  draftId: string
  detail: string
}

/** One observed F54 interleave (chaos double-tap queue replace) — evidence
 *  rows recorded verbatim for the ledger (observe + record, never fix here). */
export interface QueueInterleaveIncident {
  leagueLabel: string
  draftId: string
  teamId: string
  /** The two concurrently-submitted queue orders. */
  submittedA: string[]
  submittedB: string[]
  /** The rows actually on the server after both settled. */
  rows: Array<{ player_id: string; rank: number }>
  duplicateRanks: number[]
}

export interface LeagueResult {
  leagueLabel: string
  leagueId: string
  draftId: string
  teamCount: number
  rounds: number
  totalPicks: number
  personas: string
  durationMs: number
  failures: InvariantFailure[]
}

export interface RunReport {
  seed: number
  planLines: string[]
  leagues: LeagueResult[]
  invariantFailures: InvariantFailure[]
  /** Evidence detail rows, CAPPED at the runner's MAX_F54_INCIDENTS —
   *  `f54Total` below is the true count (R288: the cap must never wear the
   *  total's name). */
  f54Incidents: QueueInterleaveIncident[]
  /** TRUE total of observed F54 interleaves this run (uncapped). */
  f54Total: number
  /** Chaos refusals the engine answered correctly (E1/E2/wrong-turn) —
   *  expected traffic, counted for the report, never errors. */
  expectedRefusals: number
  /** E2 double-tap verifications (same action_id → same pick, both 200). */
  replayVerified: number
  /** Non-empty `*_failures` arrays from the runner's own draft_tick calls. */
  workerErrors: string[]
  cleanupSummary: string
  green: boolean
  /** Auction-mode counters (absent on a snake run). */
  auction?: AuctionRunCounters
}

/** What the auction gate run reports beyond the invariant sweep — every
 *  count is REAL traffic the run drove, never a target massaged to pass.
 *  Stability (R563): the STRUCTURAL counters (`solvencyChecks`,
 *  `budgetEditReplaysVerified`, `refusedEditsVerified`, `reversalsApplied`
 *  — traffic the runner itself schedules) repeat at a fixed seed; the
 *  PERSONA-PROVOKED counters (`instantAwards`, `antiSnipe*`,
 *  `staleBidRefusals`, `overMaxRefusals`) are run-specific, because the
 *  live 5s cron shares the clock with the personas — compare those as
 *  ≥ floors across runs, never as equalities. */
export interface AuctionRunCounters {
  /** Mid-run `draft_auction_solvent` samples (service-role oracle) — one
   *  per observed award, plus one final full check per league. */
  solvencyChecks: number
  /** §8.6.9 uncontestable nominations awarded in the nominate transaction
   *  (observed: nominate 200 → phase already advanced, no bid window). */
  instantAwards: number
  /** Sniper T-1s stagings (harness rewound the bid deadline into the
   *  anti-snipe window before the sniper's raise). */
  antiSnipeStaged: number
  /** Stagings whose post-bid deadline moved LATER (the §8.6.3 re-floor). */
  antiSnipeObserved: number
  /** E69: budget edits replayed with the SAME action_id that answered the
   *  original result and wrote nothing twice. */
  budgetEditReplaysVerified: number
  /** E28: commissioner edits the engine refused (solvency floor) where the
   *  re-read showed nothing changed. */
  refusedEditsVerified: number
  /** Won bids reversed mid-draft (`draft_reverse_won_bid`) — the undo half
   *  of the exit-criterion sentence. */
  reversalsApplied: number
  /** Chaos stale-identity bids answered with the F64 friendly refusal. */
  staleBidRefusals: number
  /** Chaos over-max bids answered with the E5 friendly refusal. */
  overMaxRefusals: number
}
