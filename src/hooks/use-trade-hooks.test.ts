/**
 * use-trade-hooks.test.ts — the L.D3.6 trade hooks' contract, driven through
 * a REAL `QueryClient` + `MutationObserver` over each hook's options (the
 * `use-waiver-hooks.test.ts` posture: no DOM, no stack).
 *
 *   1. NOT retried — the client's mutation default is adversarial
 *      (`retry: 3`), so a failing call hitting the wire once proves the
 *      hook's own `retry: false`.
 *   2. NOT optimistic (§15.6 — never for trades): cached documents are
 *      untouched until the answer, and after a refusal.
 *   3. The wire: method, URL, body — one `action_id`, blanks dropped.
 *   4. Invalidation targets, with negative controls.
 *   5. F450: the trades query re-reads on a timer only while voting is open;
 *      the `trades` event (148) is the list's carrier.
 */
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TradesDocument } from '@/lib/leagues/api/trades-service'

import { commishLogKeys } from './use-commish-log'
import { commishTradeMutationOptions, commishTradeVariables } from './use-commish-trade'
import { LEAGUE_CHANNEL_EVENTS, tradesEventInvalidates } from './use-league-channel-ops'
import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { leaguesKeys } from './use-leagues'
import { teamLineupKeys } from './use-lineup'
import { leagueMatchupKeys } from './use-matchups'
import { proposeTradeMutationOptions, proposeTradeVariables } from './use-propose-trade'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'
import { tradeActionMutationOptions, tradeActionVariables } from './use-trade-action'
import { TRADE_TALLY_REFETCH_MS, tradeKeys, tradesRefetchInterval, tradesUrl } from './use-trades'
import { waiverClaimKeys } from './use-waiver-claims'

const LEAGUE = 'th000000-league'
const OTHER = 'th000000-other'
const TA = 'team-a'
const TB = 'team-b'

const DOC = { league_id: LEAGUE, trades: [] } as unknown as TradesDocument

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } } })
  client.setQueryData(tradeKeys.list(LEAGUE, 'all', null), DOC)
  client.setQueryData(tradeKeys.list(OTHER, 'all', null), DOC)
  for (const key of [
    leagueRosterKeys.all(LEAGUE),
    leaguePoolKeys.all(LEAGUE),
    teamLineupKeys.all(TA),
    teamLineupKeys.all(TB),
    leagueStandingsKeys.all(LEAGUE),
    leaguesKeys.detail(LEAGUE),
    waiverClaimKeys.all(LEAGUE),
    leagueActivityKeys.all(LEAGUE),
    commishLogKeys.all(LEAGUE),
    leagueMatchupKeys.all(LEAGUE),
    leagueRosterKeys.all(OTHER),
  ]) {
    client.setQueryData(key, { seeded: true })
  }
  return client
}

function stale(client: QueryClient, key: readonly unknown[]) {
  return client.getQueryState(key)?.isInvalidated === true
}

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

function sent(fetchMock: ReturnType<typeof respond>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown }
}

const MOVED = [leagueRosterKeys.all(LEAGUE), leaguePoolKeys.all(LEAGUE), teamLineupKeys.all(TA), teamLineupKeys.all(TB), leagueStandingsKeys.all(LEAGUE), leaguesKeys.detail(LEAGUE), waiverClaimKeys.all(LEAGUE), leagueActivityKeys.all(LEAGUE)]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tradesUrl / the refetch timer (F450) / the carrier', () => {
  it('`all` is the default and stays off the wire', () => {
    expect(tradesUrl('L')).toBe('/api/leagues/L/trades')
    expect(tradesUrl('L', { status: 'open', teamId: 't' })).toBe('/api/leagues/L/trades?status=open&team_id=t')
  })

  it('re-reads on a timer only while some trade’s voting is OPEN', () => {
    const doc = (open: boolean[]) => ({ trades: open.map((o) => ({ tally: { voting_open: o } })) }) as unknown as TradesDocument
    expect(tradesRefetchInterval(undefined)).toBe(false)
    expect(tradesRefetchInterval(doc([]))).toBe(false)
    expect(tradesRefetchInterval(doc([false]))).toBe(false)
    expect(tradesRefetchInterval(doc([false, true]))).toBe(TRADE_TALLY_REFETCH_MS)
    expect(tradesRefetchInterval({ trades: [{ tally: null }] } as unknown as TradesDocument)).toBe(false)
  })

  it('the list refetches on `trades` and nothing else', () => {
    expect(LEAGUE_CHANNEL_EVENTS.filter(tradesEventInvalidates)).toStrictEqual(['trades'])
  })
})

