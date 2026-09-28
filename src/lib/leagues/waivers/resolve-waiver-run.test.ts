/**
 * resolve-waiver-run.test.ts — the resolver's WORKED EXAMPLES: one case per
 * ruling (Q71, Q72, Q73, Q74, F422(a)/(b)), per tiebreaker (E7), per priority
 * type, per failure reason, and the input guards. Every expectation is a
 * STORED LITERAL (tasks-M* §4.3 falsifiability floor): the decision sequence,
 * reasons, amounts and balances written out by hand. The invariants over
 * random claim sets live in `resolve-waiver-run-property.test.ts`.
 *
 * L.D2.9 re-cut (Chris, F422, 2026-09-28): (a) every win sends the team to
 * the back at once, for the rest of the run, in every waiver type; (b) in a
 * FAAB league a team's claims rank by bid, its own order only between equal
 * bids. Each example that FLIPPED says so in its title and states what it was
 * under L.D2.8 and why it changed.
 */
import { describe, expect, it } from 'vitest'

import {
  FAIL_CHECK_ORDER,
  resolveWaiverRun,
  serializeWaiverRunResult,
  WaiverRunInputError,
} from './resolve-waiver-run'
import { claim, faabAfter, input, summary, team } from './waiver-run-fixture'

describe('Q71 + F422(b) — the highest bid on a player wins him; a team ranks its own claims by bid', () => {
  it("Chris's example: B's $50 beats A's only claim ($5) on X, and B also gets its $3 claim (unchanged)", () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'X', 5, 1), claim('b1', 'B', 'Y', 3, 1), claim('b2', 'B', 'X', 50, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 b2 won $50', '2 a1 lost:outbid $0', '3 b1 won $3'])
    expect(faabAfter(r)).toEqual({ A: 100, B: 47 })
    expect(r.teams.find((t) => t.teamId === 'B')?.rosterAfter).toEqual(['X', 'Y'])
  })

  it("F422(b), Chris's words: \"if you bid $50, and someone else bids $55, you lose that bid and then the $10 bid becomes your top priority\"", () => {
    // A has $50 and ranks its $10 claim FIRST — F422(b): the order does not
    // matter between different bids, the $50 is A's top choice. B's $55 wins
    // Y; A's $10 on X is then its top priority and goes through.
    const r = resolveWaiverRun(
      input({
        teams: [team('A', [], 50), team('B')],
        claims: [claim('a1', 'A', 'X', 10, 1), claim('a2', 'A', 'Y', 50, 2), claim('b1', 'B', 'Y', 55, 1)],
      }),
    )
    expect(summary(r)).toEqual(['1 b1 won $55', '2 a2 lost:outbid $0', '3 a1 won $10'])
    expect(faabAfter(r)).toEqual({ A: 40, B: 45 })
  })

  it('F422(b): "you cannot have a $10 priority that is higher than $50" — with no rival, the $50 wins first and the $10 runs out of money', () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('A', [], 50)],
        claims: [claim('a1', 'A', 'X', 10, 1), claim('a2', 'A', 'Y', 50, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 a2 won $50', '2 a1 invalid:insufficient_faab $0'])
    expect(faabAfter(r)).toEqual({ A: 0 })
  })

  it("FLIPPED by F422(b) — running out of budget: B's $50 (ranked #2) is B's top choice; its $30 (ranked #1) then can't be afforded", () => {
    // L.D2.8: '1 b1 won $30', '2 b2 invalid:insufficient_faab', '3 a1 won $40'
    // (B's own order put Y first). Now the bigger bid is B's top choice.
    const r = resolveWaiverRun(
      input({
        teams: [team('A'), team('B', [], 60)],
        claims: [claim('a1', 'A', 'X', 40, 1), claim('b1', 'B', 'Y', 30, 1), claim('b2', 'B', 'X', 50, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 b2 won $50', '2 a1 lost:outbid $0', '3 b1 invalid:insufficient_faab $0'])
    expect(faabAfter(r)).toEqual({ A: 100, B: 10 })
  })

  it("FLIPPED by F422(b) — B's $50 on X is its top claim and is decided first; its $10 on Y can then no longer be afforded (same winners, same balances)", () => {
    // L.D2.8: '1 d1 won $45', '2 b1 lost:outbid', '3 b2 won $50', '4 a1 lost:outbid'
    // (B ranked Y first, so X waited until B lost Y). Now X ($50) is B's top
    // claim: it wins, leaving $5, and b1's $10 fails before D's $45 is decided.
    const r = resolveWaiverRun(
      input({
        teams: [team('A'), team('B', [], 55), team('D')],
        claims: [
          claim('a1', 'A', 'X', 40, 1),
          claim('b1', 'B', 'Y', 10, 1),
          claim('b2', 'B', 'X', 50, 2),
          claim('d1', 'D', 'Y', 45, 1),
        ],
      }),
    )
    expect(summary(r)).toEqual(['1 b2 won $50', '2 a1 lost:outbid $0', '3 b1 invalid:insufficient_faab $0', '4 d1 won $45'])
    expect(faabAfter(r)).toEqual({ A: 100, B: 5, D: 55 })
  })

  it('two claims with EQUAL bids dropping the same player: the manager\'s own order decides — #1 wins, #2 fails drop_gone (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { rosterSize: 2 },
        teams: [team('T', ['D', 'E'])],
        claims: [claim('t1', 'T', 'P', 10, 1, 'D'), claim('t2', 'T', 'Q', 10, 2, 'D')],
      }),
    )
    expect(summary(r)).toEqual(['1 t1 won $10', '2 t2 invalid:drop_gone $0'])
    expect(r.teams[0].rosterAfter).toEqual(['E', 'P'])
  })

  it('…and when the #1 is outbid, the #2 goes through with the shared drop (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { rosterSize: 2 },
        teams: [team('T', ['D', 'E']), team('U')],
        claims: [claim('t1', 'T', 'P', 10, 1, 'D'), claim('t2', 'T', 'Q', 10, 2, 'D'), claim('u1', 'U', 'P', 20, 1)],
      }),
    )
    expect(summary(r)).toEqual(['1 u1 won $20', '2 t1 lost:outbid $0', '3 t2 won $10'])
    expect(r.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['E', 'Q'])
  })

  it('FLIPPED by F422(b) — roster room: the bigger bid (ranked #2) takes the last spot; the smaller fails roster_full', () => {
    // L.D2.8: '1 t1 won $5', '2 t2 invalid:roster_full' (the manager's #1 first).
    const r = resolveWaiverRun(
      input({
        settings: { rosterSize: 2 },
        teams: [team('T', ['R1'])],
        claims: [claim('t1', 'T', 'P', 5, 1), claim('t2', 'T', 'Q', 9, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 t2 won $9', '2 t1 invalid:roster_full $0'])
  })

  it('FLIPPED by F422(b) — acquisition caps: the bigger bid uses the one weekly add (and a team already at its cap wins nothing)', () => {
    // L.D2.8: '1 u1 invalid:cap_reached', '2 t1 won $5', '3 t2 invalid:cap_reached'.
    const r = resolveWaiverRun(
      input({
        settings: { acquisitionsPerWeek: 1, acquisitionsPerSeason: 10 },
        teams: [team('T'), team('U', [], 100, { acquisitionsSeason: 10 })],
        claims: [claim('t1', 'T', 'P', 5, 1), claim('t2', 'T', 'Q', 9, 2), claim('u1', 'U', 'Z', 1, 1)],
      }),
    )
    expect(summary(r)).toEqual(['1 u1 invalid:cap_reached $0', '2 t2 won $9', '3 t1 invalid:cap_reached $0'])
    const t = r.teams.find((x) => x.teamId === 'T')
    expect([t?.acquisitionsWeekAfter, t?.acquisitionsSeasonAfter]).toEqual([1, 1])
  })

  it('a team with two claims on the same player (different drops) wins him through its BIGGEST bid on him', () => {
    const base = {
      settings: { rosterSize: 2 },
      teams: [team('T', ['D1', 'D2']), team('U')],
    }
    // U bids $20: T's $30 claim wins (unchanged).
    const high = resolveWaiverRun(
      input({
        ...base,
        claims: [claim('t1', 'T', 'P', 10, 1, 'D1'), claim('t2', 'T', 'P', 30, 2, 'D2'), claim('u1', 'U', 'P', 20, 1)],
      }),
    )
    expect(summary(high)).toEqual(['1 t2 won $30', '2 u1 lost:outbid $0', '3 t1 invalid:own_claim_won $0'])
    expect(high.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['D1', 'P'])
    // FLIPPED by F422(b): U bids $5. L.D2.8 took T's #1 ($10, drop D1) because
    // it already beat U; now the $30 claim is T's top choice for P — it wins
    // at $30, dropping D2.
    const low = resolveWaiverRun(
      input({
        ...base,
        claims: [claim('t1', 'T', 'P', 10, 1, 'D1'), claim('t2', 'T', 'P', 30, 2, 'D2'), claim('u1', 'U', 'P', 5, 1)],
      }),
    )
    expect(summary(low)).toEqual(['1 t2 won $30', '2 t1 invalid:own_claim_won $0', '3 u1 lost:outbid $0'])
    expect(low.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['D1', 'P'])
  })

  it('FLIPPED by F422(b) — the old "cycle" is an ordinary run: each team\'s $50 is its top choice; the better priority goes first', () => {
    // L.D2.8 needed a deadlock break here ('1 b2 won $50 BREAK', …): each
    // team RANKED its $10 above its $50. Under F422(b) the $50 bids are the
    // top choices, so there is nothing to break — the same four decisions,
    // no `deadlockBreak` field any more, and the order rolls (F422(a)).
    const r = resolveWaiverRun(
      input({
        teams: [team('A', [], 50), team('B', [], 50)],
        claims: [
          claim('a1', 'A', 'X', 10, 1),
          claim('a2', 'A', 'Y', 50, 2),
          claim('b1', 'B', 'Y', 10, 1),
          claim('b2', 'B', 'X', 50, 2),
        ],
      }),
    )
    // Priority before standings = reverse draft order: draft [A, B] ⇒ [B, A].
    expect(r.priority.before).toEqual(['B', 'A'])
    expect(summary(r)).toEqual([
      '1 b2 won $50',
      '2 a1 lost:outbid $0',
      '3 b1 invalid:insufficient_faab $0',
      '4 a2 won $50',
    ])
    expect(faabAfter(r)).toEqual({ A: 0, B: 0 })
    // THE BYTE FORM the parity test compares — pinned as a stored literal.
    expect(serializeWaiverRunResult(r)).toBe(
      '{"outcomes":[' +
        '{"decision":1,"claimId":"b2","teamId":"B","addPlayerId":"X","dropPlayerId":null,"status":"won","reason":null,"faabSpent":50},' +
        '{"decision":2,"claimId":"a1","teamId":"A","addPlayerId":"X","dropPlayerId":null,"status":"lost","reason":"outbid","faabSpent":0},' +
        '{"decision":3,"claimId":"b1","teamId":"B","addPlayerId":"Y","dropPlayerId":null,"status":"invalid","reason":"insufficient_faab","faabSpent":0},' +
        '{"decision":4,"claimId":"a2","teamId":"A","addPlayerId":"Y","dropPlayerId":null,"status":"won","reason":null,"faabSpent":50}],' +
        '"teams":[' +
        '{"teamId":"A","faabBefore":50,"faabAfter":0,"rosterAfter":["Y"],"acquisitionsWeekAfter":1,"acquisitionsSeasonAfter":1},' +
        '{"teamId":"B","faabBefore":50,"faabAfter":0,"rosterAfter":["X"],"acquisitionsWeekAfter":1,"acquisitionsSeasonAfter":1}],' +
        '"priority":{"source":"reverse_draft_order","persists":false,"before":["B","A"],"after":["B","A"]}}',
    )
  })

  it("FLIPPED by F422(b) — L.D2.8's R1178 case: T's $60 is decided first, then R's $50, then T's $20 (no deadlock break)", () => {
    // T holds D. T: #1 Y $10 drop D, #2 X $20 drop D, #3 W $60. R ($52):
    // #1 X $5, #2 Y $50. Weekly cap 2. L.D2.8: '1 t2 won $20 BREAK',
    // '2 r1 lost:outbid', '3 t1 invalid:drop_gone', '4 t3 won $60', '5 r2 won $50'.
    // Now T's ranking is W ($60), X ($20), Y ($10): W first; R's $50 takes Y
    // (T's $10 on it is outbid) and leaves R $2, so R's $5 on X fails; T's $20
    // then takes X with drop D.
    const r = resolveWaiverRun(
      input({
        settings: { acquisitionsPerWeek: 2 },
        teams: [team('T', ['D']), team('R', [], 52)],
        claims: [
          claim('t1', 'T', 'Y', 10, 1, 'D'),
          claim('t2', 'T', 'X', 20, 2, 'D'),
          claim('t3', 'T', 'W', 60, 3),
          claim('r1', 'R', 'X', 5, 1),
          claim('r2', 'R', 'Y', 50, 2),
        ],
      }),
    )
    expect(summary(r)).toEqual([
      '1 t3 won $60',
      '2 r2 won $50',
      '3 t1 lost:outbid $0',
      '4 r1 invalid:insufficient_faab $0',
      '5 t2 won $20',
    ])
    expect(faabAfter(r)).toEqual({ R: 2, T: 20 })
    expect(r.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['W', 'X'])
  })
})

describe('E7 / Q72 / F422(a) — equal bids go to waiver priority, and every win burns it', () => {
  const tie = [claim('a1', 'A', 'P', 12, 1), claim('b1', 'B', 'P', 12, 1)]

  it('reverse standings: the worse team wins the tie, and flipping the standings flips the winner', () => {
    const aBest = resolveWaiverRun(input({ teams: [team('A'), team('B')], claims: tie, standings: ['A', 'B'] }))
    expect(summary(aBest)).toEqual(['1 b1 won $12', '2 a1 lost:lost_on_priority $0'])
    // F422(a): B's win sends it behind A for the rest of the run; the order
    // does not persist (the next run starts from the standings again).
    expect(aBest.priority).toEqual({ source: 'reverse_standings', persists: false, before: ['B', 'A'], after: ['A', 'B'] })
    const bBest = resolveWaiverRun(input({ teams: [team('A'), team('B')], claims: tie, standings: ['B', 'A'] }))
    expect(summary(bBest)).toEqual(['1 a1 won $12', '2 b1 lost:lost_on_priority $0'])
  })

  it('Q72: before week 1 is final (no standings), reverse draft order decides — the last pick of round 1 goes first', () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('A'), team('B'), team('C')],
        claims: [claim('a1', 'A', 'P', 12, 1), claim('c1', 'C', 'P', 12, 1)],
        draftOrder: ['A', 'B', 'C'],
        standings: null,
      }),
    )
    expect(r.priority.source).toBe('reverse_draft_order')
    expect(r.priority.before).toEqual(['C', 'B', 'A'])
    expect(summary(r)).toEqual(['1 c1 won $12', '2 a1 lost:lost_on_priority $0'])
  })

  it('FAAB with the rolling tiebreaker: a winner goes to the back at once, so a second tie in the same run goes the other way (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { faabTiebreaker: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'P', 10, 1), claim('a2', 'A', 'Q', 10, 2), claim('b1', 'B', 'Q', 10, 1)],
        rolling: { A: 1, B: 2 },
      }),
    )
    expect(summary(r)).toEqual(['1 a1 won $10', '2 b1 won $10', '3 a2 lost:lost_on_priority $0'])
    expect(r.priority).toEqual({ source: 'rolling', persists: true, before: ['A', 'B'], after: ['A', 'B'] })
  })

  it("FLIPPED by F422(a)+(b) — L.D2.8's R1176 case: A's $30 is its top choice; winning it burns A's priority, so B takes the $10 tie", () => {
    // A holds priority 1. A: #1 P $10 (tied with B), #2 Q $30 (uncontested).
    // L.D2.8 (R1176's per-claim key): '1 a2 won $30', '2 a1 won $10',
    // '3 b1 lost:lost_on_priority' — A kept priority 1 for its #1. Chris
    // (F422(a)): "you burn your order priority with each pick"; (b): the $30
    // is A's top choice. So Q first, A to the back, B wins P on priority.
    const r = resolveWaiverRun(
      input({
        settings: { faabTiebreaker: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'P', 10, 1), claim('a2', 'A', 'Q', 30, 2), claim('b1', 'B', 'P', 10, 1)],
        rolling: { A: 1, B: 2 },
      }),
    )
    expect(summary(r)).toEqual(['1 a2 won $30', '2 b1 won $10', '3 a1 lost:lost_on_priority $0'])
    expect(faabAfter(r)).toEqual({ A: 70, B: 90 })
    expect(r.priority).toEqual({ source: 'rolling', persists: true, before: ['A', 'B'], after: ['A', 'B'] })
  })

  it('F422(c) is moot — L.D2.8\'s bid-size case: whatever the Z bids, A wins exactly one tie (its bigger-bid claim), never both', () => {
    // Rolling tiebreak, priority A=1, B=2, C=3. A bids X $5 (tied with B)
    // and Z (tied with C). L.D2.8 (per-claim key): with Z at $6 A won BOTH
    // ties. Now A's top choice is its bigger bid, and the win burns A's
    // priority: A gets that player, the other tie goes to its rival.
    const run = (z: number) =>
      resolveWaiverRun(
        input({
          settings: { faabTiebreaker: 'rolling_priority' },
          teams: [team('A'), team('B'), team('C')],
          claims: [
            claim('a1', 'A', 'X', 5, 1),
            claim('a2', 'A', 'Z', z, 2),
            claim('b1', 'B', 'X', 5, 1),
            claim('c1', 'C', 'Z', z, 1),
          ],
          rolling: { A: 1, B: 2, C: 3 },
        }),
      )
    const six = run(6)
    expect(summary(six)).toEqual(['1 a2 won $6', '2 c1 lost:lost_on_priority $0', '3 b1 won $5', '4 a1 lost:lost_on_priority $0'])
    expect(six.priority.after).toEqual(['C', 'A', 'B'])
    const four = run(4)
    expect(summary(four)).toEqual(['1 a1 won $5', '2 b1 lost:lost_on_priority $0', '3 c1 won $4', '4 a2 lost:lost_on_priority $0'])
    expect(four.priority.after).toEqual(['B', 'A', 'C'])
  })

  it('…and the plain rolling-priority league gives A its #1 on priority, then its uncontested #2 (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { waiverType: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'P', 0, 1), claim('a2', 'A', 'Q', 0, 2), claim('b1', 'B', 'P', 0, 1)],
        rolling: { A: 1, B: 2 },
      }),
    )
    expect(summary(r)).toEqual(['1 a1 won $0', '2 b1 lost:lost_on_priority $0', '3 a2 won $0'])
    expect(r.priority.after).toEqual(['B', 'A'])
  })

  it('rolling starts from reverse draft order when nothing is stored yet (Q72) — even once standings exist', () => {
    const r = resolveWaiverRun(
      input({
        settings: { faabTiebreaker: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [],
        draftOrder: ['A', 'B'],
        standings: ['B', 'A'],
        rolling: null,
      }),
    )
    expect(r.priority).toEqual({ source: 'reverse_draft_order', persists: true, before: ['B', 'A'], after: ['B', 'A'] })
    expect(r.outcomes).toEqual([])
  })
})

