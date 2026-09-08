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
export function anchoredGameId(season: number, week: number, game: SyntheticGameDef): string {
  return `${SIM_SEASON_GAME_PREFIX}${season}-w${String(week).padStart(2, '0')}-${game.awayTeam}@${game.homeTeam}`
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
