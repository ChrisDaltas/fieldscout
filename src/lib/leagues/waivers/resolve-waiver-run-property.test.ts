/**
 * resolve-waiver-run-property.test.ts — L.D2.8's PROPERTY suite (tasks-M5
 * §6 L.D2.8 "Proofs"; delivery plan §3 M5 exit criterion 2, "deterministic
 * FAAB tiebreak property tests"). fast-check over random leagues and claim
 * sets — small player pools and clustered bids, so contested players, equal
 * bids, shared drops, over-full rosters, caps, locks and the deadlock cycle
 * all occur (the coverage cell at the bottom counts them and fails if any is
 * zero — an invariant over an empty population proves nothing). Two shapes
 * random claims rarely form are PLANTED amid random noise: the deadlock cycle
 * (`cycleArb`) and R1176's priority tie beside a bigger lower-ranked claim
 * (`tieArb`).
 *
 *   1. determinism — same input ⇒ byte-identical output; the input is not
 *      mutated;
 *   2. order independence — shuffling the claim / team / roster / lock arrays
 *      (sets, not orders) never changes a byte;
 *   3. every claim is decided exactly once, decisions numbered 1..N;
 *   4. exclusivity — no player awarded twice, never to a team that already
 *      had him, rosters after = rosters before − won drops + won adds, no
 *      player on two rosters;
 *   5. money — FAAB never below zero; each team's balance falls by exactly
 *      its won bids; a claim that does not go through spends nothing; a
 *      priority league spends nothing; a team with no win is untouched;
 *   6. room and caps — a team that wins ends within its roster size and its
 *      caps;
 *   7. every award is executable at its turn (replayed state): the add
 *      unowned and unlocked, the drop on the team and unlocked, room, caps,
 *      budget;
 *   8. Q71 — highest bid wins: another team's higher bid on a won player
 *      only ever fails for its OWN reasons, decided before the award; a
 *      `lost` claim lost to another team's claim with a bid ≥ its own
 *      (`outbid` iff strictly lower); nobody is `lost` on a player nobody
 *      won; a `lost_on_priority` loser's winner held the better priority
 *      position AT THE MOMENT HE WON (the current rolling order, replayed —
 *      not the run-start order) (R1177);
 *   9. Q71 — a team's ranking settles its running out: a ready (non-break)
 *      award never leaves one of the same team's HIGHER-ranked pending
 *      claims unable to go through;
 *  10. priority rotation — rolling: winners move to the back in the order of
 *      their last win, non-winners keep their relative order; otherwise the
 *      order is unchanged;
 *  11. E7 — equal top bids go to the worse team under reverse standings, and
 *      flipping the two teams in the standings flips the winner;
 *  12. FAIL_CHECK_ORDER (R1177) — every step-1 `invalid` reason is the FIRST
 *      failing check, in this file's own independently written order
 *      (`failures()`), against the state replayed to its decision point;
 *  13. Q71 / R1176 — in a rotating league a team never loses a claim on
 *      priority BECAUSE OF a win on one of its own LOWER-ranked claims
 *      earlier in the same run: with those rotations undone, the winner was
 *      still ahead (its higher-ranked claim goes first).
 *
 * SEED: fixed literal (replayable); FC_SEED=<n> / FC_RUNS=<n> override.
 * A counterexample is a FINDING, never a generator constraint to massage.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  resolveWaiverRun,
  serializeWaiverRunResult,
  type WaiverClaimOutcome,
  type WaiverRunClaim,
  type WaiverRunInput,
  type WaiverRunResult,
} from './resolve-waiver-run'

const SEED = process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : 20260928
const NUM_RUNS = process.env.FC_RUNS !== undefined ? Number(process.env.FC_RUNS) : 1000
const FC = { seed: SEED, numRuns: NUM_RUNS, verbose: true } as const

const PLAYERS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'pa', 'pb']
const TEAM_IDS = ['tA', 'tB', 'tC', 'tD', 'tE']
const CLAIM_IDS = Array.from({ length: 16 }, (_, i) => `c${String(i).padStart(2, '0')}`)

// ── The generator ────────────────────────────────────────────────────────────

const bidArb = fc.oneof(fc.integer({ min: 0, max: 60 }), fc.constantFrom(5, 10, 20, 30))

const generalArb: fc.Arbitrary<WaiverRunInput> = fc
  .record({
    nTeams: fc.integer({ min: 2, max: 5 }),
    waiverType: fc.constantFrom('faab', 'faab', 'rolling_priority', 'reverse_standings'),
    faabTiebreaker: fc.constantFrom('reverse_standings', 'rolling_priority'),
    rosterSize: fc.integer({ min: 1, max: 6 }),
    capWeek: fc.option(fc.integer({ min: 0, max: 4 }), { freq: 2 }),
    capSeason: fc.option(fc.integer({ min: 0, max: 6 }), { freq: 2 }),
    // Negative = unowned; weighted toward unowned so there is something to claim.
    owners: fc.array(fc.integer({ min: -7, max: 4 }), { minLength: PLAYERS.length, maxLength: PLAYERS.length }),
    balances: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 5, maxLength: 5 }),
    accWeek: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 5, maxLength: 5 }),
    accSeason: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 5, maxLength: 5 }),
    retiredMask: fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 5, maxLength: 5 }),
    rawClaims: fc.array(
      fc.record({
        team: fc.integer({ min: 0, max: 4 }),
        // 'free' picks among the players unowned at the start (most claims),
        // 'any' among all (exercises add_rostered).
        addKind: fc.constantFrom('free', 'free', 'free', 'any'),
        add: fc.nat(),
        dropKind: fc.constantFrom('none', 'own', 'own', 'any'),
        dropPick: fc.nat(),
        bid: bidArb,
        order: fc.integer({ min: 1, max: 6 }),
      }),
      { maxLength: CLAIM_IDS.length },
    ),
    uniqueOrders: fc.boolean(),
    claimIds: fc.shuffledSubarray(CLAIM_IDS, { minLength: CLAIM_IDS.length, maxLength: CLAIM_IDS.length }),
    lockedMask: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: PLAYERS.length, maxLength: PLAYERS.length }),
    draftPerm: fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 }),
    standingsPerm: fc.option(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 })),
    rollingPerm: fc.option(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 })),
    rollingGap: fc.integer({ min: 1, max: 3 }),
  })
  .map((g) => {
    const ids = TEAM_IDS.slice(0, g.nTeams)
    const retired = ids.map((_, i) => g.retiredMask[i] === 0)
    // Keep at least one active team (a league of only sealed teams has no
    // priority order to speak of).
    if (retired.every(Boolean)) retired[0] = false
    const rosters = ids.map(() => [] as string[])
    g.owners.forEach((o, p) => {
      if (o >= 0 && o < g.nTeams) rosters[o].push(PLAYERS[p])
    })
    const teams = ids.map((teamId, i) => ({
      teamId,
      roster: rosters[i],
      faabBalance: g.balances[i],
      acquisitionsWeek: g.accWeek[i],
      acquisitionsSeason: g.accSeason[i],
      retired: retired[i],
    }))
    const perTeamCount = ids.map(() => 0)
    const free = PLAYERS.filter((p) => !rosters.some((r) => r.includes(p)))
    const claims: WaiverRunClaim[] = g.rawClaims.map((rc, i) => {
      const t = rc.team % g.nTeams
      const add =
        rc.addKind === 'free' && free.length > 0 ? free[rc.add % free.length] : PLAYERS[rc.add % PLAYERS.length]
      let drop: string | null = null
      if (rc.dropKind === 'own' && rosters[t].length > 0) drop = rosters[t][rc.dropPick % rosters[t].length]
      if (rc.dropKind === 'any') drop = PLAYERS[rc.dropPick % PLAYERS.length]
      if (drop === add) drop = null
      perTeamCount[t] += 1
      return {
        claimId: g.claimIds[i],
        teamId: ids[t],
        addPlayerId: add,
        dropPlayerId: drop,
        faabBid: rc.bid,
        claimOrder: g.uniqueOrders ? perTeamCount[t] : rc.order,
      }
    })
    const active = ids.filter((_, i) => !retired[i])
    const permOf = (perm: number[]): string[] => perm.filter((i) => i < g.nTeams && !retired[i]).map((i) => ids[i])
    const rolling =
      g.rollingPerm === null
        ? null
        : Object.fromEntries(permOf(g.rollingPerm).map((id, i) => [id, 1 + i * g.rollingGap]))
    return {
      settings: {
        waiverType: g.waiverType,
        faabTiebreaker: g.faabTiebreaker,
        rosterSize: g.rosterSize,
        acquisitionsPerWeek: g.capWeek,
        acquisitionsPerSeason: g.capSeason,
      },
      teams,
      claims,
      priority: {
        draftOrder: permOf(g.draftPerm),
        standings: g.standingsPerm === null ? null : permOf(g.standingsPerm),
        rolling: active.length > 0 ? rolling : null,
      },
      lockedPlayerIds: PLAYERS.filter((_, p) => g.lockedMask[p] === 0),
    } satisfies WaiverRunInput
  })

/**
 * The CYCLE the deadlock break exists for, planted into a random FAAB league
 * with random noise around it: two active teams, each outbidding the other
 * on its #2 claim while unable to afford #1 + #2 —
 *   A: #1 X a1, #2 Y a2 (a2 > b1),  balance < a1 + a2;
 *   B: #1 Y b1, #2 X b2 (b2 > a1),  balance < b1 + b2.
 * Random claims can form one, but too rarely to prove the break non-vacuous.
 */
