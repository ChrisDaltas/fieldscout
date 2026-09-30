/**
 * trades-ops.test.ts — the trade center's words and buttons (M5 L.D3.7; spec
 * §13.3, §16.2, §16.5.2; PROGRESS D419, F438, F450, F451, F452).
 *
 * The server's sentences are pinned as STORED LITERALS (what 148 / 151 / 155
 * raise, after `userFacingMessage`), so a re-worded refusal on either side
 * reds a cell here rather than silently losing the drop prompt or the
 * deadline lock.
 */
import { describe, expect, it } from 'vitest'

import { userFacingMessage } from '@/lib/leagues/api/client-fetch'

import * as ops from './trades-ops'
import {
  builderLegs,
  builderProblem,
  bypassedWords,
  COMMISH_CONFIRM_COPY,
  COMMISH_CONFIRM_TITLE,
  COMMISH_OP_LABELS,
  commishConfirmLines,
  commishOutcomeCopy,
  counterSeed,
  dropsNeeded,
  durationWords,
  isDeadlineRefusal,
  isTradesUnavailable,
  parseFaab,
  plainServerSentence,
  plainRefusal,
  reviewModeCopy,
  splitTrades,
  tallyWords,
  tradeActions,
  tradeDeadlineCopy,
  tradeStatusView,
  tradesHref,
  votingOpen,
} from './trades-ops'
import { ALPHA, BRAVO, CHARLIE, player, tally, trade } from './trades.fixtures'

const fmt = (iso: string) => `<${iso}>`

// The server's own sentences, as 151 raises them (the `%` filled in).
const OVERFLOW_PROPOSE =
  "trade_propose: Alpha's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)"
const OVERFLOW_ACCEPT_TWO =
  "trade_respond: Bravo's roster would hold 18 players after this trade — 2 more than its 16 spots (§7.3.2 roster_size): name 2 more drop(s) as part of the trade (E36)"
const NO_LONGER_FITS =
  "trade_respond: Alpha's roster no longer fits this offer — it would hold 17 players after the trade, 1 more than its 16 spots (§7.3.2 roster_size), because it has added players since proposing; only Alpha can fix that, so ask them to cancel and re-propose with drops (E36)"
const DEADLINE =
  'trade_propose: the trade deadline has passed — trades could be proposed until week 12 began (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)'

describe('the door: tradesHref', () => {
  it('the trade center, and the builder toward a team with a player picked', () => {
    expect(tradesHref('l1')).toBe('/app/leagues/l1/trades')
    expect(tradesHref('l1', { teamId: 't2' })).toBe('/app/leagues/l1/trades?with=t2')
    expect(tradesHref('l1', { teamId: 't2', playerId: 'p9' })).toBe('/app/leagues/l1/trades?with=t2&player=p9')
  })
})

describe('F452 — the deadline is its WEEK (Q76: offers until week N+1 begins); the instant is the server’s', () => {
  it('a deadline week, or none', () => {
    expect(tradeDeadlineCopy(11)).toBe('Trade deadline: Week 11 — offers can be made and accepted until Week 12 begins.')
    expect(tradeDeadlineCopy(null)).toBe('No trade deadline — trades are allowed all season.')
  })
  it('a refusal past the deadline is recognised by the server’s own sentence (before and after userFacingMessage)', () => {
    expect(isDeadlineRefusal(DEADLINE)).toBe(true)
    expect(isDeadlineRefusal(userFacingMessage(DEADLINE))).toBe(true)
    expect(isDeadlineRefusal(OVERFLOW_PROPOSE)).toBe(false)
  })
})

