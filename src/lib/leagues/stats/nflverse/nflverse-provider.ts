/**
 * NflverseProvider — the free T+1 supplement behind the §23.1 contract
 * (L.D3.1, PROGRESS F11 — Q1/D16 provenance; tasks-M4-inseason.md §6
 * L.D3.1, C56, D300; spec §23.1, §23.3, E42).
 *
 * WHAT IT SUPPLIES, AND FROM WHICH PUBLISHED FILES (plain `fetch` of the
 * nflverse-data GitHub release assets — no scraping service, ever; Chris's
 * standing rule):
 *
 *   1. Kickoff timestamps + the season schedule — `schedules/games.csv`.
 *      `gameday` + `gametime` (US/Eastern wall time) → `kickoffAt` (UTC)
 *      via `easternToUtc` (the DST fall-back inside NFL week 8 resolves from
 *      IANA zone data, never a hard-coded offset). Team codes are mapped to
 *      the house vocabulary (`nfl-teams.ts`: nflverse `LA` → `LAR`; every
 *      other 2026 code already matches; an unknown code REFUSES). The game
 *      id is nflverse's own (`2026_01_NE_SEA`) — stable, published, and
 *      self-describing, which is how a row in `nfl_games` names its source
 *      (the table has no `source` column; `player_stats.source` carries the
 *      composite provider's name — see `withNflverseCalendar`).
 *      Status is the ONLY thing nflverse can honestly say at T+1:
 *      `final` once a result is posted, else `scheduled`. It never emits
 *      `live` or `postponed` — a postponed/moved game arrives as a changed
 *      `gameday`/`gametime`/`week`, which `ingestWeek`'s diff turns into a
 *      moved `nfl_games` row (E42 — and every lock reads that row at
 *      evaluation time, §23.3). Regular season ONLY (`game_type = 'REG'`),
 *      like the Sleeper tier (`/schedule/nfl/regular/`): postseason rows are
 *      counted and dropped, never written as `game_type = 'regular'`.
 *
 *   2. Official game-day inactives — `weekly_rosters/roster_weekly_<season>.csv`,
 *      rows with `status = 'INA'` for (week, REG). Measured on the 2025
 *      file (2026-09-02): 5–6 INA rows per team per played week, ZERO for
 *      teams on bye, weeks 1–18 all present — that IS the ~90-min inactive
 *      list, published after the fact (the D16 accepted limitation: a
 *      back-fill loses arrival timing, so `publishedAt` is the injected
 *      observation instant, never a claimed publication time). The file
 *      carries `sleeper_id`, so identity is direct (§23.1: the adapter owns
 *      the mapping — here the mapping is a column); rows without one
 *      (mostly OL/DL — Sleeper does not track them) are counted and dropped.
 *
 *   C56 — RECORDED WHERE M5 WILL LOOK: inactives come from THIS feed
 *   (`getInactives`), NEVER from `players.status`. The Sleeper player sync
 *   collapses `injury_status` INTO `players.status` (sleeper.ts
 *   `mapSleeperPlayerToDb`: `injury_status ?? status ?? 'Active'`), so that
 *   column cannot distinguish "Out on Friday's report" from "inactive at
 *   kickoff" from "active". `auto_sub_inactives` (§11.3) and Swap spots
 *   (§7.3.2) read `ProviderInactives`, and this adapter never writes
 *   `players.status` (nor any table — it is a provider, and `ingestWeek` is
 *   the only writer).
 *
 * WHAT IT DOES NOT SUPPLY: stat lines and injury designations. nflverse
 * `player_stats` is gsis-keyed and a different contract; `sleeper_free`
 * stays the stats + injury source (Q1's ruling: "sleeper_free stays the
 * stats source; nflverse supplements"). `getWeekStats`/`getInjuries`
 * return `[]` and say so in `lastReport.reasons` — `ingestWeek` then names
 * the empty section in its own report (loud emptiness, never a silent
 * empty sync). Compose with `withNflverseCalendar(sleeper, nflverse)` for a
 * provider that carries both.
 *
 * Time only via the injected `TimeProvider` (the D3 fence covers this
 * directory); the network only via the injected `fetchText` (tests inject
 * the recorded `__fixtures__` files and never touch the network).
 */

