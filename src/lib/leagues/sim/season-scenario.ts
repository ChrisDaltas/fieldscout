/**
 * The §23.6 scenario, re-anchored onto the sim's synthetic calendar and
 * bridged onto REAL players — M4 task L.D6.1 (tasks-M4-inseason.md §6
 * L.D6.1 item 1; delivery plan §4.2; spec §23.6).
 *
 * PURE. No I/O, no clock, no entropy: two total functions over
 * `makeScenario(id, seed)`'s output plus the candidate rows the caller read.
 * `makeScenario` itself is NOT touched — the M0 gate re-records `happy_path`
 * at (2026, week 2) with the library's own ids and byte-compares it against
 * `fixtures/nfl/2026/wk02/synthetic.jsonl.gz`, so any edit to the library's
 * DEFAULT output would move that fixture and force a
 * `SCENARIO_LIBRARY_VERSION` bump. This module is additive and downstream:
 * the fixture, the library version, and every existing pin are untouched.
 *
 * ── 1. THE RE-ANCHOR (a pure shift) ────────────────────────────────────────
 * The library is authored on 2026 week 2 (`scenarios.ts:29-30`). The sim
 * runs on `SYNTHETIC_SEASON` (2099) so no run depends on the wall clock
 * (F215 / `synthetic-season.ts`). `anchorScenario` shifts EVERY instant in
 * the scenario by one delta — the target week's `starts_at` minus the
 * library week's `starts_at` — so every offset from the week's start is
 * preserved exactly: kickoffs, durations, announce instants, the inactives
 * lead, charted post/SLA, corrections, revisions and the outage window all
 * keep their position within the week.
 *
 * The delta is exact by arithmetic, not by luck. `synthetic-season.ts`
 * derives its weeks from "the 2026 opener's calendar shape (039)": week N
 * starts Wednesday 00:00 ET and the correction window closes the following
 * Thursday 06:00 ET, i.e. `starts_at + 8d 6h`. The seeded 2026 week-2 row
 * is `starts_at 2026-09-16T04:00Z` / `correction_window_ends_at
 * 2026-09-24T10:00Z` (measured on the local stack), and the library's
 * `CORRECTION_WINDOW_ENDS_AT` is that same instant — so shifting the
 * scenario's window end by the delta lands it EXACTLY on the target week's
 * stored `correction_window_ends_at`. `assertAnchorConsistent` re-checks
 * that against the row the caller read rather than trusting the derivation
 * (loud, never a plausible match).
 *
 * What the shift deliberately does NOT do: invent a meaning for a scenario
 * at a different point in the season. §23.6 declares one week's world; the
 * shift moves that world's clock and nothing else. `postponement` still
 * means "this game leaves the week" because its new kickoff is still +7
 * days, which is still at or past the NEXT calendar week's `starts_at`
 * (116's `week_games_state_internal` rule) on a synthetic season whose
 * weeks are exactly 7 days apart — the same relation the library was
 * authored against.
 *
 * ── 2. THE PLAYER BRIDGE (a bijective renaming) ────────────────────────────
 * The library's 18 players are `syn-g{1,2,3}-{qb,rb,wr,te,k,def}`
 * (`scenarios.ts:76-89`) and exist in no `players` row. The sim deliberately
 * seeds NO players — bots draft the REAL local pool (`runner.ts:56-58`, the
 * R286 lesson) — and `ingestWeek` counts a line for an unknown id into
 * `unknownPlayer` and writes nothing (`ingest-week.ts:133-140`). As built,
 * therefore, no drafted starter would ever receive a stat line.
 *
 * THE CHOICE, AND WHAT IT COSTS (recorded — PROGRESS D327):
 * the bridge is a BIJECTIVE RENAMING of the scenario's 18 player ids onto 18
 * REAL player ids, chosen by (game, position) from the players whose
 * `players.team` is one of that game's two clubs. The library's three games
 * already carry REAL NFL abbreviations — DAL@PHI, BUF@KC, SEA@SF — so the
 * renaming needs no change to the slate, and `players.team` still joins
 * `nfl_games.home_team/away_team` (112's lock datum, 115's game-day lock) for
 * every bridged player.
 *
 *   - What is preserved: the timing skeleton, the game slate, every declared
 *     event, and the library's documented determinism split. Lines still
 *     draw from `(seed, playerId)` only (`prng.ts:35-37`), and the renaming
 *     is a pure function of the environment's `players` rows — NOT of the
 *     scenario id — so two scenarios at one seed still emit identical lines
 *     for the same bridged player, which is exactly what the `provider_outage`
 *     back-fill proof rests on (`scenario.ts:15-18`; `scenarios.ts:9-11`;
 *     `ingest-week-db.test.ts:435`). That property survives; it is pinned in
 *     `season-scenario.test.ts`.
 *   - What it COSTS, said plainly: a bridged player's numbers are
 *     `finalLine(seed, <real id>)`, not `finalLine(seed, 'syn-g1-qb')`. The
 *     slot's VALUES therefore differ from the M0 fixture's values for the
 *     corresponding synthetic slot, and a `sim season` run only reproduces
 *     against the same `players` table. That is why `bridgeLines` prints the
 *     whole map into the run report: a replay in a different pool is
 *     detectable by comparing eighteen printed lines, never silently
 *     different.
 *   - The options NOT taken, and why: seeding the 18 synthetic ids as real
 *     `players` rows would break `runner.ts:56-58` outright and add a
 *     `players`-row teardown to F199's blast radius; planting `player_stats`
 *     directly would forfeit `source = 'synthetic'` (D300/F13), which is the
 *     synthetic gate's own zero-real-data instrument.
 *
 * THE COVERAGE COST, also said plainly: §23.6's world has EIGHTEEN players
 * and three games. That is the library's law, not an artefact of this
 * bridge. A sim league therefore holds at most 18 scorable players however
 * many teams it seats, and every other starter is a lawful `no_stat_row`
 * (the worker's Q42 reading — OPEN; the sweep asserts the worker's REPORT,
 * never the arithmetic consequence). The runner measures and prints the real
 * numbers (`bridge.rostered` / `bridge.started`) rather than implying more.
 *
 * ── 3. THE FULL SLATE (fixture construction — F286 / PROGRESS D328) ────────
 * §23.6's world publishes THREE games over SIX clubs. `SEASON_ROSTER` starts
 * six positions off a seven-player roster drafted from the real pool across
 * all thirty-two clubs, and §7.3.6 (114:605-615) refuses a submit that starts
 * a player whose club has NO GAME that week (`lineup_kickoff_internal`
 * returns `on_bye = TRUE` when no `nfl_games` row for the week carries the
 * club — 112:417-422). The D299 matrix guarantees one
 * `allow_illegal_lineups = false` league at n >= 5 leagues, and in that
 * league a team would have to fill all six starting slots from six clubs out
 * of seven players drafted from thirty-two — which essentially never happens.
 * Measured: every run at n >= 5 ended RED on `set_lineup` 409s (F286).
 *
 * THE FIX IS TO MAKE THE SIM'S WORLD COMPLETE, not to soften the assertion.
 * The three options F286 recorded were (a) seat only players whose club has a
 * game — necessary but NOT sufficient, it picks the best of an impossible
 * set; (b) declare `no legal lineup available` a lawful named state — which
 * makes the run green while the guaranteed legality league exercises NOTHING
 * (decorative coverage, D267); (c) drop the OFF arm — deleting the coverage.
 * `withFullSlate` takes none of them: the anchoring layer already owns the
 * week's `nfl_games` rows under the F199 sweep prefix, so it PUBLISHES A FULL
 * SLATE — the scenario's own three games with their exact ids, beats, timings
 * and assertions, plus one ordinary FILLER game for every other club — and
 * §7.3.6 becomes satisfiable for a real lineup. (a) survives as the residual
 * necessary condition it always was: with every club playing, the only
 * §7.3.6 blocker left is an OUT/IR/PUP/NFI/Suspended DESIGNATION, and
 * `chooseStarterSlots` (season-runner.ts) passes those over in an OFF league.
 *
 * THIS IS FIXTURE CONSTRUCTION IN THE SIM LAYER, NOT A LIBRARY CHANGE
 * (R801's line). `makeScenario`'s published output is untouched — the filler
 * games are appended to the ANCHORED copy, downstream of the transform, and
 * only ever reach the `SyntheticStatsProvider` the sim constructs. The M0
 * gate's byte-compare against `fixtures/nfl/2026/wk02/synthetic.jsonl.gz`
 * therefore cannot move, `SCENARIO_LIBRARY_VERSION` does not bump, and the
 * library's declared games / beats / determinism split are exactly what they
 * were. Pinned in `season-scenario.test.ts`.
 *
 * WHAT A FILLER GAME IS, AND WHAT IT DELIBERATELY IS NOT:
 *   - It carries NO players. §23.6's eighteen are the library's law; a filler
 *     club's starter has a final game and no stat line, which is the same
 *     lawful `no_stat_row` (Q42, OPEN) he already was as a bye — the run
 *     still only COUNTS it and never asserts an arithmetic consequence.
 *   - Its window sits INSIDE the scenario's own: it kicks off at the earliest
 *     kickoff of a game the scenario never postpones and runs for that same
 *     game's duration. So `weekBounds` cannot move
 *     `nfl_weeks.first_kickoff_at` (the filler kickoff is never earlier than
 *     the in-week minimum) and cannot move the instant every in-week game
 *     first reads `final` (the filler ends no later than the last core game).
 *     `assertSlateInsideCore` re-checks both, and THROWS rather than publish
 *     a slate that would move a beat the scenario declares.
 *   - Its charted times are its own game end, never borrowed from a scenario
 *     game whose charted timing is itself the observable under test
 *     (`charted_late`). Nothing reads them: `ingestWeek` calls `getSchedule`
 *     and `getWeekStats` only.
 *   - Its id comes from `anchoredGameId`, so it carries
 *     `SIM_SEASON_GAME_PREFIX` and is counted by `sim-census.ts` and deleted
 *     by `cleanupSweep`'s prefix sweep exactly like a scenario game (F199 is
 *     OPEN; this must not widen its blast radius, and it does not).
 *   - The DRIVER's timeline is built from the CORE anchored scenario, never
 *     from the published one, so the fillers contribute no instants and no
 *     beat. That is structural, not a convention: `driveSeason` keeps the two
 *     objects apart.
 */