describe('the legality “preview” is the server’s answer: dropsNeeded reads the E36 sentence', () => {
  it('the offering team’s overflow → its name and the number of drops still needed', () => {
    expect(dropsNeeded(OVERFLOW_PROPOSE)).toEqual({ teamName: 'Alpha', more: 1 })
    expect(dropsNeeded(userFacingMessage(OVERFLOW_PROPOSE))).toEqual({ teamName: 'Alpha', more: 1 })
    expect(dropsNeeded(OVERFLOW_ACCEPT_TWO)).toEqual({ teamName: 'Bravo', more: 2 })
  })
  it('the proposer outgrew the offer (only HE can fix it) → no picker; any other sentence → none', () => {
    expect(dropsNeeded(NO_LONGER_FITS)).toBeNull()
    expect(dropsNeeded(DEADLINE)).toBeNull()
    expect(dropsNeeded("trade_execute: Alpha's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): it has added players since the trade was agreed, so the trade cannot go through as agreed (E36)")).toBeNull()
  })
})

describe('time words come from the read’s own numbers — never a clock', () => {
  it('boundaries', () => {
    expect(durationWords(59_999)).toBe('less than a minute')
    expect(durationWords(60_000)).toBe('about 1 minute')
    expect(durationWords(3_599_999)).toBe('about 59 minutes')
    expect(durationWords(3_600_000)).toBe('about 1 hour')
    expect(durationWords(47 * 3_600_000)).toBe('about 47 hours')
    expect(durationWords(48 * 3_600_000)).toBe('about 2 days')
  })
})

describe('reviewModeCopy — how an accepted trade goes through, per league', () => {
  it('none / commissioner / league vote', () => {
    expect(reviewModeCopy({ trade_review: 'none', trade_review_period_hours: 24 })).toBe('An accepted trade goes through at once — there is no review.')
    expect(reviewModeCopy({ trade_review: 'commissioner', trade_review_period_hours: 24 })).toBe('An accepted trade goes through after 24 hours unless the commissioner vetoes it first.')
    expect(reviewModeCopy({ trade_review: 'league_vote', trade_review_period_hours: 1 })).toBe('An accepted trade goes through after 1 hour unless enough managers vote to veto it.')
  })
})

describe('F438 — every state a trade can be in, in words', () => {
  it('an offer waits for the other team', () => {
    expect(tradeStatusView(trade(), fmt)).toEqual({ label: 'Offer', tone: 'accent', detail: 'Waiting for Bravo to answer.' })
  })
  it('under review: the end instant and the read’s own countdown; who can stop it', () => {
    const t = trade({ status: 'in_review', review: { mode: 'commissioner', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 5 * 3_600_000 } })
    expect(tradeStatusView(t, fmt).detail).toBe('Goes through <2099-09-15T15:00:00.000Z> (about 5 hours left) unless the commissioner vetoes it.')
    const v = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 0 } })
    expect(tradeStatusView(v, fmt).detail).toBe('Goes through <2099-09-15T15:00:00.000Z> (less than a minute left) unless the league votes to veto it.')
  })
  it('deferred (Q75): the release instant, or the week’s end not yet recorded (151’s infinity)', () => {
    expect(tradeStatusView(trade({ status: 'accepted', deferred: { until: '2099-09-16T07:00:00.000Z', ms_remaining: 1 } }), fmt)).toEqual({
      label: 'Waiting for games to end',
      tone: 'caution',
      detail: 'Accepted — a player in it has already played this week, so it goes through right after the week’s last game ends (<2099-09-16T07:00:00.000Z>).',
    })
    expect(tradeStatusView(trade({ status: 'accepted', deferred: { until: null, ms_remaining: null } }), fmt).detail).toBe(
      'Accepted — a player in it has already played this week, so it goes through when the week’s last game ends.',
    )
  })
  it('closed trades name the server’s reason, builder citation stripped', () => {
    const closed = (status: ReturnType<typeof trade>['status'], reason: string | null) => tradeStatusView(trade({ status, status_reason: reason, in_flight: false }), fmt)
    expect(closed('rejected', 'rejected by Bravo')).toEqual({ label: 'Turned down', tone: 'neutral', detail: 'Rejected by Bravo.' })
    expect(closed('rejected', 'countered by Bravo').label).toBe('Countered')
    expect(closed('cancelled', 'cancelled by Alpha').detail).toBe('Cancelled by Alpha.')
    // 155's veto sentence and 148's E37 sentence, as stored.
    expect(
      closed('vetoed', "vetoed by league vote — 3 of the 3 managers who can vote voted to veto, and the league's number is 3 (its setting of 5 is more than the managers who can vote) (§13.3 / Q77)"),
    ).toEqual({
      label: 'Vetoed',
      tone: 'negative',
      detail: "Vetoed by league vote — 3 of the 3 managers who can vote voted to veto, and the league's number is 3 (its setting of 5 is more than the managers who can vote)",
    })
    expect(closed('invalid', "Andy One (p-a1) is no longer on Alpha's roster — he was dropped (E37)")).toEqual({
      label: 'No longer valid',
      tone: 'negative',
      detail: "Andy One (p-a1) is no longer on Alpha's roster — he was dropped",
    })
    expect(closed('expired', null).detail).toBe('Still waiting for an answer when the trade deadline passed.')
    expect(closed('reversed', null).label).toBe('Reversed')
    expect(tradeStatusView(trade({ status: 'complete', in_flight: false, resolved_at: '2099-09-15T00:00:00.000Z' }), fmt).detail).toBe('Went through <2099-09-15T00:00:00.000Z>.')
  })
  it('plainRefusal takes out builder citations, keeps the server words (R1244)', () => {
    expect(plainRefusal("Bravo's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)"))
      .toBe("Bravo's roster would hold 17 players after this trade — 1 more than its 16 spots: name 1 more drop(s) as part of the trade")
    expect(plainRefusal('the trade deadline has passed (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)'))
      .toBe('the trade deadline has passed (Wed, Nov 25 12:00 AM ET)')
    expect(plainRefusal('x (2 of 3)')).toBe('x (2 of 3)')
  })
  it('plainServerSentence strips only a trailing citation', () => {
    expect(plainServerSentence('x (§13.3 / Q77)')).toBe('x')
    expect(plainServerSentence('x (E36)')).toBe('x')
    expect(plainServerSentence('x (2 of 3)')).toBe('x (2 of 3)')
  })
})

