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

/** The four M2 personas (plan §4.2; tasks-M2 §5). The sniper and the Ghost
 *  are M3/M4's (auction / in-season) — deliberately absent here. */
export type PersonaKind = 'queue-drafter' | 'adp-drafter' | 'afk' | 'chaos'

/** v1 legal sizes (§7.3.8; 040's CHECK — {8,10,12,14,16}). */
export const LEGAL_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
export type LegalTeamCount = (typeof LEGAL_TEAM_COUNTS)[number]

/** One human bot seat in a league: which pool bot mans it, playing what. */
export interface SeatPlan {
  /** Index into the run's bot-user pool. Seat 0's bot is the commissioner. */
  botIndex: number
  persona: PersonaKind
}

/** One league of the run matrix (derived deterministically from the seed). */
export interface LeaguePlan {
  index: number
  /** League name — carries the run prefix so cleanup can sweep by name. */
  name: string
  teamCount: LegalTeamCount
  /** Draftable rounds (D91: starters + bench of the compact roster preset). */
  rounds: number
  snakeReversal: boolean
  /** Human seats (seat 0 = commissioner). The rest are placeholder seats. */
  humanSeats: SeatPlan[]
  placeholderCount: number
  /** The all-timeout league (every human seat afk — the gate's requirement). */
  allAfk: boolean
}

export interface RunPlan {
  seed: number
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
  f54Incidents: QueueInterleaveIncident[]
  /** Chaos refusals the engine answered correctly (E1/E2/wrong-turn) —
   *  expected traffic, counted for the report, never errors. */
  expectedRefusals: number
  /** E2 double-tap verifications (same action_id → same pick, both 200). */
  replayVerified: number
  /** Non-empty `*_failures` arrays from the runner's own draft_tick calls. */
  workerErrors: string[]
  cleanupSummary: string
  green: boolean
}
