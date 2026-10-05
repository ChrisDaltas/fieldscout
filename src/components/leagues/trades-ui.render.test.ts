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

import type { TradePreviewDraft, TradePreviewState, UseTradePreview } from '@/hooks/use-trade-preview'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { CommishTradeResult, TradePreview } from '@/lib/leagues/api/trades-service'

import { BuilderRostersWait, CommishConfirm, TradeCard, TradeCenterView, type TradeCardProps, type TradeCenterViewProps } from './trade-center'
import { TradeBuilderView, type TradeBuilderViewProps } from './trade-builder'
import { BUILDER_ROSTERS_ERROR_TITLE, NO_TRADE_PARTNER_COPY, noManagerCopy } from './trades-ops'
import {
  NEVER_WHO_VOTED_COPY,
  TRADES_ERROR_TITLE,
  TRADES_HISTORY_EMPTY_COPY,
  TRADES_PENDING_EMPTY_COPY,
  TRADES_UNAVAILABLE_TITLE,
  lockedAssetTitle,
} from './trades-ops'
import { ALPHA, BRAVO, CHARLIE, LEAGUE, TEAMS, deadlineView, doc, player, preview, rosterTeam, tally, trade } from './trades.fixtures'

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
function render(element: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client }, element)))
}
const noop = () => {}
const fmt = (iso: string) => `[${iso}]`
const bravoManager = { teamId: BRAVO, isCommissioner: false, overrideMode: false, inSeason: true }
/** The league's answer as a stub (L.D3.12): before 162 is pushed the check is
 *  `unavailable`, and every D419 cell below renders exactly as it did. */
const beforePush: UseTradePreview = () => ({ state: 'unavailable', reason: 'not pushed' })

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
      usePreview: beforePush,
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
      usePreview: beforePush,
      ...over,
    }),
  )
}

function builder(over: Partial<TradeBuilderViewProps> = {}): string {
  return render(
    createElement(TradeBuilderView, {
      leagueId: LEAGUE,
      usePreview: beforePush,
      mode: 'propose',
      teams: TEAMS,
      fromTeamId: ALPHA,
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
    expect(center({ deadlineRefusal: refused })).toContain('🔒 The trade deadline has passed — trades closed when week 12 began (Wed, Nov 25 12:00 AM ET).') // D482: the member's copy
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
    expect(ops(card({ viewer: { teamId: ALPHA, isCommissioner: false, overrideMode: false, inSeason: true } }))).toEqual(['cancel'])
  })
  it('a bystander: no buttons', () => {
    expect(ops(card({ viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false, inSeason: true } }))).toEqual([])
  })
  it('the server’s refusal renders VERBATIM on the card', () => {
    const refusal = 'only the team that received a trade can accept it — you proposed this one, so cancel it instead'
    expect(card({ refusal })).toContain('data-trade-card-refusal="true">Only the team that got this offer can accept or reject it — you can cancel it instead.') // D482
  })
  it('E36: the server says the receiving roster overflows → the drop picker opens with the count, the sentence verbatim', () => {
    const refusal = "Bravo's roster would hold 17 players after this trade — 1 more than its 16 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)"
    const html = card({ refusal })
    expect(html).toContain('data-accept-drops')
    // D482: the phrase map's sentence, no builder citations.
    expect(html).toContain('Bravo would be 1 over the roster limit — pick 1 more player to drop.')
    expect(html).not.toContain('(E36)')
    expect(html).not.toContain('roster_size')
    expect(html).toContain('Pick 1 player to drop so your roster fits — he is dropped only if the trade goes through.')
    // The players Bravo is giving away are not offered as drops.
    const picker = html.slice(html.indexOf('data-drop-picker'))
    expect(picker).not.toContain('data-trade-pick="p-b1"')
    expect(picker).toContain('data-trade-pick="p-b3"')
    expect(html).toContain('data-accept-with-drops')
  })
  it('174 fix round 2 (R1413): an offer FROM a team with no manager — the receiving manager can accept or turn it down, but there is no Counter', () => {
    const unmanaged = (teamId: string) => {
      const t = TEAMS.find((x) => x.team_id === teamId) ?? null
      return t && t.team_id === ALPHA ? { ...t, manager_user_id: null } : t
    }
    expect(ops(card({ rosterOf: unmanaged }))).toEqual(['accept', 'accept-drops', 'reject'])
    // The rosters not read yet: no Counter either (unknown counts as no).
    expect(ops(card({ rosterOf: () => null }))).not.toContain('counter')
  })
  it('174 fix round 2 (R1414): outside in_season / playoffs the receiving manager sees only Turn down, the proposer Call off', () => {
    expect(ops(card({ viewer: { teamId: BRAVO, isCommissioner: false, overrideMode: false, inSeason: false } }))).toEqual(['reject'])
    expect(ops(card({ viewer: { teamId: ALPHA, isCommissioner: false, overrideMode: false, inSeason: false } }))).toEqual(['cancel'])
  })
  it('an offer is the two teams own: the commissioner, override mode on, has no button on it — no answering for a team, no force (174 / D463)', () => {
    const html = card({ viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } })
    expect(ops(html)).toEqual([])
    expect(html).not.toContain('Accept for')
    expect(html).not.toContain('data-trade-override')
  })
})

