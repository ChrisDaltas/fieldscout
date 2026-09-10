/**
 * Re-anchor + player-bridge pins — L.D6.1 (§4.3's falsifiability floor:
 * stored literals, boundary instants, and one pin per claim the build rests
 * on).
 *
 * The two claims that MUST hold, because the whole bridge decision rests on
 * them (`season-scenario.ts`'s banner; PROGRESS D327):
 *   1. `makeScenario`'s DEFAULT output is untouched — the M0 gate re-records
 *      `happy_path` at (2026, week 2) and byte-compares it against
 *      `fixtures/nfl/2026/wk02/synthetic.jsonl.gz`, so a transform that moved
 *      the default would move the fixture and force a
 *      `SCENARIO_LIBRARY_VERSION` bump. This transform is downstream and
 *      additive.
 *   2. The library's documented determinism split SURVIVES the renaming: two
 *      scenarios at one seed still emit identical stat lines for the same
 *      bridged player, which is what the `provider_outage` back-fill proof
 *      rests on (`scenario.ts:15-18`; `ingest-week-db.test.ts:435`).
 */
import { describe, expect, it } from 'vitest'

import { weekBounds } from '@/lib/sync/ingest-week'
import { finalLine, SyntheticStatsProvider } from '../stats/synthetic/synthetic-stats-provider'
import { makeScenario, SCENARIO_LIBRARY_VERSION } from '../stats/synthetic/scenarios'
import { SCENARIO_IDS } from '../stats/synthetic/scenario'

import {
  anchoredGameId,
  anchorScenario,
  assertAnchorConsistent,
  bridgeLines,
  buildPlayerBridge,
  LIBRARY_SEASON,
  LIBRARY_WEEK,
  LIBRARY_WEEK_STARTS_AT,
  LIBRARY_WEEK_WINDOW_ENDS_AT,
  assertSlateInsideCore,
  NFL_CLUBS,
  scenarioInstants,
  SIM_SEASON_GAME_PREFIX,
  slateClubs,
  uncoveredClubs,
  withFullSlate,
  type BridgeCandidate,
} from './season-scenario'
import { syntheticNflWeeks, SYNTHETIC_SEASON } from './synthetic-season'

/** A pool that covers all six positions on all six scenario clubs. */
function pool(): BridgeCandidate[] {
  const clubs = ['PHI', 'DAL', 'KC', 'BUF', 'SF', 'SEA']
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  const out: BridgeCandidate[] = []
  let adp = 1
  for (const club of clubs) {
    for (const position of positions) {
      // Two candidates per (club, position): the best ADP must win.
      out.push({ id: `${club}-${position}-best`, position, team: club, adp: adp++ })
      out.push({ id: `${club}-${position}-worse`, position, team: club, adp: 500 + adp })
    }
  }
  return out
}

const TARGET_WEEK = 3
const targetRow = syntheticNflWeeks().find((w) => w.week === TARGET_WEEK)!
const target = {
  season: SYNTHETIC_SEASON,
  week: TARGET_WEEK,
  weekStartsAt: targetRow.starts_at,
  weekWindowEndsAt: targetRow.correction_window_ends_at,
}

describe('the library anchor — stored literals, cross-checked against the calendar', () => {
  it('the library is authored on 2026 week 2 and the literals are that row', () => {
    const scenario = makeScenario('happy_path')
    expect(scenario.season).toBe(LIBRARY_SEASON)
    expect(scenario.week).toBe(LIBRARY_WEEK)
    // The correction window the library declares IS the 2026 week-2 close.
    expect(scenario.correctionWindowEndsAt.toISOString()).toBe(LIBRARY_WEEK_WINDOW_ENDS_AT)
    // …and the shift between the two stored literals is a whole 8d 6h.
    expect(Date.parse(LIBRARY_WEEK_WINDOW_ENDS_AT) - Date.parse(LIBRARY_WEEK_STARTS_AT)).toBe(
      8 * 86_400_000 + 6 * 3_600_000,
    )
  })

  it('the synthetic calendar preserves that offset, so the shift lands exactly', () => {
    const shift = assertAnchorConsistent(target)
    expect(shift).toBe(Date.parse(targetRow.starts_at) - Date.parse(LIBRARY_WEEK_STARTS_AT))
  })

  it("a calendar row whose window does NOT sit at the library's offset is REFUSED, loudly", () => {
    expect(() =>
      assertAnchorConsistent({ ...target, weekWindowEndsAt: '2099-09-30T10:00:00.000Z' }),
    ).toThrow(/does not fit/)
  })

  it('an unparseable bound throws rather than shifting by NaN', () => {
    expect(() => assertAnchorConsistent({ ...target, weekStartsAt: 'not-a-date' })).toThrow(
      /unparseable bound/,
    )
  })
})