import type {
  ScenarioId,
  SyntheticGameDef,
  SyntheticPlayerDef,
  SyntheticScenario,
} from '../stats/synthetic/scenario'

/** The season the §23.6 library is authored on (`scenarios.ts:29`). */
export const LIBRARY_SEASON = 2026
/** The week the §23.6 library is authored on (`scenarios.ts:30`). */
export const LIBRARY_WEEK = 2

/**
 * `nfl_weeks` (2026, week 2) `starts_at` — the instant every library offset
 * is measured from. A STORED LITERAL (the §4.3 golden-pin discipline), and
 * cross-checked at run time against the seeded row by
 * `assertAnchorConsistent`, so a calendar re-seed cannot silently move the
 * anchor under the transform.
 */
export const LIBRARY_WEEK_STARTS_AT = '2026-09-16T04:00:00.000Z'

/**
 * `nfl_weeks` (2026, week 2) `correction_window_ends_at` — the same instant
 * the library declares as `CORRECTION_WINDOW_ENDS_AT` (`scenarios.ts:41`).
 * The equality of these two literals is what makes the shift land the
 * scenario's window end exactly on the target week's stored close.
 */
export const LIBRARY_WEEK_WINDOW_ENDS_AT = '2026-09-24T10:00:00.000Z'

/** Every anchored `nfl_games.id` carries this prefix — the F199 sweep key. */
export const SIM_SEASON_GAME_PREFIX = 'simseason-'