describe('R1236 — “voting open” is the TALLY’s own clock (closes_at vs its own evaluated_at)', () => {
  it('the boundary: closes AT the tally’s instant ⇒ closed; one millisecond later ⇒ open', () => {
    expect(votingOpen({ closes_at: '2099-09-15T15:00:00.000Z', evaluated_at: '2099-09-15T15:00:00.000Z' })).toBe(false)
    expect(votingOpen({ closes_at: '2099-09-15T15:00:00.001Z', evaluated_at: '2099-09-15T15:00:00.000Z' })).toBe(true)
    expect(votingOpen({ closes_at: null, evaluated_at: '2099-09-15T15:00:00.000Z' })).toBe(false)
  })
  it('a review countdown that still shows time left does NOT reopen a vote the tally closed', () => {
    const t = trade({
      status: 'in_review',
      review: { mode: 'league_vote', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 60_000 },
      tally: tally({ closes_at: '2099-09-15T15:00:00.000Z', evaluated_at: '2099-09-15T15:00:00.000Z' }),
    })
    expect(tradeActions(t, { teamId: CHARLIE, isCommissioner: false, overrideMode: false }).vote).toBe(false)
  })
})

describe('F450 — the count and the number in words; the capped number said plainly; never who voted', () => {
  it('the setting applies', () => {
    expect(tallyWords(tally())).toEqual({ count: '1 veto vote so far', rule: 'It’s vetoed at 4 veto votes — 6 managers can vote.', mine: null })
  })
  it('capped: fewer managers can vote than the setting', () => {
    const w = tallyWords(tally({ veto_votes: 2, eligible_voters: 3, setting: 5, veto_number: 3, capped: true }))
    expect(w.count).toBe('2 veto votes so far')
    expect(w.rule).toBe('It’s vetoed if all 3 managers who can vote veto it — the league’s setting is 5, but only 3 managers can vote on this trade.')
    expect(tallyWords(tally({ veto_votes: 0, eligible_voters: 1, setting: 5, veto_number: 1, capped: true })).rule).toBe(
      'It’s vetoed if the 1 manager who can vote vetoes it — the league’s setting is 5, but only 1 manager can vote on this trade.',
    )
  })
  it('nobody can vote (D415 R1225): it goes through at the end', () => {
    expect(tallyWords(tally({ veto_votes: 0, eligible_voters: 0, veto_number: 0, capped: true })).rule).toBe(
      'No manager can vote on this trade, so it goes through when the review ends.',
    )
  })
  it('the viewer’s own vote, or why he has none', () => {
    expect(tallyWords(tally({ my_vote: 'veto' })).mine).toBe('You voted to veto.')
    expect(tallyWords(tally({ my_vote: 'approve' })).mine).toBe('You voted to let it through.')
    expect(tallyWords(tally({ can_vote: false, cannot_vote_because: 'party' })).mine).toBe('Your team is in this trade, so you don’t vote on it.')
    expect(tallyWords(tally({ can_vote: false, cannot_vote_because: 'no_team' })).mine).toBe('Only managers of teams vote on trades.')
  })
})