const cycleArb: fc.Arbitrary<WaiverRunInput> = fc
  .tuple(
    generalArb,
    fc.record({
      a1: fc.integer({ min: 1, max: 20 }),
      b1: fc.integer({ min: 1, max: 20 }),
      r: fc.integer({ min: 0, max: 20 }),
      s: fc.integer({ min: 0, max: 20 }),
      t: fc.nat(),
      u: fc.nat(),
    }),
  )
  .map(([base, k]) => {
    const active = base.teams.filter((t) => !t.retired).map((t) => t.teamId)
    if (active.length < 2) return base
    const [A, B] = active
    const a2 = k.b1 + 1 + k.r
    const b2 = k.a1 + 1 + k.s
    const balA = a2 + (k.t % k.a1)
    const balB = b2 + (k.u % k.b1)
    const maxRoster = Math.max(...base.teams.map((t) => t.roster.length))
    return {
      ...base,
      settings: {
        ...base.settings,
        waiverType: 'faab',
        rosterSize: Math.max(base.settings.rosterSize, maxRoster + 2),
        acquisitionsPerWeek: null,
        acquisitionsPerSeason: null,
      },
      teams: base.teams.map((t) =>
        t.teamId === A ? { ...t, faabBalance: balA } : t.teamId === B ? { ...t, faabBalance: balB } : t,
      ),
      claims: [
        // The team's other claims rank after the planted pair.
        ...base.claims.map((c) => (c.teamId === A || c.teamId === B ? { ...c, claimOrder: c.claimOrder + 2 } : c)),
        { claimId: 'k0', teamId: A, addPlayerId: 'X*', dropPlayerId: null, faabBid: k.a1, claimOrder: 1 },
        { claimId: 'k1', teamId: A, addPlayerId: 'Y*', dropPlayerId: null, faabBid: a2, claimOrder: 2 },
        { claimId: 'k2', teamId: B, addPlayerId: 'Y*', dropPlayerId: null, faabBid: k.b1, claimOrder: 1 },
        { claimId: 'k3', teamId: B, addPlayerId: 'X*', dropPlayerId: null, faabBid: b2, claimOrder: 2 },
      ],
    } satisfies WaiverRunInput
  })

