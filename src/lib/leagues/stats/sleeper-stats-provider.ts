/**
 * SleeperStatsProvider — the `sleeper_free` tier behind the §23.1 contract
 * (M0 task L.A0.2a).
 *
 * Wraps the Sleeper endpoints this repo already polls: the shared schedule
 * fetch (schedule.ts stays put — it also feeds bye-week and SOS syncs), a
 * re-implemented per-position weekly-stats fetch (live-stats.ts keeps its
 * private copy until the L.A0.2b seam refactor migrates it here; this task
 * changes no existing file), and injury designations from the roster dump.
 *
 * Known free-tier limitations (PROGRESS Q1, resolved 2026-07-18): the
 * schedule feed is day-granularity — no kickoff timestamps — and there is no
 * official-inactives feed. nflverse supplements both; its adapter lands with
 * the first runtime consumer of kickoffs (locks/schedule milestone, not M0 —
 * D16). Until then `kickoffAt` is null and `getInactives` returns [].
 */

import {
  FANTASY_POSITIONS,
  fetchAllPlayers,
  isFantasyRelevant,
} from '@/lib/sports-data/sleeper'
import { fetchSchedule, type SleeperScheduleGame } from '@/lib/sync/schedule'

import type { TimeProvider } from '../time/time-provider'
import type { StatTier } from './stat-keys'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from './stats-provider'

/**
 * Sleeper actual-stat field → canonical STAT_KEYS key. Exported so tests can
 * assert every emitted key is registry-canonical (§7.3.3 one-namespace rule)
 * and so the L.A0.2b seam refactor can reuse it.
 *
 * Deliberately a strict subset of §23.5's core_box definition (D5): only
 * Sleeper fields already evidenced in this repo (live-stats STAT_MAP,
 * SleeperProjectedStats) are mapped. Canonical keys with no mapping here
 * (fg_0_39, fg_missed, def_block, def_pa tiers, return TDs, bonuses) are
 * part of the M1 core_box completeness re-verification.
 */
export const SLEEPER_STAT_KEY_MAP: Readonly<Record<string, string>> = {
  pass_yd: 'pass_yards',
  pass_td: 'pass_tds',
  pass_int: 'interceptions',
  pass_2pt: 'pass_2pt',
  rush_yd: 'rush_yards',
  rush_td: 'rush_tds',
  rush_2pt: 'rush_2pt',
  rec: 'receptions',
  rec_yd: 'receiving_yards',
  rec_td: 'receiving_tds',
  rec_2pt: 'rec_2pt',
  fum_lost: 'fumbles_lost',
  fgm_40_49: 'fg_40_49',
  fgm_50p: 'fg_50_plus',
  xpm: 'pat_made',
  xpmiss: 'pat_missed',
  sack: 'def_sack',
  int: 'def_int',
  fum_rec: 'def_fumble_rec',
  def_td: 'def_td',
  safe: 'def_safety',
}

/**
 * Sleeper schedule statuses → provider statuses. Unknown/missing values map
 * to 'scheduled' — the conservative reading (never finalizes or livens a
 * game early). The free feed has no postponement marker: a postponed game
 * surfaces as a changed date, which §23.3's evaluation-time lock derivation
 * absorbs without adapter help.
 */
export function mapSleeperGameStatus(
  status: string | null | undefined,
): ProviderGame['status'] {
  switch (status) {
    case 'complete':
    case 'completed':
    case 'post_game':
      return 'final'
    case 'in_game':
    case 'in_progress':
      return 'live'
    default:
      return 'scheduled'
  }
}

/** The free schedule feed carries no game id — synthesize a deterministic
 *  natural key; the adapter owns external-ID mapping (§23.1). */
function sleeperGameId(season: number, game: SleeperScheduleGame): string {
  return `${season}-wk${String(game.week).padStart(2, '0')}-${game.away}@${game.home}`
}

interface SleeperWeeklyStatsRow {
  player_id: string
  stats: Record<string, number | null> | null
}

/** Per-position weekly actuals — the same endpoint live-stats.ts polls; its
 *  private copy migrates here in L.A0.2b. */
async function fetchSleeperWeekStats(
  season: number,
  week: number,
  position: string,
): Promise<SleeperWeeklyStatsRow[]> {
  const url = `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&position[]=${position}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Sleeper weekly stats fetch failed (${position} wk${week}): ${res.status}`,
    )
  }
  return (await res.json()) as SleeperWeeklyStatsRow[]
}

