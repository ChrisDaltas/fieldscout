import { describe, expect, it } from 'vitest'

import type { StartingSlot } from '@/lib/leagues/settings/league-settings'

import type { TeamBudget } from './auction-budget'
import {
  antiSnipeView,
  auctionPhase,
  bidAmountAcceptable,
  buildAuctionColumns,
  buildBidBox,
  nominationBidHistory,
  nominationKeyOf,
  UNCONTESTED_BEAT_MS,
  readUncontestedNomination,
  uncontestedBeatMessage,
  uncontestedBeatRemainingMs,
  uncontestedBeatVisible,
  uncontestedBeatSentence,
} from './auction-block-ops'

/**
 * auction-block-ops pins — M3 task L.C3.1 (spec §8.6.1 budgets + max bid on
 * every team, §8.6.7(b)/(c)/(d), §16.3 one-glance clarity, §16.4's v2.10
 * auction-room-layout callout, E5/E6/E25/E27; tasks-M3 D126/D128).
 *
 * Golden tables of STORED LITERALS, boundary instants, and the §16.4 callout
 * read back item by item — the falsifiability floor (tasks-M3 §4.3). The
 * budget NUMBERS these columns render are pinned separately, against pgTAP
 * 033's own stored literals, in `auction-budget.test.ts`; this suite pins
 * what the ROOM does with them.
 */

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'

function slot(key: string, eligible: string[], count: number): StartingSlot {
  return { key, label: key.toUpperCase(), eligible: eligible as StartingSlot['eligible'], count }
}
// The §7.3.2-shaped mini roster the tracker suite uses, so the two agree.
const SLOTS = [slot('qb', ['QB'], 1), slot('rb', ['RB'], 2), slot('flex', ['RB', 'WR', 'TE'], 1)]

function budget(remaining: number, openSlots: number, maxBid: number): TeamBudget {
  return { remaining, openSlots, maxBid, committed: 0 }
}

describe('phase is `current_nomination`’s NULLity, and nothing else (D126)', () => {
  it('null ⇒ nominating; the printed 065:121 shape ⇒ bidding', () => {
    expect(auctionPhase(null)).toBe('nominating')
    expect(
      auctionPhase({ player_id: 'p1', high_bid: 7, high_bidder_team_id: T2 }),
    ).toBe('bidding')
  })
})