describe('the player bridge — a bijective renaming onto the scenario\'s own clubs', () => {
  it('every one of the 18 slots maps, and the best ADP on the game\'s two clubs wins', () => {
    const scenario = makeScenario('happy_path')
    const bridge = buildPlayerBridge(scenario, pool())
    expect(bridge.misses).toEqual([])
    expect(bridge.map.size).toBe(18)
    // G1 is DAL@PHI; PHI's candidates were generated first, so PHI wins on ADP.
    expect(bridge.map.get('syn-g1-qb')).toBe('PHI-QB-best')
    expect(bridge.map.get('syn-g2-rb')).toBe('KC-RB-best')
    expect(bridge.map.get('syn-g3-wr')).toBe('SF-WR-best')
  })

  it('the map is INJECTIVE — eighteen distinct real ids', () => {
    const bridge = buildPlayerBridge(makeScenario('happy_path'), pool())
    expect(new Set(bridge.map.values()).size).toBe(18)
  })

  it('DEF and DST name one position (the feed\'s vocabulary vs §7.3.3.1\'s)', () => {
    const candidates: BridgeCandidate[] = pool().map((c) =>
      c.position === 'DEF' ? { ...c, position: 'DST' } : c,
    )
    const bridge = buildPlayerBridge(makeScenario('happy_path'), candidates)
    expect(bridge.map.get('syn-g1-def')).toBe('PHI-DEF-best')
  })

  it('a position with NO candidate is a LOUD MISS, never a silent skip', () => {
    const thin = pool().filter((c) => c.position !== 'K')
    const bridge = buildPlayerBridge(makeScenario('happy_path'), thin)
    expect(bridge.map.size).toBe(15)
    expect(bridge.misses).toHaveLength(3)
    expect(bridge.misses[0]).toContain('no real player in the pool')
  })

  it('ties on ADP break by id ascending (pure — no clock, no entropy)', () => {
    const tied: BridgeCandidate[] = [
      { id: 'zzz', position: 'QB', team: 'PHI', adp: 5 },
      { id: 'aaa', position: 'QB', team: 'DAL', adp: 5 },
    ]
    const bridge = buildPlayerBridge(makeScenario('happy_path'), tied)
    expect(bridge.map.get('syn-g1-qb')).toBe('aaa')
  })

  it('a NULL adp sorts last (never ahead of a ranked player)', () => {
    const mixed: BridgeCandidate[] = [
      { id: 'unranked', position: 'QB', team: 'PHI', adp: null },
      { id: 'ranked', position: 'QB', team: 'PHI', adp: 300 },
    ]
    expect(buildPlayerBridge(makeScenario('happy_path'), mixed).map.get('syn-g1-qb')).toBe('ranked')
  })

  it('the printed map names the slot, its position, its slate and the real id', () => {
    const scenario = makeScenario('happy_path')
    const lines = bridgeLines(scenario, buildPlayerBridge(scenario, pool()))
    expect(lines).toHaveLength(18)
    expect(lines[0]).toBe('syn-g1-qb (QB DAL@PHI) -> PHI-QB-best')
  })
})