export interface AnchorTarget {
  season: number
  week: number
  /** The target week's `nfl_weeks.starts_at`, as read from the calendar. */
  weekStartsAt: string
  /** The target week's `nfl_weeks.correction_window_ends_at`, as read. */
  weekWindowEndsAt: string
}

/** A `players` row as the bridge reads it. */
export interface BridgeCandidate {
  id: string
  position: string
  team: string | null
  adp: number | null
}

export interface PlayerBridge {
  /** scenario player id → real `players.id`. Injective by construction. */
  map: ReadonlyMap<string, string>
  /** Scenario players with no eligible real candidate — LOUD, never a skip. */
  misses: readonly string[]
}

/** DEF (the feed's vocabulary) and DST (§7.3.3.1's) name one position. */
function samePosition(a: string, b: string): boolean {
  const na = a.trim().toUpperCase() === 'DST' ? 'DEF' : a.trim().toUpperCase()
  const nb = b.trim().toUpperCase() === 'DST' ? 'DEF' : b.trim().toUpperCase()
  return na === nb
}

/**
 * Choose the 18 real players the scenario's world will speak through.
 *
 * For each scenario player: the candidates are the real players whose
 * `players.team` is the home or away club of that player's GAME and whose
 * position matches; the best ADP wins, ties broken by id ascending (pure —
 * no clock, no entropy). A player already claimed by another slot is
 * skipped, so the map is injective: the three games hold disjoint club
 * pairs and the six positions are distinct, so a collision is impossible by
 * construction and the guard is a belt.
 */