describe('team columns — §16.4’s v2.10 callout, item by item', () => {
  const base = {
    nominationOrder: [T3, T1, T2],
    teams: [
      { id: T1, name: 'Alpha' },
      { id: T2, name: 'Bravo' },
      { id: T3, name: 'Charlie' },
    ],
    picks: [
      { pick_number: 1, team_id: T3, player_id: 'qb1', price: 40, is_undone: false },
      { pick_number: 2, team_id: T1, player_id: 'rb1', price: 12, is_undone: false },
      // An UNDONE row is invisible everywhere the money is (D131 refunds by
      // derivation) — pinned here as well as in the budget mirror.
      { pick_number: 3, team_id: T1, player_id: 'rb9', price: 99, is_undone: true },
    ],
    budgets: new Map([
      [T1, budget(188, 2, 187)],
      [T2, budget(200, 3, 198)],
      [T3, budget(160, 0, 0)],
    ]),
    positionById: new Map([
      ['qb1', 'QB'],
      ['rb1', 'RB'],
      ['rb9', 'RB'],
    ]),
    startingSlots: SLOTS,
    bench: 0,
    myTeamId: T1,
    nominatingTeamId: T2,
    nomination: { player_id: 'wr1', high_bid: 9, high_bidder_team_id: T1 },
  }

  it('orders columns by NOMINATION ORDER — not draft order, not team name', () => {
    expect(buildAuctionColumns(base).map((c) => c.name)).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  it('a team ABSENT from nomination_order still renders — sorted last, by name', () => {
    const columns = buildAuctionColumns({ ...base, nominationOrder: [T2] })
    expect(columns.map((c) => c.name)).toEqual(['Bravo', 'Alpha', 'Charlie'])
    // A column that vanishes is a team whose spend stops being visible.
    expect(columns).toHaveLength(3)
  })

  it('the THREE at-a-glance marks are independent and can co-occur', () => {
    const columns = buildAuctionColumns(base)
    const byName = new Map(columns.map((c) => [c.name, c]))
    expect(byName.get('Alpha')).toMatchObject({ isMe: true, isNominating: false, isLatestBid: true })
    expect(byName.get('Bravo')).toMatchObject({ isMe: false, isNominating: true, isLatestBid: false })
    expect(byName.get('Charlie')).toMatchObject({
      isMe: false,
      isNominating: false,
      isLatestBid: false,
    })
    // Co-occurrence: my team nominating AND holding the high bid.
    const mine = buildAuctionColumns({ ...base, nominatingTeamId: T1 }).find((c) => c.isMe)
    expect(mine).toMatchObject({ isMe: true, isNominating: true, isLatestBid: true })
  })

  it('no nomination ⇒ NOBODY carries the latest-bid mark', () => {
    const columns = buildAuctionColumns({ ...base, nomination: null })
    expect(columns.filter((c) => c.isLatestBid)).toEqual([])
  })

  it('drafted players carry PRICES, in pick order, undone rows excluded', () => {
    const alpha = buildAuctionColumns(base).find((c) => c.name === 'Alpha')!
    expect(alpha.picks).toEqual([{ pickNumber: 2, playerId: 'rb1', price: 12 }])
    const charlie = buildAuctionColumns(base).find((c) => c.name === 'Charlie')!
    expect(charlie.picks).toEqual([{ pickNumber: 1, playerId: 'qb1', price: 40 }])
  })

  it('needs are the UNFILLED starting seats, collapsed — bench is a count, not a position', () => {
    const columns = buildAuctionColumns(base)
    const byName = new Map(columns.map((c) => [c.name, c]))
    // Alpha bought one RB: QB open ×1, RB open ×1, FLEX open ×1.
    expect(byName.get('Alpha')!.needs).toEqual([
      { key: 'qb', label: 'QB', count: 1 },
      { key: 'rb', label: 'RB', count: 1 },
      { key: 'flex', label: 'FLEX', count: 1 },
    ])
    // Charlie bought the QB: QB is covered, RB is open ×2 (the collapse).
    expect(byName.get('Charlie')!.needs).toEqual([
      { key: 'rb', label: 'RB', count: 2 },
      { key: 'flex', label: 'FLEX', count: 1 },
    ])
  })

  it('open_slots ≤ 0 is the E27 complete roster (skipped, cannot bid); a null budget is NOT', () => {
    const columns = buildAuctionColumns(base)
    expect(columns.find((c) => c.name === 'Charlie')!.rosterComplete).toBe(true)
    expect(columns.find((c) => c.name === 'Alpha')!.rosterComplete).toBe(false)
    // Underivable capacity renders nothing and claims nothing (the
    // auction-budget.ts convention: null where the SQL would raise).
    const nulled = buildAuctionColumns({ ...base, budgets: new Map([[T1, null]]) })
    const alpha = nulled.find((c) => c.name === 'Alpha')!
    expect(alpha.budget).toBeNull()
    expect(alpha.rosterComplete).toBe(false)
  })
})

describe('the bid box — minimums, the max-bid cap, and one sentence per refusal', () => {
  const bidding = {
    phase: 'bidding' as const,
    status: 'live',
    myTeamId: T1,
    myBudget: budget(50, 3, 48),
    nomination: { player_id: 'p1', high_bid: 9, high_bidder_team_id: T2 },
    nominatingTeamId: T2,
    nominationFloor: 1 as const,
  }
  const nominating = {
    phase: 'nominating' as const,
    status: 'live',
    myTeamId: T1,
    myBudget: budget(50, 3, 48),
    nomination: null,
    nominatingTeamId: T1,
    nominationFloor: 1 as const,
  }

  it('bidding: the minimum is high_bid + 1; nominating: it is the §8.6.2 nomination floor', () => {
    expect(buildBidBox(bidding)).toMatchObject({ minAmount: 10, maxAmount: 48, canAct: true })
    expect(buildBidBox(nominating)).toMatchObject({ minAmount: 1, maxAmount: 48, canAct: true })
  })

  // 092/AP.1 — C38's substance re-pointed at the toggle (D198(3)), and the
  // ruling that made it two settings: *"you can't have a $0 minimum bid,
  // those are two different settings"* (Chris, 2026-08-20).
  it('$0 nominations ON: a $0 opening is the legal minimum, not a falsy nothing', () => {
    expect(buildBidBox({ ...nominating, nominationFloor: 0 }).minAmount).toBe(0)
    expect(bidAmountAcceptable(buildBidBox({ ...nominating, nominationFloor: 0 }), 0)).toBe(true)
  })

  it('D146: THE FLOOR AND THE INCREMENT ARE DIFFERENT RULES — the floor moves with the toggle, the raise minimum never does', () => {
    // Nominating: the floor is the toggle's number, one unit apart.
    expect(buildBidBox({ ...nominating, nominationFloor: 1 }).minAmount).toBe(1)
    expect(buildBidBox({ ...nominating, nominationFloor: 0 }).minAmount).toBe(0)
    // Bidding: high_bid + 1 at BOTH toggle states — including from a $0
    // standing bid, which is raised to $1 and never to $0 (§8.6.3).
    const overZero = {
      ...bidding,
      nomination: { player_id: 'p1', high_bid: 0, high_bidder_team_id: T2 },
    }
    expect(buildBidBox({ ...overZero, nominationFloor: 1 }).minAmount).toBe(1)
    expect(buildBidBox({ ...overZero, nominationFloor: 0 }).minAmount).toBe(1)
    expect(bidAmountAcceptable(buildBidBox({ ...overZero, nominationFloor: 0 }), 0)).toBe(false)
    expect(bidAmountAcceptable(buildBidBox({ ...overZero, nominationFloor: 0 }), 1)).toBe(true)
  })

  it('every blocker, in the order a user meets them — the whole enumeration', () => {
    expect(buildBidBox({ ...bidding, myTeamId: null }).blocker).toBe('no-seat')
    expect(buildBidBox({ ...bidding, status: 'paused' }).blocker).toBe('not-live')
    expect(buildBidBox({ ...bidding, myBudget: budget(9, 0, 0) }).blocker).toBe('roster-complete')
    // E25's self-raise arm: I already hold it.
    expect(
      buildBidBox({
        ...bidding,
        nomination: { player_id: 'p1', high_bid: 9, high_bidder_team_id: T1 },
      }).blocker,
    ).toBe('already-high')
    expect(buildBidBox({ ...nominating, nominatingTeamId: T2 }).blocker).toBe('not-nominator')
    // §8.6.7(d): max bid $9 cannot reach the $10 raise.
    expect(buildBidBox({ ...bidding, myBudget: budget(11, 3, 9) }).blocker).toBe('max-bid-reached')
    expect(buildBidBox(bidding).blocker).toBeNull()
  })

  it('seat beats liveness beats roster beats turn beats money — the order is the pin', () => {
    // A seatless viewer of a PAUSED, unaffordable draft is told the first
    // true reason, not the narrowest one.
    expect(
      buildBidBox({ ...bidding, myTeamId: null, status: 'paused', myBudget: budget(0, 0, 0) })
        .blocker,
    ).toBe('no-seat')
    expect(
      buildBidBox({ ...bidding, status: 'paused', myBudget: budget(0, 0, 0) }).blocker,
    ).toBe('not-live')
  })

  it('a null budget surfaces NO cap rather than an invented one — and never blocks on money', () => {
    const box = buildBidBox({ ...bidding, myBudget: null })
    expect(box.maxAmount).toBeNull()
    expect(box.canAct).toBe(true)
    // The server still refuses if it must; the UI simply stops claiming.
    expect(bidAmountAcceptable(box, 9_999)).toBe(true)
  })

  it('acceptability boundaries: min−1 / min / max / max+1 / non-integer (E5 prevented at the UI)', () => {
    const box = buildBidBox(bidding) // min 10, max 48
    expect(bidAmountAcceptable(box, 9)).toBe(false)
    expect(bidAmountAcceptable(box, 10)).toBe(true)
    expect(bidAmountAcceptable(box, 48)).toBe(true)
    expect(bidAmountAcceptable(box, 49)).toBe(false)
    expect(bidAmountAcceptable(box, 10.5)).toBe(false)
    expect(bidAmountAcceptable(box, Number.NaN)).toBe(false)
    // A blocked box accepts nothing, however legal the number looks.
    expect(bidAmountAcceptable(buildBidBox({ ...bidding, myTeamId: null }), 10)).toBe(false)
  })
})

describe('anti-snipe — the floor, and its visible re-arm (E6 / D128)', () => {
  const NOW = Date.parse('2026-08-19T12:00:00.000Z')
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  const base = {
    phase: 'bidding' as const,
    status: 'live',
    antiSnipeSeconds: 10,
    currentDeadline: at(30_000),
    previousDeadline: at(30_000),
    nominationKey: '4:pl-live',
    previousNominationKey: '4:pl-live',
    nowMs: NOW,
    offsetMs: 0,
  }

  it('inactive while NOMINATING, while PAUSED, and when the floor is 0 (D128: a pure fixed window)', () => {
    expect(antiSnipeView({ ...base, phase: 'nominating' }).active).toBe(false)
    expect(antiSnipeView({ ...base, status: 'paused' }).active).toBe(false)
    expect(antiSnipeView({ ...base, antiSnipeSeconds: 0 }).active).toBe(false)
    expect(antiSnipeView(base).active).toBe(true)
  })

  it('the window boundary is EXACT: 10.001s out, 10.000s in, 0.001s in, expired out', () => {
    expect(antiSnipeView({ ...base, currentDeadline: at(10_001) }).inWindow).toBe(false)
    expect(antiSnipeView({ ...base, currentDeadline: at(10_000) }).inWindow).toBe(true)
    expect(antiSnipeView({ ...base, currentDeadline: at(1) }).inWindow).toBe(true)
    // At/past the deadline there is nothing left to extend.
    expect(antiSnipeView({ ...base, currentDeadline: at(0) }).inWindow).toBe(false)
    expect(antiSnipeView({ ...base, currentDeadline: at(-500) }).inWindow).toBe(false)
  })

  it('the heartbeat offset moves the window with the SERVER clock, not the client’s', () => {
    // Client 25s early: a deadline 35s out is really 10s out.
    expect(
      antiSnipeView({ ...base, currentDeadline: at(35_000), offsetMs: 25_000 }).inWindow,
    ).toBe(true)
  })

  it('a deadline that moves LATER is the re-arm; equal or earlier is not (E6: 3s left → 10s)', () => {
    expect(
      antiSnipeView({
        ...base,
        previousDeadline: at(3_000),
        currentDeadline: at(10_000),
      }).reArmed,
    ).toBe(true)
    expect(antiSnipeView(base).reArmed).toBe(false)
    expect(
      antiSnipeView({ ...base, previousDeadline: at(30_000), currentDeadline: at(20_000) })
        .reArmed,
    ).toBe(false)
    // First paint holds no previous deadline and must not claim a re-arm.
    expect(antiSnipeView({ ...base, previousDeadline: null }).reArmed).toBe(false)
    // A re-arm on a PAUSED draft is not a re-arm (nothing is running).
    expect(
      antiSnipeView({
        ...base,
        status: 'paused',
        previousDeadline: at(3_000),
        currentDeadline: at(10_000),
      }).reArmed,
    ).toBe(false)
  })

  it('a deadline that moves later because the NOMINATION changed is not a re-arm (measured find)', () => {
    // The browser pass caught this: nominating → bidding replaces the
    // nomination clock's remainder with a fresh bid window, so the deadline
    // jumps forward with no bid involved. Scoping the comparison to one
    // nomination is what makes the indicator mean E6 and only E6.
    expect(
      antiSnipeView({
        ...base,
        previousNominationKey: null, // was NOMINATING
        previousDeadline: at(3_000),
        currentDeadline: at(60_000),
      }).reArmed,
    ).toBe(false)
    // The NEXT nomination, whose clock is also later than the last one's.
    expect(
      antiSnipeView({
        ...base,
        previousNominationKey: '4:pl-live',
        nominationKey: '5:pl-next',
        previousDeadline: at(3_000),
        currentDeadline: at(60_000),
      }).reArmed,
    ).toBe(false)
  })

  it('a RESUME-shaped movement is NOT a re-arm — same key, later deadline, wrong SIZE (R428)', () => {
    // `draft_pause` writes `current_deadline = NULL` + `deadline_remaining_ms`
    // (069:353-357) and `draft_resume` writes `now() + remaining`
    // (069:485-492) — strictly later than the pre-pause deadline, by the
    // pause duration, with the pick number and the nomination's player id
    // untouched. So "same nomination key + later deadline" describes a RESUME
    // exactly as well as it describes an 085 re-arm, and the only thing
    // separating them was `useAntiSnipe`'s ref having SEEN the null frame.
    // A client that misses that frame announced a 12-SECOND movement as
    // "clock reset to 10s". The reviewer's probe, at its numbers:
    expect(
      antiSnipeView({
        ...base,
        previousDeadline: at(18_000),
        currentDeadline: at(30_000),
      }).reArmed,
    ).toBe(false)
    // The general case: a resume restores whatever remained when the pause
    // landed, so any remaining above the floor + slack is not the floor.
    expect(
      antiSnipeView({
        ...base,
        previousDeadline: at(2_000),
        currentDeadline: at(11_501),
      }).reArmed,
    ).toBe(false)
  })

  it('a GENUINE 085 re-arm always passes the size test — it lands AT the floor (R428)', () => {
    // 085:780-791 is `GREATEST(current_deadline, now() + anti)`: when it moves
    // the deadline at all, the new remaining is exactly `anti`, never more.
    expect(
      antiSnipeView({ ...base, previousDeadline: at(3_000), currentDeadline: at(10_000) })
        .reArmed,
    ).toBe(true)
    // D128's after-zero case (085:773-777) — a full fresh window, same size.
    expect(
      antiSnipeView({ ...base, previousDeadline: at(-2_000), currentDeadline: at(10_000) })
        .reArmed,
    ).toBe(true)
    // Wire + render latency only ever REDUCES the remaining a client reads,
    // so lateness cannot false-negative the test.
    expect(
      antiSnipeView({
        ...base,
        previousDeadline: at(3_000),
        currentDeadline: at(10_000),
        nowMs: NOW + 400,
      }).reArmed,
    ).toBe(true)
    // The boundary is exact at floor + ANTI_SNIPE_REARM_SLACK_MS (10s + 1.5s).
    expect(
      antiSnipeView({ ...base, previousDeadline: at(3_000), currentDeadline: at(11_500) })
        .reArmed,
    ).toBe(true)
    expect(
      antiSnipeView({ ...base, previousDeadline: at(3_000), currentDeadline: at(11_501) })
        .reArmed,
    ).toBe(false)
  })

  it('nominationKeyOf is null while NOMINATING — a re-arm cannot be claimed off the phase change', () => {
    expect(nominationKeyOf(4, null)).toBeNull()
    expect(nominationKeyOf(null, { player_id: 'p', high_bid: 1, high_bidder_team_id: T1 })).toBeNull()
    expect(
      nominationKeyOf(4, { player_id: 'p', high_bid: 1, high_bidder_team_id: T1 }),
    ).toBe('4:p')
  })
})

describe('the raise ladder — scoped to the LIVE nomination', () => {
  const rows = [
    { nomination_seq: 4, team_id: T1, amount: 3, created_at: '2026-08-19T12:00:03.000Z' },
    { nomination_seq: 4, team_id: T2, amount: 5, created_at: '2026-08-19T12:00:05.000Z' },
    { nomination_seq: 3, team_id: T3, amount: 99, created_at: '2026-08-19T11:59:00.000Z' },
  ]

  it('other nominations’ rows never leak into the centrepiece; newest/highest first', () => {
    expect(nominationBidHistory(rows, 4)).toEqual([
      { teamId: T2, amount: 5, createdAt: '2026-08-19T12:00:05.000Z' },
      { teamId: T1, amount: 3, createdAt: '2026-08-19T12:00:03.000Z' },
    ])
  })

  it('no live nomination ⇒ no ladder; the cap is a cap', () => {
    expect(nominationBidHistory(rows, null)).toEqual([])
    expect(nominationBidHistory(rows, 4, 1)).toHaveLength(1)
  })

  it('a null created_at sorts last instead of throwing (the column is nullable in the types)', () => {
    const withNull = [
      { nomination_seq: 4, team_id: T3, amount: 5, created_at: null },
      ...rows,
    ]
    expect(nominationBidHistory(withNull, 4).map((r) => r.teamId)).toEqual([T2, T3, T1])
  })
})

// ---------------------------------------------------------------------------
// §8.6.9's 3-second beat (task AP.2; spec §16.5.4/E67; D199(4))
// ---------------------------------------------------------------------------

describe('the uncontestable award’s room beat — a sentence over a committed award', () => {
  const NOM = {
    player_id: 'p-bijan',
    high_bid: 7,
    high_bidder_team_id: T1,
  }

  it('THE CONSTANT IS EXACTLY 3000 ms — spec §8.6.9/§16.5.4 say "exactly 3 seconds", and it lives in ONE place', () => {
    expect(UNCONTESTED_BEAT_MS).toBe(3_000)
  })

  it('Q18: the sentence names the PLAYER and the TEAM, composed in one function so the ruling is a one-line change', () => {
    // Chris's own words were "…to the Nominator"; §8.6.9/§16.5.4/E67 print the
    // TEAM form and tasks-AP §AP.2 item 4 says to ship it behind one constant.
    expect(uncontestedBeatMessage('Bijan Robinson', 'Team Chris')).toBe(
      'No one can bid. Awarding Bijan Robinson to Team Chris.',
    )
  })

  it('the marker is read off the WIRE payload — an ordinary nomination carries none', () => {
    expect(readUncontestedNomination(NOM)).toBeNull()
    expect(readUncontestedNomination({ ...NOM, uncontested: true })).toEqual({
      playerId: 'p-bijan',
      teamId: T1,
    })
  })

  it('only a LITERAL true starts a beat — a truthy string or 1 does not', () => {
    expect(readUncontestedNomination({ ...NOM, uncontested: 'true' })).toBeNull()
    expect(readUncontestedNomination({ ...NOM, uncontested: 1 })).toBeNull()
    expect(readUncontestedNomination({ ...NOM, uncontested: false })).toBeNull()
  })

  it('a malformed or absent payload reads as no beat, never as a half-composed sentence', () => {
    expect(readUncontestedNomination(null)).toBeNull()
    expect(readUncontestedNomination(undefined)).toBeNull()
    expect(readUncontestedNomination([{ uncontested: true }])).toBeNull()
    expect(readUncontestedNomination({ uncontested: true })).toBeNull()
    expect(readUncontestedNomination({ uncontested: true, player_id: '', high_bidder_team_id: T1 })).toBeNull()
    expect(readUncontestedNomination({ uncontested: true, player_id: 'p', high_bidder_team_id: '' })).toBeNull()
  })

  it('THE BOUNDARY, one millisecond either side (D146): visible at 2999 ms, gone AT 3000', () => {
    const beat = { playerId: 'p-bijan', teamId: T1, atMs: 1_000_000 }
    expect(uncontestedBeatVisible(beat, 1_000_000)).toBe(true)
    expect(uncontestedBeatVisible(beat, 1_002_999)).toBe(true)
    expect(uncontestedBeatVisible(beat, 1_003_000)).toBe(false)
    expect(uncontestedBeatVisible(beat, 1_003_001)).toBe(false)
  })

  it('a clock that jumped BACKWARDS shows nothing rather than pinning the message up forever', () => {
    const beat = { playerId: 'p-bijan', teamId: T1, atMs: 1_000_000 }
    expect(uncontestedBeatVisible(beat, 999_999)).toBe(false)
  })

  it('no latch ⇒ no beat (the ordinary case, which is every other nomination)', () => {
    expect(uncontestedBeatVisible(null, 1_000_000)).toBe(false)
    expect(uncontestedBeatRemainingMs(null, 1_000_000)).toBe(0)
  })

  it('the remaining-ms schedule is the timer’s only job, and it never goes negative', () => {
    const beat = { playerId: 'p-bijan', teamId: T1, atMs: 1_000_000 }
    expect(uncontestedBeatRemainingMs(beat, 1_000_000)).toBe(3_000)
    expect(uncontestedBeatRemainingMs(beat, 1_002_999)).toBe(1)
    expect(uncontestedBeatRemainingMs(beat, 1_003_000)).toBe(0)
    expect(uncontestedBeatRemainingMs(beat, 1_009_999)).toBe(0)
  })
})

describe('R464 — the beat retires on a CLOCK SAMPLE, never on a timer firing', () => {
  const BEAT = { playerId: 'p-bijan', teamId: T1, atMs: 1_000_000 }
  const PLAYERS = new Map([['p-bijan', { full_name: 'Bijan Robinson' }]])
  const TEAMS = new Map([[T1, 'Team Chris']])

  it('THE REVIEW\u2019S OWN TRACE: no timer fires, the clock is simply later, and the message is GONE', () => {
    // latched at 1000000 with a 3000ms window. This call is the render-path
    // decision, and nothing here schedules, fires or clears a timer — which is
    // exactly the situation a clamped background tab produces.
    expect(uncontestedBeatSentence(BEAT, 1_004_000, PLAYERS, TEAMS)).toBeNull()
    expect(uncontestedBeatSentence(BEAT, 1_009_000, PLAYERS, TEAMS)).toBeNull()
  })

  it('and it is still on screen for exactly its 3 seconds \u2014 the boundary, one ms either side', () => {
    expect(uncontestedBeatSentence(BEAT, 1_000_000, PLAYERS, TEAMS)).toBe(
      'No one can bid. Awarding Bijan Robinson to Team Chris.',
    )
    expect(uncontestedBeatSentence(BEAT, 1_002_999, PLAYERS, TEAMS)).toBe(
      'No one can bid. Awarding Bijan Robinson to Team Chris.',
    )
    expect(uncontestedBeatSentence(BEAT, 1_003_000, PLAYERS, TEAMS)).toBeNull()
  })

  it('an unresolved player says nothing rather than announcing an award as \u201cLoading\u2026\u201d', () => {
    expect(uncontestedBeatSentence(BEAT, 1_000_000, new Map(), TEAMS)).toBeNull()
  })

  it('an unresolved TEAM still announces \u2014 the player is the load-bearing half', () => {
    expect(uncontestedBeatSentence(BEAT, 1_000_000, PLAYERS, new Map())).toBe(
      'No one can bid. Awarding Bijan Robinson to the nominator.',
    )
  })

  it('no latch \u21d2 no sentence', () => {
    expect(uncontestedBeatSentence(null, 1_000_000, PLAYERS, TEAMS)).toBeNull()
  })
})