describe('anchorScenario — the transform is a pure SHIFT plus a RENAMING', () => {
  const scenario = makeScenario('flex_move')
  const bridge = buildPlayerBridge(scenario, pool())
  const anchored = anchorScenario(scenario, target, bridge)
  const shift = Date.parse(targetRow.starts_at) - Date.parse(LIBRARY_WEEK_STARTS_AT)

  it('season and week move; the id, version and seed do not', () => {
    expect(anchored.season).toBe(SYNTHETIC_SEASON)
    expect(anchored.week).toBe(TARGET_WEEK)
    expect(anchored.id).toBe('flex_move')
    expect(anchored.version).toBe(scenario.version)
    expect(anchored.seed).toBe(scenario.seed)
  })

  it('EVERY instant moves by exactly one delta — offsets from the week start are preserved', () => {
    for (const [i, game] of anchored.games.entries()) {
      const source = scenario.games[i]!
      expect(game.kickoffAt.getTime() - source.kickoffAt.getTime()).toBe(shift)
      expect(game.chartedPostAt.getTime() - source.chartedPostAt.getTime()).toBe(shift)
      expect(game.chartedSlaAt.getTime() - source.chartedSlaAt.getTime()).toBe(shift)
      expect(game.durationMs).toBe(source.durationMs)
    }
    expect(anchored.games[2]!.flexMove!.announceAt.getTime() - scenario.games[2]!.flexMove!.announceAt.getTime()).toBe(shift)
    expect(anchored.games[2]!.flexMove!.newKickoffAt.getTime() - scenario.games[2]!.flexMove!.newKickoffAt.getTime()).toBe(shift)
  })

  it('the correction window lands EXACTLY on the target week\'s stored close', () => {
    expect(anchored.correctionWindowEndsAt.toISOString()).toBe(
      new Date(targetRow.correction_window_ends_at).toISOString(),
    )
  })

  it('game ids are WEEK-UNIQUE and carry the F199 sweep prefix', () => {
    expect(anchored.games.map((g) => g.gameId)).toEqual([
      'simseason-2099-w03-DAL@PHI',
      'simseason-2099-w03-BUF@KC',
      'simseason-2099-w03-SEA@SF',
    ])
    expect(anchored.games.every((g) => g.gameId.startsWith(SIM_SEASON_GAME_PREFIX))).toBe(true)
    // Week 4 must not collide with week 3 (nfl_games.id is the PK — a
    // re-used id would MOVE week 3's row out of week 3).
    expect(anchoredGameId(SYNTHETIC_SEASON, 4, scenario.games[0]!)).not.toBe(anchored.games[0]!.gameId)
  })

  it('the CLUBS are untouched — they are already real NFL abbreviations, which is what makes the bridge work', () => {
    expect(anchored.games.map((g) => `${g.awayTeam}@${g.homeTeam}`)).toEqual([
      'DAL@PHI',
      'BUF@KC',
      'SEA@SF',
    ])
  })

  it('players, corrections and revisions are RENAMED onto real ids', () => {
    const correction = makeScenario('correction_in_window')
    const cBridge = buildPlayerBridge(correction, pool())
    const cAnchored = anchorScenario(correction, target, cBridge)
    expect(cAnchored.players.map((p) => p.playerId)).toEqual(
      correction.players.map((p) => cBridge.map.get(p.playerId)),
    )
    expect(cAnchored.corrections[0]!.playerId).toBe(cBridge.map.get('syn-g1-wr'))
    expect(cAnchored.corrections[0]!.key).toBe('receiving_yards')
    expect(cAnchored.corrections[0]!.delta).toBe(7)
  })

  it('the INPUT scenario is not mutated (the transform is pure)', () => {
    expect(scenario.season).toBe(LIBRARY_SEASON)
    expect(scenario.games[0]!.gameId).toBe('2026-wk02-DAL@PHI')
    expect(scenario.players[0]!.playerId).toBe('syn-g1-qb')
  })
})

