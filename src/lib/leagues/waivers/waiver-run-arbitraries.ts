/**
 * waiver-run-arbitraries.ts — the fast-check generators for `resolveWaiverRun`
 * inputs, shared by the property suite (`resolve-waiver-run-property.test.ts`)
 * and the SQL ⇔ TS parity suite (`waivers-resolver-parity-db.test.ts`, L.D2.9
 * — the SAME random claim sets through both implementations). Test-support
 * only. Small player pools and clustered bids so contested players, equal
 * bids, shared drops, over-full rosters, caps and locks all occur; three
 * shapes random claims rarely form are planted amid random noise
 * (`cycleArb`, `tieArb`, `burnArb`).
 */
import fc from 'fast-check'

import type { WaiverRunClaim, WaiverRunInput } from './resolve-waiver-run'

export const PLAYERS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'pa', 'pb']
export const TEAM_IDS = ['tA', 'tB', 'tC', 'tD', 'tE']
export const CLAIM_IDS = Array.from({ length: 16 }, (_, i) => `c${String(i).padStart(2, '0')}`)

// ── The generator ────────────────────────────────────────────────────────────

export const bidArb = fc.oneof(fc.integer({ min: 0, max: 60 }), fc.constantFrom(5, 10, 20, 30))

export const generalArb: fc.Arbitrary<WaiverRunInput> = fc
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
 * L.D2.8's CYCLE shape, planted into a random FAAB league with random noise
 * around it: two active teams, each ranking a small bid ABOVE a bigger one
 * that outbids the other team, unable to afford both —
 *   A: #1 X a1, #2 Y a2 (a2 > b1),  balance < a1 + a2;
 *   B: #1 Y b1, #2 X b2 (b2 > a1),  balance < b1 + b2.
 * Under F422(b) the bigger bids are the top choices, so this is the densest
 * source of "the bid outranks the manager's order" (property 9's population).
 */
export const cycleArb: fc.Arbitrary<WaiverRunInput> = fc
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
 * #1 X at b — and #2 Y at a bigger, uncontested bid. Under F422(a)+(b) A's
 * bigger bid wins first and burns its priority, so the tie can flip — a
 * priority tie and an earlier win of the same team meet in one run (random
 * claims rarely line up like this).
 */
export const tieArb: fc.Arbitrary<WaiverRunInput> = fc
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

/**
 * F422(a)'s SHAPE planted into a random league of ANY waiver type (no
 * standings, no stored order, so the run starts from reverse draft order):
 * the team holding first priority, F, claims X then Y; the next team, S,
 * claims Y — all at one bid. F wins X, burns its priority, and S takes Y on
 * the tie. Random claims form this too rarely in the priority types.
 */
export const burnArb: fc.Arbitrary<WaiverRunInput> = fc
  .tuple(generalArb, fc.record({ b: fc.integer({ min: 0, max: 20 }), extra: fc.nat({ max: 30 }) }))
  .map(([base, k]) => {
    const order = base.priority.draftOrder
    if (order.length < 2) return base
    const F = order[order.length - 1]
    const S = order[order.length - 2]
    const maxRoster = Math.max(...base.teams.map((t) => t.roster.length))
    const bid = base.settings.waiverType === 'faab' ? k.b : 0
    return {
      ...base,
      settings: {
        ...base.settings,
        rosterSize: Math.max(base.settings.rosterSize, maxRoster + 3),
        acquisitionsPerWeek: null,
        acquisitionsPerSeason: null,
      },
      teams: base.teams.map((t) =>
        t.teamId === F ? { ...t, faabBalance: 2 * k.b + k.extra } : t.teamId === S ? { ...t, faabBalance: k.b + k.extra } : t,
      ),
      claims: [
        ...base.claims.map((c) => (c.teamId === F || c.teamId === S ? { ...c, claimOrder: c.claimOrder + 2 } : c)),
        { claimId: 'k7', teamId: F, addPlayerId: 'X+', dropPlayerId: null, faabBid: bid, claimOrder: 1 },
        { claimId: 'k8', teamId: F, addPlayerId: 'Y+', dropPlayerId: null, faabBid: bid, claimOrder: 2 },
        { claimId: 'k9', teamId: S, addPlayerId: 'Y+', dropPlayerId: null, faabBid: bid, claimOrder: 1 },
      ],
      priority: { ...base.priority, standings: null, rolling: null },
    } satisfies WaiverRunInput
  })

export const inputArb: fc.Arbitrary<WaiverRunInput> = fc.oneof(
  { weight: 4, arbitrary: generalArb },
  { weight: 1, arbitrary: cycleArb },
  { weight: 1, arbitrary: tieArb },
  { weight: 1, arbitrary: burnArb },
)
