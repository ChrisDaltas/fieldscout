/**
 * StatsProvider — the ingestion contract everything ships against
 * (spec §23.1; M0 task L.A0.2a; interface per tasks-M0-foundations.md §4).
 *
 * All ingestion goes through this interface so the provider is swappable
 * without touching league logic: `synthetic` (§23.6), `sleeper_free` (v1
 * beta), and paid vendors (GA) implement the same five methods. §23.1's
 * "getInjuries/Inactives" is two methods (D4) — in-game designations and the
 * official ~90-min-pre-kickoff inactives list have different shapes and
 * cadences. Capability tiers (§23.5) are a declared readonly set; gating
 * starts in M1 (D5).
 */

import type { StatTier } from './stat-keys'

export interface ProviderGame {
  gameId: string
  season: number
  week: number
  homeTeam: string
  awayTeam: string
  /** null when the tier can't supply a real kickoff timestamp (PROGRESS Q1 —
   *  resolved: nflverse supplements kickoffs from the locks/schedule
   *  milestone onward, D16). */
  kickoffAt: Date | null
  /** YYYY-MM-DD calendar day of the game as the provider reports it — the
   *  day-granularity signal tiers without kickoff timestamps still carry
   *  (sleeper_free, Q1). The ingestion seam's game-window check runs on this
   *  (L.A0.2b, D25); consumers with a real `kickoffAt` should prefer it.
   *  null when even the day is unknown. */
  gameDate: string | null
  status: 'scheduled' | 'live' | 'final' | 'postponed'
}

export interface ProviderGameState {
  gameId: string
  status: ProviderGame['status']
  quarter?: number
  clock?: string
  /** When the charted feed posted for this game (§23.5 two-phase settle);
   *  absent on providers without the `charted` capability. */
  advancedFinalAt?: Date | null
}

export interface ProviderPlayerWeekStats {
  /** Sleeper-keyed players.id (§23.1); the adapter owns external-ID mapping. */
  playerId: string
  season: number
  week: number
  gameId?: string
  /** core_box values, canonical STAT_KEYS keys. */
  stats: Partial<Record<string, number>>
  /** tracking/charted values, canonical keys. A missing key means
   *  not-yet-reported — renders as pending, never 0 (§23.5). */
  advanced: Partial<Record<string, number>>
}

export interface ProviderInjury {
  playerId: string
  /** questionable/doubtful/out/… including in-game rulings. */
  designation: string
  gameId?: string
  reportedAt: Date
}

export interface ProviderInactives {
  gameId: string
  playerIds: string[]
  /** The official list publishes ~90 min pre-kickoff (§23.1). */
  publishedAt: Date
}

export interface StatsProvider {
  /** 'sleeper' | 'synthetic' | 'fixture:<id>' | vendor ids later. */
  readonly name: string
  /** §23.5 capability tiers; league-creation gating begins in M1 (D5). */
  readonly capabilities: ReadonlySet<StatTier>
  getSchedule(season: number): Promise<ProviderGame[]>
  getGameStates(season: number, week: number): Promise<ProviderGameState[]>
  getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]>
  getInjuries(season: number, week: number): Promise<ProviderInjury[]>
  getInactives(season: number, week: number): Promise<ProviderInactives[]>
}
