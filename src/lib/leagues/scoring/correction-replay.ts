/**
 * correction-replay — the replay harness of M6 L.E2.6 (tasks-M6 §6 L.E2.6;
 * spec §23.4 / §12.21 / TD2 as amended by F511; PROGRESS D453 / D458 and
 * the 2026-10-02 ruling recorded as D468). PURE: no fs, no network, no
 * clock — the stack test (`correction-replay-db.test.ts`) owns the IO.
 *
 * WHAT IT REPLAYS. A PAIR of recorded snapshots of one NFL week in the
 * L.A0.4 fixture format (D6 / D27): snapshot 1 = the week's lines once every
 * game is final, snapshot 2 = the same week later, carrying a change to ONE
 * player's scoring stat. The pair is either a REAL capture
 * (`fixtures/nfl/2026/wkNN/`, L.E2.5's recorder — chosen by
 * `scripts/correction-replay-source.ts`) or the SYNTHETIC pair
 * (`__fixtures__/correction-replay-synthetic.ts` — made up, and named so in
 * its provider identity). Both go through the SAME code below, so the
 * synthetic run proves the path the real one takes.
 *
 * WHAT IS CONSTRUCTED, SAID PLAINLY. The stat lines are the recording's,
 * byte for byte. Three things are the test's own:
 *   1. The CALENDAR LABEL: the week is replayed as week 1 of a test season
 *      (and the following week as week 2) and every game id is prefixed, so
 *      a replay can never touch a real `nfl_games` / `player_stats` row. The
 *      instants (kickoffs) are the recording's.
 *   2. The LEAGUE: built around the corrected player — Team A starts him.
 *   3. The OPPONENT'S LINE: Team B starts a test player whose line is the
 *      corrected player's snapshot-2 line with the corrected stat moved ONE
 *      unit back toward the old value (`constructOpponentLine`). So the real
 *      delta decides the matchup: with a change of 2+ units the result FLIPS;
 *      with a change of exactly 1 unit the matchup goes from a tie to a
 *      result (still a changed result). The test asserts which, by name.
 */
import type { FixtureEntry, FixtureMethod, FixtureRecording } from '@/lib/leagues/stats/fixtures/fixture-format'
import { reviveDates } from '@/lib/leagues/stats/fixtures/fixture-format'
import type { StatTier } from '@/lib/leagues/stats/stat-keys'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'

/** Where a pair came from — printed in every test name and provider identity. */
export type ReplayOrigin = 'real' | 'synthetic'

/** The one change a replay is built around (from the snapshot diff for a real pair). */
export interface ReplayChange {
  playerId: string
  statKey: string
  old: number
  new: number
  name: string
  position: string
  nflTeam: string | null
}

export interface ReplayPair {
  origin: ReplayOrigin
  /** e.g. `fixtures/nfl/2026/wk04 (sleeper+nflverse)` or `synthetic (test fixture)`. */
  label: string
  first: FixtureRecording
  second: FixtureRecording
  change: ReplayChange
}

/** One snapshot, read the replayer's way (D6: the latest SUCCESSFUL response per call). */
export interface ReplaySnapshot {
  /** Capture instant of the week's lines. */
  t: string
  games: ProviderGame[]
  lines: ProviderPlayerWeekStats[]
}

function latestOk(rec: FixtureRecording, method: FixtureMethod, args: readonly number[]): FixtureEntry {
  const hits = rec.entries
    .filter((e) => e.method === method && e.ok && e.args.length === args.length && e.args.every((v, i) => v === args[i]))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
  const last = hits[hits.length - 1]
  // A snapshot without the read is not a snapshot — never an empty replay.
  if (last === undefined) throw new Error(`correction replay: the recording has no successful ${method}(${args.join(',')})`)
  return last
}

/**
 * The snapshot, relabelled onto the test calendar: the recorded week → week 1
 * of `season`, the recorded week + 1 → week 2, every other week dropped (the
 * ingest skips weeks its calendar does not know anyway); every game id
 * prefixed. Stat VALUES are never touched.
 */
export function readReplaySnapshot(rec: FixtureRecording, target: { season: number; gamePrefix: string }): ReplaySnapshot {
  const { season, week } = rec.header
  const statsEntry = latestOk(rec, 'getWeekStats', [season, week])
  const scheduleEntry = latestOk(rec, 'getSchedule', [season])
  const weekMap = new Map([[week, 1], [week + 1, 2]])
  const gid = (id: string | undefined) => (id === undefined ? undefined : `${target.gamePrefix}${id}`)
  const games = (reviveDates(scheduleEntry.body) as ProviderGame[])
    .filter((g) => weekMap.has(g.week))
    .map((g) => ({ ...g, gameId: gid(g.gameId)!, season: target.season, week: weekMap.get(g.week)! }))
  const lines = (reviveDates(statsEntry.body) as ProviderPlayerWeekStats[]).map((l) => {
    const out: ProviderPlayerWeekStats = { ...l, season: target.season, week: 1, stats: { ...l.stats }, advanced: { ...l.advanced } }
    if (l.gameId !== undefined) out.gameId = gid(l.gameId)
    else delete out.gameId
    return out
  })
  if (!games.some((g) => g.week === 1)) throw new Error(`correction replay: the recording's schedule has no game in week ${week}`)
  return { t: statsEntry.t, games, lines }
}