describe('tradeActions — who sees which button (the server decides every move)', () => {
  const manager = (teamId: string | null) => ({ teamId, isCommissioner: false, overrideMode: false })
  const commish = (overrideMode: boolean, teamId: string | null = null) => ({ teamId, isCommissioner: true, overrideMode })
  it('an offer: the receiving manager accepts / turns down / counters; the proposer calls it off; a bystander sees nothing', () => {
    expect(tradeActions(trade(), manager(BRAVO))).toMatchObject({ accept: true, reject: true, counter: true, cancel: false, force: false })
    expect(tradeActions(trade(), manager(ALPHA))).toMatchObject({ accept: false, reject: false, counter: false, cancel: true })
    const none = tradeActions(trade(), manager(CHARLIE))
    expect(Object.entries(none).filter(([, v]) => v === true)).toEqual([])
  })
  it('an offer is the two teams own: the commissioner has NO move on it, override mode or not (Chris 2026-09-30 — L.D3.16 / D463)', () => {
    for (const overrideMode of [false, true]) {
      const set = tradeActions(trade(), commish(overrideMode))
      expect(Object.entries(set).filter(([, v]) => v === true), `override ${overrideMode}`).toEqual([])
    }
    // A commissioner who manages one of the teams answers as its manager — his own side only, no force.
    expect(tradeActions(trade(), commish(true, ALPHA))).toMatchObject({ accept: false, reject: false, cancel: true, force: false })
    expect(tradeActions(trade(), commish(true, BRAVO))).toMatchObject({ accept: true, reject: true, counter: true, cancel: false, force: false })
  })
  it('under commissioner review: Approve / Veto are his job (no override needed); force is an override', () => {
    const t = trade({ status: 'in_review', review: { mode: 'commissioner', ends_at: null, ms_remaining: null } })
    expect(tradeActions(t, commish(false))).toMatchObject({ reviewApprove: true, reviewVeto: true, force: false, overrideApprove: false })
    expect(tradeActions(t, commish(true))).toMatchObject({ reviewApprove: true, reviewVeto: true, force: true })
    expect(tradeActions(t, manager(BRAVO)).reviewApprove).toBe(false)
  })
  it('under a league vote: a manager who can vote votes; the commissioner overrides the vote only in override mode', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally() })
    expect(tradeActions(t, manager(CHARLIE)).vote).toBe(true)
    expect(tradeActions({ ...t, tally: tally({ can_vote: false, cannot_vote_because: 'party' }) }, manager(ALPHA)).vote).toBe(false)
    expect(tradeActions(t, commish(false))).toMatchObject({ reviewApprove: false, overrideApprove: false })
    expect(tradeActions(t, commish(true))).toMatchObject({ overrideApprove: true, overrideVeto: true, force: true })
  })
  it('waiting for the games: override veto / force; expired, complete and every other closed state: nothing (174 — no force on an offer, no reverse)', () => {
    expect(tradeActions(trade({ status: 'accepted', deferred: { until: null, ms_remaining: null } }), commish(true))).toMatchObject({ overrideVeto: true, force: true })
    for (const status of ['expired', 'complete', 'rejected', 'cancelled', 'vetoed', 'invalid', 'reversed'] as const) {
      const set = tradeActions(trade({ status, in_flight: false }), commish(true))
      expect(Object.entries(set).filter(([, v]) => v === true), status).toEqual([])
    }
  })
})

