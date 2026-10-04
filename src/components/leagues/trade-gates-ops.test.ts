/**
 * trade-gates-ops.test.ts — M5 L.D3.12 (PROGRESS D426; spec §13.3, §16.2;
 * Chris 2026-09-29: "there is no such thing as trade that isn't legal"):
 * which buttons work and why, from migration 162's two reads — the
 * deadline (`trade_deadline`, F452) and the legality preview
 * (`trade_preview`, F462) — plus the hooks' pure halves.
 *
 * The server's sentences are STORED LITERALS — exactly what pgTAP 110 pins
 * the preview raising (C6 / C9 / D4 / D11), so a re-worded refusal on either
 * side reds a cell here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TRADE_DEADLINE_MAX_REFETCH_MS,
  fetchTradeDeadline,
  tradeDeadlinePassed,
  tradeDeadlineRefetchInterval,
  tradeDeadlineUrl,
} from '@/hooks/use-trade-deadline'
import { TRADE_PREVIEW_NO_REASON, fetchTradePreview, tradePreviewBody, tradePreviewState, type TradePreviewState } from '@/hooks/use-trade-preview'

import {
  ACCEPT_CHECK_FAILED_COPY,
  NOT_IN_SEASON_TRADE_COPY,
  PREVIEW_FAILED_COPY,
  PREVIEW_CHECKING_COPY,
  SEND_AND_SEE_COPY,
  acceptGate,
  builderGate,
  deadlinePassedCopy,
  dropsNeededCopy,
  faabOverBalance,
  faabOverCopy,
  lockedAssetTitle,
  offerPastDeadlineCopy,
  previewRefusalCopy,
  rosterWords,
  tradeDeadlineLine,
} from './trades-ops'
import { ALPHA, BRAVO, deadlineView, preview } from './trades.fixtures'

const fmt = (iso: string) => `<${iso}>`
const ready = (p = preview()): TradePreviewState => ({ state: 'ready', preview: p })

// pgTAP 110's pinned sentences (the preview's own prefix).
const FAAB_OVER = 'trade_preview: P Alpha cannot give $60 of FAAB — its balance is $50 (§13.3)'
const ONE_SIDED =
  'trade_preview: Q Echo gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB'
const ALREADY_LEAVING = 'trade_preview: P B One (pv-b1) is already leaving P Bravo in this trade — he cannot also be one of its drops'
const ANSWERED = 'trade_preview: this trade is already in_review — only an offer still waiting for an answer can be accepted'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the deadline line (F452) — from the server’s instant, never a clock', () => {
  it('before / past / none / the last week / not readable', () => {
    expect(tradeDeadlineLine(11, deadlineView(), fmt)).toBe(
      'Trade deadline: <2099-11-18T05:00:00.000Z>, when Week 12 begins — offers can be made and accepted until then.',
    )
    expect(tradeDeadlineLine(11, deadlineView({ passed: true }), fmt)).toBe(
      'The trade deadline has passed — trades closed <2099-11-18T05:00:00.000Z>, when Week 12 began.',
    )
    expect(tradeDeadlineLine(null, deadlineView({ deadline_week: null, deadline_at: null, why: 'no_deadline' }), fmt)).toBe(
      'No trade deadline — trades are allowed all season.',
    )
    expect(tradeDeadlineLine(18, deadlineView({ deadline_week: 18, deadline_at: null, why: 'after_last_calendar_week' }), fmt)).toBe(
      'Trade deadline: Week 18 — that’s the last week, so trades are allowed all season.',
    )
    expect(tradeDeadlineLine(11, null, fmt)).toBe('Trade deadline: Week 11 — offers can be made and accepted until Week 12 begins.')
  })
  it('the closed-door words carry the date', () => {
    const v = deadlineView({ passed: true })
    expect(deadlinePassedCopy(v, fmt)).toBe(
      'The trade deadline passed on <2099-11-18T05:00:00.000Z>, when Week 12 began. Offers can’t be made, accepted or countered now — the commissioner can still move players.',
    )
    expect(offerPastDeadlineCopy(v, fmt)).toBe(
      'The trade deadline passed on <2099-11-18T05:00:00.000Z> — this offer can’t be accepted or countered now. It expires on its own; you can still turn it down.',
    )
  })
})

describe('the pickers — Q75 and FAAB', () => {
  it('R1283: a started player’s 🔒 says what WILL happen under the league’s rule — never a ban (the lock is judged when the trade goes through)', () => {
    expect(lockedAssetTitle('defer')).toBe('His game has started this week — a trade with him waits and goes through right after the week’s last game ends.')
    expect(lockedAssetTitle('reject')).toBe('His game has started this week — this league won’t let a trade with him go through until the week’s games are over.')
  })
  it('FAAB over the balance: one dollar over is over, the balance itself is not; blank / not-a-number / unknown balance never', () => {
    expect(faabOverBalance(51, 50)).toBe(true)
    expect(faabOverBalance(50, 50)).toBe(false)
    expect(faabOverBalance(null, 50)).toBe(false)
    expect(faabOverBalance(Number.NaN, 50)).toBe(false)
    expect(faabOverBalance(10, null)).toBe(false)
    expect(faabOverCopy('Alpha', 50)).toBe('Alpha has $50 of FAAB — offer $50 or less.')
  })
  it('the refusal as a member reads it: the raiser’s prefix and every citation out, the words kept', () => {
    expect(previewRefusalCopy(FAAB_OVER)).toBe('P Alpha cannot give $60 of FAAB — its balance is $50')
    expect(previewRefusalCopy(ONE_SIDED)).toBe(
      'Q Echo has to give at least one player or FAAB in this trade.', // D481: the phrase map
    )
    expect(previewRefusalCopy(ALREADY_LEAVING)).toBe('P B One (pv-b1) is already leaving P Bravo in this trade — he cannot also be one of its drops')
  })
  it('whose drops, said plainly', () => {
    expect(rosterWords('Alpha', true)).toBe('your roster')
    expect(rosterWords('Alpha', false)).toBe('Alpha’s roster')
    expect(dropsNeededCopy(1, 'your roster')).toBe('Your roster would be over its size — pick 1 more player to drop. He is dropped only if the trade goes through.')
    expect(dropsNeededCopy(3, 'Alpha’s roster')).toBe('Alpha’s roster would be over its size — pick 3 more players to drop. They are dropped only if the trade goes through.')
  })
})

describe('builderGate — Send only when the league would take the offer', () => {
  const base = { problem: null, faabProblem: null, fromWords: 'your roster', toName: 'Bravo' }
  it('the builder’s own advice comes first, and nothing is checked for it', () => {
    expect(builderGate({ ...base, problem: 'Pick the team you want to trade with.', preview: ready() })).toMatchObject({ canSend: false, reason: 'Pick the team you want to trade with.', checked: false })
    expect(builderGate({ ...base, faabProblem: 'Alpha has $50 of FAAB — offer $50 or less.', preview: ready() })).toMatchObject({ canSend: false, checked: false })
  })
  it('before 162 (unavailable): Send is on and the server’s answer is what you see', () => {
    expect(builderGate({ ...base, preview: { state: 'unavailable', reason: 'x' } })).toStrictEqual({ canSend: true, reason: SEND_AND_SEE_COPY, mustDrop: 0, recipientMustDrop: 0, checked: false })
  })
  it('R1282: the check itself FAILED (not the 503): Send stays on (the verb decides) but it is said — never the before-162 line', () => {
    const g = builderGate({ ...base, preview: { state: 'failed', reason: 'boom' } })
    expect(g).toStrictEqual({ canSend: true, reason: PREVIEW_FAILED_COPY, mustDrop: 0, recipientMustDrop: 0, checked: false, failed: true })
    expect(g.reason).not.toBe(SEND_AND_SEE_COPY)
  })
  it('checking: off, but the last answer’s counts stay on screen', () => {
    const last = preview({ ok: false }, { proposer: { must_drop: 2 } })
    expect(builderGate({ ...base, preview: { state: 'checking', last } })).toStrictEqual({ canSend: false, reason: PREVIEW_CHECKING_COPY, mustDrop: 2, recipientMustDrop: 0, checked: true })
  })
  it('out of season / past the deadline / a refusal / drops still needed — each off, with its reason', () => {
    expect(builderGate({ ...base, preview: ready(preview({ ok: false, in_season: false })) }).reason).toBe(NOT_IN_SEASON_TRADE_COPY)
    expect(builderGate({ ...base, preview: ready(preview({ ok: false, deadline: deadlineView({ passed: true }) })) }).reason).toBe('The trade deadline has passed — offers can’t be made now.')
    expect(builderGate({ ...base, preview: ready(preview({ ok: false, refusal: FAAB_OVER, rosters: null })) })).toMatchObject({ canSend: false, reason: 'P Alpha cannot give $60 of FAAB — its balance is $50' })
    expect(builderGate({ ...base, preview: ready(preview({ ok: false }, { proposer: { must_drop: 1 } })) })).toMatchObject({ canSend: false, mustDrop: 1, reason: 'Pick 1 more player to drop so your roster fits.' })
  })
  it('ok: on; the other team’s overflow is said, not required of the offer', () => {
    expect(builderGate({ ...base, preview: ready() })).toMatchObject({ canSend: true, reason: 'Both rosters fit and the league will take this offer.' })
    expect(builderGate({ ...base, preview: ready(preview({}, { recipient: { must_drop: 2 } })) })).toMatchObject({
      canSend: true,
      recipientMustDrop: 2,
      reason: 'Both rosters fit and the league will take this offer. Bravo would be 2 over, so they’ll pick 2 players to drop when they accept.',
    })
  })
  it('the league’s `ok` is the last word — never on when it says no, even with nothing else wrong', () => {
    expect(builderGate({ ...base, preview: ready(preview({ ok: false })) }).canSend).toBe(false)
  })
})

describe('acceptGate — the drop picker is part of accepting', () => {
  const base = { deadline: null, lockBehavior: 'defer', review: 'commissioner', lockedNames: [] as string[], proposerName: 'Alpha', fmt }
  const accept = (over: Parameters<typeof preview>[0] = {}, sides: Parameters<typeof preview>[1] = {}) => ready(preview({ mode: 'accept', trade_id: 'tr-1', ...over }, sides))
  it('before 162: the fallback (today’s Accept / Accept with drops)', () => {
    expect(acceptGate({ ...base, preview: { state: 'unavailable', reason: 'x' } })).toStrictEqual({ state: 'fallback', mustDrop: 0, reason: null, pastDeadline: false })
  })
  it('R1282: the check FAILED → its own state, said on the card (the verb still decides)', () => {
    expect(acceptGate({ ...base, preview: { state: 'failed', reason: 'boom' } })).toStrictEqual({ state: 'failed', mustDrop: 0, reason: ACCEPT_CHECK_FAILED_COPY, pastDeadline: false })
  })
  it('past the deadline — from the page’s deadline read or the preview’s own — blocked, Counter too', () => {
    expect(acceptGate({ ...base, deadline: deadlineView({ passed: true }), preview: { state: 'off' } })).toMatchObject({ state: 'blocked', pastDeadline: true })
    expect(acceptGate({ ...base, preview: accept({ ok: false, deadline: deadlineView({ passed: true }) }) })).toMatchObject({ state: 'blocked', pastDeadline: true })
  })
  it('Q75 `reject` + review `none` + a started player → blocked (the accept would run the trade and fail); other reviews / `defer` → not', () => {
    const lock = { ...base, lockBehavior: 'reject', review: 'none', lockedNames: ['Ben One', 'Bo Two'] }
    expect(acceptGate({ ...lock, preview: accept() })).toMatchObject({
      state: 'blocked',
      reason: 'Ben One, Bo Two have already played this week — this league doesn’t let a trade go through until the week’s games are over. You can accept once they are.',
    })
    expect(acceptGate({ ...lock, review: 'commissioner', preview: accept() }).state).toBe('ready')
    expect(acceptGate({ ...lock, lockBehavior: 'defer', preview: accept() }).state).toBe('ready')
  })
  it('the league’s answer: out of season / a refusal / F414 → blocked; the receiving team over → needs_drops (K); else ready', () => {
    expect(acceptGate({ ...base, preview: accept({ ok: false, in_season: false }) }).reason).toBe(NOT_IN_SEASON_TRADE_COPY)
    expect(acceptGate({ ...base, preview: accept({ ok: false, refusal: ANSWERED, rosters: null }) }).reason).toBe(
      'this trade is already in review — only an offer still waiting for an answer can be accepted',
    )
    expect(acceptGate({ ...base, preview: accept({ ok: false }, { proposer: { must_drop: 1 } }) }).reason).toBe(
      'This offer no longer fits Alpha’s roster — they’ve added players since sending it. Ask them to call it off and send a new one.',
    )
    expect(acceptGate({ ...base, preview: accept({ ok: false }, { recipient: { must_drop: 2 } }) })).toMatchObject({ state: 'needs_drops', mustDrop: 2 })
    expect(acceptGate({ ...base, preview: accept() })).toMatchObject({ state: 'ready', mustDrop: 0 })
  })
  it('checking keeps the last count (the picker stays open while the newest drops are checked)', () => {
    const last = preview({ mode: 'accept', ok: false }, { recipient: { must_drop: 1 } })
    expect(acceptGate({ ...base, preview: { state: 'checking', last } })).toMatchObject({ state: 'checking', mustDrop: 1 })
  })
})

describe('the hooks’ pure halves', () => {
  it('tradePreviewBody: the wire shapes; drops sorted so the tick order never changes the question', () => {
    expect(tradePreviewBody({ kind: 'accept', tradeId: 't1', drops: ['z', 'a'] })).toStrictEqual({ trade_id: 't1', drops: ['a', 'z'] })
    expect(tradePreviewBody({ kind: 'accept', tradeId: 't1', drops: [] })).toStrictEqual({ trade_id: 't1' })
    expect(
      tradePreviewBody({ kind: 'offer', fromTeamId: ALPHA, toTeamId: BRAVO, legs: [{ playerId: 'p1', fromTeamId: ALPHA }, { faabAmount: 5, fromTeamId: BRAVO }], drops: ['d2', 'd1'] }),
    ).toStrictEqual({ from_team_id: ALPHA, to_team_id: BRAVO, items: [{ player_id: 'p1', from_team_id: ALPHA }, { faab_amount: 5, from_team_id: BRAVO }], drops: ['d1', 'd2'] })
  })
  it('tradePreviewState: off / unavailable / checking while a newer draft waits or fetches / ready only when the answer is for THIS draft', () => {
    const answer = { kind: 'answer' as const, preview: preview() }
    const s = (over: Partial<Parameters<typeof tradePreviewState>[0]>) =>
      tradePreviewState({ key: 'k', settled: 'k', data: answer, isError: false, error: null, isFetching: false, isPlaceholderData: false, ...over })
    expect(s({ key: null })).toStrictEqual({ state: 'off' })
    expect(s({ data: { kind: 'unavailable', reason: 'not pushed' } })).toStrictEqual({ state: 'unavailable', reason: 'not pushed' })
    // R1282: only the named 503 is `unavailable`; any other failure is `failed`.
    expect(s({ isError: true, error: new Error('boom') })).toStrictEqual({ state: 'failed', reason: 'boom' })
    expect(s({ isError: true, error: null })).toStrictEqual({ state: 'failed', reason: TRADE_PREVIEW_NO_REASON })
    expect(s({ settled: 'older' })).toStrictEqual({ state: 'checking', last: answer.preview })
    expect(s({ isFetching: true })).toStrictEqual({ state: 'checking', last: answer.preview })
    expect(s({ isPlaceholderData: true })).toStrictEqual({ state: 'checking', last: answer.preview })
    expect(s({ data: undefined })).toStrictEqual({ state: 'checking', last: null })
    expect(s({})).toStrictEqual({ state: 'ready', preview: answer.preview })
  })
  it('the deadline read re-reads one second after the deadline (its own ms_remaining), capped; never after it passed', () => {
    const known = (over: Parameters<typeof deadlineView>[0]) => ({ state: 'known' as const, view: deadlineView(over) })
    expect(tradeDeadlineRefetchInterval(known({ ms_remaining: 5_000 }))).toBe(6_000)
    expect(tradeDeadlineRefetchInterval(known({ ms_remaining: 86_400_000 }))).toBe(TRADE_DEADLINE_MAX_REFETCH_MS)
    expect(tradeDeadlineRefetchInterval(known({ passed: true, ms_remaining: null }))).toBe(false)
    expect(tradeDeadlineRefetchInterval(known({ deadline_at: null, ms_remaining: null }))).toBe(false)
    expect(tradeDeadlineRefetchInterval({ state: 'unavailable', reason: 'x' })).toBe(false)
    expect(tradeDeadlineRefetchInterval(undefined)).toBe(false)
  })
  it('the doors close ONLY on the server’s own `passed` — loading, unavailable and not-yet all keep them', () => {
    expect(tradeDeadlinePassed({ state: 'known', view: deadlineView({ passed: true }) })).toBe(true)
    expect(tradeDeadlinePassed({ state: 'known', view: deadlineView() })).toBe(false)
    expect(tradeDeadlinePassed({ state: 'unavailable', reason: 'x' })).toBe(false)
    expect(tradeDeadlinePassed(undefined)).toBe(false)
    expect(tradeDeadlinePassed(null)).toBe(false)
  })
  it('the wire: the named 503 (162 not pushed) is `unavailable`, never an error; anything else still throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The trade deadline and the offer check aren’t available yet' }), { status: 503 })))
    await expect(fetchTradeDeadline('L')).resolves.toStrictEqual({ state: 'unavailable', reason: 'The trade deadline and the offer check aren’t available yet' })
    await expect(fetchTradePreview('L', { trade_id: 't' })).resolves.toStrictEqual({ kind: 'unavailable', reason: 'The trade deadline and the offer check aren’t available yet' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 403 })))
    await expect(fetchTradeDeadline('L')).rejects.toMatchObject({ status: 403 })
    // R1282: a 400 / 403 / 409 / 500 from the preview THROWS (→ `failed`), never `unavailable`.
    for (const status of [400, 403, 409, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status })))
      await expect(fetchTradePreview('L', { trade_id: 't' })).rejects.toMatchObject({ status })
    }
    const ok = vi.fn(async () => new Response(JSON.stringify(preview()), { status: 200 }))
    vi.stubGlobal('fetch', ok)
    await expect(fetchTradePreview('L', { trade_id: 't', drops: ['a'] })).resolves.toStrictEqual({ kind: 'answer', preview: preview() })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/leagues/L/trades/preview')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toStrictEqual({ trade_id: 't', drops: ['a'] })
    expect(tradeDeadlineUrl('L')).toBe('/api/leagues/L/trades/deadline')
  })
})