describe('trade card — under review', () => {
  const commishReview = trade({ status: 'in_review', review: { mode: 'commissioner', ends_at: '2099-09-15T15:00:00.000Z', ms_remaining: 19 * 3_600_000 } })
  it('the countdown from the read (never a clock); the commissioner’s Approve / Veto without override mode', () => {
    const html = card({ trade: commishReview, viewer: { teamId: null, isCommissioner: true, overrideMode: false, inSeason: true } })
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
    const html = card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false, inSeason: true } })
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
    expect(ops(card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false, inSeason: true } }))).toEqual([])
  })
  it('the voter’s own vote disables that button and is said', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally({ my_vote: 'veto' }) })
    const html = card({ trade: t, viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false, inSeason: true } })
    expect(html).toContain('You voted to veto.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-trade-op="vote-veto"/)
  })
  it('174 fix round 2 (R1414): outside in_season / playoffs the commissioner has no tool on a trade in review, override mode or not', () => {
    for (const overrideMode of [false, true]) {
      const html = card({ trade: commishReview, viewer: { teamId: null, isCommissioner: true, overrideMode, inSeason: false } })
      expect(ops(html), `override ${overrideMode}`).toEqual([])
      expect(html).not.toContain('data-trade-override')
    }
  })
  it('the commissioner overrides a league vote only in override mode', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally({ can_vote: false, cannot_vote_because: 'no_team' }) })
    expect(ops(card({ trade: t, viewer: { teamId: null, isCommissioner: true, overrideMode: false, inSeason: true } }))).toEqual([])
    expect(ops(card({ trade: t, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } }))).toEqual(['approve', 'veto', 'force'])
  })
  it('override mode is said only by the league header indicator — no badge on the card (D489)', () => {
    const t = trade({ status: 'in_review', review: { mode: 'league_vote', ends_at: null, ms_remaining: null }, tally: tally({ can_vote: false, cannot_vote_because: 'no_team' }) })
    const html = card({ trade: t, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } })
    expect(html).toContain('data-trade-override')
    expect(html).not.toContain('Override')
    expect(html).not.toContain('bg-brand')
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
  it('174 fix round 2 (R1414): a trade waiting for the games carries Veto / Force in season, nothing once the league is out of season', () => {
    const waiting = trade({ status: 'accepted', deferred: { until: null, ms_remaining: null } })
    expect(ops(card({ trade: waiting, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } }))).toEqual(['veto', 'force'])
    expect(ops(card({ trade: waiting, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: false } }))).toEqual([])
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
  it('a completed trade stands: no Reverse, even in override mode (174 — “Remove reverse”); the 🔒 is not shown on history', () => {
    const done = trade({ status: 'complete', in_flight: false, resolved_at: '2099-09-15T00:00:00.000Z' })
    expect(ops(card({ trade: done, viewer: { teamId: null, isCommissioner: true, overrideMode: false, inSeason: true } }))).toEqual([])
    expect(ops(card({ trade: done, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } }))).toEqual([])
    const expired = trade({ status: 'expired', in_flight: false })
    expect(ops(card({ trade: expired, viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true } }))).toEqual([])
    expect(card({ trade: done, lockedIds: new Set(['p-a1']) })).not.toContain('data-lock')
  })
  it('F451: the commissioner’s answer in words — what he stood outside, named', () => {
    const result = { outcome: 'forced', bypassed: ['review_period', 'game_day_lock:p-a1'], no_changes_why: null, score_stale: false } as unknown as CommishTradeResult
    const html = card({ trade: trade({ status: 'complete', in_flight: false }), commishResult: result })
    expect(html).toContain('data-commish-trade-outcome="forced"')
    expect(html).toContain('Forced through — past the rest of the review period and Andy One’s game-day lock.')
  })
})

