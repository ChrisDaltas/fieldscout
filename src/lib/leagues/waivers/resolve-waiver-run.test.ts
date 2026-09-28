/**
 * resolve-waiver-run.test.ts — L.D2.8's WORKED EXAMPLES: one case per ruling
 * (Q71, Q72, Q73, Q74), per tiebreaker (E7), per priority type, per failure
 * reason, the cycle the deadlock break exists for, and the input guards.
 * Every expectation is a STORED LITERAL (tasks-M* §4.3 falsifiability floor):
 * the decision sequence, reasons, amounts and balances written out by hand.
 * The invariants over random claim sets live in
 * `resolve-waiver-run-property.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  FAIL_CHECK_ORDER,
  resolveWaiverRun,
  serializeWaiverRunResult,
  WaiverRunInputError,
} from './resolve-waiver-run'
import { claim, faabAfter, input, summary, team } from './waiver-run-fixture'

describe('Q71 — the highest bid on a player always wins him', () => {
  it("Chris's example: B's #2 ($50) beats A's only claim ($5) on X, and B also gets its #1", () => {
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

  it("the team's own ranking settles running out of budget: B can't afford both, keeps its #1, and X goes to the next-highest bid", () => {
    const r = resolveWaiverRun(
      input({
        teams: [team('A'), team('B', [], 60)],
        claims: [claim('a1', 'A', 'X', 40, 1), claim('b1', 'B', 'Y', 30, 1), claim('b2', 'B', 'X', 50, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 b1 won $30', '2 b2 invalid:insufficient_faab $0', '3 a1 won $40'])
    expect(faabAfter(r)).toEqual({ A: 60, B: 30 })
  })

  it('money is held back for a higher-ranked claim only while it can still win: once B loses Y, its $50 on X wins', () => {
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
    expect(summary(r)).toEqual(['1 d1 won $45', '2 b1 lost:outbid $0', '3 b2 won $50', '4 a1 lost:outbid $0'])
    expect(faabAfter(r)).toEqual({ A: 100, B: 5, D: 55 })
  })

  it('two claims dropping the same player: the higher-ranked wins, the other fails drop_gone', () => {
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

  it('…and when the #1 is outbid, the #2 goes through with the shared drop', () => {
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

  it('roster room settles running out in ranking order — the bigger bid ranked #2 fails roster_full', () => {
    const r = resolveWaiverRun(
      input({
        settings: { rosterSize: 2 },
        teams: [team('T', ['R1'])],
        claims: [claim('t1', 'T', 'P', 5, 1), claim('t2', 'T', 'Q', 9, 2)],
      }),
    )
    expect(summary(r)).toEqual(['1 t1 won $5', '2 t2 invalid:roster_full $0'])
  })

  it('acquisition caps settle running out the same way (and a team already at its cap wins nothing)', () => {
    const r = resolveWaiverRun(
      input({
        settings: { acquisitionsPerWeek: 1, acquisitionsPerSeason: 10 },
        teams: [team('T'), team('U', [], 100, { acquisitionsSeason: 10 })],
        claims: [claim('t1', 'T', 'P', 5, 1), claim('t2', 'T', 'Q', 9, 2), claim('u1', 'U', 'Z', 1, 1)],
      }),
    )
    expect(summary(r)).toEqual(['1 u1 invalid:cap_reached $0', '2 t1 won $5', '3 t2 invalid:cap_reached $0'])
    const t = r.teams.find((x) => x.teamId === 'T')
    expect([t?.acquisitionsWeekAfter, t?.acquisitionsSeasonAfter]).toEqual([1, 1])
  })

  it('a team with two claims on the same player (different drops) wins him through its highest-ranked claim that beats the rival', () => {
    const base = {
      settings: { rosterSize: 2 },
      teams: [team('T', ['D1', 'D2']), team('U')],
    }
    // U bids $20: T's #1 ($10) cannot beat it, T's #2 ($30) can.
    const high = resolveWaiverRun(
      input({
        ...base,
        claims: [claim('t1', 'T', 'P', 10, 1, 'D1'), claim('t2', 'T', 'P', 30, 2, 'D2'), claim('u1', 'U', 'P', 20, 1)],
      }),
    )
    expect(summary(high)).toEqual(['1 t2 won $30', '2 u1 lost:outbid $0', '3 t1 invalid:own_claim_won $0'])
    expect(high.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['D1', 'P'])
    // U bids $5: T's #1 already beats it — T's own ranking picks #1 (drop D1, $10).
    const low = resolveWaiverRun(
      input({
        ...base,
        claims: [claim('t1', 'T', 'P', 10, 1, 'D1'), claim('t2', 'T', 'P', 30, 2, 'D2'), claim('u1', 'U', 'P', 5, 1)],
      }),
    )
    expect(summary(low)).toEqual(['1 t1 won $10', '2 t2 invalid:own_claim_won $0', '3 u1 lost:outbid $0'])
    expect(low.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['D2', 'P'])
  })

  it('the cycle: each team outbids the other on its #2 and cannot afford both — both high bids win (deadlock break)', () => {
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
      '1 b2 won $50 BREAK',
      '2 a1 lost:outbid $0',
      '3 b1 invalid:insufficient_faab $0',
      '4 a2 won $50',
    ])
    expect(faabAfter(r)).toEqual({ A: 0, B: 0 })
    // THE BYTE FORM L.D2.9's parity test compares — pinned as a stored literal.
    expect(serializeWaiverRunResult(r)).toBe(
      '{"outcomes":[' +
        '{"decision":1,"claimId":"b2","teamId":"B","addPlayerId":"X","dropPlayerId":null,"status":"won","reason":null,"faabSpent":50,"deadlockBreak":true},' +
        '{"decision":2,"claimId":"a1","teamId":"A","addPlayerId":"X","dropPlayerId":null,"status":"lost","reason":"outbid","faabSpent":0,"deadlockBreak":false},' +
        '{"decision":3,"claimId":"b1","teamId":"B","addPlayerId":"Y","dropPlayerId":null,"status":"invalid","reason":"insufficient_faab","faabSpent":0,"deadlockBreak":false},' +
        '{"decision":4,"claimId":"a2","teamId":"A","addPlayerId":"Y","dropPlayerId":null,"status":"won","reason":null,"faabSpent":50,"deadlockBreak":false}],' +
        '"teams":[' +
        '{"teamId":"A","faabBefore":50,"faabAfter":0,"rosterAfter":["Y"],"acquisitionsWeekAfter":1,"acquisitionsSeasonAfter":1},' +
        '{"teamId":"B","faabBefore":50,"faabAfter":0,"rosterAfter":["X"],"acquisitionsWeekAfter":1,"acquisitionsSeasonAfter":1}],' +
        '"priority":{"source":"reverse_draft_order","rotates":false,"before":["B","A"],"after":["B","A"]}}',
    )
  })

  it("R1178 — the deadlock break awards the LEADING team's HIGHEST-RANKED top claim, not the strongest top itself", () => {
    // T holds D. T: #1 Y $10 drop D, #2 X $20 drop D, #3 W $60. R ($52):
    // #1 X $5, #2 Y $50. Weekly cap 2. Tops: W → t3 ($60), Y → r2 ($50),
    // X → t2 ($20); none is ready (t3: T's two higher claims + t3 exceed the
    // cap; r2: $52 − $5 held for r1 < $50; t2: shares its drop with t1). The
    // strongest top is t3 (team T), and T's highest-ranked TOP is t2 — the
    // break awards t2, not t3 (D389(4)).
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
      '1 t2 won $20 BREAK',
      '2 r1 lost:outbid $0',
      '3 t1 invalid:drop_gone $0',
      '4 t3 won $60',
      '5 r2 won $50',
    ])
    expect(faabAfter(r)).toEqual({ R: 2, T: 20 })
    expect(r.teams.find((t) => t.teamId === 'T')?.rosterAfter).toEqual(['W', 'X'])
  })
})

describe('E7 / Q72 — equal bids go to waiver priority', () => {
  const tie = [claim('a1', 'A', 'P', 12, 1), claim('b1', 'B', 'P', 12, 1)]

  it('reverse standings: the worse team wins the tie, and flipping the standings flips the winner', () => {
    const aBest = resolveWaiverRun(input({ teams: [team('A'), team('B')], claims: tie, standings: ['A', 'B'] }))
    expect(summary(aBest)).toEqual(['1 b1 won $12', '2 a1 lost:lost_on_priority $0'])
    expect(aBest.priority).toEqual({ source: 'reverse_standings', rotates: false, before: ['B', 'A'], after: ['B', 'A'] })
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

  it('FAAB with the rolling tiebreaker: a winner goes to the back at once, so a second tie in the same run goes the other way', () => {
    const r = resolveWaiverRun(
      input({
        settings: { faabTiebreaker: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'P', 10, 1), claim('a2', 'A', 'Q', 10, 2), claim('b1', 'B', 'Q', 10, 1)],
        rolling: { A: 1, B: 2 },
      }),
    )
    expect(summary(r)).toEqual(['1 a1 won $10', '2 b1 won $10', '3 a2 lost:lost_on_priority $0'])
    expect(r.priority).toEqual({ source: 'rolling', rotates: true, before: ['A', 'B'], after: ['A', 'B'] })
  })

  it("R1176 / Q71 — a team's lower-ranked win never costs it a higher-ranked claim on the tiebreak: A gets P on priority AND Q", () => {
    // A holds priority 1. A: #1 P $10 (tied with B), #2 Q $30 (uncontested).
    // Q's $30 is the bigger bid, so it is decided first — but A's win on its
    // #2 does not send it behind B for its #1 (Q71: "its higher-ranked claim
    // goes first"): P is judged with A still at priority 1.
    const r = resolveWaiverRun(
      input({
        settings: { faabTiebreaker: 'rolling_priority' },
        teams: [team('A'), team('B')],
        claims: [claim('a1', 'A', 'P', 10, 1), claim('a2', 'A', 'Q', 30, 2), claim('b1', 'B', 'P', 10, 1)],
        rolling: { A: 1, B: 2 },
      }),
    )
    expect(summary(r)).toEqual(['1 a2 won $30', '2 a1 won $10', '3 b1 lost:lost_on_priority $0'])
    expect(faabAfter(r)).toEqual({ A: 60, B: 100 })
    // The next run's order: A won (twice), so it is behind B.
    expect(r.priority).toEqual({ source: 'rolling', rotates: true, before: ['A', 'B'], after: ['B', 'A'] })
  })

  it('…and the plain rolling-priority league already gives A both, in its own order (unchanged)', () => {
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
    expect(r.priority).toEqual({ source: 'reverse_draft_order', rotates: true, before: ['B', 'A'], after: ['B', 'A'] })
    expect(r.outcomes).toEqual([])
  })
})

describe('priority waiver types — no money, lowest priority number wins', () => {
  it('rolling_priority: the classic order — each winner goes to the back, non-winners keep their order', () => {
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
    expect(r.priority).toEqual({ source: 'reverse_draft_order', rotates: true, before: ['C', 'B', 'A'], after: ['A', 'C', 'B'] })
  })

  it('reverse_standings: the order is the standings, and a win does not move a team (§13.2 "order resets by reverse standings")', () => {
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
      '3 c2 won $0',
      '4 b2 lost:lost_on_priority $0',
    ])
    expect(r.priority).toEqual({ source: 'reverse_standings', rotates: false, before: ['C', 'B', 'A'], after: ['C', 'B', 'A'] })
  })

  it('a stray bid left on a claim in a priority league is ignored and never charged', () => {
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
