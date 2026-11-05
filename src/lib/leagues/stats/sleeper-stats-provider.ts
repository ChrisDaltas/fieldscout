/**
 * SleeperStatsProvider — the `sleeper_free` tier behind the §23.1 contract
 * (M0 task L.A0.2a).
 *
 * Wraps the Sleeper endpoints this repo already polls: the shared schedule
 * fetch (schedule.ts stays put — it also feeds bye-week and SOS syncs), the
 * per-position weekly-stats fetch (live-stats.ts's private copy migrated
 * here in the L.A0.2b seam refactor — this is now the only poller of that
 * endpoint), and injury designations from the roster dump.
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

import type { WeeklyProjectionPosition } from '@/lib/sync/weekly-projections'

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
 * Sleeper stat field → canonical STAT_KEYS key: the spellings the actuals and
 * the weekly projections share, with the same meaning on both. Exported so
 * tests can assert every emitted key is registry-canonical (§7.3.3 one-namespace
 * rule). `mapToCanonicalKeys` ADDS, so several fields can fill one key
 * (`fg_0_39`, `def_fumble_rec`). The feed-only tables sit below this one.
 *
 * Evidence bar: real Sleeper responses, not reasoning. 29 of the first 30
 * mappings reproduce in the real 2025-wk2 actuals fixture (L.A1.7, R49). The
 * exception was `safe → def_safety`, absent that week; F870's measure below has
 * it on 14 D/ST lines, equal to ESPN's stat 98 on 786 of 786.
 *
 * F870 / F871 (Chris 2026-11-05, verbatim: "go on league kickers and the other
 * plays"). MEASURED 2026-11-05 on public Sleeper and ESPN responses, 2025 wk 1-18
 * and 2026 wk 1-8, 954 K lines and 786 D/ST lines:
 *   - `fgm` = `fgm_0_19 + fgm_20_29 + fgm_30_39 + fgm_40_49 + fgm_50p`, 954/954.
 *   - `fgmiss` = `fga - fgm`, 954/954. It already holds a blocked kick.
 *   - `fgm_50p` = `fgm_50_59 + fgm_60p`, 954/954, so `fg_50_plus` is inclusive.
 *   - `fum_rec` excludes special teams, so `fum_rec + def_st_fum_rec` is the
 *     team's recoveries. ESPN's stat 96 agrees on 782 of 786; the other 4 are an
 *     offensive player's recovery inside `fum_rec`, all 2025 (F893).
 *   - `blk_kick` = ESPN's stat 97, 786/786.
 *   - `def_td + def_st_td` = ESPN's five D/ST TD stats, 786/786.
 *
 * NEVER add these, each of them double counts or pays the wrong team:
 *   - `fg_blkd`: on a DEF row it is the team's OWN blocked kick, already inside
 *     `fgmiss`. The team that blocked it has `blk_kick`.
 *   - `misc_td`: a blocked-kick return TD, inside `def_st_td`.
 *   - `fum_rec_ez_tds`, `anytime_tds`: inside the TD counts; on a DEF row
 *     `fum_rec_ez_tds` can be the team's OFFENSE scoring.
 *   - `fgmiss_50_59`, `fgmiss_60p`: inside `fgmiss_50p`.
 *   - `xp_blkd`: the team's own blocked PAT, already charged through `xpmiss`.
 *
 * Still unmapped, with no rule key to fill (F871 keeps them): `fgm_60p`, `def_2pt`.
 * Tier-indicator keys (the def_pa / def_ya families) and bonuses are never
 * adapter concerns: derived at scoring time (D44) or deferred to v1.1.
 */