describe('the builder: legs, FAAB, problems, the counter seed', () => {
  it('builderLegs — players both ways, FAAB only when > 0', () => {
    expect(builderLegs({ fromTeamId: ALPHA, toTeamId: BRAVO, give: ['p-a1'], get: ['p-b1'], faabGive: 5, faabGet: null })).toEqual([
      { playerId: 'p-a1', fromTeamId: ALPHA },
      { playerId: 'p-b1', fromTeamId: BRAVO },
      { faabAmount: 5, fromTeamId: ALPHA },
    ])
  })
  it('parseFaab — blank / 0 = none, whole dollars, anything else is not a number', () => {
    expect(parseFaab('')).toBeNull()
    expect(parseFaab('0')).toBeNull()
    expect(parseFaab('$12')).toBe(12)
    expect(parseFaab('1.5')).toBeNaN()
  })
  it('builderProblem — advice only', () => {
    expect(builderProblem({})).toBe('Pick the team you want to trade with.')
    expect(builderProblem({ toTeamId: BRAVO, give: [], get: [] })).toBe('Pick at least one player (or some FAAB) to trade.')
    expect(builderProblem({ toTeamId: BRAVO, give: [], get: [], faabValid: false })).toBe('FAAB is whole dollars.')
    expect(builderProblem({ toTeamId: BRAVO, give: ['p'], get: [] })).toBeNull()
  })
  it('counterSeed — the offer turned around: the receiving team now offers', () => {
    const t = trade({
      items: [
        { from_team_id: ALPHA, to_team_id: BRAVO, player: player('p-a1', 'Andy One'), faab_amount: null },
        { from_team_id: BRAVO, to_team_id: ALPHA, player: player('p-b1', 'Ben One'), faab_amount: null },
        { from_team_id: ALPHA, to_team_id: BRAVO, player: null, faab_amount: 7 },
      ],
    })
    expect(counterSeed(t)).toEqual({ fromTeamId: BRAVO, toTeamId: ALPHA, give: ['p-b1'], get: ['p-a1'], faabGive: null, faabGet: 7 })
  })
})

describe('F451 — the commissioner’s tools: before → after, the answer in words', () => {
  const t = trade({ drops: [{ team_id: BRAVO, player: player('p-b3', 'Bud Three') }] })
  it('force: each asset from its team to the other; the drop leaves (the only confirmation since 174 removed reverse)', () => {
    expect(commishConfirmLines(t)).toEqual(['Andy One: Alpha → Bravo', 'Ben One: Bravo → Alpha', 'Bud Three: dropped by Bravo'])
    expect(COMMISH_CONFIRM_TITLE).toBe('Force this trade through now?')
    expect(COMMISH_CONFIRM_COPY).not.toMatch(/deadline/)
    expect(COMMISH_OP_LABELS).toStrictEqual({ approve: 'Approve', veto: 'Veto', force: 'Force it through' })
  })
  it('bypassed in words, a game-day lock naming the player', () => {
    const name = (id: string) => (id === 'p-a1' ? 'Andy One' : null)
    expect(bypassedWords('review_period', name)).toBe('the rest of the review period')
    expect(bypassedWords('league_vote', name)).toBe('the league vote')
    expect(bypassedWords('trade_deadline', name)).toBe('the trade deadline')
    expect(bypassedWords('game_day_lock:p-a1', name)).toBe('Andy One’s game-day lock')
    expect(bypassedWords('game_day_lock:p-zz', name)).toBe('a player’s game-day lock')
    expect(
      commishOutcomeCopy({ outcome: 'forced', bypassed: ['league_vote', 'trade_deadline', 'game_day_lock:p-a1'], no_changes_why: null, score_stale: true }, name),
    ).toBe('Forced through — past the league vote, the trade deadline and Andy One’s game-day lock. The week’s scores are being updated.')
    expect(commishOutcomeCopy({ outcome: 'no_change', bypassed: [], no_changes_why: 'the trade is already vetoed (§13.3)', score_stale: false }, name)).toBe(
      'Nothing changed — the trade is already vetoed',
    )
    expect(commishOutcomeCopy({ outcome: 'approved_deferred', bypassed: [], no_changes_why: null, score_stale: false }, name)).toMatch(/right after the week’s last game ends/)
  })
})