/**
 * R1176's SHAPE planted into a random ROTATING FAAB league (the rolling
 * tiebreaker) with noise around it: A ranks #1 X at bid b — tied with B's
 * #1 X at b — and #2 Y at a bigger, uncontested bid. Whichever of A / B holds
 * the better position, a priority tie and a bigger lower-ranked claim of the
 * same team meet in one run (random claims rarely line up like this).
 */
const tieArb: fc.Arbitrary<WaiverRunInput> = fc
  .tuple(
    generalArb,
    fc.record({ b: fc.integer({ min: 0, max: 20 }), r: fc.integer({ min: 0, max: 20 }), extra: fc.nat({ max: 30 }) }),
  )
  .map(([base, k]) => {
    const active = base.teams.filter((t) => !t.retired).map((t) => t.teamId)
    if (active.length < 2) return base
    const [A, B] = active
    const y = k.b + 1 + k.r
    const maxRoster = Math.max(...base.teams.map((t) => t.roster.length))
    return {
      ...base,
      settings: {
        ...base.settings,
        waiverType: 'faab',
        faabTiebreaker: 'rolling_priority',
        rosterSize: Math.max(base.settings.rosterSize, maxRoster + 2),
        acquisitionsPerWeek: null,
        acquisitionsPerSeason: null,
      },
      teams: base.teams.map((t) =>
        t.teamId === A ? { ...t, faabBalance: k.b + y + k.extra } : t.teamId === B ? { ...t, faabBalance: k.b + k.extra } : t,
      ),
      claims: [
        ...base.claims.map((c) => (c.teamId === A || c.teamId === B ? { ...c, claimOrder: c.claimOrder + 2 } : c)),
        { claimId: 'k4', teamId: A, addPlayerId: 'X*', dropPlayerId: null, faabBid: k.b, claimOrder: 1 },
        { claimId: 'k5', teamId: A, addPlayerId: 'Y*', dropPlayerId: null, faabBid: y, claimOrder: 2 },
        { claimId: 'k6', teamId: B, addPlayerId: 'X*', dropPlayerId: null, faabBid: k.b, claimOrder: 1 },
      ],
    } satisfies WaiverRunInput
  })

