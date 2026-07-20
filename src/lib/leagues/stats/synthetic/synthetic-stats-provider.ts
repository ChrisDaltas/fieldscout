/**
 * SyntheticStatsProvider — the $0 environment tier behind the §23.1 contract
 * (spec §23.6; M0 task L.A0.3).
 *
 * Every method derives the synthetic world's state at time.now() as a pure
 * function of (scenario, seed, now): no mutable state, no I/O, fully
 * deterministic. Stat lines are floor(finalLine × gameProgress), which makes
 * in-game deltas monotone by construction and outage recovery a free
 * cumulative back-fill (§23.2) — the recovered read IS the state at now.
 *
 * Tier semantics honored:
 * - core_box values live in `stats` under registry-canonical keys only
 *   (§7.3.3 one-namespace rule — the L.A0.2a cross-invariant applies).
 * - tracking/charted values live in `advanced` under the D15 placeholder
 *   keys (Q2 punt — no real advanced product keys exist in M0).
 * - charted keys are ABSENT until the game's chartedPostAt — pending, never
 *   0 (§23.5); `advancedFinalAt` posts on the game state at the same instant.
 * - official inactives publish ~90 virtual minutes pre-kickoff (§23.1).
 */

import type { TimeProvider } from '../../time/time-provider'
import type { StatTier } from '../stat-keys'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '../stats-provider'
import { playerRng, randInt } from './prng'
import type {
  SyntheticGameDef,
  SyntheticPlayerDef,
  SyntheticScenario,
} from './scenario'

/** §23.1: the official inactives list publishes ~90 min pre-kickoff. */
export const INACTIVES_LEAD_MS = 90 * 60 * 1000

/** D15 placeholder keys — the only advanced keys that exist in M0. */
export const TRACKING_PLACEHOLDER_KEY = 'example_tracking_yards'
export const CHARTED_PLACEHOLDER_KEY = 'example_charted_yards'

interface FinalLine {
  /** core_box, registry-canonical keys. */
  stats: Record<string, number>
  /** tracking tier (live-capable) — null for positions without it. */
  trackingYards: number | null
  /** charted tier (posts T+1) — null for positions without it. */
  chartedYards: number | null
}

/**
 * The player's end-of-game stat line, drawn deterministically from
 * (seed, playerId) in a fixed order. Scenario id never enters the stream —
 * same-seed scenarios share lines (see prng.ts).
 */
export function finalLine(seed: number, player: SyntheticPlayerDef): FinalLine {
  const rng = playerRng(seed, player.playerId)
  switch (player.position) {
    case 'QB': {
      const attempts = randInt(rng, 24, 44)
      const completions = randInt(rng, Math.floor(attempts * 0.5), Math.floor(attempts * 0.75))
      return {
        stats: {
          pass_attempts: attempts,
          pass_completions: completions,
          pass_yards: randInt(rng, 150, 390),
          pass_tds: randInt(rng, 0, 4),
          interceptions: randInt(rng, 0, 2),
          qb_sack_taken: randInt(rng, 0, 4),
          rush_attempts: randInt(rng, 1, 7),
          rush_yards: randInt(rng, 0, 34),
        },
        trackingYards: randInt(rng, 120, 320),
        chartedYards: null,
      }
    }
    case 'RB': {
      const targets = randInt(rng, 1, 7)
      return {
        stats: {
          rush_attempts: randInt(rng, 8, 24),
          rush_yards: randInt(rng, 30, 130),
          rush_tds: randInt(rng, 0, 2),
          targets,
          receptions: randInt(rng, 0, targets),
          receiving_yards: randInt(rng, 0, 48),
          fumbles_lost: randInt(rng, 0, 1),
        },
        trackingYards: randInt(rng, 10, 60),
        chartedYards: randInt(rng, 15, 70),
      }
    }
    case 'WR': {
      const targets = randInt(rng, 4, 12)
      return {
        stats: {
          targets,
          receptions: randInt(rng, Math.floor(targets * 0.4), targets),
          receiving_yards: randInt(rng, 25, 140),
          receiving_tds: randInt(rng, 0, 2),
          rush_yards: randInt(rng, 0, 14),
        },
        trackingYards: randInt(rng, 20, 110),
        chartedYards: randInt(rng, 10, 60),
      }
    }
    case 'TE': {
      const targets = randInt(rng, 2, 8)
      return {
        stats: {
          targets,
          receptions: randInt(rng, 0, targets),
          receiving_yards: randInt(rng, 10, 80),
          receiving_tds: randInt(rng, 0, 1),
        },
        trackingYards: randInt(rng, 8, 60),
        chartedYards: randInt(rng, 5, 40),
      }
    }
    case 'K': {
      const fgAttempted = randInt(rng, 1, 4)
      const fgMade = randInt(rng, Math.max(0, fgAttempted - 1), fgAttempted)
      const fg4049 = randInt(rng, 0, fgMade)
      const fg50Plus = randInt(rng, 0, fgMade - fg4049)
      const patMade = randInt(rng, 0, 5)
      return {
        stats: {
          fg_attempted: fgAttempted,
          fg_made: fgMade,
          fg_40_49: fg4049,
          fg_50_plus: fg50Plus,
          pat_made: patMade,
          pat_attempted: patMade + randInt(rng, 0, 1),
        },
        trackingYards: null,
        chartedYards: null,
      }
    }
    case 'DEF':
      return {
        stats: {
          def_sack: randInt(rng, 0, 5),
          def_int: randInt(rng, 0, 3),
          def_fumble_rec: randInt(rng, 0, 2),
          def_td: randInt(rng, 0, 1),
          def_safety: 0,
          def_points_allowed: randInt(rng, 3, 35),
        },
        trackingYards: null,
        chartedYards: null,
      }
  }
}

