/**
 * Run-plan + seeded-stream pins — L.B6.1 (§4.3 falsifiability floor:
 * stored-literal goldens captured from a real run of the pure derivation,
 * then frozen; a drifting plan fails the literal, a broken guarantee fails
 * the structural sweeps).
 */
import { describe, expect, it } from 'vitest'

import { defaultsForTeamCount, leagueSettingsSchema } from '../settings/league-settings'
import { mulberry32 } from '../stats/synthetic/prng'
import {
  BOT_POOL_SIZE,
  buildRunPlan,
  planLines,
  SEASON_ROSTER,
  SEASON_ROUNDS,
  seasonPlanLines,
} from './plan'
import { deriveStream, uuidFromRng } from './sim-rng'

describe('buildRunPlan — seeded, replayable, guaranteed', () => {
  const cfg = { leagues: 4, teams: 'mixed' as const, clockSeconds: 30, seed: 42 }

  it('seed 42 / 4 mixed leagues — the stored-literal golden matrix', () => {
    const plan = buildRunPlan(cfg)
    // Captured from a real derivation 2026-08-13, then frozen (stored
    // literal — never recomputed by the test).
    expect(plan.leagues.map((l) => l.teamCount)).toEqual([16, 16, 16, 8])
    expect(plan.leagues.map((l) => l.rounds)).toEqual([4, 4, 4, 4])
    expect(plan.leagues.map((l) => l.snakeReversal)).toEqual([false, false, true, false])
    expect(plan.leagues.map((l) => l.allAfk)).toEqual([false, true, false, false])
    expect(plan.leagues[0]!.humanSeats).toEqual([
      { botIndex: 0, persona: 'adp-drafter' },
      { botIndex: 1, persona: 'chaos' },
      { botIndex: 2, persona: 'adp-drafter' },
      { botIndex: 3, persona: 'chaos' },
      { botIndex: 4, persona: 'afk' },
      { botIndex: 5, persona: 'queue-drafter' },
    ])
    expect(plan.leagues[3]!.humanSeats).toEqual([
      { botIndex: 3, persona: 'adp-drafter' },
      { botIndex: 4, persona: 'queue-drafter' },
      { botIndex: 5, persona: 'afk' },
      { botIndex: 6, persona: 'chaos' },
    ])
    expect(plan.leagues.map((l) => l.placeholderCount)).toEqual([10, 10, 10, 4])
    expect(planLines(plan)[0]).toBe(
      'SIM L.B6.1 #01: 16 teams × 4 rounds — humans [adp-drafter, chaos, adp-drafter, chaos, afk, queue-drafter] + 10 placeholders',
    )
  })

  it('--seed replays EXACTLY: the same seed derives a deep-equal plan', () => {
    expect(buildRunPlan(cfg)).toEqual(buildRunPlan(cfg))
  })

  it('a different seed derives a different plan (negative control)', () => {
    expect(buildRunPlan({ ...cfg, seed: 43 })).not.toEqual(buildRunPlan(cfg))
  })

  it('the gate-shape guarantees hold at 25 mixed leagues (structural sweep)', () => {
    const plan = buildRunPlan({ leagues: 25, teams: 'mixed', clockSeconds: 30, seed: 42 })
    expect(plan.leagues).toHaveLength(25)
    // ≥1 SIXTEEN-team league (E14's substance at v1's max size, C31).
    expect(plan.leagues.some((l) => l.teamCount === 16)).toBe(true)
    // Exactly ONE all-afk league (the all-timeout path).
    expect(plan.leagues.filter((l) => l.allAfk)).toHaveLength(1)
    // Chaos double-taps THROUGHOUT: every non-all-afk league seats chaos.
    for (const l of plan.leagues.filter((l) => !l.allAfk)) {
      expect(
        l.humanSeats.some((s) => s.persona === 'chaos'),
        `${l.name} has no chaos seat`,
      ).toBe(true)
    }
    // Every league: humans + placeholders == team_count, and no bot holds
    // two seats in one league (a user claims at most one franchise).
    for (const l of plan.leagues) {
      expect(l.humanSeats.length + l.placeholderCount).toBe(l.teamCount)
      const botIndexes = l.humanSeats.map((s) => s.botIndex)
      expect(new Set(botIndexes).size).toBe(botIndexes.length)
    }
    // The all-afk league is ONLY afk seats.
    const afkLeague = plan.leagues.find((l) => l.allAfk)!
    expect(afkLeague.humanSeats.every((s) => s.persona === 'afk')).toBe(true)
  })

  it('fixed --teams pins every league to that size', () => {
    const plan = buildRunPlan({ leagues: 2, teams: 8, clockSeconds: 30, seed: 7 })
    expect(plan.leagues.map((l) => `${l.teamCount}/${l.rounds}/${l.allAfk}`)).toEqual([
      '8/2/true',
      '8/3/false',
    ])
  })
})