describe('the two claims the bridge decision rests on', () => {
  it("1 — makeScenario's DEFAULT output is UNTOUCHED (the M0 fixture does not move)", () => {
    const fresh = makeScenario('happy_path')
    expect(fresh.season).toBe(2026)
    expect(fresh.week).toBe(2)
    expect(SCENARIO_LIBRARY_VERSION).toBe(2)
    expect(fresh.games.map((g) => g.gameId)).toEqual([
      '2026-wk02-DAL@PHI',
      '2026-wk02-BUF@KC',
      '2026-wk02-SEA@SF',
    ])
    expect(fresh.players.map((p) => p.playerId)).toEqual([
      'syn-g1-qb', 'syn-g1-rb', 'syn-g1-wr', 'syn-g1-te', 'syn-g1-k', 'syn-g1-def',
      'syn-g2-qb', 'syn-g2-rb', 'syn-g2-wr', 'syn-g2-te', 'syn-g2-k', 'syn-g2-def',
      'syn-g3-qb', 'syn-g3-rb', 'syn-g3-wr', 'syn-g3-te', 'syn-g3-k', 'syn-g3-def',
    ])
  })

  it("2 — the determinism SPLIT survives: two scenarios at one seed still emit identical lines per bridged player", () => {
    const seed = 20260920
    const outage = anchorScenario(makeScenario('provider_outage', seed), target, buildPlayerBridge(makeScenario('provider_outage', seed), pool()))
    const happy = anchorScenario(makeScenario('happy_path', seed), target, buildPlayerBridge(makeScenario('happy_path', seed), pool()))
    // The bridge does not depend on the scenario id, so the same slot maps
    // to the same real player in both worlds…
    expect(outage.players.map((p) => p.playerId)).toEqual(happy.players.map((p) => p.playerId))
    // …and the LINE for that real player is identical in both — which is the
    // property the outage back-fill proof rests on (scenarios.ts:9-11).
    for (const [i, player] of outage.players.entries()) {
      expect(finalLine(outage.seed, player)).toEqual(finalLine(happy.seed, happy.players[i]!))
    }
  })

  it('a DIFFERENT seed still changes the lines (the negative control of the same split)', () => {
    const a = anchorScenario(makeScenario('happy_path', 1), target, buildPlayerBridge(makeScenario('happy_path', 1), pool()))
    const b = anchorScenario(makeScenario('happy_path', 2), target, buildPlayerBridge(makeScenario('happy_path', 2), pool()))
    expect(finalLine(a.seed, a.players[0]!)).not.toEqual(finalLine(b.seed, b.players[0]!))
  })
})