describe('useProposeTrade — not optimistic, not retried', () => {
  it('the variables: legs mapped, blanks dropped, one action_id', () => {
    expect(
      proposeTradeVariables(
        { fromTeamId: TA, toTeamId: TB, legs: [{ playerId: 'p1', fromTeamId: TA }, { faabAmount: 5, fromTeamId: TB }], drops: [], note: ' ', reason: '' },
        'id',
      ),
    ).toStrictEqual({
      from_team_id: TA,
      to_team_id: TB,
      items: [
        { player_id: 'p1', from_team_id: TA },
        { faab_amount: 5, from_team_id: TB },
      ],
      action_id: 'id',
    })
  })

  it('a refusal hits the wire ONCE (POST …/trades), leaves the cache untouched, re-reads only the trades', async () => {
    const client = seeded()
    const fetchMock = respond(409, { error: 'trade_propose: the trade deadline has passed' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, proposeTradeMutationOptions(client, LEAGUE))
      .mutate({ from_team_id: TA, to_team_id: TB, items: [], action_id: 'x' })
      .catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect([sent(fetchMock).url, sent(fetchMock).method]).toStrictEqual([`/api/leagues/${LEAGUE}/trades`, 'POST'])
    expect(client.getQueryData(tradeKeys.list(LEAGUE, 'all', null))).toBe(DOC)
    expect(stale(client, tradeKeys.list(LEAGUE, 'all', null))).toBe(true)
    expect(stale(client, tradeKeys.list(OTHER, 'all', null))).toBe(false)
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(false)
  })

  it('a commissioner proposal re-reads the feed and the audit log; no roster key (a proposal moves nothing)', async () => {
    const client = seeded()
    vi.stubGlobal('fetch', respond(200, { acted_as_commissioner: true }))
    await new MutationObserver(client, proposeTradeMutationOptions(client, LEAGUE)).mutate({ from_team_id: TA, to_team_id: TB, items: [], action_id: 'x' })
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, commishLogKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, leagueRosterKeys.all(LEAGUE))).toBe(false)
  })
})

describe('useTradeAction — PATCH …/trades/[tid]', () => {
  it('the variables per op: accept keeps its drops, counter maps its legs, vote carries no reason', () => {
    expect(tradeActionVariables({ tradeId: 't', op: 'accept', drops: ['d'], reason: ' ' }, 'id')).toStrictEqual({
      tradeId: 't',
      body: { op: 'accept', drops: ['d'], action_id: 'id' },
    })
    expect(tradeActionVariables({ tradeId: 't', op: 'counter', legs: [{ playerId: 'p', fromTeamId: TB }], note: 'hi' }, 'id')).toStrictEqual({
      tradeId: 't',
      body: { op: 'counter', items: [{ player_id: 'p', from_team_id: TB }], note: 'hi', action_id: 'id' },
    })
    expect(tradeActionVariables({ tradeId: 't', op: 'vote', vote: 'veto' }, 'id')).toStrictEqual({ tradeId: 't', body: { op: 'vote', vote: 'veto', action_id: 'id' } })
  })

  it('a refusal hits the wire once and re-reads only the trades', async () => {
    const client = seeded()
    const fetchMock = respond(409, { error: 'trade_respond: this trade is already invalid' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, tradeActionMutationOptions(client, LEAGUE))
      .mutate({ tradeId: 'tid', body: { op: 'accept', action_id: 'x' } })
      .catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent(fetchMock)).toStrictEqual({ url: `/api/leagues/${LEAGUE}/trades/tid`, method: 'PATCH', body: { op: 'accept', action_id: 'x' } })
    expect(stale(client, tradeKeys.list(LEAGUE, 'all', null))).toBe(true)
    for (const key of MOVED) expect(stale(client, key), JSON.stringify(key)).toBe(false)
  })

  it('an accept that put the trade in review moves nothing; one that EXECUTED re-reads every moved surface', async () => {
    const trade = { id: 'tid', status: 'in_review', proposer_team_id: TA, recipient_team_id: TB }
    const client = seeded()
    vi.stubGlobal('fetch', respond(200, { op: 'accept', trade_id: 'tid', trade, execution: null, acted_as_commissioner: false }))
    await new MutationObserver(client, tradeActionMutationOptions(client, LEAGUE)).mutate({ tradeId: 'tid', body: { op: 'accept', action_id: 'x' } })
    for (const key of MOVED) expect(stale(client, key), JSON.stringify(key)).toBe(false)

    const executed = seeded()
    vi.stubGlobal('fetch', respond(200, { op: 'accept', trade_id: 'tid', trade: { ...trade, status: 'complete' }, execution: { outcome: 'complete' }, acted_as_commissioner: false }))
    await new MutationObserver(executed, tradeActionMutationOptions(executed, LEAGUE)).mutate({ tradeId: 'tid', body: { op: 'accept', action_id: 'y' } })
    for (const key of MOVED) expect(stale(executed, key), JSON.stringify(key)).toBe(true)
    expect(stale(executed, leagueRosterKeys.all(OTHER))).toBe(false)
    expect(stale(executed, commishLogKeys.all(LEAGUE))).toBe(false)
  })

  it('a vote that VETOED re-reads the feed (the system post); a recorded vote only the trades', async () => {
    const trade = { id: 'tid', status: 'in_review', proposer_team_id: TA, recipient_team_id: TB }
    const client = seeded()
    vi.stubGlobal('fetch', respond(200, { op: 'vote', trade_id: 'tid', vote: 'veto', outcome: 'recorded', trade }))
    await new MutationObserver(client, tradeActionMutationOptions(client, LEAGUE)).mutate({ tradeId: 'tid', body: { op: 'vote', vote: 'veto', action_id: 'x' } })
    expect([stale(client, tradeKeys.list(LEAGUE, 'all', null)), stale(client, leagueActivityKeys.all(LEAGUE))]).toStrictEqual([true, false])
    vi.stubGlobal('fetch', respond(200, { op: 'vote', trade_id: 'tid', vote: 'veto', outcome: 'vetoed', trade: { ...trade, status: 'vetoed' } }))
    await new MutationObserver(client, tradeActionMutationOptions(client, LEAGUE)).mutate({ tradeId: 'tid', body: { op: 'vote', vote: 'veto', action_id: 'y' } })
    expect(stale(client, leagueActivityKeys.all(LEAGUE))).toBe(true)
  })
})

