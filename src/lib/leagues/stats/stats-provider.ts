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
  /** F589 (migration 194): the NFL team this line was played FOR, and its
   *  opponent, as the provider's row names them (Sleeper's weekly row
   *  carries both beside its own game id). The ingest keeps `team` only
   *  when the pair is a game of that week. */
  team?: string
  opponent?: string
  /** core_box values, canonical STAT_KEYS keys. */
  stats: Partial<Record<string, number>>
  /** tracking/charted values, canonical keys. A missing key means
   *  not-yet-reported — renders as pending, never 0 (§23.5). */
  advanced: Partial<Record<string, number>>
  /** F916 (migration 223): the provider's line exactly as sent, for
   *  `player_stat_lines` — every stat key, mapped or not. Absent on a
   *  provider that has no raw line to keep (synthetic), in a fixture (the
   *  recorder leaves it out), and on a row the adapter could not read it from. */
  sourceLine?: ProviderSourceLine
}

/** F916 — one provider line verbatim (`player_stat_lines`). Never a scoring input. */
export interface ProviderSourceLine {
  /** The provider the line came from ('sleeper') — not the wrapped provider's name. */
  source: string
  seasonType: string
  /** The position list the line was served under. */
  position: string | null
  /** The provider's stats object exactly as sent (`{}` for a null one). */
  stats: Record<string, unknown>
  /** The rest of the provider's row exactly as sent, minus `stats` and any embedded player block. */
  meta: Record<string, unknown>
  team: string | null
  opponent: string | null
  /** The provider's own game id (not nfl_games.id). */
  gameId: string | null
  /** YYYY-MM-DD as the provider sent it. */
  gameDate: string | null
  /** The provider's own last-modified instant (ISO), when it sent one. */
  updatedAt: string | null
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