describe('§10.4 — force confirms with before → after (the one confirmation since 174 removed reverse)', () => {
  it('force', () => {
    const html = render(createElement(CommishConfirm, { trade: trade({ status: 'in_review' }), pending: false, onConfirm: noop, onCancel: noop }))
    expect(html).toContain('data-commish-confirm="force"')
    expect(html).toContain('Andy One: Alpha → Bravo')
    expect(html).toContain('Ben One: Bravo → Alpha')
    expect(html).toContain('data-commish-confirm-go')
    expect(html).toContain('Force it through')
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
    expect(bo).toContain('data-lock-tag')
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
    expect(html).toContain('Alpha would be 1 over the roster limit — pick 1 more player to drop.') // D482: the phrase map
    expect(html).not.toContain("(E36)")
    expect(html).toContain('data-trade-drops="open"')
    expect(html).toContain('data-trade-drops-prompt="1"')
    expect(html).toContain('Pick 1 player to drop so your roster fits')
  })
  it('F452: a deadline refusal locks the builder with the server’s sentence — Send off', () => {
    const refusal = 'the trade deadline has passed — trades could be proposed until week 12 began (Wed, Nov 25 12:00 AM ET; trade_deadline_week 11, §13.3 / Q76)'
    const html = builder({ refusal })
    expect(html).toContain('data-trade-deadline-locked')
    expect(html).toContain('The trade deadline has passed — trades closed when week 12 began (Wed, Nov 25 12:00 AM ET).') // D482
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
  it('the offering team is fixed — the viewer’s own; there is no chooser to offer for another team (174 / D463)', () => {
    const html = builder()
    expect(html).toContain('data-trade-from="' + ALPHA + '"')
    expect(html).not.toContain('acting as commissioner')
  })
  it('174 fix round (R1410): a deep link toward a team with NO manager opens with nobody picked and says why — no offer to it can be built', () => {
    const teams = TEAMS.map((t) => (t.team_id === BRAVO ? { ...t, manager_user_id: null } : t))
    const html = builder({ teams })
    expect(html).toContain(`data-trade-no-manager="${BRAVO}"`)
    expect(html).toContain(noManagerCopy('Bravo'))
    expect(html).toContain('data-trade-to=""')
    expect(html).not.toMatch(/data-trade-pick="p-b1" data-picked="true"/)
    expect(html).toContain('Pick a team to see its roster.')
    expect(sendOff(html)).toBe(true)
  })
  it('174 fix round (R1410): when no other team has a manager, the builder says so in words — no team list, no dead Send', () => {
    const teams = TEAMS.map((t) => (t.team_id === ALPHA ? t : { ...t, manager_user_id: null }))
    const html = builder({ teams, initial: undefined })
    expect(html).toContain('data-trade-builder="no-partner"')
    expect(html).toContain(NO_TRADE_PARTNER_COPY)
    expect(html).not.toContain('data-trade-send')
    expect(html).not.toContain('data-trade-to')
  })
  it('…a counter-offer keeps its fixed partner — the proposer (the card offers Counter only toward a proposer with a manager, R1413)', () => {
    const html = builder({ mode: 'counter', fromTeamId: BRAVO, initial: { toTeamId: ALPHA, give: ['p-b1'], get: ['p-a1'] } })
    expect(html).toContain('Counter-offer to Alpha')
    expect(html).not.toContain('data-trade-builder="no-partner"')
  })
  it('L.E1.36 fix round (R1419): while the rosters load the builder’s door is a skeleton; a failed read is an error with Retry — never the “no partner” sentence', () => {
    const loading = render(createElement(BuilderRostersWait, { state: 'loading', error: null, onRetry: () => {} }))
    expect(loading).toContain('data-skeleton="trade-builder"')
    expect(loading).not.toContain(NO_TRADE_PARTNER_COPY)
    const failed = render(createElement(BuilderRostersWait, { state: 'error', error: new Error('rosters read failed (503)'), onRetry: () => {} }))
    expect(failed).toContain('data-trade-builder="rosters-error"')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain(BUILDER_ROSTERS_ERROR_TITLE)
    expect(failed).toContain('rosters read failed (503)')
    expect(failed).toContain('Retry')
    expect(failed).not.toContain(NO_TRADE_PARTNER_COPY)
  })
  it('sent: says who gets it and where it is listed', () => {
    const html = builder({ sentTo: 'Bravo' })
    expect(html).toContain('data-trade-builder="sent"')
    expect(html).toContain('Offer sent to Bravo.')
  })
})

// ---------------------------------------------------------------------------
// L.D3.12 — the trade screen never lets a manager build an offer the league
// would refuse (Chris 2026-09-29). The league's answer is migration 162's
// `trade_preview` / `trade_deadline`; here it is handed in as a stub.
// ---------------------------------------------------------------------------

const answer = (p: TradePreview): UseTradePreview => () => ({ state: 'ready', preview: p })
const checking: UseTradePreview = () => ({ state: 'checking', last: null })
/** Records every draft the builder / card asks the league about. */
function recorder(state: TradePreviewState = { state: 'unavailable', reason: 'x' }) {
  const drafts: Array<TradePreviewDraft | null> = []
  const hook: UseTradePreview = (_leagueId, draft) => {
    drafts.push(draft)
    return draft === null ? { state: 'off' } : state
  }
  return { hook, drafts }
}
const sendOff = (html: string) => /<button[^>]*disabled=""[^>]*data-trade-send/.test(html)
const gateOf = (html: string) => /data-trade-gate="([a-z]+)"/.exec(html)?.[1]
const rowOf = (html: string, id: string) => html.slice(html.indexOf(`data-trade-pick="${id}"`), html.indexOf('</li>', html.indexOf(`data-trade-pick="${id}"`)))

describe('L.D3.12 — the deadline is the server’s instant (F452)', () => {
  it('before it: the date and time it closes, in words', () => {
    const html = center({ deadline: { state: 'known', view: deadlineView() } })
    expect(html).toContain('Trade deadline: [2099-11-18T05:00:00.000Z], when Week 12 begins — offers can be made and accepted until then.')
    expect(html).toContain('data-trade-deadline-at="2099-11-18T05:00:00.000Z"')
    expect(html).not.toContain('data-trade-deadline-passed')
  })
  it('past it: said plainly with the date — and a waiting offer can’t be accepted or countered (Turn down stays)', () => {
    const view = deadlineView({ passed: true, ms_remaining: null })
    const html = center({ deadline: { state: 'known', view }, doc: doc([trade()]) })
    expect(html).toContain('The trade deadline has passed — trades closed [2099-11-18T05:00:00.000Z], when Week 12 began.')
    expect(html).toContain('data-trade-deadline-passed="true"')
    expect(html).toContain('data-accept-gate="blocked"')
    expect(html).toContain('The trade deadline passed on [2099-11-18T05:00:00.000Z] — this offer can’t be accepted or countered now.')
    expect(ops(html)).toStrictEqual(['reject'])
  })
  it('past it, the league is not even asked about accepting', () => {
    const rec = recorder()
    card({ deadline: deadlineView({ passed: true }), usePreview: rec.hook })
    expect(rec.drafts).toStrictEqual([null])
  })
  it('before 162 is pushed (unavailable) or while loading: the week-only line, as before', () => {
    expect(center({ deadline: { state: 'unavailable', reason: 'x' } })).toContain('Trade deadline: Week 11 — offers can be made and accepted until Week 12 begins.')
    expect(center({ deadline: null })).toContain('Trade deadline: Week 11 — offers can be made and accepted until Week 12 begins.')
  })
})

describe('L.D3.12 — the builder: Send only when the league would take it', () => {
  it('asks the league about exactly the offer on screen (the legs and the drops)', () => {
    const rec = recorder()
    builder({ usePreview: rec.hook, initial: { toTeamId: BRAVO, give: ['p-a1'], get: ['p-b1'], drops: ['p-a2'] } })
    expect(rec.drafts.at(-1)).toStrictEqual({
      kind: 'offer',
      fromTeamId: ALPHA,
      toTeamId: BRAVO,
      legs: [
        { playerId: 'p-a1', fromTeamId: ALPHA },
        { playerId: 'p-b1', fromTeamId: BRAVO },
      ],
      drops: ['p-a2'],
    })
  })
  it('the offering roster would be over → the drop picker opens with how many more, and Send stays off', () => {
    const html = builder({ usePreview: answer(preview({ ok: false }, { proposer: { count_after: 4, must_drop: 1 } })) })
    expect(html).toContain('data-trade-drops="open"')
    expect(html).toContain('data-trade-drops-prompt="1"')
    expect(html).toContain('Your roster would be over its size — pick 1 more player to drop. He is dropped only if the trade goes through.')
    expect(sendOff(html)).toBe(true)
    expect(gateOf(html)).toBe('blocked')
    expect(html).toContain('Pick 1 more player to drop so your roster fits.')
  })
  it('…needing two, it says two', () => {
    const html = builder({ usePreview: answer(preview({ ok: false }, { proposer: { must_drop: 2 } })) })
    expect(html).toContain('data-trade-drops-prompt="2"')
    expect(html).toContain('pick 2 more players to drop. They are dropped')
  })
  it('once enough drops are picked the league says ok → Send is on; the other team’s overflow is said (it picks at accept)', () => {
    const html = builder({
      initial: { toTeamId: BRAVO, get: ['p-b1'], drops: ['p-a2'] },
      usePreview: answer(preview({}, { proposer: { drops: 1, must_drop: 0 }, recipient: { count_after: 4, must_drop: 1 } })),
    })
    expect(sendOff(html)).toBe(false)
    expect(gateOf(html)).toBe('ok')
    expect(html).toMatch(/data-trade-pick="p-a2" data-picked="true"/)
    expect(html).toContain('Both rosters fit and the league will take this offer. Bravo would be 1 over, so they’ll pick a player to drop when they accept.')
  })
  it('a refusal the league would give (exclusivity, one-sided, FAAB) is the reason Send is off — in plain words', () => {
    const refusal = 'trade_preview: Alpha gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB'
    const html = builder({ usePreview: answer(preview({ ok: false, refusal, rosters: null })) })
    expect(sendOff(html)).toBe(true)
    expect(html).toContain('Alpha has to give at least one player or FAAB in this trade.') // D482
    expect(html).not.toContain('trade_preview:')
    expect(html).not.toContain('§7.3.5')
  })
  it('while the league is checking the newest picks, Send waits', () => {
    const html = builder({ usePreview: checking })
    expect(sendOff(html)).toBe(true)
    expect(gateOf(html)).toBe('checking')
    expect(html).toContain('Checking the offer with the league…')
  })
  it('FAAB above what the team has: refused on the spot, and the league is not asked', () => {
    const rec = recorder({ state: 'ready', preview: preview() })
    const teams = [rosterTeam(ALPHA, 'Alpha', TEAMS[0].roster, { faab_balance: 40 }), ...TEAMS.slice(1)]
    const html = builder({ allowFaab: true, teams, usePreview: rec.hook, initial: { toTeamId: BRAVO, get: ['p-b1'], faabGive: 41 } })
    expect(sendOff(html)).toBe(true)
    expect(html).toContain('Alpha has $40 of FAAB — offer $40 or less.')
    expect(html).toContain('data-faab-over="true"')
    expect(rec.drafts.every((d) => d === null)).toBe(true)
  })
  it('…exactly the balance is fine (the league then checks it)', () => {
    const rec = recorder({ state: 'ready', preview: preview() })
    const teams = [rosterTeam(ALPHA, 'Alpha', TEAMS[0].roster, { faab_balance: 40 }), ...TEAMS.slice(1)]
    const html = builder({ allowFaab: true, teams, usePreview: rec.hook, initial: { toTeamId: BRAVO, get: ['p-b1'], faabGive: 40 } })
    expect(html).not.toContain('data-faab-over')
    expect(rec.drafts.at(-1)).toMatchObject({ kind: 'offer', legs: [{ playerId: 'p-b1', fromTeamId: BRAVO }, { faabAmount: 40, fromTeamId: ALPHA }] })
  })
  it('R1283 — Q75 `reject`: a started player is still pickable (the lock is judged when the trade goes through); picked, his row says it can’t go through until the week’s games are over', () => {
    const rec = recorder()
    const html = builder({ lockBehavior: 'reject', usePreview: rec.hook, initial: { toTeamId: BRAVO, get: ['p-b2'] } })
    const bo = rowOf(html, 'p-b2')
    expect(bo).toContain('data-picked="true"')
    expect(bo).not.toContain('disabled=""')
    expect(bo).toContain('data-lock-note="reject"')
    expect(bo).toContain('this league won’t let a trade with him go through until the week’s games are over.')
    expect(rec.drafts.at(-1)).toMatchObject({ kind: 'offer', legs: [{ playerId: 'p-b2', fromTeamId: BRAVO }] })
  })
  it('Q75 `defer`: he stays pickable — picked, his row says the trade waits for the week’s last game; unpicked, only the 🔒', () => {
    const bo = rowOf(builder({ lockBehavior: 'defer', initial: { toTeamId: BRAVO, get: ['p-b2'] } }), 'p-b2')
    expect(bo).toContain('data-picked="true"')
    expect(bo).toContain('data-lock-note="defer"')
    const unpicked = rowOf(builder({ lockBehavior: 'defer' }), 'p-b2')
    expect(unpicked).toContain('data-lock-tag')
    expect(unpicked).not.toContain('data-lock-note')
  })
  it('R1286: the voluntary “Drop players…” opener stays even when the league says no drop is needed', () => {
    const html = builder({ usePreview: answer(preview()) })
    expect(html).toContain('data-trade-drops="closed"')
    expect(html).toContain('data-trade-drops-open')
    expect(gateOf(html)).toBe('ok')
  })
  it('R1282: the check FAILED (not the 503) → said on screen as a failed check, Send still works (the league checks on send)', () => {
    const html = builder({ usePreview: () => ({ state: 'failed', reason: 'boom' }) })
    expect(gateOf(html)).toBe('failed')
    expect(html).toContain('Couldn’t check this offer with the league just now — it will still be checked when you send it.')
    expect(html).not.toContain('The league checks both rosters, the deadline and any FAAB when you send')
    expect(sendOff(html)).toBe(false)
  })
  it('before 162 (unavailable): Send works as it did, with the send-and-see line and the optional drop opener', () => {
    const html = builder()
    expect(sendOff(html)).toBe(false)
    expect(gateOf(html)).toBe('unchecked')
    expect(html).toContain('The league checks both rosters, the deadline and any FAAB when you send — its answer is what you see.')
    expect(html).toContain('data-trade-drops-open')
  })
})

describe('L.D3.12 — accepting: the drop picker is part of accepting', () => {
  const acceptAnswer = (over: Parameters<typeof preview>[0] = {}, sides: Parameters<typeof preview>[1] = {}) =>
    answer(preview({ mode: 'accept', trade_id: 'tr-1', ...over }, sides))

  it('the receiving roster fits → a plain Accept, on — and the voluntary “Accept with drops…” stays (R1286)', () => {
    const html = card({ usePreview: acceptAnswer() })
    expect(ops(html)).toStrictEqual(['accept', 'accept-drops', 'counter', 'reject'])
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-trade-op="accept"/)
    expect(html).not.toContain('data-accept-drops')
  })
  it('it would be over → the picker is open before anything is pressed, with the count; Accept waits for the drops', () => {
    const html = card({ usePreview: acceptAnswer({ ok: false }, { recipient: { enforced: true, count_after: 4, must_drop: 1 } }) })
    expect(html).toContain('data-accept-drops="true"')
    expect(html).toContain('data-accept-must-drop="1"')
    expect(html).toContain('Your roster would be over its size — pick 1 more player to drop.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-accept-with-drops/)
    expect(ops(html)).toStrictEqual(['counter', 'reject'])
    // Bravo gives Ben One, so he is not offered as a drop; Bo Two (started) is, under `defer`.
    const picker = html.slice(html.indexOf('data-drop-picker'))
    expect(picker).not.toContain('data-trade-pick="p-b1"')
    expect(picker).toContain('data-trade-pick="p-b2"')
  })
  it('the league is asked about THIS offer with the drops picked so far', () => {
    const rec = recorder()
    card({ usePreview: rec.hook })
    expect(rec.drafts).toStrictEqual([{ kind: 'accept', tradeId: 'tr-1', drops: [] }])
  })
  it('R1283 — Q75 `reject`: a started player is pickable as a drop too (the 🔒 says what will happen)', () => {
    const html = card({ lockBehavior: 'reject', usePreview: acceptAnswer({ ok: false }, { recipient: { must_drop: 1 } }) })
    const bo = rowOf(html.slice(html.indexOf('data-drop-picker')), 'p-b2')
    expect(bo).toContain('data-lock-tag')
    expect(bo).not.toContain('disabled=""')
  })
  it('R1282: the accept check FAILED → the card says so, with the D419 buttons (the league checks on accept)', () => {
    const html = card({ usePreview: () => ({ state: 'failed', reason: 'boom' }) })
    expect(html).toContain('data-accept-gate="failed"')
    expect(html).toContain('Couldn’t check this trade with the league just now — it will still be checked when you accept.')
    expect(ops(html)).toStrictEqual(['accept', 'accept-drops', 'counter', 'reject'])
  })
  it('F414: the offering team no longer fits (it added players) → Accept is off, and why — only they can fix it', () => {
    const html = card({ usePreview: acceptAnswer({ ok: false }, { proposer: { must_drop: 1 } }) })
    expect(html).toContain('data-accept-gate="blocked"')
    expect(html).toContain('This offer no longer fits Alpha’s roster — they’ve added players since sending it. Ask them to call it off and send a new one.')
    expect(ops(html)).toStrictEqual(['counter', 'reject'])
  })
  it('a refusal the league would give (a FAAB amount the giver no longer has) → Accept off, in plain words', () => {
    const html = card({ usePreview: acceptAnswer({ ok: false, refusal: 'trade_preview: Alpha cannot give $60 of FAAB — its balance is $50 (§13.3)', rosters: null }) })
    expect(html).toContain('Alpha cannot give $60 of FAAB — its balance is $50')
    expect(html).not.toContain('§13.3')
    expect(ops(html)).toStrictEqual(['counter', 'reject'])
  })
  it('Q75 `reject` with no review: a player in it already played → Accept off until the week’s games are over', () => {
    const html = card({ lockBehavior: 'reject', review: 'none', lockedIds: new Set(['p-b1']), usePreview: acceptAnswer() })
    expect(html).toContain('Ben One has already played this week — this league doesn’t let a trade go through until the week’s games are over. You can accept once they are.')
    expect(ops(html)).toStrictEqual(['counter', 'reject'])
  })
  it('…under `defer` it just waits — Accept stays on', () => {
    const html = card({ lockBehavior: 'defer', review: 'none', lockedIds: new Set(['p-b1']), usePreview: acceptAnswer() })
    expect(ops(html)).toStrictEqual(['accept', 'accept-drops', 'counter', 'reject'])
  })
  it('while the league checks: Accept is shown but off', () => {
    const html = card({ usePreview: checking })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-trade-op="accept"/)
    expect(html).toContain('Checking the offer with the league…')
  })
  it('the proposer and a bystander ask nothing', () => {
    const rec = recorder()
    card({ viewer: { teamId: ALPHA, isCommissioner: false, overrideMode: false, inSeason: true }, usePreview: rec.hook })
    card({ viewer: { teamId: CHARLIE, isCommissioner: false, overrideMode: false, inSeason: true }, usePreview: rec.hook })
    expect(rec.drafts.every((d) => d === null)).toBe(true)
  })
  it('the commissioner (override mode on) asks nothing either and gets no Accept — the offer is the two teams own (174 / D463)', () => {
    const rec = recorder()
    const html = card({ viewer: { teamId: null, isCommissioner: true, overrideMode: true, inSeason: true }, usePreview: rec.hook })
    expect(rec.drafts.every((d) => d === null)).toBe(true)
    expect(html).not.toContain('data-accept-with-drops')
    expect(ops(html)).toEqual([])
  })
})