describe('useCommishTrade — POST …/commish/trade (F451’s hook half)', () => {
  it('the variables: blank reason dropped, one action_id', () => {
    expect(commishTradeVariables({ tradeId: 't', op: 'veto', reason: '  ' }, 'id')).toStrictEqual({ trade_id: 't', op: 'veto', action_id: 'id' })
    expect(commishTradeVariables({ tradeId: 't', op: 'force', reason: 'ok' }, 'id')).toStrictEqual({ trade_id: 't', op: 'force', reason: 'ok', action_id: 'id' })
  })

  it('success re-reads the trades, every moved surface (both lineups by the answer’s teams), the audit log and the matchups', async () => {
    const client = seeded()
    const fetchMock = respond(200, { op: 'force', trade: { proposer_team_id: TA, recipient_team_id: TB } })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, commishTradeMutationOptions(client, LEAGUE)).mutate({ trade_id: 't', op: 'force', action_id: 'x' })
    expect(sent(fetchMock)).toStrictEqual({ url: `/api/leagues/${LEAGUE}/commish/trade`, method: 'POST', body: { trade_id: 't', op: 'force', action_id: 'x' } })
    for (const key of [...MOVED, tradeKeys.list(LEAGUE, 'all', null), commishLogKeys.all(LEAGUE), leagueMatchupKeys.all(LEAGUE)]) {
      expect(stale(client, key), JSON.stringify(key)).toBe(true)
    }
    expect(stale(client, leagueRosterKeys.all(OTHER))).toBe(false)
  })

  it('a refusal hits the wire once, leaves the cache untouched and re-reads (no lineup — nothing moved)', async () => {
    const client = seeded()
    const fetchMock = respond(409, { error: 'commish_force_or_reverse_trade: One is no longer on Team B' })
    vi.stubGlobal('fetch', fetchMock)
    await new MutationObserver(client, commishTradeMutationOptions(client, LEAGUE)).mutate({ trade_id: 't', op: 'force', action_id: 'x' }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(tradeKeys.list(LEAGUE, 'all', null))).toBe(DOC)
    expect(stale(client, tradeKeys.list(LEAGUE, 'all', null))).toBe(true)
    expect(stale(client, leagueRosterKeys.all(LEAGUE))).toBe(true)
    expect(stale(client, teamLineupKeys.all(TA))).toBe(false)
  })
})