const inputArb: fc.Arbitrary<WaiverRunInput> = fc.oneof(
  { weight: 4, arbitrary: generalArb },
  { weight: 1, arbitrary: cycleArb },
  { weight: 1, arbitrary: tieArb },
)

// ── Test-side model (an independent re-statement of the checks) ─────────────

interface ReplayState {
  owner: Map<string, string>
  count: Map<string, number>
  balance: Map<string, number>
  accWeek: Map<string, number>
  accSeason: Map<string, number>
}

const faabMode = (inp: WaiverRunInput): boolean => inp.settings.waiverType === 'faab'
const eff = (inp: WaiverRunInput, c: WaiverRunClaim): number => (faabMode(inp) ? c.faabBid : 0)

/** The priority order at the moment decision `upTo` is made, with `c`'s
 *  team's wins on claims it ranked BELOW `c` undone: the run-start order,
 *  and in a rotating league every other earlier winner moved to the back. */
function orderAt(
  res: WaiverRunResult,
  byId: Map<string, WaiverRunClaim>,
  upTo: number,
  c: WaiverRunClaim,
): string[] {
  let order = [...res.priority.before]
  if (!res.priority.rotates) return order
  for (const o of res.outcomes) {
    if (o.decision >= upTo || o.status !== 'won') continue
    if (o.teamId === c.teamId && rankedAbove(c, byId.get(o.claimId) as WaiverRunClaim)) continue
    order = [...order.filter((id) => id !== o.teamId), o.teamId]
  }
  return order
}

/** Where `c`'s team stands FOR `c` at the moment decision `upTo` is made
 *  (lower = better; comparable across teams): its run-start index, or — in a
 *  rotating league — the run's win count at its latest earlier win on a claim
 *  it ranked ABOVE `c`, past every start index. A win it ranked below `c`
 *  does not move it for `c` (R1176). */
function standingFor(
  res: WaiverRunResult,
  byId: Map<string, WaiverRunClaim>,
  upTo: number,
  c: WaiverRunClaim,
): number {
  let at = res.priority.before.indexOf(c.teamId)
  if (!res.priority.rotates) return at
  let n = 0
  for (const o of res.outcomes) {
    if (o.status !== 'won') continue
    if (o.decision < upTo && o.teamId === c.teamId && rankedAbove(byId.get(o.claimId) as WaiverRunClaim, c)) {
      at = res.priority.before.length + n
    }
    n++
  }
  return at
}

/** The state after every award with `decision < upTo` (the input state for 1). */
function replay(inp: WaiverRunInput, res: WaiverRunResult, upTo: number): ReplayState {
  const s: ReplayState = { owner: new Map(), count: new Map(), balance: new Map(), accWeek: new Map(), accSeason: new Map() }
  for (const t of inp.teams) {
    for (const p of t.roster) s.owner.set(p, t.teamId)
    s.count.set(t.teamId, t.roster.length)
    s.balance.set(t.teamId, t.faabBalance ?? 0)
    s.accWeek.set(t.teamId, t.acquisitionsWeek)
    s.accSeason.set(t.teamId, t.acquisitionsSeason)
  }
  const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
  for (const o of res.outcomes) {
    if (o.decision >= upTo || o.status !== 'won') continue
    const c = byId.get(o.claimId) as WaiverRunClaim
    s.owner.set(c.addPlayerId, c.teamId)
    if (c.dropPlayerId !== null) s.owner.delete(c.dropPlayerId)
    s.count.set(c.teamId, (s.count.get(c.teamId) ?? 0) + (c.dropPlayerId === null ? 1 : 0))
    s.balance.set(c.teamId, (s.balance.get(c.teamId) ?? 0) - o.faabSpent)
    s.accWeek.set(c.teamId, (s.accWeek.get(c.teamId) ?? 0) + 1)
    s.accSeason.set(c.teamId, (s.accSeason.get(c.teamId) ?? 0) + 1)
  }
  return s
}