describe('priority waiver types — no money, lowest priority number wins, every win burns it', () => {
  it('rolling_priority: the classic order — each winner goes to the back, non-winners keep their order (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { waiverType: 'rolling_priority' },
        teams: [team('A'), team('B'), team('C')],
        claims: [
          claim('a1', 'A', 'P', 0, 1),
          claim('b1', 'B', 'P', 0, 1),
          claim('b2', 'B', 'Q', 0, 2),
          claim('c1', 'C', 'Q', 0, 1),
        ],
        draftOrder: ['A', 'B', 'C'],
      }),
    )
    expect(summary(r)).toEqual([
      '1 c1 won $0',
      '2 b2 lost:lost_on_priority $0',
      '3 b1 won $0',
      '4 a1 lost:lost_on_priority $0',
    ])
    expect(r.priority).toEqual({ source: 'reverse_draft_order', persists: true, before: ['C', 'B', 'A'], after: ['A', 'C', 'B'] })
  })

  it('FLIPPED by F422(a) — reverse_standings: a win burns the team\'s priority for the rest of the run; the next run resets to the standings', () => {
    // L.D2.8 (the order is the standings for the whole run): '1 c1 won',
    // '2 b1 lost', '3 c2 won', '4 b2 lost' — last-place C took both. Now C's
    // win on P sends it to the back, so B's #2 beats C's #2 on Q.
    const r = resolveWaiverRun(
      input({
        settings: { waiverType: 'reverse_standings' },
        teams: [team('A'), team('B'), team('C')],
        claims: [
          claim('b1', 'B', 'P', 0, 1),
          claim('b2', 'B', 'Q', 0, 2),
          claim('c1', 'C', 'P', 0, 1),
          claim('c2', 'C', 'Q', 0, 2),
        ],
        standings: ['A', 'B', 'C'],
      }),
    )
    expect(summary(r)).toEqual([
      '1 c1 won $0',
      '2 b1 lost:lost_on_priority $0',
      '3 b2 won $0',
      '4 c2 lost:lost_on_priority $0',
    ])
    expect(r.priority).toEqual({ source: 'reverse_standings', persists: false, before: ['C', 'B', 'A'], after: ['A', 'C', 'B'] })
  })

  it('a stray bid left on a claim in a priority league is ignored and never charged (unchanged)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { waiverType: 'rolling_priority' },
        teams: [team('A', [], 40)],
        claims: [claim('a1', 'A', 'P', 7, 1)],
      }),
    )
    expect(summary(r)).toEqual(['1 a1 won $0'])
    expect(faabAfter(r)).toEqual({ A: 40 })
  })

  it('a priority league settles a team\'s claims in its OWN order, whatever stray bids they carry (F422(b) is a FAAB rule)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { waiverType: 'rolling_priority', rosterSize: 1 },
        teams: [team('A')],
        claims: [claim('a1', 'A', 'P', 1, 1), claim('a2', 'A', 'Q', 90, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 a1 won $0', '2 a2 invalid:roster_full $0'])
  })
})