describe('tabs + the 503', () => {
  it('pending = in flight; history = the rest', () => {
    const { pending, history } = splitTrades([trade(), trade({ id: 'x', status: 'complete', in_flight: false })])
    expect(pending.map((t) => t.id)).toEqual(['tr-1'])
    expect(history.map((t) => t.id)).toEqual(['x'])
  })
  it('the deploy-before-push answer is a 503 (D417(5))', () => {
    expect(isTradesUnavailable({ status: 503 })).toBe(true)
    expect(isTradesUnavailable({ status: 500 })).toBe(false)
    expect(isTradesUnavailable(null)).toBe(false)
  })
})

describe('no ledger code in any end-user copy (F277(a))', () => {
  it('every exported string constant is free of Q/E/F/D/R numbers', () => {
    for (const [name, value] of Object.entries(ops)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
    }
  })
})

describe('F480 / R1268 — the ?with=&player= door (tradeDoorStep, replayed the way TradesContent renders)', () => {
  /** Replays the component: one step at mount and one per render with the
   *  team known then (its effect on `myTeamId`); 'close' clears the builder.
   *  Returns every builder the door opened, in order. */
  function replay(renders: Array<string | null | 'close'>, door: ops.TradeDoorParams): ops.TradeDoorOpen[] {
    const opened: ops.TradeDoorOpen[] = []
    let decided = false
    for (const r of renders) {
      if (r === 'close') continue // closing clears the builder; the door's memory is `decided`, untouched
      const step = ops.tradeDoorStep(decided, r, door)
      decided = step.decided
      if (step.open) opened.push(step.open)
    }
    return opened
  }
  const door = { with: 'team-b', player: 'p-9' }

  it('mounted while the session is still loading (team null), it opens when the team arrives — exactly once', () => {
    expect(replay([null, null, 'team-a', 'team-a', 'team-a'], door)).toEqual([
      { fromTeamId: 'team-a', toTeamId: 'team-b', getPlayerIds: ['p-9'] },
    ])
  })

  it('the team known at mount opens it at once, the same single time', () => {
    expect(replay(['team-a', 'team-a'], door)).toHaveLength(1)
  })

  it('closing the builder never re-opens it', () => {
    expect(replay([null, 'team-a', 'close', 'team-a', 'team-a'], door)).toHaveLength(1)
  })

  it('a link to the viewer’s own team, or no link at all, decides "no door" and stays closed', () => {
    expect(replay([null, 'team-b', 'team-b'], door)).toEqual([])
    expect(replay([null, 'team-a'], { with: null, player: null })).toEqual([])
    expect(ops.tradeDoorStep(false, 'team-a', { with: null, player: null })).toEqual({ decided: true, open: null })
    expect(ops.tradeDoorStep(false, null, door)).toEqual({ decided: false, open: null })
  })

  it('a player-only link opens toward no fixed team, the player picked', () => {
    expect(replay([null, 'team-a'], { with: null, player: 'p-9' })).toEqual([{ fromTeamId: 'team-a', toTeamId: null, getPlayerIds: ['p-9'] }])
  })
})