/** The week's calendar instants, from the snapshot's own schedule. */
export function replayCalendar(snap: ReplaySnapshot): { firstKickoff: Date; lastKickoff: Date; nextKickoff: Date } {
  const kicks = (w: number) =>
    snap.games
      .filter((g) => g.week === w && g.kickoffAt !== null)
      .map((g) => (g.kickoffAt as Date).getTime())
      .sort((a, b) => a - b)
  const w1 = kicks(1)
  const w2 = kicks(2)
  if (w1.length === 0) throw new Error('correction replay: no kickoff in the replayed week')
  // §23.4 / 158: the correction window closes at the NEXT week's first kickoff.
  if (w2.length === 0) throw new Error('correction replay: the schedule carries no next-week kickoff — the correction window cannot be placed')
  return { firstKickoff: new Date(w1[0]), lastKickoff: new Date(w1[w1.length - 1]), nextKickoff: new Date(w2[0]) }
}

/** The line of one player in a snapshot — throws when absent (never a silent zero). */
export function lineOf(snap: ReplaySnapshot, playerId: string): ProviderPlayerWeekStats {
  const line = snap.lines.find((l) => l.playerId === playerId)
  if (line === undefined) throw new Error(`correction replay: no line for ${playerId} in the snapshot captured ${snap.t}`)
  return line
}

/** What the constructed opponent makes of the real delta. */
export type ConstructedOutcome = 'flip' | 'from_tie' | 'no_flip'

/**
 * Team B's starter: the corrected player's snapshot-2 line with the corrected
 * stat moved ONE unit back toward the old value (see the header, item 3).
 * Pure; integer-valued (the `player_stats` columns are integers).
 */
export function constructOpponentLine(
  before: ProviderPlayerWeekStats,
  after: ProviderPlayerWeekStats,
  statKey: string,
  opponentId: string,
): { line: ProviderPlayerWeekStats; outcome: ConstructedOutcome; value: number } {
  const oldV = before.stats[statKey] ?? 0
  const newV = after.stats[statKey] ?? 0
  if (oldV === newV) throw new Error(`correction replay: ${statKey} did not change (${oldV} → ${newV}) — nothing to replay`)
  const twoOrMore = Math.abs(oldV - newV) >= 2
  const value = twoOrMore ? newV + Math.sign(oldV - newV) : oldV
  const line: ProviderPlayerWeekStats = {
    ...after,
    playerId: opponentId,
    stats: { ...after.stats, [statKey]: value },
    advanced: { ...after.advanced },
  }
  return { line, outcome: twoOrMore ? 'flip' : 'from_tie', value }
}

/**
 * R1438: the NO-FLIP construction — the opponent's line is the corrected
 * player's own line with the corrected key set FAR above both values (ten
 * times the larger, plus 100), so the correction moves Team A's score and
 * Team A loses before and after. Same key, same template — only the margin.
 */
export function constructFarAheadOpponentLine(
  before: ProviderPlayerWeekStats,
  after: ProviderPlayerWeekStats,
  statKey: string,
  opponentId: string,
): { line: ProviderPlayerWeekStats; outcome: ConstructedOutcome; value: number } {
  const oldV = before.stats[statKey] ?? 0
  const newV = after.stats[statKey] ?? 0
  if (oldV === newV) throw new Error(`correction replay: ${statKey} did not change (${oldV} → ${newV}) — nothing to replay`)
  const value = Math.max(Math.abs(oldV), Math.abs(newV)) * 10 + 100
  const line: ProviderPlayerWeekStats = { ...after, playerId: opponentId, stats: { ...after.stats, [statKey]: value }, advanced: { ...after.advanced } }
  return { line, outcome: 'no_flip', value }
}

/**
 * A StatsProvider over the pair: `phase` 1 serves snapshot 1, phase 2 serves
 * snapshot 2 — plus the constructed lines (the opponent's), identical in both.
 * Only the two reads `ingestWeek` makes carry data; the rest are empty.
 */
export class ReplayPairProvider implements StatsProvider {
  readonly name: string
  readonly capabilities: ReadonlySet<StatTier> = new Set<StatTier>(['core_box'])
  phase: 1 | 2 = 1

  constructor(
    private readonly snapshots: { 1: ReplaySnapshot; 2: ReplaySnapshot },
    private readonly constructed: readonly ProviderPlayerWeekStats[],
    origin: ReplayOrigin,
    recordedProvider: string,
  ) {
    this.name = `replay:${origin}:${recordedProvider}`
  }

  private current(): ReplaySnapshot {
    return this.snapshots[this.phase]
  }

  async getSchedule(season: number): Promise<ProviderGame[]> {
    return this.current().games.filter((g) => g.season === season)
  }

  async getGameStates(): Promise<ProviderGameState[]> {
    return []
  }

  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    if (week !== 1) return []
    return [...this.current().lines, ...this.constructed].filter((l) => l.season === season)
  }

  async getInjuries(): Promise<ProviderInjury[]> {
    return []
  }

  async getInactives(): Promise<ProviderInactives[]> {
    return []
  }
}

/** The starting slot for a position under the default roster (league-settings DEFAULT_ROSTER_SETTINGS). */
export function slotForPosition(position: string): string {
  const key = { QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'dst', DST: 'dst' }[position.toUpperCase()]
  if (key === undefined) throw new Error(`correction replay: no default starting slot for position ${position}`)
  return `${key}:0`
}