function mapToCanonicalKeys(
  stats: Record<string, number | null> | null,
): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {}
  if (!stats) return out
  for (const [sleeperKey, canonicalKey] of Object.entries(SLEEPER_STAT_KEY_MAP)) {
    const value = Number(stats[sleeperKey] ?? NaN)
    if (Number.isFinite(value)) out[canonicalKey] = value
  }
  return out
}

/** injury_start_date is a day-granularity string (or null); when absent or
 *  unparseable the honest timestamp is "observed now" — from the injected
 *  clock, never the wall (D3). */
function parseReportedAt(startDate: string | null, time: TimeProvider): Date {
  if (startDate) {
    const parsed = new Date(startDate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return time.now()
}

export class SleeperStatsProvider implements StatsProvider {
  readonly name = 'sleeper'

  /** §23.5 capability tiers — sleeper_free is box-score only. Gating starts
   *  in M1 (D5), where this adapter's core_box completeness must be
   *  re-verified: the M0 mapped set is a strict subset of §23.5's core_box
   *  definition (see SLEEPER_STAT_KEY_MAP). */
  readonly capabilities: ReadonlySet<StatTier> = new Set<StatTier>(['core_box'])

  constructor(private readonly time: TimeProvider) {}

  async getSchedule(season: number): Promise<ProviderGame[]> {
    const games = await fetchSchedule(season)
    return games.map((game) => ({
      gameId: sleeperGameId(season, game),
      season,
      week: game.week,
      homeTeam: game.home,
      awayTeam: game.away,
      // Day-granularity feed — no kickoff timestamps at this tier (PROGRESS
      // Q1; nflverse supplements them from the locks/schedule milestone on).
      kickoffAt: null,
      status: mapSleeperGameStatus(game.status),
    }))
  }

  async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    const games = await fetchSchedule(season)
    return games
      .filter((game) => game.week === week)
      .map((game) => ({
        gameId: sleeperGameId(season, game),
        status: mapSleeperGameStatus(game.status),
        // No quarter/clock in the free schedule feed; no charted capability,
        // so advancedFinalAt stays absent (§23.5).
      }))
  }

  async getWeekStats(
    season: number,
    week: number,
  ): Promise<ProviderPlayerWeekStats[]> {
    const out: ProviderPlayerWeekStats[] = []
    for (const position of FANTASY_POSITIONS) {
      const rows = await fetchSleeperWeekStats(season, week, position)
      for (const row of rows) {
        const stats = mapToCanonicalKeys(row.stats)
        if (Object.keys(stats).length === 0) continue // nothing canonical → noise
        out.push({
          playerId: row.player_id, // players.id is Sleeper-keyed (§23.1)
          season,
          week,
          stats,
          advanced: {}, // box-score tier — tracking/charted never present here
        })
      }
    }
    return out
  }

  /**
   * Injury designations from the Sleeper roster dump (the same fields the
   * players sync persists: injury_status/injury_start_date). The dump is a
   * *current-state* snapshot — it cannot answer for past weeks, so the
   * contract args are accepted but unused at this tier. Designations are
   * lowercased (questionable/doubtful/out/ir/…) per the §23.1 sketch.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract args; the free roster dump is now-scoped
  async getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    const players = await fetchAllPlayers()
    const injuries: ProviderInjury[] = []
    for (const player of Object.values(players)) {
      if (!isFantasyRelevant(player)) continue
      const designation = player.injury_status?.trim()
      if (!designation) continue
      injuries.push({
        playerId: player.player_id,
        designation: designation.toLowerCase(),
        reportedAt: parseReportedAt(player.injury_start_date, this.time),
      })
    }
    return injuries
  }

  /**
   * The official ~90-min-pre-kickoff inactives list is a hard requirement of
   * whichever live provider runs (§23.1) — and sleeper_free has no such
   * feed. PROGRESS Q1 (resolved): nflverse supplements official inactives;
   * that adapter lands with its first runtime consumer (not M0 — D16).
   * Synthetic scenarios (§23.6) cover the publication timing until then.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract args; sleeper_free has no inactives feed (Q1)
  async getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    return []
  }
}