export class SyntheticStatsProvider implements StatsProvider {
  readonly name = 'synthetic'

  /** The synthetic tier fabricates all three §23.5 tiers — the whole point
   *  is exercising the pipeline before any vendor is contracted (§23.6). */
  readonly capabilities: ReadonlySet<StatTier> = new Set<StatTier>([
    'core_box',
    'tracking',
    'charted',
  ])

  constructor(
    private readonly scenario: SyntheticScenario,
    private readonly time: TimeProvider,
  ) {}

  // ── world-state derivation (all pure in (scenario, now)) ─────────────────

  private nowMs(): number {
    return this.time.now().getTime()
  }

  /** §23.2: inside an outage window, every method throws. */
  private throwIfOutage(): void {
    const now = this.nowMs()
    for (const outage of this.scenario.outages) {
      if (now >= outage.startAt.getTime() && now < outage.endAt.getTime()) {
        throw new Error(
          `synthetic provider outage (scenario ${this.scenario.id}): ${outage.startAt.toISOString()}–${outage.endAt.toISOString()}`,
        )
      }
    }
  }

  private isPostponed(game: SyntheticGameDef): boolean {
    return (
      game.postponement !== undefined && this.nowMs() >= game.postponement.announceAt.getTime()
    )
  }

  /** Kickoff as the world currently knows it (flex moves and postponements
   *  reveal their new time only from announceAt onward). */
  private effectiveKickoff(game: SyntheticGameDef): Date {
    const now = this.nowMs()
    if (game.postponement && now >= game.postponement.announceAt.getTime()) {
      return game.postponement.newKickoffAt
    }
    if (game.flexMove && now >= game.flexMove.announceAt.getTime()) {
      return game.flexMove.newKickoffAt
    }
    return game.kickoffAt
  }

  private status(game: SyntheticGameDef): ProviderGame['status'] {
    if (this.isPostponed(game)) return 'postponed'
    const now = this.nowMs()
    const kickoff = this.effectiveKickoff(game).getTime()
    if (now < kickoff) return 'scheduled'
    if (now < kickoff + game.durationMs) return 'live'
    return 'final'
  }

  /** 0 before kickoff, 1 after the game ends, linear in between. */
  private progress(game: SyntheticGameDef): number {
    if (this.isPostponed(game)) return 0
    const kickoff = this.effectiveKickoff(game).getTime()
    const elapsed = this.nowMs() - kickoff
    if (elapsed <= 0) return 0
    return Math.min(1, elapsed / game.durationMs)
  }

  private gameById(gameId: string): SyntheticGameDef {
    const game = this.scenario.games.find((g) => g.gameId === gameId)
    if (!game) throw new Error(`scenario ${this.scenario.id}: unknown gameId ${gameId}`)
    return game
  }

  // ── StatsProvider ────────────────────────────────────────────────────────