export const SLEEPER_STAT_KEY_MAP: Readonly<Record<string, string>> = {
  pass_att: 'pass_attempts',
  pass_cmp: 'pass_completions',
  pass_yd: 'pass_yards',
  pass_td: 'pass_tds',
  pass_int: 'interceptions',
  pass_sack: 'qb_sack_taken',
  pass_2pt: 'pass_2pt',
  rush_att: 'rush_attempts',
  rush_yd: 'rush_yards',
  rush_td: 'rush_tds',
  rush_2pt: 'rush_2pt',
  rec_tgt: 'targets',
  rec: 'receptions',
  rec_yd: 'receiving_yards',
  rec_td: 'receiving_tds',
  rec_2pt: 'rec_2pt',
  fum_lost: 'fumbles_lost',
  fgm: 'fg_made',
  fga: 'fg_attempted',
  fgm_40_49: 'fg_40_49',
  fgm_50p: 'fg_50_plus',
  xpm: 'pat_made',
  xpa: 'pat_attempted',
  // R10 update (L.A1.7 re-check, 2026-07-20): originally projections-evidence
  // only, but the real 2025-wk2 ACTUALS fixture (L.A0.4, recorded from the
  // live /stats endpoint) contains pat_missed rows — which only this mapping
  // can produce — so the spelling is now evidenced on real actuals data. The
  // September 2026 recording re-confirms on current-season data (F10).
  xpmiss: 'pat_missed',
  sack: 'def_sack',
  int: 'def_int',
  fum_rec: 'def_fumble_rec',
  def_td: 'def_td',
  // R49 (2026-07-20): the one mapping NOT evidenced in the 2025-wk2 actuals
  // fixture (safeties are rare; none occurred that week). Evidence is the
  // pre-seam production STAT_MAP (`de0adfd`); F10 re-confirms on a 2026
  // week that contains a safety.
  safe: 'def_safety',
  pts_allow: 'def_points_allowed',
  // L.E1.26 / F390 (Chris 2026-09-27: "we need to get yards allowed").
  // MEASURED 2026-09-27 on this adapter's own endpoint (GET
  // /stats/nfl/{season}/{week}?season_type=regular&position[]=DEF): every
  // D/ST that played carries `yds_allow` as an integer — 2026 wk1 32/32
  // (176–552), wk2 32/32 (151–523), 2025 wk2 32/32 — and Sleeper's own
  // one-hot `yds_allow_<tier>` indicator names the same tier as our
  // def_ya_* buckets in 88/88 rows (wk1/wk2/wk3). A live, just-kicked-off
  // D/ST row can lack it (2026 wk3 ARI at ~20:17 UTC: `gp` and return
  // stats only) — that absence stays ABSENT (NULL in `player_stats`,
  // pending in scoring; `deliveredLine`), never a 0 — UNLESS the actuals
  // line says `yds_allow_0_100: 1` (Sleeper's zero-omission: a delivered 0,
  // `readZeroOmittedYardsAllowed`, R1150). The weekly
  // projections endpoint uses the same spelling (fractional — floored for
  // the tier by player-values, D374(4)); the SEASON endpoint carries no
  // `yds_allow` at all. One map, both namespaces (F10 / F386(a)).
  // Recorded: src/lib/leagues/stats/fixtures/sleeper-def-yards-allowed-2026.json.
  yds_allow: 'def_yards_allowed',
  // F870 / F871: a short FG is three buckets, and a D/ST's recoveries are two
  // fields. Both ADD (`mapToCanonicalKeys`). See the measure above.
  fgm_0_19: 'fg_0_39',
  fgm_20_29: 'fg_0_39',
  fgm_30_39: 'fg_0_39',
  def_st_fum_rec: 'def_fumble_rec',
  blk_kick: 'def_block',
}

/**
 * F870 / F871: the spellings only the ACTUALS endpoint sends. Kept out of the
 * shared map because `st_td` means a player's return TD here and a team's
 * projected return TDs on the projections endpoint, and because
 * `WEEKLY_SOURCE_KEYS` must not claim projections can deliver these: a key they
 * never send stays NAMED in `projected_unscored` (`fumble_recovery_td`).
 * `st_td` appears on no K or DEF actual in 19,199 lines.
 */
export const SLEEPER_ACTUALS_ONLY_MAP: Readonly<Record<string, string>> = {
  fgmiss: 'fg_missed',
  def_st_td: 'def_return_td',
  st_td: 'return_td',
  fum_rec_td: 'fumble_recovery_td',
}

/** On an offense projection these are the player's own return TDs. */
const PROJECTED_OFFENSE: Readonly<Record<string, string>> = { pr_td: 'return_td', def_kr_td: 'return_td' }