describe('Q73 / Q74 — the game-day lock at the run', () => {
  it('Q73: a claim whose drop player has kicked off fails drop_locked with no FAAB spent; the next bid wins', () => {
    const r = resolveWaiverRun(
      input({
        settings: { rosterSize: 1 },
        teams: [team('T', ['D']), team('U')],
        claims: [claim('t1', 'T', 'P', 30, 1, 'D'), claim('u1', 'U', 'P', 20, 1)],
        locked: ['D'],
      }),
    )
    expect(summary(r)).toEqual(['1 t1 invalid:drop_locked $0', '2 u1 won $20'])
    expect(faabAfter(r)).toEqual({ T: 100, U: 80 })
    expect(r.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['D'])
  })

  it('Q74: a claim on a player whose game has started fails add_locked — nobody gets him, nobody pays', () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('T'), team('U')],
        claims: [claim('t1', 'T', 'P', 30, 1), claim('u1', 'U', 'P', 20, 1)],
        locked: ['P'],
      }),
    )
    expect(summary(r)).toEqual(['1 t1 invalid:add_locked $0', '2 u1 invalid:add_locked $0'])
    expect(faabAfter(r)).toEqual({ T: 100, U: 100 })
  })
})

describe('the other failure reasons', () => {
  it('add_rostered: the player went to a roster since the claim was made', () => {
    const r = resolveWaiverRun(
      input({ teams: [team('T'), team('V', ['P'])], claims: [claim('t1', 'T', 'P', 5, 1)] }),
    )
    expect(summary(r)).toEqual(['1 t1 invalid:add_rostered $0'])
  })

  it("drop_gone: the drop player left the team since the claim was made", () => {
    const r = resolveWaiverRun(
      input({ teams: [team('T'), team('V', ['D'])], claims: [claim('t1', 'T', 'P', 5, 1, 'D')] }),
    )
    expect(summary(r)).toEqual(['1 t1 invalid:drop_gone $0'])
  })

  it('insufficient_faab: a bid above the balance at the run (the balance fell since the claim)', () => {
    const r = resolveWaiverRun(input({ teams: [team('T', [], 4)], claims: [claim('t1', 'T', 'P', 5, 1)] }))
    expect(summary(r)).toEqual(['1 t1 invalid:insufficient_faab $0'])
  })

  it('team_retired: a sealed franchise wins nothing and holds no priority (F408); the next bid wins', () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('R', [], 100, { retired: true }), team('U')],
        claims: [claim('r1', 'R', 'P', 90, 1), claim('u1', 'U', 'P', 1, 1)],
        draftOrder: ['U'],
      }),
    )
    expect(summary(r)).toEqual(['1 r1 invalid:team_retired $0', '2 u1 won $1'])
    expect(r.priority.before).toEqual(['U'])
  })

  it('R1177 — FAIL_CHECK_ORDER is pinned as a stored literal (parity-relevant: the SQL twin tests in this order)', () => {
    expect(FAIL_CHECK_ORDER).toEqual([
      'team_retired',
      'add_rostered',
      'add_locked',
      'drop_gone',
      'drop_locked',
      'roster_full',
      'cap_reached',
      'insufficient_faab',
    ])
  })

  it('R1177 — adjacent pairs in FAIL_CHECK_ORDER: a claim failing both names the earlier one', () => {
    // drop_gone before drop_locked: the drop left the team AND is locked.
    const gone = resolveWaiverRun(
      input({ teams: [team('T'), team('V', ['D'])], claims: [claim('t1', 'T', 'P', 5, 1, 'D')], locked: ['D'] }),
    )
    expect(summary(gone)).toEqual(['1 t1 invalid:drop_gone $0'])
    // roster_full before cap_reached before insufficient_faab: full, capped, broke.
    const full = resolveWaiverRun(
      input({
        settings: { rosterSize: 1, acquisitionsPerWeek: 0 },
        teams: [team('T', ['R1'], 4)],
        claims: [claim('t1', 'T', 'P', 5, 1)],
      }),
    )
    expect(summary(full)).toEqual(['1 t1 invalid:roster_full $0'])
    const capped = resolveWaiverRun(
      input({ settings: { acquisitionsPerWeek: 0 }, teams: [team('T', [], 4)], claims: [claim('t1', 'T', 'P', 5, 1)] }),
    )
    expect(summary(capped)).toEqual(['1 t1 invalid:cap_reached $0'])
  })

  it('the reasons are checked in FAIL_CHECK_ORDER — the first failing check names it', () => {
    // Locked add AND a gone drop AND over budget: add_locked comes first.
    const r = resolveWaiverRun(
      input({ teams: [team('T', [], 0)], claims: [claim('t1', 'T', 'P', 5, 1, 'D')], locked: ['P'] }),
    )
    expect(summary(r)).toEqual(['1 t1 invalid:add_locked $0'])
  })
})

