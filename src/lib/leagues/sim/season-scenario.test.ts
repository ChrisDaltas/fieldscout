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

import { finalLine } from '../stats/synthetic/synthetic-stats-provider'
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
  scenarioInstants,
  SIM_SEASON_GAME_PREFIX,
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