/**
 * F870 / F871: the spellings only the PROJECTIONS endpoint sends, per position,
 * because the same field means different things by row (`def_kr_td` on a WR is
 * his kick-return TD). MEASURED 2026-11-05, 835 K and 844 D/ST rows: no row has
 * `fgmiss`, `def_st_td`, `def_st_fum_rec` or `fum_rec_td`.
 *
 * A projected kicker's short makes and misses come from the buckets, not from
 * `fgm` and `fga`: in 2026 `fgm` doesn't match its buckets on 281 of 299 rows, and
 * yards per make say the buckets are the real set. That reading was told to Chris
 * 2026-11-05 and stands unless Chris says otherwise.
 */
export const SLEEPER_PROJECTIONS_ONLY_MAP: Readonly<Record<WeeklyProjectionPosition, Readonly<Record<string, string>>>> = {
  QB: PROJECTED_OFFENSE,
  RB: PROJECTED_OFFENSE,
  WR: PROJECTED_OFFENSE,
  TE: PROJECTED_OFFENSE,
  K: {
    fgmiss_0_19: 'fg_missed',
    fgmiss_20_29: 'fg_missed',
    fgmiss_30_39: 'fg_missed',
    fgmiss_40_49: 'fg_missed',
    fgmiss_50p: 'fg_missed',
  },
  DEF: { st_td: 'def_return_td' },
}

/** Which endpoint a line came from. Required, so every caller chooses. */
export type SleeperFeed = { feed: 'actuals' } | { feed: 'projections'; position: WeeklyProjectionPosition }

/** The feed's own table. A position with no table throws by name: a silent
 *  empty table would drop plays with nothing to show for it. */
function feedOnlyMap(feed: SleeperFeed): Readonly<Record<string, string>> {
  if (feed.feed === 'actuals') return SLEEPER_ACTUALS_ONLY_MAP
  if (!Object.hasOwn(SLEEPER_PROJECTIONS_ONLY_MAP, feed.position)) {
    throw new Error(`mapToCanonicalKeys: no projections map for position "${String(feed.position)}"`)
  }
  return SLEEPER_PROJECTIONS_ONLY_MAP[feed.position]
}

/**
 * Sleeper schedule statuses → provider statuses. Unknown/missing values map
 * to 'scheduled' — the conservative reading (never finalizes or livens a
 * game early). The free feed has no postponement marker: a postponed game
 * surfaces as a changed date, which §23.3's evaluation-time lock derivation
 * absorbs without adapter help.
 *
 * R12 caveat: only 'complete' and 'pre_game' are repo-evidenced (schedule
 * fixtures); the other recognized strings are defensive guesses — no
 * pre-existing code branches on schedule status. A wrong guess degrades a
 * live/final game to 'scheduled' silently, so the recognized set must be
 * verified against the first real recording (L.A0.4, September 2026).
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
  /** The row's own team / opponent (the game it was played in — recorded
   *  verbatim in fixtures/sleeper-def-yards-allowed-2026.json). F589. */
  team?: unknown
  opponent?: unknown
}

/** Per-position weekly actuals — migrated from live-stats.ts in L.A0.2b;
 *  this adapter is now the endpoint's only poller. */
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

/**
 * F578 (PROGRESS D539) — usage stats the player view shows, mapped from the
 * SAME actuals endpoint into canonical keys stored in `player_stats.advanced`
 * (§23.5's storage rule: a new stat needs no migration; an absent key is
 * not reported). Context only — never scorable (`scoring_surface:
 * 'context'`). MEASURED 2026-10-17 on this adapter's endpoint (recorded:
 * `fixtures/sleeper-usage-keys-2026.json`, whose note carries the counts):
 * `off_snp` on 34/34 played QBs and 137/146 played WRs (2025 wk 5), the
 * red-zone keys on the positions that have them, `fgm_lng` on every kicker
 * who made a field goal. Actuals only — the weekly projections path
 * (`mapToCanonicalKeys`) does not read these.
 */
export const SLEEPER_USAGE_KEY_MAP: Readonly<Record<string, string>> = {
  off_snp: 'off_snaps',
  pass_rz_att: 'pass_rz_att',
  rush_rz_att: 'rush_rz_att',
  rec_rz_tgt: 'rec_rz_tgt',
  fgm_lng: 'fg_long',
}

/** The usage keys present on a Sleeper actuals line (finite numbers only). */
export function mapUsageKeys(stats: Record<string, number | null> | null): Record<string, number> {
  const out: Record<string, number> = {}
  if (!stats) return out
  for (const [sleeperKey, canonicalKey] of Object.entries(SLEEPER_USAGE_KEY_MAP)) {
    const value = Number(stats[sleeperKey] ?? NaN)
    if (Number.isFinite(value)) out[canonicalKey] = value
  }
  return out
}