import { z } from 'zod'

import { NFL_TEAMS } from '@/lib/nfl-teams'

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
import { parseCsv, requireColumns, toObjects } from './csv'
import { easternToUtc } from './eastern-time'

// ── The published files (release assets; pinned paths) ────────────────────

export const NFLVERSE_RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download'

export const NFLVERSE_URLS = {
  /** All seasons, all game types, one file (~2 MB). */
  games: `${NFLVERSE_RELEASE_BASE}/schedules/games.csv`,
  /** One file per season; rows per (team, week, player) with roster status. */
  weeklyRosters: (season: number) => `${NFLVERSE_RELEASE_BASE}/weekly_rosters/roster_weekly_${season}.csv`,
} as const

export type FetchText = (url: string) => Promise<string>

/** The default transport: a plain GET of a published file. */
export const fetchTextViaHttp: FetchText = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`nflverse fetch failed: ${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

// ── Team vocabulary (house codes are nfl-teams.ts's) ──────────────────────

/** nflverse code → house code. Every other 2026 nflverse code already IS a
 *  house code (measured against the 2026 rows of games.csv, 2026-09-02). */
export const NFLVERSE_TEAM_TO_HOUSE: Readonly<Record<string, string>> = {
  LA: 'LAR',
}

export function mapNflverseTeam(code: string): string {
  const mapped = NFLVERSE_TEAM_TO_HOUSE[code] ?? code
  if (!(mapped in NFL_TEAMS)) {
    throw new Error(
      `nflverse team code "${code}" is not a house team code (nfl-teams.ts) — extend NFLVERSE_TEAM_TO_HOUSE deliberately`,
    )
  }
  return mapped
}

// ── Row shapes (Zod — the file is data, never trusted) ────────────────────

export const GAMES_REQUIRED_COLUMNS = [
  'game_id',
  'season',
  'game_type',
  'week',
  'gameday',
  'gametime',
  'away_team',
  'home_team',
  'away_score',
  'home_score',
  'result',
] as const

const intString = z.string().regex(/^\d+$/)

export const nflverseGameRowSchema = z.object({
  game_id: z.string().min(1),
  season: intString,
  game_type: z.string().min(1),
  week: intString,
  gameday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Eastern wall time; empty when the league has not set a time yet. */
  gametime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]),
  away_team: z.string().min(2).max(3),
  home_team: z.string().min(2).max(3),
  away_score: z.string(),
  home_score: z.string(),
  result: z.string(),
})
export type NflverseGameRow = z.infer<typeof nflverseGameRowSchema>

export const ROSTER_REQUIRED_COLUMNS = [
  'season',
  'team',
  'position',
  'status',
  'full_name',
  'gsis_id',
  'sleeper_id',
  'week',
  'game_type',
] as const

export const nflverseRosterRowSchema = z.object({
  season: intString,
  team: z.string().min(2).max(3),
  position: z.string(),
  status: z.string().min(1),
  full_name: z.string(),
  gsis_id: z.string(),
  sleeper_id: z.string(),
  week: intString,
  game_type: z.string().min(1),
})
export type NflverseRosterRow = z.infer<typeof nflverseRosterRowSchema>

/** The roster status that means "on the active roster, declared inactive for
 *  the game" (measured: 5–6 per team per played week, 0 on byes). */
export const INACTIVE_STATUS = 'INA'
export const REGULAR_SEASON = 'REG'

// ── Parsing (pure; unit-tested on the recorded fixtures) ──────────────────

function parseRows<T>(
  text: string,
  required: readonly string[],
  schema: z.ZodType<T>,
  what: string,
): T[] {
  const table = parseCsv(text)
  requireColumns(table, required, what)
  return toObjects(table).map((obj, k) => {
    const parsed = schema.safeParse(obj)
    if (!parsed.success) {
      throw new Error(`${what}: row ${k + 1} does not match the expected shape — ${parsed.error.message}`)
    }
    return parsed.data
  })
}

export function parseGamesCsv(text: string): NflverseGameRow[] {
  return parseRows(text, GAMES_REQUIRED_COLUMNS, nflverseGameRowSchema, 'nflverse games.csv')
}

export function parseWeeklyRosterCsv(text: string): NflverseRosterRow[] {
  return parseRows(text, ROSTER_REQUIRED_COLUMNS, nflverseRosterRowSchema, 'nflverse roster_weekly.csv')
}

/** nflverse can only say "a result is posted" (final) or not (scheduled). */
export function mapNflverseGameStatus(row: Pick<NflverseGameRow, 'result' | 'home_score' | 'away_score'>): ProviderGame['status'] {
  const posted = row.result !== '' || (row.home_score !== '' && row.away_score !== '')
  return posted ? 'final' : 'scheduled'
}

/** One games.csv row → the §23.1 game. `kickoffAt` is null only when the
 *  league has not published a time (empty `gametime`); the day is still
 *  carried on `gameDate`. */
export function toProviderGame(row: NflverseGameRow): ProviderGame {
  return {
    gameId: row.game_id,
    season: Number(row.season),
    week: Number(row.week),
    homeTeam: mapNflverseTeam(row.home_team),
    awayTeam: mapNflverseTeam(row.away_team),
    kickoffAt: row.gametime === '' ? null : easternToUtc(row.gameday, row.gametime),
    gameDate: row.gameday,
    status: mapNflverseGameStatus(row),
  }
}

// ── The provider ──────────────────────────────────────────────────────────

export interface NflverseCallReport {
  method: 'getSchedule' | 'getGameStates' | 'getWeekStats' | 'getInjuries' | 'getInactives'
  counts: Record<string, number>
  /** Why something was dropped or empty — never a silent empty. */
  reasons: string[]
}

export interface NflverseProviderOptions {
  fetchText?: FetchText
  urls?: { games?: string; weeklyRosters?: (season: number) => string }
}

export class NflverseProvider implements StatsProvider {
  readonly name = 'nflverse'
  /** Supplies no stat lines at all — no §23.5 tier is claimed. */
  readonly capabilities: ReadonlySet<StatTier> = new Set<StatTier>()

  /** Diagnostics of every call since construction (or `resetReports()`) —
   *  loud emptiness for provider methods that have no report channel of
   *  their own; `ingestWeek` calls `getSchedule` then `getWeekStats`, so a
   *  caller wanting the schedule's counts reads this log, not just the last
   *  entry. */
  readonly reports: NflverseCallReport[] = []

  /** The most recent call's diagnostics. */
  get lastReport(): NflverseCallReport | null {
    return this.reports.length === 0 ? null : this.reports[this.reports.length - 1]
  }

  resetReports(): void {
    this.reports.length = 0
  }

  private report(entry: NflverseCallReport): void {
    this.reports.push(entry)
  }

  private readonly fetchText: FetchText
  private readonly urls: { games: string; weeklyRosters: (season: number) => string }

  constructor(private readonly time: TimeProvider, opts: NflverseProviderOptions = {}) {
    this.fetchText = opts.fetchText ?? fetchTextViaHttp
    this.urls = {
      games: opts.urls?.games ?? NFLVERSE_URLS.games,
      weeklyRosters: opts.urls?.weeklyRosters ?? NFLVERSE_URLS.weeklyRosters,
    }
  }

  async getSchedule(season: number): Promise<ProviderGame[]> {
    const rows = parseGamesCsv(await this.fetchText(this.urls.games))
    const seasonRows = rows.filter((r) => Number(r.season) === season)
    if (seasonRows.length === 0) {
      // A season the file does not carry is an integrity problem for the
      // caller (wrong season, or a moved asset) — never an empty success.
      throw new Error(
        `nflverse games.csv carries zero rows for season ${season} (${rows.length} rows in the file) — refusing an empty schedule`,
      )
    }
    const regular = seasonRows.filter((r) => r.game_type === REGULAR_SEASON)
    const games = regular.map(toProviderGame)
    const withoutKickoff = games.filter((g) => g.kickoffAt === null).length
    const reasons: string[] = []
    if (seasonRows.length - regular.length > 0) {
      reasons.push(
        `${seasonRows.length - regular.length} postseason row(s) dropped — regular season only (the sleeper tier's scope; nfl_games.game_type defaults to 'regular')`,
      )
    }
    if (withoutKickoff > 0) reasons.push(`${withoutKickoff} game(s) have no published gametime yet — kickoffAt null, gameDate kept`)
    this.report({
      method: 'getSchedule',
      counts: { fileRows: rows.length, seasonRows: seasonRows.length, regular: regular.length, withoutKickoff },
      reasons,
    })
    return games
  }

  async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    const games = (await this.getSchedule(season)).filter((g) => g.week === week)
    this.report({ method: 'getGameStates', counts: { games: games.length }, reasons: [] })
    return games.map((g) => ({ gameId: g.gameId, status: g.status }))
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract args; nflverse is not the stats source (Q1)
  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    this.report({
      method: 'getWeekStats',
      counts: { lines: 0 },
      reasons: ['nflverse supplies no stat lines — sleeper_free is the stats source (Q1); compose via withNflverseCalendar'],
    })
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract args; nflverse is not the injury-designation source (Q1)
  async getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    this.report({
      method: 'getInjuries',
      counts: { injuries: 0 },
      reasons: ['nflverse supplies no injury designations here — sleeper_free is the designation source (Q1); compose via withNflverseCalendar'],
    })
    return []
  }

  /**
   * Official game-day inactives for (season, week): `status = 'INA'` rows of
   * the season's weekly roster file, grouped onto the week's game per team
   * (C56: the feed, never `players.status`). `publishedAt` is the injected
   * observation instant (D16's accepted limitation).
   */
  async getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    const [rows, schedule] = await Promise.all([
      (async () => parseWeeklyRosterCsv(await this.fetchText(this.urls.weeklyRosters(season))))(),
      this.getSchedule(season),
    ])
    const weekGames = schedule.filter((g) => g.week === week)
    const gameByTeam = new Map<string, ProviderGame>()
    for (const g of weekGames) {
      gameByTeam.set(g.homeTeam, g)
      gameByTeam.set(g.awayTeam, g)
    }

    const inactiveRows = rows.filter(
      (r) => Number(r.season) === season && Number(r.week) === week && r.game_type === REGULAR_SEASON && r.status === INACTIVE_STATUS,
    )
    const byGame = new Map<string, Set<string>>()
    let withoutSleeperId = 0
    const teamsWithoutGame = new Set<string>()
    for (const r of inactiveRows) {
      const team = mapNflverseTeam(r.team)
      const game = gameByTeam.get(team)
      if (!game) {
        teamsWithoutGame.add(team)
        continue
      }
      if (r.sleeper_id === '') {
        withoutSleeperId += 1
        continue
      }
      if (!byGame.has(game.gameId)) byGame.set(game.gameId, new Set())
      byGame.get(game.gameId)!.add(r.sleeper_id)
    }

    const publishedAt = this.time.now()
    const out: ProviderInactives[] = [...byGame.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([gameId, ids]) => ({ gameId, playerIds: [...ids].sort(), publishedAt }))

    const reasons: string[] = []
    if (inactiveRows.length === 0) {
      const finals = weekGames.filter((g) => g.status === 'final').length
      reasons.push(
        finals > 0
          ? `zero INA rows for ${season} week ${week} although ${finals} game(s) are final — the roster file may not have caught up (T+1), or its status vocabulary changed`
          : `zero INA rows for ${season} week ${week} — no game of the week is final yet (nothing to declare)`,
      )
    }
    if (withoutSleeperId > 0) reasons.push(`${withoutSleeperId} inactive row(s) carry no sleeper_id (positions Sleeper does not track) — dropped`)
    if (teamsWithoutGame.size > 0) {
      reasons.push(
        `${teamsWithoutGame.size} team(s) with INA rows but no ${season} week ${week} game in the schedule — ${[...teamsWithoutGame].sort().join(', ')} (a bye week never carries INA rows; measured 2025)`,
      )
    }
    this.report({
      method: 'getInactives',
      counts: {
        fileRows: rows.length,
        inactiveRows: inactiveRows.length,
        games: out.length,
        players: out.reduce((n, g) => n + g.playerIds.length, 0),
        withoutSleeperId,
        teamsWithoutGame: teamsWithoutGame.size,
      },
      reasons,
    })
    return out
  }
}

