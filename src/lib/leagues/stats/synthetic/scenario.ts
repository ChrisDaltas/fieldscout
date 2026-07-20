/**
 * Versioned declarative scenario schema for the SyntheticStatsProvider
 * (spec §23.6; M0 task L.A0.3; sketch per tasks-M0-foundations.md §4).
 *
 * A scenario declaratively describes a synthetic NFL week: game slate +
 * kickoffs, player pool, injury/inactive events, outage windows, correction
 * events, and charted arrival/revision times. The provider derives the
 * world's state at time.now() as a pure function of (scenario, seed, now) —
 * no mutable state, no I/O.
 *
 * Versioning: every scenario carries `version`; bump it on ANY behavior
 * change so downstream fixtures/simulator runs can pin what they were built
 * against. The library-wide version lives in scenarios.ts.
 *
 * Timing skeleton vs stat values: everything in this schema (games, event
 * times, player pool, inactives) is FIXED per scenario id — only stat-line
 * numbers draw from `seed`. Determinism tests rely on that split ("different
 * seed → different lines, same event skeleton").
 */

/** The nine §23.6 scenario ids — exact, per tasks-M0 §5 L.A0.3. */
export type ScenarioId =
  | 'happy_path'
  | 'flex_move'
  | 'postponement'
  | 'mass_inactives'
  | 'provider_outage'
  | 'correction_in_window'
  | 'correction_post_window'
  | 'charted_late'
  | 'charted_revision'

export const SCENARIO_IDS: readonly ScenarioId[] = [
  'happy_path',
  'flex_move',
  'postponement',
  'mass_inactives',
  'provider_outage',
  'correction_in_window',
  'correction_post_window',
  'charted_late',
  'charted_revision',
]

export type SyntheticPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export interface SyntheticGameDef {
  gameId: string
  homeTeam: string
  awayTeam: string
  /** Originally scheduled kickoff (virtual time). */
  kickoffAt: Date
  /** Game length; status is `live` in [kickoff, kickoff + duration). */
  durationMs: number
  /** E42: at announceAt the kickoff moves — schedule reads before it show
   *  the original kickoff, after it the new one (locks re-derive downstream,
   *  §23.3). */
  flexMove?: { announceAt: Date; newKickoffAt: Date }
  /** E43: at announceAt the game is postponed out of the week — status
   *  becomes 'postponed', kickoff moves to newKickoffAt (beyond the week),
   *  and its players emit no stat lines this week (score 0, §23.3). */
  postponement?: { announceAt: Date; newKickoffAt: Date }
  /** When the charted feed posts for this game (§23.5 two-phase; T+1).
   *  Before it, charted keys are ABSENT (pending, never 0). */
  chartedPostAt: Date
  /** The charted feed's declared SLA for this game — the charted_late
   *  observable is chartedPostAt slipping past this (E55/E57). */
  chartedSlaAt: Date
}

export interface SyntheticInjuryDef {
  designation: string
  reportedAt: Date
}

export interface SyntheticPlayerDef {
  playerId: string
  position: SyntheticPosition
  gameId: string
  /** On the official inactives list — published ~90 virtual minutes before
   *  kickoff (§23.1); inactive players emit no stat lines. */
  inactive?: true
  injury?: SyntheticInjuryDef
}

/** A stat-correction event: from `at` onward (game final), `key` moves by
 *  `delta`. Whether `at` falls inside or after correctionWindowEndsAt is the
 *  in-window vs post-window distinction — the provider just dates it
 *  honestly; flag-vs-apply behavior is downstream (§23.4). */
export interface SyntheticCorrectionDef {
  playerId: string
  key: string
  delta: number
  at: Date
}

/** E56: the charted feed revises an already-posted value at `at`. */
export interface SyntheticChartedRevisionDef {
  playerId: string
  key: string
  delta: number
  at: Date
}

/** §23.2: inside [startAt, endAt) every provider method throws. */
export interface SyntheticOutageDef {
  startAt: Date
  endAt: Date
}

export interface SyntheticScenario {
  id: ScenarioId
  /** Bump on any behavior change to this scenario's definition. */
  version: number
  seed: number
  season: number
  week: number
  /** §23.4 default shape (Thu 06:00 ET after the week) as a virtual literal. */
  correctionWindowEndsAt: Date
  games: SyntheticGameDef[]
  players: SyntheticPlayerDef[]
  outages: SyntheticOutageDef[]
  corrections: SyntheticCorrectionDef[]
  chartedRevisions: SyntheticChartedRevisionDef[]
}
