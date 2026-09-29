/**
 * trades-ui.render.test.ts — the M5 L.D3.7 surfaces over REAL static renders
 * (the `waivers-ui.render.test.ts` rig: `renderToStaticMarkup`, no browser):
 * the trade center's states (loading, error, the named 503, empty per tab,
 * the deadline line), one trade card per state a trade can be in (F438), the
 * league vote's count (F450), the commissioner's review and override tools
 * (F451), the 🔒 on a trade asset, the builder's propose / overflow / deadline
 * / counter / sent states (the server's answer as the legality preview; F452).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { CommishTradeResult } from '@/lib/leagues/api/trades-service'

import { CommishConfirm, TradeCard, TradeCenterView, type TradeCardProps, type TradeCenterViewProps } from './trade-center'
import { TradeBuilderView, type TradeBuilderViewProps } from './trade-builder'
import {
  NEVER_WHO_VOTED_COPY,
  TRADES_ERROR_TITLE,
  TRADES_HISTORY_EMPTY_COPY,
  TRADES_PENDING_EMPTY_COPY,
  TRADES_UNAVAILABLE_TITLE,
  lockedAssetTitle,
} from './trades-ops'
import { ALPHA, BRAVO, CHARLIE, LEAGUE, TEAMS, doc, player, tally, trade } from './trades.fixtures'

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
function render(element: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client }, element)))
}
const noop = () => {}
const fmt = (iso: string) => `[${iso}]`
const bravoManager = { teamId: BRAVO, isCommissioner: false, overrideMode: false }

function center(over: Partial<TradeCenterViewProps> = {}): string {
  return render(
    createElement(TradeCenterView, {
      leagueId: LEAGUE,
      doc: doc([]),
      loading: false,
      error: null,
      onRetry: noop,
      deadlineWeek: 11,
      deadlineRefusal: null,
      tab: 'pending',
      onTab: noop,
      viewer: bravoManager,
      rosters: { league_id: LEAGUE, season: 2099, teams: TEAMS },
      fmt,
      proposeDoor: null,
      onCounter: noop,
      onRespond: noop,
      onVote: noop,
      onCommish: noop,
      pendingTradeId: null,
      refusalFor: () => null,
      commishResultFor: () => null,
      ...over,
    }),
  )
}

function card(over: Partial<TradeCardProps> = {}): string {
  return render(
    createElement(TradeCard, {
      trade: trade(),
      leagueId: LEAGUE,
      viewer: bravoManager,
      lockBehavior: 'defer',
      lockedIds: new Set<string>(),
      rosterOf: (teamId: string) => TEAMS.find((t) => t.team_id === teamId) ?? null,
      fmt,
      pending: false,
      refusal: null,
      commishResult: null,
      onCounter: noop,
      onRespond: noop,
      onVote: noop,
      onCommish: noop,
      ...over,
    }),
  )
}

function builder(over: Partial<TradeBuilderViewProps> = {}): string {
  return render(
    createElement(TradeBuilderView, {
      mode: 'propose',
      teams: TEAMS,
      fromTeamId: ALPHA,
      fromChoices: null,
      initial: { toTeamId: BRAVO, get: ['p-b1'] },
      allowFaab: false,
      lockBehavior: 'defer',
      pending: false,
      refusal: null,
      deadlineRefusal: null,
      sentTo: null,
      onSend: noop,
      onClose: noop,
      ...over,
    }),
  )
}

const ops = (html: string) => [...html.matchAll(/data-trade-op="([a-z-]+)"/g)].map((m) => m[1])

// ---------------------------------------------------------------------------
// The trade center
// ---------------------------------------------------------------------------

describe('trade-center — every page state (§16.5.4)', () => {
  it('loading: a skeleton, no empty copy', () => {
    const html = center({ doc: null, loading: true })
    expect(html).toContain('data-skeleton="trades"')
    expect(html).not.toContain(TRADES_PENDING_EMPTY_COPY)
  })
  it('error: named, with Retry — never an empty list', () => {
    const html = center({ doc: null, error: new LeagueActionError(500, 'trades: connection refused') })
    expect(html).toContain('data-trades-error')
    expect(html).toContain(TRADES_ERROR_TITLE)
    expect(html).toContain('trades: connection refused')
    expect(html).toContain('Retry')
    expect(html).not.toContain(TRADES_PENDING_EMPTY_COPY)
  })
  it('deploy before push (D417(5)): the named 503 state — the route’s sentence, no tabs, no crash', () => {
    const sentence = 'Trades aren’t available yet — the league database hasn’t been updated for trades. Try again after the next update.'
    const html = center({ doc: null, error: new LeagueActionError(503, sentence) })
    expect(html).toContain('data-trades-unavailable')
    expect(html).toContain(TRADES_UNAVAILABLE_TITLE)
    expect(html).toContain(sentence)
    expect(html).not.toContain('data-tab="pending"')
    expect(html).not.toContain(TRADES_ERROR_TITLE)
  })
  it('empty per tab: says why', () => {
    expect(center()).toContain(TRADES_PENDING_EMPTY_COPY)
    expect(center({ tab: 'history' })).toContain(TRADES_HISTORY_EMPTY_COPY)
  })
  it('F452: the deadline as its week and the review mode, in words; a deadline refusal seen on the page replaces it, verbatim', () => {
    const html = center()
    expect(html).toContain('data-trade-deadline="11"')
    expect(html).toContain('Trade deadline: Week 11 — offers can be made and accepted until Week 12 begins.')
    expect(html).toContain('An accepted trade goes through after 24 hours unless the commissioner vetoes it first.')
    const refused = 'the trade deadline has passed — trades could be proposed until week 12 began (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)'
    expect(center({ deadlineRefusal: refused })).toContain(`🔒 ${refused}`)
    expect(center({ deadlineWeek: null })).toContain('No trade deadline — trades are allowed all season.')
  })
  it('pending vs history tabs split the one read; the pending count rides the tab', () => {
    const d = doc([trade(), trade({ id: 'tr-old', status: 'complete', in_flight: false })])
    const pending = center({ doc: d })
    expect(pending).toContain('data-trade="tr-1"')
    expect(pending).not.toContain('data-trade="tr-old"')
    const history = center({ doc: d, tab: 'history' })
    expect(history).toContain('data-trade="tr-old"')
    expect(history).not.toContain('data-trade="tr-1"')
  })
  it('🔒 on an in-flight trade’s asset whose game has started (the rosters’ lock view), with this league’s rule', () => {
    const html = center({ doc: doc([trade({ items: [{ from_team_id: BRAVO, to_team_id: ALPHA, player: player('p-b2', 'Bo Two'), faab_amount: null }] })]) })
    expect(html).toContain('data-lock')
    expect(html).toContain(lockedAssetTitle('defer'))
  })
})

// ---------------------------------------------------------------------------
// One trade card per state (F438)
// ---------------------------------------------------------------------------

describe('trade card — an offer', () => {
  it('the receiving manager: Accept / Accept with drops / Counter / Turn down; both sides and the note shown', () => {
    const html = card({ trade: trade({ note: 'fair?' }) })
    expect(ops(html)).toEqual(['accept', 'accept-drops', 'counter', 'reject'])
    expect(html).toContain('Alpha gives')
    expect(html).toContain('Andy One')
    expect(html).toContain('Bravo gives')
    expect(html).toContain('Ben One')
    expect(html).toContain('“fair?”')
    expect(html).toContain('Waiting for Bravo to answer.')
  })
  it('the proposer: Call off offer only', () => {
    expect(ops(card({ viewer: { teamId: ALPHA, isCommissioner: false, overrideMode: false } }))).toEqual(['cancel'])
  })
  it('a bystander: no buttons', () => {
    expect(ops(card({ viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false } }))).toEqual([])
  })
  it('the server’s refusal renders VERBATIM on the card', () => {
    const refusal = 'only the team that received a trade can accept it — you proposed this one, so cancel it instead'
    expect(card({ refusal })).toContain(`data-trade-card-refusal="true">${refusal}`)
  })
  it('E36: the server says the receiving roster overflows → the drop picker opens with the count, the sentence verbatim', () => {
    const refusal = "Bravo's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)"
    const html = card({ refusal })
    expect(html).toContain('data-accept-drops')
    expect(html).toContain(refusal)
    expect(html).toContain('Pick 1 player to drop so your roster fits — he is dropped only if the trade goes through.')
    // The players Bravo is giving away are not offered as drops.
    const picker = html.slice(html.indexOf('data-drop-picker'))
    expect(picker).not.toContain('data-trade-pick="p-b1"')
    expect(picker).toContain('data-trade-pick="p-b3"')
    expect(html).toContain('data-accept-with-drops')
  })
  it('the commissioner in override mode answers for the receiving team — the Accept says for whom — and may force', () => {
    const html = card({ viewer: { teamId: null, isCommissioner: true, overrideMode: true } })
    expect(html).toContain('Accept for Bravo')
    expect(ops(html)).toEqual(['accept', 'accept-drops', 'counter', 'reject', 'cancel', 'force'])
    expect(html).toContain('data-trade-override')
  })
})

describe('trade card — under review', () => {
  const commishReview = trade({ status: 'in_review', review: { mode: 'commissioner', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 19 * 3_600_000 } })
  it('the countdown from the read (never a clock); the commissioner’s Approve / Veto without override mode', () => {
    const html = card({ trade: commishReview, viewer: { teamId: null, isCommissioner: true, overrideMode: false } })
    expect(html).toContain('Under review')
    expect(html).toContain('Goes through [2099-09-15T15:00:00.000Z] (about 19 hours left) unless the commissioner vetoes it.')
    expect(ops(html)).toEqual(['approve', 'veto'])
    expect(html).not.toContain('data-trade-override')
  })
  it('a manager sees the state and no review buttons', () => {
    expect(ops(card({ trade: commishReview }))).toEqual([])
  })
  it('F450: a league vote shows the count, the capped number in words, the voter’s buttons — never who voted', () => {
    const t = trade({
      status: 'in_review',
      review: { mode: 'league_vote', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 3_600_000 },
      tally: tally({ veto_votes: 2, eligible_voters: 3, setting: 5, veto_number: 3, capped: true }),
    })
    const html = card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false } })
    expect(html).toContain('data-trade-tally="2/3"')
    expect(html).toContain('2 veto votes so far')
    expect(html).toContain('data-trade-tally-rule="capped"')
    expect(html).toContain('It’s vetoed if all 3 managers who can vote veto it — the league’s setting is 5, but only 3 managers can vote on this trade.')
    expect(html).toContain(NEVER_WHO_VOTED_COPY)
    expect(ops(html)).toEqual(['vote-veto', 'vote-approve'])
    // No voter identity anywhere — the fixture's manager ids never render.
    expect(html).not.toMatch(/m-Alpha|m-Bravo|m-Charlie/)
  })
  it('R1236: the tally closed by its own clock → no vote buttons, even with review time showing', () => {
    const t = trade({
      status: 'in_review',
      review: { mode: 'league_vote', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 60_000 },
      tally: tally({ closes_at: '2099-09-14T20:00:00.000Z', evaluated_at: '2099-09-14T20:00:00.000Z' }),
    })
    expect(ops(card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false } }))).toEqual([])
  })
  it('the voter’s own vote disables that button and is said', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally({ my_vote: 'veto' }) })
    const html = card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false } })
    expect(html).toContain('You voted to veto.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-trade-op="vote-veto"/)
  })
  it('the commissioner overrides a league vote only in override mode', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally({ can_vote: false, cannot_vote_because: 'no_team' }) })
    expect(ops(card({ trade: t, viewer: { teamId: null, isCommissioner: true, overrideMode: false } }))).toEqual([])
    expect(ops(card({ trade: t, viewer: { teamId: null, isCommissioner: true, overrideMode: true } }))).toEqual(['approve', 'veto', 'force'])
  })
})

describe('trade card — waiting, closed, and the commissioner’s answer', () => {
  it('deferred (Q75): the chip with the release instant, or the week’s end', () => {
    const html = card({ trade: trade({ status: 'accepted', deferred: { until: '2099-09-16T07:00:00.000Z', ms_remaining: 1 } }) })
    expect(html).toContain('Waiting for games to end')
    expect(html).toContain('data-trade-deferred="2099-09-16T07:00:00.000Z"')
    expect(html).toContain('Goes through after the games · [2099-09-16T07:00:00.000Z]')
    expect(card({ trade: trade({ status: 'accepted', deferred: { until: null, ms_remaining: null } }) })).toContain('Goes through after this week’s last game')
  })
  it('vetoed / invalid / expired carry their reason; no buttons for a manager', () => {
    const vetoed = card({ trade: trade({ status: 'vetoed', in_flight: false, status_reason: 'the commissioner vetoed it — lopsided' }) })
    expect(vetoed).toContain('Vetoed')
    expect(vetoed).toContain('The commissioner vetoed it — lopsided')
    expect(ops(vetoed)).toEqual([])
    const invalid = card({ trade: trade({ status: 'invalid', in_flight: false, status_reason: "Andy One (p-a1) is no longer on Alpha's roster — he was dropped (E37)" }) })
    expect(invalid).toContain('No longer valid')
    expect(invalid).toContain("Andy One (p-a1) is no longer on Alpha's roster — he was dropped")
    expect(invalid).not.toContain('(E37)')
    const expired = card({ trade: trade({ status: 'expired', in_flight: false, status_reason: 'the trade deadline passed before it was answered' }) })
    expect(expired).toContain('Expired')
    expect(expired).toContain('The trade deadline passed before it was answered')
  })
  it('a completed trade: the commissioner’s Reverse lives inside override mode; the 🔒 is not shown on history', () => {
    const done = trade({ status: 'complete', in_flight: false, resolved_at: '2099-09-15T00:00:00.000Z' })
    expect(ops(card({ trade: done, viewer: { teamId: null, isCommissioner: true, overrideMode: false } }))).toEqual([])
    expect(ops(card({ trade: done, viewer: { teamId: null, isCommissioner: true, overrideMode: true } }))).toEqual(['reverse'])
    expect(card({ trade: done, lockedIds: new Set(['p-a1']) })).not.toContain('data-lock')
  })
  it('F451: the commissioner’s answer in words — what he stood outside, named', () => {
    const result = { outcome: 'forced', bypassed: ['review_period', 'game_day_lock:p-a1'], no_changes_why: null, score_stale: false } as unknown as CommishTradeResult
    const html = card({ trade: trade({ status: 'complete', in_flight: false }), commishResult: result })
    expect(html).toContain('data-commish-trade-outcome="forced"')
    expect(html).toContain('Forced through — past the rest of the review period and Andy One’s game-day lock.')
  })
})

describe('§10.4 — force and reverse confirm with before → after', () => {
  it('force', () => {
    const html = render(createElement(CommishConfirm, { trade: trade(), op: 'force', pending: false, onConfirm: noop, onCancel: noop }))
    expect(html).toContain('Andy One: Alpha → Bravo')
    expect(html).toContain('Ben One: Bravo → Alpha')
    expect(html).toContain('data-commish-confirm-go')
  })
  it('reverse', () => {
    const html = render(createElement(CommishConfirm, { trade: trade({ status: 'complete', in_flight: false }), op: 'reverse', pending: false, onConfirm: noop, onCancel: noop }))
    expect(html).toContain('Andy One: Bravo → Alpha')
  })
})

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

describe('trade-builder — the two sides from the rosters; the server’s answer is the preview', () => {
  it('propose: both rosters as picks, the deep-linked player picked, 🔒 on a started player (still pickable)', () => {
    const html = builder()
    expect(html).toContain('data-trade-builder="propose"')
    expect(html).toContain('Alpha gives')
    expect(html).toContain('Bravo gives')
    expect(html).toMatch(/data-trade-pick="p-b1" data-picked="true"/)
    const bo = html.slice(html.indexOf('data-trade-pick="p-b2"'), html.indexOf('</li>', html.indexOf('data-trade-pick="p-b2"')))
    expect(bo).toContain('🔒')
    expect(bo).toContain(lockedAssetTitle('defer'))
    expect(bo).not.toContain('disabled=""')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-trade-send/)
  })
  it('nothing picked yet → Send is off, with the reason', () => {
    const html = builder({ initial: { toTeamId: BRAVO } })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-trade-send/)
    expect(html).toContain('Pick at least one player (or some FAAB) to trade.')
  })
  it('E36: the server says the offering roster overflows → the refusal VERBATIM and the drop picker open with the count', () => {
    const refusal = "Alpha's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)"
    const html = builder({ refusal })
    expect(html).toContain(`data-trade-refusal="true"`)
    expect(html).toContain(refusal)
    expect(html).toContain('data-trade-drops="open"')
    expect(html).toContain('data-trade-drops-prompt="1"')
    expect(html).toContain('Pick 1 player to drop so your roster fits')
  })
  it('F452: a deadline refusal locks the builder with the server’s sentence — Send off', () => {
    const refusal = 'the trade deadline has passed — trades could be proposed until week 12 began (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)'
    const html = builder({ refusal })
    expect(html).toContain('data-trade-deadline-locked')
    expect(html).toContain(refusal)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-trade-send/)
    expect(html).not.toContain('data-trade-refusal')
  })
  it('FAAB boxes only when the league trades FAAB', () => {
    expect(builder()).not.toContain('data-trade-faab')
    const html = builder({ allowFaab: true })
    expect(html).toContain('data-trade-faab="give"')
    expect(html).toContain('data-trade-faab="get"')
    expect(html).toContain('$100 left')
  })
  it('counter-offer: the teams fixed, the picks seeded, its own Send words', () => {
    const html = builder({ mode: 'counter', fromTeamId: BRAVO, initial: { toTeamId: ALPHA, give: ['p-b1'], get: ['p-a1'] } })
    expect(html).toContain('Counter-offer to Alpha')
    expect(html).toMatch(/data-trade-pick="p-b1" data-picked="true"/)
    expect(html).toMatch(/data-trade-pick="p-a1" data-picked="true"/)
    expect(html).toContain('Send counter-offer')
  })
  it('the commissioner in override mode picks the offering team', () => {
    const html = builder({ fromChoices: TEAMS.map((t) => ({ id: t.team_id, name: t.name })) })
    expect(html).toContain('Offering team (acting as commissioner)')
  })
  it('sent: says who gets it and where it is listed', () => {
    const html = builder({ sentTo: 'Bravo' })
    expect(html).toContain('data-trade-builder="sent"')
    expect(html).toContain('Offer sent to Bravo.')
  })
})