// ── Composition: a live tier's stats + nflverse's calendar ────────────────

/** scheduled < live < final < postponed — the more advanced reading wins
 *  per game; `postponed` is a positive claim ("left the week", E43) that a
 *  T+1 `scheduled` must not undo. */
export const GAME_STATUS_RANK: Readonly<Record<ProviderGame['status'], number>> = {
  scheduled: 0,
  live: 1,
  final: 2,
  postponed: 3,
}

export function mergeGameStatus(a: ProviderGame['status'], b: ProviderGame['status']): ProviderGame['status'] {
  return GAME_STATUS_RANK[a] >= GAME_STATUS_RANK[b] ? a : b
}

function matchKey(g: Pick<ProviderGame, 'week' | 'homeTeam' | 'awayTeam'>): string {
  return `${g.week}:${g.awayTeam}@${g.homeTeam}`
}

export interface CompositeScheduleReport {
  nflverseGames: number
  baseGames: number
  matched: number
  /** Base-tier games with no nflverse counterpart (ignored — nflverse is the calendar of record). */
  baseOnly: number
}

/**
 * `withNflverseCalendar(base, nflverse)` — the provider the go-forward sync
 * binds (L.D2.3/F216): nflverse's schedule (kickoffs, ids, house team
 * codes) with the base tier's LIVE status merged in per game (matched on
 * week + away@home — both feeds speak house codes after mapping), the base
 * tier's stat lines and injury designations, and nflverse's inactives.
 * Name: `<base>+nflverse` — `player_stats.source` then says honestly where
 * each row came from (F13/D300: `source = provider.name`).
 */