/** Which checks `c` fails in state `s`, in the precedence order written out
 *  HERE, independently of the resolver's FAIL_CHECK_ORDER (property 12). */
function failures(inp: WaiverRunInput, s: ReplayState, c: WaiverRunClaim): string[] {
  const out: string[] = []
  const locked = new Set(inp.lockedPlayerIds)
  const { rosterSize, acquisitionsPerWeek: cw, acquisitionsPerSeason: cs } = inp.settings
  if (inp.teams.some((t) => t.teamId === c.teamId && t.retired)) out.push('team_retired')
  if (s.owner.has(c.addPlayerId)) out.push('add_rostered')
  if (locked.has(c.addPlayerId)) out.push('add_locked')
  if (c.dropPlayerId !== null && s.owner.get(c.dropPlayerId) !== c.teamId) out.push('drop_gone')
  if (c.dropPlayerId !== null && locked.has(c.dropPlayerId)) out.push('drop_locked')
  if ((s.count.get(c.teamId) ?? 0) + (c.dropPlayerId === null ? 1 : 0) > rosterSize) out.push('roster_full')
  if ((cw !== null && (s.accWeek.get(c.teamId) ?? 0) >= cw) || (cs !== null && (s.accSeason.get(c.teamId) ?? 0) >= cs)) {
    out.push('cap_reached')
  }
  if (faabMode(inp) && eff(inp, c) > (s.balance.get(c.teamId) ?? 0)) out.push('insufficient_faab')
  return out
}

const RESOURCE = new Set(['insufficient_faab', 'roster_full', 'drop_gone', 'cap_reached'])
const rankedAbove = (h: WaiverRunClaim, c: WaiverRunClaim): boolean =>
  h.claimOrder < c.claimOrder || (h.claimOrder === c.claimOrder && h.claimId < c.claimId)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffled<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Properties ───────────────────────────────────────────────────────────────