describe('seeded streams (sim-rng)', () => {
  it('uuidFromRng: deterministic v4-shaped literal', () => {
    // Stored literal (captured 2026-08-13).
    expect(uuidFromRng(mulberry32(1))).toBe('a00087fb-f747-4cb8-adfe-747d23673f27')
    expect(uuidFromRng(mulberry32(1))).toBe(uuidFromRng(mulberry32(1)))
    expect(uuidFromRng(mulberry32(2))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('deriveStream: label-keyed child streams are independent of consumption order', () => {
    const a1 = deriveStream(42, 'a')
    const b1 = deriveStream(42, 'b')
    // Interleave consumption — each stream's sequence is its own.
    const seqA = [a1(), a1()]
    const seqB = [b1(), b1()]
    const a2 = deriveStream(42, 'a')
    const b2 = deriveStream(42, 'b')
    expect([b2(), b2()]).toEqual(seqB)
    expect([a2(), a2()]).toEqual(seqA)
    expect(seqA[0]).not.toBe(seqB[0])
    // Stored literals (captured 2026-08-13).
    expect(seqA[0]).toBeCloseTo(0.23468811041675508, 12)
    expect(seqB[0]).toBeCloseTo(0.4598701929207891, 12)
  })
})

describe('buildRunPlan — the auction matrix (L.C4.1)', () => {
  it('a snake plan is BYTE-IDENTICAL to the M2 derivation (no auction rng draws leak in)', () => {
    const snakeDefault = buildRunPlan({ leagues: 4, teams: 'mixed', clockSeconds: 30, seed: 42 })
    const snakeExplicit = buildRunPlan({
      leagues: 4,
      teams: 'mixed',
      clockSeconds: 30,
      seed: 42,
      draftType: 'snake',
    })
    expect(snakeExplicit).toEqual(snakeDefault)
    expect(snakeDefault.leagues.every((l) => l.auction === undefined)).toBe(true)
  })

  it('an auction plan guarantees BOTH reserve columns and ≥1 manual nomination order (≥2 leagues)', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const plan = buildRunPlan({
        leagues: 5,
        teams: 'mixed',
        clockSeconds: 30,
        seed,
        draftType: 'auction',
      })
      const auctions = plan.leagues.map((l) => l.auction!)
      expect(auctions.every((a) => a !== undefined)).toBe(true)
      expect(auctions.some((a) => a.zeroDollarNominations)).toBe(true)
      expect(auctions.some((a) => !a.zeroDollarNominations)).toBe(true)
      expect(auctions.some((a) => a.nominationOrderMode === 'manual')).toBe(true)
      // The all-afk league keeps the DEFAULT reserve column (its traffic is
      // all system nominations; the $0 column always gets manual bidders).
      const allAfk = plan.leagues.find((l) => l.allAfk)!
      expect(allAfk.auction!.zeroDollarNominations).toBe(false)
      expect(allAfk.auction!.commishEdits).toBe(false)
      // Every non-all-afk league seats chaos + a full persona set head.
      for (const l of plan.leagues.filter((x) => !x.allAfk)) {
        const personas = l.humanSeats.map((s) => s.auctionPersona)
        expect(personas).toContain('chaos')
        expect(personas).toContain('value-bidder')
        expect(personas).toContain('sniper')
        expect(personas).toContain('budget-hoarder')
      }
    }
  })

  it('the auction plan replays byte-for-byte from its seed', () => {
    const a = buildRunPlan({ leagues: 6, teams: 'mixed', clockSeconds: 30, seed: 99, draftType: 'auction' })
    const b = buildRunPlan({ leagues: 6, teams: 'mixed', clockSeconds: 30, seed: 99, draftType: 'auction' })
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// The D299 in-season matrix — L.D6.1
// ---------------------------------------------------------------------------

describe('the season matrix (D299) — drawn on its own stream, guaranteed by construction', () => {
  const cfg = { leagues: 6, teams: 'mixed' as const, clockSeconds: 30, seed: 42 }

  it("season: true does NOT move a DRAFT plan — the M2 stored-literal golden is re-asserted here", () => {
    // The axes come from `deriveStream(seed, SEASON_MATRIX_LABEL)`, never
    // from `rng`, and every season-only branch is guarded on `input.season`.
    // This re-asserts the SAME frozen literals the first test in this file
    // pins, so a future season edit that leaked into the shared stream fails
    // in the section that made the edit rather than only at the top.
    const draft = buildRunPlan({ leagues: 4, teams: 'mixed', clockSeconds: 30, seed: 42 })
    expect(draft.leagues.map((l) => l.teamCount)).toEqual([16, 16, 16, 8])
    expect(draft.leagues.map((l) => l.rounds)).toEqual([4, 4, 4, 4])
    expect(draft.leagues.map((l) => l.snakeReversal)).toEqual([false, false, true, false])
    expect(draft.leagues.map((l) => l.allAfk)).toEqual([false, true, false, false])
    expect(draft.leagues.map((l) => l.placeholderCount)).toEqual([10, 10, 10, 4])
    expect(draft.leagues.every((l) => l.season === undefined)).toBe(true)
  })

  it('a SEASON plan legitimately draws a different draft matrix, and that is stated, not accidental', () => {
    // Season mode seats every pool bot (`humanCount`), which changes how many
    // persona draws the shared `rng` makes per league — so the sizes AFTER
    // the first league differ from a draft-only run at the same seed. That is
    // a different input, not a moved golden: the draft-only literals above
    // are untouched, and the season plan is itself replayable (below).
    const season = buildRunPlan({ leagues: 4, teams: 'mixed', clockSeconds: 30, seed: 42, season: true })
    expect(season.leagues.map((l) => l.teamCount)).toEqual([16, 12, 16, 8])
    expect(season.leagues.every((l) => l.season !== undefined)).toBe(true)
  })

  it('season mode fixes the roster preset and its round count', () => {
    const plan = buildRunPlan({ ...cfg, season: true })
    expect(plan.leagues.every((l) => l.rounds === SEASON_ROUNDS)).toBe(true)
    expect(SEASON_ROSTER.starting_slots.map((s) => s.key)).toEqual(['qb', 'rb', 'wr', 'te', 'k', 'dst'])
    // One starting slot per scoring position, so every §23.6 position can
    // reach a lineup (the coverage argument in the module's docblock).
    expect(SEASON_ROSTER.starting_slots.every((s) => s.count === 1)).toBe(true)
    expect(SEASON_ROSTER.starting_slots.length + SEASON_ROSTER.bench).toBe(SEASON_ROUNDS)
  })

  it('season mode seats every pool bot it can (more managers ⇒ more lineups the sim can set)', () => {
    const plan = buildRunPlan({ ...cfg, season: true })
    for (const league of plan.leagues) {
      expect(league.humanSeats.length).toBe(Math.min(league.teamCount, BOT_POOL_SIZE))
    }
  })

  // R918: "by construction" is a claim about EVERY seed, so it is asserted
  // over a seed RANGE. The single-seed form these two replaced could not fail
  // on the class the review found — the free-league coin dropping a
  // mode-gated arm — and at 3 leagues the pinned seed 42 already violated the
  // stated ≥3 median threshold (measured: 19/300 seeds lost median and 21/300
  // lost second at 6 leagues, 0/300 after the fix).
  const SEED_RANGE = Array.from({ length: 200 }, (_, i) => i + 1)

  it('BOTH schedule modes appear by construction at ≥2 leagues — over seeds 1..200', () => {
    for (const leagues of [2, 3, 6, 25]) {
      for (const seed of SEED_RANGE) {
        const plan = buildRunPlan({ ...cfg, leagues, seed, season: true })
        const modes = new Set(plan.leagues.map((l) => l.season!.scheduleMode))
        expect([...modes].sort(), `leagues=${leagues} seed=${seed}`).toEqual(['h2h', 'total_points'])
      }
    }
  })

  it('median on / second on / illegal-lineups off each appear at their thresholds — over seeds 1..200', () => {
    for (const seed of SEED_RANGE) {
      const at3 = buildRunPlan({ ...cfg, leagues: 3, seed, season: true })
      expect(at3.leagues.some((l) => l.season!.medianGame), `median at 3 leagues, seed=${seed}`).toBe(true)
      const at4 = buildRunPlan({ ...cfg, leagues: 4, seed, season: true })
      expect(at4.leagues.some((l) => l.season!.medianGame), `median at 4 leagues, seed=${seed}`).toBe(true)
      expect(at4.leagues.some((l) => l.season!.secondOpponent), `second at 4 leagues, seed=${seed}`).toBe(true)
      const at6 = buildRunPlan({ ...cfg, leagues: 6, seed, season: true })
      expect(at6.leagues.some((l) => l.season!.medianGame), `median at 6 leagues, seed=${seed}`).toBe(true)
      expect(at6.leagues.some((l) => l.season!.secondOpponent), `second at 6 leagues, seed=${seed}`).toBe(true)
      expect(at6.leagues.some((l) => !l.season!.allowIllegalLineups), `illegal-off at 6 leagues, seed=${seed}`).toBe(
        true,
      )
    }
  })

  it('a mode-gated guarantee index is FORCED to h2h — the coin can never drop the arm (R918)', () => {
    // The failing seeds the review measured, pinned by name so a regression
    // to "draw the index, then toss the coin" fails here first.
    for (const [leagues, seed] of [[6, 38], [6, 13], [3, 42], [4, 15]] as const) {
      const plan = buildRunPlan({ ...cfg, leagues, seed, season: true })
      expect(plan.leagues.some((l) => l.season!.medianGame), `median leagues=${leagues} seed=${seed}`).toBe(true)
      if (leagues >= 4) {
        expect(plan.leagues.some((l) => l.season!.secondOpponent), `second leagues=${leagues} seed=${seed}`).toBe(true)
      }
    }
  })

  it('total_points forces playoff_teams = 0 (the v2.16.25 / Q39 (C) coupling the schema refuses to break)', () => {
    const plan = buildRunPlan({ ...cfg, leagues: 25, season: true })
    for (const league of plan.leagues) {
      if (league.season!.scheduleMode !== 'total_points') continue
      expect(league.season!.playoffTeams).toBe(0)
      // …and a points race carries no median game either (§11.7: the mode
      // already scores every team against the field).
      expect(league.season!.medianGame).toBe(false)
      expect(league.season!.secondOpponent).toBe(false)
    }
  })

  it('playoff_start_week = regular_season_weeks + 1 (Q10 / §7.3.8 seam) and playoff_teams ≤ team_count', () => {
    const plan = buildRunPlan({ ...cfg, leagues: 25, season: true })
    for (const league of plan.leagues) {
      const s = league.season!
      expect(s.playoffStartWeek).toBe(s.regularSeasonWeeks + 1)
      expect(s.regularSeasonWeeks).toBeGreaterThanOrEqual(12)
      expect(s.regularSeasonWeeks).toBeLessThanOrEqual(15)
      expect(s.playoffTeams).toBeLessThanOrEqual(league.teamCount)
    }
  })

  it('the LOCK AXIS is `allow_illegal_lineups` alone — Q34(A)/114 and Q35/115 retired the other two', () => {
    // A pin, not a comment: the schema's `lineup_lock` enum is single-valued
    // and `player_game_lock` is refused by the strict object. If either
    // returns, this test is where the matrix gains an arm.
    expect(leagueSettingsSchema.shape.lineup_lock.parse('per_player_kickoff')).toBe('per_player_kickoff')
    expect(() => leagueSettingsSchema.shape.lineup_lock.parse('first_game_of_week')).toThrow()
    expect(() =>
      leagueSettingsSchema.parse({ ...defaultsForTeamCount(10), player_game_lock: true }),
    ).toThrow()
    // And DIVISIONS was cut to 1 by Q30 (d): the matrix does not draw it.
    const plan = buildRunPlan({ ...cfg, leagues: 6, season: true })
    expect(plan.leagues.every((l) => !('divisions' in (l.season ?? {})))).toBe(true)
  })

  it('--seed replays the season matrix EXACTLY', () => {
    expect(buildRunPlan({ ...cfg, season: true })).toEqual(buildRunPlan({ ...cfg, season: true }))
  })

  it('a different seed draws a different matrix (negative control)', () => {
    expect(buildRunPlan({ ...cfg, seed: 43, season: true })).not.toEqual(
      buildRunPlan({ ...cfg, season: true }),
    )
  })

  it('the printed season line names every axis actually set', () => {
    const plan = buildRunPlan({ leagues: 2, teams: 8, clockSeconds: 30, seed: 42, season: true })
    const line = seasonPlanLines(plan)[0]!
    expect(line).toContain('8 teams')
    expect(line).toMatch(/h2h|total_points/)
    expect(line).toContain('median ')
    expect(line).toContain('second ')
    expect(line).toContain('illegal-lineups ')
    expect(line).toContain('regular weeks')
    expect(line).toContain('playoff_teams')
  })
})