describe('scenarioInstants — the timeline the driver walks', () => {
  it('is sorted, de-duplicated, and merges labels at a shared instant', () => {
    const scenario = anchorScenario(makeScenario('happy_path'), target, buildPlayerBridge(makeScenario('happy_path'), pool()))
    const instants = scenarioInstants(scenario)
    expect(instants.length).toBeGreaterThan(0)
    for (let i = 1; i < instants.length; i++) {
      expect(instants[i]!.at.getTime()).toBeGreaterThan(instants[i - 1]!.at.getTime())
    }
    // The two Sunday games share one charted post instant — one entry, two labels.
    expect(instants.some((x) => x.label.includes(' · '))).toBe(true)
  })

  it('a POSTPONED game contributes only its announcement — it has LEFT the week (E43)', () => {
    const scenario = anchorScenario(makeScenario('postponement'), target, buildPlayerBridge(makeScenario('postponement'), pool()))
    const postponed = scenario.games.find((g) => g.postponement !== undefined)!
    const labels = scenarioInstants(scenario).map((x) => x.label).join(' | ')
    expect(labels).toContain(`postponement announced ${postponed.gameId}`)
    // No kickoff/live/final entry for the moved-out kickoff.
    const moved = postponed.postponement!.newKickoffAt.getTime()
    expect(scenarioInstants(scenario).some((x) => x.at.getTime() === moved)).toBe(false)
  })

  it('an OUTAGE contributes three polls inside the window plus one after it (§23.2: three failures raise)', () => {
    const scenario = anchorScenario(makeScenario('provider_outage'), target, buildPlayerBridge(makeScenario('provider_outage'), pool()))
    const outage = scenario.outages[0]!
    const inside = scenarioInstants(scenario).filter(
      (x) => x.at.getTime() >= outage.startAt.getTime() && x.at.getTime() < outage.endAt.getTime(),
    )
    expect(inside.filter((x) => x.label.includes('outage poll'))).toHaveLength(3)
    expect(scenarioInstants(scenario).some((x) => x.label.includes('outage cleared'))).toBe(true)
  })

  it('every one of the nine library ids anchors and yields a timeline', () => {
    for (const id of SCENARIO_IDS) {
      const s = makeScenario(id)
      const anchored = anchorScenario(s, target, buildPlayerBridge(s, pool()))
      expect(scenarioInstants(anchored).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// The FULL SLATE (F286 / D328) — the fix for "the world is too small for a
// legal lineup", pinned as fixture construction that cannot move a beat.
// ---------------------------------------------------------------------------

/** A clock the provider can be pointed at any instant. */
class FixedClock {
  constructor(private at: Date) {}
  now(): Date {
    return this.at
  }
  nowMs(): number {
    return this.at.getTime()
  }
  set(at: Date): void {
    this.at = at
  }
}

/** `getSchedule`'s rows in the shape `weekBounds` reads them. */
function gameRowsAt(scenario: ReturnType<typeof makeScenario>, at: Date) {
  const clock = new FixedClock(at)
  const provider = new SyntheticStatsProvider(scenario, clock as never)
  return provider.getSchedule(scenario.season).then((games) =>
    games.map((g) => ({
      id: g.gameId,
      season: g.season,
      week: g.week,
      home_team: g.homeTeam,
      away_team: g.awayTeam,
      kickoff_at: (g.kickoffAt ?? new Date(0)).toISOString(),
      status: g.status,
    })),
  )
}

/** The anchored `happy_path` — the slate tests' core scenario. */
const slateCore = anchorScenario(
  makeScenario('happy_path'),
  target,
  buildPlayerBridge(makeScenario('happy_path'), pool()),
)

describe('withFullSlate — a COMPLETE week, built around an unchanged §23.6 library', () => {
  const core = slateCore

  it('publishes a game for every one of the 32 clubs — which is the whole point (F286)', () => {
    const full = withFullSlate(core)
    expect(slateClubs(full.scenario).length).toBe(32)
    expect(slateClubs(full.scenario)).toEqual([...NFL_CLUBS].sort())
    // 3 library games + 13 fillers = 16 games, 32 clubs, each club once.
    expect(full.scenario.games.length).toBe(16)
    expect(full.fillerGameIds.length).toBe(13)
  })

  it("carries the §23.6 games through BYTE-FOR-BYTE — same ids, same beats, same order", () => {
    const full = withFullSlate(core)
    expect(full.scenario.games.slice(0, core.games.length)).toEqual(core.games)
    // and the scenario's own declarations are the same objects' values
    expect(full.scenario.players).toEqual(core.players)
    expect(full.scenario.corrections).toEqual(core.corrections)
    expect(full.scenario.chartedRevisions).toEqual(core.chartedRevisions)
    expect(full.scenario.outages).toEqual(core.outages)
    expect(full.scenario.correctionWindowEndsAt).toEqual(core.correctionWindowEndsAt)
    expect(full.scenario.id).toBe(core.id)
    expect(full.scenario.version).toBe(core.version)
    expect(full.scenario.seed).toBe(core.seed)
  })

  it('does not mutate the core scenario (pure)', () => {
    const before = core.games.length
    withFullSlate(core)
    expect(core.games.length).toBe(before)
  })

  it('every filler carries NO players — §23.6\'s eighteen stay the library\'s law', () => {
    const full = withFullSlate(core)
    const fillerIds = new Set(full.fillerGameIds)
    expect(full.scenario.players.filter((p) => fillerIds.has(p.gameId))).toEqual([])
  })

  it('every filler id carries the F199 sweep prefix and is week-unique', () => {
    const full = withFullSlate(core)
    for (const id of full.fillerGameIds) {
      expect(id.startsWith(SIM_SEASON_GAME_PREFIX)).toBe(true)
      expect(id).toContain(`-w${String(TARGET_WEEK).padStart(2, '0')}-`)
    }
    const other = withFullSlate({ ...core, week: TARGET_WEEK + 1 })
    expect(other.fillerGameIds.some((id) => full.fillerGameIds.includes(id))).toBe(false)
  })

  it('is DETERMINISTIC — the same core yields the same slate, pinned as stored literals', () => {
    const a = withFullSlate(core)
    const b = withFullSlate(core)
    expect(a.fillerGameIds).toEqual(b.fillerGameIds)
    expect(a.fillerGameIds).toEqual([
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-ARI@ATL`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-BAL@CAR`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-CHI@CIN`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-CLE@DEN`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-DET@GB`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-HOU@IND`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-JAX@LAC`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-LAR@LV`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-MIA@MIN`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-NE@NO`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-NYG@NYJ`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-PIT@TB`,
      `${SIM_SEASON_GAME_PREFIX}${SYNTHETIC_SEASON}-w03-TEN@WAS`,
    ])
  })

  it('all nine library scenarios anchor into a complete 32-club slate', () => {
    for (const id of SCENARIO_IDS) {
      const raw = makeScenario(id)
      const anchored = anchorScenario(raw, target, buildPlayerBridge(raw, pool()))
      const full = withFullSlate(anchored)
      expect(slateClubs(full.scenario).length, id).toBe(32)
    }
  })

  it('a club roll that does not contain the scenario\'s own clubs is REFUSED', () => {
    expect(() => withFullSlate(core, ['ARI', 'ATL'])).toThrow(/NFL_CLUBS does not list/)
  })

  it('an ODD number of leftover clubs is REFUSED rather than leaving one on bye', () => {
    const roll = [...slateClubs(core), 'ARI', 'ATL', 'BAL']
    expect(() => withFullSlate(core, roll)).toThrow(/cannot be paired into games/)
  })
})

describe('the filler window sits INSIDE the scenario\'s own — hazard 2, structurally', () => {
  const core = slateCore
  for (const id of SCENARIO_IDS) {
    it(`${id}: no filler kicks off before, or ends after, the §23.6 games`, () => {
      const raw = makeScenario(id)
      const anchored = anchorScenario(raw, target, buildPlayerBridge(raw, pool()))
      const full = withFullSlate(anchored)
      const fillerIds = new Set(full.fillerGameIds)
      const fillers = full.scenario.games.filter((g) => fillerIds.has(g.gameId))
      // The guard the transform runs on itself, re-run here against the core.
      expect(() => assertSlateInsideCore(anchored, fillers)).not.toThrow()
    })
  }

  it('the KICKOFF boundary is EXACT: the earliest core kickoff passes, one ms before it throws', () => {
    const full = withFullSlate(core)
    const fillerIds = new Set(full.fillerGameIds)
    const fillers = full.scenario.games.filter((g) => fillerIds.has(g.gameId))
    // The shipped fillers already SIT on the boundary — that is the pin.
    expect(() => assertSlateInsideCore(core, fillers)).not.toThrow()
    const early = fillers.map((g) => ({ ...g, kickoffAt: new Date(g.kickoffAt.getTime() - 1) }))
    expect(() => assertSlateInsideCore(core, early)).toThrow(/first_kickoff_at/)
  })

  it('the END boundary is EXACT: on the last in-week end it passes, one ms past it throws', () => {
    const full = withFullSlate(core)
    const fillerIds = new Set(full.fillerGameIds)
    const fillers = full.scenario.games.filter((g) => fillerIds.has(g.gameId))
    const latestCoreEnd = Math.max(
      ...core.games
        .filter((g) => g.postponement === undefined)
        .map((g) => (g.flexMove ? g.flexMove.newKickoffAt : g.kickoffAt).getTime() + g.durationMs),
    )
    const stretched = (extra: number) =>
      fillers.map((g) => ({ ...g, durationMs: latestCoreEnd - g.kickoffAt.getTime() + extra }))
    expect(() => assertSlateInsideCore(core, stretched(0))).not.toThrow()
    expect(() => assertSlateInsideCore(core, stretched(1))).toThrow(/last_game_ends_at/)
  })
})

describe('weekBounds cannot tell the slates apart — the beats the scenario declares do not move', () => {
  /** Every instant the driver visits for this week, plus the week's own. */
  function instantsOf(scenario: ReturnType<typeof makeScenario>): Date[] {
    const out = scenarioInstants(scenario).map((i) => i.at)
    const staying = scenario.games.filter((g) => g.postponement === undefined)
    const lastEnd = Math.max(
      ...staying.map((g) => (g.flexMove ? g.flexMove.newKickoffAt : g.kickoffAt).getTime() + g.durationMs),
    )
    out.push(new Date(lastEnd + 60_000))
    out.push(scenario.correctionWindowEndsAt)
    return out
  }

  for (const id of SCENARIO_IDS) {
    it(`${id}: first_kickoff_at and last_game_ends_at are identical at EVERY instant`, async () => {
      const raw = makeScenario(id)
      const anchored = anchorScenario(raw, target, buildPlayerBridge(raw, pool()))
      const full = withFullSlate(anchored).scenario
      const stamp = new Date('2099-01-01T00:00:00.000Z')
      // The prior carries the sticky stamp exactly as ingestion does; a
      // divergence in EITHER column at ANY instant fails here.
      let priorCore: { first_kickoff_at: string | null; last_game_ends_at: string | null } | null = null
      let priorFull: { first_kickoff_at: string | null; last_game_ends_at: string | null } | null = null
      for (const at of instantsOf(anchored).sort((a, b) => a.getTime() - b.getTime())) {
        // §23.2: inside an outage EVERY provider method throws, for either
        // slate — `ingestWeek` reports it and writes nothing, so there is no
        // bound to compare. The outage must behave IDENTICALLY, which is the
        // assertion here.
        const inOutage = anchored.outages.some(
          (o) => at.getTime() >= o.startAt.getTime() && at.getTime() < o.endAt.getTime(),
        )
        if (inOutage) {
          await expect(gameRowsAt(anchored, at)).rejects.toThrow(/outage/)
          await expect(gameRowsAt(full, at)).rejects.toThrow(/outage/)
          continue
        }
        const coreRows = await gameRowsAt(anchored, at)
        const fullRows = await gameRowsAt(full, at)
        // Both slates take the SAME Q50 floor (it derives from the week's
        // `starts_at`, which is identical on either side), so the composition
        // property is untouched by it.
        const a = weekBounds(
          coreRows.filter((g) => g.week === anchored.week),
          priorCore,
          stamp,
          target.weekStartsAt,
        )
        const b = weekBounds(
          fullRows.filter((g) => g.week === anchored.week),
          priorFull,
          stamp,
          target.weekStartsAt,
        )
        expect(b, `${id} @ ${at.toISOString()}`).toEqual(a)
        priorCore = a
        priorFull = b
      }
    })
  }

  it('EVERY published game reads final once the last §23.6 game ends — 116 can finalize the week', async () => {
    for (const id of SCENARIO_IDS) {
      const raw = makeScenario(id)
      const anchored = anchorScenario(raw, target, buildPlayerBridge(raw, pool()))
      const full = withFullSlate(anchored).scenario
      const staying = anchored.games.filter((g) => g.postponement === undefined)
      const lastEnd = Math.max(
        ...staying.map((g) => (g.flexMove ? g.flexMove.newKickoffAt : g.kickoffAt).getTime() + g.durationMs),
      )
      const rows = await gameRowsAt(full, new Date(lastEnd))
      const open = rows.filter((g) => g.status !== 'final' && g.status !== 'postponed')
      expect(open.map((g) => g.id), id).toEqual([])
    }
  })
})

describe('uncoveredClubs — the refusal that keeps the slate honest', () => {
  it('names a rostered club the slate does not play', () => {
    expect(uncoveredClubs(['PHI', 'DAL', 'XYZ'], slateClubs(makeScenario('happy_path')))).toEqual(['XYZ'])
  })

  it('a NULL (or blank) club is named too — 112:417-422 makes him permanently on bye', () => {
    expect(uncoveredClubs([null, '  ', 'PHI'], ['PHI'])).toEqual(['(null)'])
  })

  it('is EMPTY when the full slate covers the pool — the state a run must be in', () => {
    const full = withFullSlate(slateCore)
    expect(uncoveredClubs([...NFL_CLUBS], full.clubs)).toEqual([])
  })

  // The coverage claim is read off what was PUBLISHED, never off the club
  // roll that was asked for: a slate that silently shrank must be visible to
  // the very check whose job is to notice an uncovered club.
  it("`clubs` is DERIVED from the published games — a slate with no fillers reports six, not thirty-two", () => {
    const noFillers = withFullSlate(slateCore, slateClubs(slateCore))
    expect(noFillers.fillerGameIds).toEqual([])
    expect(noFillers.clubs).toEqual(slateClubs(slateCore))
    expect(noFillers.clubs.length).toBe(6)
    expect(uncoveredClubs([...NFL_CLUBS], noFillers.clubs).length).toBe(26)
  })

  it('de-duplicates and sorts (one line per club, not one per player)', () => {
    expect(uncoveredClubs(['ZZZ', 'AAA', 'ZZZ'], [])).toEqual(['AAA', 'ZZZ'])
  })
})