export function buildPlayerBridge(
  scenario: SyntheticScenario,
  candidates: readonly BridgeCandidate[],
): PlayerBridge {
  const gameById = new Map(scenario.games.map((g) => [g.gameId, g]))
  const map = new Map<string, string>()
  const used = new Set<string>()
  const misses: string[] = []

  for (const player of scenario.players) {
    const game = gameById.get(player.gameId)
    if (game === undefined) {
      misses.push(`${player.playerId} (unknown gameId ${player.gameId})`)
      continue
    }
    const clubs = new Set([game.homeTeam, game.awayTeam])
    const eligible = candidates
      .filter(
        (c) =>
          c.team !== null &&
          clubs.has(c.team) &&
          samePosition(c.position, player.position) &&
          !used.has(c.id),
      )
      .sort((a, b) => {
        const aa = a.adp ?? Number.POSITIVE_INFINITY
        const bb = b.adp ?? Number.POSITIVE_INFINITY
        if (aa !== bb) return aa - bb
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
    const chosen = eligible[0]
    if (chosen === undefined) {
      misses.push(
        `${player.playerId} (${player.position} on ${game.awayTeam}@${game.homeTeam}) — no real player in the pool`,
      )
      continue
    }
    used.add(chosen.id)
    map.set(player.playerId, chosen.id)
  }
  return { map, misses }
}

/** One printed line per bridged slot — the report's replay evidence. */
export function bridgeLines(scenario: SyntheticScenario, bridge: PlayerBridge): string[] {
  const gameById = new Map(scenario.games.map((g) => [g.gameId, g]))
  return scenario.players.map((p) => {
    const g = gameById.get(p.gameId)
    const slate = g === undefined ? '?' : `${g.awayTeam}@${g.homeTeam}`
    return `${p.playerId} (${p.position} ${slate}) -> ${bridge.map.get(p.playerId) ?? '(unbridged)'}`
  })
}

/**
 * The target week's calendar row must agree with the library's anchor: the
 * shifted window end has to be the stored close, to the millisecond. Loud —
 * a mismatch throws rather than producing a scenario whose correction window
 * disagrees with the week it runs in.
 */
export function assertAnchorConsistent(target: AnchorTarget): number {
  const libStart = Date.parse(LIBRARY_WEEK_STARTS_AT)
  const libWindow = Date.parse(LIBRARY_WEEK_WINDOW_ENDS_AT)
  const start = Date.parse(target.weekStartsAt)
  const window = Date.parse(target.weekWindowEndsAt)
  if (!Number.isFinite(start) || !Number.isFinite(window)) {
    throw new Error(
      `anchorScenario: nfl_weeks (${target.season}, week ${target.week}) has an unparseable bound ` +
        `(starts_at=${target.weekStartsAt}, correction_window_ends_at=${target.weekWindowEndsAt})`,
    )
  }
  const shiftMs = start - libStart
  if (libWindow + shiftMs !== window) {
    throw new Error(
      `anchorScenario: the §23.6 anchor does not fit (${target.season} week ${target.week}). ` +
        `Shifting the library week (${LIBRARY_WEEK_STARTS_AT} … ${LIBRARY_WEEK_WINDOW_ENDS_AT}) by ${shiftMs} ms ` +
        `puts the correction window at ${new Date(libWindow + shiftMs).toISOString()}, but the calendar stores ` +
        `${new Date(window).toISOString()} — the transform must preserve every offset from the week's start ` +
        `(L.D6.1 / §23.4), so it refuses rather than run a week whose window it has moved.`,
    )
  }
  return shiftMs
}

function shifted(d: Date, shiftMs: number): Date {
  return new Date(d.getTime() + shiftMs)
}

/** Anchored game ids are week-unique: `nfl_games.id` is the PK, and a second
 *  week re-using week one's id would MOVE that row out of week one (and out
 *  of `week_games_state_internal`'s count for a week already final). */
export function anchoredGameId(
  season: number,
  week: number,
  game: { homeTeam: string; awayTeam: string },
): string {
  return `${SIM_SEASON_GAME_PREFIX}${season}-w${String(week).padStart(2, '0')}-${game.awayTeam}@${game.homeTeam}`
}

/**
 * The thirty-two NFL club abbreviations, as `players.team` and
 * `nfl_games.home_team` / `away_team` spell them. A STORED LITERAL (the §4.3
 * golden-pin discipline) rather than a `SELECT DISTINCT team` — the published
 * slate has to be a pure function of the run's inputs for `--seed` to replay
 * it, and a pool that ever grew a club this list does not know must make the
 * run REFUSE rather than quietly leave that club on a bye. `uncoveredClubs`
 * is that refusal, and `seedLineups` (`season-runner.ts`) calls it against
 * every club each league ACTUALLY rosters — NOT against the pool. R926
 * (#274 review): a club this list does not know is therefore caught only
 * once some league drafts a member of it; a club whose players all sit
 * outside draft reach would slip past until F288 deepens the draft.
 */
export const NFL_CLUBS: readonly string[] = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]

/** The published week: the scenario's own games plus the filler slate. */
export interface FullSlate {
  /** The scenario the `SyntheticStatsProvider` publishes. The core scenario's
   *  games, players, events and window are carried through UNCHANGED. */
  scenario: SyntheticScenario
  /** The filler `nfl_games.id`s — every one carries the F199 sweep prefix. */
  fillerGameIds: readonly string[]
  /** Every club the PUBLISHED slate actually gives a game this week —
   *  derived from the produced games, never from the club roll that was
   *  asked for. (A break probe that emptied the filler list still printed
   *  "32 clubs play" while publishing three games; a coverage claim read off
   *  the INPUT cannot notice that the output is smaller.) */
  clubs: readonly string[]
}

/** Both clubs of every game in a scenario, sorted and de-duplicated. */
export function slateClubs(scenario: SyntheticScenario): string[] {
  const out = new Set<string>()
  for (const g of scenario.games) {
    out.add(g.homeTeam)
    out.add(g.awayTeam)
  }
  return [...out].sort()
}

/**
 * Which clubs the run's real player pool holds that the published slate does
 * NOT give a game. Loud by design: a player whose club has no game reads
 * `on_bye = TRUE` at 112:417-422 and is refused by §7.3.6, so an uncovered
 * club is the exact shape of the bug F286 recorded. A NULL `players.team` is
 * reported as `(null)` for the same reason — `lineup_kickoff_internal`'s
 * `p_nfl_team IS NOT NULL` guard makes a team-less player permanently on bye.
 */
export function uncoveredClubs(
  poolClubs: readonly (string | null)[],
  covered: readonly string[],
): string[] {
  const have = new Set(covered)
  const out = new Set<string>()
  for (const club of poolClubs) {
    if (club === null || club.trim() === '') {
      out.add('(null)')
      continue
    }
    if (!have.has(club)) out.add(club)
  }
  return [...out].sort()
}

/**
 * The filler window must sit INSIDE the core scenario's own, or the fillers
 * would move a beat the scenario declares.
 *
 * R928 (#274 review): the fillers `withFullSlate` builds sit ON both
 * boundaries BY CONSTRUCTION, so neither throw arm below can fire from the
 * sole production caller — this is a REGRESSION GUARD on the twelve lines
 * that compute those bounds, not a live enforcement barrier. The falsifiable
 * protection of the same property is the `weekBounds` composition pin, which
 * runs the real bounds over the real provider at every instant of all nine
 * scenarios and reads REPORTED kickoffs, the dimension this formula misses.
 * (Latent, no scenario exercises it: a future scenario flexing the EARLIEST
 * game EARLIER would move `first_kickoff_at` with this guard still passing;
 * the composition pin iterates SCENARIO_IDS and would red.)
 *
 * Two facts, both from
 * `weekBounds` (`ingest-week.ts:308-317`):
 *
 *   - `first_kickoff_at` is the MINIMUM kickoff over the week's in-week
 *     games. Before a postponement is announced the to-be-postponed game is
 *     still in-week, so the safe lower bound is the minimum over ALL core
 *     games (flexed kickoffs included, since a flex can move a game earlier).
 *     A filler that kicked off before it would move the week's first kickoff
 *     — and with it 111's fallback lock datum.
 *   - `last_game_ends_at` is WRITTEN at the FIRST poll that sees every
 *     in-week game `final`. That observation instant is the maximum end over
 *     the games that stay in the week, i.e. the ones the scenario never
 *     postpones — the same set `driveSeason` uses for its `close` instant. A
 *     filler ending later would push the week's close past the scenario's
 *     own. (Since Q50 the VALUE written is `max(observation, the week's
 *     Tuesday 00:00 Pacific floor)`; the floor is a constant of the week and
 *     identical for both slates, so it cannot tell them apart either — which
 *     is what the composition pin asserts.)
 *
 * Throws rather than publishes. A slate that quietly moved a correction
 * window would be exactly the "plausible result" CLAUDE.md forbids.
 */
export function assertSlateInsideCore(
  core: SyntheticScenario,
  fillers: readonly SyntheticGameDef[],
): void {
  const kickoffs = core.games.flatMap((g) => [
    g.kickoffAt.getTime(),
    ...(g.flexMove ? [g.flexMove.newKickoffAt.getTime()] : []),
  ])
  const earliestCoreKickoff = Math.min(...kickoffs)
  const stayingEnds = core.games
    .filter((g) => g.postponement === undefined)
    .map((g) => (g.flexMove ? g.flexMove.newKickoffAt.getTime() : g.kickoffAt.getTime()) + g.durationMs)
  const latestCoreEnd = Math.max(...stayingEnds)
  for (const f of fillers) {
    const start = f.kickoffAt.getTime()
    const end = start + f.durationMs
    if (start < earliestCoreKickoff) {
      throw new Error(
        `withFullSlate: filler ${f.gameId} kicks off at ${f.kickoffAt.toISOString()}, before the scenario's ` +
          `earliest kickoff ${new Date(earliestCoreKickoff).toISOString()} — that would move ` +
          `nfl_weeks.first_kickoff_at, which the scenario's beats are measured against`,
      )
    }
    if (end > latestCoreEnd) {
      throw new Error(
        `withFullSlate: filler ${f.gameId} ends at ${new Date(end).toISOString()}, after the scenario's ` +
          `last in-week game ends ${new Date(latestCoreEnd).toISOString()} — that would move the instant ` +
          `every in-week game first reads final, and with it nfl_weeks.last_game_ends_at`,
      )
    }
  }
}

/**
 * The ANCHORED scenario, published over a COMPLETE league slate (F286).
 *
 * Every club in `clubs` that the scenario does not already play gets one
 * ordinary game, paired in sorted order (away first), kicking off with the
 * earliest game the scenario never postpones and running for that game's
 * duration. The core scenario is carried through byte-for-byte: same id,
 * version, seed, season, week, window, players, outages, corrections,
 * revisions, and the same three game objects at their same ids.
 *
 * Pure. `core` is never mutated, and the result is a function of `core` and
 * `clubs` alone.
 */
export function withFullSlate(
  core: SyntheticScenario,
  clubs: readonly string[] = NFL_CLUBS,
): FullSlate {
  const playing = new Set(slateClubs(core))
  const strangers = [...playing].filter((c) => !clubs.includes(c)).sort()
  if (strangers.length > 0) {
    throw new Error(
      `withFullSlate: scenario ${core.id} plays ${strangers.join('/')}, which NFL_CLUBS does not list — ` +
        `the club roll must contain every club the §23.6 library names, or the slate it builds is not complete`,
    )
  }
  const remaining = [...clubs].filter((c) => !playing.has(c)).sort()
  if (remaining.length % 2 !== 0) {
    throw new Error(
      `withFullSlate: ${remaining.length} clubs are left over after ${core.id}'s own games (${remaining.join(', ')}) — ` +
        `an odd number cannot be paired into games, and a club with no game is on bye at §7.3.6 (F286). ` +
        `Refusing rather than leaving one club uncovered.`,
    )
  }
  const staying = core.games.filter((g) => g.postponement === undefined)
  if (staying.length === 0) {
    throw new Error(
      `withFullSlate: scenario ${core.id} postpones every one of its games — there is no in-week game to ` +
        `hang the filler slate's kickoff on`,
    )
  }
  const startOf = (g: SyntheticGameDef): number =>
    Math.min(g.kickoffAt.getTime(), g.flexMove?.newKickoffAt.getTime() ?? Number.POSITIVE_INFINITY)
  let source = staying[0]!
  for (const g of staying) if (startOf(g) < startOf(source)) source = g
  const kickoffMs = startOf(source)
  const endMs = kickoffMs + source.durationMs

  const fillers: SyntheticGameDef[] = []
  for (let i = 0; i < remaining.length; i += 2) {
    const awayTeam = remaining[i]!
    const homeTeam = remaining[i + 1]!
    fillers.push({
      gameId: anchoredGameId(core.season, core.week, { awayTeam, homeTeam }),
      homeTeam,
      awayTeam,
      kickoffAt: new Date(kickoffMs),
      durationMs: source.durationMs,
      // No players ⇒ no charted value can exist for a filler. Its own game
      // end, never a scenario game's charted timing (`charted_late`'s slip is
      // G1's observable and stays G1's).
      chartedPostAt: new Date(endMs),
      chartedSlaAt: new Date(endMs),
    })
  }
  assertSlateInsideCore(core, fillers)
  const scenario: SyntheticScenario = { ...core, games: [...core.games, ...fillers] }
  return {
    scenario,
    fillerGameIds: fillers.map((g) => g.gameId),
    // DERIVED from what was published, not from `clubs` — see the field.
    clubs: slateClubs(scenario),
  }
}

/**
 * The scenario as the sim drives it: same id, same version, same seed, same
 * slate, same events — moved onto (season, week) and spoken through real
 * player ids. Pure; the input scenario is never mutated.
 */
export function anchorScenario(
  scenario: SyntheticScenario,
  target: AnchorTarget,
  bridge: PlayerBridge,
): SyntheticScenario {
  const shiftMs = assertAnchorConsistent(target)
  const rename = (id: string): string => bridge.map.get(id) ?? id

  const games: SyntheticGameDef[] = scenario.games.map((g) => ({
    ...g,
    gameId: anchoredGameId(target.season, target.week, g),
    kickoffAt: shifted(g.kickoffAt, shiftMs),
    chartedPostAt: shifted(g.chartedPostAt, shiftMs),
    chartedSlaAt: shifted(g.chartedSlaAt, shiftMs),
    ...(g.flexMove
      ? {
          flexMove: {
            announceAt: shifted(g.flexMove.announceAt, shiftMs),
            newKickoffAt: shifted(g.flexMove.newKickoffAt, shiftMs),
          },
        }
      : {}),
    ...(g.postponement
      ? {
          postponement: {
            announceAt: shifted(g.postponement.announceAt, shiftMs),
            newKickoffAt: shifted(g.postponement.newKickoffAt, shiftMs),
          },
        }
      : {}),
  }))
  const gameIdBySource = new Map(scenario.games.map((g, i) => [g.gameId, games[i]!.gameId]))

  const players: SyntheticPlayerDef[] = scenario.players.map((p) => ({
    ...p,
    playerId: rename(p.playerId),
    gameId: gameIdBySource.get(p.gameId) ?? p.gameId,
    ...(p.injury ? { injury: { ...p.injury, reportedAt: shifted(p.injury.reportedAt, shiftMs) } } : {}),
  }))

  return {
    id: scenario.id,
    version: scenario.version,
    seed: scenario.seed,
    season: target.season,
    week: target.week,
    correctionWindowEndsAt: shifted(scenario.correctionWindowEndsAt, shiftMs),
    games,
    players,
    outages: scenario.outages.map((o) => ({
      startAt: shifted(o.startAt, shiftMs),
      endAt: shifted(o.endAt, shiftMs),
    })),
    corrections: scenario.corrections.map((c) => ({
      ...c,
      playerId: rename(c.playerId),
      at: shifted(c.at, shiftMs),
    })),
    chartedRevisions: scenario.chartedRevisions.map((r) => ({
      ...r,
      playerId: rename(r.playerId),
      at: shifted(r.at, shiftMs),
    })),
  }
}

/** One instant the season driver must visit, and why. */
export interface ScenarioInstant {
  at: Date
  /** What happens at this instant, in the scenario's own vocabulary. */
  label: string
}

/**
 * The scenario's own timeline, sorted and de-duplicated: every instant at
 * which the synthetic world changes state. The driver walks these, polling
 * (`ingestWeek`) and draining (`runScoreWeekBatch`) at each, so the pipeline
 * sees the same sequence a real week's cron would.
 *
 * The three STRUCTURAL instants (week open, window close, finalize) are the
 * driver's, not the scenario's, and are added there — this list is purely
 * what §23.6 declares.
 */
export function scenarioInstants(scenario: SyntheticScenario): ScenarioInstant[] {
  const out: ScenarioInstant[] = []
  const push = (at: Date, label: string): void => {
    out.push({ at, label })
  }
  const INACTIVES_LEAD_MS = 90 * 60 * 1000
  for (const g of scenario.games) {
    if (g.flexMove) push(g.flexMove.announceAt, `flex_move announced ${g.gameId}`)
    if (g.postponement) push(g.postponement.announceAt, `postponement announced ${g.gameId}`)
    // A POSTPONED game's new kickoff contributes NOTHING: by 116's rule the
    // game has LEFT this week (its kickoff is at or past the next calendar
    // week's `starts_at`), so there is no in-week instant to poll for it and
    // an entry there would drag week W's polling into week W+1's slate.
    // A FLEXED game's new kickoff is still in-week and is walked.
    const kickoffs = [g.kickoffAt, ...(g.flexMove ? [g.flexMove.newKickoffAt] : [])]
    for (const k of kickoffs) {
      push(new Date(k.getTime() - INACTIVES_LEAD_MS), `inactives publish ${g.gameId}`)
      push(k, `kickoff ${g.gameId}`)
      // Mid-game (progress ≈ 0.5) so live scoring is exercised, then final.
      push(new Date(k.getTime() + Math.floor(g.durationMs / 2)), `live ${g.gameId}`)
      push(new Date(k.getTime() + g.durationMs), `final ${g.gameId}`)
    }
    push(g.chartedSlaAt, `charted SLA ${g.gameId}`)
    push(g.chartedPostAt, `charted posted ${g.gameId}`)
  }
  for (const o of scenario.outages) {
    // Three polls INSIDE the window (the DegradationTracker needs three
    // consecutive failures to raise `stats_degraded` — §23.2/E45), then one
    // after it so the flag clears and the recovered read back-fills.
    const span = o.endAt.getTime() - o.startAt.getTime()
    for (let i = 1; i <= 3; i++) {
      push(new Date(o.startAt.getTime() + Math.floor((span * i) / 4)), `outage poll ${i}/3`)
    }
    push(new Date(o.endAt.getTime() + 60_000), 'outage cleared')
  }
  for (const c of scenario.corrections) push(c.at, `correction ${c.playerId}.${c.key}`)
  for (const r of scenario.chartedRevisions) push(r.at, `charted revision ${r.playerId}.${r.key}`)

  out.sort((a, b) => a.at.getTime() - b.at.getTime())
  const merged: ScenarioInstant[] = []
  for (const item of out) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.at.getTime() === item.at.getTime()) {
      last.label = `${last.label} · ${item.label}`
      continue
    }
    merged.push({ at: item.at, label: item.label })
  }
  return merged
}

/** The library's nine ids, for CLI validation — never a hand-listed copy. */
export type { ScenarioId }