/** Sleeper stat object → canonical keys (finite numbers only), adding when
 *  several fields fill one key. Exported for the weekly projections sync
 *  (L.E1.19, D373(2)): a projected line lands in the SAME canonical namespace as
 *  an actual one, so the two are commensurable key for key. The fields differ by
 *  feed, so the caller names its feed. */
export function mapToCanonicalKeys(
  stats: Record<string, number | null> | null,
  feed: SleeperFeed,
): Partial<Record<string, number>> {
  const only = feedOnlyMap(feed)
  const out: Partial<Record<string, number>> = {}
  if (!stats) return out
  for (const table of [SLEEPER_STAT_KEY_MAP, only]) {
    for (const [sleeperKey, canonicalKey] of Object.entries(table)) {
      const value = Number(stats[sleeperKey] ?? NaN)
      if (Number.isFinite(value)) out[canonicalKey] = (out[canonicalKey] ?? 0) + value
    }
  }
  return out
}

/**
 * L.E1.26 fix round (R1150) — Sleeper's ZERO-OMISSION convention, read for
 * yards allowed on the ACTUALS path only. Sleeper omits a zero-valued stat
 * from a line (measured: every 2025 shutout carries no `pts_allow` and
 * `pts_allow_0: 1`), and every played D/ST row measured carries exactly one
 * one-hot `yds_allow_<tier>` indicator (2025 weeks 2/3/4/7/13/14/15, 2026
 * weeks 1–3). So a line WITHOUT `yds_allow` whose indicator is
 * `yds_allow_0_100: 1` is Sleeper saying "0 yards": that is a DELIVERED 0,
 * not an absent value. Any other shape without `yds_allow` (no indicator,
 * or a non-zero tier's) stays absent — NULL, pending (F390 / D380(4)).
 *
 * Applied in `getWeekStats` AFTER the "nothing canonical → noise" check, so
 * an indicator-only row (the live ARI row, 2026 wk3 — `gp`, returns and the
 * indicators, no canonical stat) is still no line at all, exactly as before.
 * NOT applied in `mapToCanonicalKeys`: the season projections carry a
 * constant `yds_allow_0_100: 1` on every D/ST (D380(2)) — an indicator
 * there is not a value, and the projections path never reads this.
 */
export function readZeroOmittedYardsAllowed(
  raw: Record<string, number | null> | null,
  mapped: Partial<Record<string, number>>,
): Partial<Record<string, number>> {
  if (mapped.def_yards_allowed !== undefined || !raw) return mapped
  if ('yds_allow' in raw) return mapped // present but non-finite — never guessed
  if (Number(raw.yds_allow_0_100) !== 1) return mapped
  return { ...mapped, def_yards_allowed: 0 }
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

  /** §23.5 capability tiers: sleeper_free is box-score only. Gating starts
   *  in M1 (D5). What's still outside the map is named above SLEEPER_STAT_KEY_MAP. */
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
      gameDate: game.date ?? null,
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
        // R13: the response is a cast, not a validated parse — a malformed
        // row must not flow a non-string playerId into a string-typed field
        // (§23.2 "never wrong numbers" extends to identities). Value-level
        // noise is already guarded: mapToCanonicalKeys keeps finite numbers
        // only.
        if (typeof row?.player_id !== 'string' || row.player_id.length === 0) {
          continue
        }
        const mapped = mapToCanonicalKeys(row.stats, { feed: 'actuals' })
        if (Object.keys(mapped).length === 0) continue // nothing canonical → noise
        out.push({
          playerId: row.player_id, // players.id is Sleeper-keyed (§23.1)
          season,
          week,
          stats: readZeroOmittedYardsAllowed(row.stats, mapped), // R1150 — actuals only
          ...(typeof row.team === 'string' && row.team !== '' ? { team: row.team } : {}),
          ...(typeof row.opponent === 'string' && row.opponent !== '' ? { opponent: row.opponent } : {}),

          // Box-score tier — tracking/charted never present here; the F578
          // usage keys (snaps, red zone, FG long) are the only advanced keys.
          advanced: mapUsageKeys(row.stats),
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