describe('resolveWaiverRun — properties (fast-check, seeded)', () => {
  it('1. determinism: same input ⇒ byte-identical output, and the input is not mutated', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const before = JSON.stringify(inp)
        const a = serializeWaiverRunResult(resolveWaiverRun(inp))
        expect(JSON.stringify(inp)).toBe(before)
        const b = serializeWaiverRunResult(resolveWaiverRun(structuredClone(inp)))
        expect(b).toBe(a)
      }),
      FC,
    )
  })

  it('2. order independence: shuffling claims / teams / rosters / locks / the rolling map never changes a byte', () => {
    fc.assert(
      fc.property(inputArb, fc.integer(), (inp, seed) => {
        const rnd = mulberry32(seed)
        const rolling = inp.priority.rolling
        const shuffledInput: WaiverRunInput = {
          ...inp,
          claims: shuffled(inp.claims, rnd),
          teams: shuffled(inp.teams, rnd).map((t) => ({ ...t, roster: shuffled(t.roster, rnd) })),
          lockedPlayerIds: shuffled(inp.lockedPlayerIds, rnd),
          priority: {
            ...inp.priority,
            rolling: rolling === null ? null : Object.fromEntries(shuffled(Object.entries(rolling), rnd)),
          },
        }
        expect(serializeWaiverRunResult(resolveWaiverRun(shuffledInput))).toBe(
          serializeWaiverRunResult(resolveWaiverRun(inp)),
        )
      }),
      FC,
    )
  })

  it('3. every claim is decided exactly once, decisions numbered 1..N', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        expect(res.outcomes.map((o) => o.decision)).toEqual(inp.claims.map((_, i) => i + 1))
        expect(res.outcomes.map((o) => o.claimId).sort()).toEqual(inp.claims.map((c) => c.claimId).sort())
        expect(res.teams.map((t) => t.teamId)).toEqual(inp.teams.map((t) => t.teamId).sort())
      }),
      FC,
    )
  })

  it('4. exclusivity: no player awarded twice or to a team that had him; rosters after = before − drops + adds; nobody on two rosters', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const startOwner = new Map<string, string>()
        for (const t of inp.teams) for (const p of t.roster) startOwner.set(p, t.teamId)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const won = res.outcomes.filter((o) => o.status === 'won').map((o) => byId.get(o.claimId) as WaiverRunClaim)
        const adds = won.map((c) => c.addPlayerId)
        expect(new Set(adds).size).toBe(adds.length)
        for (const c of won) {
          expect(startOwner.has(c.addPlayerId)).toBe(false)
          if (c.dropPlayerId !== null) expect(startOwner.get(c.dropPlayerId)).toBe(c.teamId)
        }
        const seen = new Set<string>()
        for (const t of res.teams) {
          for (const p of t.rosterAfter) {
            expect(seen.has(p)).toBe(false)
            seen.add(p)
          }
          const start = inp.teams.find((x) => x.teamId === t.teamId)?.roster ?? []
          const mine = won.filter((c) => c.teamId === t.teamId)
          const expected = new Set(start)
          for (const c of mine) if (c.dropPlayerId !== null) expected.delete(c.dropPlayerId)
          for (const c of mine) expected.add(c.addPlayerId)
          expect(t.rosterAfter).toEqual([...expected].sort())
        }
      }),
      FC,
    )
  })

  it('5. money: FAAB never below zero; balances fall by exactly the won bids; a failed claim or a priority league spends nothing', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        for (const o of res.outcomes) {
          if (o.status !== 'won') expect(o.faabSpent).toBe(0)
          else expect(o.faabSpent).toBe(eff(inp, byId.get(o.claimId) as WaiverRunClaim))
        }
        for (const t of res.teams) {
          const spent = res.outcomes
            .filter((o) => o.teamId === t.teamId && o.status === 'won')
            .reduce((s, o) => s + o.faabSpent, 0)
          if (!faabMode(inp)) {
            expect(spent).toBe(0)
            expect(t.faabAfter).toBe(t.faabBefore)
          } else if (t.faabBefore !== null) {
            expect(t.faabAfter).toBe(t.faabBefore - spent)
            expect(t.faabAfter as number).toBeGreaterThanOrEqual(0)
          }
        }
      }),
      FC,
    )
  })

  it('6. room and caps: a team that wins ends within its roster size and its caps; a team that wins nothing is untouched', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const { rosterSize, acquisitionsPerWeek: cw, acquisitionsPerSeason: cs } = inp.settings
        for (const t of res.teams) {
          const start = inp.teams.find((x) => x.teamId === t.teamId)
          const wins = res.outcomes.filter((o) => o.teamId === t.teamId && o.status === 'won').length
          expect(t.acquisitionsWeekAfter).toBe((start?.acquisitionsWeek ?? 0) + wins)
          expect(t.acquisitionsSeasonAfter).toBe((start?.acquisitionsSeason ?? 0) + wins)
          if (wins === 0) {
            expect(t.rosterAfter).toEqual([...(start?.roster ?? [])].sort())
            continue
          }
          expect(t.rosterAfter.length).toBeLessThanOrEqual(rosterSize)
          if (cw !== null) expect(t.acquisitionsWeekAfter).toBeLessThanOrEqual(cw)
          if (cs !== null) expect(t.acquisitionsSeasonAfter).toBeLessThanOrEqual(cs)
        }
      }),
      FC,
    )
  })

  it('7. every award is executable at its turn (replayed state): unowned, unlocked, drop on the team and unlocked, room, caps, budget; never a retired team', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const retired = new Set(inp.teams.filter((t) => t.retired).map((t) => t.teamId))
        for (const o of res.outcomes) {
          if (o.status !== 'won') continue
          const c = byId.get(o.claimId) as WaiverRunClaim
          expect(retired.has(c.teamId)).toBe(false)
          expect(failures(inp, replay(inp, res, o.decision), c)).toEqual([])
        }
      }),
      FC,
    )
  })

  it('8. Q71 — the highest bid wins each player: a higher bid from another team only ever fails for its own reasons, before the award', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const out = new Map(res.outcomes.map((o) => [o.claimId, o]))
        const wonBy = new Map<string, WaiverClaimOutcome>()
        for (const o of res.outcomes) if (o.status === 'won') wonBy.set(o.addPlayerId, o)
        for (const c of inp.claims) {
          const o = out.get(c.claimId) as WaiverClaimOutcome
          const w = wonBy.get(c.addPlayerId)
          if (w === undefined) {
            // Nobody won him: no claim on him lost to a rival.
            expect(o.status === 'lost' || o.reason === 'own_claim_won').toBe(false)
            continue
          }
          const wc = byId.get(w.claimId) as WaiverRunClaim
          if (c.claimId === w.claimId || c.teamId === wc.teamId) continue
          if (eff(inp, c) > eff(inp, wc)) {
            expect(o.status).toBe('invalid')
            expect(o.decision).toBeLessThan(w.decision)
          }
          if (o.status === 'lost') {
            expect(eff(inp, c)).toBeLessThanOrEqual(eff(inp, wc))
            expect(o.reason).toBe(eff(inp, c) < eff(inp, wc) ? 'outbid' : 'lost_on_priority')
            expect(o.decision).toBeGreaterThan(w.decision)
          }
          if (o.reason === 'lost_on_priority') {
            // R1177: the winner held the better position AT THE MOMENT HE WON
            // — the current (rolling) order, each side as it stood for its
            // own claim (R1176), never the run-start order.
            const winnerAt = standingFor(res, byId, w.decision, wc)
            expect(winnerAt).toBeGreaterThanOrEqual(0)
            expect(winnerAt).toBeLessThan(standingFor(res, byId, w.decision, c))
          }
        }
      }),
      FC,
    )
  })

  it("9. Q71 — a team's ranking settles its running out: a ready award never costs the team a higher-ranked claim still pending", () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const out = new Map(res.outcomes.map((o) => [o.claimId, o]))
        for (const w of res.outcomes) {
          if (w.status !== 'won' || w.deadlockBreak) continue
          const k = byId.get(w.claimId) as WaiverRunClaim
          const pre = replay(inp, res, w.decision)
          const post = replay(inp, res, w.decision + 1)
          for (const j of inp.claims) {
            if (j.teamId !== k.teamId || j.addPlayerId === k.addPlayerId || !rankedAbove(j, k)) continue
            if ((out.get(j.claimId) as WaiverClaimOutcome).decision < w.decision) continue // already decided
            if (failures(inp, pre, j).length > 0) continue // it could not go through anyway
            const newly = failures(inp, post, j).filter((r) => RESOURCE.has(r))
            expect(newly).toEqual([])
          }
        }
      }),
      FC,
    )
  })

  it('10. priority rotation: rolling moves winners to the back (by last win), non-winners keep their order; otherwise unchanged', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const { before, after, rotates } = res.priority
        const t = inp.settings
        expect(rotates).toBe(t.waiverType === 'rolling_priority' || (t.waiverType === 'faab' && t.faabTiebreaker === 'rolling_priority'))
        if (!rotates) {
          expect(after).toEqual(before)
          return
        }
        const lastWin = new Map<string, number>()
        for (const o of res.outcomes) if (o.status === 'won') lastWin.set(o.teamId, o.decision)
        const expected = [
          ...before.filter((id) => !lastWin.has(id)),
          ...[...lastWin.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id),
        ]
        expect(after).toEqual(expected)
      }),
      FC,
    )
  })

  it('11. E7: equal top bids go to the worse team under reverse standings; flipping the pair in the standings flips the winner', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.shuffledSubarray(TEAM_IDS, { minLength: 5, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        (bid, standings, i, d) => {
          const j = (i + d) % 5
          const [x, y] = [standings[i], standings[j]]
          const worse = i > j ? x : y
          const mk = (st: string[]): WaiverRunInput => ({
            settings: { waiverType: 'faab', faabTiebreaker: 'reverse_standings', rosterSize: 5, acquisitionsPerWeek: null, acquisitionsPerSeason: null },
            teams: TEAM_IDS.map((teamId) => ({ teamId, roster: [], faabBalance: 50, acquisitionsWeek: 0, acquisitionsSeason: 0, retired: false })),
            claims: [
              { claimId: 'cx', teamId: x, addPlayerId: 'P', dropPlayerId: null, faabBid: bid, claimOrder: 1 },
              { claimId: 'cy', teamId: y, addPlayerId: 'P', dropPlayerId: null, faabBid: bid, claimOrder: 1 },
            ],
            priority: { draftOrder: TEAM_IDS, standings: st, rolling: null },
            lockedPlayerIds: [],
          })
          const winner = (r: WaiverRunResult) => r.outcomes.find((o) => o.status === 'won')?.teamId
          expect(winner(resolveWaiverRun(mk(standings)))).toBe(worse)
          const flipped = [...standings]
          ;[flipped[i], flipped[j]] = [flipped[j], flipped[i]]
          expect(winner(resolveWaiverRun(mk(flipped)))).toBe(worse === x ? y : x)
        },
      ),
      FC,
    )
  })

  it('12. FAIL_CHECK_ORDER (R1177): every step-1 invalid reason is the first failing check at its decision point', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        for (const o of res.outcomes) {
          if (o.status !== 'invalid' || o.reason === 'own_claim_won') continue
          const c = byId.get(o.claimId) as WaiverRunClaim
          expect(failures(inp, replay(inp, res, o.decision), c)[0]).toBe(o.reason)
        }
      }),
      FC,
    )
  })

  it("13. Q71 / R1176: in a rotating league a team never loses a claim on priority BECAUSE OF a win on a lower-ranked claim of its own", () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const res = resolveWaiverRun(inp)
        if (!res.priority.rotates) return
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const wonBy = new Map<string, WaiverClaimOutcome>()
        for (const o of res.outcomes) if (o.status === 'won') wonBy.set(o.addPlayerId, o)
        for (const j of res.outcomes) {
          if (j.reason !== 'lost_on_priority') continue
          const jc = byId.get(j.claimId) as WaiverRunClaim
          const w = wonBy.get(jc.addPlayerId) as WaiverClaimOutcome
          const wc = byId.get(w.claimId) as WaiverRunClaim
          // Only where the WINNER'S place is plain (it had no earlier win on
          // a claim it ranked below w), so the statement needs no rule for it.
          const winnerPlain = !res.outcomes.some(
            (o) =>
              o.status === 'won' &&
              o.decision < w.decision &&
              o.teamId === wc.teamId &&
              rankedAbove(wc, byId.get(o.claimId) as WaiverRunClaim),
          )
          if (!winnerPlain) continue
          // Undo the loser's own lower-ranked wins: the winner must still be
          // ahead — j would have lost on priority anyway.
          const order = orderAt(res, byId, w.decision, jc)
          expect(
            order.indexOf(w.teamId) < order.indexOf(j.teamId),
            `${j.claimId} lost on priority to ${w.claimId} only because ${j.teamId} won a claim it ranked lower`,
          ).toBe(true)
        }
      }),
      FC,
    )
  })

  it('coverage: the generator reaches every rule the properties speak about (non-vacuity)', () => {
    const counts: Record<string, number> = {}
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
    for (const inp of fc.sample(inputArb, { seed: SEED, numRuns: NUM_RUNS })) {
      const res = resolveWaiverRun(inp)
      bump(`type:${inp.settings.waiverType}`)
      for (const o of res.outcomes) {
        bump(o.status === 'won' ? 'won' : `reason:${o.reason}`)
        if (o.deadlockBreak) bump('deadlockBreak')
      }
      if (res.priority.rotates && res.outcomes.some((o) => o.status === 'won')) bump('rotated')
      bump(`source:${res.priority.source}`)
      const won = res.outcomes.filter((o) => o.status === 'won')
      if (new Set(won.map((o) => o.teamId)).size < won.length) bump('team won several')
      // Property 13's population: a rotating league where a team lost a claim
      // on priority AND won one of its lower-ranked claims in the same run
      // (before the fix, the win came first — R1176; now it comes after).
      if (res.priority.rotates) {
        const byId = new Map(inp.claims.map((c) => [c.claimId, c]))
        const hit = res.outcomes.some(
          (j) =>
            j.reason === 'lost_on_priority' &&
            won.some(
              (k) =>
                k.teamId === j.teamId &&
                rankedAbove(byId.get(j.claimId) as WaiverRunClaim, byId.get(k.claimId) as WaiverRunClaim),
            ),
        )
        if (hit) bump('rotating: priority loss + an own lower-ranked win')
      }
    }
    // eslint-disable-next-line no-console
    console.log('waiver resolver coverage over', NUM_RUNS, 'runs:', JSON.stringify(counts))
    for (const k of [
      'won',
      'type:faab',
      'type:rolling_priority',
      'type:reverse_standings',
      'reason:outbid',
      'reason:lost_on_priority',
      'reason:own_claim_won',
      'reason:team_retired',
      'reason:add_rostered',
      'reason:add_locked',
      'reason:drop_gone',
      'reason:drop_locked',
      'reason:roster_full',
      'reason:cap_reached',
      'reason:insufficient_faab',
      'deadlockBreak',
      'rotated',
      'team won several',
      'rotating: priority loss + an own lower-ranked win',
      'source:rolling',
      'source:reverse_standings',
      'source:reverse_draft_order',
    ]) {
      expect(counts[k] ?? 0, k).toBeGreaterThan(0)
    }
  })
})