  async getSchedule(season: number): Promise<ProviderGame[]> {
    this.throwIfOutage()
    if (season !== this.scenario.season) return []
    return this.scenario.games.map((game) => {
      const kickoff = this.effectiveKickoff(game)
      return {
        gameId: game.gameId,
        season,
        week: this.scenario.week,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        kickoffAt: kickoff, // the synthetic tier HAS kickoff timestamps
        gameDate: kickoff.toISOString().slice(0, 10),
        status: this.status(game),
      }
    })
  }

  async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    this.throwIfOutage()
    if (season !== this.scenario.season || week !== this.scenario.week) return []
    const now = this.nowMs()
    return this.scenario.games.map((game) => {
      const status = this.status(game)
      const chartedPosted = now >= game.chartedPostAt.getTime()
      return {
        gameId: game.gameId,
        status,
        ...(status === 'live'
          ? { quarter: Math.min(4, 1 + Math.floor(this.progress(game) * 4)) }
          : {}),
        // §23.5 two-phase: null until the charted feed posts for this game.
        advancedFinalAt: chartedPosted ? game.chartedPostAt : null,
      }
    })
  }

  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    this.throwIfOutage()
    if (season !== this.scenario.season || week !== this.scenario.week) return []
    const now = this.nowMs()
    const out: ProviderPlayerWeekStats[] = []

    for (const player of this.scenario.players) {
      if (player.inactive) continue // scratched — never plays, never scores
      const game = this.gameById(player.gameId)
      if (this.isPostponed(game)) continue // scores 0 this week (§23.3/E43)
      const progress = this.progress(game)
      if (progress <= 0) continue // pre-kickoff: no line yet

      const line = finalLine(this.scenario.seed, player)
      const stats: Partial<Record<string, number>> = {}
      for (const [key, value] of Object.entries(line.stats)) {
        stats[key] = Math.floor(value * progress)
      }

      // Corrections: value moves by delta from its (honestly-dated) event
      // time onward. In- vs post-window is downstream's concern (§23.4).
      for (const correction of this.scenario.corrections) {
        if (correction.playerId !== player.playerId) continue
        if (now < correction.at.getTime()) continue
        stats[correction.key] = (stats[correction.key] ?? 0) + correction.delta
      }

      const advanced: Partial<Record<string, number>> = {}
      if (line.trackingYards !== null) {
        // tracking is live-capable (§23.5) — accrues alongside the box score.
        advanced[TRACKING_PLACEHOLDER_KEY] = Math.floor(line.trackingYards * progress)
      }
      if (line.chartedYards !== null && now >= game.chartedPostAt.getTime()) {
        // charted posts T+1, whole — ABSENT until then, never 0 (§23.5).
        let charted = line.chartedYards
        for (const revision of this.scenario.chartedRevisions) {
          if (revision.playerId !== player.playerId) continue
          if (revision.key !== CHARTED_PLACEHOLDER_KEY) continue
          if (now < revision.at.getTime()) continue
          charted += revision.delta
        }
        advanced[CHARTED_PLACEHOLDER_KEY] = charted
      }

      out.push({
        playerId: player.playerId,
        season,
        week,
        gameId: player.gameId,
        stats,
        advanced,
      })
    }
    return out
  }

  async getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    this.throwIfOutage()
    if (season !== this.scenario.season || week !== this.scenario.week) return []
    const now = this.nowMs()
    const out: ProviderInjury[] = []
    for (const player of this.scenario.players) {
      if (!player.injury) continue
      if (now < player.injury.reportedAt.getTime()) continue
      out.push({
        playerId: player.playerId,
        designation: player.injury.designation,
        gameId: player.gameId,
        reportedAt: player.injury.reportedAt,
      })
    }
    return out
  }

  async getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    this.throwIfOutage()
    if (season !== this.scenario.season || week !== this.scenario.week) return []
    const now = this.nowMs()
    const out: ProviderInactives[] = []
    for (const game of this.scenario.games) {
      if (this.isPostponed(game)) continue // no official list for a postponed game
      const publishedAt = new Date(this.effectiveKickoff(game).getTime() - INACTIVES_LEAD_MS)
      if (now < publishedAt.getTime()) continue // §23.1: publishes ~90 min out
      out.push({
        gameId: game.gameId,
        playerIds: this.scenario.players
          .filter((p) => p.gameId === game.gameId && p.inactive)
          .map((p) => p.playerId),
        publishedAt,
      })
    }
    return out
  }
}