export function withNflverseCalendar(base: StatsProvider, nflverse: NflverseProvider): StatsProvider & { lastScheduleReport: CompositeScheduleReport | null } {
  const composite = {
    name: `${base.name}+nflverse`,
    capabilities: base.capabilities,
    lastScheduleReport: null as CompositeScheduleReport | null,

    async getSchedule(season: number): Promise<ProviderGame[]> {
      const [calendar, live] = await Promise.all([nflverse.getSchedule(season), base.getSchedule(season)])
      const liveByKey = new Map<string, ProviderGame>()
      for (const g of live) liveByKey.set(matchKey(g), g)
      let matched = 0
      const merged = calendar.map((g) => {
        const counterpart = liveByKey.get(matchKey(g))
        if (!counterpart) return g
        matched += 1
        liveByKey.delete(matchKey(g))
        return { ...g, status: mergeGameStatus(g.status, counterpart.status) }
      })
      composite.lastScheduleReport = {
        nflverseGames: calendar.length,
        baseGames: live.length,
        matched,
        baseOnly: liveByKey.size,
      }
      return merged
    },

    async getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
      const games = (await composite.getSchedule(season)).filter((g) => g.week === week)
      return games.map((g) => ({ gameId: g.gameId, status: g.status }))
    },

    getWeekStats: (season: number, week: number) => base.getWeekStats(season, week),
    getInjuries: (season: number, week: number) => base.getInjuries(season, week),
    getInactives: (season: number, week: number) => nflverse.getInactives(season, week),
  }
  return composite
}