describe('input guards — loud, never a guess', () => {
  it('refuses a player on two rosters', () => {
    expect(() =>
      resolveWaiverRun(input({ teams: [team('A', ['P']), team('B', ['P'])], claims: [] })),
    ).toThrow(WaiverRunInputError)
  })
  it('refuses a priority list that is not exactly the active teams', () => {
    expect(() => resolveWaiverRun(input({ teams: [team('A'), team('B')], claims: [], draftOrder: ['A'] }))).toThrow(
      /missing active team\(s\) B/,
    )
    expect(() =>
      resolveWaiverRun(input({ teams: [team('A'), team('B')], claims: [], standings: ['A', 'B', 'Z'] })),
    ).toThrow(/Z, which is not an active/)
  })
  it('refuses a FAAB claim from a team with no balance on record', () => {
    expect(() => resolveWaiverRun(input({ teams: [team('A', [], null)], claims: [claim('a1', 'A', 'P', 0, 1)] }))).toThrow(
      /no FAAB balance on record/,
    )
  })
  it('refuses duplicate claim ids, negative bids and the none_fcfs type', () => {
    expect(() =>
      resolveWaiverRun(input({ teams: [team('A')], claims: [claim('c', 'A', 'P', 1, 1), claim('c', 'A', 'Q', 1, 2)] })),
    ).toThrow(/listed twice/)
    expect(() => resolveWaiverRun(input({ teams: [team('A')], claims: [claim('c', 'A', 'P', -1, 1)] }))).toThrow(/bid -1/)
    expect(() =>
      resolveWaiverRun(
        input({ teams: [team('A')], claims: [], settings: { waiverType: 'none_fcfs' as unknown as 'faab' } }),
      ),
    ).toThrow(/none_fcfs/)
  })
})
