/**
 * Run-plan + seeded-stream pins — L.B6.1 (§4.3 falsifiability floor:
 * stored-literal goldens captured from a real run of the pure derivation,
 * then frozen; a drifting plan fails the literal, a broken guarantee fails
 * the structural sweeps).
 */
import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../stats/synthetic/prng'
import { buildRunPlan, planLines } from './plan'
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
